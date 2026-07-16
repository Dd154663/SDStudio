import extractChunks from 'png-chunks-extract';
import { Buffer } from 'buffer';
import { v4 } from 'uuid';
import {
  backend,
  imageService,
  workFlowService,
  zipService,
  sessionService,
  trashService,
  taskQueueService,
  globalPieceService,
  globalPresetService,
  projectSizeService,
  templateService,
  projectTemplateService,
} from '.';
import { getAppState } from './appStateRef';
import { FileEntry } from '../backend';
import defaultassets from '../defaultassets';
import { dataUriToBase64 } from './ImageService';
import { defaultUC } from './PromptService';
import { ResourceSyncService } from './ResourceSyncService';
import { persistService } from './PersistenceService';
import { isOutputImageFile } from './imageFormats';
import {
  projectPath,
  projectFolderPath,
  projectJsonPath,
  workspacePath,
  WORKSPACE_ROOT,
  PROJECT_JSON_ROOT,
  PROJECT_IMAGE_ROOTS,
} from './projectPaths';
import {
  isWorkspaceLayout,
  physicalDirOf,
  registerProjectDir,
  unregisterProjectDir,
  renameProjectDirKey,
  makeWorkspaceDirName,
  WorkspaceProjectMeta,
  PROJECT_META_FILE,
  PROJECT_JSON_FILE,
} from './storageLayout';
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

  // 메타 파일(즐겨찾기/북마크 등) 로드가 IO 오류(저장소 권한 등)로 실패한 경우
  // 해당 파일의 저장을 차단한다 — 빈 메모리 상태를 디스크에 되써서 기존 데이터를
  // 지우는 것을 막는 안전벨트 (씬 유실 가드와 같은 철학). 파싱 오류(SyntaxError,
  // 파손 파일)는 기존대로 빈 값 재시작을 허용한다.
  private metaLoadFailed = new Set<string>();

  // IO 오류면 저장 차단 플래그를 세운다. true 반환 = 차단 상태.
  private markMetaLoadError(file: string, e: unknown): boolean {
    if (e instanceof SyntaxError) return false;
    this.metaLoadFailed.add(file);
    console.error(`${file} 로드 실패(IO) — 덮어쓰기 방지 위해 저장 차단:`, e);
    return true;
  }

  private metaSaveBlocked(file: string): boolean {
    if (!this.metaLoadFailed.has(file)) return false;
    console.warn(`${file} 저장 건너뜀 — 부팅 로드 실패 상태(기존 파일 보호)`);
    return true;
  }

  constructor() {
    super(PROJECT_JSON_ROOT, SESSION_SERVICE_INTERVAL);
  }

  // ===== 신 배치(workspace/, storage v2) 계층 =====
  // 아래 분기는 모두 isWorkspaceLayout()===true 일 때만 동작한다. 비활성 시엔
  // super/기존 경로로 위임되어 기존 동작이 1바이트도 바뀌지 않는다. 스펙 §2·§5.

  // 세션 본체 경로. 신 배치 활성 시 폴더 무관하게 workspace/<물리폴더>/project.json.
  getPath(name: string) {
    if (isWorkspaceLayout()) {
      return projectJsonPath(name);
    }
    return super.getPath(name);
  }

  // 소프트 삭제 경로: 신 배치는 project.json → project.json.deleted (접미).
  protected deletedPathOf(src: string): string {
    if (isWorkspaceLayout()) {
      return src + '.deleted';
    }
    return super.deletedPathOf(src);
  }

  // 결합 직후 훅 — 신규 프로젝트가 첫 디스크 쓰기 전에 물리 폴더에 등록되도록
  // 보장하는 안전망. 이미 등록된 이름(스캔으로 올라온 기존 프로젝트, 또는
  // deep 복제/import 가 복사 전 명시 등록한 경우)은 그대로 통과한다.
  protected async onAttached(name: string, instance: Session): Promise<void> {
    if (!isWorkspaceLayout()) return;
    if (physicalDirOf(name) !== undefined) return;
    if (!instance.id) instance.id = v4();
    await this.ensureWorkspaceProject(name, {
      id: instance.id,
      folder: this.folderMap[name] ?? '',
    });
  }

  // 신 배치 등록 seam: id 확보 → 물리 폴더명 결정 → 레지스트리 등록 → meta.json
  // 기록. 멱등(이미 등록된 이름은 기존 물리 폴더를 그대로 반환). deep 복제/import
  // 는 이미지 복사가 createFrom(→onAttached) 보다 앞서므로 복사 시작 전에 이 함수를
  // 명시 호출해 등록을 선행시킨다(스펙 §A-4).
  async ensureWorkspaceProject(
    name: string,
    opts?: { id?: string; folder?: string },
  ): Promise<string> {
    const existing = physicalDirOf(name);
    if (existing !== undefined) return existing;
    const id = opts?.id || v4();
    const dir = makeWorkspaceDirName(name, id);
    registerProjectDir(name, dir);
    const meta: WorkspaceProjectMeta = {
      version: 1,
      id,
      name,
      folder: opts?.folder ?? this.folderMap[name] ?? '',
    };
    try {
      await backend.writeFile(
        workspacePath(dir, PROJECT_META_FILE),
        JSON.stringify(meta),
      );
    } catch (e) {
      // meta.json 기록 실패 → 등록을 되돌려 "경로는 풀리는데 meta 는 없는" 갈라짐 방지.
      unregisterProjectDir(name);
      throw e;
    }
    return dir;
  }

  // meta.json 의 특정 필드를 부분 갱신한다(read-modify-write). 기존 id/version 보존.
  private async updateWorkspaceMeta(
    name: string,
    patch: Partial<Pick<WorkspaceProjectMeta, 'name' | 'folder'>>,
  ): Promise<void> {
    const dir = physicalDirOf(name);
    if (dir === undefined) {
      throw new Error(`meta.json 갱신 대상 미등록: ${JSON.stringify(name)}`);
    }
    const metaPath = workspacePath(dir, PROJECT_META_FILE);
    let meta: WorkspaceProjectMeta;
    try {
      meta = JSON.parse(await backend.readFile(metaPath));
    } catch (e) {
      // meta 부재/파손 시 현재 알고 있는 정보로 재구성(자기치유의 최소형).
      const inst = this.getLoaded(name) as Session | undefined;
      meta = {
        version: 1,
        id: inst?.id || v4(),
        name,
        folder: this.folderMap[name] ?? '',
      };
    }
    if (patch.name !== undefined) meta.name = patch.name;
    if (patch.folder !== undefined) meta.folder = patch.folder;
    await backend.writeFile(metaPath, JSON.stringify(meta));
  }

  // 신 배치 목록 스캔: workspace/ 1단 나열 → 각 하위 폴더의 meta.json 을 읽어
  // 프로젝트 목록·folderMap(meta.folder 파생)·레지스트리를 채운다. project.json
  // 부재+project.json.deleted 존재 = 소프트 삭제 상태(목록 제외 — 구 .deleted 와
  // 동일 의미, 휴지통 스캔이 별도로 소비). meta 파손/부재 폴더는 경고 후 스킵.
  protected async scanResources(): Promise<{
    names: string[];
    folderMap: { [name: string]: string | null };
    folderList: string[];
  }> {
    if (!isWorkspaceLayout()) return super.scanResources();

    const names: string[] = [];
    const folderMap: { [name: string]: string | null } = {};
    const folderSet = new Set<string>();
    const activeNames = new Set<string>();
    // 소프트 삭제로만 발견된 이름 — 활성 등록이 없을 때만 스캔 끝에 unregister 한다.
    // (동명 재생성: 옛 폴더=삭제, 새 폴더=활성이 공존할 때 순서와 무관하게 활성 우선)
    const softOnly: string[] = [];

    let dirs: string[] = [];
    try {
      dirs = await backend.listFiles(WORKSPACE_ROOT);
    } catch (e) {
      // workspace/ 부재는 [](신규) 로 흡수되지만, 실제 IO 오류면 throw 되어
      // init 의 #initialScanFailed 경로로 재시도된다.
      throw e;
    }

    for (const dir of dirs) {
      if (dir.startsWith('.')) continue;
      let meta: WorkspaceProjectMeta | undefined;
      try {
        const raw = await backend.readFile(
          workspacePath(dir, PROJECT_META_FILE),
        );
        meta = JSON.parse(raw);
      } catch (e) {
        console.warn(
          `[workspace 스캔] meta.json 읽기 실패 — 폴더 스킵: ${dir}`,
          e,
        );
        continue;
      }
      if (!meta || typeof meta.name !== 'string' || !meta.name) {
        console.warn(`[workspace 스캔] meta.json 형식 이상 — 폴더 스킵: ${dir}`);
        continue;
      }
      const name = meta.name;
      const folder = typeof meta.folder === 'string' ? meta.folder : '';
      // 활성 판정 = project.json 존재. 소프트 삭제(project.json.deleted)만 있으면
      // 목록/등록에서 제외한다(동명 새 프로젝트가 삭제 폴더를 재사용하지 않게).
      const hasActive = await backend.existFile(
        workspacePath(dir, PROJECT_JSON_FILE),
      );
      if (!hasActive) {
        softOnly.push(name);
        continue;
      }
      registerProjectDir(name, dir);
      activeNames.add(name);
      names.push(name);
      folderMap[name] = folder || null;
      // 폴더 조상 경로 파생(a/b/c → a, a/b, a/b/c)
      if (folder) {
        const parts = folder.split('/');
        let acc = '';
        for (const p of parts) {
          acc = acc ? acc + '/' + p : p;
          folderSet.add(acc);
        }
      }
    }

    // 소프트 삭제로만 존재하는 이름은 레지스트리에서 내린다 — 단, 같은 이름의
    // 활성 프로젝트(다른 물리 폴더)가 있으면 그 등록을 지우지 않는다.
    for (const name of softOnly) {
      if (!activeNames.has(name)) unregisterProjectDir(name);
    }

    // 빈 폴더(프로젝트 0개)는 meta.folder 에 나타나지 않으므로 folderOrder.json 을
    // 진실 원천으로 병합한다 — 신 배치에서 빈 폴더 생존의 단일 출처(§A-4).
    for (const f of this.folderOrderKnown()) folderSet.add(f);

    return { names, folderMap, folderList: Array.from(folderSet) };
  }

  // folderOrder.json 에 기록된 폴더명(빈 폴더 포함) — scanResources 병합용.
  private folderOrderKnown(): string[] {
    return this.folderOrder.slice();
  }

  async loadFavorites() {
    this.metaLoadFailed.delete('favorites.json');
    if (!(await backend.existFile('favorites.json'))) {
      // 기존 projects/favorites.json에서 마이그레이션 시도
      if (await backend.existFile('projects/favorites.json')) {
        try {
          const oldStr = await backend.readFile('projects/favorites.json');
          const arr = JSON.parse(oldStr);
          this.favorites = new Set(Array.isArray(arr) ? arr : []);
          await this.saveFavorites();
          await backend.renameFile('projects/favorites.json', 'projects/favorites.json.migrated');
          return;
        } catch (e) {}
      }
      this.favorites = new Set();
      return;
    }
    try {
      const str = await backend.readFile('favorites.json');
      const arr = JSON.parse(str);
      this.favorites = new Set(Array.isArray(arr) ? arr : []);
    } catch (e) {
      this.favorites = new Set();
      this.markMetaLoadError('favorites.json', e);
    }
  }

  async saveFavorites() {
    if (this.metaSaveBlocked('favorites.json')) return;
    await persistService.write('favorites.json', JSON.stringify([...this.favorites]));
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

  // ===== 폴더 API (중첩 폴더 지원, 실제 디렉토리) =====

  private folderDirPath(folder: string): string {
    return projectFolderPath(folder);
  }

  // 폴더 경로에서 마지막 세그먼트만 추출 (표시용)
  folderLeafName(path: string): string {
    if (typeof path !== 'string') return '';
    const parts = path.split('/');
    return parts[parts.length - 1];
  }

  // 부모 폴더 경로 반환 (없으면 null)
  folderParentPath(path: string): string | null {
    if (typeof path !== 'string') return null;
    const idx = path.lastIndexOf('/');
    return idx >= 0 ? path.substring(0, idx) : null;
  }

  // 특정 폴더의 직계 자식 폴더 목록
  getChildFolders(parentPath: string): string[] {
    if (!parentPath) {
      // 루트: / 가 없는 폴더들
      return this.folderList.filter((f) => !f.includes('/'));
    }
    const prefix = parentPath + '/';
    return this.folderList.filter(
      (f) => f.startsWith(prefix) && f.indexOf('/', prefix.length) === -1,
    );
  }

  // 폴더와 그 하위에 속한 프로젝트 목록
  getProjectsInFolder(folder: string): string[] {
    return Object.keys(this.folderMap).filter((n) => {
      const f = this.folderMap[n];
      return f === folder || (f !== null && f.startsWith(folder + '/'));
    });
  }

  // 중첩 폴더를 포함한 하위 폴더 목록
  private getDescendantFolders(folder: string): string[] {
    const prefix = folder + '/';
    return this.folderList.filter(
      (f) => f === folder || f.startsWith(prefix),
    );
  }

  async createFolder(folder: string): Promise<void> {
    if (typeof folder !== 'string') throw new Error('올바른 폴더 이름을 입력하세요.');
    folder = folder.trim();
    if (!folder || folder.startsWith('.')) {
      throw new Error('올바른 폴더 이름을 입력하세요.');
    }
    // 각 세그먼트 검증
    const segments = folder.split('/');
    for (const seg of segments) {
      if (!seg || seg.startsWith('.')) {
        throw new Error('폴더 이름은 .으로 시작할 수 없습니다: ' + seg);
      }
    }
    if (this.folderList.includes(folder)) {
      throw new Error('이미 존재하는 폴더입니다.');
    }
    if (this.resourceList.includes(segments[segments.length - 1])) {
      throw new Error('같은 이름의 프로젝트가 있어 폴더를 만들 수 없습니다.');
    }
    // 신 배치엔 폴더 디렉터리가 없다 — folderOrder.json 을 빈 폴더의 진실 원천으로
    // 사용한다(scanResources 가 folderList 에 병합). 조상 경로도 함께 기록. §A-4.
    if (isWorkspaceLayout()) {
      const toAdd: string[] = [];
      let cur: string | null = folder;
      while (cur) {
        if (!this.folderOrder.includes(cur) && !this.folderList.includes(cur)) {
          toAdd.unshift(cur);
        }
        cur = this.folderParentPath(cur);
      }
      for (const f of toAdd) {
        if (!this.folderOrder.includes(f)) this.folderOrder.push(f);
      }
      await this.saveFolderOrder();
      await this.update();
      return;
    }
    // 부모 폴더가 존재하는지 확인 (루트가 아닌 경우)
    const parent = this.folderParentPath(folder);
    if (parent !== null) {
      // 부모 폴더 경로를 따라가며 없는 중간 폴더는 자동 생성
      const ancestors: string[] = [];
      let cur: string | null = parent;
      while (cur) {
        if (!this.folderList.includes(cur)) {
          ancestors.unshift(cur);
        }
        cur = this.folderParentPath(cur);
      }
      for (const anc of ancestors) {
        await backend.writeFile(this.folderDirPath(anc) + '/.keep', '');
      }
    }
    await backend.writeFile(this.folderDirPath(folder) + '/.keep', '');
    await this.update();
  }

  async renameFolder(oldName: string, newName: string): Promise<void> {
    newName = newName.trim();
    if (!newName || newName.startsWith('.')) {
      throw new Error('올바른 폴더 이름을 입력하세요.');
    }
    if (!this.folderList.includes(oldName)) {
      throw new Error('폴더를 찾을 수 없습니다.');
    }
    if (oldName === newName) return;

    // 새 경로가 기존 폴더와 충돌하는지 확인
    if (this.folderList.includes(newName)) {
      throw new Error('이미 존재하는 폴더입니다.');
    }
    if (this.resourceList.includes(this.folderLeafName(newName))) {
      throw new Error('같은 이름의 프로젝트가 있습니다.');
    }

    // 리네임 범위 결정: oldName이 부모 폴더면 자식들도 경로 변경
    const oldPrefix = oldName + '/';
    const affectedProjects = Object.keys(this.folderMap).filter(
      (n) => {
        const f = this.folderMap[n];
        return f === oldName || (f !== null && f.startsWith(oldPrefix));
      },
    );
    const affectedFolders = this.folderList.filter(
      (f) => f === oldName || f.startsWith(oldPrefix),
    );

    if (isWorkspaceLayout()) {
      // 신 배치: 물리 폴더 이동 없음 — 영향 프로젝트의 meta.folder + folderMap 갱신.
      for (const [name, f] of Object.entries(this.folderMap)) {
        let nf: string | null = null;
        if (f === oldName) nf = newName;
        else if (f !== null && f.startsWith(oldPrefix))
          nf = newName + f.substring(oldName.length);
        if (nf !== null) {
          await this.updateWorkspaceMeta(name, { folder: nf });
          this.folderMap[name] = nf;
        }
      }
    } else {
      await this.withLock(affectedProjects, async () => {
        // busy 전환 전에 큐에 들어간 각 프로젝트 파일의 잔여 쓰기를 먼저 소진
        // (디렉터리 이동 뒤에 옛 경로로 파일이 되살아나는 것을 방지)
        for (const n of affectedProjects) {
          await persistService.flushPath(this.getPath(n)).catch(() => {});
        }
        await backend.renameDir(
          this.folderDirPath(oldName),
          this.folderDirPath(newName),
        );
        // 폴더맵 즉시 반영: oldName → newName, oldName/child → newName/child
        for (const [name, f] of Object.entries(this.folderMap)) {
          if (f === oldName) {
            this.folderMap[name] = newName;
          } else if (f !== null && f.startsWith(oldPrefix)) {
            this.folderMap[name] = newName + f.substring(oldName.length);
          }
        }
      });
    }

    // 폴더 색상 마이그레이션
    for (const f of affectedFolders) {
      const newKey = newName + f.substring(oldName.length);
      if (this.folderColors[f]) {
        this.folderColors[newKey] = this.folderColors[f];
        delete this.folderColors[f];
      }
    }
    await this.saveFolderColors();

    // 폴더 순서 마이그레이션
    for (let i = 0; i < this.folderOrder.length; i++) {
      const f = this.folderOrder[i];
      if (f === oldName) {
        this.folderOrder[i] = newName;
      } else if (f.startsWith(oldPrefix)) {
        this.folderOrder[i] = newName + f.substring(oldName.length);
      }
    }
    await this.saveFolderOrder();

    // 폴더 기본 템플릿 키 마이그레이션 (프로젝트 상속 안 A — 캐스케이드 편승)
    await templateService.renameFolder(oldName, newName);

    await this.update();
  }

  // 비파괴적 삭제: 안의 프로젝트는 루트(미분류)로 옮기고 폴더만 제거한다.
  // 하위 폴더가 있으면 먼저 자식 폴더들을 삭제한다.
  async deleteFolder(folder: string): Promise<void> {
    if (!this.folderList.includes(folder)) {
      throw new Error('폴더를 찾을 수 없습니다.');
    }
    // 하위 폴더 먼저 삭제 (깊은 순서로)
    const descendants = this.getDescendantFolders(folder)
      .filter((f) => f !== folder)
      .sort((a, b) => b.split('/').length - a.split('/').length);
    for (const child of descendants) {
      await this.deleteFolder(child);
    }
    // 해당 폴더 및 하위 폴더에 있는 프로젝트를 루트로
    const projectsInFolder = Object.keys(this.folderMap).filter(
      (n) => {
        const f = this.folderMap[n];
        return f === folder || (f !== null && f.startsWith(folder + '/'));
      },
    );
    for (const name of projectsInFolder) {
      await this.moveToFolder(name, null);
    }
    // 신 배치엔 폴더 디렉터리가 없다 — 물리 삭제는 건너뛰고 사이드카(색상/순서)만 정리.
    if (!isWorkspaceLayout()) {
      await backend.deleteDir(this.folderDirPath(folder));
    }
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
    // 폴더 기본 템플릿 지정 정리 (프로젝트 상속 안 A — 캐스케이드 편승)
    await templateService.removeFolder(folder);
    await this.update();
  }

  // 프로젝트를 폴더로 이동 (null = 루트/미분류). 실제 .json 파일을 옮긴다.
  async moveToFolder(name: string, targetFolder: string | null): Promise<void> {
    const current = this.folderMap[name] ?? null;
    if (current === targetFolder) return;
    if (targetFolder !== null) {
      if (!this.folderList.includes(targetFolder)) {
        throw new Error('대상 폴더가 없습니다.');
      }
    }
    // 신 배치: 폴더는 meta.json 의 논리 필드 — 물리 이동 없이 필드+맵만 갱신.
    if (isWorkspaceLayout()) {
      await this.updateWorkspaceMeta(name, { folder: targetFolder ?? '' });
      this.folderMap[name] = targetFolder;
      await this.update();
      return;
    }
    const srcPath = this.getPath(name);
    await this.withLock([name], async () => {
      // busy 전환 전에 큐에 들어간 옛 경로 쓰기를 먼저 소진
      await persistService.flushPath(srcPath).catch(() => {});
      const destPath = targetFolder
        ? this.resourceDir + '/' + targetFolder + '/' + name + '.json'
        : this.resourceDir + '/' + name + '.json';
      await backend.renameFile(srcPath, destPath);
      this.folderMap[name] = targetFolder;
    });
    await this.update();
  }

  // ===== 폴더 복제 (재귀적: 하위 폴더/프로젝트 모두 복제) =====
  async cloneFolder(sourceFolder: string, targetFolder: string, withImages: boolean = false): Promise<void> {
    if (!this.folderList.includes(sourceFolder)) {
      throw new Error('원본 폴더를 찾을 수 없습니다.');
    }
    targetFolder = targetFolder.trim();
    if (!targetFolder || targetFolder.startsWith('.')) {
      throw new Error('올바른 폴더 이름을 입력하세요.');
    }
    if (this.folderList.includes(targetFolder)) {
      throw new Error('이미 존재하는 폴더입니다.');
    }

    // 재귀적으로 모든 프로젝트 수집 (하위 폴더 포함)
    const projectNames = this.getProjectsInFolder(sourceFolder);
    if (projectNames.length === 0) {
      throw new Error('원본 폴더에 복제할 프로젝트가 없습니다.');
    }

    // 하위 폴더 구조 파악 및 대상에 미리 생성
    const subFolders = new Set<string>();
    for (const name of projectNames) {
      const f = this.folderMap[name];
      if (f && f !== sourceFolder && f.startsWith(sourceFolder + '/')) {
        subFolders.add(f);
      }
    }
    // 상위부터 정렬해 createFolder가 부모→자식 순으로 생성되도록
    const sortedSubFolders = Array.from(subFolders).sort();

    // 대상 루트 폴더 생성
    await this.createFolder(targetFolder);

    // 하위 폴더 생성 (경로 치환)
    for (const sub of sortedSubFolders) {
      const rel = sub.substring(sourceFolder.length + 1);
      const targetSub = targetFolder + '/' + rel;
      if (!this.folderList.includes(targetSub)) {
        try { await this.createFolder(targetSub); } catch (e) {}
      }
    }

    let cloned = 0;
    let totalImages = 0;
    for (const origName of projectNames) {
      const session = await this.get(origName);
      if (!session) continue;

      const existing = this.list();
      let newName = origName;
      if (existing.includes(newName)) {
        let i = 2;
        while (existing.includes(`${origName} (${i})`)) {
          i++;
        }
        newName = `${origName} (${i})`;
      }

      // 대상 하위 폴더 결정
      const origFolder = this.folderMap[origName];
      const destFolder = origFolder && origFolder !== sourceFolder
        ? targetFolder + origFolder.substring(sourceFolder.length)
        : targetFolder;

      try {
        const proj = await this.exportSessionShallow(session);
        await this.importSessionShallow(proj, newName);
        await this.moveToFolder(newName, destFolder);

        // 이미지 포함 복사 (휴지통 제외). projectPath 경유 — 신 배치 활성 시
        // 원본/대상 모두 각자의 물리 폴더로 분기(대상은 importSessionShallow 가
        // 이미 등록 완료).
        if (withImages) {
          const imgCopyDirs: { src: string; dst: string }[] = [];
          // outs/<project>/<scene>/  +  inpaints/<project>/<scene>/
          for (const dirPrefix of ['outs', 'inpaints'] as const) {
            let sceneDirs: string[];
            try { sceneDirs = await backend.listFiles(projectPath(dirPrefix, origName)); } catch (e) { continue; }
            for (const sd of sceneDirs) {
              if (sd === '.trash' || sd.startsWith('.')) continue;
              imgCopyDirs.push({
                src: projectPath(dirPrefix, origName, sd),
                dst: projectPath(dirPrefix, newName, sd),
              });
            }
          }
          // inpaint_orgs, inpaint_masks, vibes, references
          for (const flatDir of ['inpaint_orgs', 'inpaint_masks', 'vibes', 'references'] as const) {
            let files: string[];
            try { files = await backend.listFiles(projectPath(flatDir, origName)); } catch (e) { continue; }
            for (const f of files) {
              if (f.startsWith('.')) continue;
              try {
                await backend.copyFile(projectPath(flatDir, origName, f), projectPath(flatDir, newName, f));
                totalImages++;
              } catch (e) {}
            }
          }
          // scene/inpaint directories
          for (const { src, dst } of imgCopyDirs) {
            let files: string[];
            try { files = await backend.listFiles(src); } catch (e) { continue; }
            for (const f of files) {
              if (f.startsWith('.')) continue;
              try {
                await backend.copyFile(src + '/' + f, dst + '/' + f);
                totalImages++;
              } catch (e) {}
            }
          }
        }

        cloned++;
      } catch (e) {
        console.error('폴더 복제 중 프로젝트 실패:', origName, e);
      }
    }

    if (cloned === 0) {
      try { await this.deleteFolder(targetFolder); } catch (e) {}
      throw new Error('복제할 수 있는 프로젝트가 없습니다.');
    }

    const imgMsg = withImages ? ` (이미지 ${totalImages}장 포함)` : '';
    return; // 결과 메시지는 호출부에서 pushMessage
  }

  // ===== 폴더 색상 (사이드카: folderColors.json) =====
  // 폴더 이름 → 색상(hex 문자열). 미지정 폴더는 undefined.
  private folderColors: Record<string, string> = {};

  async loadFolderColors() {
    this.metaLoadFailed.delete('folderColors.json');
    if (!(await backend.existFile('folderColors.json'))) {
      this.folderColors = {};
      return;
    }
    try {
      const str = await backend.readFile('folderColors.json');
      this.folderColors = JSON.parse(str) || {};
    } catch (e) {
      this.folderColors = {};
      this.markMetaLoadError('folderColors.json', e);
    }
  }

  async saveFolderColors() {
    if (this.metaSaveBlocked('folderColors.json')) return;
    await persistService.write(
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
    this.metaLoadFailed.delete('folderOrder.json');
    if (!(await backend.existFile('folderOrder.json'))) {
      this.folderOrder = [];
      return;
    }
    try {
      const str = await backend.readFile('folderOrder.json');
      this.folderOrder = JSON.parse(str) || [];
    } catch (e) {
      this.folderOrder = [];
      this.markMetaLoadError('folderOrder.json', e);
    }
  }

  async saveFolderOrder() {
    if (this.metaSaveBlocked('folderOrder.json')) return;
    await persistService.write(
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
    this.metaLoadFailed.delete('bookmarks.json');
    if (!(await backend.existFile('bookmarks.json'))) {
      this.bookmarkData = { scenes: {}, images: {} };
      return;
    }
    try {
      const str = await backend.readFile('bookmarks.json');
      const data = JSON.parse(str);
      this.bookmarkData = {
        scenes: data?.scenes || {},
        images: data?.images || {},
      };
    } catch (e) {
      this.bookmarkData = { scenes: {}, images: {} };
      this.markMetaLoadError('bookmarks.json', e);
    }
  }

  async saveBookmarks() {
    if (this.metaSaveBlocked('bookmarks.json')) return;
    await persistService.write('bookmarks.json', JSON.stringify(this.bookmarkData));
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
    this.metaLoadFailed.delete('thumbnails.json');
    if (!(await backend.existFile('thumbnails.json'))) {
      this.thumbnailData = {};
      return;
    }
    try {
      const str = await backend.readFile('thumbnails.json');
      this.thumbnailData = JSON.parse(str) || {};
    } catch (e) {
      this.thumbnailData = {};
      this.markMetaLoadError('thumbnails.json', e);
    }
  }

  async saveThumbnails() {
    if (this.metaSaveBlocked('thumbnails.json')) return;
    await persistService.write(
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
      const files = await backend.listFiles(projectPath('outs', project, sceneName));
      return (files || []).find(isOutputImageFile);
    } catch (e) {
      return undefined;
    }
  }

  // 캐시 미스 시 1회 해석. 로드된 세션이면 인메모리 정보를, 아니면 원본 JSON을
  // 직접 읽어(메모리에 상주시키지 않음) 첫 씬의 대표/첫 이미지를 찾는다.
  async resolveThumbnail(
    name: string,
  ): Promise<{ scene: string; image: string } | undefined> {
    const loaded = this.getLoaded(name);
    if (loaded) {
      const scenes = Array.from(loaded.scenes.values());
      if (!scenes.length) return undefined;
      const scene = scenes[0];
      if (scene.mains && scene.mains.length) {
        return { scene: scene.name, image: scene.mains[0] };
      }
      const images = imageService.getOutputs(loaded, scene);
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
    for (const name of this.loadedNames()) {
      try {
        const ref = await this.resolveThumbnail(name);
        if (ref) this.thumbnailData[name] = ref;
      } catch (e) {}
    }
  }

  async init() {
    // 사전 로드(즐겨찾기/북마크/휴지통 등)가 어떤 이유로 실패하더라도
    // super.init()(초기 스캔 + 백그라운드 진입 시 강제 저장 훅)에는
    // 반드시 도달해야 한다. 여기서 죽으면 앱은 멀쩡해 보여도 이후 편집이
    // 디스크에 저장되지 않아 통째로 유실된다.
    try {
      await this.loadFavorites();
      await this.loadBookmarks();
      await this.loadThumbnails();
      await this.loadFolderColors();
      await this.loadFolderOrder();
      await trashService.loadTrash();

      // 만료 프로젝트 감지 → UI 다이얼로그에 전달 (가볍게 체크만)
      const expired = await trashService.getExpiredProjects();
      if (expired.length > 0) {
        getAppState().pendingExpiredProjects = expired;
      }

      // autoCleanup은 앱 시작을 블로킹하지 않도록 지연 실행
      setTimeout(() => {
        trashService.autoCleanup().catch((e) => {
          console.error('휴지통 자동 정리 실패:', e);
        });
      }, 10000);
    } catch (e) {
      console.error('세션 서비스 사전 로드 실패(초기화는 계속 진행):', e);
    }

    await super.init();
  }

  async delete(name: string) {
    // 같은 이름의 기존 휴지통 항목을 먼저 정리 (동명 프로젝트 재삭제 시 충돌/덮어쓰기 방지).
    // 이렇게 해야 super.delete 의 .json → .deleted rename 대상이 비어 있어 플랫폼 무관하게 안전.
    await trashService.purgeDeletedProject(name);
    // 실제 삭제(파일 rename)를 먼저 수행 — 여기서 실패하면 프로젝트가 남으므로
    // 즐겨찾기/북마크/썸네일 등 메타데이터도 건드리지 않고 그대로 보존한다.
    await super.delete(name);
    // 신 배치: 소프트 삭제(project.json→project.json.deleted)로 물리 폴더는
    // 남지만, 레지스트리에서는 내려 동명 새 프로젝트가 삭제 폴더를 재사용하지
    // 않게 한다(복원 시 TrashService 가 다시 등록). 스펙 §A-4.
    if (isWorkspaceLayout()) {
      unregisterProjectDir(name);
    }
    // 이하 메타데이터 정리 (프로젝트는 이미 삭제 완료)
    this.favorites.delete(name);
    await this.saveFavorites();
    // 썸네일 캐시 정리
    this.clearThumbnailRef(name);
    // 북마크 정리 (hadSceneBookmarks: 삭제 전에 존재 여부를 기억해야 저장 조건이 맞음)
    const hadSceneBookmarks = !!this.bookmarkData.scenes[name];
    delete this.bookmarkData.scenes[name];
    const keysToDelete = Object.keys(this.bookmarkData.images).filter(k => k.startsWith(name + ':'));
    keysToDelete.forEach(k => delete this.bookmarkData.images[k]);
    if (keysToDelete.length > 0 || hadSceneBookmarks) {
      await this.saveBookmarks();
    }
    // 휴지통에 삭제 시점 기록
    await trashService.moveProjectToTrash(name);
  }

  // 프로젝트 이름변경의 단일 관문 — 이미지 6루트 이동 → 세션 json·메타 이관.
  // 과거에는 호출부(BackupService·ProjectDrawer)가 onRenameSession 을 각자 선행
  // 호출해야 했고, 빼먹으면 이미지 루트가 통째로 고아가 됐다(트랙1 조사 §1-2).
  // 이제 이름변경은 반드시 이 메서드만 사용할 것.
  async renameProject(oldName: string, newName: string): Promise<void> {
    // 신 배치: 물리 폴더는 불변(정제이름__id) — 이미지 6루트 이동도 json rename 도
    // 없다. meta.json name 갱신 + 레지스트리 키 이관 + 사이드카 키 이관 + 메모리
    // 갱신뿐. onRenameSession(이미지 이동)은 호출하지 않는다. 스펙 §A-4.
    if (isWorkspaceLayout()) {
      await this.renameProjectWorkspace(oldName, newName);
      return;
    }
    // 1) 이미지 루트 이동 — 실패 시 내부에서 롤백 후 throw (원 상태 보존)
    await imageService.onRenameSession(oldName, newName);
    // 2) 세션 json + 메타 이관 — 실패 시 이미지 루트를 되돌려 갈라짐 방지
    try {
      await this.rename(oldName, newName);
    } catch (e) {
      try {
        await imageService.onRenameSession(newName, oldName);
      } catch (e2) {
        console.error(
          '이름변경 역롤백 실패 — 이미지가 새 이름에 남아 있을 수 있음:',
          oldName, newName, e2,
        );
      }
      throw e;
    }
  }

  // 신 배치 이름변경: 물리 이동 없음. meta.json name 갱신 + 레지스트리 키 이관 +
  // 메모리(entries/folderMap/reaction/세션 name) 갱신 + 사이드카 키 이관.
  // json 파일은 workspace/<dir>/project.json 그대로(물리 폴더 불변) — 경로가
  // 바뀌지 않으므로 flushPath/파일 rename 이 불필요하다.
  private async renameProjectWorkspace(
    oldName: string,
    newName: string,
  ): Promise<void> {
    const e = this.entries.get(oldName);
    if (!e?.instance) throw new Error('Resource not found');
    if (this.entries.get(newName)?.instance)
      throw new Error('Resource already exists');
    if (physicalDirOf(oldName) === undefined) {
      throw new Error(
        `신 배치 이름변경 대상 미등록: ${JSON.stringify(oldName)}`,
      );
    }
    await this.withLock([oldName, newName], async () => {
      // meta.json name 갱신(폴더는 유지). 실패 시 여기서 throw → 아래 메모리 갱신
      // 미실행으로 원 상태 보존.
      await this.updateWorkspaceMeta(oldName, { name: newName });
      renameProjectDirKey(oldName, newName);
      // 메모리 이동 (base rename 의 파일 rename 제외판)
      this.entries.delete(oldName);
      this.entries.set(newName, e);
      e.instance!.name = newName;
      e.dispose?.();
      e.dispose = this.watch(newName, e.instance!);
      if (oldName in this.folderMap) {
        this.folderMap[newName] = this.folderMap[oldName];
        delete this.folderMap[oldName];
      }
    });
    await this.migrateRenameSidecars(oldName, newName);
    await this.update();
  }

  async rename(oldName: string, newName: string) {
    // 실제 이름변경(파일 rename)을 먼저 수행 — 여기서 실패하면 이름이 그대로이므로
    // 즐겨찾기/북마크/썸네일 등 메타데이터도 건드리지 않고 그대로 보존한다.
    await super.rename(oldName, newName);
    await this.migrateRenameSidecars(oldName, newName);
  }

  // 이름변경 시 사이드카(즐겨찾기·썸네일·북마크·휴지통·용량·템플릿) 키 이관.
  // 구/신 배치 공통 — 사이드카는 논리 이름(키) 기준이라 배치와 무관하다.
  private async migrateRenameSidecars(oldName: string, newName: string) {
    // 이하 메타데이터 마이그레이션 (이름변경은 이미 완료)
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
    // 휴지통 씬 키('<이름>:<씬>')·프로젝트 항목 이관 — 이미지 디렉터리가 새 이름으로
    // 이동한 뒤이므로 키를 함께 옮기지 않으면 삭제 씬 복원이 영구 불가해진다.
    await trashService.renameProjectKeys(oldName, newName);
    // 용량 캐시 키 이관 (재계산 가능 — 실패해도 무해)
    await projectSizeService.renameProject(oldName, newName);
    // 템플릿 지정 이관 (지정된 프로젝트가 이름을 바꿔도 지정 유지)
    await templateService.renameProject(oldName, newName);
  }

  // 종료 시 빠른 저장: saveAll()은 로드된 세션이 많으면(프로젝트 탐색을 열면
  // 전체가 로드됨) 10~20초가 걸린다. 편집은 사실상 현재 세션에서만 일어나므로
  // dirty(변경 표시)된 것 + 현재 세션만 저장한다. (디바운스로 아직 dirty 표시가
  // 안 된 현재 세션의 마지막 편집분도 현재 세션을 항상 포함해 보존됨)
  async flushOnClose() {
    const names = new Set<string>(this.dirtyNames());
    try {
      const cur = getAppState().curSession?.name;
      if (cur && this.isLoaded(cur)) names.add(cur);
    } catch (e) {}
    await Promise.allSettled(
      [...names].map((name) => this.writeResource(name)),
    );
    // 종료 시 작업한 세션의 자동 썸네일 갱신
    try {
      await this.refreshLoadedThumbnails();
      await this.saveThumbnails();
    } catch (e) {}
  }

  // 같은 앱 실행 중 같은 프로젝트에 손실 경고를 한 번만 띄우기 위한 집합
  #lossGuardWarned = new Set<string>();

  // 저장소 건강 프로브 결과의 짧은 캐시(같은 flush 안에서 중복 listFiles 방지)
  #storageProbe: { at: number; unstable: boolean } | null = null;
  // 불안정 상태 전이 시에만 로깅하기 위한 플래그(로그 스팸 방지)
  #storageUnstableActive = false;

  // 손실 방지 가드(차단 + 자동 백업).
  // 저장하려는 세션이, 디스크의 outs/inpaints 폴더(실제 씬 흔적 — 강제 종료에도
  // 살아남음)에 비해 "이미지가 있는 씬"을 잃어버렸으면, 그 쓰기를 차단하고 기존
  // 파일을 .bak 으로 백업한다. 강제 종료 후 기본(default) 세션이 실제 프로젝트를
  // 덮어쓰는 등의 유실로부터 보호한다.
  // 주의: 정상 삭제/이름변경/병합은 모두 outs 폴더를 .trash 로 옮기거나 함께
  // 이동하므로(아래 점(.) 제외 규칙), 오탐이 발생하지 않는다.
  protected async guardResourceWrite(
    name: string,
    payload: string,
  ): Promise<'ok' | 'skip' | 'skip-keep'> {
    // 서킷 브레이커(토글 ON, 기본): 저장소 접근이 불안정하면 이번 쓰기를 보류한다.
    // 'skip-keep' 은 dirty 를 유지하므로 접근이 회복되면 자동으로 재시도된다.
    try {
      const appState = getAppState();
      if (appState.storageWriteGuard && (await this.checkStorageUnstable())) {
        return 'skip-keep';
      }
    } catch (e) {}

    let json: ISession;
    try {
      json = JSON.parse(payload);
    } catch (e) {
      return 'ok'; // 파싱 불가 시 가드 미적용(정상 저장 방해 안 함)
    }
    const sceneNames = new Set(Object.keys(json.scenes || {}));
    const inpaintNames = new Set(Object.keys(json.inpaints || {}));

    const missing = [
      ...(await this.findScenesWithImagesMissing('outs', name, sceneNames)),
      ...(await this.findScenesWithImagesMissing(
        'inpaints',
        name,
        inpaintNames,
      )),
    ];
    if (missing.length === 0) return 'ok';

    // outs 에 있지만 세션에 없는 이미지 씬 발견. 두 경우를 구분한다:
    //  - "찌꺼기": 세션은 멀쩡한데 안 쓰는 고아 폴더 몇 개 → 차단하면 과잉(앱 사용 막음).
    //  - "붕괴": 세션이 default 수준으로 무너져 디스크의 풀 프로젝트를 덮어쓸 위험
    //           (지킬 씬보다 잃을 씬이 더 많음) → 이때만 차단 + 백업.
    const presentCount = sceneNames.size + inpaintNames.size;
    const isCollapse = missing.length > presentCount;

    // 안내 토스트(프로젝트당 1회): 차단/허용 공통. 복구 기능으로 유도(겁주지 않음).
    if (!this.#lossGuardWarned.has(name)) {
      this.#lossGuardWarned.add(name);
      try {
        getAppState().pushMessage(
          '복구 가능한 이미지가 감지되었습니다. 이미지 복구 기능을 사용해 보세요.',
        );
      } catch (e) {}
    }

    if (!isCollapse) {
      // 찌꺼기 수준 → 차단하지 않고 정상 저장(앱 사용을 막지 않음). 진단 로그만.
      this.addSystemLog(
        'info',
        `"${name}" 세션에 연결되지 않은 이미지 폴더 감지: ${missing.join(', ')} (복구 탭으로 재연결 가능)`,
      );
      return 'ok';
    }

    // 붕괴 의심 → 백업(클로버 방지) 후 차단(드롭). 디스크의 풀 프로젝트 보존.
    console.error(
      `[유실 방지] "${name}" 자동 저장 차단(세션 붕괴 의심): 세션 ${presentCount}개 / 누락 ${missing.length}개`,
      missing,
    );
    // ④ 백업 클로버 방지: 현재 main 이 기존 .bak 보다 "빈약"하면(씬 수가 적으면)
    // 덮어쓰지 않는다. 이미 축소된 main 이 멀쩡한 복구본(.bak)을 덮어쓰는 사고를 막는다.
    try {
      const path = this.getPath(name);
      if (await backend.existFile(path)) {
        const bakPath = path + '.bak';
        const mainCount = this.countResourceScenes(await backend.readFile(path));
        let bakCount = -1;
        if (await backend.existFile(bakPath)) {
          try {
            bakCount = this.countResourceScenes(await backend.readFile(bakPath));
          } catch (e) {}
        }
        if (mainCount >= bakCount) {
          await backend.copyFile(path, bakPath);
        } else {
          this.addSystemLog(
            'warn',
            `"${name}" 기존 백업(.bak)이 더 풍부하여 덮어쓰기를 건너뜀(복구본 보존)`,
          );
        }
      }
    } catch (e) {}

    this.addSystemLog(
      'error',
      `데이터 유실 의심(세션 붕괴) — "${name}" 자동 저장 차단(세션 ${presentCount}개 / 누락: ${missing.join(', ')})`,
    );
    return 'skip';
  }

  // 저장소(프로젝트 디렉터리)가 일시적으로 접근 불가인지 휴리스틱 판단.
  // 메모리엔 프로젝트가 있는데 디스크의 목록을 못 읽거나(throw) 0개면 불안정으로 본다.
  // 같은 flush 사이클 내 중복 listFiles 를 막기 위해 1초간 결과를 캐시한다.
  private async checkStorageUnstable(): Promise<boolean> {
    const now = Date.now();
    let unstable: boolean;
    if (this.#storageProbe && now - this.#storageProbe.at < 1000) {
      unstable = this.#storageProbe.unstable;
    } else {
      const loadedCount = this.loadedNames().length;
      if (loadedCount === 0) {
        unstable = false; // 비교 기준 없음 → 판단 보류(정상 취급)
      } else {
        try {
          // 신 배치 활성 시 진실 디렉터리는 workspace/(projects/ 는 비어 있음).
          const probeDir = isWorkspaceLayout() ? WORKSPACE_ROOT : this.resourceDir;
          const onDisk = await backend.listFiles(probeDir);
          // 메모리엔 프로젝트가 있는데 디스크 목록이 0개 = 접근 이상
          unstable = onDisk.length === 0;
        } catch (e) {
          unstable = true; // 디렉터리 자체를 못 읽음 = 접근 이상
        }
      }
      this.#storageProbe = { at: now, unstable };
    }
    // 상태 전이 시에만 로깅(스팸 방지)
    if (unstable && !this.#storageUnstableActive) {
      this.#storageUnstableActive = true;
      this.addSystemLog(
        'warn',
        '저장소 접근이 불안정하여 자동 저장을 일시정지합니다(접근 회복 시 재개).',
      );
    } else if (!unstable && this.#storageUnstableActive) {
      this.#storageUnstableActive = false;
      this.addSystemLog('info', '저장소 접근이 회복되어 자동 저장을 재개합니다.');
    }
    return unstable;
  }

  // JSON 문자열에서 씬+인페인트 개수를 센다. 파싱 불가(손상)면 -1(가장 빈약하게 취급).
  private countResourceScenes(raw: string): number {
    try {
      const j = JSON.parse(raw);
      return (
        Object.keys(j.scenes || {}).length +
        Object.keys(j.inpaints || {}).length
      );
    } catch (e) {
      return -1;
    }
  }

  // 환경설정의 작업 로그 뷰어에 기록(저장소 관련 진단). 동적 import 로 순환 의존 회피.
  private async addSystemLog(
    level: 'info' | 'warn' | 'error',
    message: string,
  ) {
    try {
      taskQueueService.addLog(level, '저장소', message);
    } catch (e) {}
  }

  // dir(outs|inpaints)/project 의 실제 씬 폴더 중, present 에 없고 이미지(.png)가
  // 있는 폴더 이름들을 반환한다. 점(.)으로 시작하는 항목(.trash 등 삭제/시스템
  // 폴더)은 제외해 정상 삭제로 인한 오탐을 막는다.
  private async findScenesWithImagesMissing(
    dir: 'outs' | 'inpaints',
    project: string,
    present: Set<string>,
  ): Promise<string[]> {
    // projectPath 경유 — 신 배치 활성 시 workspace/<물리폴더>/<dir> 로 자동 분기.
    let entries: string[];
    try {
      entries = await backend.listFiles(projectPath(dir, project));
    } catch (e) {
      return []; // 폴더 없음 = 비교 대상 없음
    }
    const missing: string[] = [];
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      if (present.has(entry)) continue;
      try {
        const files = await backend.listFiles(projectPath(dir, project, entry));
        if (files.some(isOutputImageFile)) missing.push(entry);
      } catch (e) {
        // 폴더가 아니거나 접근 불가 → 보수적으로 무시(오탐 방지)
      }
    }
    return missing;
  }

  async getHook(rc: Session, name: string) {
    rc.name = name;
  }

  async migrate(rc: any) {
    if (!rc.version) {
      // 폴더 소속 프로젝트도 손상 복구(readResourceJSON)가 찾는 위치와 같은
      // 경로(getPath + .bak)에 백업해야 실제 복구에 쓰일 수 있다.
      await backend.writeFile(
        this.getPath(rc.name) + '.bak',
        JSON.stringify(rc),
      );
      rc = await legacy.migrateSession(rc);
    }
    if (Array.isArray(rc.presets)) {
      await legacy.recoverSession(rc);
    }
    await this.migrateSession(rc);
    // 트랙1 (b): 세션 uuid 지연 발급 — 로드/생성(createFrom) 경로가 모두 이 seam 을
    // 통과한다. 없으면 발급하고, 로드 경로는 메모리 반영만(다음 자연 저장 시 기록),
    // createFrom 경로는 뒤이은 markDirty 로 즉시 기록된다. 복제·유래 생성은
    // 호출부에서 json.id 를 지워 여기서 새 uuid 를 받게 한다. 스펙 §5.
    if (!rc.id) {
      rc.id = v4();
    }
    console.log('migrated', rc);
    return rc;
  }

  // 새 프로젝트의 초기 씬 구성(빈 default 씬 1개) — createDefault 와
  // createSessionFromTemplate(씬 리셋)이 공유하는 단일 출처.
  private static defaultScenesJSON() {
    return Object.fromEntries([
      [
        'default',
        {
          type: 'scene' as const,
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
    ]);
  }

  async createDefault(name: string) {
    const newSession = Session.fromJSON({
      name: name,
      version: 1,
      presets: {},
      inpaints: {},
      scenes: SessionService.defaultScenesJSON(),
      library: {},
      presetShareds: {},
    });
    // dummy 는 역직렬화 템플릿(fromJSON 용)으로만 쓰이므로 프리셋 시딩이 불필요.
    // 시딩하면 매 부팅 기본 에셋을 fetch 하고 vibes/dummy/ 에 쓰레기 PNG 가
    // 무한 누적되며 부팅도 느려진다.
    if (name !== 'dummy') {
      // 신 배치: importDefaultPresets 가 vibes 를 projectPath 로 쓰기 전에 물리
      // 폴더를 선등록해야 한다(등록 seam 은 onAttached 이지만 그건 attach 이후 —
      // createDefault 안의 vibe 쓰기보다 늦다). dummy 는 실제 프로젝트가 아니므로 제외.
      if (isWorkspaceLayout()) {
        newSession.id = v4();
        await this.ensureWorkspaceProject(name, {
          id: newSession.id,
          folder: this.folderMap[name] ?? '',
        });
      }
      await importDefaultPresets(newSession);
    }
    return newSession;
  }

  // 프로젝트 템플릿(ProjectTemplateService 엔티티)으로 새 프로젝트를 만든다
  // (프로젝트 상속 v2 — 2026-07-16 합의).
  //
  // 적용: 템플릿의 스타일 프리셋·캐릭터 프리셋(이미지 포함 복사)·씬 구성.
  //       템플릿에 씬이 없으면 빈 default 씬 1개, 스타일 프리셋이 없으면
  //       빈 프로젝트와 동일한 기본 프리셋 시딩(전역 default 포함).
  // 전부 스냅샷 — 생성 후 템플릿을 바꿔도 기존 프로젝트는 영향 없음.
  async createSessionFromProjectTemplate(templateId: string, newName: string) {
    if (this.isLoaded(newName)) {
      throw new Error('Resource already exists');
    }
    await projectTemplateService.ensureLoaded();
    const entry = projectTemplateService.get(templateId);
    if (!entry) {
      throw new Error('템플릿을 찾을 수 없습니다.');
    }
    // 씬 구성: 이름은 템플릿 내에서 이미 유일 (임포트 시 번호 부여)
    const scenes =
      entry.scenes.length > 0
        ? Object.fromEntries(
            entry.scenes.map((s) => [s.name, JSON.parse(JSON.stringify(s))]),
          )
        : SessionService.defaultScenesJSON();
    const json: ISession = {
      name: newName,
      version: 1,
      presets: {},
      inpaints: {},
      scenes: scenes as any,
      library: {},
      presetShareds: {},
      characterPresets: {},
    };
    // 신 배치: 물리 폴더 선등록 (createDefault 와 동일 — 이후 이미지 쓰기가
    // projectPath 를 쓰기 전에 등록돼 있어야 한다).
    if (isWorkspaceLayout()) {
      json.id = v4();
      await this.ensureWorkspaceProject(newName, {
        id: json.id,
        folder: this.folderMap[newName] ?? '',
      });
    }
    try {
      await this.createFrom(newName, json);
      const created = await this.get(newName);
      if (!created) {
        throw new Error('프로젝트 생성에 실패했습니다.');
      }
      // 프리셋/캐릭터 프리셋 인스턴스화 (이미지: 템플릿 디렉터리 → 세션)
      await projectTemplateService.instantiateIntoSession(created, templateId);
      if (entry.presets.length === 0) {
        // 스타일 프리셋 없는 템플릿 → 빈 프로젝트와 동일한 기본 시딩
        await importDefaultPresets(created);
      }
      this.markDirty(newName);
    } catch (e) {
      // 신 배치: 선등록 물리 폴더 통째 정리 + 레지스트리 해제.
      if (isWorkspaceLayout() && !this.isLoaded(newName)) {
        const wdir = physicalDirOf(newName);
        if (wdir !== undefined) {
          try {
            await backend.deleteDir(workspacePath(wdir));
          } catch (e2) {}
          unregisterProjectDir(newName);
        }
      }
      throw e;
    }
  }

  // 기존 프로젝트에 프로젝트 템플릿을 덮어쓴다 (프로젝트 상속 v2 —
  // "스냅샷 + 수동 재적용", 씬 제외 확정).
  //
  // 규칙: 템플릿의 스타일 프리셋·캐릭터 프리셋으로 해당 영역을 교체.
  //       템플릿에서 비어 있는 영역은 건드리지 않는다(실수 방지).
  // 불변: 씬·인페인트·생성 이미지·공통 바이브/레퍼런스·시드·미러 불가침.
  async applyProjectTemplateToSession(templateId: string, targetName: string) {
    await projectTemplateService.ensureLoaded();
    const entry = projectTemplateService.get(templateId);
    if (!entry) {
      throw new Error('템플릿을 찾을 수 없습니다.');
    }
    const target = await this.get(targetName);
    if (!target) {
      throw new Error(`대상 프로젝트를 찾을 수 없습니다: ${targetName}`);
    }
    if (entry.presets.length === 0 && entry.characterPresets.length === 0) {
      throw new Error('이 템플릿에는 적용할 프리셋이 없습니다.');
    }
    if (entry.presets.length > 0) {
      target.presets = new Map();
    }
    if (entry.characterPresets.length > 0) {
      target.characterPresets = new Map();
    }
    await projectTemplateService.instantiateIntoSession(target, templateId);
    // 덮어쓴 목록에 없는 프리셋을 가리키는 선택 상태 정리 (dangling 방지)
    const sw = target.selectedWorkflow;
    if (entry.presets.length > 0 && sw?.presetName) {
      const list = target.presets.get(sw.workflowType) ?? [];
      if (!list.some((p: any) => p?.name === sw.presetName)) {
        sw.presetName = undefined;
      }
    }
    this.markDirty(targetName);
  }

  getInpaintOrgPath(session: Session, inpaint: InpaintScene) {
    return projectPath('inpaint_orgs', session.name, inpaint.name + '.png');
  }

  getInpaintMaskPath(session: Session, inpaint: InpaintScene) {
    return projectPath('inpaint_masks', session.name, inpaint.name + '.png');
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

  // 프로젝트 깊은 백업에 포함할 파일 엔트리 목록을 만든다.
  // prefix를 주면 아카이브 내부 경로 앞에 붙는다 (폴더 백업에서 프로젝트별 네임스페이스용).
  async buildSessionDeepEntries(
    session: Session,
    prefix: string = '',
  ): Promise<FileEntry[]> {
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
        files: await ignoreError(backend.listFiles(projectPath('outs', session.name, name))),
      }))),
      // 인페인트별 이미지 (병렬)
      Promise.all(inpaintNames.map(async (name) => ({
        name,
        files: await ignoreError(backend.listFiles(projectPath('inpaints', session.name, name))),
      }))),
      ignoreError(backend.listFiles(projectPath('inpaint_orgs', session.name))),
      ignoreError(backend.listFiles(projectPath('inpaint_masks', session.name))),
      ignoreError(backend.listFiles(projectPath('vibes', session.name))),
      ignoreError(backend.listFiles(projectPath('references', session.name))),
    ]);

    for (const { name, files } of sceneResults) {
      for (const image of files) {
        if (!isOutputImageFile(image)) continue;
        entries.push({
          path: projectPath('outs', session.name, name, image),
          name: prefix + 'outs/' + name + '/' + image,
        });
      }
    }
    for (const image of inpaintOrgs) {
      if (!image.endsWith('.png')) continue;
      entries.push({
        path: projectPath('inpaint_orgs', session.name, image),
        name: prefix + 'inpaint_orgs/' + image,
      });
    }
    for (const image of inpaintMasks) {
      if (!image.endsWith('.png')) continue;
      entries.push({
        path: projectPath('inpaint_masks', session.name, image),
        name: prefix + 'inpaint_masks/' + image,
      });
    }
    for (const { name, files } of inpaintResults) {
      for (const image of files) {
        if (!isOutputImageFile(image)) continue;
        entries.push({
          path: projectPath('inpaints', session.name, name, image),
          name: prefix + 'inpaints/' + name + '/' + image,
        });
      }
    }
    for (const vibe of vibes) {
      if (!vibe.endsWith('.png')) continue;
      entries.push({
        path: projectPath('vibes', session.name, vibe),
        name: prefix + 'vibes/' + vibe,
      });
    }
    for (const ref of references) {
      if (!ref.endsWith('.png')) continue;
      entries.push({
        path: projectPath('references', session.name, ref),
        name: prefix + 'references/' + ref,
      });
    }
    entries.push({ path: projFile, name: prefix + 'project.json' });
    return entries;
  }

  async exportSessionDeep(session: Session, outPath: string) {
    const entries = await this.buildSessionDeepEntries(session, '');
    if (zipService.isZipping) {
      throw new Error('Already zipping');
    }
    await zipService.zipFiles(entries, outPath);
  }

  async importSessionShallow(session: ISession, name: string) {
    if (this.isLoaded(name)) {
      throw new Error('Resource already exists');
    }
    session.name = name;
    // 유래 생성(복제·씬템플릿·백업 복원·순환) — 원본 id 를 버려 migrate 가 새 uuid 를
    // 발급하게 한다(트랙1 (b): 물리 폴더 유일성). 순수 로드가 아닌 신규 프로젝트 생성.
    delete session.id;
    // 신 배치: vibes 쓰기가 createFrom(→등록) 보다 앞서므로, 복사 시작 전에 물리
    // 폴더를 선등록한다. id 를 확정해 두면 createFrom 의 migrate 가 그대로 유지한다.
    if (isWorkspaceLayout()) {
      session.id = v4();
      await this.ensureWorkspaceProject(name, {
        id: session.id,
        folder: this.folderMap[name] ?? '',
      });
    }
    if (Array.isArray(session.presets)) {
      for (const preset of session.presets) {
        if (preset.type === 'style') {
          try {
            const path = projectPath('vibes', name, v4() + '.png');
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
              const path = projectPath('vibes', name, v4() + '.png');
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
    if (this.isLoaded(name)) {
      throw new Error('Resource already exists');
    }
    const path = 'tmp/' + v4();
    await backend.unzipFiles(tarpath, path);
    try {
      await this.importSessionDeepFromDir(path, name);
    } finally {
      // 복사 방식이므로 성공/실패와 무관하게 임시 추출물을 정리한다.
      try {
        await backend.deleteDir(path);
      } catch (e) {}
    }
  }

  // 이미 추출된 디렉터리(project.json + outs/vibes/... 하위 포함)로부터 프로젝트를 복원한다.
  // 폴더 백업 불러오기에서 한 아카이브를 1회 추출한 뒤 프로젝트별로 재사용한다.
  async importSessionDeepFromDir(dir: string, name: string) {
    if (this.isLoaded(name)) {
      throw new Error('Resource already exists');
    }
    const session: Session = JSON.parse(
      await backend.readFile(dir + '/project.json'),
    );
    session.name = name;
    // 백업 아카이브로부터 새 프로젝트 생성 — 원본 id 를 버려 새 uuid 발급 유도(위와 동일).
    delete (session as any).id;
    // 신 배치: 이미지 복사가 createFrom(→등록) 보다 앞서므로 복사 대상 물리 폴더를
    // 선등록한다(projectPath(r, name) 이 복사 시작 전에 이미 해석되어야 함).
    if (isWorkspaceLayout()) {
      (session as any).id = v4();
      await this.ensureWorkspaceProject(name, {
        id: (session as any).id,
        folder: this.folderMap[name] ?? '',
      });
    }
    // 이동(renameDir) 대신 복사 후 검증: 원본(임시 디렉터리)을 보존하므로 중간에
    // 실패해도 데이터가 흩어지거나 유실되지 않는다(부분 복원 방지).
    const copies = PROJECT_IMAGE_ROOTS.map(
      (r) => [dir + '/' + r, projectPath(r, name)] as const,
    );
    const createdDests: string[] = [];
    try {
      for (const [src, dest] of copies) {
        // 소스 디렉터리가 없으면(해당 타입 이미지 없음) 건너뛴다.
        let exists = true;
        try {
          await backend.listFiles(src);
        } catch (e) {
          exists = false;
        }
        if (!exists) continue;
        // strict=true: 실제 복사 실패 시 예외를 던져 반쪽짜리 임포트를 막는다.
        await this.copyDirRecursive(src, dest, true);
        createdDests.push(dest);
      }
      await this.createFrom(name, session);
    } catch (e) {
      // 부분 실패 롤백: 이번에 만든 대상 이미지 디렉터리를 정리한다.
      // (원본 임시 디렉터리는 호출부가 정리한다)
      for (const dest of createdDests) {
        try {
          await backend.deleteDir(dest);
        } catch (e2) {}
      }
      // 신 배치: 선등록한 물리 폴더(meta.json 포함) 통째 정리 + 레지스트리 해제.
      if (isWorkspaceLayout() && !this.isLoaded(name)) {
        const wdir = physicalDirOf(name);
        if (wdir !== undefined) {
          try {
            await backend.deleteDir(workspacePath(wdir));
          } catch (e2) {}
          unregisterProjectDir(name);
        }
      }
      throw e;
    }
  }

  // 디렉터리를 하위까지 재귀 복사한다. (copyFile + listFiles 재사용, 새 IPC 불필요)
  // 소스가 없으면 조용히 건너뛴다.
  // strict=true 이면 복사 실패 시 예외를 던진다(부분 복원 방지용). 기본은 기존처럼 무시.
  private async copyDirRecursive(
    srcDir: string,
    destDir: string,
    strict = false,
  ) {
    let entries: string[] = [];
    try {
      entries = await backend.listFiles(srcDir);
    } catch (e) {
      if (strict) throw e;
      return;
    }
    if (!entries || entries.length === 0) return;
    // listFiles(파일+디렉토리) vs listFilesWithStats(파일만) → 디렉터리 구분
    let fileStats: any[] = [];
    try {
      fileStats = await backend.listFilesWithStats(srcDir);
    } catch (e) {
      if (strict) throw e;
      fileStats = [];
    }
    const fileSet = new Set(fileStats.map((s: any) => s.name));
    for (const entry of entries) {
      if (fileSet.has(entry)) {
        try {
          await backend.copyFile(srcDir + '/' + entry, destDir + '/' + entry);
        } catch (e) {
          if (strict) throw e;
        }
      } else {
        // 하위 디렉터리 → 재귀
        await this.copyDirRecursive(
          srcDir + '/' + entry,
          destDir + '/' + entry,
          strict,
        );
      }
    }
  }

  // 프로젝트를 이미지 포함하여 앱 내에서 복제한다.
  // (프로젝트 백업 내보내기 → 재임포트와 동일한 결과: JSON + 모든 이미지 디렉터리)
  async duplicateSessionDeep(session: Session, newName: string) {
    if (this.isLoaded(newName)) {
      throw new Error('Resource already exists');
    }
    // 이미지 디렉터리는 이름 기준(outs/<이름> 등)이므로 이름만 바꿔 통째 복사
    // 루트별 복사는 상호 독립이라 순서(PROJECT_IMAGE_ROOTS)는 결과에 영향 없음.
    // 부분 실패 롤백: importSessionDeepFromDir 와 동일하게 만든 대상만 추적해
    // 정리한다 — 과거에는 롤백이 없어 반쪽 복사본(고아 이미지)이 남았다(트랙1 B4).
    // 신 배치: 복사 대상(dest = projectPath(dir, newName)) 이 복사 시작 전에
    // 해석되어야 하므로 물리 폴더를 선등록한다. 폴더 매핑도 meta 와 일치시켜 반영.
    const dupFolder = this.getFolderOf(session.name) || '';
    let dupPreId: string | undefined;
    if (isWorkspaceLayout()) {
      dupPreId = v4();
      if (dupFolder) this.folderMap[newName] = dupFolder;
      await this.ensureWorkspaceProject(newName, {
        id: dupPreId,
        folder: dupFolder,
      });
    }
    const createdDests: string[] = [];
    try {
      for (const dir of PROJECT_IMAGE_ROOTS) {
        const src = projectPath(dir, session.name);
        // 소스 디렉터리가 없으면(해당 타입 이미지 없음) 건너뛴다.
        let exists = true;
        try {
          await backend.listFiles(src);
        } catch (e) {
          exists = false;
        }
        if (!exists) continue;
        const dest = projectPath(dir, newName);
        // strict=true: 파일 복사 실패를 삼키지 않고 던져 반쪽 복제를 막는다.
        await this.copyDirRecursive(src, dest, true);
        createdDests.push(dest);
      }
      const json = session.toJSON();
      json.name = newName;
      if (isWorkspaceLayout() && dupPreId) {
        json.id = dupPreId; // 선등록 id 유지(migrate 가 그대로 둠)
      } else {
        delete json.id; // 복제본은 새 uuid 발급(트랙1 (b))
        const folder = this.getFolderOf(session.name);
        if (folder) {
          this.folderMap[newName] = folder;
        }
      }
      await this.createFrom(newName, json);
    } catch (e) {
      for (const dest of createdDests) {
        try {
          await backend.deleteDir(dest);
        } catch (e2) {}
      }
      delete this.folderMap[newName]; // 선반영한 폴더 매핑 정리
      // 신 배치: 선등록 물리 폴더 통째 정리 + 레지스트리 해제.
      if (isWorkspaceLayout() && !this.isLoaded(newName)) {
        const wdir = physicalDirOf(newName);
        if (wdir !== undefined) {
          try {
            await backend.deleteDir(workspacePath(wdir));
          } catch (e2) {}
          unregisterProjectDir(newName);
        }
      }
      throw e;
    }
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
  // buffer 폴리필의 Buffer 는 Uint8Array 서브클래스 — 제네릭 표기 차이만 있어 캐스트
  const chunks = extractChunks(inputBuffer as unknown as Uint8Array);

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
    const chunks = extractChunks(buffer as unknown as Uint8Array);
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
  // 폴더 이동(onRenameScene)과 Map 갱신 사이에 주기 flush 가 끼면, 손실 방지 가드가
  // "newName 폴더는 있는데 세션엔 없다"고 오인할 수 있다. 작업 동안 세션을 in-flight 로
  // 표시해 그 사이 자동 저장이 해당 세션을 건너뛰게 한다.
  await sessionService.withLock([session.name], async () => {
    await imageService.onRenameScene(session, oldName, newName);
    const scene = session.scenes.get(oldName)!;
    scene.name = newName;
    // 순서 보존: Map은 삽입 순서를 유지하므로 delete→set 하면 새 이름이 맨 뒤로 밀린다.
    // 기존 키 자리에 새 이름을 끼워 Map을 재구성해 원래 위치를 지킨다(moveScene 재구성 패턴).
    const rebuilt = new Map();
    for (const [key, value] of session.scenes) {
      rebuilt.set(key === oldName ? newName : key, value);
    }
    session.scenes = rebuilt as any;
  });
};

// 씬 병합: sourceName 씬을 기존 targetName 씬으로 합친다.
// - 이미지: source → target 폴더로 이동(파일명 충돌 시 재지정, 손실 없음)
// - 프롬프트/설정: 기존(target) 씬 것을 유지하고 source 씬은 제거한다.
export const mergeScene = async (
  session: Session,
  sourceName: string,
  targetName: string,
) => {
  if (sourceName === targetName) return;
  const target = session.scenes.get(targetName);
  if (!target) return;
  await imageService.mergeSceneImages(session, sourceName, targetName);
  session.scenes.delete(sourceName);
  // 합쳐진 이미지가 target 씬에 즉시 반영되도록 갱신
  await imageService.refresh(session, target);
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
