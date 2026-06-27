import { ModelVersion } from '../renderer/backends/imageGen';

export type ImageEditor = 'photoshop' | 'gimp' | 'mspaint';

export type ModelType = 'fast' | 'quality';

export type RemoveBgQuality =
  | 'low'
  | 'normal'
  | 'high'
  | 'veryhigh'
  | 'veryveryhigh';

export interface DownloadSettings {
  lastSavePath?: string;
  defaultPrefix?: string;
  defaultSuffix?: string;
  autoNumbering?: boolean;
  overwriteExisting?: boolean;
  includeTimestamp?: boolean;
}

export interface ImageSaveSettings {
  autoSaveEnabled?: boolean; // 자동 저장 활성화 여부 (기본값: true - 하위 호환성)
  saveToHistory?: boolean; // 히스토리에 저장 (기본값: true)
}

export interface Config {
  imageEditor?: ImageEditor;
  modelType?: ModelType;
  removeBgQuality?: RemoveBgQuality;
  useLocalBgRemoval?: boolean;
  useCUDA?: boolean;
  saveLocation?: string;
  noIpCheck?: boolean;
  refreshImage?: boolean;
  uuid?: string;
  whiteMode?: boolean;
  disableQuality?: boolean;
  modelVersion?: ModelVersion;
  delayTime?: number;
  furryMode?: boolean;
  downloadSettings?: DownloadSettings;
  imageSaveSettings?: ImageSaveSettings;
  classicSceneCard?: boolean;
  legacyProjectMode?: boolean;
  exportConcurrency?: number;
  /** 이미지 export 시 기본 목표 폴더(데스크톱 전용 — 프리셋에 폴더가 없을 때 사용) */
  defaultExportFolder?: string;
  trueDark?: boolean;
  // 저장소(스토리지) 접근이 불안정할 때 자동 저장을 일시정지해 데이터 손상을 막는다.
  // 기본 ON. OFF 시 항상 저장을 시도(불안정 시 손상 위험은 있으나 작업 롤백 체감은 없음).
  storageWriteGuard?: boolean;
  // 아티스트 태깅의 WD 태거 모델 선택 (기본 wd-swinv2)
  wdTaggerModel?: 'wd-swinv2' | 'wd-eva02';
}
