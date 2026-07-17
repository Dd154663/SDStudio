import { backend, templateService } from '.';
import { persistService } from './PersistenceService';
import { GenericScene, IInpaintScene, IScene, Session, genericSceneFromJSON } from './types';
import { imageService } from '.';
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
  WorkspaceProjectMeta,
  PROJECT_META_FILE,
  PROJECT_JSON_FILE,
} from './storageLayout';

// 신 배치의 소프트 삭제 파일명(project.json.deleted).
const WORKSPACE_DELETED_FILE = PROJECT_JSON_FILE + '.deleted';

// --- Type definitions ---

interface TrashImageMeta {
  [filename: string]: number; // filename -> deletedAt timestamp
}

interface TrashSceneEntry {
  sceneData: IScene | IInpaintScene;
  deletedAt: number;
}

interface TrashProjectEntry {
  deletedAt: number;
}

interface TrashData {
  scenes: { [compositeKey: string]: TrashSceneEntry };
  projects: { [projectName: string]: TrashProjectEntry };
}

// --- Constants ---

const TRASH_FILE = 'trash.json';
const IMAGE_TRASH_DIR = '.trash';
const TRASH_META_FILE = '.trash_meta.json';

const IMAGE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;    // 3 days
const SCENE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;   // 14 days
const PROJECT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days

// --- Service class ---

export class TrashService extends EventTarget {
  private data: TrashData = { scenes: {}, projects: {} };
  private loaded: boolean = false;

  // ===== Core persistence =====

  async loadTrash(): Promise<void> {
    if (!(await backend.existFile(TRASH_FILE))) {
      this.data = { scenes: {}, projects: {} };
      this.loaded = true;
      return;
    }
    try {
      const str = await backend.readFile(TRASH_FILE);
      const parsed = JSON.parse(str);
      this.data = {
        scenes: parsed.scenes || {},
        projects: parsed.projects || {},
      };
    } catch (e) {
      this.data = { scenes: {}, projects: {} };
      if (!(e instanceof SyntaxError)) {
        // IO 오류(저장소 권한 등): loaded 를 세우지 않는다 → ensureLoaded 가
        // 모든 휴지통 경유 작업(씬 삭제 포함)을 명확한 오류로 차단.
        // 빈 데이터로 saveTrash 하면 기존 휴지통 기록이 통째로 사라지고,
        // 기록 없이 씬을 삭제하면 복원이 불가능해지기 때문이다.
        console.error('trash.json 로드 실패(IO) — 휴지통 동작 차단:', e);
        return;
      }
    }
    this.loaded = true;
  }

  async saveTrash(): Promise<void> {
    await persistService.write(TRASH_FILE, JSON.stringify(this.data));
    this.dispatchEvent(new CustomEvent('trash-updated'));
    // 전역 저장소 동기화(W6 P2): 다른 창들이 휴지통을 재로드하도록 알림
    backend.notifyGlobalStoreChanged('trash').catch(() => {});
  }

  // 다른 창의 휴지통 변경 반영(W6 P2) — 디스크 재로드 + UI 갱신 이벤트.
  // loadTrash 의 IO 실패 차단 의미론(loaded 미설정)은 그대로 유지된다.
  async reloadExternal(): Promise<void> {
    await this.loadTrash();
    this.dispatchEvent(new CustomEvent('trash-updated'));
  }

  private ensureLoaded() {
    if (!this.loaded) throw new Error('TrashService not loaded');
  }

  // ===== Image trash =====

  private getImageTrashDir(session: Session, scene: GenericScene): string {
    const base = scene.type === 'scene'
      ? projectPath('outs', session.name, scene.name)
      : projectPath('inpaints', session.name, scene.name);
    return base + '/' + IMAGE_TRASH_DIR;
  }

  private getImageTrashMetaPath(session: Session, scene: GenericScene): string {
    return this.getImageTrashDir(session, scene) + '/' + TRASH_META_FILE;
  }

  private async loadImageTrashMeta(session: Session, scene: GenericScene): Promise<TrashImageMeta> {
    try {
      const str = await backend.readFile(this.getImageTrashMetaPath(session, scene));
      return JSON.parse(str);
    } catch (e) {
      return {};
    }
  }

  private async saveImageTrashMeta(session: Session, scene: GenericScene, meta: TrashImageMeta): Promise<void> {
    // writeFile auto-creates parent directories
    await persistService.write(this.getImageTrashMetaPath(session, scene), JSON.stringify(meta));
  }

  async moveImagesToTrash(session: Session, scene: GenericScene, fullPaths: string[]): Promise<void> {
    const trashDir = this.getImageTrashDir(session, scene);
    const meta = await this.loadImageTrashMeta(session, scene);
    const now = Date.now();

    // Ensure .trash directory exists by writing meta first
    // (writeFile auto-creates parent dirs)
    if (Object.keys(meta).length === 0 && fullPaths.length > 0) {
      await this.saveImageTrashMeta(session, scene, meta);
    }

    for (const fullPath of fullPaths) {
      const filename = fullPath.split('/').pop()!;
      try {
        await backend.renameFile(fullPath, trashDir + '/' + filename);
        meta[filename] = now;
      } catch (e) {
        console.error('이미지 휴지통 이동 실패:', fullPath, e);
      }
    }

    await this.saveImageTrashMeta(session, scene, meta);
    this.dispatchEvent(new CustomEvent('trash-updated'));
  }

  async getTrashImages(session: Session, scene: GenericScene): Promise<{filename: string, deletedAt: number}[]> {
    const meta = await this.loadImageTrashMeta(session, scene);
    const trashDir = this.getImageTrashDir(session, scene);
    let files: string[];
    try {
      files = await backend.listFiles(trashDir);
    } catch (e) {
      return [];
    }
    files = files.filter(isOutputImageFile);
    return files.map((f: string) => ({
      filename: f,
      deletedAt: meta[f] || 0,
    }));
  }

  getTrashImagePath(session: Session, scene: GenericScene, filename: string): string {
    return this.getImageTrashDir(session, scene) + '/' + filename;
  }

  async restoreImages(session: Session, scene: GenericScene, filenames: string[]): Promise<void> {
    const trashDir = this.getImageTrashDir(session, scene);
    const outputDir = scene.type === 'scene'
      ? projectPath('outs', session.name, scene.name)
      : projectPath('inpaints', session.name, scene.name);
    const meta = await this.loadImageTrashMeta(session, scene);

    for (const filename of filenames) {
      try {
        await backend.renameFile(trashDir + '/' + filename, outputDir + '/' + filename);
        delete meta[filename];
      } catch (e) {
        console.error('이미지 복원 실패:', filename, e);
      }
    }

    await this.saveImageTrashMeta(session, scene, meta);
    this.dispatchEvent(new CustomEvent('trash-updated'));
  }

  async permanentlyDeleteImages(session: Session, scene: GenericScene, filenames: string[]): Promise<void> {
    const trashDir = this.getImageTrashDir(session, scene);
    const meta = await this.loadImageTrashMeta(session, scene);

    for (const filename of filenames) {
      try {
        await backend.deleteFile(trashDir + '/' + filename);
      } catch (e) {
        console.error('이미지 영구 삭제 실패:', filename, e);
      }
      delete meta[filename];
    }

    await this.saveImageTrashMeta(session, scene, meta);
    this.dispatchEvent(new CustomEvent('trash-updated'));
  }

  async emptyImageTrash(session: Session, scene: GenericScene): Promise<void> {
    const items = await this.getTrashImages(session, scene);
    if (items.length > 0) {
      await this.permanentlyDeleteImages(session, scene, items.map(i => i.filename));
    }
  }

  // ===== Project-wide image trash (all active scenes) =====

  /**
   * 현재 프로젝트(세션)의 모든 활성 씬에 대해 이미지 휴지통 집계
   * 휴지통에 들어간 씬의 이미지는 포함하지 않음 (activeScenes만 순회)
   */
  async countProjectImageTrash(
    session: Session,
  ): Promise<{ totalImages: number; scenesWithTrash: number }> {
    let totalImages = 0;
    let scenesWithTrash = 0;
    const allScenes: GenericScene[] = [
      ...session.getScenes('scene'),
      ...session.getScenes('inpaint'),
    ];
    for (const scene of allScenes) {
      const items = await this.getTrashImages(session, scene);
      if (items.length > 0) {
        totalImages += items.length;
        scenesWithTrash += 1;
      }
    }
    return { totalImages, scenesWithTrash };
  }

  /**
   * 현재 프로젝트(세션)의 모든 활성 씬에 대해 이미지 휴지통을 영구 비움
   * 반환값: 영구삭제된 이미지 총개수
   */
  async emptyProjectImageTrash(session: Session): Promise<number> {
    let total = 0;
    const allScenes: GenericScene[] = [
      ...session.getScenes('scene'),
      ...session.getScenes('inpaint'),
    ];
    for (const scene of allScenes) {
      const items = await this.getTrashImages(session, scene);
      if (items.length > 0) {
        await this.permanentlyDeleteImages(
          session,
          scene,
          items.map((i) => i.filename),
        );
        total += items.length;
      }
    }
    return total;
  }

  // ===== Scene trash =====

  private sceneKey(projectName: string, sceneName: string): string {
    return projectName + ':' + sceneName;
  }

  async moveSceneToTrash(session: Session, scene: GenericScene): Promise<void> {
    this.ensureLoaded();
    const key = this.sceneKey(session.name, scene.name);
    const now = Date.now();

    // Store scene data in trash.json
    this.data.scenes[key] = {
      sceneData: scene.toJSON() as IScene | IInpaintScene,
      deletedAt: now,
    };

    // Move scene output directory to .trash/ (projectPath 경유 — 신 배치 자동 분기)
    const imgDir: 'outs' | 'inpaints' = scene.type === 'scene' ? 'outs' : 'inpaints';
    const srcDir = projectPath(imgDir, session.name, scene.name);
    const dstDir = projectPath(imgDir, session.name, IMAGE_TRASH_DIR, scene.name);

    // Ensure .trash directory exists by writing a placeholder
    try {
      await backend.writeFile(projectPath(imgDir, session.name, IMAGE_TRASH_DIR, '.gitkeep'), '');
    } catch (e) {}

    try {
      await backend.renameDir(srcDir, dstDir);
    } catch (e) {
      console.error('씬 디렉토리 휴지통 이동 실패:', e);
    }

    // For inpaint scenes, also move mask and org files
    if (scene.type === 'inpaint') {
      for (const dir of ['inpaint_masks', 'inpaint_orgs'] as const) {
        const maskSrc = projectPath(dir, session.name, scene.name + '.png');
        const maskDst = projectPath(dir, session.name, IMAGE_TRASH_DIR, scene.name + '.png');
        try {
          await backend.writeFile(projectPath(dir, session.name, IMAGE_TRASH_DIR, '.gitkeep'), '');
        } catch (e) {}
        try {
          await backend.renameFile(maskSrc, maskDst);
        } catch (e) {}
      }
    }

    // Remove scene from session
    session.removeScene(scene.type, scene.name);

    await this.saveTrash();
  }

  getDeletedScenes(projectName: string): {name: string, type: 'scene' | 'inpaint', deletedAt: number}[] {
    this.ensureLoaded();
    const prefix = projectName + ':';
    const result: {name: string, type: 'scene' | 'inpaint', deletedAt: number}[] = [];
    for (const [key, entry] of Object.entries(this.data.scenes)) {
      if (key.startsWith(prefix)) {
        const sceneName = key.substring(prefix.length);
        result.push({
          name: sceneName,
          type: entry.sceneData.type === 'inpaint' ? 'inpaint' : 'scene',
          deletedAt: entry.deletedAt,
        });
      }
    }
    return result;
  }

  async restoreScene(session: Session, sceneName: string): Promise<void> {
    this.ensureLoaded();
    const key = this.sceneKey(session.name, sceneName);
    const entry = this.data.scenes[key];
    if (!entry) throw new Error('씬을 휴지통에서 찾을 수 없습니다');

    const sceneType = entry.sceneData.type === 'inpaint' ? 'inpaint' : 'scene';

    // Check name conflict
    if (session.hasScene(sceneType, sceneName)) {
      throw new Error('같은 이름의 씬이 이미 존재합니다');
    }

    // Move directory back (projectPath 경유 — 신 배치 자동 분기)
    const imgDir: 'outs' | 'inpaints' = sceneType === 'scene' ? 'outs' : 'inpaints';
    const srcDir = projectPath(imgDir, session.name, IMAGE_TRASH_DIR, sceneName);
    const dstDir = projectPath(imgDir, session.name, sceneName);
    try {
      await backend.renameDir(srcDir, dstDir);
    } catch (e) {
      console.error('씬 디렉토리 복원 실패:', e);
    }

    // For inpaint scenes, restore mask and org
    if (sceneType === 'inpaint') {
      for (const dir of ['inpaint_masks', 'inpaint_orgs'] as const) {
        const maskSrc = projectPath(dir, session.name, IMAGE_TRASH_DIR, sceneName + '.png');
        const maskDst = projectPath(dir, session.name, sceneName + '.png');
        try {
          await backend.renameFile(maskSrc, maskDst);
        } catch (e) {}
      }
    }

    // Re-add scene to session
    const restoredScene = genericSceneFromJSON(entry.sceneData);
    if (!restoredScene) {
      // 워크플로우 프리셋 역직렬화 실패 — 세션을 건드리지 않고 중단(휴지통 항목은 보존됨)
      throw new Error('씬 데이터를 복원할 수 없습니다: ' + sceneName);
    }
    session.addScene(restoredScene);

    // Remove from trash
    delete this.data.scenes[key];
    await this.saveTrash();
  }

  async permanentlyDeleteScene(projectName: string, sceneName: string, sceneType: 'scene' | 'inpaint'): Promise<void> {
    this.ensureLoaded();
    const key = this.sceneKey(projectName, sceneName);

    // Delete directory (projectPath 경유 — 신 배치 자동 분기)
    const imgDir: 'outs' | 'inpaints' = sceneType === 'scene' ? 'outs' : 'inpaints';
    try {
      await backend.deleteDir(
        projectPath(imgDir, projectName, IMAGE_TRASH_DIR, sceneName),
      );
    } catch (e) {}

    // Delete mask/org for inpaint
    if (sceneType === 'inpaint') {
      for (const maskDir of ['inpaint_masks', 'inpaint_orgs'] as const) {
        try {
          await backend.deleteFile(
            projectPath(maskDir, projectName, IMAGE_TRASH_DIR, sceneName + '.png'),
          );
        } catch (e) {}
      }
    }

    delete this.data.scenes[key];
    await this.saveTrash();
  }

  // ===== Project trash =====

  // projects 루트 + 1단계 폴더 디렉터리 경로 목록.
  // (SessionService.getList 의 폴더 탐지 패턴과 동일: listFiles[파일+디렉토리] - listFilesWithStats[파일만] = 폴더)
  // 주의: listFiles/listFilesWithStats 는 폴더 부재(ENOENT)면 [] 를 반환하고,
  // 그 외(잠금/권한 등 EBUSY/EPERM)면 throw 한다. 과거엔 여기서 throw 를 삼켜
  // ['projects'] 로 격하했는데, 그러면 폴더 소속 프로젝트를 못 보고 "활성 없음"
  // 으로 오판해 활성 이미지가 삭제될 수 있었다. 이제 에러를 그대로 전파하고,
  // 파괴적 경로(permanentlyDeleteProject)가 "불확실하면 보존" 하도록 한다.
  private async getProjectDirs(): Promise<string[]> {
    const entries = await backend.listFiles(PROJECT_JSON_ROOT);
    const rootStats = await backend.listFilesWithStats(PROJECT_JSON_ROOT);
    const rootFileSet = new Set(rootStats.map((s: any) => s.name));
    const dirs = entries.filter(
      (e: string) => !rootFileSet.has(e) && !e.startsWith('.'),
    );
    return [PROJECT_JSON_ROOT, ...dirs.map((d) => projectFolderPath(d))];
  }

  // 신 배치(workspace/) 1단 스캔: 각 하위 폴더의 meta.json 을 읽어 논리 이름과
  // 활성/소프트삭제 상태를 함께 반환한다. 실제 IO 오류는 throw(구 배치 스캔과
  // 동일 계약 — 파괴적 경로가 "불확실하면 보존"). meta 파손 폴더는 스킵.
  private async scanWorkspaceEntries(): Promise<
    { name: string; dir: string; hasJson: boolean; hasDeleted: boolean }[]
  > {
    const dirs = await backend.listFiles(WORKSPACE_ROOT); // ENOENT→[], 실오류→throw
    const result: {
      name: string;
      dir: string;
      hasJson: boolean;
      hasDeleted: boolean;
    }[] = [];
    for (const dir of dirs) {
      if (dir.startsWith('.')) continue;
      let meta: WorkspaceProjectMeta;
      try {
        meta = JSON.parse(
          await backend.readFile(workspacePath(dir, PROJECT_META_FILE)),
        );
      } catch (e) {
        continue; // meta 부재/파손 — 스킵(부팅/정리는 계속)
      }
      if (!meta || typeof meta.name !== 'string' || !meta.name.trim()) continue;
      const hasJson = await backend.existFile(
        workspacePath(dir, PROJECT_JSON_FILE),
      );
      const hasDeleted = await backend.existFile(
        workspacePath(dir, WORKSPACE_DELETED_FILE),
      );
      result.push({ name: meta.name, dir, hasJson, hasDeleted });
    }
    return result;
  }

  // 주어진 확장자(.json / .deleted)를 가진 프로젝트 파일을 루트 + 폴더에서 모두 찾아
  // 이름 → 전체경로 맵으로 반환한다. (동명은 루트 우선)
  private async scanProjectFiles(suffix: string): Promise<Map<string, string>> {
    // 신 배치: workspace/ 하위의 project.json(활성)/project.json.deleted(소프트삭제)
    // 를 스캔한다. suffix 는 상태 선택자로만 쓰이고 경로는 신 배치 규칙으로 조립.
    if (isWorkspaceLayout()) {
      const map = new Map<string, string>();
      const wantDeleted = suffix === '.deleted';
      for (const e of await this.scanWorkspaceEntries()) {
        const want = wantDeleted ? e.hasDeleted : e.hasJson;
        if (!want) continue;
        if (!e.name.trim()) continue;
        if (map.has(e.name)) continue;
        map.set(
          e.name,
          wantDeleted
            ? workspacePath(e.dir, WORKSPACE_DELETED_FILE)
            : workspacePath(e.dir, PROJECT_JSON_FILE),
        );
      }
      return map;
    }
    const map = new Map<string, string>();
    const dirs = await this.getProjectDirs();
    for (const dir of dirs) {
      // ENOENT 는 [] 로 흡수되고, 실제 에러(잠금/권한)는 throw 된다.
      // 여기서 삼키면 활성 프로젝트를 "없음" 으로 오판 → 활성 이미지 오삭제 위험.
      const stats = await backend.listFilesWithStats(dir);
      for (const s of stats) {
        // '.deleted'/'.json' 처럼 이름 없이 확장자만 남은 점(.) 파일은
        // 프로젝트명 ''(빈 문자열)로 오인된다 — 빈 이름이 영구삭제로 흘러가면
        // outs 루트+빈 이름 = outs 루트 전체가 삭제된다(2026-07-06 실사고). 반드시 제외.
        if (s.name.startsWith('.')) continue;
        if (s.name.endsWith(suffix)) {
          const name = s.name.substring(0, s.name.length - suffix.length);
          if (!map.has(name)) map.set(name, dir + '/' + s.name);
        }
      }
    }
    return map;
  }

  // scanProjectFiles 와 독립적인 2차 가드: 활성 .json 이 실제로 존재하는지 직접 확인.
  // 루트(projects/<이름>.json)와 모든 폴더 경로를 점검한다.
  // getProjectDirs 가 throw 하면(스캔 불가) 호출부에서 "불확실 → 보존" 으로 처리한다.
  private async activeProjectFileExists(name: string): Promise<boolean> {
    // 신 배치: workspace/ 직접 스캔(레지스트리 비의존 — 소프트삭제로 미등록이어도
    // 활성 여부를 정확히 판정). scanWorkspaceEntries 는 실오류 시 throw → 호출부 보존.
    if (isWorkspaceLayout()) {
      for (const e of await this.scanWorkspaceEntries()) {
        if (e.name === name && e.hasJson) return true;
      }
      return false;
    }
    if (await backend.existFile(projectJsonPath(name))) return true;
    const dirs = await this.getProjectDirs();
    for (const dir of dirs) {
      if (dir === PROJECT_JSON_ROOT) continue;
      if (await backend.existFile(dir + '/' + name + '.json')) return true;
    }
    return false;
  }

  // 특정 이름의 .deleted 파일 전체 경로(루트+폴더, 중복 위치 포함)를 찾는다.
  // .deleted 파일 정리/조회 보조. 스캔 실패 시 [] 를 반환해 정리를 건너뛴다.
  // (이 함수는 .deleted 파일 경로만 다루며 이미지 디렉터리와 무관하므로,
  //  실패 시 스킵해도 데이터 안전에는 영향이 없다.)
  private async findAllDeletedPaths(name: string): Promise<string[]> {
    if (isWorkspaceLayout()) {
      const result: string[] = [];
      try {
        for (const e of await this.scanWorkspaceEntries()) {
          if (e.name === name && e.hasDeleted) {
            result.push(workspacePath(e.dir, WORKSPACE_DELETED_FILE));
          }
        }
      } catch (e) {
        console.error('.deleted 경로 스캔 실패 — 정리 건너뜀:', name, e);
        return [];
      }
      return result;
    }
    const target = name + '.deleted';
    const result: string[] = [];
    try {
      const dirs = await this.getProjectDirs();
      for (const dir of dirs) {
        const stats = await backend.listFilesWithStats(dir);
        if (stats.some((s: any) => s.name === target)) {
          result.push(dir + '/' + target);
        }
      }
    } catch (e) {
      console.error('.deleted 경로 스캔 실패 — 정리 건너뜀:', name, e);
      return [];
    }
    return result;
  }

  // 같은 이름의 기존 휴지통(.deleted) 항목을 모두 제거한다.
  // 동명 프로젝트를 재삭제하기 직전에 호출 → "최신 1개만 유지"를 보장하고
  // 플랫폼별 rename 덮어쓰기/오류 불확실성을 제거한다.
  // 이미지 디렉터리(outs/<이름> 등)는 이름 공유이므로 건드리지 않는다.
  async purgeDeletedProject(name: string): Promise<void> {
    this.ensureLoaded();
    const paths = await this.findAllDeletedPaths(name);
    for (const p of paths) {
      try {
        await backend.deleteFile(p);
      } catch (e) {}
    }
    if (this.data.projects[name]) {
      delete this.data.projects[name];
      await this.saveTrash();
    }
  }

  async moveProjectToTrash(projectName: string): Promise<void> {
    this.ensureLoaded();
    this.data.projects[projectName] = { deletedAt: Date.now() };
    await this.saveTrash();
  }

  // 프로젝트 이름변경 시 trash.json 의 키를 새 이름으로 이관한다.
  // 씬 휴지통 복원은 '<프로젝트>:<씬>' 복합 키 + outs/<프로젝트>/.trash 경로에
  // 의존하는데, 이미지 디렉터리는 rename 시 새 이름으로 이동하므로 키를 함께
  // 옮기지 않으면 기존 삭제 씬이 복원 불가한 유령이 된다.
  // 로드 실패 상태(!loaded)에서는 저장 자체가 기존 기록을 지울 수 있으므로
  // 이관을 조용히 건너뛴다 (rename 본체를 막지 않음 — loadTrash 주석 참조).
  async renameProjectKeys(oldName: string, newName: string): Promise<void> {
    if (!this.loaded) {
      console.error('trash.json 미로드 — 이름변경 키 이관 건너뜀:', oldName);
      return;
    }
    let changed = false;
    const prefix = oldName + ':';
    for (const key of Object.keys(this.data.scenes)) {
      if (key.startsWith(prefix)) {
        const sceneName = key.substring(prefix.length);
        this.data.scenes[newName + ':' + sceneName] = this.data.scenes[key];
        delete this.data.scenes[key];
        changed = true;
      }
    }
    if (this.data.projects[oldName]) {
      this.data.projects[newName] = this.data.projects[oldName];
      delete this.data.projects[oldName];
      changed = true;
    }
    if (changed) await this.saveTrash();
  }

  async getDeletedProjects(): Promise<{name: string, deletedAt: number}[]> {
    this.ensureLoaded();
    // 루트 + 폴더 하위까지 .deleted / .json 을 모두 스캔 (폴더 소속 프로젝트 포함)
    const deletedMap = await this.scanProjectFiles('.deleted');
    const activeMap = await this.scanProjectFiles('.json');

    const result: { name: string; deletedAt: number }[] = [];
    for (const name of deletedMap.keys()) {
      // 동명의 활성 .json 이 있으면 orphan 이므로 제외
      if (activeMap.has(name)) continue;
      // 빈/공백 이름은 목록에 올리지 않는다 (영구삭제 유도 방지 — 스캔 단계
      // 점 파일 제외와 이중 방어)
      if (!name.trim()) continue;
      result.push({
        name,
        deletedAt: this.data.projects[name]?.deletedAt || 0,
      });
    }
    return result;
  }

  async restoreProject(name: string): Promise<void> {
    this.ensureLoaded();
    const deletedMap = await this.scanProjectFiles('.deleted');
    const activeMap = await this.scanProjectFiles('.json');
    const deletedPath = deletedMap.get(name);

    if (activeMap.has(name)) {
      // Orphan .deleted: 활성 프로젝트가 있으니 .deleted 만 제거
      if (deletedPath) {
        try {
          await backend.deleteFile(deletedPath);
        } catch (e) {}
      }
    } else if (deletedPath) {
      if (isWorkspaceLayout()) {
        // 신 배치: project.json.deleted → project.json (접미 제거). 물리 폴더는
        // 불변이라 폴더 소속(meta.folder)도 그대로 복원된다. 레지스트리 재등록.
        const jsonPath = deletedPath.slice(0, -WORKSPACE_DELETED_FILE.length) + PROJECT_JSON_FILE;
        await backend.renameFile(deletedPath, jsonPath);
        const dir = deletedPath.split('/')[1];
        if (dir) registerProjectDir(name, dir);
      } else {
        // 같은 위치(폴더 포함)에 .json 으로 되돌린다 → 폴더 소속도 복원됨
        const jsonPath = deletedPath.replace(/\.deleted$/, '.json');
        await backend.renameFile(deletedPath, jsonPath);
      }
    } else {
      throw new Error('프로젝트를 휴지통에서 찾을 수 없습니다');
    }
    delete this.data.projects[name];
    await this.saveTrash();
  }

  async permanentlyDeleteProject(name: string): Promise<void> {
    this.ensureLoaded();

    // CRITICAL: 빈/공백 이름이나 경로 문자가 섞인 이름은 이미지 디렉터리 경로가
    // 'outs/' 처럼 데이터 루트 자체 또는 다른 위치가 되어 대량 오삭제로 이어진다
    // (2026-07-06 outs 전체 증발 실사고). 파일시스템은 건드리지 않고
    // 휴지통 기록의 유령 항목만 정리한 뒤 즉시 중단한다.
    if (
      !name ||
      !name.trim() ||
      name.includes('/') ||
      name.includes('\\') ||
      name.includes('..')
    ) {
      console.error(
        '프로젝트 영구삭제 거부 — 유효하지 않은 이름:',
        JSON.stringify(name),
      );
      if (name in this.data.projects) {
        delete this.data.projects[name];
        await this.saveTrash();
      }
      return;
    }

    // CRITICAL: 같은 이름의 활성 .json 이 있으면(루트/폴더 어디든) 이미지 디렉터리를
    // 절대 지우지 않는다. 이미지 디렉터리는 이름 기준(outs/<이름> 등)이라 동명의
    // 새 프로젝트와 폴더를 공유하기 때문이다(삭제 후 동명 재생성 시 오삭제 위험).
    //
    // 활성 여부 판정은 파일 스캔에 의존하는데, 스캔이 실패(폴더 잠금/권한/동기화 등)하면
    // "활성 없음" 으로 오판할 수 있다. 이 경우 안전을 위해 디렉터리 삭제를 건너뛴다.
    let deletedPath: string | undefined;
    let activeExists = false;
    let scanOk = true;
    try {
      const deletedMap = await this.scanProjectFiles('.deleted');
      const activeMap = await this.scanProjectFiles('.json');
      deletedPath = deletedMap.get(name);
      activeExists = activeMap.has(name);
    } catch (e) {
      console.error(
        '프로젝트 영구삭제: 활성 여부 스캔 실패 — 이미지 디렉터리 보존:',
        name,
        e,
      );
      scanOk = false;
    }

    // .deleted 파일 제거 (스캔으로 경로를 확인한 경우에만)
    if (deletedPath) {
      try {
        await backend.deleteFile(deletedPath);
      } catch (e) {}
    }

    // 디렉터리를 지워도 되는지 최종 판정.
    // (1) 스캔이 성공했고, (2) 활성 .json 이 없으며,
    // (3) 스캔과 독립적인 직접 재확인에서도 활성 .json 이 없을 때만 삭제한다.
    let safeToDeleteDirs = scanOk && !activeExists;
    if (safeToDeleteDirs) {
      try {
        if (await this.activeProjectFileExists(name)) {
          // 스캔은 비었다고 했지만 실제 파일이 존재 → 삭제 중단
          safeToDeleteDirs = false;
        }
      } catch (e) {
        // 재확인 자체가 실패 → 불확실하므로 삭제 중단
        console.error(
          '프로젝트 영구삭제: 활성 .json 재확인 실패 — 이미지 디렉터리 보존:',
          name,
          e,
        );
        safeToDeleteDirs = false;
      }
    }

    if (safeToDeleteDirs) {
      if (isWorkspaceLayout()) {
        // 신 배치: 프로젝트 물리 폴더(workspace/<dir>) 통째 삭제 — 1연산으로
        // 이미지 6루트 + json + meta 를 모두 제거(스펙 §A-4). dir 은 .deleted
        // 경로에서 파생(소프트삭제라 레지스트리엔 없을 수 있음). dataPathGuard 는
        // 2세그먼트(workspace/<dir>)라 통과.
        if (deletedPath) {
          const dir = deletedPath.split('/')[1];
          if (dir) {
            try {
              await backend.deleteDir(workspacePath(dir));
            } catch (e) {}
            unregisterProjectDir(name);
          }
        }
      } else {
        // 삭제 대상 이미지 루트 목록은 PROJECT_IMAGE_ROOTS 단일 출처를 따른다
        // (references 포함 6종 — 과거 references 누락으로 영구삭제 후
        //  references/<이름>/ 고아 디렉터리가 남던 버그 수정, 2026-07-07).
        for (const dir of PROJECT_IMAGE_ROOTS) {
          try {
            await backend.deleteDir(projectPath(dir, name));
          } catch (e) {}
        }
      }
    }

    // Clean up trash.json entries for this project's scenes
    const prefix = name + ':';
    for (const key of Object.keys(this.data.scenes)) {
      if (key.startsWith(prefix)) {
        delete this.data.scenes[key];
      }
    }
    delete this.data.projects[name];
    await this.saveTrash();
    // 템플릿 지정 해제 — 남겨두면 나중에 동명의 새 프로젝트가 만들어졌을 때
    // 의도치 않게 템플릿으로 지정된 것처럼 보인다. (소프트 삭제는 지정을
    // 유지해 복원 시 되살아난다 — list() 가 실존 프로젝트만 노출하므로 무해)
    try {
      await templateService.removeProject(name);
    } catch (e) {}
  }

  // ===== Expired project management =====

  async getExpiredProjects(): Promise<{name: string, deletedAt: number}[]> {
    this.ensureLoaded();
    const now = Date.now();
    // 스캔 실패 시(폴더 잠금/권한/동기화 등) 만료 목록을 비워 시작을 막지 않고,
    // 불확실한 상태에서 만료 다이얼로그를 띄워 삭제를 유도하지 않는다.
    let deleted: { name: string; deletedAt: number }[];
    try {
      deleted = await this.getDeletedProjects();
    } catch (e) {
      console.error('만료 프로젝트 조회 실패 — 이번 실행은 건너뜀:', e);
      return [];
    }
    return deleted.filter(p => (now - p.deletedAt) >= PROJECT_RETENTION_MS);
  }

  async deferProjects(names: string[]): Promise<void> {
    this.ensureLoaded();
    const now = Date.now();
    for (const name of names) {
      if (this.data.projects[name]) {
        this.data.projects[name].deletedAt = now;
      }
    }
    if (names.length > 0) {
      await this.saveTrash();
    }
  }

  // ===== Auto-cleanup =====

  async autoCleanup(): Promise<void> {
    this.ensureLoaded();
    const now = Date.now();

    // 0. Silently clean orphan .deleted files (where .json also exists) — 폴더 포함
    try {
      const deletedMap = await this.scanProjectFiles('.deleted');
      const activeMap = await this.scanProjectFiles('.json');
      let changed = false;
      for (const [name, path] of deletedMap) {
        if (activeMap.has(name)) {
          console.log('자동 정리: orphan .deleted 파일 제거 (활성 프로젝트 존재) - ' + name);
          try {
            await backend.deleteFile(path);
          } catch (e) {}
          delete this.data.projects[name];
          changed = true;
        }
      }
      if (changed) {
        await this.saveTrash();
      }
    } catch (e) {}

    // 1. Project cleanup is now handled by ExpiredProjectsDialog (user confirmation required)
    //    See getExpiredProjects() and deferProjects()

    // 2. Cleanup expired scenes (14 days)
    const sceneKeys = Object.keys(this.data.scenes);
    for (const key of sceneKeys) {
      const entry = this.data.scenes[key];
      if (!entry) continue;
      const age = now - entry.deletedAt;
      if (age >= SCENE_RETENTION_MS) {
        const [projectName, sceneName] = [
          key.substring(0, key.indexOf(':')),
          key.substring(key.indexOf(':') + 1),
        ];
        const sceneType = entry.sceneData.type === 'inpaint' ? 'inpaint' : 'scene';
        console.log('자동 정리: 씬 ' + key + ' 영구 삭제');
        await this.permanentlyDeleteScene(projectName, sceneName, sceneType as 'scene' | 'inpaint');
      }
    }

    // 3. Cleanup expired images (3 days) — 폴더 소속 프로젝트 포함
    let activeProjects: string[];
    try {
      activeProjects = Array.from((await this.scanProjectFiles('.json')).keys());
    } catch (e) {
      return;
    }

    for (const projectName of activeProjects) {
      for (const imgDir of ['outs', 'inpaints'] as const) {
        let sceneDirs: string[];
        try {
          sceneDirs = await backend.listFiles(projectPath(imgDir, projectName));
        } catch (e) {
          continue;
        }
        for (const sceneDir of sceneDirs) {
          if (sceneDir === IMAGE_TRASH_DIR || sceneDir.startsWith('.')) continue;
          const trashMetaPath = projectPath(imgDir, projectName, sceneDir, IMAGE_TRASH_DIR, TRASH_META_FILE);
          if (!(await backend.existFile(trashMetaPath))) continue;
          try {
            const metaStr = await backend.readFile(trashMetaPath);
            const meta: TrashImageMeta = JSON.parse(metaStr);
            let metaChanged = false;
            for (const [filename, deletedAt] of Object.entries(meta)) {
              const age = now - deletedAt;
              if (age >= IMAGE_RETENTION_MS) {
                try {
                  await backend.deleteFile(
                    projectPath(imgDir, projectName, sceneDir, IMAGE_TRASH_DIR, filename),
                  );
                } catch (e) {}
                delete meta[filename];
                metaChanged = true;
              }
            }
            if (metaChanged) {
              await persistService.write(trashMetaPath, JSON.stringify(meta));
            }
          } catch (e) {
            // No trash meta = no trash images to clean
          }
        }
      }
    }
  }
}
