// PC 씬 도구줄 오른쪽 끝 「씬 N · 이미지 N · ★ N」 합계 표시(2026-11-23 사용자 결정)의 순수 계산.
// 목적 = 뽑은 장수가 기대한 총 장수와 맞는지 확인. 표시 컴포넌트는 componenets/SceneTotalsBadge.tsx.
//
// 세는 범위 = 지금 보고 있는 탭(이미지생성 'scene' / 이미지변형 'inpaint')의 씬 전부.
//   씬 검색으로 목록을 좁혀도 합계는 탭 전체 그대로(보이는 씬만 더하지 않는다).
// 이미지 수 = 씬 카드 오른쪽 아래 숫자와 같은 출처(gameService.getOutputs(...).length — 휴지통·fastcache 제외).
// 즐겨찾기 수 = 씬 카드 별 옆 숫자와 같은 계산(scene.mains.length). 변형 탭은 지워진 파일이 mains 에 남을 수 있지만
//   카드와 합계가 어긋나지 않게 카드 계산을 그대로 따른다.

export interface SceneImageTotals {
  scenes: number;
  images: number;
  favorites: number;
}

export function sumSceneImageTotals<S extends { mains: readonly string[] }>(
  scenes: readonly S[],
  imageCount: (scene: S) => number,
): SceneImageTotals {
  let images = 0;
  let favorites = 0;
  for (const scene of scenes) {
    images += imageCount(scene);
    favorites += scene.mains.length;
  }
  return { scenes: scenes.length, images, favorites };
}

// 씬이 0개면 표시하지 않는다.
export function shouldShowSceneTotals(t: SceneImageTotals): boolean {
  return t.scenes > 0;
}

// 1,250 꼴 — 실행 환경 로캘과 무관하게 같은 모양.
export function formatTotalCount(n: number): string {
  return String(Math.max(0, Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function sceneTotalsTooltip(t: SceneImageTotals): string {
  return `이 탭의 씬 ${formatTotalCount(t.scenes)}개 · 이미지 ${formatTotalCount(
    t.images,
  )}장 · 즐겨찾기 ${formatTotalCount(t.favorites)}장 (휴지통 제외)`;
}

// ── 자리 판정(창이 작아지면 숨김) ──
// 표시는 보기 설정 묶음(카드 모양·크기) 바로 왼쪽에 absolute 로 떠 있어 레이아웃 폭을 차지하지 않는다
// — 버튼 이름 판정(measureButtonNames)·줄바꿈은 표시가 없는 것과 똑같이 정해진다.
// 그 결과 남은 빈자리(같은 줄 왼쪽 요소의 오른쪽 끝 ~ 묶음 왼쪽 끝)가 표시 폭 + 간격보다 넓을 때만 보인다.
// 보기 설정 묶음이 버튼 줄 아래로 줄바꿈됐으면(버튼 줄과 같은 줄이 아니면) 숨긴다.
export const SCENE_TOTALS_GAP_PX = 12;

export interface TotalsBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function sceneTotalsFits(input: {
  need: number; // 표시 자체 폭(보이지 않을 때도 잰다)
  anchor: TotalsBox; // 보기 설정 묶음
  row: TotalsBox | null; // 버튼 줄([data-bn-row])
  others: readonly TotalsBox[]; // 바깥 줄의 다른 flex 항목(버튼 줄 포함 가능)
  gap?: number; // 표시 왼쪽 여백(오른쪽 여백은 표시의 margin 으로 need 에 포함)
}): boolean {
  const { need, anchor, row, others } = input;
  const gap = input.gap ?? SCENE_TOTALS_GAP_PX;
  if (need <= 0) return false;
  const sameLine = (b: TotalsBox) => b.top < anchor.bottom && b.bottom > anchor.top;
  if (row && !sameLine(row)) return false;
  let limit = -Infinity;
  for (const b of row ? [row, ...others] : others) {
    if (!sameLine(b)) continue;
    if (b.right > anchor.left) continue; // 묶음 오른쪽에 있는 것은 상관없음
    limit = Math.max(limit, b.right);
  }
  if (limit === -Infinity) return true;
  return anchor.left - limit >= need + gap;
}
