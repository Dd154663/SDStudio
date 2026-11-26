// 씬 목록 「이미지 뷰 모드」 1차(2026-11-26 사용자 결정 「전부 권장안대로」, 조사 guides/plans/2026-11-26-image-view-survey.md).
// 이미지생성·이미지변형 탭의 메인 씬 목록(QueueControl 중 showPannel && !filterFunc)에 보기 방식을 더한다:
//   cards   = 지금의 씬 카드(기본 — 바뀌지 않음)
//   byScene = 씬 별로: 끊기지 않는 한 격자에 씬 순서대로 「첫 칸(테두리+이름 띠) → 그 씬의 이미지 최신순 → (더보기)」
//   rows    = 가로 줄(2026-11-26 2차): 씬마다 가로 한 줄 — 칸은 「씬 별로」와 같은 규칙(상한만 가로 줄 전용), 넘치면 그 줄 안에서 가로 스크롤
//   recent  = 최근 이미지 순: 지금 목록의 모든 이미지를 생성 시각 최신 먼저
//   (구버전은 rows 를 모르는 값으로 보고 cards 로 읽는다 — 저장값 호환 문제 없음.)
//
// 이 파일은 순수 규칙(칸 목록·인덱스·보이는 범위·칸 크기)과 보기 상태(관찰 상자 + localStorage)만 갖는다.
// DOM·서비스 의존 없음 — 화면은 componenets/SceneImageView.tsx, jest sceneImageView.test.tsx.
// 보기 설정이다: 프로젝트 데이터(scene.imageMap·mains·game)는 읽기만 한다. 되돌리기 기록 없음. config.json·프로젝트 파일에 쓰지 않는다.
import { action, observable } from 'mobx';
import { outputTimestampOf } from './imageOrderSort';
import {
  imageGridThumbPx,
  sceneCardFixedHeightPx,
  sceneCardMinWidthPx,
} from './sizeSlider';

// ===== 보기 방식 =====

/** 고를 수 있는 보기 방식 — 순서 = 선택지 순서 */
export const SCENE_VIEW_MODES = ['cards', 'byScene', 'rows', 'recent'] as const;
export type SceneViewMode = (typeof SCENE_VIEW_MODES)[number];
/** 이미지 뷰(카드가 아닌 방식) */
export type SceneImageViewMode = Exclude<SceneViewMode, 'cards'>;
export type SceneViewTab = 'scene' | 'inpaint';
export type SceneViewModes = Record<SceneViewTab, SceneViewMode>;

export const DEFAULT_SCENE_VIEW_MODE: SceneViewMode = 'cards';

export const SCENE_VIEW_CAP_DEFAULT = 8;
export const SCENE_VIEW_CAP_MIN = 2;
export const SCENE_VIEW_CAP_MAX = 30;

/** 가로 줄 전용 상한(줄당 장수) — 「씬 별로」 상한과 따로 기억한다 */
export const SCENE_VIEW_ROW_CAP_DEFAULT = 20;
export const SCENE_VIEW_ROW_CAP_MIN = 2;
export const SCENE_VIEW_ROW_CAP_MAX = 50;

export const SCENE_VIEW_MODE_STORAGE_KEY = 'sdstudio-scene-view-mode';
export const SCENE_VIEW_CAP_STORAGE_KEY = 'sdstudio-scene-view-cap';
/** 가로 줄 상한 — 새 키(기존 sdstudio-scene-view-cap 은 구버전 호환으로 그대로 둔다) */
export const SCENE_VIEW_ROW_CAP_STORAGE_KEY = 'sdstudio-scene-view-row-cap';

export function normalizeSceneViewMode(value: unknown): SceneViewMode {
  return (SCENE_VIEW_MODES as readonly unknown[]).includes(value)
    ? (value as SceneViewMode)
    : DEFAULT_SCENE_VIEW_MODE;
}

/** 저장값(객체 또는 JSON 글자) → 탭 종류별 보기 방식. 모르는 값·깨진 값은 그 탭만 cards */
export function normalizeSceneViewModes(value: unknown): SceneViewModes {
  let v: any = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = undefined;
    }
  }
  const obj = v && typeof v === 'object' ? v : {};
  return {
    scene: normalizeSceneViewMode(obj.scene),
    inpaint: normalizeSceneViewMode(obj.inpaint),
  };
}

/** 씬별 상한 — 숫자가 아니면 기본 8, 범위 밖은 2~30 양 끝으로, 소수는 반올림 */
export function normalizeSceneViewCap(value: unknown): number {
  return normalizeCapIn(value, SCENE_VIEW_CAP_DEFAULT, SCENE_VIEW_CAP_MIN, SCENE_VIEW_CAP_MAX);
}

/** 가로 줄 상한 — 숫자가 아니면 기본 20, 범위 밖은 2~50 양 끝으로, 소수는 반올림 */
export function normalizeSceneViewRowCap(value: unknown): number {
  return normalizeCapIn(value, SCENE_VIEW_ROW_CAP_DEFAULT, SCENE_VIEW_ROW_CAP_MIN, SCENE_VIEW_ROW_CAP_MAX);
}

function normalizeCapIn(value: unknown, def: number, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return def;
  return Math.round(Math.min(max, Math.max(min, n)));
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readSceneViewModes(storage: KeyValueStorage | undefined): SceneViewModes {
  try {
    return normalizeSceneViewModes(storage?.getItem(SCENE_VIEW_MODE_STORAGE_KEY));
  } catch {
    return normalizeSceneViewModes(undefined);
  }
}

export function writeSceneViewModes(storage: KeyValueStorage | undefined, modes: SceneViewModes): void {
  try {
    storage?.setItem(SCENE_VIEW_MODE_STORAGE_KEY, JSON.stringify(normalizeSceneViewModes(modes)));
  } catch {
    // 저장 실패는 이번 실행 동안만 유지(보기 설정이라 알리지 않음)
  }
}

export function readSceneViewCap(storage: KeyValueStorage | undefined): number {
  try {
    const raw = storage?.getItem(SCENE_VIEW_CAP_STORAGE_KEY);
    return raw == null ? SCENE_VIEW_CAP_DEFAULT : normalizeSceneViewCap(raw);
  } catch {
    return SCENE_VIEW_CAP_DEFAULT;
  }
}

export function writeSceneViewCap(storage: KeyValueStorage | undefined, cap: number): void {
  try {
    storage?.setItem(SCENE_VIEW_CAP_STORAGE_KEY, String(normalizeSceneViewCap(cap)));
  } catch {
    // 위와 같음
  }
}

export function readSceneViewRowCap(storage: KeyValueStorage | undefined): number {
  try {
    const raw = storage?.getItem(SCENE_VIEW_ROW_CAP_STORAGE_KEY);
    return raw == null ? SCENE_VIEW_ROW_CAP_DEFAULT : normalizeSceneViewRowCap(raw);
  } catch {
    return SCENE_VIEW_ROW_CAP_DEFAULT;
  }
}

export function writeSceneViewRowCap(storage: KeyValueStorage | undefined, cap: number): void {
  try {
    storage?.setItem(SCENE_VIEW_ROW_CAP_STORAGE_KEY, String(normalizeSceneViewRowCap(cap)));
  } catch {
    // 위와 같음
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** 보기 상태(앱 전체 하나) — 여러 화면이 observer 안에서 읽는다. 바꾸는 것은 아래 set 함수만. */
export const sceneViewState = observable({
  modes: readSceneViewModes(safeStorage()),
  cap: readSceneViewCap(safeStorage()),
  /** 가로 줄 상한(줄당 장수) — 씬 별로 상한(cap)과 독립 */
  rowCap: readSceneViewRowCap(safeStorage()),
});

export function sceneViewModeOf(tab: SceneViewTab): SceneViewMode {
  return sceneViewState.modes[tab];
}

export const setSceneViewMode = action((tab: SceneViewTab, mode: SceneViewMode) => {
  const next = normalizeSceneViewMode(mode);
  if (sceneViewState.modes[tab] === next) return;
  sceneViewState.modes = { ...sceneViewState.modes, [tab]: next };
  writeSceneViewModes(safeStorage(), sceneViewState.modes);
});

export const setSceneViewCap = action((cap: number) => {
  const next = normalizeSceneViewCap(cap);
  if (sceneViewState.cap === next) return;
  sceneViewState.cap = next;
  writeSceneViewCap(safeStorage(), next);
});

export const setSceneViewRowCap = action((cap: number) => {
  const next = normalizeSceneViewRowCap(cap);
  if (sceneViewState.rowCap === next) return;
  sceneViewState.rowCap = next;
  writeSceneViewRowCap(safeStorage(), next);
});

export const SCENE_VIEW_TEXT = {
  label: '보기 방식',
  modes: {
    cards: '씬 카드',
    byScene: '씬 별로',
    rows: '가로 줄',
    recent: '최근 순',
  } as Record<SceneViewMode, string>,
  capPrefix: '씬당',
  capUnit: '장',
  capAria: '씬마다 보여 줄 이미지 수',
  rowCapPrefix: '줄당',
  rowCapAria: '가로 줄마다 보여 줄 이미지 수',
  dialog: '씬 목록을 어떻게 보여 줄지 고르세요. 프로젝트 데이터는 바뀌지 않습니다.',
  /** 선택 창이 「현재 값」 표시를 지원하지 않아 고른 항목 글자 앞에 붙인다(보기 순서와 같은 방식) */
  currentMark: '✓ ',
  /** 더보기 카드의 남은 장수 */
  more: (remaining: number) => `+${remaining}`,
  moreAria: (scene: string, remaining: number) => `${scene} 이미지 ${remaining}장 더 보기`,
  sceneMenuAria: (scene: string) => `${scene} 씬 메뉴`,
  noScenes: '아직 씬이 없습니다',
  noScenesHint: '툴바의 [씬 추가] 버튼으로 첫 씬을 만들어 보세요',
  noSearchResult: '검색 결과가 없습니다',
  noImages: '아직 이미지가 없습니다',
  /** 「최근 순」에서 이미지가 없는 씬으로 이동하려 할 때 */
  noImageToReveal: (scene: string) => `${scene} 씬에는 보여 줄 이미지가 없습니다`,
  selectDisabled: '씬 카드 보기에서만 여러 씬을 선택할 수 있습니다',
};

/** 보기 방식 선택 창(appState.pushDialogAsync type 'select') 내용 — 지금 고른 쪽 앞에 ✓ */
export function buildSceneViewModeMenu(current: SceneViewMode): {
  text: string;
  items: { text: string; value: SceneViewMode }[];
} {
  return {
    text: SCENE_VIEW_TEXT.dialog,
    items: SCENE_VIEW_MODES.map((mode) => ({
      text: (mode === current ? SCENE_VIEW_TEXT.currentMark : '') + SCENE_VIEW_TEXT.modes[mode],
      value: mode,
    })),
  };
}

// ===== 칸 목록 =====

/** 씬 하나의 재료 — outputs = gameService.getOutputs 결과(휴지통 제외 파일 이름), input = 변형 씬의 입력 원본 이름 */
export interface SceneImageSource {
  name: string;
  outputs: readonly string[];
  input?: string;
}

export type SceneImageCell =
  /** 씬 첫 칸 — 생성 탭은 그 씬의 가장 최근 결과(filename), 변형 탭은 입력 원본(input). 둘 다 없으면 빈 첫 칸 */
  | { kind: 'head'; scene: string; filename?: string; input?: string; total: number }
  | { kind: 'img'; scene: string; filename: string }
  /** 더보기 카드 — remaining = 보이지 않은 결과 장수 */
  | { kind: 'more'; scene: string; remaining: number };

/** 가로 줄 하나 = 씬 하나의 칸들(첫 칸 → 이미지 → 더보기) */
export interface SceneImageRow {
  scene: string;
  cells: SceneImageCell[];
}

export interface SceneImageLayout {
  cells: SceneImageCell[];
  /** 씬 이름 → 「씬으로 이동」 대상 칸 인덱스(씬 별로·가로 줄 = 첫 칸, 최근 순 = 그 씬의 가장 최근 이미지). 칸이 없는 씬은 없음 */
  firstIndex: Map<string, number>;
  /** 가로 줄만 — 씬마다 한 줄(목록 순서). cells 는 이 줄들을 이어 붙인 것 */
  rows?: SceneImageRow[];
  /** 가로 줄만 — 씬 이름 → 줄 인덱스 */
  rowIndex?: Map<string, number>;
}

/** 이름 목록을 생성 시각 최신 먼저로(시각 모름 = 뒤, 같은 시각·시각 모름 끼리는 원래 순서 — 안정 정렬) */
export function newestFirstBy<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
  const keyed = items.map((item, index) => ({ item, index, t: outputTimestampOf(nameOf(item)) }));
  keyed.sort((a, b) => {
    if (a.t === undefined && b.t === undefined) return a.index - b.index;
    if (a.t === undefined) return 1;
    if (b.t === undefined) return -1;
    if (a.t !== b.t) return b.t - a.t;
    return a.index - b.index;
  });
  return keyed.map((k) => k.item);
}

// 씬별 정렬 결과 — 키 = 결과 목록 배열의 정체성. GameService.refreshList 가 바뀔 때마다 새 배열을 대입하므로
// 바뀐 씬만 다시 정렬된다(조사 문서 3-3).
const sortedMemo = new WeakMap<readonly string[], readonly string[]>();

export function sortedNewestOf(outputs: readonly string[]): readonly string[] {
  let hit = sortedMemo.get(outputs);
  if (!hit) {
    hit = newestFirstBy(outputs, (x) => x);
    sortedMemo.set(outputs, hit);
  }
  return hit;
}

/**
 * 씬 별로 — 씬 순서대로 칸을 평평하게 잇는다(줄을 바꾸지 않음).
 * · 생성 탭: 첫 칸 = 가장 최근 결과, 이어서 나머지 결과 최신순. 결과 칸(첫 칸 포함) 최대 cap 장.
 * · 변형 탭: 첫 칸 = 입력 원본(결과가 아님), 이어서 결과 최신순. 첫 칸 포함 최대 cap 칸(= 결과 cap−1 장).
 * · 넘치면 마지막에 더보기 칸(remaining = 보이지 않은 결과 장수). 이미지가 없는 씬 = 빈 첫 칸 하나.
 */
export function buildBySceneCells(
  sources: readonly SceneImageSource[],
  cap: number,
  tab: SceneViewTab,
): SceneImageLayout {
  const limit = normalizeSceneViewCap(cap);
  const cells: SceneImageCell[] = [];
  const firstIndex = new Map<string, number>();
  for (const src of sources) {
    firstIndex.set(src.name, cells.length);
    pushSceneCells(cells, src, limit, tab);
  }
  return { cells, firstIndex };
}

/** 씬 하나의 칸(첫 칸 → 이미지 최신순 → 더보기)을 cells 끝에 붙인다 — 씬 별로·가로 줄 공용. limit = 정리된 상한 */
function pushSceneCells(cells: SceneImageCell[], src: SceneImageSource, limit: number, tab: SceneViewTab): void {
  const sorted = sortedNewestOf(src.outputs);
  if (tab === 'inpaint') {
    cells.push({ kind: 'head', scene: src.name, input: src.input || undefined, total: sorted.length });
    const shown = Math.min(sorted.length, limit - 1);
    for (let i = 0; i < shown; i++) cells.push({ kind: 'img', scene: src.name, filename: sorted[i] });
    if (sorted.length > shown) cells.push({ kind: 'more', scene: src.name, remaining: sorted.length - shown });
  } else {
    cells.push({ kind: 'head', scene: src.name, filename: sorted[0], total: sorted.length });
    const shown = Math.min(sorted.length, limit);
    for (let i = 1; i < shown; i++) cells.push({ kind: 'img', scene: src.name, filename: sorted[i] });
    if (sorted.length > shown) cells.push({ kind: 'more', scene: src.name, remaining: sorted.length - shown });
  }
}

/**
 * 가로 줄 — 씬마다 한 줄. 줄의 칸 = 「씬 별로」의 그 씬 칸과 같은 규칙(pushSceneCells), 상한만 가로 줄 전용(2~50, 기본 20).
 * 목록의 모든 씬이 줄을 가진다(이미지 없는 씬 = 빈 첫 칸만 있는 줄).
 */
export function buildSceneRows(
  sources: readonly SceneImageSource[],
  rowCap: number,
  tab: SceneViewTab,
): SceneImageLayout {
  const limit = normalizeSceneViewRowCap(rowCap);
  const cells: SceneImageCell[] = [];
  const firstIndex = new Map<string, number>();
  const rows: SceneImageRow[] = [];
  const rowIndex = new Map<string, number>();
  for (const src of sources) {
    const start = cells.length;
    firstIndex.set(src.name, start);
    pushSceneCells(cells, src, limit, tab);
    rowIndex.set(src.name, rows.length);
    rows.push({ scene: src.name, cells: cells.slice(start) });
  }
  return { cells, firstIndex, rows, rowIndex };
}

/** 최근 순 — 모든 씬의 결과를 한데 모아 최신 먼저(시각 모름은 맨 뒤, 그 안에서는 씬 순서·목록 순서). 이미지가 없는 씬은 칸이 없다 */
export function buildRecentCells(sources: readonly SceneImageSource[]): SceneImageLayout {
  const all: { scene: string; filename: string }[] = [];
  for (const src of sources) {
    for (const filename of src.outputs) all.push({ scene: src.name, filename });
  }
  const sorted = newestFirstBy(all, (x) => x.filename);
  const cells: SceneImageCell[] = [];
  const firstIndex = new Map<string, number>();
  sorted.forEach((x, i) => {
    if (!firstIndex.has(x.scene)) firstIndex.set(x.scene, i);
    cells.push({ kind: 'img', scene: x.scene, filename: x.filename });
  });
  return { cells, firstIndex };
}

export function buildSceneImageLayout(
  mode: SceneImageViewMode,
  sources: readonly SceneImageSource[],
  cap: number,
  tab: SceneViewTab,
): SceneImageLayout {
  if (mode === 'recent') return buildRecentCells(sources);
  // 가로 줄은 cap 자리에 가로 줄 상한(sceneViewState.rowCap)을 받는다
  if (mode === 'rows') return buildSceneRows(sources, cap, tab);
  return buildBySceneCells(sources, cap, tab);
}

/**
 * 렌더마다 다시 만들지 않게 직전 결과를 기억한다 — 방식·상한·탭이 같고, 씬마다 이름·결과 배열(정체성)·입력이 같으면 직전 결과 그대로.
 * 생성 중에는 목록이 진행 이벤트마다 다시 그려지므로(QueueControl 'progress') 이 비교가 칸 목록 재계산을 막는다.
 */
export function createSceneImageLayoutMemo() {
  let last:
    | { mode: SceneImageViewMode; cap: number; tab: SceneViewTab; sources: readonly SceneImageSource[]; layout: SceneImageLayout }
    | undefined;
  return (
    mode: SceneImageViewMode,
    sources: readonly SceneImageSource[],
    cap: number,
    tab: SceneViewTab,
  ): SceneImageLayout => {
    if (last && last.mode === mode && last.tab === tab && (mode === 'recent' || last.cap === cap) && sameSources(last.sources, sources)) {
      return last.layout;
    }
    const layout = buildSceneImageLayout(mode, sources, cap, tab);
    last = { mode, cap, tab, sources, layout };
    return layout;
  };
}

function sameSources(a: readonly SceneImageSource[], b: readonly SceneImageSource[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].outputs !== b[i].outputs || (a[i].input || '') !== (b[i].input || '')) return false;
  }
  return true;
}

/** 씬 이름 → 「씬으로 이동」 칸 인덱스(없으면 −1) */
export function sceneCellIndex(layout: SceneImageLayout, scene: string): number {
  return layout.firstIndex.get(scene) ?? -1;
}

/** 칸 인덱스 범위(양 끝 포함) → 그 안에 칸이 하나라도 있는 씬 이름(처음 나온 순서, 중복 없음) */
export function scenesInCellRange(cells: readonly SceneImageCell[], start: number, end: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const from = Math.max(0, start);
  const to = Math.min(cells.length - 1, end);
  for (let i = from; i <= to; i++) {
    const name = cells[i].scene;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** 가로 줄 — 씬 이름 → 줄 인덱스(목록에 없는 씬은 −1. 이미지 없는 씬도 줄이 있다) */
export function sceneRowIndex(layout: SceneImageLayout, scene: string): number {
  return layout.rowIndex?.get(scene) ?? -1;
}

/** 가로 줄 — 보이는 줄 범위(양 끝 포함) → 그 줄들의 씬 이름(줄 순서). 범위는 배열 안으로 잘림 */
export function scenesInRowRange(rows: readonly SceneImageRow[], start: number, stop: number): string[] {
  const out: string[] = [];
  const from = Math.max(0, start);
  const to = Math.min(rows.length - 1, stop);
  for (let i = from; i <= to; i++) out.push(rows[i].scene);
  return out;
}

/** 가상 격자의 보이는 줄 범위 → 칸 인덱스 범위(양 끝 포함) */
export function visibleCellRange(rowStart: number, rowStop: number, columnCount: number): [number, number] {
  const cols = Math.max(1, columnCount);
  return [Math.max(0, rowStart) * cols, (Math.max(rowStart, rowStop) + 1) * cols - 1];
}

// ===== 칸 크기 =====

/** 칸 안쪽 여백(칸 사이 = 2배) */
export const SCENE_IMAGE_CELL_PAD = 3;

/**
 * 「씬 별로」에서 이 칸이 앞줄에서 이어진 씬의 줄 첫 칸인가(2026-11-26 — 어느 씬의 이미지인지 구분).
 * 참이면 그 칸에 씬 이름을 작게 다시 적는다. 씬의 첫 칸은 이름 띠가 있으므로 거짓.
 */
export function sceneContinuesRow(
  cells: readonly SceneImageCell[],
  index: number,
  columnCount: number,
): boolean {
  const cell = cells[index];
  if (!cell || cell.kind === 'head') return false;
  return columnCount > 0 && index % columnCount === 0;
}
/** 「최근 순」 칸 아래 씬 이름 줄 높이 */
export const SCENE_IMAGE_CAPTION = 20;
/** 모바일 최소 트랙 = 씬 카드 격자와 같은 min(9rem, 50%) */
const MOBILE_MIN_TRACK_PX = 144;

export interface SceneImageGridMetrics {
  columnCount: number;
  columnWidth: number;
  rowHeight: number;
  /** 칸 안 그림 자리 높이(여백·캡션 제외) */
  imageHeight: number;
  /** 받아 올 썸네일 크기 — 단계 값(200·400·500)만, 모바일은 400 */
  thumb: number;
}

/**
 * 칸 크기 — 씬 카드 격자와 같은 규칙: PC 열 최소 폭 = 씬 카드 크기 슬라이더(sceneCardMinWidthPx), 남는 폭은 열이 나눠 채움(1fr),
 * 그림 비율 = 카드 비율 설정(세로 3:4·정사각·가로 4:3·높이 고정 = 슬라이더 높이). 모바일 = 정사각, 최소 트랙 min(9rem, 50%).
 */
export function sceneImageGridMetrics(opts: {
  width: number;
  mobile: boolean;
  percent: number;
  cardStyle?: string;
  caption: number;
}): SceneImageGridMetrics {
  const width = Math.max(1, Math.floor(opts.width));
  const minTrack = opts.mobile
    ? Math.min(MOBILE_MIN_TRACK_PX, width / 2)
    : sceneCardMinWidthPx(opts.percent);
  const columnCount = Math.max(1, Math.floor(width / Math.max(1, minTrack)));
  const columnWidth = Math.max(1, Math.floor(width / columnCount));
  const inner = Math.max(1, columnWidth - SCENE_IMAGE_CELL_PAD * 2);
  let imageHeight = inner;
  if (!opts.mobile) {
    switch (opts.cardStyle ?? 'portrait') {
      case 'square':
        imageHeight = inner;
        break;
      case 'landscape':
        imageHeight = Math.round((inner * 3) / 4);
        break;
      case 'fixedHeight':
        imageHeight = sceneCardFixedHeightPx(opts.percent);
        break;
      default:
        imageHeight = Math.round((inner * 4) / 3);
    }
  }
  const rowHeight = imageHeight + SCENE_IMAGE_CELL_PAD * 2 + opts.caption;
  // PC = 이미지 그리드와 같은 규칙(칸 크기를 단계 값으로 올림). 모바일 = 씬 카드와 같은 400(칸은 작아도 화면 밀도가 높다 — 500 은 원본 통째 읽기라 쓰지 않음)
  const thumb = opts.mobile ? 400 : imageGridThumbPx(Math.max(inner, imageHeight));
  return { columnCount, columnWidth, rowHeight, imageHeight, thumb };
}

/** PC 가로 스크롤 막대 높이 — App.css 전역 ::-webkit-scrollbar height 14px(PC). 가로 줄 높이에 더해 그림이 잘리지 않게 */
export const SCENE_IMAGE_ROW_SCROLLBAR_PC = 14;
/** 모바일 가로 줄 = 한 화면에 약 3.3칸(옆 칸이 살짝 걸쳐 보여 넘길 수 있음을 알림) */
export const SCENE_IMAGE_ROW_MOBILE_CELLS = 3.3;

export interface SceneImageRowMetrics {
  /** 줄 안 칸 하나의 폭(여백 포함) */
  cellWidth: number;
  /** 칸 안 그림 자리 높이 */
  imageHeight: number;
  /** 칸 높이(그림 + 위아래 여백) */
  cellHeight: number;
  /** 줄 높이(칸 높이 + PC 가로 스크롤 막대) */
  rowHeight: number;
  thumb: number;
}

/**
 * 가로 줄 칸 크기 — PC = 「씬 별로」 격자의 열 폭·그림 높이 그대로(크기 슬라이더·카드 비율 설정을 따름),
 * 모바일 = floor(폭 / 3.3) 정사각(썸네일 400). PC 는 줄 아래 가로 스크롤 막대 몫을 줄 높이에 더한다
 * (모바일은 줄의 가로 막대를 숨겨(no-scrollbar) 자리를 차지하지 않으므로 더하지 않음).
 */
export function sceneImageRowMetrics(opts: {
  width: number;
  mobile: boolean;
  percent: number;
  cardStyle?: string;
}): SceneImageRowMetrics {
  if (opts.mobile) {
    const cellWidth = Math.max(1, Math.floor(Math.max(1, opts.width) / SCENE_IMAGE_ROW_MOBILE_CELLS));
    const imageHeight = Math.max(1, cellWidth - SCENE_IMAGE_CELL_PAD * 2);
    const cellHeight = imageHeight + SCENE_IMAGE_CELL_PAD * 2;
    return { cellWidth, imageHeight, cellHeight, rowHeight: cellHeight, thumb: 400 };
  }
  const grid = sceneImageGridMetrics({ ...opts, caption: 0 });
  const cellHeight = grid.imageHeight + SCENE_IMAGE_CELL_PAD * 2;
  return {
    cellWidth: grid.columnWidth,
    imageHeight: grid.imageHeight,
    cellHeight,
    rowHeight: cellHeight + SCENE_IMAGE_ROW_SCROLLBAR_PC,
    thumb: grid.thumb,
  };
}

// ===== 「씬으로 이동」 등록소 =====
// 가상 격자에서는 화면 밖 씬의 칸이 DOM 에 없다 → 카드 DOM(scene-cell-…)을 찾는 대신 「씬 이름 → 칸 인덱스 → scrollToItem」.
// 메인 씬 목록(QueueControl, 탭 종류마다 하나)이 등록하고, 히스토리 navigateTo(ImageHistoryService)가 읽는다.
// 씬 카드 보기(isImageView() 거짓)에서는 부르는 쪽이 종전 DOM 길을 그대로 쓴다.

export interface SceneRevealer {
  /** 지금 이미지 뷰인가(카드 보기면 거짓 — 종전 길) */
  isImageView(): boolean;
  /** 이미지 뷰가 보이는 탭에 그려져 스크롤할 수 있는가 */
  isReady(): boolean;
  /** 그 씬의 칸으로 스크롤. 칸이 없으면(최근 순의 이미지 없는 씬) 스크롤하지 않고 거짓 */
  reveal(scene: string): boolean;
}

const revealers = new Map<SceneViewTab, SceneRevealer>();

export function registerSceneRevealer(tab: SceneViewTab, revealer: SceneRevealer): () => void {
  revealers.set(tab, revealer);
  return () => {
    if (revealers.get(tab) === revealer) revealers.delete(tab);
  };
}

export function getSceneRevealer(tab: SceneViewTab): SceneRevealer | undefined {
  return revealers.get(tab);
}

// ===== 이미지 칸 누름 = 상세 보기로 바로(2026-11-26) =====
// 이미지 뷰의 이미지 칸을 누르면 그 씬의 이미지 뷰어(ResultViewer)를 「상세 보기로 바로 열기」로 띄운다 —
// 처음 렌더부터 상세 보기가 그 이미지로 열리고(그리드가 먼저 보이지 않게), 그 상세 보기를 닫으면 뷰어 전체가 닫혀 씬 목록으로 돌아온다.
// 그리드 탭에서 평소처럼 연 상세 보기·다른 진입점(씬 카드·더보기·히스토리·단축키)은 종전 그대로 그리드.

/**
 * 「바로 열기」의 처음 상세 보기 인덱스 — 바로 열기가 아니거나, 파일 이름이 없거나, 지금 그리드 순서 목록에 그 이미지가 없으면
 * undefined(= 종전처럼 그리드를 그 이미지 위치로). paths 는 그리드 「이미지」 탭의 보기 순서 목록(경로 끝이 /파일 이름).
 */
export function directDetailStartIndex(
  direct: boolean,
  filename: string | undefined,
  paths: () => readonly string[],
): number | undefined {
  if (!direct || !filename) return undefined;
  const idx = paths().findIndex((p) => p.endsWith('/' + filename));
  return idx >= 0 ? idx : undefined;
}

/**
 * 상세 보기를 닫을 때 갈 곳 — 'viewer' = 뷰어 전체 닫기(바로 열어 시작했고 부르는 쪽이 아직 그 뜻을 유지할 때),
 * 'grid' = 종전처럼 그리드로. 바로 열기 중에 다른 길(히스토리 「이미지 그리드에서 보기」 등)이 같은 뷰어의 초점을 바꿔
 * 부르는 쪽이 닫기 콜백을 거두면 그리드로 돌아간다.
 */
export function directDetailCloseTarget(startedDirect: boolean, canCloseViewer: boolean): 'viewer' | 'grid' {
  return startedDirect && canCloseViewer ? 'viewer' : 'grid';
}
