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
import { ImageService } from './ImageService';
import { ImageDownloadService } from './ImageDownloadService';
import { LoginService } from './LoginService';
import { PromptService } from './PromptService';
import { SessionService } from './SessionService';
import { TaskQueueService } from './TaskQueueService';
import { taskHandlers } from './TaskHandlers';
import { LocalAIService } from './LocalAIService';
import { AppUpdateNoticeService } from './AppUpdateNoticeService';
import { WorkFlowService } from './workflows/WorkFlowService';
import { registerWorkFlows } from './workflows';
import { TrashService } from './TrashService';
import { CyclingSessionService } from './CyclingSessionService';
import { GlobalPieceService } from './GlobalPieceService';
import { GlobalPresetService } from './GlobalPresetService';
import { GlobalCharacterPresetService } from './GlobalCharacterPresetService';
import { BackgroundNotificationService } from './BackgroundNotificationService';
import { BackgroundKeepAliveService } from './BackgroundKeepAliveService';
import { ProjectSizeService } from './ProjectSizeService';
import { ArtistTagService } from './ArtistTagService';
import { ArtistLibraryService } from './ArtistLibraryService';
import { BackupService } from './BackupService';
import { BatchProcessService } from './BatchProcessService';
import { ExportPresetService } from './ExportPresetService';

export const backend =
  window.electron != null ? new ElectornBackend() : new AndroidBackend();

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

export const sessionService = new SessionService();
sessionService.run();

export const imageService = new ImageService();

export const trashService = new TrashService();

export const imageDownloadService = new ImageDownloadService();

// 프로젝트별 용량 수동 계산 (시작 시 로드 없음 — 설정 화면에서 지연 로드)
export const projectSizeService = new ProjectSizeService();

// 아티스트 태깅 (데스크톱 전용, 시작 시 비용 없음 — 모달에서 지연 사용)
export const artistTagService = new ArtistTagService();

// 내보내기 프리셋을 localStorage → exportPresets.json(로컬 파일)로 이관 + 로드.
// (시작 후 비동기 — 파일 없으면 localStorage에서 1회 비파괴 이관)
// 동적 import: AppService 조기 평가로 초기화 순서가 바뀌지 않도록 index 본문 이후로 미룸.
import('./AppService').then((m) => m.appState.initExportPresets());

export const globalPieceService = new GlobalPieceService();
globalPieceService.load();

export const globalPresetService = new GlobalPresetService();
globalPresetService.load();

export const globalCharacterPresetService = new GlobalCharacterPresetService();
globalCharacterPresetService.load();

export const artistLibraryService = new ArtistLibraryService();
artistLibraryService.load();

// 백업/내보내기/가져오기 (AppService 에서 분리). 생성자 비용 없음.
export const backupService = new BackupService();

// 배치 처리/해상도 변경 (AppService 에서 분리). 생성자 비용 없음.
export const batchProcessService = new BatchProcessService();

// 내보내기 프리셋/패키지 (AppService 에서 분리). 생성자 비용 없음.
export const exportPresetService = new ExportPresetService();

export const promptService = new PromptService();

export const taskQueueService = new TaskQueueService(taskHandlers);
// 이전 실행에서 저장된 작업 로그 복원(비동기 — 파일 없으면 무시).
taskQueueService.loadLogs();

export const loginService = new LoginService();

export const gameService = new GameService();

export const workFlowService = new WorkFlowService();
registerWorkFlows(workFlowService);

window.promptService = promptService;
window.sessionService = sessionService;
window.imageService = imageService;
window.imageDownloadService = imageDownloadService;
window.taskQueueService = taskQueueService;
window.loginService = loginService;
window.globalPresetService = globalPresetService;

backend.onClose(() => {
  (async () => {
    try {
      await sessionService.flushOnClose();
      await globalPresetService.flushSave();
      await globalPieceService.flushSave();
      await globalCharacterPresetService.flushSave();
      await artistLibraryService.flushSave();
      await taskQueueService.flushSaveLogs();
    } catch (e) {
      console.error('종료 시 저장 실패:', e);
    } finally {
      await backend.close();
    }
  })();
});

export const appUpdateNoticeService = new AppUpdateNoticeService();
appUpdateNoticeService.run();

export const localAIService = new LocalAIService();
localAIService.statsModels();

export const cyclingSessionService = new CyclingSessionService();

// 모바일 백그라운드 포그라운드 서비스 알림에 생성 진행 상태를 표시
export const backgroundNotificationService = new BackgroundNotificationService();
backgroundNotificationService.start();

// 모바일 백그라운드 생성 중 Chromium 페이지 동결 우회 (무음 오디오 keep-alive)
export const backgroundKeepAliveService = new BackgroundKeepAliveService();
backgroundKeepAliveService.start();
