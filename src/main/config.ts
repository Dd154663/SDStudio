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
  // 툴바 버튼 배치 커스터마이징. 미설정 시 레지스트리(uiLayout.ts)의 기본 등급.
  // 배치 해석은 resolveToolbar(uiLayout.ts)가 단일 출처.
  uiToolbar?: UiToolbarConfig;
  // 레이아웃 템플릿 id(배치 구조 프리셋). 미지정=classic. id 계약·강제 폴백 등
  // 해석은 resolveLayout(layoutTemplates.ts)가 단일 출처.
  uiLayoutTemplate?: string;
  // PC 전용 플로팅 생성 컨트롤(TaskQueueControl)의 분리 여부·위치.
  // detached=true면 하단바에서 떼어내 화면 위 플로팅 카드로 표시(모바일 무시).
  genWidget?: { detached?: boolean; x?: number; y?: number };
  // 레이아웃 슬롯 개인화 — 템플릿(uiLayoutTemplate) 기본값 위에 얹는 오버라이드.
  // 전부 옵셔널: 미설정 = 템플릿 기본 = 기존 동작(롤백 안전).
  // 해석은 resolveLayout(layoutTemplates.ts)가 단일 출처.
  uiLayoutSlots?: UiLayoutSlots;
  // 창 배치(PC 전용) — 이미지 뷰어 등 FloatView 가 차지하는 영역.
  // 'cover'(기본)=좌우 패널 위로 넓게 펼침(히스토리 도크는 유지, v4.14.0 동작) /
  // 'center'=중앙 콘텐츠만 덮어 좌우 패널을 병행 열람. 모바일은 도크가 없어 항상 center.
  uiFloatViewMode?: 'cover' | 'center';
  // 앱 글꼴(개인 설정) — 'system'(기본, 기존 시스템 글꼴 스택) /
  // 'pretendard'(번들 Pretendard Variable). id 는 config 저장 키라 배포 후 불변.
  uiFont?: 'pretendard' | 'system';
  // 클래식 마감(개인 설정) — true 면 UI 심미 개편(보더/라운딩 등) 이전 모양으로 복원.
  // 적용은 App.tsx 가 html 에 finish-classic 클래스를 토글(App.css 토큰 오버라이드).
  uiClassicFinish?: boolean;
  // 프리셋 에디터 요소 순서 사용자 오버라이드(L1-2) — 워크플로우 타입별로 최상위 UI
  // 요소의 렌더 순서를 개인화한다. 키는 wfiElementKey(WorkFlow.ts)가 반환하는 안정 키
  // (배포 후 불변 계약). 미설정/빈 배열 = 오버라이드 없음 = 정의 순서 그대로(기존 동작).
  // 최종 렌더 순서 해석은 resolvePresetOrder(presetLayout.ts)가 단일 출처 —
  // stale 키는 조용히 무시하고 신규 키는 정의 위치에 삽입한다(롤백/전방호환 안전).
  uiPresetLayout?: Record<string, string[]>;
  // 동반 슬롯(L3-1 → E2) — 프리셋 에디터 "호스트 행" 옆에 붙일 전역(portable) 툴바 버튼.
  // 키 = hostKey(wfiElementKey 안정 키, 예 'characterPrompts'·'vibes'·'characterReferences'
  // ·'sampling-group'), 값 = 붙일 버튼 id 목록(uiLayout.ts portable 버튼 id, 예
  // 'character-presets') — 둘 다 배포 후 불변. 미설정/빈 배열 = 슬롯 없음 = 현행 렌더
  // (롤백 안전). 어떤 hostKey·버튼이 허용되는지(호스트 목록 COMPANION_HOSTS + 풀=portable
  // 전체)와 해석·유일성(first-host-wins)은 companionSlots.ts 가 단일 출처 — 호스트 목록
  // 밖 hostKey·풀 밖 버튼 id 는 조용히 무시한다(stale 무시 방침).
  uiCompanionSlots?: Record<string, string[]>;
}

// 레이아웃 슬롯 개인화 — 템플릿(uiLayoutTemplate) 기본값 위에 얹는 오버라이드.
// 전부 옵셔널: 미설정 = 템플릿 기본 = 기존 동작(롤백 안전).
export interface UiLayoutSlots {
  historySide?: 'left' | 'right'; // 이미지 히스토리 패널 (기본 right)
  presetSide?: 'left' | 'right'; // 프리셋 에디터 패널 (기본 left)
  projectSide?: 'left' | 'right'; // 프로젝트 사이드 바(드로어 진입) (기본 left)
  genControl?: 'docked' | 'floating'; // 생성 컨트롤 (기본 docked, compact 는 floating)
}

// 버튼 하나의 사용자 배치: 'default'=레지스트리 기본 등급을 따름 /
// 'pinned'=툴바 고정 / 'menu'=⋯ 오버플로 메뉴로 / 'hidden'=숨김
export type ToolbarButtonPlacement = 'default' | 'pinned' | 'menu' | 'hidden';

// 한 영역(scene·project 등)의 배치 순서. 배열 순서가 곧 렌더 순서.
// 배열의 원소는 uiLayout.ts 레지스트리의 버튼 id. schema=2(편집 모드)에서 사용.
export interface UiToolbarAreaLayout {
  inline?: string[]; // 인라인 배치 순서
  menu?: string[]; // ⋯메뉴 배치 순서
  hidden?: string[]; // 숨김
}

// 툴바 배치 커스터마이징의 "의도"(원본). 전부 옵셔널=하위호환.
// buttons 의 키는 uiLayout.ts 레지스트리의 버튼 id(전 영역 공용, 배포 후 불변 계약).
export interface UiToolbarConfig {
  // 클래식 툴바(계층화 도입 이전 배치)로 롤백. true 면 계층화·오버플로 메뉴·
  // buttons 오버라이드를 전부 무시하고 모든 버튼을 인라인 렌더(기존 사용자 안심용).
  classic?: boolean;
  buttons?: Record<string, ToolbarButtonPlacement>;
  // schema=2(편집 모드): 영역별 순서 정보를 areas 에 저장. 미설정(v1)이면 buttons+tier
  // 규칙으로 폴백. 롤백 안전: 구버전 앱은 areas/schema 를 무시하고 buttons 만 읽으므로
  // 크래시 없이 "순서만 잃고 배치 의도는 유지"된다(moveToolbarButton 의 dual-write).
  areas?: Record<string, UiToolbarAreaLayout>;
  schema?: 2;
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
