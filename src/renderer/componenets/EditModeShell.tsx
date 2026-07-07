import { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FaThLarge } from 'react-icons/fa';
import { backend } from '../models';
import { appState } from '../models/AppService';
import type { UiLayoutSlots } from '../../main/config';

// 편집 모드 셸 (PC 전용).
// 사용자가 화면에서 UI 배치를 직접 조작하는 모드의 셸. 안내 바 + 슬롯 배지 + 드롭 존만
// 담당한다(전역 클릭 흡수·툴바 어포던스는 병렬로 다른 곳에서 처리 — 여기서는 셸만).
// App.tsx 가 { !isMobile && appState.editMode && <EditModeShell /> } 로 렌더한다.
//
// 슬롯 배지는 App.tsx/BottomBar.tsx 가 부여한 위치 마커의 rect 를 측정해 그 위에 띄운다:
//   [data-slot="preset"]     — 프리셋 패널 래퍼
//   [data-slot="history"]    — 이미지 히스토리 패널 래퍼
//   [data-slot="gencontrol"] — 생성 컨트롤(하단바 도크 or 플로팅 위젯 루트)
// rect 를 못 찾은 슬롯(세션 없음·패널 접힘 등)은 배지를 그리지 않는다.

const DRAG_THRESHOLD = 8; // 이 거리(px)를 넘으면 드래그(가장자리 드롭)로 판정, 미달=클릭 토글

// 편집 대상 슬롯 3종의 서술자. preset/history 는 좌/우 드래그, gencontrol 은 클릭 토글.
type SlotKind = 'preset' | 'history' | 'gencontrol';

interface SlotDescriptor {
  kind: SlotKind;
  selector: string;
  label: string;
}

const SLOTS: SlotDescriptor[] = [
  { kind: 'preset', selector: '[data-slot="preset"]', label: '프리셋 패널' },
  { kind: 'history', selector: '[data-slot="history"]', label: '히스토리 패널' },
  {
    kind: 'gencontrol',
    selector: '[data-slot="gencontrol"]',
    label: '생성 컨트롤',
  },
];

// 슬롯 배지가 앉을 화면 좌표(마커 위 중앙 상단). 마커가 없으면 null.
interface BadgeRect {
  kind: SlotKind;
  label: string;
  // 배지를 -translate-x-1/2 로 중앙 정렬하므로 left 는 마커 가로 중심.
  left: number;
  top: number;
}

// 슬롯 배치를 즉시 반영 + config 저장. GenControlWidget 의 applyGenWidget 패턴 복제
// (appState 즉시 반영 → getConfig → 병합 setConfig, 실패는 console.error).
async function applyLayoutSlots(partial: Partial<UiLayoutSlots>) {
  const next: UiLayoutSlots = { ...appState.uiLayoutSlots, ...partial };
  appState.uiLayoutSlots = next;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, uiLayoutSlots: next });
  } catch (e) {
    console.error('레이아웃 슬롯 배치 저장 실패:', e);
  }
}

// 현재 슬롯 값(미설정 시 resolveLayout 과 동일한 기본값으로 해석).
function currentSide(kind: 'preset' | 'history'): 'left' | 'right' {
  const s = appState.uiLayoutSlots;
  if (kind === 'preset') return s.presetSide === 'right' ? 'right' : 'left';
  return s.historySide === 'left' ? 'left' : 'right';
}
function currentGenControl(): 'docked' | 'floating' {
  return appState.uiLayoutSlots.genControl === 'floating' ? 'floating' : 'docked';
}

// 마커 3종의 현재 화면 rect 를 측정해 배지 좌표 배열로 변환. 못 찾은 슬롯은 제외.
function measureBadges(): BadgeRect[] {
  const out: BadgeRect[] = [];
  for (const slot of SLOTS) {
    const el = document.querySelector(slot.selector);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    // 크기 0(미표시)인 마커는 건너뛴다.
    if (r.width <= 0 || r.height <= 0) continue;
    out.push({
      kind: slot.kind,
      label: slot.label,
      // 배지는 -translate-x-1/2 로 중앙 정렬되므로, 마커가 화면 가장자리에 바싹
      // 붙은 경우(예: 좌/우 끝에 도킹된 히스토리 패널) 배지가 화면 밖으로 잘린다.
      // 좌표를 화면 안으로 클램프해 배지 전체가 항상 보이게 한다.
      left: Math.min(
        Math.max(r.left + r.width / 2, 90),
        window.innerWidth - 90,
      ),
      // 마커 상단에 살짝 겹쳐 얹는다(음수가 되면 화면 안으로 끌어당김).
      top: Math.max(8, r.top + 6),
    });
  }
  // 두 패널을 같은 쪽에 두거나(특히 프리셋이 접혀 마커가 얇은 스플리터일 때),
  // 좌표 클램프로 같은 x 로 몰리면 배지들이 겹쳐 하나가 가려진다.
  // 가로로 가까운 배지는 뒤엣것을 한 줄씩 아래로 내려 계단식으로 펼친다.
  const BADGE_HALF = 90; // 배지 대략 반폭(px) — 이보다 가까우면 가로로 겹침
  const ROW = 38; // 한 줄 내림 높이(배지 높이 + 여백)
  for (let i = 0; i < out.length; i++) {
    let moved = true;
    while (moved) {
      moved = false;
      for (let j = 0; j < i; j++) {
        if (
          Math.abs(out[j].left - out[i].left) < BADGE_HALF * 2 &&
          Math.abs(out[j].top - out[i].top) < ROW
        ) {
          out[i].top = out[j].top + ROW;
          moved = true;
        }
      }
    }
  }
  return out;
}

const EditModeShell = observer(() => {
  const [badges, setBadges] = useState<BadgeRect[]>([]);
  // 드래그 중인 슬롯(preset/history)과 현재 커서가 얹힌 가장자리 존.
  const [dragging, setDragging] = useState<'preset' | 'history' | null>(null);
  const [hoverSide, setHoverSide] = useState<'left' | 'right' | null>(null);

  // 배지 rect 재측정. 배치 변경/리사이즈 후 rAF 로 한 번 더 확실히 잡는다.
  const remeasure = useCallback(() => {
    setBadges(measureBadges());
  }, []);

  // 마운트 시 측정 + 리사이즈 재측정 + ESC 종료 리스너.
  useEffect(() => {
    remeasure();
    // 첫 프레임 이후 레이아웃이 확정된 뒤 한 번 더(패널 마운트 타이밍 보정).
    const raf = requestAnimationFrame(remeasure);
    window.addEventListener('resize', remeasure);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        appState.editMode = false;
      }
    };
    // 캡처 단계에서 먼저 가로채 다른 ESC 핸들러(모달 등) 발동 전에 종료.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [remeasure]);

  // 배치 적용 후 패널이 반대편으로 이동하므로 rAF 로 배지 rect 재측정.
  const applyAndRemeasure = useCallback(
    (partial: Partial<UiLayoutSlots>) => {
      applyLayoutSlots(partial);
      requestAnimationFrame(() => requestAnimationFrame(remeasure));
    },
    [remeasure],
  );

  // preset/history 배지의 pointer 드래그. 임계 미달이면 클릭=반대쪽 토글,
  // 임계 초과면 좌/우 가장자리 드롭 존을 띄우고 놓은 쪽 side 를 적용.
  const startPanelDrag = useCallback(
    (kind: 'preset' | 'history', e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const start = { x: e.clientX, y: e.clientY };
      let isDrag = false;
      const target = e.currentTarget;
      target.setPointerCapture?.(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        if (!isDrag) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD)
            return;
          isDrag = true;
          setDragging(kind);
        }
        // 화면 절반 기준으로 어느 가장자리 존에 얹혔는지.
        setHoverSide(ev.clientX < window.innerWidth / 2 ? 'left' : 'right');
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        target.releasePointerCapture?.(ev.pointerId);
        if (isDrag) {
          const side = ev.clientX < window.innerWidth / 2 ? 'left' : 'right';
          const key = kind === 'preset' ? 'presetSide' : 'historySide';
          applyAndRemeasure({ [key]: side } as Partial<UiLayoutSlots>);
        } else {
          // 클릭(임계 미달) = 반대쪽으로 토글.
          const key = kind === 'preset' ? 'presetSide' : 'historySide';
          const flipped = currentSide(kind) === 'left' ? 'right' : 'left';
          applyAndRemeasure({ [key]: flipped } as Partial<UiLayoutSlots>);
        }
        setDragging(null);
        setHoverSide(null);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [applyAndRemeasure],
  );

  // gencontrol 배지: 드래그 없이 클릭으로 docked↔floating 토글.
  const toggleGenControl = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const next = currentGenControl() === 'docked' ? 'floating' : 'docked';
      applyAndRemeasure({ genControl: next });
    },
    [applyAndRemeasure],
  );

  return (
    <>
      {/* ── 상단 안내 바 (알약) ── */}
      <div
        // 안내 바는 화면 최상단 = 타이틀바(-webkit-app-region: drag)와 겹친다.
        // titlebar-no-drag 가 없으면 "완료" 버튼 클릭이 창 드래그로 먹혀 눌리지 않는다
        // (특히 클래식 템플릿은 상단바 중앙이 빈 드래그 영역이라 항상 막힘).
        className="titlebar-no-drag fixed top-0 left-1/2 -translate-x-1/2 mt-2 flex items-center gap-3 px-4 py-2 rounded-full bg-[var(--c-surface-2)] border line-color shadow-lg select-none"
        style={{ zIndex: 'var(--z-edit-overlay)' }}
      >
        <span className="text-sm text-body">
          편집 모드 — 버튼을 드래그해 배치·순서를 바꾸고, 패널 배지로 위치를 이동하세요
        </span>
        <button
          className="round-button back-sky text-sm !px-3 !py-1 !min-w-0 !min-h-0"
          onClick={() => {
            appState.editMode = false;
          }}
        >
          완료
        </button>
      </div>

      {/* ── 가장자리 드롭 존 (패널 드래그 중에만) ── */}
      {dragging && (
        <>
          {(['left', 'right'] as const).map((side) => {
            const isCurrent = currentSide(dragging) === side;
            const isHover = hoverSide === side;
            return (
              <div
                key={side}
                className={
                  'fixed inset-y-0 w-24 flex items-center justify-center text-center text-xs font-medium pointer-events-none ' +
                  (side === 'left' ? 'left-0 ' : 'right-0 ') +
                  (isHover
                    ? 'bg-sky-500/20 border-2 border-dashed border-sky-400 text-sky-500 '
                    : 'bg-[var(--c-surface-2)]/40 border-2 border-dashed line-color text-muted ')
                }
                style={{ zIndex: 'var(--z-edit-overlay)' }}
              >
                {isCurrent ? '현재 위치' : side === 'left' ? '왼쪽' : '오른쪽'}
              </div>
            );
          })}
        </>
      )}

      {/* ── 슬롯 배지 ── */}
      {badges.map((b) => {
        const isGen = b.kind === 'gencontrol';
        const isDraggingThis = dragging === b.kind;
        return (
          <div
            key={b.kind}
            onPointerDown={(e) => {
              if (isGen) return; // gencontrol 은 클릭 토글만
              startPanelDrag(b.kind as 'preset' | 'history', e);
            }}
            onClick={isGen ? toggleGenControl : undefined}
            // 배지도 화면 상단에서 타이틀바 드래그 영역과 겹칠 수 있어, 클릭/드래그가
            // 창 이동으로 먹히지 않도록 titlebar-no-drag.
            // whitespace-nowrap: 배지가 화면 오른쪽 끝 근처(우측 도킹 패널 위)에 놓이면
            // fixed 요소의 shrink-to-fit 폭이 좁아져 "히스토리 패널" 텍스트가 줄바꿈되던 문제.
            // 줄바꿈을 막으면 항상 한 줄 알약으로 렌더된다(-translate-x-1/2 로 중앙 정렬 유지).
            className={
              'titlebar-no-drag fixed -translate-x-1/2 whitespace-nowrap flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--c-surface-2)] border line-color shadow-lg text-sm text-body select-none touch-none ' +
              (isGen ? 'cursor-pointer ' : 'cursor-grab ') +
              (isDraggingThis ? 'opacity-70 ' : '')
            }
            style={{ left: b.left, top: b.top, zIndex: 'var(--z-edit-overlay)' }}
            aria-label={`${b.label} 배치`}
            title={
              isGen
                ? '클릭해 도크/플로팅 전환'
                : '드래그해 좌/우 이동 · 클릭으로 반대쪽'
            }
          >
            <FaThLarge className="text-faint flex-none" />
            <span>{b.label}</span>
          </div>
        );
      })}
    </>
  );
});

export default EditModeShell;
