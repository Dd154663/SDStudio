// 오버레이(모달) 창 크기 체계 — 단일 출처(2026-11-11 묶음 0, SPEC_GUIDE 「오버레이 창 크기 체계」).
// 공용 래퍼 ModalOverlay 는 이 모듈로만 창 틀의 폭·높이·클래스를 정한다. 새 창은 `size` 만 쓰고
// Tailwind 폭 클래스(`width`)는 넘기지 않는다(옛 호출부 호환용, specGuard 동결).
//
// 순수 모듈(React·서비스 import 없음) — 단위 테스트가 그대로 부른다.
import type { CSSProperties } from 'react';

export type OverlaySize = 's' | 'm' | 'l' | 'xl' | 'full';

export interface OverlaySizeSpec {
  /** PC 폭(px). 실제 폭 = min(이 값, 94vw). 모바일 = min(이 값, 90vw) */
  width: number;
  /** 높이 모드: content = 내용 높이(최소~최대 사이, 넘치면 본문만 스크롤), fixed = 고정 */
  height: 'content' | 'fixed';
  /** content 모드의 PC 최소 높이(px) */
  minHeight?: number;
  /** fixed 모드의 PC 고정 높이 상한(px) — 실제 = min(85vh, 이 값) */
  fixedHeight?: number;
}

/** 등급 표(PC). full 은 별도 — 94vw × 92vh(옛 fullscreen 과 같다). */
export const OVERLAY_SIZES: Record<Exclude<OverlaySize, 'full'>, OverlaySizeSpec> = {
  s: { width: 480, height: 'content', minHeight: 200 },
  m: { width: 720, height: 'content', minHeight: 360 },
  l: { width: 1000, height: 'fixed', fixedHeight: 760 },
  xl: { width: 1280, height: 'fixed', fixedHeight: 860 },
};

/** PC 폭 상한(뷰포트 비율) — 화면이 등급보다 좁으면 이 값으로 줄 뿐, 내용으로는 바뀌지 않는다. */
export const OVERLAY_PC_MAX_VW = 94;
/** 모바일 폭(현행 유지) */
export const OVERLAY_MOBILE_VW = 90;
/** 최대 높이(content 모드)·고정 높이 상한(fixed 모드)의 뷰포트 비율 */
export const OVERLAY_MAX_VH = 85;
/** 왼쪽 세로 탭 열 폭(px, 160~200 범위) — L 이상·PC 만 */
export const OVERLAY_SIDE_TABS_WIDTH = 180;
/** 「목록 | 편집」 두 열의 왼쪽 목록 폭(px) — L 이상·PC 만 */
export const OVERLAY_ASIDE_WIDTH = 280;

/** 두 열(세로 탭·왼쪽 목록)을 쓸 수 있는 등급 */
export const isWideOverlaySize = (size: OverlaySize | undefined): boolean =>
  size === 'l' || size === 'xl' || size === 'full';

/**
 * 옛 `width` 폭 클래스 → 등급 자동 매핑(묶음 1 이후 창별 전환의 출발점, 참고용).
 * 실제 배정은 창 내용·배치에 따라 조사 표((e) 창별 배정표)를 우선한다 — 이 표는 기본 추천일 뿐.
 * 기본 `max-w-xl`(width 생략) 도 M.
 */
export const LEGACY_WIDTH_TO_SIZE: Record<string, OverlaySize> = {
  'max-w-sm': 's', // 384
  'max-w-md': 's', // 448
  'max-w-lg': 's', // 512 — 폼이 많은 창(내보내기 설정)은 M/L 로 올리는 것을 검토
  'max-w-xl': 'm', // 576 (ModalOverlay 기본값)
  'max-w-2xl': 'm', // 672
  'max-w-3xl': 'l', // 768
  'max-w-4xl': 'l', // 896
  'max-w-5xl': 'l', // 1024 — 카드 그리드 창은 XL 검토
  'max-w-6xl': 'xl', // 1152
  'max-w-7xl': 'xl', // 1280
  'max-w-[90vw]': 'xl',
  'max-w-none': 'xl',
};

/**
 * 폭 클래스 문자열(예 'max-w-3xl md:max-w-7xl') → 추천 등급. 반응형 접두가 있으면 가장 넓은(마지막) 값을 쓴다.
 * 알 수 없으면 undefined.
 */
export function legacyWidthToSize(width: string | undefined): OverlaySize | undefined {
  if (width === undefined) return 'm';
  let found: OverlaySize | undefined;
  for (const token of width.split(/\s+/)) {
    const bare = token.replace(/^(sm|md|lg|xl|2xl):/, '');
    const hit = LEGACY_WIDTH_TO_SIZE[bare];
    if (hit) found = hit;
  }
  return found;
}

/** 창 상자 공통 모양(배경·반경·그림자·테두리·세로 배치) — 옛 ModalOverlay 와 같은 클래스 */
const SHELL = 'bg-[var(--c-zone)] rounded-xl shadow-2xl flex flex-col overflow-hidden border line-color';

/** 옛 width 경로·fullscreen 경로의 클래스(ModalOverlay 2026-11-10 이전과 글자 하나까지 같아야 한다) */
export const legacyFrameClass = (width: string): string => `${width} w-[90vw] max-h-[85vh] ${SHELL}`;
export const FULLSCREEN_FRAME_CLASS_MOBILE = 'w-full h-full bg-[var(--c-zone)] flex flex-col overflow-hidden';
export const FULLSCREEN_FRAME_CLASS_PC = `w-[94vw] h-[92vh] ${SHELL}`;

export interface OverlayFrame {
  /** legacy = 옛 width 클래스 경로(동작 불변), size = 등급 경로, full = 전체 화면 */
  mode: 'legacy' | 'size' | 'full';
  /** 등급(legacy 면 undefined) */
  size?: OverlaySize;
  className: string;
  style?: CSSProperties;
}

/**
 * 창 상자의 클래스·인라인 크기를 정한다(순수).
 * - size 가 있으면 등급 규칙(size 가 width 보다 우선). fullscreen 은 size='full' 과 같다.
 * - size 가 없으면 옛 width 클래스 그대로(생략 시 'max-w-xl') — 기존 호출부 동작 불변.
 * - 모바일: 폭 min(등급, 90vw)·최대 85vh 만(최소·고정 높이 미적용). full 은 화면 전체.
 */
export function resolveOverlayFrame(opts: {
  size?: OverlaySize;
  width?: string;
  fullscreen?: boolean;
  mobile: boolean;
}): OverlayFrame {
  const size: OverlaySize | undefined = opts.size ?? (opts.fullscreen ? 'full' : undefined);
  if (size === 'full') {
    return {
      mode: 'full',
      size,
      className: opts.mobile ? FULLSCREEN_FRAME_CLASS_MOBILE : FULLSCREEN_FRAME_CLASS_PC,
    };
  }
  if (!size) {
    return { mode: 'legacy', className: legacyFrameClass(opts.width ?? 'max-w-xl') };
  }
  const spec = OVERLAY_SIZES[size];
  if (opts.mobile) {
    return {
      mode: 'size',
      size,
      className: `w-[90vw] max-h-[85vh] ${SHELL}`,
      style: { maxWidth: `${spec.width}px` },
    };
  }
  const style: CSSProperties = { width: `min(${spec.width}px, ${OVERLAY_PC_MAX_VW}vw)` };
  if (spec.height === 'fixed') {
    style.height = `min(${OVERLAY_MAX_VH}vh, ${spec.fixedHeight}px)`;
  } else {
    // 최소 높이도 85vh 를 넘지 않게(아주 낮은 창에서 최소가 최대를 이기지 않도록)
    style.minHeight = `min(${spec.minHeight}px, ${OVERLAY_MAX_VH}vh)`;
    style.maxHeight = `${OVERLAY_MAX_VH}vh`;
  }
  return { mode: 'size', size, className: SHELL, style };
}

/**
 * 두 열 슬롯(sideTabs·aside)을 옆 열로 펼칠지 — PC·L 이상만. 아니면 sideTabs 는 렌더하지 않고
 * (호출부가 본문 안 가로 탭으로 대신 그린다), aside 는 본문 위에 쌓는다.
 */
export const overlayUsesColumns = (frame: OverlayFrame, mobile: boolean): boolean =>
  !mobile && frame.mode !== 'legacy' && isWideOverlaySize(frame.size);
