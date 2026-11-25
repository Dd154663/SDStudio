// 「캡처」 — 이미지 여러 장을 줄과 칸으로 모아 한 장의 이미지 파일로 내보내기(2026-11-25). 순수 규칙 모듈.
//
// 세 쓰임이 한 뼈대(「줄과 칸을 정한 뒤 한 장으로 그린다」)를 쓴다:
//   ① 씬 모아 보기(씬 목록 툴바 「캡처」, 씬당 이미지 = 대표 1장) — 칸을 차례로 채운다(flow).
//   ② 씬별 여러 장(같은 창, 씬당 이미지 = 즐겨찾기·최근 생성) — 한 줄 = 한 씬(rows).
//   ③ 한 씬의 이미지(이미지 그리드 「캡처」) — 고른 이미지를 차례로 채운다(flow).
// 이 모듈 = 옵션 타입·기본값·정리(localStorage), 범위에서 칸 목록 만들기, 배치 계산, 줄 수 판정, 화소 상한 축소,
// 파일 이름, 요약 문구. DOM·서비스 의존 없음(jest captureSheet.test.ts). 그리기는 captureSheetRender.ts,
// 읽기·저장 배선은 captureSheetRun.ts. 프로젝트 데이터는 읽기만 한다(되돌리기 기록 없음 — 파일 생성).
import { CaptureImageFormat, CAPTURE_IMAGE_FORMATS } from './imageFormats';
import { outputTimestampOf } from './imageOrderSort';

// ===== 옵션 =====

export type CapturePerScene = 'main' | 'favorites' | 'recent';
export type CaptureQuality = 'fast' | 'high';
export type CaptureFit = 'cover' | 'contain';

export interface CaptureOptions {
  /** 씬당 이미지(씬 목록에서 연 창만) — 대표 1장 / 즐겨찾기 / 최근 생성 */
  perScene: CapturePerScene;
  /** 빠르게 = 카드와 같은 썸네일 / 고화질 = 원본을 칸 크기로 줄임 */
  quality: CaptureQuality;
  /** 씬 이름 표시(① 칸 아래 띠 · ② 줄 위 한 줄 · ③ 맨 위 한 줄) */
  showNames: boolean;
  /** 칸 간격(끄면 이미지를 붙인다) */
  gap: boolean;
  /** 이미지가 없는 씬도 회색 빈 칸·빈 줄로(씬 목록에서 연 창만) */
  includeEmpty: boolean;
  /** 한 줄의 장수 1~7 */
  columns: number;
  /** 칸 폭(px) — CAPTURE_CELL_SIZES 의 값 */
  cellSize: number;
  /** 이미지 채우기 — 카드처럼 잘라 채움 / 전체가 보이게 */
  fit: CaptureFit;
  format: CaptureImageFormat;
  /** 범위 「랜덤 씬」에서 고를 씬 수(씬 목록에서 연 창만) */
  randomCount: number;
}

export const CAPTURE_COLUMNS_MIN = 1;
export const CAPTURE_COLUMNS_MAX = 7;
export const CAPTURE_COLUMNS_DEFAULT = 4;

/** 칸 폭 단계 — 「아주 크게」는 고화질일 때만 고를 수 있다(썸네일을 크게 늘리지 않게) */
export const CAPTURE_CELL_SIZES: readonly { value: number; label: string; highOnly?: boolean }[] = [
  { value: 256, label: '작게' },
  { value: 384, label: '보통' },
  { value: 512, label: '크게' },
  { value: 768, label: '아주 크게', highOnly: true },
];
export const CAPTURE_CELL_SIZE_DEFAULT = 384;

/** 줄 수 판정 — 넘으면 경고(실행 가능) / 넘으면 실행 불가 */
export const CAPTURE_ROWS_WARN = 10;
export const CAPTURE_ROWS_MAX = 20;

/** 범위 「랜덤 씬」의 씬 수 — 상한은 한 장에 담을 수 있는 최대 장수(7장 × 20줄) */
export const CAPTURE_RANDOM_COUNT_MIN = 1;
export const CAPTURE_RANDOM_COUNT_MAX = CAPTURE_COLUMNS_MAX * CAPTURE_ROWS_MAX;
export const CAPTURE_RANDOM_COUNT_DEFAULT = 20;

/** 한 장의 총 화소 상한(넘으면 칸을 자동으로 줄인다) — 플랫폼 값은 호출부가 고른다 */
export const CAPTURE_PIXEL_LIMIT = { pc: 40_000_000, mobile: 16_000_000 } as const;
/** 화소 상한에 맞추느라 줄이는 칸 폭의 하한 */
export const CAPTURE_MIN_CELL_WIDTH = 32;

/** 캔버스 안 고정색(테마 무관 — 결과 파일은 앱 밖에서 보인다) */
export const CAPTURE_COLORS = {
  background: '#16181a',
  empty: '#2a2d31',
  text: '#d4d6d9',
} as const;

/** 칸 비율(폭/높이)을 모를 때 = 세로 3:4 */
export const CAPTURE_DEFAULT_ASPECT = 3 / 4;

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  perScene: 'main',
  quality: 'fast',
  showNames: false,
  gap: false,
  includeEmpty: false,
  columns: CAPTURE_COLUMNS_DEFAULT,
  cellSize: CAPTURE_CELL_SIZE_DEFAULT,
  fit: 'cover',
  // 기본 PNG(2026-11-25 사용자 — 글자·선이 뭉개지지 않게). JPEG 는 고르면 기억된다.
  format: 'png',
  randomCount: CAPTURE_RANDOM_COUNT_DEFAULT,
};

const PER_SCENE_VALUES: readonly CapturePerScene[] = ['main', 'favorites', 'recent'];
const QUALITY_VALUES: readonly CaptureQuality[] = ['fast', 'high'];
const FIT_VALUES: readonly CaptureFit[] = ['cover', 'contain'];

const pick = <T>(values: readonly T[], v: unknown, fallback: T): T =>
  (values as readonly unknown[]).includes(v) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** 저장값(모르는 형태 포함) → 옵션. 모르는 값·범위 밖 숫자는 기본값 */
export function normalizeCaptureOptions(raw: unknown): CaptureOptions {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_CAPTURE_OPTIONS;
  const columns =
    typeof o.columns === 'number' &&
    Number.isInteger(o.columns) &&
    o.columns >= CAPTURE_COLUMNS_MIN &&
    o.columns <= CAPTURE_COLUMNS_MAX
      ? o.columns
      : d.columns;
  const cellSize = CAPTURE_CELL_SIZES.some((s) => s.value === o.cellSize)
    ? (o.cellSize as number)
    : d.cellSize;
  return {
    perScene: pick(PER_SCENE_VALUES, o.perScene, d.perScene),
    quality: pick(QUALITY_VALUES, o.quality, d.quality),
    showNames: bool(o.showNames, d.showNames),
    gap: bool(o.gap, d.gap),
    includeEmpty: bool(o.includeEmpty, d.includeEmpty),
    columns,
    cellSize,
    fit: pick(FIT_VALUES, o.fit, d.fit),
    format: pick(Object.keys(CAPTURE_IMAGE_FORMATS) as CaptureImageFormat[], o.format, d.format),
    randomCount: clampCaptureRandomCount(o.randomCount, d.randomCount),
  };
}

/** 랜덤 씬 수 정리 — 정수 1~상한, 그 밖(숫자 아님 포함)은 fallback */
export function clampCaptureRandomCount(v: unknown, fallback: number = CAPTURE_RANDOM_COUNT_DEFAULT): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(CAPTURE_RANDOM_COUNT_MAX, Math.max(CAPTURE_RANDOM_COUNT_MIN, Math.floor(n)));
}

/** 고를 수 있는 칸 크기(고화질이 아니면 「아주 크게」 없음) */
export function captureCellSizeChoices(quality: CaptureQuality) {
  return CAPTURE_CELL_SIZES.filter((s) => !s.highOnly || quality === 'high');
}

/** 실제로 쓸 칸 폭 — 고화질 전용 단계를 빠르게에서 고른 채 기억돼 있으면 그 아래 가장 큰 단계 */
export function effectiveCaptureCellSize(opts: Pick<CaptureOptions, 'cellSize' | 'quality'>): number {
  const choices = captureCellSizeChoices(opts.quality);
  if (choices.some((s) => s.value === opts.cellSize)) return opts.cellSize;
  return choices.filter((s) => s.value <= opts.cellSize).pop()?.value ?? CAPTURE_CELL_SIZE_DEFAULT;
}

/** 옵션 기억(앱 전체 하나, localStorage — 범위는 기억하지 않는다) */
export const CAPTURE_OPTIONS_STORAGE_KEY = 'sdstudio-capture-options';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readCaptureOptions(storage: KeyValueStorage | undefined): CaptureOptions {
  try {
    const raw = storage?.getItem(CAPTURE_OPTIONS_STORAGE_KEY);
    return normalizeCaptureOptions(raw ? JSON.parse(raw) : undefined);
  } catch {
    return { ...DEFAULT_CAPTURE_OPTIONS };
  }
}

export function writeCaptureOptions(storage: KeyValueStorage | undefined, opts: CaptureOptions): void {
  try {
    storage?.setItem(CAPTURE_OPTIONS_STORAGE_KEY, JSON.stringify(normalizeCaptureOptions(opts)));
  } catch {
    // 저장 실패는 이번 실행 동안만 유지(보기 설정이라 알리지 않음)
  }
}

// ===== 범위 =====

/** 씬 목록에서 연 창의 범위 */
export type CaptureSceneScope = 'list' | 'selected' | 'visible' | 'random';
/** 이미지 그리드에서 연 창의 범위 */
export type CaptureGridScope = 'selected' | 'favorites' | 'all';

/** 기본 범위: 선택한 씬이 있으면 그것, 아니면 지금 목록 */
export function defaultCaptureSceneScope(
  counts: Partial<Record<CaptureSceneScope, number>> & { selected: number },
): CaptureSceneScope {
  return counts.selected > 0 ? 'selected' : 'list';
}

/** 기본 범위: 선택한 이미지 → 즐겨찾기 → 지금 탭의 전체 */
export function defaultCaptureGridScope(counts: Record<CaptureGridScope, number>): CaptureGridScope {
  if (counts.selected > 0) return 'selected';
  if (counts.favorites > 0) return 'favorites';
  return 'all';
}

/** 「보이는 씬」 — 격자 스크롤 상자에 조금이라도 걸친 카드(경계에 닿기만 한 것은 제외) */
export interface CaptureRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export function rectsOverlap(a: CaptureRect, b: CaptureRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// ===== 칸 목록 =====

/** 칸 하나가 읽을 이미지 — output = 생성 결과(경로), input = 이미지변형 씬의 입력 이미지(vibes 이름) */
export interface CaptureSource {
  kind: 'output' | 'input';
  path: string;
}

/** 씬 하나의 재료(평범한 데이터 — 호출부가 세션에서 뽑아 넘긴다). 경로는 전부 같은 꼴(전체 경로)로 */
export interface CaptureSceneData {
  name: string;
  /** 카드가 보여 주는 대표 이미지(없으면 이미지 없는 씬) */
  main?: CaptureSource;
  /** 즐겨찾기 경로(scene.mains 순서) */
  favorites: readonly string[];
  /** 결과 이미지 경로(휴지통 제외 — 그리드 기본 순서) */
  outputs: readonly string[];
}

export interface CaptureCell {
  /** 없으면 회색 빈 칸 */
  source?: CaptureSource;
  /** ① 칸 아래 이름 */
  label?: string;
}
export interface CaptureRow {
  /** ② 줄 위 씬 이름 */
  title: string;
  cells: CaptureCell[];
}
export type CaptureContent =
  | { kind: 'flow'; cells: CaptureCell[]; title?: string; skipped: number }
  | { kind: 'rows'; rows: CaptureRow[]; skipped: number };

/** 최근 생성 = 생성 시각 최신 먼저(시각을 모르는 이름은 원래 순서로 뒤) */
export function newestOutputsFirst(outputs: readonly string[]): string[] {
  const keyed = outputs.map((p, index) => ({ p, index, t: outputTimestampOf(p) }));
  keyed.sort((a, b) => {
    if (a.t === undefined && b.t === undefined) return a.index - b.index;
    if (a.t === undefined) return 1;
    if (b.t === undefined) return -1;
    if (a.t !== b.t) return b.t - a.t;
    return a.index - b.index;
  });
  return keyed.map((k) => k.p);
}

/** 즐겨찾기 중 결과 목록에 있는 것만(휴지통·없는 파일 제외), mains 순서 */
export function liveFavorites(favorites: readonly string[], outputs: readonly string[]): string[] {
  const live = new Set(outputs);
  return favorites.filter((f) => live.has(f));
}

/** 이 씬에 그 「씬당 이미지」 종류로 담을 이미지가 하나라도 있는가(랜덤 씬의 후보 판정 — 빈 씬 포함이 꺼져 있을 때) */
export function captureSceneHasContent(scene: CaptureSceneData, perScene: CapturePerScene): boolean {
  if (perScene === 'main') return !!scene.main;
  if (perScene === 'favorites') return liveFavorites(scene.favorites, scene.outputs).length > 0;
  return scene.outputs.length > 0;
}

/**
 * 범위 「랜덤 씬」 — 후보에서 count 개를 무작위로 고른다(원래 순서는 유지, 후보가 모자라면 전부).
 * rng 는 0 이상 1 미만(기본 Math.random — 테스트는 주입).
 */
export function pickRandomSubset<T>(items: readonly T[], count: number, rng: () => number = Math.random): T[] {
  const n = Math.max(0, Math.min(items.length, Math.floor(count)));
  if (n >= items.length) return [...items];
  // 앞 n 자리만 섞는 부분 셔플 → 고른 위치를 원래 순서로 정렬
  const idx = items.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = Math.min(idx.length - 1, i + Math.floor(rng() * (idx.length - i)));
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
  }
  return idx
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => items[i]);
}

/** ①② 씬 목록 범위 → 칸 목록. 씬당 최대 장수 = 한 줄의 장수(②) */
export function buildSceneCaptureContent(
  scenes: readonly CaptureSceneData[],
  opts: Pick<CaptureOptions, 'perScene' | 'includeEmpty' | 'columns'>,
): CaptureContent {
  let skipped = 0;
  if (opts.perScene === 'main') {
    const cells: CaptureCell[] = [];
    for (const s of scenes) {
      if (s.main) cells.push({ source: s.main, label: s.name });
      else if (opts.includeEmpty) cells.push({ label: s.name });
      else skipped += 1;
    }
    return { kind: 'flow', cells, skipped };
  }
  const rows: CaptureRow[] = [];
  for (const s of scenes) {
    const list =
      opts.perScene === 'favorites'
        ? liveFavorites(s.favorites, s.outputs)
        : newestOutputsFirst(s.outputs);
    const picked = list.slice(0, Math.max(1, opts.columns));
    if (picked.length > 0) {
      rows.push({ title: s.name, cells: picked.map((path) => ({ source: { kind: 'output', path } })) });
    } else if (opts.includeEmpty) {
      rows.push({ title: s.name, cells: [{}] });
    } else {
      skipped += 1;
    }
  }
  return { kind: 'rows', rows, skipped };
}

/** ③ 한 씬의 이미지 → 칸 목록(맨 위 이름은 showNames 일 때) */
export function buildGridCaptureContent(
  paths: readonly string[],
  sceneName: string,
  showNames: boolean,
): CaptureContent {
  return {
    kind: 'flow',
    cells: paths.map((path) => ({ source: { kind: 'output', path } })),
    title: showNames ? sceneName : undefined,
    skipped: 0,
  };
}

/** 줄 수(①③ = 장수 ÷ 한 줄의 장수 올림, ② = 씬 수) */
export function captureRowCount(content: CaptureContent, columns: number): number {
  if (content.kind === 'rows') return content.rows.length;
  const cols = Math.max(1, columns);
  return Math.ceil(content.cells.length / cols);
}

/** 이미지 장수(빈 칸 제외) */
export function captureImageCount(content: CaptureContent): number {
  const cells = content.kind === 'rows' ? content.rows.flatMap((r) => r.cells) : content.cells;
  return cells.filter((c) => !!c.source).length;
}

export type CaptureRowsVerdict = 'ok' | 'warn' | 'blocked';
export function captureRowsVerdict(rows: number): CaptureRowsVerdict {
  if (rows > CAPTURE_ROWS_MAX) return 'blocked';
  if (rows > CAPTURE_ROWS_WARN) return 'warn';
  return 'ok';
}

// ===== 배치 =====

export interface CaptureDrawCell extends CaptureRect {
  source?: CaptureSource;
}
export interface CaptureDrawText extends CaptureRect {
  text: string;
  fontPx: number;
  align: 'left' | 'center';
}
export interface CaptureLayout {
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
  gap: number;
  /** 그리는 순서 = 이 순서(위·왼쪽 먼저) */
  cells: CaptureDrawCell[];
  texts: CaptureDrawText[];
}

export interface CaptureLayoutInput {
  content: CaptureContent;
  columns: number;
  cellWidth: number;
  /** 칸 비율 폭/높이(3:4 = 0.75) */
  aspect: number;
  gap: boolean;
  /** ① 칸 아래 이름 띠 · ② 줄 위 이름 — ③ 의 맨 위 이름은 content.title 로 */
  showNames: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** 칸 폭에서 정해지는 치수(간격·이름 띠·맨 위 제목) */
export function captureMetrics(cellWidth: number, gapOn: boolean) {
  const gap = gapOn ? Math.max(4, Math.round(cellWidth / 32)) : 0;
  const band = clamp(Math.round(cellWidth * 0.1), 22, 56);
  const title = clamp(Math.round(cellWidth * 0.13), 28, 72);
  return {
    gap,
    band,
    bandFont: Math.round(band * 0.55),
    title,
    titleFont: Math.round(title * 0.5),
    textPad: Math.max(6, Math.round(band * 0.35)),
  };
}

export function layoutCapture(input: CaptureLayoutInput): CaptureLayout {
  const { content } = input;
  const aspect = input.aspect > 0 && Number.isFinite(input.aspect) ? input.aspect : CAPTURE_DEFAULT_ASPECT;
  const cellW = Math.max(1, Math.round(input.cellWidth));
  const cellH = Math.max(1, Math.round(cellW / aspect));
  const m = captureMetrics(cellW, input.gap);
  const gap = m.gap;
  const cells: CaptureDrawCell[] = [];
  const texts: CaptureDrawText[] = [];
  const maxCols = clamp(Math.floor(input.columns) || 1, CAPTURE_COLUMNS_MIN, CAPTURE_COLUMNS_MAX);

  if (content.kind === 'flow') {
    const n = content.cells.length;
    const cols = Math.max(1, Math.min(maxCols, n));
    const rows = Math.ceil(n / cols);
    const width = gap * 2 + cols * cellW + (cols - 1) * gap;
    let y = gap;
    if (content.title) {
      texts.push({ text: content.title, x: gap, y, w: width - gap * 2, h: m.title, fontPx: m.titleFont, align: 'left' });
      y += m.title + gap;
    }
    const withBand = input.showNames && content.cells.some((c) => c.label);
    const blockH = cellH + (withBand ? m.band : 0);
    content.cells.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = gap + col * (cellW + gap);
      const cy = y + row * (blockH + gap);
      cells.push({ x, y: cy, w: cellW, h: cellH, source: c.source });
      if (withBand && c.label) {
        texts.push({
          text: c.label,
          x: x + m.textPad,
          y: cy + cellH,
          w: cellW - m.textPad * 2,
          h: m.band,
          fontPx: m.bandFont,
          align: 'center',
        });
      }
    });
    const bodyH = rows > 0 ? rows * blockH + (rows - 1) * gap : 0;
    const height = Math.max(1, y + bodyH + (rows > 0 ? gap : 0));
    return { width: Math.max(1, width), height, cellWidth: cellW, cellHeight: cellH, columns: cols, rows, gap, cells, texts };
  }

  const longest = content.rows.reduce((mx, r) => Math.max(mx, r.cells.length), 0);
  const cols = Math.max(1, Math.min(maxCols, longest));
  const width = gap * 2 + cols * cellW + (cols - 1) * gap;
  const titleH = input.showNames ? m.band : 0;
  let y = gap;
  content.rows.forEach((r, ri) => {
    if (ri > 0) y += gap;
    if (titleH > 0) {
      texts.push({ text: r.title, x: gap + m.textPad, y, w: width - gap * 2 - m.textPad * 2, h: titleH, fontPx: m.bandFont, align: 'left' });
      y += titleH;
    }
    r.cells.slice(0, cols).forEach((c, ci) => {
      cells.push({ x: gap + ci * (cellW + gap), y, w: cellW, h: cellH, source: c.source });
    });
    y += cellH;
  });
  const rows = content.rows.length;
  const height = Math.max(1, y + (rows > 0 ? gap : 0));
  return { width: Math.max(1, width), height, cellWidth: cellW, cellHeight: cellH, columns: cols, rows, gap, cells, texts };
}

/** 화소 상한을 넘으면 칸 폭을 줄여 맞춘다 — shrunk = 줄였는지 */
export function fitCaptureToPixelLimit(
  input: CaptureLayoutInput,
  pixelLimit: number,
): { layout: CaptureLayout; shrunk: boolean } {
  let layout = layoutCapture(input);
  if (layout.width * layout.height <= pixelLimit) return { layout, shrunk: false };
  let cellWidth = input.cellWidth;
  // 넓이는 칸 폭의 제곱에 거의 비례 — 먼저 비율로 크게 줄이고, 띠·간격의 하한 때문에 남는 차이는 조금씩
  cellWidth = Math.max(
    CAPTURE_MIN_CELL_WIDTH,
    Math.floor(cellWidth * Math.sqrt(pixelLimit / (layout.width * layout.height))),
  );
  layout = layoutCapture({ ...input, cellWidth });
  while (layout.width * layout.height > pixelLimit && cellWidth > CAPTURE_MIN_CELL_WIDTH) {
    cellWidth = Math.max(CAPTURE_MIN_CELL_WIDTH, cellWidth - Math.max(1, Math.floor(cellWidth * 0.02)));
    layout = layoutCapture({ ...input, cellWidth });
  }
  return { layout, shrunk: true };
}

/** 씬 카드 비율 설정(sceneCardStyle) → 칸 비율. 고정 비율이 없는 값(높이 고정 등)은 3:4 */
export function captureAspectForCardStyle(style: string | undefined): number {
  if (style === 'square') return 1;
  if (style === 'landscape') return 4 / 3;
  return CAPTURE_DEFAULT_ASPECT;
}

/** 이미지 크기 → 칸 비율(모르면 3:4) */
export function captureAspectForSize(width: number | undefined, height: number | undefined): number {
  if (!width || !height || !(width > 0) || !(height > 0)) return CAPTURE_DEFAULT_ASPECT;
  return width / height;
}

// ===== 계획(창의 요약 줄·실행이 같은 값) =====

export interface CapturePlan {
  content: CaptureContent;
  layout: CaptureLayout;
  imageCount: number;
  rows: number;
  verdict: CaptureRowsVerdict;
  shrunk: boolean;
  skipped: number;
}

export function planCapture(
  content: CaptureContent,
  opts: Pick<CaptureOptions, 'columns' | 'cellSize' | 'quality' | 'gap' | 'showNames'>,
  aspect: number,
  pixelLimit: number,
): CapturePlan {
  const rows = captureRowCount(content, opts.columns);
  const { layout, shrunk } = fitCaptureToPixelLimit(
    {
      content,
      columns: opts.columns,
      cellWidth: effectiveCaptureCellSize(opts),
      aspect,
      gap: opts.gap,
      showNames: opts.showNames,
    },
    pixelLimit,
  );
  return {
    content,
    layout,
    imageCount: captureImageCount(content),
    rows,
    verdict: captureRowsVerdict(rows),
    shrunk,
    skipped: content.skipped,
  };
}

/** 실행할 수 있는지 — 줄 수가 상한 이하이고 그릴 칸이 있을 때 */
export function canRunCapture(plan: CapturePlan): boolean {
  return plan.verdict !== 'blocked' && plan.layout.cells.length > 0 && plan.imageCount > 0;
}

// ===== 파일 이름 =====

const pad2 = (n: number) => String(n).padStart(2, '0');
export function captureTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}_` +
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

/** 파일 이름(확장자 없음) — ①② 「프로젝트_캡처_시각」, ③ 「프로젝트_씬_캡처_시각」. 금지 문자 정리는 저장 쪽(sanitizeFilename) */
export function captureFileStem(project: string, date: Date, sceneName?: string): string {
  const parts = [project];
  if (sceneName !== undefined) parts.push(sceneName);
  parts.push('캡처', captureTimestamp(date));
  return parts.join('_');
}

// ===== 문구 =====

export const CAPTURE_TEXT = {
  button: '캡처',
  tooltip: '이미지를 모아 한 장으로 저장',
  sceneTitle: '씬 캡처',
  gridTitle: (scene: string) => `"${scene}" 이미지 캡처`,
  scope: '범위',
  sceneScope: { list: '지금 목록', selected: '선택한 씬', visible: '보이는 씬', random: '랜덤 씬' } as Record<CaptureSceneScope, string>,
  randomCount: '랜덤으로 고를 씬 수',
  randomUnit: '개',
  gridScope: { selected: '선택한 이미지', favorites: '즐겨찾기 이미지', all: '지금 탭의 전체' } as Record<CaptureGridScope, string>,
  scopeCount: (label: string, n: number) => `${label} (${n})`,
  perScene: '씬당 이미지',
  perSceneLabel: { main: '대표 1장', favorites: '즐겨찾기', recent: '최근 생성' } as Record<CapturePerScene, string>,
  perSceneHint: '즐겨찾기·최근 생성은 한 줄에 한 씬씩, 씬마다 한 줄의 장수까지 담습니다.',
  quality: '화질',
  qualityLabel: { fast: '빠르게', high: '고화질' } as Record<CaptureQuality, string>,
  show: '표시',
  showNames: '씬 이름',
  gap: '칸 간격',
  includeEmpty: '빈 씬 포함',
  layout: '배치',
  columns: '한 줄의 장수',
  columnsDec: '한 줄의 장수 줄이기',
  columnsInc: '한 줄의 장수 늘리기',
  cellSize: '칸 크기',
  fit: '이미지 채우기',
  fitLabel: { cover: '잘라 채움', contain: '전체가 보이게' } as Record<CaptureFit, string>,
  format: '형식',
  formatLabel: { jpeg: 'JPEG', png: 'PNG' } as Record<CaptureImageFormat, string>,
  run: '캡처 저장',
  cancel: '취소',
  summary: (images: number, rows: number, w: number, h: number) =>
    `이미지 ${images}장 · ${rows}줄 · 결과 ${w} × ${h} px`,
  skipped: (n: number) => `이미지가 없는 씬 ${n}개는 건너뜁니다`,
  shrunk: (cellWidth: number) => `결과가 커서 칸을 줄였습니다(칸 폭 ${cellWidth} px)`,
  warn: `줄이 ${CAPTURE_ROWS_WARN}줄을 넘어 결과가 길어집니다`,
  blocked: '이미지가 너무 많습니다',
  blockedHint: '범위를 좁히거나 한 줄의 장수를 늘려 주세요',
  empty: '담을 이미지가 없습니다',
  progress: '캡처 만드는 중...',
  cancelled: '캡처를 취소했습니다',
  failed: (msg: string) => `캡처를 만들지 못했습니다: ${msg}`,
};

/** 요약 줄 + 덧붙임(경고·불가·건너뜀·축소) — 창 아래에 항상 */
export function captureSummary(plan: CapturePlan): { line: string; notes: { text: string; tone: 'muted' | 'warn' | 'danger' }[] } {
  const notes: { text: string; tone: 'muted' | 'warn' | 'danger' }[] = [];
  if (plan.imageCount === 0) notes.push({ text: CAPTURE_TEXT.empty, tone: 'warn' });
  if (plan.verdict === 'blocked') {
    notes.push({ text: CAPTURE_TEXT.blocked, tone: 'danger' });
    notes.push({ text: CAPTURE_TEXT.blockedHint, tone: 'danger' });
  } else if (plan.verdict === 'warn') {
    notes.push({ text: CAPTURE_TEXT.warn, tone: 'warn' });
  }
  if (plan.skipped > 0) notes.push({ text: CAPTURE_TEXT.skipped(plan.skipped), tone: 'muted' });
  if (plan.shrunk) notes.push({ text: CAPTURE_TEXT.shrunk(plan.layout.cellWidth), tone: 'muted' });
  return {
    line: CAPTURE_TEXT.summary(plan.imageCount, plan.rows, plan.layout.width, plan.layout.height),
    notes,
  };
}
