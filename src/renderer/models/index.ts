import {
  ImageGenInput,
  Model,
  NoiseSchedule,
  Resolution,
  Sampling,
} from '../backends/imageGen';
import { CircularQueue } from '../circularQueue';

import { v4 as uuidv4, v4 } from 'uuid';
import ExifReader from 'exifreader';
import { ElectornBackend } from '../backends/electronBackend';
import { AndroidBackend } from '../backends/androidBackend';
import extractChunks from 'png-chunks-extract';
import encodeChunks from 'png-chunks-encode';
import { Buffer } from 'buffer';
import { FileEntry } from '../backend';
import { Session } from 'inspector';
import { GameService } from './GameService';
import {
  copyImageFilesInto,
  deleteImageFilesDetailed,
  ImageService,
  setImageMain,
} from './ImageService';
import { ImageDownloadService } from './ImageDownloadService';
import { LoginService } from './LoginService';
import { PromptService } from './PromptService';
import { renameInpaintScene, renameScene, SessionService } from './SessionService';
import { TaskQueueService } from './TaskQueueService';
import { BoostPlanner } from './boostPlanner';
import { BOOST_TEXT } from './boostMode';
import { taskHandlers } from './TaskHandlers';
import { LocalAIService } from './LocalAIService';
import { AppUpdateNoticeService } from './AppUpdateNoticeService';
import { WorkFlowService } from './workflows/WorkFlowService';
import { registerWorkFlows } from './workflows';
import { IMAGE_RETENTION_DAYS, SCENE_RETENTION_DAYS, TrashService } from './TrashService';
import { CyclingSessionService } from './CyclingSessionService';
import { GlobalPieceService } from './GlobalPieceService';
import { GlobalPresetService } from './GlobalPresetService';
import type { GlobalPresetType } from './GlobalPresetService';
import { GlobalCharacterPresetService } from './GlobalCharacterPresetService';
import { BackgroundNotificationService } from './BackgroundNotificationService';
import { BackgroundKeepAliveService } from './BackgroundKeepAliveService';
import { ProjectSizeService } from './ProjectSizeService';
import { TemplateService } from './TemplateService';
import { ProjectTemplateService } from './ProjectTemplateService';
import { ArtistTagService } from './ArtistTagService';
import { ArtistLibraryService } from './ArtistLibraryService';
import { BackupService } from './BackupService';
import { BatchProcessService } from './BatchProcessService';
import { ExportPresetService } from './ExportPresetService';
import { ImageHistoryService } from './ImageHistoryService';
import { OpusUsageService } from './OpusUsageService';
import { undoService } from './undoService';
import { configureSceneStructureUndo, SceneStructureOps } from './sceneStructureUndo';
import { configureImageStateUndo } from './imageStateUndo';
import { configureDeleteUndo } from './deleteUndo';
import { configurePieceUndo } from './pieceUndo';
import { configureProjectFolderUndo } from './projectFolderUndo';
import { configureProjectDeleteUndo } from './projectDeleteUndo';
import { configureGlobalLibraryUndo } from './globalLibraryUndo';
import { runProjectTrashDelete } from './projectDeleteFlow';
import { physicalDirOf } from './storageLayout';

export const backend =
  window.electron != null ? new ElectornBackend() : new AndroidBackend();

export const opusUsageService = new OpusUsageService(backend);

export const isMobile = window.electron == null;

export class ZipService extends EventTarget {
  isZipping: boolean;
  constructor() {
    super();
    this.isZipping = false;
  }

  async zipFiles(files: FileEntry[], outPath: string) {
    this.isZipping = true;
    try {
      await backend.zipFiles(files, outPath);
    } finally {
      // 예외가 나도 잠금이 영구 고착되지 않도록 항상 해제
      this.isZipping = false;
    }
  }
}

export const zipService = new ZipService();

// ⚠️ 이 모듈은 "싱글톤 생성 + 순수(동기) 배선"만 담당한다.
// 비동기 IO 를 동반하는 초기화(로드/스캔/루프 시작)는 전부 bootstrap.ts 의
// bootstrapApp() 이 명시적 순서로 수행한다 — 모듈 평가 시점 사이드이펙트 금지.
export const sessionService = new SessionService();

// 되돌리기 스택의 미러(읽기 전용) 판정 배선 — undoService 는 순환 import 를 피하려 sessionService 를 직접 참조하지 않는다
undoService.configure({ isMirror: (s) => sessionService.isMirror(s.name) });

export const imageService = new ImageService();

export const trashService = new TrashService();

// 씬 구조(생성·이름·북마크) 되돌리기가 부르는 공개 서비스 메서드 배선 — 각 메서드가 자기 관문(다른 창 잠금·withLock·이동 검증)을 지킨다
const sceneStructureOps: SceneStructureOps = {
  moveSceneToTrash: (s, scene) => trashService.moveSceneToTrash(s, scene),
  restoreScene: (s, slot) => trashService.restoreScene(s, slot),
  renameScene: (s, from, to) => renameScene(s, from, to),
  renameInpaintScene: (s, from, to) => renameInpaintScene(s, from, to),
  getSceneBookmark: (project) => sessionService.getSceneBookmark(project),
  setSceneBookmark: (project, value) => sessionService.setSceneBookmark(project, value),
  // 휴지통 기록이 아직 있는가(14일 경과·비우기·영구 삭제 판정 — 목록을 못 읽으면 판정을 restoreScene 에 맡김)
  hasTrashedScene: (s, slot) => {
    try {
      return trashService.getDeletedScenes(s.name).some((d) => d.name === slot);
    } catch (e) {
      return true;
    }
  },
  sceneRetentionDays: SCENE_RETENTION_DAYS,
};
configureSceneStructureUndo(sceneStructureOps);

export const imageDownloadService = new ImageDownloadService();

// 프로젝트별 용량 수동 계산 (시작 시 로드 없음 — 설정 화면에서 지연 로드)
export const projectSizeService = new ProjectSizeService();

// 프로젝트 템플릿 지정 (시작 시 로드 없음 — 생성/지정 시 지연 로드)
export const templateService = new TemplateService();

// 프로젝트 템플릿 엔티티 (프로젝트 상속 v2 — 시작 시 로드 없음, 지연 로드)
export const projectTemplateService = new ProjectTemplateService();

// 프로젝트·폴더 되돌리기(2차 묶음 2 P1-a, 전역 스택)가 부르는 공개 서비스 메서드 배선 — 각 메서드가 자기 관문을 지킨다
configureProjectFolderUndo({
  listProjects: () => sessionService.list(),
  listFolders: () => sessionService.listFolders(),
  isFavorite: (name) => sessionService.isFavorite(name),
  setFavorite: (name, on) => sessionService.setFavorite(name, on),
  getFolderColor: (folder) => sessionService.getFolderColor(folder),
  setFolderColor: (folder, color) => sessionService.setFolderColor(folder, color),
  getOrderedFolders: () => sessionService.getOrderedFolders(),
  setFolderOrder: (order) => sessionService.setFolderOrder(order),
  getFolderOf: (name) => sessionService.getFolderOf(name),
  moveToFolder: (name, folder) => sessionService.moveToFolder(name, folder),
  renameFolder: (from, to) => sessionService.renameFolder(from, to),
  createFolder: (folder) => sessionService.createFolder(folder),
  deleteFolder: (folder) => sessionService.deleteFolder(folder),
  getProjectsInFolder: (folder) => sessionService.getProjectsInFolder(folder),
  // 지연 로드 서비스 — 읽기 전에 불러온다(못 읽으면 지정 없음으로 — 그때는 removeFolder 도 지정을 건드리지 않는다)
  hasFolderTemplate: async (folder) => {
    await templateService.ensureLoaded();
    return !!templateService.getFolderTemplate(folder);
  },
});

// 프로젝트·폴더 삭제류 되돌리기(2차 묶음 3 P1-b, 전역 스택) — 삭제는 projectDeleteFlow, 복원은 restoreProjectFromTrash 관문만
configureProjectDeleteUndo({
  listProjects: () => sessionService.list(),
  listFolders: () => sessionService.listFolders(),
  getFolderOf: (name) => sessionService.getFolderOf(name),
  physicalDirOf: (name) => physicalDirOf(name),
  getDeletedProjects: () => trashService.getDeletedProjects(),
  deleteProject: (name) => runProjectTrashDelete(name),
  restoreFromTrash: (name, opts) => sessionService.restoreProjectFromTrash(name, opts),
  moveToFolder: (name, folder) => sessionService.moveToFolder(name, folder),
  createFolder: (folder) => sessionService.createFolder(folder),
  deleteFolder: (folder) => sessionService.deleteFolder(folder),
  folderDeleteTarget: (folder) => sessionService.folderDeleteTarget(folder),
  getFolderColor: (folder) => sessionService.getFolderColor(folder),
  setFolderColor: (folder, color) => sessionService.setFolderColor(folder, color),
  getOrderedFolders: () => sessionService.getOrderedFolders(),
  setFolderOrder: (order) => sessionService.setFolderOrder(order),
  getProjectsInFolder: (folder) => sessionService.getProjectsInFolder(folder),
  snapshotFolderTemplates: (folder) => templateService.snapshotFolderTemplates(folder),
  restoreFolderTemplates: (snap) => templateService.restoreFolderTemplates(snap),
});

// 아티스트 태깅 (데스크톱 전용, 시작 시 비용 없음 — 모달에서 지연 사용)
export const artistTagService = new ArtistTagService();

export const globalPieceService = new GlobalPieceService();

// 로컬 조각 되돌리기(U5) — 되살린 뒤 자동완성 조각 목록을 다시 만든다
configurePieceUndo({ onRestored: (s) => void sessionService.reloadPieceLibraryDB(s) });

export const globalPresetService = new GlobalPresetService();

export const globalCharacterPresetService = new GlobalCharacterPresetService();

export const artistLibraryService = new ArtistLibraryService();

// 백업/내보내기/가져오기 (AppService 에서 분리). 생성자 비용 없음.
export const backupService = new BackupService();

// 배치 처리/해상도 변경 (AppService 에서 분리). 생성자 비용 없음.
export const batchProcessService = new BatchProcessService();

// 내보내기 프리셋/패키지 (AppService 에서 분리). 생성자 비용 없음.
export const exportPresetService = new ExportPresetService();

// 전역 라이브러리 되돌리기(2차 묶음 4 P5, 전역 스택)가 부르는 공개 서비스 메서드 배선 — 저장·changed·다른 창 알림은 각 메서드가 한다
configureGlobalLibraryUndo({
  characters: {
    list: () => globalCharacterPresetService.list(),
    get: (id) => globalCharacterPresetService.get(id),
    getByName: (name) => globalCharacterPresetService.getByName(name),
    listFolders: () => globalCharacterPresetService.listFolders(),
    registeredFolders: () => globalCharacterPresetService.folders.slice(),
    rename: (id, name) => globalCharacterPresetService.rename(id, name),
    reorder: (from, to) => globalCharacterPresetService.reorder(from, to),
    setFolder: (id, folder) => globalCharacterPresetService.setFolder(id, folder),
    createFolder: (name, at) => globalCharacterPresetService.createFolder(name, at),
    renameFolder: (from, to) => globalCharacterPresetService.renameFolder(from, to),
    deleteFolder: (name) => globalCharacterPresetService.deleteFolder(name),
  },
  presets: {
    get: (id) => globalPresetService.get(id),
    getByName: (type, name) => globalPresetService.getByName(type as GlobalPresetType, name),
    rename: (id, name) => globalPresetService.rename(id, name),
    setDefault: (id, value) => globalPresetService.setDefault(id, value),
  },
  artists: {
    getArtist: (id) => artistLibraryService.getArtist(id),
    findArtistByName: (name, excludeId) => artistLibraryService.findArtistByName(name, excludeId),
    tagPresets: () => artistLibraryService.tagPresets.slice(),
    renameArtist: (id, name) => artistLibraryService.renameArtist(id, name),
    setFavorite: (id, on) => artistLibraryService.setFavorite(id, on),
    setThumbnail: (id, imageId) => artistLibraryService.setThumbnail(id, imageId),
    setImageOrder: (id, ids) => artistLibraryService.setImageOrder(id, ids),
    setImageFamily: (id, imageId, family) => artistLibraryService.setImageFamily(id, imageId, family),
    addTag: (id, tag) => artistLibraryService.addTag(id, tag),
    removeTag: (id, tag) => artistLibraryService.removeTag(id, tag),
    setTags: (id, tags) => artistLibraryService.setTags(id, tags),
    addTagPreset: (tag) => artistLibraryService.addTagPreset(tag),
    removeTagPreset: (tag) => artistLibraryService.removeTagPreset(tag),
    setTagPresets: (tags) => artistLibraryService.setTagPresets(tags),
  },
  exportPresets: {
    load: () => exportPresetService.loadExportPresets(),
    save: (presets) => exportPresetService.saveExportPresets(presets as any),
  },
  templates: {
    get: (id) => projectTemplateService.get(id),
    getByName: (name) => projectTemplateService.getByName(name),
    rename: (id, name) => projectTemplateService.rename(id, name),
    setBadgeColor: (id, color) => projectTemplateService.setBadgeColor(id, color),
  },
});

export const promptService = new PromptService();

export const taskQueueService = new TaskQueueService(taskHandlers);

export const loginService = new LoginService();

// 부스트 모드 참여 계정 결정(B2). 토큰은 LoginService → 판정기 → 큐 워커 메모리로만 흐른다(IPC·미러·로그 없음).
const boostPlanner = new BoostPlanner({
  getConfig: () => backend.getConfig(),
  getAccountSnapshot: () => loginService.getBoostAccountSnapshot(),
  getUsageForToken: (token) => backend.getOpusUsageStatusForToken(token),
});
taskQueueService.boostPlanner = boostPlanner;
// 토큰 목록·활성 토큰이 바뀌면 마지막 참여 결과를 버린다(다음 예약·실행이 새로 조회).
loginService.addEventListener('token-profiles-change', () => boostPlanner.invalidate());
loginService.addEventListener('change', () => boostPlanner.invalidate());
// 부스트 다중 계정 실행 중에는 수동 계정 전환·토큰 로그인·토큰 삭제를 서비스에서 거부한다(B3 — UI 비활성과 같은 판정).
loginService.setAccountSwitchGuard(() =>
  taskQueueService.isBoostAccountLocked() ? BOOST_TEXT.accountSwitchLocked : undefined,
);

export const gameService = new GameService();

// 이미지 상태(즐겨찾기·북마크·순서·순위) 되돌리기가 부르는 공개 메서드 배선 — 이미지 필드 대입은 이 메서드들만 한다
// (즐겨찾기 = setImageMain 절대값+다른 창 알림, 순서·순위 = GameService 병합 복원)
configureImageStateUndo({
  setImageMain: (s, scene, filename, on) => setImageMain(s, scene, filename, on),
  getImageBookmark: (project, scene) => sessionService.getImageBookmark(project, scene),
  setImageBookmark: (project, scene, filename) => sessionService.setImageBookmark(project, scene, filename),
  applyImageOrder: (scene, order) => gameService.applyImageOrder(scene, order),
  applyRanking: (s, scene, snap) => gameService.applyRanking(s, scene, snap),
  refreshScene: (s, scene) => imageService.refresh(s, scene),
});

// 삭제·휴지통 복원·복제·복사·붙여넣기 되돌리기(U4)가 부르는 공개 메서드 배선 — 파일 이동은 휴지통 관문(이동 검증·meta 큐),
// 이미지 필드 대입은 setImageMain·applyImageOrder·applyRanking 만. 씬 쪽은 씬 구조 되돌리기와 같은 배선을 쓴다.
configureDeleteUndo({
  images: {
    outputDir: (s, scene) => imageService.getOutputDir(s, scene),
    deleteImageFiles: (s, scene, paths, opts) => deleteImageFilesDetailed(s, paths, scene, opts),
    restoreImages: (s, scene, filenames) => trashService.restoreImages(s, scene, filenames),
    refreshScene: (s, scene) => imageService.refresh(s, scene),
    setImageMain: (s, scene, filename, on) => setImageMain(s, scene, filename, on),
    applyImageOrder: (scene, order) => gameService.applyImageOrder(scene, order),
    applyRanking: (s, scene, snap) => gameService.applyRanking(s, scene, snap),
    copyImageFiles: (s, scene, srcPaths) => copyImageFilesInto(s, scene, srcPaths),
    imageRetentionDays: IMAGE_RETENTION_DAYS,
  },
  scenes: sceneStructureOps,
});

// 최근 생성 이미지 히스토리 (history.json 영속, 전체 최근 30장 — 우측 사이드바)
export const imageHistoryService = new ImageHistoryService();

export const workFlowService = new WorkFlowService();
registerWorkFlows(workFlowService);

window.promptService = promptService;
window.sessionService = sessionService;
window.imageService = imageService;
window.imageDownloadService = imageDownloadService;
window.taskQueueService = taskQueueService;
window.loginService = loginService;
window.globalPresetService = globalPresetService;

export const appUpdateNoticeService = new AppUpdateNoticeService();

export const localAIService = new LocalAIService();

export const cyclingSessionService = new CyclingSessionService();

// 모바일 백그라운드 포그라운드 서비스 알림에 생성 진행 상태를 표시
export const backgroundNotificationService = new BackgroundNotificationService();

// 모바일 백그라운드 생성 중 Chromium 페이지 동결 우회 (무음 오디오 keep-alive)
export const backgroundKeepAliveService = new BackgroundKeepAliveService();
