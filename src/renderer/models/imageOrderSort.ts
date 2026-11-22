// 이미지 그리드 「보기 순서」(2026-11-22) — 순수 함수(의존성 없음), jest imageOrderSort.test.ts.
//
// · 보기 설정이다 — 보여 주는 순서만 고르고 데이터(scene.imageMap·game·mains)는 읽기만 한다. 되돌리기 기록 없음.
//   (같은 날 처음엔 저장된 순서를 한 번 다시 쓰는 「정렬」 버튼이었으나 사용자 지시로 택일 보기로 바꿈.)
// · 'default' = 지금까지의 표시 순서 그대로(GameService.refreshList 결과 — 저장된 순서 + 월드컵 순위 규칙).
// · 'favorites-first' = 즐겨찾기(scene.mains) 먼저, 각 묶음 안에서 생성 시각 최신순.
//   생성 시각 = 결과 파일 이름의 앞 숫자(outputFileName — 「저장 시각(ms).png」, WebP 변환 뒤에도 같은 숫자 이름).
//   시각을 알 수 없는 이름은 같은 묶음(즐겨찾기/나머지) 안에서 원래 순서를 지킨 채 뒤로 보낸다. 같은 시각은 원래 순서(안정 정렬).
// · 앱 전체 하나로 기억(씬마다 아님) — localStorage `sdstudio-image-view-order`(히스토리 열 수와 같은 화면 보기 설정 방식).

/** ms 타임스탬프로 볼 앞 숫자의 자릿수 범위(2001년 무렵 이후 ~ 먼 미래). 짧은 숫자 이름(「1.png」)은 시각이 아니다. */
const MIN_TIMESTAMP_DIGITS = 12;
const MAX_TIMESTAMP_DIGITS = 16;

/** 결과 파일 이름에서 생성 시각(ms)을 읽는다 — 경로·확장자 무관, 앞 숫자가 시각 꼴이 아니면 undefined */
export function outputTimestampOf(filename: string): number | undefined {
  const base = filename.split('/').pop() ?? '';
  const m = /^(\d+)/.exec(base);
  if (!m) return undefined;
  const digits = m[1];
  if (digits.length < MIN_TIMESTAMP_DIGITS || digits.length > MAX_TIMESTAMP_DIGITS) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

/** 한 묶음 안 최신순(시각 내림차순, 같은 시각·시각 모름은 원래 순서, 시각 모름은 뒤) — 안정 정렬 */
function newestFirst(items: readonly string[]): string[] {
  const keyed = items.map((name, index) => ({ name, index, t: outputTimestampOf(name) }));
  keyed.sort((a, b) => {
    if (a.t === undefined && b.t === undefined) return a.index - b.index;
    if (a.t === undefined) return 1;
    if (b.t === undefined) return -1;
    if (a.t !== b.t) return b.t - a.t;
    return a.index - b.index;
  });
  return keyed.map((k) => k.name);
}

/**
 * 표시 순서(위·왼쪽이 먼저) → 「즐겨찾기 먼저, 그 안에서 최신순 / 그다음 나머지 최신순」 표시 순서.
 * favorites 는 파일 이름(scene.mains), displayed 항목은 파일 이름 또는 경로(끝 이름으로 비교).
 */
export function favoritesFirstNewestDisplay(
  displayed: readonly string[],
  favorites: readonly string[],
): string[] {
  const fav = new Set(favorites);
  const isFav = (x: string) => fav.has(x.split('/').pop() ?? x);
  return [
    ...newestFirst(displayed.filter(isFav)),
    ...newestFirst(displayed.filter((x) => !isFav(x))),
  ];
}

/** 보기 순서 — 나중에 늘릴 수 있게 열거형. 순서 = 선택 창 항목 순서. */
export const IMAGE_VIEW_ORDERS = ['default', 'favorites-first'] as const;
export type ImageViewOrder = (typeof IMAGE_VIEW_ORDERS)[number];
export const DEFAULT_IMAGE_VIEW_ORDER: ImageViewOrder = 'default';

/** 저장값 → 보기 순서(모르는 값·없음 = 기본 순서) */
export function normalizeImageViewOrder(value: unknown): ImageViewOrder {
  return (IMAGE_VIEW_ORDERS as readonly unknown[]).includes(value)
    ? (value as ImageViewOrder)
    : DEFAULT_IMAGE_VIEW_ORDER;
}

/** 기본 순서가 아닌 보기에서는 저장된 순서를 바꾸는 끌어서 순서 바꾸기를 막는다(보이는 자리와 저장 자리가 달라서). */
export function canReorderInViewOrder(mode: ImageViewOrder): boolean {
  return mode === 'default';
}

/**
 * 그리드 표시 순서(GameService 결과, 위·왼쪽이 먼저)에 보기 순서를 적용한다 — 새 배열, 입력은 바꾸지 않는다.
 * 그리드 칸·상세 보기 이전/다음·키보드 이동·선택·즐겨찾기 탭이 모두 이 결과를 쓴다(ResultViewer viewPaths).
 */
export function applyImageViewOrder(
  displayed: readonly string[],
  favorites: readonly string[],
  mode: ImageViewOrder,
): string[] {
  if (mode === 'favorites-first') return favoritesFirstNewestDisplay(displayed, favorites);
  return [...displayed];
}

/** 화면 보기 설정 저장(앱 전체 하나, 프로젝트 데이터·config.json 아님 — 환경설정 내보내기 대상 아님) */
export const IMAGE_VIEW_ORDER_STORAGE_KEY = 'sdstudio-image-view-order';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readImageViewOrder(storage: KeyValueStorage | undefined): ImageViewOrder {
  try {
    return normalizeImageViewOrder(storage?.getItem(IMAGE_VIEW_ORDER_STORAGE_KEY));
  } catch {
    return DEFAULT_IMAGE_VIEW_ORDER;
  }
}

export function writeImageViewOrder(storage: KeyValueStorage | undefined, mode: ImageViewOrder): void {
  try {
    storage?.setItem(IMAGE_VIEW_ORDER_STORAGE_KEY, mode);
  } catch {
    // 저장 실패는 이번 실행 동안만 유지(보기 설정이라 알리지 않음)
  }
}

export const IMAGE_VIEW_ORDER_TEXT = {
  button: '보기 순서',
  tooltip: (mode: ImageViewOrder) => `보기 순서 고르기 (지금: ${IMAGE_VIEW_ORDER_LABEL[mode]})`,
  dialog:
    '이미지를 어떤 순서로 보여 줄지 고르세요. 저장된 순서는 바뀌지 않습니다.\n즐겨찾기 먼저 보기에서는 끌어서 순서를 바꿀 수 없습니다',
  /** 선택 창이 「현재 값」 표시를 지원하지 않아 고른 항목 글자 앞에 붙인다 */
  currentMark: '✓ ',
};

export const IMAGE_VIEW_ORDER_LABEL: Record<ImageViewOrder, string> = {
  default: '기본 순서',
  'favorites-first': '즐겨찾기 먼저 (최신순)',
};

/** 보기 순서 선택 창(appState.pushDialogAsync type 'select') 내용 — 지금 고른 쪽 앞에 ✓ */
export function buildImageViewOrderMenu(current: ImageViewOrder): {
  text: string;
  items: { text: string; value: ImageViewOrder }[];
} {
  return {
    text: IMAGE_VIEW_ORDER_TEXT.dialog,
    items: IMAGE_VIEW_ORDERS.map((mode) => ({
      text: (mode === current ? IMAGE_VIEW_ORDER_TEXT.currentMark : '') + IMAGE_VIEW_ORDER_LABEL[mode],
      value: mode,
    })),
  };
}
