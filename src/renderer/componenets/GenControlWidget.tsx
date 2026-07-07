import { useCallback, useRef } from 'react';
import { FaGripVertical } from 'react-icons/fa';
import { observer } from 'mobx-react-lite';
import { backend, isMobile } from '../models';
import { appState } from '../models/AppService';
import type { Config } from '../../main/config';
import { resolveLayout } from '../models/layoutTemplates';
import TaskQueueControl from './TaskQueueControl';
import Tooltip from './Tooltip';

// 분리형 생성 컨트롤 위젯 (PC 전용).
// 하단바의 TaskQueueControl 을 격자점 핸들 드래그로 "분리"해 화면 위 플로팅 카드로
// 만든다. TaskQueueControl 내부는 손대지 않고 그대로 임베드한다.
// 드래그는 react-dnd 대신 pointer 이벤트(setPointerCapture)로 직접 구현
// — 단순 fixed 이동이라 react-dnd 는 과하다.

const DRAG_THRESHOLD = 8; // 부착 상태에서 이 거리(px)를 넘으면 분리로 판정
const CLAMP_MARGIN = 4; // 뷰포트 밖으로 못 나가게 하는 최소 여백

// 위젯 위치를 뷰포트 안으로 클램프. w/h 는 카드 크기(모르면 대략치).
// 상단 타이틀바 위에 놓여도 위젯 자신이 titlebar-no-drag 라 조작되므로 별도 상단 가드는 없다.
function clampToViewport(x: number, y: number, w: number, h: number) {
  const maxX = Math.max(CLAMP_MARGIN, window.innerWidth - w - CLAMP_MARGIN);
  const maxY = Math.max(CLAMP_MARGIN, window.innerHeight - h - CLAMP_MARGIN);
  return {
    x: Math.min(Math.max(CLAMP_MARGIN, x), maxX),
    y: Math.min(Math.max(CLAMP_MARGIN, y), maxY),
  };
}

// 분리 여부·위치를 즉시 반영 + config 저장.
// ToolbarDnd.tsx 의 applyToolbarPlacement 패턴(getConfig→병합→setConfig) 복제.
async function applyGenWidget(next: NonNullable<Config['genWidget']>) {
  appState.genWidget = next;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, genWidget: next });
  } catch (e) {
    console.error('생성 컨트롤 위젯 배치 저장 실패:', e);
  }
}

// 하단바 도크 영역(data-gen-dock) 위에 좌표가 있는지 히트테스트.
function isOverDock(clientX: number, clientY: number): boolean {
  const el = document.elementFromPoint(clientX, clientY);
  if (el && el.closest('[data-gen-dock]')) return true;
  // elementFromPoint 가 실패(가려짐 등)하면 rect 로 폴백.
  const dock = document.querySelector('[data-gen-dock]');
  if (!dock) return false;
  const r = dock.getBoundingClientRect();
  return (
    clientX >= r.left &&
    clientX <= r.right &&
    clientY >= r.top &&
    clientY <= r.bottom
  );
}

// 부착 상태(하단바)에서 쓰는 격자점 드래그 핸들.
// 임계(8px)를 넘어가면 그 순간 분리 상태로 전환하며, 위치는 커서 기준으로 잡는다.
export const GenControlHandle = observer(() => {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const detachedRef = useRef(false); // 이번 드래그에서 이미 분리했는지

  const onPointerMove = useCallback((e: PointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!detachedRef.current) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      detachedRef.current = true;
    }
    // 커서를 카드 좌상단 약간 안쪽에 두고 따라가게(핸들 잡은 느낌).
    const pos = clampToViewport(e.clientX - 16, e.clientY - 16, 240, 60);
    appState.genWidget = { detached: true, x: pos.x, y: pos.y };
  }, []);

  const finish = useCallback(
    (e: PointerEvent, target: HTMLElement) => {
      target.releasePointerCapture?.(e.pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      startRef.current = null;
      if (detachedRef.current) {
        // 분리 완료 — 현재 위치로 저장.
        applyGenWidget({ ...appState.genWidget, detached: true });
      }
      detachedRef.current = false;
    },
    [onPointerMove],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startRef.current = { x: e.clientX, y: e.clientY };
      detachedRef.current = false;
      const target = e.currentTarget;
      target.setPointerCapture?.(e.pointerId);
      window.addEventListener('pointermove', onPointerMove);
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointerup', onUp);
        finish(ev, target);
      };
      window.addEventListener('pointerup', onUp);
    },
    [onPointerMove, finish],
  );

  return (
    <Tooltip content="드래그로 분리">
      <div
        onPointerDown={onPointerDown}
        className="flex flex-none items-center text-faint cursor-grab select-none touch-none"
        aria-label="생성 컨트롤 분리 핸들"
      >
        <FaGripVertical />
      </div>
    </Tooltip>
  );
});

// 플로팅 상태의 카드 — 좌측 동일 핸들 + TaskQueueControl.
// 핸들 드래그로 이동(뷰포트 클램프), 하단바 도크 위에서 놓으면 재부착.
export const GenControlFloating = observer(() => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  // 드래그 시작 시점의 커서-카드 오프셋(카드 좌상단 기준).
  const offsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  const gw = appState.genWidget;
  // 하단바 도크가 있는 레이아웃(클래식·사이드바 = bottomBar!=='none')에서만 재부착 가능.
  // 컴팩트(하단바 없음)에선 부착할 곳이 없으므로 "하단바에 놓으면 부착" 안내를 숨긴다.
  const canDock =
    resolveLayout(appState.uiLayoutTemplate, isMobile).bottomBar !== 'none';
  // 복원/최초 진입 시 위치가 없으면 화면 중앙 근처로. 렌더 시 뷰포트 클램프.
  const rawX = gw.x ?? Math.round(window.innerWidth / 2 - 120);
  const rawY = gw.y ?? Math.round(window.innerHeight / 2 - 30);
  const pos = clampToViewport(
    rawX,
    rawY,
    cardRef.current?.offsetWidth ?? 240,
    cardRef.current?.offsetHeight ?? 60,
  );

  const onPointerMove = useCallback((e: PointerEvent) => {
    const w = cardRef.current?.offsetWidth ?? 240;
    const h = cardRef.current?.offsetHeight ?? 60;
    const p = clampToViewport(
      e.clientX - offsetRef.current.dx,
      e.clientY - offsetRef.current.dy,
      w,
      h,
    );
    appState.genWidget = { detached: true, x: p.x, y: p.y };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = cardRef.current?.getBoundingClientRect();
      offsetRef.current = {
        dx: rect ? e.clientX - rect.left : 16,
        dy: rect ? e.clientY - rect.top : 16,
      };
      const target = e.currentTarget;
      target.setPointerCapture?.(e.pointerId);
      window.addEventListener('pointermove', onPointerMove);
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointermove', onPointerMove);
        target.releasePointerCapture?.(ev.pointerId);
        if (isOverDock(ev.clientX, ev.clientY)) {
          // 하단바 도크 위에서 놓음 → 재부착.
          applyGenWidget({ detached: false, x: appState.genWidget.x, y: appState.genWidget.y });
        } else {
          // 현재 위치로 저장.
          applyGenWidget({ ...appState.genWidget, detached: true });
        }
      };
      window.addEventListener('pointerup', onUp);
    },
    [onPointerMove],
  );

  return (
    <div
      ref={cardRef}
      className="titlebar-no-drag fixed z-[var(--z-widget)] bg-[var(--c-surface-2)] rounded-lg shadow-xl border line-color p-2 flex items-center gap-3 select-none"
      style={{ left: pos.x, top: pos.y }}
    >
      <Tooltip
        content={
          canDock ? '드래그로 이동 · 하단바에 놓으면 부착' : '드래그로 이동'
        }
      >
        <div
          onPointerDown={onPointerDown}
          className="flex flex-none items-center text-faint cursor-grab select-none touch-none"
          aria-label="생성 컨트롤 이동 핸들"
        >
          <FaGripVertical />
        </div>
      </Tooltip>
      <TaskQueueControl />
    </div>
  );
});
