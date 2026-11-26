// 히스토리 목록·크게 보기·세로로 이어 보기의 크기 계산(2026-11-26 히스토리 확대) — 순수 함수(DOM·서비스 의존 없음),
// jest historyViewer.test.ts. 화면 부품은 componenets/ImageHistory.tsx(패널·서랍 목록)·HistoryView.tsx(크게 보기)·
// HistoryImagePreview.tsx(뷰어).

/** 비율(가로/세로)을 모를 때의 추정값 — 3:4(세로 그림, 캡처 칸과 같은 기본) */
export const DEFAULT_HISTORY_ASPECT = 3 / 4;

/** 쓸 수 있는 비율인가(0·음수·무한대·NaN 거름) */
export function isUsableAspect(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0.05 && v < 20;
}

/** 너비·높이 → 비율. 모르면 undefined */
export function aspectFromSize(width?: number, height?: number): number | undefined {
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  if (!(width > 0) || !(height > 0)) return undefined;
  const a = width / height;
  return isUsableAspect(a) ? a : undefined;
}

/** 실제로 쓸 비율: 읽어서 잰 값 → 씬 해상도 추정 → 3:4 */
export function historyItemAspect(measured?: number, sceneAspect?: number): number {
  if (isUsableAspect(measured)) return measured;
  if (isUsableAspect(sceneAspect)) return sceneAspect;
  return DEFAULT_HISTORY_ASPECT;
}

/** 두 비율이 화면에서 차이 날 만큼 다른가(0.5% 미만은 같은 것으로 — 반올림 오차로 다시 계산하지 않게) */
export function aspectChanged(prev: number | undefined, next: number): boolean {
  if (!isUsableAspect(prev)) return true;
  return Math.abs(prev - next) / prev > 0.005;
}

/**
 * 경로 → 잰 비율 기억(앱 실행 동안만, 저장하지 않음). 패널 목록·크게 보기·세로 보기가 같이 써서
 * 다시 그릴 때 1:1·3:4 자리에서 실제 비율로 튀지 않게 한다. 오래된 것부터 지운다.
 */
export class AspectMemo {
  private map = new Map<string, number>();
  constructor(private readonly cap = 600) {}
  get(key: string): number | undefined {
    return this.map.get(key);
  }
  set(key: string, aspect: number): void {
    if (!isUsableAspect(aspect)) return;
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, aspect);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }
  get size(): number {
    return this.map.size;
  }
}

/** 칸 높이 = 칸 너비 / 비율(반올림) */
export function heightForWidth(width: number, aspect: number): number {
  const a = isUsableAspect(aspect) ? aspect : DEFAULT_HISTORY_ASPECT;
  return Math.max(1, Math.round(Math.max(0, width) / a));
}

// ===== 패널·서랍 목록(1열/2열, 칸 모양 = 이미지 비율 — 종전 CSS 격자 그대로) =====

/** 목록 바깥 여백(종전 p-2) */
export const HISTORY_LIST_PAD = 8;
/** 칸 사이(종전 gap-1.5) */
export const HISTORY_LIST_GAP = 6;
/** 칸 아래 씬 이름 줄(11px·leading-tight + mt-0.5·mb-1) */
export const HISTORY_LIST_CAPTION = 20;

/** 칸 너비 — 쓸 수 있는 폭을 열 수로 나눈 값(칸 사이 포함). 최소 40px */
export function historyListCellWidth(containerWidth: number, columns: number, scrollbar = 0): number {
  const cols = Math.max(1, Math.floor(columns));
  const avail = containerWidth - HISTORY_LIST_PAD * 2 - scrollbar - HISTORY_LIST_GAP * (cols - 1);
  return Math.max(40, Math.floor(avail / cols));
}

/** 한 줄 높이 = 그 줄 칸들 중 가장 높은 이미지 + 이름 줄 + 칸 사이 */
export function historyListRowHeight(cellWidth: number, aspects: readonly number[]): number {
  let img = 0;
  for (const a of aspects) img = Math.max(img, heightForWidth(cellWidth, a));
  if (aspects.length === 0) img = cellWidth;
  return img + HISTORY_LIST_CAPTION + HISTORY_LIST_GAP;
}

// ===== 세로로 이어 보기(웹툰식) =====

/** 장마다 이미지 아래 줄(씬 이름·순번) + 장 사이 */
export const SCROLL_ITEM_CHROME = 32;
/** PC 에서 이미지 폭 상한 — 넓은 화면에서 세로 그림 한 장이 몇 화면 높이가 되지 않게 */
export const SCROLL_MAX_WIDTH_PC = 960;

/** 세로 보기 이미지 폭 = 화면 폭(양옆 여백 뺌), PC 는 상한 */
export function scrollColumnWidth(containerWidth: number, isMobile: boolean): number {
  const w = Math.max(80, Math.floor(containerWidth - (isMobile ? 8 : 32)));
  return isMobile ? w : Math.min(SCROLL_MAX_WIDTH_PC, w);
}

/** 장 하나의 높이 */
export function scrollItemHeight(columnWidth: number, aspect: number): number {
  return heightForWidth(columnWidth, aspect) + SCROLL_ITEM_CHROME;
}

/** index 번째 장의 위쪽 위치 = 앞선 장 높이 합 */
export function itemTopOf(heightOf: (i: number) => number, index: number): number {
  let top = 0;
  for (let i = 0; i < index; i++) top += heightOf(i);
  return top;
}

/** 스크롤 위치에 걸린 장의 번호(위치가 끝을 넘으면 마지막 장). 장이 없으면 -1 */
export function indexAtOffset(heightOf: (i: number) => number, count: number, offset: number): number {
  if (count <= 0) return -1;
  let top = 0;
  for (let i = 0; i < count; i++) {
    const h = heightOf(i);
    if (offset < top + h) return i;
    top += h;
  }
  return count - 1;
}

/**
 * 어떤 장의 높이가 바뀌었을 때 스크롤 위치 보정 — 그 장이 지금 보는 위치보다 위에 있으면
 * 바뀐 만큼 스크롤을 옮겨 보던 장이 그 자리에 머물게 한다(아래 장이 바뀌면 그대로).
 */
export function adjustScrollForResize(
  scrollOffset: number,
  itemTop: number,
  oldHeight: number,
  newHeight: number,
): number {
  if (itemTop >= scrollOffset) return scrollOffset;
  return Math.max(0, scrollOffset + (newHeight - oldHeight));
}

/** 세로 보기에서 원본을 읽을 장인가 — 지금 장과 그 위아래 한 장씩. 나머지는 썸네일만 */
export const SCROLL_FULL_RADIUS = 1;
export function wantsFullInScroll(index: number, current: number): boolean {
  return Math.abs(index - current) <= SCROLL_FULL_RADIUS;
}

// ===== 한 장씩 보기 — 썸네일과 원본이 같은 크기로 그려지게 =====

/**
 * 영역(areaW×areaH)에 비율 aspect 인 그림을 담는 크기. natural(원본 크기)을 알면 그보다 키우지 않는다
 * (원본이 작으면 원본 크기 — 종전 max-w/max-h 와 같은 결과). 영역을 모르면 undefined(종전 클래스로 그림).
 */
export function containBox(
  areaW: number,
  areaH: number,
  aspect: number | undefined,
  natural?: { width: number; height: number },
): { width: number; height: number } | undefined {
  if (!(areaW > 0) || !(areaH > 0) || !isUsableAspect(aspect)) return undefined;
  let w = areaW;
  let h = w / aspect;
  if (h > areaH) {
    h = areaH;
    w = h * aspect;
  }
  if (natural && natural.width > 0 && natural.height > 0 && natural.width < w) {
    w = natural.width;
    h = natural.height;
  }
  return { width: Math.round(w), height: Math.round(h) };
}
