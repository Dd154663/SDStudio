// Focused inpainting 영역 오버레이(2026-10-04 S2) — 마스크 캔버스 위 레이어.
// · 표시: 사각형 실선 + 사각형~안쪽 사각형(innerContextRect) 사이 맥락 띠 반투명 빨강 + 사각형 밖 약간 어둡게.
//   이미지 위 표시라 테마와 무관한 고정 팔레트 유틸(bg-red-500/30·bg-black/40)을 쓴다(네 테마 동일).
// · 조작(interactive): 빈 곳 드래그 = 새 사각형, 사각형 안 드래그 = 이동. 포인터 이벤트+pointer capture,
//   touch-action:none — 한 손가락만(두 번째 손가락이 닿으면 진행 중 드래그 취소). 드래그 중 Esc/뒤로 가기 =
//   그리기 취소(backStack 한 겹 — 새 window Esc 리스너 없음). 좌표·규칙은 models/focusedInpaintEditor.ts.
// · 부모(BrushTool 의 overlay 슬롯)가 캔버스와 같은 상자로 놓으므로 TransformWrapper 확대·이동을 그대로 따른다.
import { useEffect, useRef, useState } from 'react';
import { useBackLayer } from '../models/BackStackService';
import type { FocusRect } from '../models/focusedInpaint';
import {
  FocusDrag,
  FocusDragResult,
  PctRect,
  beginFocusDrag,
  clientToImagePoint,
  finishFocusDrag,
  focusOverlayGeometry,
  pointInRect,
  previewFocusDrag,
} from '../models/focusedInpaintEditor';

interface Props {
  imageWidth: number;
  imageHeight: number;
  /** 저장된 사각형(프리셋 focusX/Y/W/H). */
  rect: FocusRect | null;
  context: number;
  /** 저장된 사각형을 보일지(focusEnabled 또는 영역 도구 선택). */
  visible: boolean;
  /** 영역 도구가 포인터를 받는지(inpaintPointerTarget === 'focus'). */
  interactive: boolean;
  onCommit: (result: FocusDragResult) => void;
}

const pctStyle = (r: PctRect) => ({
  left: `${r.left}%`,
  top: `${r.top}%`,
  width: `${r.width}%`,
  height: `${r.height}%`,
});

export default function FocusAreaOverlay({
  imageWidth,
  imageHeight,
  rect,
  context,
  visible,
  interactive,
  onCommit,
}: Props) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ drag: FocusDrag; pointerId: number } | null>(null);
  const pointersRef = useRef(new Set<number>());
  const [draft, setDraft] = useState<{ rect: FocusRect | null; tooSmall: boolean } | null>(null);
  const [hoverInside, setHoverInside] = useState(false);

  const cancelDrag = () => {
    const cur = dragRef.current;
    dragRef.current = null;
    setDraft(null);
    if (cur && layerRef.current?.hasPointerCapture?.(cur.pointerId)) {
      try {
        layerRef.current.releasePointerCapture(cur.pointerId);
      } catch {
        /* 이미 놓인 포인터 */
      }
    }
  };
  // 그리는 중에만 한 겹 — Esc·Android 뒤로 가기 = 그리기 취소(편집 창은 닫히지 않음).
  useBackLayer(draft !== null, cancelDrag);
  // 드래그 도중 도구가 바뀌면(이동 모드·브러시 등) 그리기를 버린다.
  useEffect(() => {
    if (!interactive && dragRef.current) cancelDrag();
  }, [interactive]);

  const toImage = (e: { clientX: number; clientY: number }) => {
    const box = layerRef.current!.getBoundingClientRect();
    return clientToImagePoint(e.clientX, e.clientY, box, imageWidth, imageHeight);
  };

  const ready = imageWidth > 0 && imageHeight > 0;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || !ready) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 새 제스처의 첫 접촉(isPrimary)이면 지난 기록을 비운다(창 밖에서 뗀 포인터가 남아 막히지 않게).
    if (e.isPrimary) pointersRef.current.clear();
    pointersRef.current.add(e.pointerId);
    if (pointersRef.current.size > 1) {
      // 두 번째 손가락 — 사각형 조작이 아니므로 진행 중 드래그를 취소한다.
      cancelDrag();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const p = toImage(e);
    const drag = beginFocusDrag(p, rect);
    dragRef.current = { drag, pointerId: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 실패해도 드래그는 계속 — 놓친 pointerup 은 다음 누름(isPrimary)이 새 드래그로 대체 */
    }
    setDraft(previewFocusDrag(drag, p, imageWidth, imageHeight));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || !ready) return;
    const cur = dragRef.current;
    if (!cur) {
      if (e.pointerType === 'mouse') {
        const inside = pointInRect(toImage(e), rect);
        if (inside !== hoverInside) setHoverInside(inside);
      }
      return;
    }
    if (cur.pointerId !== e.pointerId) return;
    e.preventDefault();
    setDraft(previewFocusDrag(cur.drag, toImage(e), imageWidth, imageHeight));
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    pointersRef.current.delete(e.pointerId);
    const cur = dragRef.current;
    if (!cur || cur.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDraft(null);
    if (commit) onCommit(finishFocusDrag(cur.drag, toImage(e), imageWidth, imageHeight));
  };

  const shown = draft ? draft.rect : visible || interactive ? rect : null;
  const tentative = !!draft?.tooSmall;
  const geom =
    shown && ready && !tentative
      ? focusOverlayGeometry(shown, context, imageWidth, imageHeight)
      : null;

  if (!interactive && !shown) return null;

  return (
    <div
      ref={layerRef}
      className={`absolute inset-0 ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
      style={
        interactive
          ? { touchAction: 'none', cursor: hoverInside && !draft ? 'move' : 'crosshair' }
          : undefined
      }
      data-focus-area-overlay={interactive ? 'interactive' : 'view'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, true)}
      onPointerCancel={(e) => endPointer(e, false)}
      onLostPointerCapture={(e) => endPointer(e, false)}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setHoverInside(false);
      }}
    >
      {geom && (
        <>
          {geom.dim.map((d, i) => (
            <div
              key={`d${i}`}
              className={`absolute ${interactive ? 'bg-black/40' : 'bg-black/20'}`}
              style={pctStyle(d)}
            />
          ))}
          {geom.band.map((b, i) => (
            <div key={`b${i}`} className="absolute bg-red-500/30" style={pctStyle(b)} />
          ))}
          <div className="absolute border-2 border-red-500" style={pctStyle(geom.outer)} />
          <div
            className="absolute border border-dashed border-red-300"
            style={pctStyle(geom.inner)}
          />
        </>
      )}
      {shown && tentative && (
        <div
          className="absolute border-2 border-dashed border-red-500"
          style={pctStyle({
            left: (shown.x / imageWidth) * 100,
            top: (shown.y / imageHeight) * 100,
            width: (shown.w / imageWidth) * 100,
            height: (shown.h / imageHeight) * 100,
          })}
        />
      )}
    </div>
  );
}
