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
  // 모바일 권한 안내 모달에서 '거절'을 선택 — 해당 권한을 다시 묻지 않는다.
  // (안내에서 '확인' 후 시스템 창에서 거부한 경우는 플래그를 세우지 않아 다음 부팅 때 재안내)
  notifPermissionDeclined?: boolean;
  batteryPermissionDeclined?: boolean;
  // UI 테마 커스터마이징(구조화 의도). 미설정 시 기본 테마(다크/라이트).
  // 실제 적용 CSS 변수는 buildThemeVars(uiTheme.ts)로 파생 — 단일 출처.
  uiTheme?: UiThemeConfig;
}

// UI 색 커스터마이징의 "의도"를 저장(파생값이 아닌 원본). 전부 옵셔널=하위호환.
export interface UiThemeConfig {
  surface?: string; // 배경색 (#rrggbb)
  surface2?: string; // 패널/카드 배경(루트보다 한 단계 올라온 표면)
  inputBg?: string; // 입력창 배경
  // 구분 구역 배경: 폴더 등 "색 대비가 중요한" 영역. 미설정 시 커스텀 배경 색조를 따라가지
  // 않고 기본 테마(명도) 고정 → 어떤 커스텀 테마에서도 텍스트·식별색 대비 유지. 수동 지정 가능.
  zoneBg?: string;
  // 테두리/구분선 색: 미설정 시 텍스트 패턴·배경색에서 적응 파생(배경에 옅게 녹는 선).
  lineColor?: string;
  textPattern?: 'light' | 'dark'; // 텍스트/아이콘 흑백 패턴(미설정=테마 기본)
  unifyButtons?: boolean; // 버튼 색 통합(역할 3색) 모드 on/off
  // 통합 모드(unifyButtons=true)에서의 역할별 색
  accent?: string; // 강조(초록/하늘/주황 버튼 통합)
  neutral?: string; // 일반(회색 버튼)
  danger?: string; // 위험(빨강 버튼=삭제)
  // 개별 모드(unifyButtons=false)에서의 색별 지정
  buttons?: {
    green?: string;
    sky?: string;
    orange?: string;
    gray?: string;
    red?: string;
  };
}
