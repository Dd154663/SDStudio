// 크기 슬라이더(2026-11-23 사용자 결정) — % → 실제 크기 대응 규칙의 단일 출처. 순수 함수(의존성 없음), jest sizeSlider.test.ts.
//
// · 슬라이더 값은 0~100(%) 정수, 50 이 가운데 = 종전 「미디엄」.
// · 종전 세 단계가 25%·50%·75% 에 정확히 놓인다(스몰·미디엄·라지 / S·M·L). 그 사이는 직선 보간.
// · 25% 아래·75% 위는 가까운 구간의 기울기로 연장하고, 못 쓸 만큼 작아지지 않게 하한을 둔다.
// · PC 전용 — 모바일 씬 목록(반응형 그리드)·모바일 이미지 그리드(S/M/L 단추)는 이 규칙을 쓰지 않는다.
// · 앱 전체 하나로 기억 — localStorage(보기 순서 imageOrderSort.ts 와 같은 화면 보기 설정 방식, config.json·환경설정 내보내기 아님).

export const SIZE_PERCENT_MIN = 0;
export const SIZE_PERCENT_MAX = 100;
export const SIZE_PERCENT_DEFAULT = 50;

/** 저장값·입력값 → 0~100 정수(숫자가 아니면 기본 50, 범위 밖은 양 끝으로) */
export function normalizeSizePercent(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return SIZE_PERCENT_DEFAULT;
  return Math.round(Math.min(SIZE_PERCENT_MAX, Math.max(SIZE_PERCENT_MIN, n)));
}

/** 25·50·75% 세 점을 지나는 꺾은선 — 25 아래는 25~50 기울기, 75 위는 50~75 기울기로 연장 */
function throughThreeSteps(percent: number, s: number, m: number, l: number): number {
  const p = normalizeSizePercent(percent);
  if (p <= 50) return m + ((p - 50) * (m - s)) / 25;
  return m + ((p - 50) * (l - m)) / 25;
}

// ===== 씬 카드(PC) =====

/** 종전 스몰·미디엄·라지 씬 목록 그리드 열 최소 폭(px) */
export const SCENE_CARD_MIN_WIDTH_STEPS = [180, 240, 320] as const;
/** 종전 「높이 고정」 카드 모양의 이미지 칸 높이(px) — h-48·h-64·h-96 */
export const SCENE_CARD_FIXED_HEIGHT_STEPS = [192, 256, 384] as const;
/** 열 최소 폭 하한 — 모바일 최소 트랙(9rem = 144px)과 비슷한 크기, 카드 버튼 줄이 들어가는 폭 */
export const SCENE_CARD_MIN_WIDTH_FLOOR = 150;
/** 「높이 고정」 높이 하한(0% 연장값 128 과 같음 — 안전망) */
export const SCENE_CARD_FIXED_HEIGHT_FLOOR = 128;
/** 패널 없는 씬 목록(이미지 그리드 안 「인페인트 씬」 탭)은 종전에 늘 라지뷰였다 → 75% 아래로 내려가지 않는다 */
export const SCENE_CARD_PANELLESS_MIN_PERCENT = 75;

/** 씬 목록 그리드 열 최소 폭(px, 정수) */
export function sceneCardMinWidthPx(percent: number): number {
  const [s, m, l] = SCENE_CARD_MIN_WIDTH_STEPS;
  return Math.round(Math.max(SCENE_CARD_MIN_WIDTH_FLOOR, throughThreeSteps(percent, s, m, l)));
}

/** 「높이 고정」 카드의 이미지 칸 높이(px, 정수) */
export function sceneCardFixedHeightPx(percent: number): number {
  const [s, m, l] = SCENE_CARD_FIXED_HEIGHT_STEPS;
  return Math.round(Math.max(SCENE_CARD_FIXED_HEIGHT_FLOOR, throughThreeSteps(percent, s, m, l)));
}

/** 실제로 쓸 % — 패널 없는 씬 목록은 75% 이상(종전 「패널이 없으면 라지뷰」의 같은 뜻) */
export function effectiveSceneCardPercent(percent: number, hasPanel: boolean): number {
  const p = normalizeSizePercent(percent);
  return hasPanel ? p : Math.max(p, SCENE_CARD_PANELLESS_MIN_PERCENT);
}

/** 씬 카드 「높이 고정」 높이를 그리드에서 카드로 넘기는 CSS 변수 이름(카드가 다시 그려지지 않고 크기만 바뀌게) */
export const SCENE_CARD_FIXED_HEIGHT_VAR = '--scene-card-fixed-h';

// ===== 이미지 그리드(PC) =====

/** 종전 S·M·L 칸 크기 = fastcache 가 만들어 두는 썸네일 크기(px) */
export const IMAGE_GRID_SIZE_STEPS = [200, 400, 500] as const;
/** 칸 크기 하한 — 25~50 기울기(8px/%)로 연장하면 0% 가 0 이 되므로 S 의 60% 에서 멈춘다 */
export const IMAGE_GRID_CELL_FLOOR = 120;

/** 이미지 그리드 칸 크기(px, 정수) */
export function imageGridCellPx(percent: number): number {
  const [s, m, l] = IMAGE_GRID_SIZE_STEPS;
  return Math.round(Math.max(IMAGE_GRID_CELL_FLOOR, throughThreeSteps(percent, s, m, l)));
}

/**
 * 칸 크기 → 받아 올 썸네일 크기. 연속 값을 넘기지 않고 종전 단계(200·400·500)로 올림한다 —
 * 끄는 동안 새 크기의 썸네일 파일이 만들어져 캐시가 불어나거나 칸이 깜빡이지 않게. 500 넘는 칸은 500.
 */
export function imageGridThumbPx(cellPx: number): number {
  for (const step of IMAGE_GRID_SIZE_STEPS) {
    if (cellPx <= step) return step;
  }
  return IMAGE_GRID_SIZE_STEPS[IMAGE_GRID_SIZE_STEPS.length - 1];
}

// ===== 기억(앱 전체 하나) =====

export const SCENE_CARD_SIZE_STORAGE_KEY = 'sdstudio-scene-card-size';
export const IMAGE_GRID_SIZE_STORAGE_KEY = 'sdstudio-image-grid-size';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** 저장된 % 읽기 — 없음·읽기 실패·이상한 값이면 50 */
export function readSizePercent(storage: KeyValueStorage | undefined, key: string): number {
  try {
    const raw = storage?.getItem(key);
    return raw == null ? SIZE_PERCENT_DEFAULT : normalizeSizePercent(raw);
  } catch {
    return SIZE_PERCENT_DEFAULT;
  }
}

export function writeSizePercent(storage: KeyValueStorage | undefined, key: string, percent: number): void {
  try {
    storage?.setItem(key, String(normalizeSizePercent(percent)));
  } catch {
    // 저장 실패는 이번 실행 동안만 유지(보기 설정이라 알리지 않음)
  }
}

export const SIZE_SLIDER_TEXT = {
  sceneCard: '씬 카드 크기',
  imageGrid: '이미지 크기',
  /** 툴팁 = 이름 + 지금 값 + 되돌리는 법 */
  tooltip: (label: string, percent: number) => `${label} ${normalizeSizePercent(percent)}% (두 번 누르면 기본 크기)`,
  valueText: (percent: number) => `${normalizeSizePercent(percent)}%`,
};
