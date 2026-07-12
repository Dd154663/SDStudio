import { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FaArrowsAlt } from 'react-icons/fa';
import { backend } from '../models';
import { appState } from '../models/AppService';
import { resolveLayout } from '../models/layoutTemplates';
import type { UiLayoutSlots } from '../../main/config';
import Tooltip from './Tooltip';

// 편집 모드 셸 (PC 전용).
// 사용자가 화면에서 UI 배치를 직접 조작하는 모드의 셸. 안내 바 + 슬롯 그립 칩 +
// 패널 하이라이트 + 드롭 존만 담당한다(전역 클릭 흡수·툴바 어포던스는 병렬로 다른
// 곳에서 처리 — 여기서는 셸만). App.tsx 가
// { !isMobile && appState.editMode && <EditModeShell /> } 로 렌더한다.
//
// 슬롯 그립 칩은 App.tsx/BottomBar.tsx 가 부여한 위치 마커의 rect 를 측정해 그 위에
// 띄운다:
//   [data-slot="project"]    — 프로젝트 사이드 바 래퍼
//   [data-slot="preset"]     — 프리셋 패널 래퍼
//   [data-slot="history"]    — 이미지 히스토리 패널 래퍼
//   [data-slot="gencontrol"] — 생성 컨트롤(하단바 도크 or 플로팅 위젯 루트)
// rect 를 못 찾은 슬롯(세션 없음·패널 접힘 등)은 칩을 그리지 않는다.
//
// 칩은 텍스트가 아니라 그립 아이콘(✥, FaArrowsAlt — 프리셋 행 그립과 동일 시각 언어)
// 중심의 고대비 sky 소형 정사각형이고, 패널명은 툴팁으로만 노출한다(긴 텍스트 배지가
// 패널 제목과 겹치던 문제 해소). 칩에 호버하거나 드래그를 시작하면 해당 패널 전체에
// 하늘색 외곽선 + 옅은 스크림을 얹어 "이 패널이 통째로 움직인다"를 즉시 보여준다
// (스크림은 pointer-events-none 이라 콘텐츠 상호작용을 막지 않음).

const DRAG_THRESHOLD = 8; // 이 거리(px)를 넘으면 드래그(가장자리 드롭)로 판정, 미달=클릭 토글

// 편집 대상 슬롯 4종의 서술자. project/preset/history 는 좌/우 드래그, gencontrol 은 클릭 토글.
type SlotKind = 'project' | 'preset' | 'history' | 'gencontrol';

interface SlotDescriptor {
  kind: SlotKind;
  selector: string;
  label: string;
}

// 배열 순서 = 배지 겹침 방지(계단식) 처리 순서. 가장자리 우선(프로젝트→프리셋→히스토리).
const SLOTS: SlotDescriptor[] = [
  { kind: 'project', selector: '[data-slot="project"]', label: '프로젝트 패널' },
  { kind: 'preset', selector: '[data-slot="preset"]', label: '프리셋 패널' },
  { kind: 'history', selector: '[data-slot="history"]', label: '히스토리 패널' },
  {
    kind: 'gencontrol',
    selector: '[data-slot="gencontrol"]',
    label: '생성 컨트롤',
  },
];

// 좌/우 드래그 가능한 패널 슬롯의 kind → config 슬롯 키.
const SIDE_KEY: Record<'project' | 'preset' | 'history', 'projectSide' | 'presetSide' | 'historySide'> = {
  project: 'projectSide',
  preset: 'presetSide',
  history: 'historySide',
};

// 그립 칩 한 변(px) — 아이콘+여백의 소형 정사각형.
const CHIP = 30;
// 칩을 패널 안쪽으로 들이는 여백(px). 상단·우측 공통.
const CHIP_INSET = 6;

// 슬롯 그립 칩이 앉을 화면 좌표 + 하이라이트용 패널 rect. 마커가 없으면 항목 자체가 없다.
interface BadgeRect {
  kind: SlotKind;
  label: string;
  // 하이라이트 오버레이가 덮을 패널(마커)의 화면 rect.
  panelLeft: number;
  panelTop: number;
  panelWidth: number;
  panelHeight: number;
  // 그립 칩(정사각형)의 좌상단 좌표 — 패널 상단 우측 안쪽(화면 안으로 클램프).
  chipLeft: number;
  chipTop: number;
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
// 기본값: project=left, preset=left, history=right.
function currentSide(kind: 'project' | 'preset' | 'history'): 'left' | 'right' {
  const s = appState.uiLayoutSlots;
  if (kind === 'history') return s.historySide === 'left' ? 'left' : 'right';
  const v = kind === 'project' ? s.projectSide : s.presetSide;
  return v === 'right' ? 'right' : 'left';
}
function currentGenControl(): 'docked' | 'floating' {
  return appState.uiLayoutSlots.genControl === 'floating' ? 'floating' : 'docked';
}

// 생성 컨트롤이 부착될 하단바가 있는 템플릿인지 — 없으면(컴팩트·사이드바) 항상
// 플로팅 강제라 도크/플로팅 전환이 무의미하므로 gencontrol 배지를 띄우지 않는다.
// (편집 모드는 PC 전용이라 isMobile=false 고정)
function genDockAvailable(): boolean {
  return resolveLayout(appState.uiLayoutTemplate, false).bottomBar !== 'none';
}

// 생성 컨트롤 도크/플로팅 전환의 실제 적용. "플로팅"은 슬롯(genControl)과 격자점
// 드래그 분리(genWidget.detached) 두 경로가 있으므로, 도크 복귀 시 둘 다 함께
// 해제해야 한 번의 클릭으로 확실히 부착된다(두 필드를 한 번의 setConfig 로 저장).
async function applyGenControlMode(mode: 'docked' | 'floating') {
  const slots: UiLayoutSlots = { ...appState.uiLayoutSlots, genControl: mode };
  appState.uiLayoutSlots = slots;
  let genWidget = appState.genWidget;
  if (mode === 'docked' && genWidget.detached) {
    genWidget = { ...genWidget, detached: false };
    appState.genWidget = genWidget;
  }
  try {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, uiLayoutSlots: slots, genWidget });
  } catch (e) {
    console.error('생성 컨트롤 배치 저장 실패:', e);
  }
}

// 마커 4종의 현재 화면 rect 를 측정해 칩 좌표 + 패널 rect 배열로 변환. 못 찾은 슬롯은 제외.
function measureBadges(): BadgeRect[] {
  const out: BadgeRect[] = [];
  for (const slot of SLOTS) {
    // 하단바 없는 템플릿에선 gencontrol 칩 생략(전환 대상 없음 — 항상 플로팅).
    if (slot.kind === 'gencontrol' && !genDockAvailable()) continue;
    const el = document.querySelector(slot.selector);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    // 크기 0(미표시)인 마커는 건너뛴다.
    if (r.width <= 0 || r.height <= 0) continue;
    // 칩은 패널 상단 우측 안쪽. 좁은 패널(예: 48px 프로젝트 사이드 바)·화면 가장자리에
    // 도킹된 패널에서도 칩 전체가 항상 보이도록 화면 안으로 클램프한다.
    const chipLeft = Math.min(
      Math.max(r.right - CHIP - CHIP_INSET, 4),
      window.innerWidth - CHIP - 4,
    );
    const chipTop = Math.min(
      Math.max(r.top + CHIP_INSET, 4),
      window.innerHeight - CHIP - 4,
    );
    out.push({
      kind: slot.kind,
      label: slot.label,
      panelLeft: r.left,
      panelTop: r.top,
      panelWidth: r.width,
      panelHeight: r.height,
      chipLeft,
      chipTop,
    });
  }
  // 두 패널을 같은 쪽에 두거나(특히 프리셋이 접혀 마커가 얇은 스플리터일 때) 칩들이
  // 같은 좌표로 몰려 겹치면, 뒤엣것을 한 줄씩 아래로 내려 계단식으로 펼친다.
  const ROW = CHIP + 6; // 한 줄 내림 높이(칩 높이 + 여백)
  for (let i = 0; i < out.length; i++) {
    let moved = true;
    while (moved) {
      moved = false;
      for (let j = 0; j < i; j++) {
        if (
          Math.abs(out[j].chipLeft - out[i].chipLeft) < CHIP + 4 &&
          Math.abs(out[j].chipTop - out[i].chipTop) < ROW
        ) {
          out[i].chipTop = out[j].chipTop + ROW;
          moved = true;
        }
      }
    }
  }
  return out;
}

const EditModeShell = observer(() => {
  const [badges, setBadges] = useState<BadgeRect[]>([]);
  // 드래그 중인 슬롯(project/preset/history)과 현재 커서가 얹힌 가장자리 존.
  const [dragging, setDragging] = useState<'project' | 'preset' | 'history' | null>(
    null,
  );
  const [hoverSide, setHoverSide] = useState<'left' | 'right' | null>(null);
  // 칩에 마우스가 얹힌 슬롯 — 해당 패널에 하이라이트(외곽선+스크림)를 표시한다.
  const [hoverKind, setHoverKind] = useState<SlotKind | null>(null);

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

  // project/preset/history 배지의 pointer 드래그. 임계 미달이면 클릭=반대쪽 토글,
  // 임계 초과면 좌/우 가장자리 드롭 존을 띄우고 놓은 쪽 side 를 적용.
  const startPanelDrag = useCallback(
    (
      kind: 'project' | 'preset' | 'history',
      e: React.PointerEvent<HTMLDivElement>,
    ) => {
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
          applyAndRemeasure({ [SIDE_KEY[kind]]: side } as Partial<UiLayoutSlots>);
        } else {
          // 클릭(임계 미달) = 반대쪽으로 토글.
          const flipped = currentSide(kind) === 'left' ? 'right' : 'left';
          applyAndRemeasure({ [SIDE_KEY[kind]]: flipped } as Partial<UiLayoutSlots>);
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
  // 실효 상태로 판정 — 격자점 드래그로 분리(detached)된 상태도 "플로팅"으로 보고,
  // 도크 복귀 시 applyGenControlMode 가 detached 까지 함께 해제한다.
  const toggleGenControl = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const floatingNow =
        appState.genWidget.detached === true ||
        currentGenControl() === 'floating';
      applyGenControlMode(floatingNow ? 'docked' : 'floating');
      requestAnimationFrame(() => requestAnimationFrame(remeasure));
    },
    [remeasure],
  );

  // 플로팅 위젯을 (편집 모드 중에도 가능한) 핸들 드래그로 옮기거나 도크/플로팅이
  // 전환되면 gencontrol 마커 위치가 바뀌므로 배지를 재측정한다.
  const gw = appState.genWidget; // observer 구독 — 변경 시 재렌더 → 아래 effect
  useEffect(() => {
    const raf = requestAnimationFrame(remeasure);
    return () => cancelAnimationFrame(raf);
  }, [gw.detached, gw.x, gw.y, remeasure]);

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
          편집 모드 — 버튼을 드래그해 배치·순서를 바꾸고, 패널 손잡이(✥)로 위치를 이동하세요
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

      {/* ── 패널 하이라이트 (칩 호버 또는 드래그 중) ── */}
      {/* 칩과 같은 z(--z-edit-overlay)지만 칩보다 먼저 렌더 → 칩이 위에 얹힌다.
          pointer-events-none 이라 스크림이 칩·콘텐츠 상호작용을 막지 않는다. */}
      {badges.map((b) => {
        if (dragging !== b.kind && hoverKind !== b.kind) return null;
        return (
          <div
            key={`hl-${b.kind}`}
            className="fixed pointer-events-none rounded-lg ring-2 ring-inset ring-sky-400 bg-sky-400/10 dark:bg-sky-500/10"
            style={{
              left: b.panelLeft,
              top: b.panelTop,
              width: b.panelWidth,
              height: b.panelHeight,
              zIndex: 'var(--z-edit-overlay)',
            }}
          />
        );
      })}

      {/* ── 슬롯 그립 칩 ── */}
      {badges.map((b) => {
        const isGen = b.kind === 'gencontrol';
        const isDraggingThis = dragging === b.kind;
        return (
          <Tooltip
            key={b.kind}
            content={
              isGen
                ? `${b.label} · 클릭해 도크/플로팅 전환`
                : `${b.label} · 드래그해 좌/우 이동`
            }
            placement="bottom"
          >
            <div
              onPointerDown={(e) => {
                if (isGen) return; // gencontrol 은 클릭 토글만
                startPanelDrag(b.kind as 'project' | 'preset' | 'history', e);
              }}
              onClick={isGen ? toggleGenControl : undefined}
              onMouseEnter={() => setHoverKind(b.kind)}
              onMouseLeave={() =>
                setHoverKind((k) => (k === b.kind ? null : k))
              }
              // 칩도 화면 상단에서 타이틀바 드래그 영역과 겹칠 수 있어, 클릭/드래그가
              // 창 이동으로 먹히지 않도록 titlebar-no-drag.
              // 고대비: 진한 sky 배경 + 흰 그립 아이콘 → 다크·화이트 어느 테마에서도
              // 패널 위에서 묻히지 않는다.
              className={
                'titlebar-no-drag fixed flex items-center justify-center rounded-md border border-sky-300 bg-sky-500 text-white shadow-lg select-none touch-none ' +
                (isGen ? 'cursor-pointer ' : 'cursor-grab ') +
                (isDraggingThis ? 'opacity-70 ' : '')
              }
              style={{
                left: b.chipLeft,
                top: b.chipTop,
                width: CHIP,
                height: CHIP,
                zIndex: 'var(--z-edit-overlay)',
              }}
              aria-label={`${b.label} 배치`}
            >
              <FaArrowsAlt size={14} className="flex-none" />
            </div>
          </Tooltip>
        );
      })}
    </>
  );
});

export default EditModeShell;
