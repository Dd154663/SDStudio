/**
 * 인페인트 편집기 마스크 캔버스(BrushTool)를 언제 다시 그릴지 — 순수 판정(jest 대상).
 *
 * 편집기의 `mask` 값은 씬을 열 때 파일에서 한 번 읽은 것이고, 이후 붓질은 캔버스에만 있다.
 * 예전에는 표시 이미지(`image`)만 바뀌어도(생성 결과 표시·마스크 저장 뒤 원본 다시 읽기) 캔버스를
 * 비우고 열 때의 마스크로 되돌려, 생성 뒤 마스크가 옛 상태로 보이고 이미지가 잠깐 깜빡였다.
 * 그 상태로 다시 생성하면 옛 마스크가 파일에 저장될 수도 있었다(2026-10-04).
 *
 * 규칙: 마스크 원본·캔버스 크기·씬(resetKey)이 바뀔 때만 다시 그린다. 이미지만 바뀌면 현재 캔버스 유지.
 */
export interface MaskCanvasInputs {
  /** 불러온 마스크(data URI). 없으면 빈 마스크. */
  mask?: string;
  width: number;
  height: number;
  /** 씬이 바뀌면 달라지는 값 — 마스크가 둘 다 비어 있어도 이전 씬의 붓질을 지운다. */
  resetKey?: unknown;
}

export type MaskCanvasAction = 'reload' | 'keep';

export function maskCanvasAction(
  prev: MaskCanvasInputs | undefined,
  next: MaskCanvasInputs,
): MaskCanvasAction {
  if (!prev) return 'reload';
  if (prev.mask !== next.mask) return 'reload';
  if (prev.width !== next.width || prev.height !== next.height) return 'reload';
  if (prev.resetKey !== next.resetKey) return 'reload';
  return 'keep';
}
