import { backend, templateService, sessionService } from '.';
import { persistService } from './PersistenceService';
import { GenericScene, IInpaintScene, IScene, Session, genericSceneFromJSON } from './types';
import { imageService } from '.';
import { isOutputImageFile, PNG_IMAGE_EXT } from './imageFormats';
import {
  projectPath,
  projectFolderPath,
  projectJsonPath,
  workspacePath,
  invalidProjectName,
  WORKSPACE_ROOT,
  PROJECT_JSON_ROOT,
  PROJECT_IMAGE_ROOTS,
  PROJECT_SCENE_MASK_ROOTS,
} from './projectPaths';
import type { ProjectImageRoot } from './projectPaths';
import {
  isWorkspaceLayout,
  physicalDirOf,
  nameOfPhysicalDir,
  registerProjectDir,
  unregisterProjectDir,
  WorkspaceProjectMeta,
  PROJECT_META_FILE,
  PROJECT_JSON_FILE,
} from './storageLayout';
import {
  pickTrashSlotName,
  pickNewestTrashDir,
  sceneTrashBelongsTo,
  trashSlotCompareKey,
} from './trashList';

// 신 배치의 소프트 삭제 파일명(project.json.deleted).
const WORKSPACE_DELETED_FILE = PROJECT_JSON_FILE + '.deleted';

// --- Type definitions ---

interface TrashImageMeta {
  [filename: string]: number; // filename -> deletedAt timestamp
}

// trash.json 호환 규칙(2026-10-02 S1·S2): 새 필드는 전부 선택 필드다. 구버전(5.4.0 이하)은
// 모르는 필드를 무시하고 키 `프로젝트:씬`·sceneData.name 으로만 동작하므로, 새 버전은
// 키의 씬 부분 = 휴지통 폴더 이름 = sceneData.name(= 슬롯 이름)을 항상 일치시킨다.
interface TrashSceneEntry {
  sceneData: IScene | IInpaintScene;
  deletedAt: number;
  // 원래 씬 이름 — 슬롯 이름이 원래 이름과 다를 때(「S (삭제 2)」)만 기록. 표시용.
  originalName?: string;
  // 신 배치 물리 폴더(이름__짧은id) — 같은 이름 프로젝트(휴지통의 옛 P 와 활성 P)의 씬
  // 기록을 구분한다. 없으면(구 배치·구버전 기록) 프로젝트 이름(키 접두)으로만 판정.
  projectDir?: string;
}

interface TrashProjectEntry {
  // 이 이름으로 가장 최근에 삭제된 시각(구버전이 읽는 값).
  deletedAt: number;
  // 신 배치: 휴지통 폴더별 삭제 시각(동명 공존). 없는 폴더는 deletedAt 으로 해석.
  dirs?: { [dir: string]: number };
}

interface TrashData {
  scenes: { [compositeKey: string]: TrashSceneEntry };
  projects: { [projectName: string]: TrashProjectEntry };
}

// 신 배치 workspace/ 1단 스캔 결과(폴더 1개).
interface WorkspaceScanEntry {
  name: string;
  dir: string;
  hasJson: boolean;
  hasDeleted: boolean;
}

/** 휴지통 프로젝트 1건. dir = 신 배치 물리 폴더(동명 구분용 내부 식별자 — 화면에 내지 않는다). */
export interface DeletedProjectInfo {
  name: string;
  deletedAt: number;
  dir?: string;
}

// --- Constants ---

const TRASH_FILE = 'trash.json';
const IMAGE_TRASH_DIR = '.trash';
const TRASH_META_FILE = '.trash_meta.json';

// 보존 기간(일) — 휴지통 안내 문구(TrashViews·만료 확인 창)가 이 값을 그대로 쓴다(단일 출처, S3).
export const IMAGE_RETENTION_DAYS = 3;
export const SCENE_RETENTION_DAYS = 14;
export const PROJECT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const IMAGE_RETENTION_MS = IMAGE_RETENTION_DAYS * DAY_MS;
const SCENE_RETENTION_MS = SCENE_RETENTION_DAYS * DAY_MS;
const PROJECT_RETENTION_MS = PROJECT_RETENTION_DAYS * DAY_MS;

// 변형 씬(구형) 마스크·원본 파일 이름 — inpaint_masks|inpaint_orgs/<프로젝트>/<씬>.png
function sceneMaskFileName(sceneName: string): string {
  return `${sceneName}.${PNG_IMAGE_EXT}`;
}

function isSceneMaskFileName(filename: string): boolean {
  return filename.toLowerCase().endsWith(`.${PNG_IMAGE_EXT}`);
}

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

  // 반환값: 이동에 실패한 파일 수(잠금/권한 등). 호출부가 사용자에게 알릴 수 있도록
  // 조용히 삼키지 않고 집계해 돌려준다.
  async moveImagesToTrash(session: Session, scene: GenericScene, fullPaths: string[]): Promise<number> {
    const trashDir = this.getImageTrashDir(session, scene);
    const meta = await this.loadImageTrashMeta(session, scene);
    const now = Date.now();

    // Ensure .trash directory exists by writing meta first
    // (writeFile auto-creates parent dirs)
    if (Object.keys(meta).length === 0 && fullPaths.length > 0) {
      await this.saveImageTrashMeta(session, scene, meta);
    }

    let failed = 0;
    for (const fullPath of fullPaths) {
      const filename = fullPath.split('/').pop()!;
      try {
        await backend.renameFile(fullPath, trashDir + '/' + filename);
        meta[filename] = now;
      } catch (e) {
        failed++;
        console.error('이미지 휴지통 이동 실패:', fullPath, e);
      }
    }

    await this.saveImageTrashMeta(session, scene, meta);
    this.dispatchEvent(new CustomEvent('trash-updated'));
    return failed;
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
    const restoredTrashPaths: string[] = [];

    for (const filename of filenames) {
      try {
        const trashPath = trashDir + '/' + filename;
        await backend.renameFile(trashPath, outputDir + '/' + filename);
        delete meta[filename];
        restoredTrashPaths.push(trashPath);
      } catch (e) {
        console.error('이미지 복원 실패:', filename, e);
      }
    }

    // 휴지통 썸네일은 디렉터리 단위로 한 번만 정리한다.
    try {
      await imageService.invalidateCacheBatch(restoredTrashPaths);
    } catch (e) {}

    await this.saveImageTrashMeta(session, scene, meta);
    this.dispatchEvent(new CustomEvent('trash-updated'));
  }

  // onProgress: 일괄 작업 잠금(progressDialog)용 진행 통지 — 파일 1개 삭제마다 호출 (옵셔널=기존 호출 무변경)
  // 반환값: 삭제에 실패한 파일 수. 실패한 파일은 meta 항목을 보존해 자동 정리
  // (autoCleanup)가 다음에 재시도할 수 있게 한다 — 과거엔 실패해도 meta 를 지워
  // 해당 파일이 자동 삭제 대상에서 영구히 빠졌다(2026-07-26 webp 미삭제 버그).
  async permanentlyDeleteImages(session: Session, scene: GenericScene, filenames: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
    const trashDir = this.getImageTrashDir(session, scene);
    const meta = await this.loadImageTrashMeta(session, scene);

    let done = 0;
    let failed = 0;
    let lastProgressAt = 0;
    const removedPaths: string[] = [];
    for (const filename of filenames) {
      const trashPath = trashDir + '/' + filename;
      let removed = false;
      try {
        await backend.deleteFile(trashPath);
        removed = true;
      } catch (e) {
        // 이미 없는 파일(ENOENT)이면 정리된 것으로 간주. 확인 자체가 실패하면
        // 보수적으로 "아직 있음"으로 취급해 meta 를 보존한다.
        removed = !(await backend.existFile(trashPath).catch(() => true));
        if (!removed) {
          failed++;
          console.error('이미지 영구 삭제 실패:', filename, e);
        }
      }
      if (removed) {
        delete meta[filename];
        removedPaths.push(trashPath);
      }
      done++;
      const now = Date.now();
      if (done === filenames.length || done === 1 || now - lastProgressAt >= 100) {
        onProgress?.(done, filenames.length);
        lastProgressAt = now;
      }
    }

    // 파일별 3회 디스크 캐시 삭제 대신 .trash/fastcache를 한 번만 제거한다.
    try {
      await imageService.invalidateCacheBatch(removedPaths);
    } catch (e) {}

    await this.saveImageTrashMeta(session, scene, meta);
    this.dispatchEvent(new CustomEvent('trash-updated'));
    return failed;
  }

  // 반환값: 삭제에 실패한 파일 수 (permanentlyDeleteImages 와 동일 의미)
  async emptyImageTrash(session: Session, scene: GenericScene, onProgress?: (done: number, total: number) => void): Promise<number> {
    const items = await this.getTrashImages(session, scene);
    if (items.length > 0) {
      return await this.permanentlyDeleteImages(session, scene, items.map(i => i.filename), onProgress);
    }
    return 0;
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
   * 반환값: { deleted: 영구삭제된 이미지 수, failed: 삭제 실패 수 }
   */
  // onProgress: 일괄 작업 잠금(progressDialog)용 — 삭제 누계(이미지 단위)를 통지 (옵셔널=기존 호출 무변경)
  async emptyProjectImageTrash(
    session: Session,
    onProgress?: (deletedImages: number) => void,
  ): Promise<{ deleted: number; failed: number }> {
    // 진행 통지(onProgress)는 "시도 누계" 기준 — 성공 누계를 오프셋으로 쓰면
    // 실패가 섞였을 때 다음 씬에서 진행바가 뒤로 갔다가 total 에 못 미친다.
    let attempted = 0;
    let deleted = 0;
    let failed = 0;
    const allScenes: GenericScene[] = [
      ...session.getScenes('scene'),
      ...session.getScenes('inpaint'),
    ];
    for (const scene of allScenes) {
      const items = await this.getTrashImages(session, scene);
      if (items.length > 0) {
        const base = attempted;
        const f = await this.permanentlyDeleteImages(
          session,
          scene,
          items.map((i) => i.filename),
          (done) => onProgress?.(base + done),
        );
        attempted += items.length;
        failed += f;
        deleted += items.length - f;
      }
    }
    return { deleted, failed };
  }

  // ===== Scene trash =====

  private sceneKey(projectName: string, sceneName: string): string {
    return projectName + ':' + sceneName;
  }

  async moveSceneToTrash(session: Session, scene: GenericScene): Promise<void> {
    // 씬 제거는 outs 폴더를 .trash 로 옮기는 구조 변경 — 다른 창이 소유(=이 창이
    // 미러)한 프로젝트에서는 차단하고 소유 창에 토스트를 띄운다(P3, W6 후속).
    if (!(await sessionService.guardCrossWindowLock(session.name, '씬 제거')))
      return;
    this.ensureLoaded();
    // 2026-10-02 S1: 이동을 먼저 하고, 이동이 확인된 뒤에만 기록 저장·씬 제거를 한다.
    // 예전에는 기록을 먼저 덮어쓰고 이동 실패를 console 로만 남긴 채 씬을 지워, 같은 이름
    // 재삭제 시 옛 기록이 사라지거나(키 덮어씀) 이미지가 outs 에 남거나 휴지통 폴더에 병합됐다.
    const fail = (reason: string) =>
      new Error(
        `씬 "${scene.name}"을(를) 휴지통으로 옮기지 못해 삭제하지 않았습니다. ${reason}`,
      );
    const imgDir: 'outs' | 'inpaints' = scene.type === 'scene' ? 'outs' : 'inpaints';

    // 1) 슬롯 이름 — 기록 키·휴지통 폴더·마스크 파일·sceneData.name 을 모두 이 이름으로 맞춘다.
    const slot = await this.chooseSceneSlot(session, scene, fail);

    // 2) 변형 씬(구형)의 마스크·원본 파일 → .trash/<슬롯>.png (있을 때만). 실패하면 되돌리고 중단.
    const movedFiles: { from: string; to: string }[] = [];
    const revertMovedFiles = async (): Promise<string[]> => {
      const stuck: string[] = [];
      for (const m of movedFiles.slice().reverse()) {
        try {
          await backend.renameFile(m.to, m.from);
        } catch (e) {
          stuck.push(m.to);
        }
      }
      return stuck;
    };
    if (scene.type === 'inpaint') {
      for (const dir of PROJECT_SCENE_MASK_ROOTS) {
        const maskSrc = projectPath(dir, session.name, sceneMaskFileName(scene.name));
        if (!(await backend.existFile(maskSrc))) continue;
        const maskDst = projectPath(dir, session.name, IMAGE_TRASH_DIR, sceneMaskFileName(slot));
        try {
          await backend.writeFile(projectPath(dir, session.name, IMAGE_TRASH_DIR, '.gitkeep'), '');
        } catch (e) {}
        try {
          await backend.renameFile(maskSrc, maskDst);
          movedFiles.push({ from: maskSrc, to: maskDst });
        } catch (e) {
          console.error('씬 마스크/원본 휴지통 이동 실패:', maskSrc, e);
          const stuck = await revertMovedFiles();
          throw fail(
            '마스크/원본 파일을 옮기지 못했습니다.' +
              (stuck.length ? ` 일부 파일이 휴지통 폴더에 남아 있습니다: ${stuck.join(', ')}` : ''),
          );
        }
      }
    }

    // 3) 씬 이미지 폴더 → .trash/<슬롯> (원본 폴더가 있을 때만 — 이미지 없는 씬은 폴더가 없어 정상).
    const srcDir = projectPath(imgDir, session.name, scene.name);
    const dstDir = projectPath(imgDir, session.name, IMAGE_TRASH_DIR, slot);
    if (await backend.existFile(srcDir)) {
      try {
        await backend.writeFile(projectPath(imgDir, session.name, IMAGE_TRASH_DIR, '.gitkeep'), '');
      } catch (e) {}
      let moveError: unknown = undefined;
      try {
        await backend.renameDir(srcDir, dstDir);
      } catch (e) {
        moveError = e;
      }
      const srcLeft = await backend.existFile(srcDir);
      const moved = !srcLeft && (moveError === undefined || (await backend.existFile(dstDir)));
      if (!moved) {
        console.error('씬 디렉토리 휴지통 이동 실패:', srcDir, moveError);
        const partial = await backend.existFile(dstDir);
        const stuck = await revertMovedFiles();
        throw fail(
          '이미지 폴더를 옮기지 못했습니다(파일 잠금·권한 등). 잠시 뒤 다시 시도해 주세요.' +
            (partial
              ? ` 일부 이미지가 휴지통 폴더(.trash/${slot})에 복사됐을 수 있습니다 — 원래 폴더는 그대로 남아 있습니다.`
              : '') +
            (stuck.length ? ` 되돌리지 못한 파일: ${stuck.join(', ')}` : ''),
        );
      }
    }

    // 4) 기록 저장 + 씬 제거
    const sceneData = {
      ...(scene.toJSON() as IScene | IInpaintScene),
      name: slot,
    } as IScene | IInpaintScene;
    const entry: TrashSceneEntry = { sceneData, deletedAt: Date.now() };
    if (slot !== scene.name) entry.originalName = scene.name;
    const projectDir = isWorkspaceLayout() ? physicalDirOf(session.name) : undefined;
    if (projectDir) entry.projectDir = projectDir;
    this.data.scenes[this.sceneKey(session.name, slot)] = entry;

    session.removeScene(scene.type, scene.name);

    await this.saveTrash();
  }

  // 휴지통 슬롯 이름 결정(S1). 이미 쓰인 이름 = 이 프로젝트 이름의 기록 키(종류·소속 무관 —
  // 키 유일성) + 다른 현재 씬 이름(복원 시 충돌 방지) + 대상 루트 .trash 안의 폴더/파일.
  // .trash 목록을 못 읽으면(부재는 [] 로 흡수됨) 판단할 수 없으므로 삭제를 중단한다.
  private async chooseSceneSlot(
    session: Session,
    scene: GenericScene,
    fail: (reason: string) => Error,
  ): Promise<string> {
    const taken: string[] = [];
    const prefix = session.name + ':';
    for (const key of Object.keys(this.data.scenes)) {
      if (key.startsWith(prefix)) taken.push(key.substring(prefix.length));
    }
    const selfKey = trashSlotCompareKey(scene.name);
    for (const s of [...session.getScenes('scene'), ...session.getScenes('inpaint')]) {
      if (trashSlotCompareKey(s.name) !== selfKey) taken.push(s.name);
    }
    const roots: ProjectImageRoot[] =
      scene.type === 'scene' ? ['outs'] : ['inpaints', ...PROJECT_SCENE_MASK_ROOTS];
    for (const root of roots) {
      let names: string[];
      try {
        names = await backend.listFiles(projectPath(root, session.name, IMAGE_TRASH_DIR));
      } catch (e) {
        console.error('휴지통 폴더 목록 읽기 실패:', root, e);
        throw fail('휴지통 폴더를 확인하지 못했습니다.');
      }
      const isMaskRoot = (PROJECT_SCENE_MASK_ROOTS as readonly string[]).includes(root);
      for (const n of names) {
        taken.push(n);
        if (isMaskRoot && isSceneMaskFileName(n)) {
          taken.push(n.slice(0, -(PNG_IMAGE_EXT.length + 1)));
        }
      }
    }
    return pickTrashSlotName(scene.name, taken);
  }

  // 씬 휴지통 기록의 파일 위치(.trash/…). 신 배치에서 기록의 projectDir 가 지금 그 이름으로
  // 등록된 폴더와 다르면(같은 이름의 다른 프로젝트 — 휴지통의 옛 프로젝트 등) 기록이 가리키는
  // 폴더를 직접 쓴다. 그 외에는 이름 관문(projectPath).
  private sceneTrashPath(
    projectName: string,
    entry: TrashSceneEntry | undefined,
    root: ProjectImageRoot,
    leaf: string,
  ): string {
    if (
      isWorkspaceLayout() &&
      entry?.projectDir &&
      physicalDirOf(projectName) !== entry.projectDir
    ) {
      return workspacePath(entry.projectDir, root, IMAGE_TRASH_DIR, leaf);
    }
    return projectPath(root, projectName, IMAGE_TRASH_DIR, leaf);
  }

  // 이 프로젝트(지금 그 이름으로 열려 있는 것) 소속 기록인지. 구 배치는 이름만으로 판정.
  private sceneEntryBelongs(projectName: string, entry: TrashSceneEntry): boolean {
    if (!isWorkspaceLayout()) return true;
    return sceneTrashBelongsTo(entry, physicalDirOf(projectName));
  }

  getDeletedScenes(projectName: string): {
    name: string;
    type: 'scene' | 'inpaint';
    deletedAt: number;
    originalName?: string;
  }[] {
    this.ensureLoaded();
    const prefix = projectName + ':';
    const result: {
      name: string;
      type: 'scene' | 'inpaint';
      deletedAt: number;
      originalName?: string;
    }[] = [];
    for (const [key, entry] of Object.entries(this.data.scenes)) {
      if (key.startsWith(prefix)) {
        if (!this.sceneEntryBelongs(projectName, entry)) continue;
        const sceneName = key.substring(prefix.length);
        result.push({
          name: sceneName,
          type: entry.sceneData.type === 'inpaint' ? 'inpaint' : 'scene',
          deletedAt: entry.deletedAt,
          ...(typeof entry.originalName === 'string' && entry.originalName
            ? { originalName: entry.originalName }
            : {}),
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
    // 신 배치: 같은 이름의 다른 프로젝트(휴지통의 옛 프로젝트 등) 소속 기록은 여기서 복원하지 않는다.
    if (!this.sceneEntryBelongs(session.name, entry)) {
      throw new Error('이 씬은 같은 이름의 다른 프로젝트 휴지통 항목이라 여기서 복원할 수 없습니다');
    }

    const sceneType = entry.sceneData.type === 'inpaint' ? 'inpaint' : 'scene';

    // Check name conflict — 복원 이름 = 키의 씬 이름(슬롯 이름, S1)
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
      for (const dir of PROJECT_SCENE_MASK_ROOTS) {
        const maskSrc = projectPath(dir, session.name, IMAGE_TRASH_DIR, sceneMaskFileName(sceneName));
        const maskDst = projectPath(dir, session.name, sceneMaskFileName(sceneName));
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
    // 폴더 이름(키)과 씬 이름이 어긋난 옛 기록에서도 이미지 폴더와 씬이 짝을 이루도록 키 이름을 쓴다.
    if (restoredScene.name !== sceneName) restoredScene.name = sceneName;
    session.addScene(restoredScene);

    // Remove from trash
    delete this.data.scenes[key];
    await this.saveTrash();
  }

  async permanentlyDeleteScene(projectName: string, sceneName: string, sceneType: 'scene' | 'inpaint'): Promise<void> {
    this.ensureLoaded();
    const key = this.sceneKey(projectName, sceneName);
    const entry = this.data.scenes[key] as TrashSceneEntry | undefined;

    // Delete directory (projectPath 경유 — 신 배치 자동 분기. 다른 동명 프로젝트 소속 기록은 그 폴더)
    const imgDir: 'outs' | 'inpaints' = sceneType === 'scene' ? 'outs' : 'inpaints';
    try {
      await backend.deleteDir(this.sceneTrashPath(projectName, entry, imgDir, sceneName));
    } catch (e) {}

    // Delete mask/org for inpaint
    if (sceneType === 'inpaint') {
      for (const maskDir of PROJECT_SCENE_MASK_ROOTS) {
        try {
          await backend.deleteFile(
            this.sceneTrashPath(projectName, entry, maskDir, sceneMaskFileName(sceneName)),
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
  // 신 배치는 고유 폴더(이름__id)로 동명 휴지통 항목이 공존하므로(2026-10-02 S2 사용자 결정)
  // 정리하지 않는다 — 구 배치 전용.
  async purgeDeletedProject(name: string): Promise<void> {
    this.ensureLoaded();
    if (isWorkspaceLayout()) return;
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

  // dir: 신 배치에서 방금 휴지통으로 옮긴 물리 폴더(SessionService.delete 가 삭제 전에 확보).
  // 폴더별 삭제 시각을 따로 남겨 동명 휴지통 항목을 구분한다(S2). deletedAt 은 구버전 호환용
  // 「이 이름의 가장 최근 삭제 시각」.
  async moveProjectToTrash(projectName: string, dir?: string): Promise<void> {
    this.ensureLoaded();
    const now = Date.now();
    if (isWorkspaceLayout() && dir) {
      const prev = this.data.projects[projectName];
      const dirs: { [dir: string]: number } = { ...(prev?.dirs ?? {}) };
      if (prev && !prev.dirs && prev.deletedAt > 0) {
        // 폴더 구분 없는 옛 기록(구버전·이 수정 전) — 지금 휴지통에 있는 같은 이름 폴더들의
        // 삭제 시각이 옛 값이므로 그 폴더들에 붙여 둔다(새 삭제 시각에 묻히지 않게).
        try {
          for (const e of await this.scanWorkspaceEntries()) {
            if (e.name === projectName && e.hasDeleted && !e.hasJson && e.dir !== dir && !(e.dir in dirs)) {
              dirs[e.dir] = prev.deletedAt;
            }
          }
        } catch (e) {}
      }
      dirs[dir] = now;
      this.data.projects[projectName] = { deletedAt: now, dirs };
    } else {
      this.data.projects[projectName] = { deletedAt: now };
    }
    await this.saveTrash();
  }

  // 휴지통 프로젝트 1개(폴더)의 삭제 시각. 폴더별 기록이 없으면 이름 단위 시각으로 해석.
  private projectDeletedAt(name: string, dir?: string): number {
    const rec = this.data.projects[name];
    if (!rec) return 0;
    const byDir = dir && rec.dirs ? rec.dirs[dir] : undefined;
    if (typeof byDir === 'number' && Number.isFinite(byDir)) return byDir;
    return rec.deletedAt || 0;
  }

  // 휴지통 프로젝트 기록에서 폴더 하나를 뺀다. remainingDirs = 그 뒤에도 휴지통에 남는 같은 이름 폴더.
  // 남는 폴더가 없으면 이름 기록 자체를 지운다. 반환: 변경 여부.
  private dropProjectRecord(name: string, dir: string | undefined, remainingDirs: string[]): boolean {
    const rec = this.data.projects[name];
    if (!rec) return false;
    if (remainingDirs.length === 0) {
      delete this.data.projects[name];
      return true;
    }
    if (dir && rec.dirs && dir in rec.dirs) delete rec.dirs[dir];
    const times = remainingDirs
      .map((d) => rec.dirs?.[d])
      .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
    if (times.length > 0) rec.deletedAt = Math.max(...times);
    return true;
  }

  // 씬 휴지통 기록을 한 프로젝트 이름에서 다른 이름으로 옮긴다(신 배치에서만 projectDir 로 소속 확인).
  // 옮길 키가 이미 다른 기록(같은 이름의 다른 프로젝트)에 쓰이고 있으면 슬롯을 새로 정해
  // 휴지통 폴더·마스크 파일 이름도 함께 바꾼다(키 유일성 — 덮어쓰기 금지). 폴더 이름을 못 바꾸면
  // 그 기록은 옛 키에 그대로 둔다(기록·파일 보존, 목록에서만 안 보임 — 자동 정리는 projectDir 로 찾아간다).
  // 호출 전에 newName 이 이 프로젝트 폴더로 등록돼 있어야 한다(신 배치). 반환: 변경 여부.
  private async moveSceneKeys(
    oldName: string,
    newName: string,
    belongs: (entry: TrashSceneEntry) => boolean,
  ): Promise<boolean> {
    let changed = false;
    const prefix = oldName + ':';
    const newPrefix = newName + ':';
    for (const key of Object.keys(this.data.scenes)) {
      if (!key.startsWith(prefix)) continue;
      const entry = this.data.scenes[key];
      if (!entry || !belongs(entry)) continue;
      const sceneName = key.substring(prefix.length);
      let slot = sceneName;
      if (this.data.scenes[newPrefix + slot] && newPrefix + slot !== key) {
        if (!isWorkspaceLayout()) {
          // 구 배치: 예전 동작 유지(덮어씀) — 이미지 폴더를 이름으로 공유하는 배치라 충돌 해소 대상 아님.
        } else {
          const reslotted = await this.reslotSceneEntry(newName, entry, sceneName);
          if (!reslotted) continue;
          slot = reslotted;
        }
      }
      this.data.scenes[newPrefix + slot] = entry;
      delete this.data.scenes[key];
      changed = true;
    }
    return changed;
  }

  // moveSceneKeys 의 충돌 해소: newName 프로젝트(이 기록의 폴더)의 .trash 안에서 빈 슬롯을 골라
  // 폴더·마스크 파일을 그 이름으로 옮기고 기록을 갱신한다. 실패하면 undefined(무변경).
  private async reslotSceneEntry(
    projectName: string,
    entry: TrashSceneEntry,
    slot: string,
  ): Promise<string | undefined> {
    try {
      const isInpaint = entry.sceneData.type === 'inpaint';
      const imgDir: ProjectImageRoot = isInpaint ? 'inpaints' : 'outs';
      const taken: string[] = [];
      const prefix = projectName + ':';
      for (const k of Object.keys(this.data.scenes)) {
        if (k.startsWith(prefix)) taken.push(k.substring(prefix.length));
      }
      const roots: ProjectImageRoot[] = isInpaint ? [imgDir, ...PROJECT_SCENE_MASK_ROOTS] : [imgDir];
      for (const root of roots) {
        const names = await backend.listFiles(projectPath(root, projectName, IMAGE_TRASH_DIR));
        for (const n of names) {
          taken.push(n);
          if (root !== imgDir && isSceneMaskFileName(n)) {
            taken.push(n.slice(0, -(PNG_IMAGE_EXT.length + 1)));
          }
        }
      }
      const next = pickTrashSlotName(slot, taken);
      const src = projectPath(imgDir, projectName, IMAGE_TRASH_DIR, slot);
      if (await backend.existFile(src)) {
        await backend.renameDir(src, projectPath(imgDir, projectName, IMAGE_TRASH_DIR, next));
        if (await backend.existFile(src)) return undefined;
      }
      if (isInpaint) {
        for (const root of PROJECT_SCENE_MASK_ROOTS) {
          const m = projectPath(root, projectName, IMAGE_TRASH_DIR, sceneMaskFileName(slot));
          if (await backend.existFile(m)) {
            try {
              await backend.renameFile(m, projectPath(root, projectName, IMAGE_TRASH_DIR, sceneMaskFileName(next)));
            } catch (e) {}
          }
        }
      }
      if (!entry.originalName) entry.originalName = entry.sceneData.name || slot;
      entry.sceneData = { ...entry.sceneData, name: next } as IScene | IInpaintScene;
      return next;
    } catch (e) {
      console.error('휴지통 씬 기록 이관 중 슬롯 변경 실패 — 옛 키 유지:', slot, e);
      return undefined;
    }
  }

  // 프로젝트 이름변경 시 trash.json 의 키를 새 이름으로 이관한다.
  // 씬 휴지통 복원은 '<프로젝트>:<씬>' 복합 키 + outs/<프로젝트>/.trash 경로에
  // 의존하는데, 이미지 디렉터리는 rename 시 새 이름으로 이동하므로 키를 함께
  // 옮기지 않으면 기존 삭제 씬이 복원 불가한 유령이 된다.
  // 로드 실패 상태(!loaded)에서는 저장 자체가 기존 기록을 지울 수 있으므로
  // 이관을 조용히 건너뛴다 (rename 본체를 막지 않음 — loadTrash 주석 참조).
  // 신 배치(S2): 이름이 바뀐 활성 프로젝트 소속(projectDir 일치 또는 기록 없음) 씬 기록만 옮기고,
  // 휴지통 프로젝트 기록(projects[oldName])은 휴지통에 남은 같은 이름 폴더의 것이라 옮기지 않는다.
  async renameProjectKeys(oldName: string, newName: string): Promise<void> {
    if (!this.loaded) {
      console.error('trash.json 미로드 — 이름변경 키 이관 건너뜀:', oldName);
      return;
    }
    if (isWorkspaceLayout()) {
      const dir = physicalDirOf(newName);
      const changed = await this.moveSceneKeys(oldName, newName, (entry) =>
        sceneTrashBelongsTo(entry, dir),
      );
      if (changed) await this.saveTrash();
      return;
    }
    let changed = await this.moveSceneKeys(oldName, newName, () => true);
    if (this.data.projects[oldName]) {
      this.data.projects[newName] = this.data.projects[oldName];
      delete this.data.projects[oldName];
      changed = true;
    }
    if (changed) await this.saveTrash();
  }

  // 신 배치 휴지통 프로젝트 목록(폴더 단위). 같은 폴더에 활성 project.json 이 함께 있는 비정상
  // 상태는 휴지통으로 보지 않는다(복원 대상 아님). 스캔 실오류는 throw.
  private async workspaceTrashEntries(): Promise<
    { name: string; dir: string; deletedAt: number }[]
  > {
    const result: { name: string; dir: string; deletedAt: number }[] = [];
    for (const e of await this.scanWorkspaceEntries()) {
      if (!e.hasDeleted || e.hasJson) continue;
      if (!e.name.trim()) continue;
      result.push({ name: e.name, dir: e.dir, deletedAt: this.projectDeletedAt(e.name, e.dir) });
    }
    return result;
  }

  async getDeletedProjects(): Promise<DeletedProjectInfo[]> {
    this.ensureLoaded();
    // 신 배치(S2): 고유 폴더 단위로 전부 돌려준다 — 같은 이름의 활성 프로젝트가 있어도 숨기지 않는다.
    if (isWorkspaceLayout()) {
      return await this.workspaceTrashEntries();
    }
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

  // 신 배치에서 .deleted 를 지운 폴더에 남는 project.json.bak(쓰기 회전 잔해)도
  // 함께 지운다 — 남겨두면 "본문·삭제본 없음+.bak 있음" 상태가 되어 스캔의
  // .bak 자가치유가 삭제된 프로젝트를 부활시킨다.
  private async deleteWorkspaceBakSibling(deletedPath: string): Promise<void> {
    if (!isWorkspaceLayout()) return;
    if (!deletedPath.endsWith(WORKSPACE_DELETED_FILE)) return;
    const bakPath =
      deletedPath.slice(0, -'.deleted'.length) + '.bak';
    try {
      await backend.deleteFile(bakPath);
    } catch (e) {}
  }

  // opts.dir: 신 배치에서 복원할 휴지통 폴더(동명 구분). 없으면 같은 이름 중 가장 최근 삭제분.
  // opts.newName: 같은 이름의 활성 프로젝트가 있을 때 쓸 새 이름(신 배치 전용 — 구 배치는 무시).
  async restoreProject(
    name: string,
    opts?: { dir?: string; newName?: string },
  ): Promise<void> {
    this.ensureLoaded();
    if (isWorkspaceLayout()) {
      await this.restoreWorkspaceProject(name, opts);
      return;
    }
    const deletedMap = await this.scanProjectFiles('.deleted');
    const activeMap = await this.scanProjectFiles('.json');
    const deletedPath = deletedMap.get(name);

    if (activeMap.has(name)) {
      // Orphan .deleted: 활성 프로젝트가 있으니 .deleted 만 제거(구 배치 — 이미지 폴더를
      // 이름으로 공유해 동명 공존 불가)
      if (deletedPath) {
        try {
          await backend.deleteFile(deletedPath);
        } catch (e) {}
        await this.deleteWorkspaceBakSibling(deletedPath);
      }
    } else if (deletedPath) {
      // 같은 위치(폴더 포함)에 .json 으로 되돌린다 → 폴더 소속도 복원됨
      const jsonPath = deletedPath.replace(/\.deleted$/, '.json');
      await backend.renameFile(deletedPath, jsonPath);
    } else {
      throw new Error('프로젝트를 휴지통에서 찾을 수 없습니다');
    }
    delete this.data.projects[name];
    await this.saveTrash();
  }

  // 신 배치 복원(S2): project.json.deleted → project.json (접미 제거). 물리 폴더는 불변이라
  // 폴더 소속(meta.folder)도 그대로 복원된다. 같은 이름의 활성 프로젝트가 있으면 새 이름이
  // 있어야 하고, 그 경우 활성화 전에 meta.json 의 이름을 먼저 바꾼다(스캔·레지스트리는
  // meta.name 이 진실 — 본문 name 은 불러올 때 onAttached 가 맞춘다). 예전처럼 활성 동명이
  // 있다고 휴지통 쪽 .deleted 를 지우지 않는다.
  private async restoreWorkspaceProject(
    name: string,
    opts?: { dir?: string; newName?: string },
  ): Promise<void> {
    const trashed = (await this.workspaceTrashEntries()).filter((e) => e.name === name);
    const targetDir = opts?.dir
      ? trashed.find((e) => e.dir === opts.dir)?.dir
      : pickNewestTrashDir(trashed);
    if (!targetDir) throw new Error('프로젝트를 휴지통에서 찾을 수 없습니다');

    const finalName = opts?.newName !== undefined ? opts.newName : name;
    const reason = invalidProjectName(finalName);
    if (reason) throw new Error(`사용할 수 없는 프로젝트 이름입니다(${reason}).`);
    if (
      physicalDirOf(finalName) !== undefined ||
      (await this.activeProjectFileExists(finalName))
    ) {
      throw new Error(
        finalName === name
          ? `같은 이름의 프로젝트 "${name}"이(가) 이미 있습니다. 새 이름으로 복원해 주세요.`
          : `이미 존재하는 프로젝트 이름입니다: ${finalName}`,
      );
    }

    const deletedPath = workspacePath(targetDir, WORKSPACE_DELETED_FILE);
    const jsonPath = workspacePath(targetDir, PROJECT_JSON_FILE);
    const metaPath = workspacePath(targetDir, PROJECT_META_FILE);
    let prevMetaRaw: string | undefined;
    if (finalName !== name) {
      let meta: WorkspaceProjectMeta | undefined;
      try {
        prevMetaRaw = await backend.readFile(metaPath);
        meta = JSON.parse(prevMetaRaw);
      } catch (e) {
        meta = undefined;
      }
      if (!meta || typeof meta !== 'object') {
        throw new Error('프로젝트 정보(meta.json)를 읽지 못해 새 이름으로 복원하지 않았습니다.');
      }
      await backend.writeFile(metaPath, JSON.stringify({ ...meta, name: finalName }));
    }
    try {
      await backend.renameFile(deletedPath, jsonPath);
    } catch (e) {
      // 활성화 실패 — 바꿔 둔 meta 이름을 되돌린다(휴지통 항목 그대로 유지).
      if (prevMetaRaw !== undefined) {
        try {
          await backend.writeFile(metaPath, prevMetaRaw);
        } catch (e2) {}
      }
      throw e;
    }
    registerProjectDir(finalName, targetDir);

    // 휴지통 기록 정리: 이 폴더 소속 씬 기록을 새 이름으로, 프로젝트 기록에서 이 폴더 제외.
    if (finalName !== name) {
      await this.moveSceneKeys(name, finalName, (entry) => entry.projectDir === targetDir);
    }
    this.dropProjectRecord(
      name,
      targetDir,
      trashed.filter((e) => e.dir !== targetDir).map((e) => e.dir),
    );
    await this.saveTrash();
  }

  // 신 배치 영구 삭제(S2): 대상은 휴지통 폴더 하나(dir, 없으면 같은 이름 중 가장 최근 삭제분).
  // 같은 이름의 활성 프로젝트는 다른 폴더라 건드리지 않는다 — 대상 폴더 자체가 활성(본문 있음·
  // 레지스트리 등록)이면 아무것도 지우지 않는다. 스캔이 실패하면 아무것도 바꾸지 않는다.
  private async permanentlyDeleteWorkspaceProject(name: string, dir?: string): Promise<void> {
    let entries: WorkspaceScanEntry[];
    try {
      entries = await this.scanWorkspaceEntries();
    } catch (e) {
      console.error('프로젝트 영구삭제: 스캔 실패 — 아무것도 지우지 않음:', name, e);
      return;
    }
    const activeSameName = entries.some((e) => e.name === name && e.hasJson);
    const trashed = entries
      .filter((e) => e.name === name && e.hasDeleted && !e.hasJson)
      .map((e) => ({ dir: e.dir, deletedAt: this.projectDeletedAt(name, e.dir) }));
    const targetDir = dir
      ? trashed.find((t) => t.dir === dir)?.dir
      : pickNewestTrashDir(trashed);
    const remaining = trashed.filter((t) => t.dir !== targetDir).map((t) => t.dir);

    if (targetDir) {
      const registered = nameOfPhysicalDir(targetDir) !== undefined;
      const jsonExists = await backend.existFile(workspacePath(targetDir, PROJECT_JSON_FILE));
      if (registered || jsonExists) {
        console.error('프로젝트 영구삭제 거부 — 대상 폴더가 활성 상태:', targetDir);
        return;
      }
      const deletedPath = workspacePath(targetDir, WORKSPACE_DELETED_FILE);
      try {
        await backend.deleteFile(deletedPath);
      } catch (e) {}
      // 남은 .bak 이 자가치유로 부활하지 않도록 함께 제거
      await this.deleteWorkspaceBakSibling(deletedPath);
      // 프로젝트 물리 폴더(workspace/<dir>) 통째 삭제 — 이미지 6루트 + json + meta(스펙 §A-4).
      try {
        await backend.deleteDir(workspacePath(targetDir));
      } catch (e) {}
      if (physicalDirOf(name) === targetDir) unregisterProjectDir(name);
    }

    // 기록 정리: 이 폴더 소속 씬 기록. 소속 기록이 없는 옛 씬 기록(이름만)은 같은 이름의
    // 활성 프로젝트도 남은 휴지통 폴더도 없을 때만 지운다(누구 것인지 모르므로 보존 우선).
    const lastOfName = !activeSameName && remaining.length === 0;
    const prefix = name + ':';
    for (const key of Object.keys(this.data.scenes)) {
      if (!key.startsWith(prefix)) continue;
      const entry = this.data.scenes[key];
      const owned = entry?.projectDir
        ? targetDir !== undefined && entry.projectDir === targetDir
        : lastOfName;
      if (owned) delete this.data.scenes[key];
    }
    this.dropProjectRecord(name, targetDir ?? dir, remaining);
    await this.saveTrash();
    // 템플릿 지정 해제 — 같은 이름이 더 이상 어디에도 없을 때만(활성 동명의 지정은 유지).
    if (lastOfName) {
      try {
        await templateService.removeProject(name);
      } catch (e) {}
    }
  }

  // dir: 신 배치에서 영구 삭제할 휴지통 폴더(동명 구분). 없으면 같은 이름 중 가장 최근 삭제분
  // (전체 백업 덮어쓰기처럼 방금 delete 한 프로젝트를 이름으로 지우는 호출부 호환).
  async permanentlyDeleteProject(name: string, dir?: string): Promise<void> {
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

    // 신 배치: 고유 폴더 단위 영구 삭제(S2 — 동명 공존).
    if (isWorkspaceLayout()) {
      await this.permanentlyDeleteWorkspaceProject(name, dir);
      return;
    }

    // ── 이하 구 배치 ──
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

    // .deleted 파일 제거 (스캔으로 경로를 확인한 경우에만). 아래 안전 판정이
    // 실패해 폴더 삭제를 건너뛰더라도 잔여 .bak 이 자가치유로 부활하지 않도록
    // 함께 제거한다.
    if (deletedPath) {
      try {
        await backend.deleteFile(deletedPath);
      } catch (e) {}
      await this.deleteWorkspaceBakSibling(deletedPath);
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
      // (신 배치는 위 permanentlyDeleteWorkspaceProject 가 폴더 단위로 처리한다.)
      // 삭제 대상 이미지 루트 목록은 PROJECT_IMAGE_ROOTS 단일 출처를 따른다
      // (references 포함 6종 — 과거 references 누락으로 영구삭제 후
      //  references/<이름>/ 고아 디렉터리가 남던 버그 수정, 2026-07-07).
      for (const root of PROJECT_IMAGE_ROOTS) {
        try {
          await backend.deleteDir(projectPath(root, name));
        } catch (e) {}
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

  async getExpiredProjects(): Promise<DeletedProjectInfo[]> {
    this.ensureLoaded();
    const now = Date.now();
    // 스캔 실패 시(폴더 잠금/권한/동기화 등) 만료 목록을 비워 시작을 막지 않고,
    // 불확실한 상태에서 만료 다이얼로그를 띄워 삭제를 유도하지 않는다.
    let deleted: DeletedProjectInfo[];
    try {
      deleted = await this.getDeletedProjects();
    } catch (e) {
      console.error('만료 프로젝트 조회 실패 — 이번 실행은 건너뜀:', e);
      return [];
    }
    return deleted.filter(p => (now - p.deletedAt) >= PROJECT_RETENTION_MS);
  }

  // 만료 확인 창의 「미루기」. 항목은 이름(구 배치·예전 호출) 또는 {이름, 폴더}(신 배치 동명 구분).
  async deferProjects(items: (string | { name: string; dir?: string })[]): Promise<void> {
    this.ensureLoaded();
    const now = Date.now();
    for (const item of items) {
      const name = typeof item === 'string' ? item : item.name;
      const dir = typeof item === 'string' ? undefined : item.dir;
      const rec = this.data.projects[name];
      if (!rec) {
        // 신 배치에서 기록이 없던 폴더(구버전이 지운 기록 등)는 새로 만들어 둔다 — 없으면 시각
        // 0 으로 해석돼 미뤄도 매번 만료로 다시 뜬다.
        if (isWorkspaceLayout() && dir) {
          this.data.projects[name] = { deletedAt: now, dirs: { [dir]: now } };
        }
        continue;
      }
      rec.deletedAt = now;
      if (isWorkspaceLayout()) {
        if (dir) {
          rec.dirs = { ...(rec.dirs ?? {}), [dir]: now };
        } else if (rec.dirs) {
          for (const d of Object.keys(rec.dirs)) rec.dirs[d] = now;
        }
      }
    }
    if (items.length > 0) {
      await this.saveTrash();
    }
  }

  // ===== Auto-cleanup =====

  async autoCleanup(): Promise<void> {
    this.ensureLoaded();
    const now = Date.now();

    // 0. Silently clean orphan .deleted files (where .json also exists) — 폴더 포함
    //    구 배치 전용(S2): 신 배치는 같은 이름의 활성 프로젝트와 휴지통 항목이 다른 폴더로
    //    공존하므로 「동명 활성 존재 = 고아」가 아니다 — 지우면 휴지통 항목이 사라진다.
    if (!isWorkspaceLayout()) {
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
            await this.deleteWorkspaceBakSibling(path);
            delete this.data.projects[name];
            changed = true;
          }
        }
        if (changed) {
          await this.saveTrash();
        }
      } catch (e) {}
    }

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
            const removedPaths: string[] = [];
            // 고아 입양: .trash 에 실재하지만 meta 에 없는 파일(과거 삭제 실패로
            // meta 만 지워진 잔재 등)은 지금 시각으로 등록해 보관 기한(3일)의
            // 시계를 다시 돌린다 — 등록이 없으면 자동 정리 대상에서 영구히 빠진다.
            try {
              const actual = (
                await backend.listFiles(
                  projectPath(imgDir, projectName, sceneDir, IMAGE_TRASH_DIR),
                )
              ).filter(isOutputImageFile);
              for (const f of actual) {
                if (!(f in meta)) {
                  meta[f] = now;
                  metaChanged = true;
                }
              }
            } catch (e) {}
            for (const [filename, deletedAt] of Object.entries(meta)) {
              const age = now - deletedAt;
              if (age >= IMAGE_RETENTION_MS) {
                const trashPath = projectPath(
                  imgDir, projectName, sceneDir, IMAGE_TRASH_DIR, filename,
                );
                let removed = false;
                try {
                  await backend.deleteFile(trashPath);
                  removed = true;
                } catch (e) {
                  // ENOENT(이미 없음)만 정리로 간주 — 잠금 등 실패는 meta 를
                  // 남겨 다음 자동 정리에서 재시도한다.
                  removed = !(await backend.existFile(trashPath).catch(() => true));
                }
                if (removed) {
                  delete meta[filename];
                  metaChanged = true;
                  removedPaths.push(trashPath);
                }
              }
            }
            try {
              await imageService.invalidateCacheBatch(removedPaths);
            } catch (e) {}
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
