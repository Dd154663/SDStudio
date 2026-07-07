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
import { TemplateService } from './TemplateService';
import { ArtistTagService } from './ArtistTagService';
import { ArtistLibraryService } from './ArtistLibraryService';
import { BackupService } from './BackupService';
import { BatchProcessService } from './BatchProcessService';
import { ExportPresetService } from './ExportPresetService';
import { ImageHistoryService } from './ImageHistoryService';

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

// ⚠️ 이 모듈은 "싱글톤 생성 + 순수(동기) 배선"만 담당한다.
// 비동기 IO 를 동반하는 초기화(로드/스캔/루프 시작)는 전부 bootstrap.ts 의
// bootstrapApp() 이 명시적 순서로 수행한다 — 모듈 평가 시점 사이드이펙트 금지.
export const sessionService = new SessionService();

export const imageService = new ImageService();

export const trashService = new TrashService();

export const imageDownloadService = new ImageDownloadService();

// 프로젝트별 용량 수동 계산 (시작 시 로드 없음 — 설정 화면에서 지연 로드)
export const projectSizeService = new ProjectSizeService();

// 프로젝트 템플릿 지정 (시작 시 로드 없음 — 생성/지정 시 지연 로드)
export const templateService = new TemplateService();

// 아티스트 태깅 (데스크톱 전용, 시작 시 비용 없음 — 모달에서 지연 사용)
export const artistTagService = new ArtistTagService();

export const globalPieceService = new GlobalPieceService();

export const globalPresetService = new GlobalPresetService();

export const globalCharacterPresetService = new GlobalCharacterPresetService();

export const artistLibraryService = new ArtistLibraryService();

// 백업/내보내기/가져오기 (AppService 에서 분리). 생성자 비용 없음.
export const backupService = new BackupService();

// 배치 처리/해상도 변경 (AppService 에서 분리). 생성자 비용 없음.
export const batchProcessService = new BatchProcessService();

// 내보내기 프리셋/패키지 (AppService 에서 분리). 생성자 비용 없음.
export const exportPresetService = new ExportPresetService();

export const promptService = new PromptService();

export const taskQueueService = new TaskQueueService(taskHandlers);

export const loginService = new LoginService();

export const gameService = new GameService();

// 최근 생성 이미지 히스토리 (메모리 기반, 프로젝트 무관 — 우측 사이드바)
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
