import { backend } from '.';
import { GenericScene, IInpaintScene, IScene, Session, genericSceneFromJSON } from './types';
import { imageService } from '.';

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
    try {
      const str = await backend.readFile(TRASH_FILE);
      const parsed = JSON.parse(str);
      this.data = {
        scenes: parsed.scenes || {},
        projects: parsed.projects || {},
      };
    } catch (e) {
      this.data = { scenes: {}, projects: {} };
    }
    this.loaded = true;
  }

  async saveTrash(): Promise<void> {
    await backend.writeFile(TRASH_FILE, JSON.stringify(this.data));
    this.dispatchEvent(new CustomEvent('trash-updated'));
  }

  private ensureLoaded() {
    if (!this.loaded) throw new Error('TrashService not loaded');
  }

  // ===== Image trash =====

  private getImageTrashDir(session: Session, scene: GenericScene): string {
    const base = scene.type === 'scene'
      ? 'outs/' + session.name + '/' + scene.name
      : 'inpaints/' + session.name + '/' + scene.name;
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
    await backend.writeFile(this.getImageTrashMetaPath(session, scene), JSON.stringify(meta));
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
    files = files.filter((f: string) => f.endsWith('.png'));
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
      ? 'outs/' + session.name + '/' + scene.name
      : 'inpaints/' + session.name + '/' + scene.name;
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

    // Move scene output directory to .trash/
    const imgDir = scene.type === 'scene' ? 'outs' : 'inpaints';
    const srcDir = imgDir + '/' + session.name + '/' + scene.name;
    const dstDir = imgDir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/' + scene.name;

    // Ensure .trash directory exists by writing a placeholder
    try {
      await backend.writeFile(imgDir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/.gitkeep', '');
    } catch (e) {}

    try {
      await backend.renameDir(srcDir, dstDir);
    } catch (e) {
      console.error('씬 디렉토리 휴지통 이동 실패:', e);
    }

    // For inpaint scenes, also move mask and org files
    if (scene.type === 'inpaint') {
      for (const dir of ['inpaint_masks', 'inpaint_orgs']) {
        const maskSrc = dir + '/' + session.name + '/' + scene.name + '.png';
        const maskDst = dir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/' + scene.name + '.png';
        try {
          await backend.writeFile(dir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/.gitkeep', '');
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

    // Move directory back
    const imgDir = sceneType === 'scene' ? 'outs' : 'inpaints';
    const srcDir = imgDir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/' + sceneName;
    const dstDir = imgDir + '/' + session.name + '/' + sceneName;
    try {
      await backend.renameDir(srcDir, dstDir);
    } catch (e) {
      console.error('씬 디렉토리 복원 실패:', e);
    }

    // For inpaint scenes, restore mask and org
    if (sceneType === 'inpaint') {
      for (const dir of ['inpaint_masks', 'inpaint_orgs']) {
        const maskSrc = dir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/' + sceneName + '.png';
        const maskDst = dir + '/' + session.name + '/' + sceneName + '.png';
        try {
          await backend.renameFile(maskSrc, maskDst);
        } catch (e) {}
      }
    }

    // Re-add scene to session
    const restoredScene = genericSceneFromJSON(entry.sceneData);
    session.addScene(restoredScene);

    // Remove from trash
    delete this.data.scenes[key];
    await this.saveTrash();
  }

  async permanentlyDeleteScene(projectName: string, sceneName: string, sceneType: 'scene' | 'inpaint'): Promise<void> {
    this.ensureLoaded();
    const key = this.sceneKey(projectName, sceneName);

    // Delete directory
    const imgDir = sceneType === 'scene' ? 'outs' : 'inpaints';
    const dir = imgDir + '/' + projectName + '/' + IMAGE_TRASH_DIR + '/' + sceneName;
    try {
      await backend.deleteDir(dir);
    } catch (e) {}

    // Delete mask/org for inpaint
    if (sceneType === 'inpaint') {
      for (const maskDir of ['inpaint_masks', 'inpaint_orgs']) {
        try {
          await backend.deleteFile(maskDir + '/' + projectName + '/' + IMAGE_TRASH_DIR + '/' + sceneName + '.png');
        } catch (e) {}
      }
    }

    delete this.data.scenes[key];
    await this.saveTrash();
  }

  // ===== Project trash =====

  // projects 루트 + 1단계 폴더 디렉터리 경로 목록.
  // (SessionService.getList 의 폴더 탐지 패턴과 동일: listFiles[파일+디렉토리] - listFilesWithStats[파일만] = 폴더)
  private async getProjectDirs(): Promise<string[]> {
    let entries: string[] = [];
    let rootStats: any[] = [];
    try {
      entries = await backend.listFiles('projects');
      rootStats = await backend.listFilesWithStats('projects');
    } catch (e) {
      return ['projects'];
    }
    const rootFileSet = new Set(rootStats.map((s: any) => s.name));
    const dirs = entries.filter(
      (e: string) => !rootFileSet.has(e) && !e.startsWith('.'),
    );
    return ['projects', ...dirs.map((d) => 'projects/' + d)];
  }

  // 주어진 확장자(.json / .deleted)를 가진 프로젝트 파일을 루트 + 폴더에서 모두 찾아
  // 이름 → 전체경로 맵으로 반환한다. (동명은 루트 우선)
  private async scanProjectFiles(suffix: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const dirs = await this.getProjectDirs();
    for (const dir of dirs) {
      let stats: any[] = [];
      try {
        stats = await backend.listFilesWithStats(dir);
      } catch (e) {
        stats = [];
      }
      for (const s of stats) {
        if (s.name.endsWith(suffix)) {
          const name = s.name.substring(0, s.name.length - suffix.length);
          if (!map.has(name)) map.set(name, dir + '/' + s.name);
        }
      }
    }
    return map;
  }

  // 특정 이름의 .deleted 파일 전체 경로(루트+폴더, 중복 위치 포함)를 찾는다.
  private async findAllDeletedPaths(name: string): Promise<string[]> {
    const target = name + '.deleted';
    const dirs = await this.getProjectDirs();
    const result: string[] = [];
    for (const dir of dirs) {
      let stats: any[] = [];
      try {
        stats = await backend.listFilesWithStats(dir);
      } catch (e) {
        stats = [];
      }
      if (stats.some((s: any) => s.name === target)) {
        result.push(dir + '/' + target);
      }
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

  async getDeletedProjects(): Promise<{name: string, deletedAt: number}[]> {
    this.ensureLoaded();
    // 루트 + 폴더 하위까지 .deleted / .json 을 모두 스캔 (폴더 소속 프로젝트 포함)
    const deletedMap = await this.scanProjectFiles('.deleted');
    const activeMap = await this.scanProjectFiles('.json');

    const result: { name: string; deletedAt: number }[] = [];
    for (const name of deletedMap.keys()) {
      // 동명의 활성 .json 이 있으면 orphan 이므로 제외
      if (activeMap.has(name)) continue;
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
      // 같은 위치(폴더 포함)에 .json 으로 되돌린다 → 폴더 소속도 복원됨
      const jsonPath = deletedPath.replace(/\.deleted$/, '.json');
      await backend.renameFile(deletedPath, jsonPath);
    } else {
      throw new Error('프로젝트를 휴지통에서 찾을 수 없습니다');
    }
    delete this.data.projects[name];
    await this.saveTrash();
  }

  async permanentlyDeleteProject(name: string): Promise<void> {
    this.ensureLoaded();

    // CRITICAL: Check if an active .json exists for this project (루트/폴더 모두).
    // If both .json and .deleted coexist (legacy duplicate), only remove
    // the .deleted file — NEVER touch the directories.
    const deletedMap = await this.scanProjectFiles('.deleted');
    const activeMap = await this.scanProjectFiles('.json');
    const deletedPath = deletedMap.get(name);
    const activeExists = activeMap.has(name);

    // Delete the .deleted file (위치 무관)
    if (deletedPath) {
      try {
        await backend.deleteFile(deletedPath);
      } catch (e) {}
    }

    // Only delete directories if there is NO active project with same name.
    // 이미지 디렉터리는 폴더와 무관하게 이름 기준(outs/<이름> 등)이므로 그대로 유효.
    if (!activeExists) {
      for (const dir of ['outs', 'inpaints', 'vibes', 'inpaint_masks', 'inpaint_orgs']) {
        try {
          await backend.deleteDir(dir + '/' + name);
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
  }

  // ===== Expired project management =====

  async getExpiredProjects(): Promise<{name: string, deletedAt: number}[]> {
    this.ensureLoaded();
    const now = Date.now();
    const deleted = await this.getDeletedProjects();
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
      for (const imgDir of ['outs', 'inpaints']) {
        let sceneDirs: string[];
        try {
          sceneDirs = await backend.listFiles(imgDir + '/' + projectName);
        } catch (e) {
          continue;
        }
        for (const sceneDir of sceneDirs) {
          if (sceneDir === IMAGE_TRASH_DIR || sceneDir.startsWith('.')) continue;
          const trashMetaPath = imgDir + '/' + projectName + '/' + sceneDir + '/' + IMAGE_TRASH_DIR + '/' + TRASH_META_FILE;
          try {
            const metaStr = await backend.readFile(trashMetaPath);
            const meta: TrashImageMeta = JSON.parse(metaStr);
            let metaChanged = false;
            for (const [filename, deletedAt] of Object.entries(meta)) {
              const age = now - deletedAt;
              if (age >= IMAGE_RETENTION_MS) {
                try {
                  await backend.deleteFile(
                    imgDir + '/' + projectName + '/' + sceneDir + '/' + IMAGE_TRASH_DIR + '/' + filename,
                  );
                } catch (e) {}
                delete meta[filename];
                metaChanged = true;
              }
            }
            if (metaChanged) {
              await backend.writeFile(trashMetaPath, JSON.stringify(meta));
            }
          } catch (e) {
            // No trash meta = no trash images to clean
          }
        }
      }
    }
  }
}
