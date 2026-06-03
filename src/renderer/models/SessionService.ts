import extractChunks from 'png-chunks-extract';
import { Buffer } from 'buffer';
import { v4 } from 'uuid';
import { backend, imageService, workFlowService, zipService } from '.';
import { FileEntry } from '../backend';
import defaultassets from '../defaultassets';
import { dataUriToBase64 } from './ImageService';
import { defaultUC } from './PromptService';
import { ResourceSyncService } from './ResourceSyncService';
import {
  PromptPieceSlot,
  GenericScene,
  InpaintScene,
  Scene,
  Session,
  ISession,
} from './types';
import { extractPromptDataFromBase64 } from './util';
import * as PngChunk from 'png-chunk-text';
import { Sampling } from '../backends/imageGen';
import encodeChunks from 'png-chunks-encode';
import * as legacy from './legacy';

const SESSION_SERVICE_INTERVAL = 5000;

export class SessionService extends ResourceSyncService<Session> {
  favorites: Set<string> = new Set();

  constructor() {
    super('projects', SESSION_SERVICE_INTERVAL);
  }

  async loadFavorites() {
    try {
      const str = await backend.readFile('favorites.json');
      const arr = JSON.parse(str);
      this.favorites = new Set(arr);
    } catch (e) {
      // 기존 projects/favorites.json에서 마이그레이션 시도
      try {
        const oldStr = await backend.readFile('projects/favorites.json');
        const arr = JSON.parse(oldStr);
        this.favorites = new Set(arr);
        await this.saveFavorites();
        await backend.renameFile('projects/favorites.json', 'projects/favorites.json.migrated');
      } catch (e2) {
        this.favorites = new Set();
      }
    }
  }

  async saveFavorites() {
    await backend.writeFile('favorites.json', JSON.stringify([...this.favorites]));
  }

  async toggleFavorite(name: string) {
    if (this.favorites.has(name)) {
      this.favorites.delete(name);
    } else {
      this.favorites.add(name);
    }
    await this.saveFavorites();
    await this.update();
  }

  isFavorite(name: string): boolean {
    return this.favorites.has(name);
  }

  // ===== 폴더 API (단일 레벨, 실제 디렉토리) =====

  private folderDirPath(folder: string): string {
    return 'projects/' + folder;
  }

  async createFolder(folder: string): Promise<void> {
    folder = folder.trim();
    if (!folder || folder.includes('/') || folder.startsWith('.')) {
      throw new Error('폴더 이름에 / 를 쓸 수 없습니다.');
    }
    if (this.folderList.includes(folder)) {
      throw new Error('이미 존재하는 폴더입니다.');
    }
    if (this.resourceList.includes(folder)) {
      throw new Error('같은 이름의 프로젝트가 있어 폴더를 만들 수 없습니다.');
    }
    // .keep 파일을 써서 빈 폴더를 만든다 (write-file이 부모 폴더를 생성).
    await backend.writeFile(this.folderDirPath(folder) + '/.keep', '');
    await this.update();
  }

  async renameFolder(oldName: string, newName: string): Promise<void> {
    newName = newName.trim();
    if (!newName || newName.includes('/') || newName.startsWith('.')) {
      throw new Error('폴더 이름에 / 를 쓸 수 없습니다.');
    }
    if (!this.folderList.includes(oldName)) {
      throw new Error('폴더를 찾을 수 없습니다.');
    }
    if (oldName === newName) return;
    if (this.folderList.includes(newName)) {
      throw new Error('이미 존재하는 폴더입니다.');
    }
    if (this.resourceList.includes(newName)) {
      throw new Error('같은 이름의 프로젝트가 있습니다.');
    }
    await backend.renameDir(
      this.folderDirPath(oldName),
      this.folderDirPath(newName),
    );
    // 폴더맵 즉시 반영 (update()의 재스캔 전에도 일관성 유지)
    for (const [name, f] of Object.entries(this.folderMap)) {
      if (f === oldName) this.folderMap[name] = newName;
    }
    // 폴더 색상 마이그레이션
    if (this.folderColors[oldName]) {
      this.folderColors[newName] = this.folderColors[oldName];
      delete this.folderColors[oldName];
      await this.saveFolderColors();
    }
    // 폴더 순서 마이그레이션
    const orderIdx = this.folderOrder.indexOf(oldName);
    if (orderIdx >= 0) {
      this.folderOrder[orderIdx] = newName;
      await this.saveFolderOrder();
    }
    await this.update();
  }

  // 비파괴적 삭제: 안의 프로젝트는 루트(미분류)로 옮기고 폴더만 제거한다.
  async deleteFolder(folder: string): Promise<void> {
    if (!this.folderList.includes(folder)) {
      throw new Error('폴더를 찾을 수 없습니다.');
    }
    const projectsInFolder = Object.keys(this.folderMap).filter(
      (n) => this.folderMap[n] === folder,
    );
    for (const name of projectsInFolder) {
      await this.moveToFolder(name, null);
    }
    await backend.deleteDir(this.folderDirPath(folder));
    // 폴더 색상 정리
    if (this.folderColors[folder]) {
      delete this.folderColors[folder];
      await this.saveFolderColors();
    }
    // 폴더 순서 정리
    if (this.folderOrder.includes(folder)) {
      this.folderOrder = this.folderOrder.filter((f) => f !== folder);
      await this.saveFolderOrder();
    }
    await this.update();
  }

  // 프로젝트를 폴더로 이동 (null = 루트/미분류). 실제 .json 파일을 옮긴다.
  async moveToFolder(name: string, targetFolder: string | null): Promise<void> {
    const current = this.folderMap[name] ?? null;
    if (current === targetFolder) return;
    if (targetFolder !== null) {
      if (targetFolder.includes('/')) {
        throw new Error('잘못된 폴더 이름입니다.');
      }
      if (!this.folderList.includes(targetFolder)) {
        throw new Error('대상 폴더가 없습니다.');
      }
    }
    const srcPath = this.getPath(name);
    this.folderMap[name] = targetFolder;
    const destPath = this.getPath(name);
    await backend.renameFile(srcPath, destPath);
    await this.update();
  }

  // ===== 폴더 색상 (사이드카: folderColors.json) =====
  // 폴더 이름 → 색상(hex 문자열). 미지정 폴더는 undefined.
  private folderColors: Record<string, string> = {};

  async loadFolderColors() {
    try {
      const str = await backend.readFile('folderColors.json');
      this.folderColors = JSON.parse(str) || {};
    } catch (e) {
      this.folderColors = {};
    }
  }

  async saveFolderColors() {
    await backend.writeFile(
      'folderColors.json',
      JSON.stringify(this.folderColors),
    );
  }

  getFolderColor(folder: string): string | undefined {
    return this.folderColors[folder];
  }

  // ===== 폴더 정렬 순서 (사이드카: folderOrder.json) =====
  // 드로어/그리드가 공유하는 사용자 지정 폴더 순서.
  private folderOrder: string[] = [];

  async loadFolderOrder() {
    try {
      const str = await backend.readFile('folderOrder.json');
      this.folderOrder = JSON.parse(str) || [];
    } catch (e) {
      this.folderOrder = [];
    }
  }

  async saveFolderOrder() {
    await backend.writeFile(
      'folderOrder.json',
      JSON.stringify(this.folderOrder),
    );
  }

  // 저장된 순서를 우선 적용하고, 순서에 없는 폴더는 뒤에 자연정렬로 덧붙인다.
  getOrderedFolders(): string[] {
    const all = this.folderList.slice();
    const known = this.folderOrder.filter((f) => all.includes(f));
    const knownSet = new Set(known);
    const rest = all
      .filter((f) => !knownSet.has(f))
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
      );
    return [...known, ...rest];
  }

  async setFolderOrder(order: string[]) {
    // 실제 존재하는 폴더만, 중복 제거하여 저장 + 빠진 폴더는 뒤에 덧붙임
    const all = new Set(this.folderList);
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const f of order) {
      if (all.has(f) && !seen.has(f)) {
        seen.add(f);
        cleaned.push(f);
      }
    }
    for (const f of this.folderList) if (!seen.has(f)) cleaned.push(f);
    this.folderOrder = cleaned;
    await this.saveFolderOrder();
    this.dispatchEvent(new CustomEvent('listupdated', {}));
  }

  async setFolderColor(folder: string, color: string | null) {
    if (color) this.folderColors[folder] = color;
    else delete this.folderColors[folder];
    await this.saveFolderColors();
    // listupdated 디스패치로 드로어/브라우저가 즉시 재렌더되도록 한다.
    this.dispatchEvent(new CustomEvent('listupdated', {}));
  }

  // 북마크 기능
  private bookmarkData: {
    scenes: Record<string, { name: string; type: string }>;
    images: Record<string, string>;
  } = { scenes: {}, images: {} };

  async loadBookmarks() {
    try {
      const str = await backend.readFile('bookmarks.json');
      const data = JSON.parse(str);
      this.bookmarkData = {
        scenes: data.scenes || {},
        images: data.images || {},
      };
    } catch (e) {
      this.bookmarkData = { scenes: {}, images: {} };
    }
  }

  async saveBookmarks() {
    await backend.writeFile('bookmarks.json', JSON.stringify(this.bookmarkData));
    this.dispatchEvent(new CustomEvent('bookmark-updated'));
  }

  getSceneBookmark(projectName: string): { name: string; type: string } | undefined {
    return this.bookmarkData.scenes[projectName];
  }

  isSceneBookmarked(projectName: string, sceneName: string): boolean {
    return this.bookmarkData.scenes[projectName]?.name === sceneName;
  }

  async toggleSceneBookmark(projectName: string, sceneName: string, sceneType: string) {
    const current = this.bookmarkData.scenes[projectName];
    if (current?.name === sceneName) {
      delete this.bookmarkData.scenes[projectName];
    } else {
      this.bookmarkData.scenes[projectName] = { name: sceneName, type: sceneType };
    }
    await this.saveBookmarks();
  }

  getImageBookmark(projectName: string, sceneName: string): string | undefined {
    return this.bookmarkData.images[projectName + ':' + sceneName];
  }

  isImageBookmarked(projectName: string, sceneName: string, imageFilename: string): boolean {
    return this.bookmarkData.images[projectName + ':' + sceneName] === imageFilename;
  }

  async toggleImageBookmark(projectName: string, sceneName: string, imageFilename: string) {
    const key = projectName + ':' + sceneName;
    if (this.bookmarkData.images[key] === imageFilename) {
      delete this.bookmarkData.images[key];
    } else {
      this.bookmarkData.images[key] = imageFilename;
    }
    await this.saveBookmarks();
  }

  // ===== 썸네일 캐시 (사이드카: thumbnails.json) =====
  // 프로젝트 카드 썸네일을 (씬, 파일명) 참조로 캐시해, 탐색 시 세션 풀로딩을 피한다.
  private thumbnailData: Record<string, { scene: string; image: string }> = {};
  private thumbnailSaveTimer: any = null;

  async loadThumbnails() {
    try {
      const str = await backend.readFile('thumbnails.json');
      this.thumbnailData = JSON.parse(str) || {};
    } catch (e) {
      this.thumbnailData = {};
    }
  }

  async saveThumbnails() {
    await backend.writeFile(
      'thumbnails.json',
      JSON.stringify(this.thumbnailData),
    );
  }

  private scheduleThumbnailSave() {
    if (this.thumbnailSaveTimer) clearTimeout(this.thumbnailSaveTimer);
    this.thumbnailSaveTimer = setTimeout(() => {
      this.saveThumbnails().catch(() => {});
    }, 1000);
  }

  getThumbnailRef(
    project: string,
  ): { scene: string; image: string } | undefined {
    return this.thumbnailData[project];
  }

  setThumbnailRef(project: string, scene: string, image: string) {
    this.thumbnailData[project] = { scene, image };
    this.scheduleThumbnailSave();
  }

  clearThumbnailRef(project: string) {
    if (project in this.thumbnailData) {
      delete this.thumbnailData[project];
      this.scheduleThumbnailSave();
    }
  }

  private async firstOutputImage(
    project: string,
    sceneName: string,
  ): Promise<string | undefined> {
    try {
      const files = await backend.listFiles('outs/' + project + '/' + sceneName);
      return (files || []).find((f: string) => f.endsWith('.png'));
    } catch (e) {
      return undefined;
    }
  }

  // 캐시 미스 시 1회 해석. 로드된 세션이면 인메모리 정보를, 아니면 원본 JSON을
  // 직접 읽어(메모리에 상주시키지 않음) 첫 씬의 대표/첫 이미지를 찾는다.
  async resolveThumbnail(
    name: string,
  ): Promise<{ scene: string; image: string } | undefined> {
    if (name in this.resources) {
      const scenes = Array.from(this.resources[name].scenes.values());
      if (!scenes.length) return undefined;
      const scene = scenes[0];
      if (scene.mains && scene.mains.length) {
        return { scene: scene.name, image: scene.mains[0] };
      }
      const images = imageService.getOutputs(this.resources[name], scene);
      if (images && images.length) {
        return { scene: scene.name, image: images[0] };
      }
      const png = await this.firstOutputImage(name, scene.name);
      return png ? { scene: scene.name, image: png } : undefined;
    }
    try {
      const raw = JSON.parse(await backend.readFile(this.getPath(name)));
      const sceneKeys = Object.keys(raw.scenes || {});
      if (!sceneKeys.length) return undefined;
      const sceneName = sceneKeys[0];
      const mains = raw.scenes[sceneName]?.mains || [];
      if (mains.length) return { scene: sceneName, image: mains[0] };
      const png = await this.firstOutputImage(name, sceneName);
      return png ? { scene: sceneName, image: png } : undefined;
    } catch (e) {
      return undefined;
    }
  }

  // 종료 시: 로드된(작업한) 세션의 자동 썸네일만 재해석해 갱신
  async refreshLoadedThumbnails() {
    for (const name of Object.keys(this.resources)) {
      try {
        const ref = await this.resolveThumbnail(name);
        if (ref) this.thumbnailData[name] = ref;
      } catch (e) {}
    }
  }

  async run() {
    await this.loadFavorites();
    await this.loadBookmarks();
    await this.loadThumbnails();
    await this.loadFolderColors();
    await this.loadFolderOrder();
    const { trashService } = await import('.');
    await trashService.loadTrash();

    // 만료 프로젝트 감지 → UI 다이얼로그에 전달 (가볍게 체크만)
    const expired = await trashService.getExpiredProjects();
    if (expired.length > 0) {
      const { appState } = await import('./AppService');
      appState.pendingExpiredProjects = expired;
    }

    // autoCleanup은 앱 시작을 블로킹하지 않도록 지연 실행
    setTimeout(() => {
      trashService.autoCleanup().catch((e) => {
        console.error('휴지통 자동 정리 실패:', e);
      });
    }, 10000);

    await super.run();
  }

  async delete(name: string) {
    this.favorites.delete(name);
    await this.saveFavorites();
    // 썸네일 캐시 정리
    this.clearThumbnailRef(name);
    // 북마크 정리
    delete this.bookmarkData.scenes[name];
    const keysToDelete = Object.keys(this.bookmarkData.images).filter(k => k.startsWith(name + ':'));
    keysToDelete.forEach(k => delete this.bookmarkData.images[k]);
    if (keysToDelete.length > 0 || this.bookmarkData.scenes[name]) {
      await this.saveBookmarks();
    }
    // 같은 이름의 기존 휴지통 항목을 먼저 정리 (동명 프로젝트 재삭제 시 충돌/덮어쓰기 방지).
    // 이렇게 해야 super.delete 의 .json → .deleted rename 대상이 비어 있어 플랫폼 무관하게 안전.
    const { trashService } = await import('.');
    await trashService.purgeDeletedProject(name);
    await super.delete(name);
    // 휴지통에 삭제 시점 기록
    await trashService.moveProjectToTrash(name);
  }

  async rename(oldName: string, newName: string) {
    if (this.favorites.has(oldName)) {
      this.favorites.delete(oldName);
      this.favorites.add(newName);
      await this.saveFavorites();
    }
    // 썸네일 캐시 마이그레이션
    if (this.thumbnailData[oldName]) {
      this.thumbnailData[newName] = this.thumbnailData[oldName];
      delete this.thumbnailData[oldName];
      this.scheduleThumbnailSave();
    }
    // 북마크 마이그레이션
    let bmChanged = false;
    if (this.bookmarkData.scenes[oldName]) {
      this.bookmarkData.scenes[newName] = this.bookmarkData.scenes[oldName];
      delete this.bookmarkData.scenes[oldName];
      bmChanged = true;
    }
    const imageKeys = Object.keys(this.bookmarkData.images).filter(k => k.startsWith(oldName + ':'));
    imageKeys.forEach(k => {
      const sceneName = k.substring(oldName.length + 1);
      this.bookmarkData.images[newName + ':' + sceneName] = this.bookmarkData.images[k];
      delete this.bookmarkData.images[k];
      bmChanged = true;
    });
    if (bmChanged) await this.saveBookmarks();
    await super.rename(oldName, newName);
  }

  // 종료 시 빠른 저장: saveAll()은 로드된 세션이 많으면(프로젝트 탐색을 열면
  // 전체가 로드됨) 10~20초가 걸린다. 편집은 사실상 현재 세션에서만 일어나므로
  // dirty(변경 표시)된 것 + 현재 세션만 저장한다. (디바운스로 아직 dirty 표시가
  // 안 된 현재 세션의 마지막 편집분도 현재 세션을 항상 포함해 보존됨)
  async flushOnClose() {
    const names = new Set<string>(
      Object.keys(this.dirty).filter((n) => n in this.resources),
    );
    try {
      const { appState } = await import('./AppService');
      const cur = appState.curSession?.name;
      if (cur && cur in this.resources) names.add(cur);
    } catch (e) {}
    const writes = [...names].map((name) =>
      backend.writeFile(
        this.getPath(name),
        JSON.stringify(this.resources[name].toJSON()),
      ),
    );
    await Promise.allSettled(writes);
    // 종료 시 작업한 세션의 자동 썸네일 갱신
    try {
      await this.refreshLoadedThumbnails();
      await this.saveThumbnails();
    } catch (e) {}
  }

  async getHook(rc: Session, name: string) {
    rc.name = name;
  }

  async migrate(rc: any) {
    if (!rc.version) {
      await backend.writeFile(
        'projects/' + rc.name + '.json.bak',
        JSON.stringify(rc),
      );
      rc = await legacy.migrateSession(rc);
    }
    if (Array.isArray(rc.presets)) {
      await legacy.recoverSession(rc);
    }
    await this.migrateSession(rc);
    console.log('migrated', rc);
    return rc;
  }

  async createDefault(name: string) {
    const newSession = Session.fromJSON({
      name: name,
      version: 1,
      presets: {},
      inpaints: {},
      scenes: Object.fromEntries([
        [
          'default',
          {
            type: 'scene',
            name: 'default',
            resolution: 'portrait',
            slots: [[{ prompt: '', characterPrompts: [], id: v4() }]],
            game: undefined,
            round: undefined,
            meta: {},
            imageMap: [],
            mains: [],
          },
        ],
      ]),
      library: {},
      presetShareds: {},
    });
    await importDefaultPresets(newSession);
    return newSession;
  }

  getInpaintOrgPath(session: Session, inpaint: InpaintScene) {
    return 'inpaint_orgs/' + session.name + '/' + inpaint.name + '.png';
  }

  getInpaintMaskPath(session: Session, inpaint: InpaintScene) {
    return 'inpaint_masks/' + session.name + '/' + inpaint.name + '.png';
  }

  async exportSessionShallow(session: Session) {
    const sess: ISession = session.toJSON();
    if (sess.presetShareds.SDImageGenEasy) {
      sess.presetShareds.SDImageGenEasy.vibes = [];
    }
    if (sess.presetShareds.SDImageGen) {
      sess.presetShareds.SDImageGen.vibes = [];
    }
    for (const scene of Object.values(sess.scenes)) {
      scene.game = undefined;
      scene.round = undefined;
      scene.imageMap = [];
      scene.mains = [];
    }
    sess.inpaints = {};

    for (const presetSet of Object.values(sess.presets)) {
      for (const preset of presetSet) {
        if (preset.profile) {
          try {
            const data = (await imageService.fetchVibeImage(
              session,
              preset.profile,
            ))!;
            const base64 = dataUriToBase64(data);
            preset.profile = base64;
          } catch (e) {}
        }
      }
    }
    return sess;
  }

  async exportSessionDeep(session: Session, outPath: string) {
    const ignoreError = async (f: Promise<any>) => {
      try {
        return await f;
      } catch (e) {
        return [];
      }
    };

    // 폴더에 속한 프로젝트는 projects/<폴더>/<이름>.json 이므로 폴더 인식 경로 사용
    const projFile = this.getPath(session.name);
    const entries: FileEntry[] = [];

    // 모든 디렉토리를 병렬로 스캔
    const sceneNames = Array.from(session.scenes.values()).map((s) => s.name);
    const inpaintNames = Array.from(session.inpaints.values()).map((s) => s.name);

    const [sceneResults, inpaintResults, inpaintOrgs, inpaintMasks, vibes, references] = await Promise.all([
      // 씬별 이미지 (병렬)
      Promise.all(sceneNames.map(async (name) => ({
        name,
        files: await ignoreError(backend.listFiles('outs/' + session.name + '/' + name)),
      }))),
      // 인페인트별 이미지 (병렬)
      Promise.all(inpaintNames.map(async (name) => ({
        name,
        files: await ignoreError(backend.listFiles('inpaints/' + session.name + '/' + name)),
      }))),
      ignoreError(backend.listFiles('inpaint_orgs/' + session.name)),
      ignoreError(backend.listFiles('inpaint_masks/' + session.name)),
      ignoreError(backend.listFiles('vibes/' + session.name)),
      ignoreError(backend.listFiles('references/' + session.name)),
    ]);

    for (const { name, files } of sceneResults) {
      for (const image of files) {
        if (!image.endsWith('.png')) continue;
        entries.push({
          path: 'outs/' + session.name + '/' + name + '/' + image,
          name: 'outs/' + name + '/' + image,
        });
      }
    }
    for (const image of inpaintOrgs) {
      if (!image.endsWith('.png')) continue;
      entries.push({
        path: 'inpaint_orgs/' + session.name + '/' + image,
        name: 'inpaint_orgs/' + image,
      });
    }
    for (const image of inpaintMasks) {
      if (!image.endsWith('.png')) continue;
      entries.push({
        path: 'inpaint_masks/' + session.name + '/' + image,
        name: 'inpaint_masks/' + image,
      });
    }
    for (const { name, files } of inpaintResults) {
      for (const image of files) {
        if (!image.endsWith('.png')) continue;
        entries.push({
          path: 'inpaints/' + session.name + '/' + name + '/' + image,
          name: 'inpaints/' + name + '/' + image,
        });
      }
    }
    for (const vibe of vibes) {
      if (!vibe.endsWith('.png')) continue;
      entries.push({
        path: 'vibes/' + session.name + '/' + vibe,
        name: 'vibes/' + vibe,
      });
    }
    for (const ref of references) {
      if (!ref.endsWith('.png')) continue;
      entries.push({
        path: 'references/' + session.name + '/' + ref,
        name: 'references/' + ref,
      });
    }
    entries.push({ path: projFile, name: 'project.json' });
    if (zipService.isZipping) {
      throw new Error('Already zipping');
    }
    await zipService.zipFiles(entries, outPath);
  }

  async importSessionShallow(session: ISession, name: string) {
    if (name in this.resources) {
      throw new Error('Resource already exists');
    }
    session.name = name;
    if (Array.isArray(session.presets)) {
      for (const preset of session.presets) {
        if (preset.type === 'style') {
          try {
            const path = 'vibes/' + name + '/' + v4() + '.png';
            await backend.writeDataFile(path, preset.profile);
            preset.profile = path.split('/').pop()!;
          } catch (e) {}
        }
      }
    } else if (session.presets) {
      for (const presetSet of Object.values(session.presets)) {
        for (const preset of presetSet) {
          if (preset.profile) {
            try {
              const path = 'vibes/' + name + '/' + v4() + '.png';
              await backend.writeDataFile(path, preset.profile);
              preset.profile = path.split('/').pop()!;
            } catch (e) {}
          }
        }
      }
    }
    await this.createFrom(name, session);
  }

  async importSessionDeep(tarpath: string, name: string) {
    if (name in this.resources) {
      throw new Error('Resource already exists');
    }
    const path = 'tmp/' + v4();
    await backend.unzipFiles(tarpath, path);
    const session: Session = JSON.parse(
      await backend.readFile(path + '/project.json'),
    );
    session.name = name;
    try {
      await backend.renameDir(path + '/outs', 'outs/' + session.name);
    } catch (e) {
      console.error(e);
    }
    try {
      await backend.renameDir(path + '/inpaints', 'inpaints/' + session.name);
    } catch (e) {
      console.error(e);
    }
    try {
      await backend.renameDir(
        path + '/inpaint_orgs',
        'inpaint_orgs/' + session.name,
      );
    } catch (e) {
      console.error(e);
    }
    try {
      await backend.renameDir(
        path + '/inpaint_masks',
        'inpaint_masks/' + session.name,
      );
    } catch (e) {
      console.error(e);
    }
    try {
      await backend.renameDir(path + '/vibes', 'vibes/' + session.name);
    } catch (e) {
      console.error(e);
    }
    try {
      await backend.renameDir(path + '/references', 'references/' + session.name);
    } catch (e) {
      console.error(e);
    }
    await this.createFrom(name, session);
  }

  async migrateSession(session: ISession) {
    const types = ['SDImageGen', 'SDImageGenEasy'];
    for (const type of types) {
      if (session.presetShareds[type]) {
        for (const vibe of session.presetShareds[type].vibes) {
          if (vibe.path) vibe.path = vibe.path.split('/').pop()!;
        }
      }
    }
  }

  async saveInpaintImages(
    seesion: Session,
    inpaint: InpaintScene,
    image: string,
    mask: string,
  ) {
    await backend.writeDataFile(
      this.getInpaintOrgPath(seesion, inpaint),
      image,
    );
    await backend.writeDataFile(
      this.getInpaintMaskPath(seesion, inpaint),
      mask,
    );
    await imageService.invalidateCache(
      this.getInpaintOrgPath(seesion, inpaint),
    );
    await imageService.invalidateCache(
      this.getInpaintMaskPath(seesion, inpaint),
    );
  }

  styleEdit(preset: any, container: any) {
    this.dispatchEvent(
      new CustomEvent('style-edit', { detail: { preset, container } }),
    );
  }

  configChanged(): void {
    this.dispatchEvent(new CustomEvent('config-changed', {}));
  }

  async reloadPieceLibraryDB(session: Session) {
    const res: string[] = [];
    const localKeys = new Set<string>();
    for (const [k, v] of session.library.entries()) {
      for (const piece of v.pieces) {
        const key = k + '.' + piece.name;
        res.push(key);
        localKeys.add(key);
      }
    }
    // 전역 조각 추가 (로컬과 동명인 경우 스킵)
    try {
      const { globalPieceService } = await import('.');
      for (const [k, v] of globalPieceService.library.entries()) {
        for (const piece of v.pieces) {
          const key = k + '.' + piece.name;
          if (!localKeys.has(key)) {
            res.push(key);
          }
        }
      }
    } catch (e) {}
    await backend.loadPiecesDB(res);
  }
}

export async function importDefaultPresets(session: Session) {
  // 글로벌 프리셋 서비스에서 "기본" 플래그 지정된 것들을 먼저 시도
  // 순환 임포트 방지를 위해 동적 import 사용
  let hadGlobalDefaults = false;
  try {
    const mod = await import('.');
    const globalPresetService = (mod as any).globalPresetService;
    if (globalPresetService) {
      if (!globalPresetService.loaded) {
        await globalPresetService.load();
      }
      const easyDefaults = globalPresetService.getDefaults('SDImageGenEasy');
      const genDefaults = globalPresetService.getDefaults('SDImageGen');
      for (const entry of [...easyDefaults, ...genDefaults]) {
        try {
          await globalPresetService.instantiateIntoSession(session, entry.id);
          hadGlobalDefaults = true;
        } catch (e) {
          console.warn(
            'Failed to instantiate global default preset:',
            entry?.name,
            e,
          );
        }
      }
    }
  } catch (e) {
    console.warn('GlobalPresetService unavailable during session init:', e);
  }

  // Fallback: SDImageGenEasy 프리셋이 비어있으면 기존 defaultassets 시드
  // (신규 설치 첫 실행 UX 보존)
  const hasEasyPresets =
    session.presets.has('SDImageGenEasy') &&
    session.presets.get('SDImageGenEasy')!.length > 0;
  if (!hasEasyPresets) {
    if (!session.presets.has('SDImageGenEasy')) {
      session.presets.set('SDImageGenEasy', []);
    }
    const images = await Promise.all(
      defaultassets.map((x) => fetch(x).then((res) => res.blob())),
    );
    for (const image of images) {
      const datauri = await blobToDataUri(image);
      await importPreset(session, dataUriToBase64(datauri));
    }
  }
}
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(blob);
  });
}

export function embedJSONInPNG(inputBase64: string, jsonData: any) {
  const inputBuffer = Buffer.from(inputBase64, 'base64');
  const chunks = extractChunks(inputBuffer);

  const jsonTextChunk = PngChunk.encode(
    'tEXt',
    'json:' + Buffer.from(JSON.stringify(jsonData)).toString('base64'),
  );
  chunks.splice(1, 0, jsonTextChunk);
  const outputBuffer = Buffer.from(encodeChunks(chunks));
  const outputBase64 = outputBuffer.toString('base64');
  return outputBase64;
}

export function readJSONFromPNG(base64PNG: string) {
  try {
    const buffer = Buffer.from(base64PNG, 'base64');
    const chunks = extractChunks(buffer);
    const jsonChunk = chunks.find((chunk) => chunk.name === 'tEXt');
    if (jsonChunk) {
      let base64JsonData = Buffer.from(jsonChunk.data).toString();
      const startIndex = base64JsonData.indexOf('json:') + 5;
      base64JsonData = base64JsonData.slice(startIndex);
      const jsonData = JSON.parse(
        Buffer.from(base64JsonData, 'base64').toString(),
      );
      return jsonData;
    } else {
      return undefined;
    }
  } catch (e) {
    return undefined;
  }
}

/**
 * 레거시 프리셋 JSON을 현재 스키마로 정규화.
 * - type === 'style' 이면 SDImageGenEasy로 변환
 * - 다른 타입이면 그대로 반환
 */
export function normalizePresetJson(json: any): any {
  if (!json || !json.type) return json;
  if (json.type === 'style') {
    const newJson: any = {};
    newJson.type = 'SDImageGenEasy';
    newJson.name = json.name;
    newJson.profile = json.profile;
    newJson.sampling = json.sampling ?? Sampling.KEulerAncestral;
    newJson.noiseSchedule = json.noiseSchedule ?? 'karras';
    newJson.promptGuidance = json.promptGuidance ?? 5;
    newJson.cfgRescale = json.cfgRescale ?? 0;
    newJson.frontPrompt = json.frontPrompt;
    newJson.backPrompt = json.backPrompt;
    newJson.uc = json.uc;
    newJson.steps = json.steps ?? 28;
    return newJson;
  }
  return json;
}

export async function importPreset(session: Session, base64: string) {
  let json = readJSONFromPNG(base64);
  if (!json || !json.type || !json.name) {
    return undefined;
  }
  json = normalizePresetJson(json);
  const path = await imageService.storeVibeImage(session, base64);
  json.profile = path;
  const preset = workFlowService.presetFromJSON(json);
  session.addPreset(preset);
  return preset;
}

export const getResultDirectory = (session: Session, scene: GenericScene) => {
  if (scene.type === 'scene') {
    return imageService.getImageDir(session, scene);
  }
  return imageService.getInPaintDir(session, scene);
};

export const renameScene = async (
  session: Session,
  oldName: string,
  newName: string,
) => {
  newName = newName.trimEnd();
  await imageService.onRenameScene(session, oldName, newName);
  const scene = session.scenes.get(oldName)!;
  scene.name = newName;
  session.scenes.delete(oldName);
  session.scenes.set(newName, scene);
};

export function createImageWithText(
  width: number,
  height: number,
  text: string,
  fontSize: number = 30,
  fontFamily: string = 'Arial',
  textColor: string = 'black',
  backgroundColor: string = 'white',
) {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Unable to get 2D context from canvas');
  }

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = textColor;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillText(text, width / 2, height / 2);

  return dataUriToBase64(canvas.toDataURL('image/png'));
}
