import React, {
  ReactNode,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
} from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { observer } from 'mobx-react-lite';
import { FaArrowsAlt } from 'react-icons/fa';
import { backend } from '../models';
import { appState } from '../models/AppService';
import {
  PRESET_LAYOUT_ANCHOR_KEYS,
  movePresetOrder,
} from '../models/presetLayout';

// 프리셋 에디터 요소 순서 편집(세로 드래그) 공용 부품(L1-4).
// 편집모드(appState.editMode, PC 전용)일 때만 PreSetEdtior 가 최상위 요소를 이 래퍼로
// 감싼다. 드래그는 uiPresetLayout[slotKey] 오버라이드(전체 키 순서 배열)를 조작하는 "새
// 입력 수단"일 뿐 — 순서 해석(resolveStackInputs)·렌더는 그대로다. 저장 패턴은 툴바
// (ToolbarDnd.applyToolbarMove)와 동일: appState 즉시 반영 → getConfig → 병합 setConfig.

// DnD 아이템 타입 — 툴바(toolbar-btn/main)와 분리해 서로의 드롭 타깃이 되지 않게 한다.
const PRESET_ROW_DND_TYPE = 'preset-row';

interface PresetRowDragItem {
  slotKey: string; // 어느 슬롯(워크플로우 editor/innerEditor)의 행인지 — 슬롯 격리
  key: string; // 이 행의 안정 키(wfiElementKey)
}

// 슬롯 순서를 즉시 반영 + config 영속. applyToolbarMove 패턴 복제
// (appState 즉시 반영 → getConfig → 병합 setConfig, 실패는 console.error).
export async function applyPresetOrder(
  slotKey: string,
  order: string[],
): Promise<void> {
  const next = { ...appState.uiPresetLayout, [slotKey]: order };
  appState.uiPresetLayout = next;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, uiPresetLayout: next });
  } catch (e) {
    console.error('프리셋 순서 저장 실패:', e);
  }
}

// 해당 슬롯 오버라이드 삭제 = 정의 순서 복귀(초기화). 키가 없으면 그대로 저장(무해).
export async function resetPresetOrder(slotKey: string): Promise<void> {
  const next = { ...appState.uiPresetLayout };
  delete next[slotKey];
  appState.uiPresetLayout = next;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, uiPresetLayout: next });
  } catch (e) {
    console.error('프리셋 순서 초기화 저장 실패:', e);
  }
}

// 세로 리스트 드롭 중점 판정 — 커서가 대상 행 세로 중점보다 위면 앞(before)에 삽입.
function isBeforeMidpoint(
  rect: DOMRect | undefined,
  client: { x: number; y: number } | null,
): boolean {
  if (!rect || !client) return true;
  return client.y < rect.top + rect.height / 2;
}

// 프리셋 최상위 요소 드래그 래퍼(편집모드 전용). 안쪽 그립 핸들만 드래그 소스로,
// 행 전체는 드롭 타깃 + 드래그 프리뷰. grow=true 면 flex-1(프롬프트 등 세로 성장 요소)로
// 감싸 기존 높이를 보존한다(EditorField 의 flex-1 콘텐츠가 래퍼 안에서 계속 성장하도록).
// order = 현재 렌더된 전체 키 순서(앵커 포함) — 드롭 시 movePresetOrder 입력으로 쓴다.
//
// 빈 렌더 행 처리: 편집모드에서 조건 불충족(ifIn)·미제공(middlePlaceholder) 등으로 자식을
// 아무것도 렌더하지 않는 요소는, grow=true 여도 flex-1 몫을 훔쳐 실제 프롬프트를 눌러버린다.
// 그래서 콘텐츠 DOM 이 실제로 비었는지(childElementCount===0)를 진실로 삼아 — 타입 하드코딩
// 없이 범용으로 — 빈 행이면 소형 flex-none "자리표시 칩"으로 렌더한다(성장 배분에서 빠짐).
// 칩도 여전히 드래그 소스+드롭 타깃이라 이 화면에서 안 보이는 요소도 순서를 옮길 수 있다.
export const DraggablePresetRow = observer(
  ({
    slotKey,
    elementKey,
    order,
    grow,
    label,
    children,
  }: {
    slotKey: string;
    elementKey: string;
    order: string[];
    grow: boolean;
    label: string;
    children: ReactNode;
  }) => {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const handleRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    // 콘텐츠가 비었는지 — 초기값 false(대부분 행은 콘텐츠 있음). useLayoutEffect 가 페인트
    // 전 동기 재판정하므로 첫 화면에 깜빡임이 남지 않는다.
    const [isEmpty, setIsEmpty] = useState(false);

    const recomputeEmpty = () => {
      const el = contentRef.current;
      if (el) setIsEmpty(el.childElementCount === 0);
    };

    // 부모 리렌더 경로 재판정(페인트 전 동기).
    useLayoutEffect(() => {
      recomputeEmpty();
    });

    // 자식(observer)이 스스로 리렌더해 콘텐츠가 생기거나 사라지는 경우 — 부모는 리렌더되지
    // 않으므로 MutationObserver(childList)로 잡는다.
    useEffect(() => {
      const el = contentRef.current;
      if (!el || typeof MutationObserver === 'undefined') return;
      const mo = new MutationObserver(() => recomputeEmpty());
      mo.observe(el, { childList: true });
      return () => mo.disconnect();
    }, []);

    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: PRESET_ROW_DND_TYPE,
        item: (): PresetRowDragItem => ({ slotKey, key: elementKey }),
        collect: (m) => ({ isDragging: m.isDragging() }),
      }),
      [slotKey, elementKey],
    );

    const [{ isOverInsert, insertBefore }, drop] = useDrop(
      () => ({
        accept: PRESET_ROW_DND_TYPE,
        // 같은 슬롯의 다른 행만 수락(슬롯 격리 + 자기 자신 드롭 무시).
        canDrop: (item: PresetRowDragItem) =>
          item.slotKey === slotKey && item.key !== elementKey,
        drop: (item: PresetRowDragItem, monitor) => {
          if (monitor.didDrop()) return;
          if (item.slotKey !== slotKey || item.key === elementKey) return;
          const rect = wrapRef.current?.getBoundingClientRect();
          const client = monitor.getClientOffset();
          const before = isBeforeMidpoint(rect, client);
          // fromKey 제거 후 배열 기준 삽입 인덱스 — 대상 행(elementKey) 앞/뒤.
          const without = order.filter((k) => k !== item.key);
          let idx = without.indexOf(elementKey);
          if (idx === -1) idx = without.length;
          else if (!before) idx += 1;
          const nextOrder = movePresetOrder(order, item.key, idx);
          applyPresetOrder(slotKey, nextOrder);
        },
        collect: (m) => {
          const item = m.getItem() as PresetRowDragItem | null;
          const over = m.isOver({ shallow: true }) && m.canDrop() && !!item;
          const client = m.getClientOffset();
          const rect = wrapRef.current?.getBoundingClientRect();
          return {
            isOverInsert: over,
            insertBefore: isBeforeMidpoint(rect, client),
          };
        },
      }),
      [slotKey, elementKey, order],
    );

    // 그립 = 드래그 소스, 행 전체 = 드롭 타깃 + 드래그 프리뷰(그립만 잡아도 행 전체가 유령으로).
    drag(handleRef);
    preview(drop(wrapRef));

    // 삽입 위치 표시 — 커서 쪽 보더 강조(툴바 세로 스택과 동일한 sky 시각 언어).
    const insertClass = isOverInsert
      ? insertBefore
        ? ' border-t-2 border-sky-400'
        : ' border-b-2 border-sky-400'
      : '';

    // 빈 행은 flex-none 칩으로 축소 — 성장(flex-1)은 실제 콘텐츠가 있을 때만.
    const growClass = isEmpty ? 'flex-none' : grow ? 'flex-1' : 'flex-none';

    return (
      <div
        ref={wrapRef}
        className={
          'relative flex flex-col min-h-0 ' +
          growClass +
          (isDragging ? ' opacity-40' : '') +
          insertClass
        }
      >
        {isEmpty ? (
          // 자리표시 칩 — 소형(flex-none) 1줄, dashed 보더 + 흐린 라벨. 그립은 칩 안 인라인.
          <div className="flex-none flex items-center gap-2 px-2 py-1 rounded border border-dashed line-color text-faint text-sm select-none">
            <div
              ref={handleRef}
              className="flex-none cursor-grab"
              title="드래그해 순서 변경"
              aria-label="순서 변경 핸들"
            >
              <FaArrowsAlt size={12} />
            </div>
            <span className="truncate">
              {label}{' '}
              <span className="text-xs">(이 화면에서는 표시되지 않음)</span>
            </span>
          </div>
        ) : (
          // 그립 핸들 — 우상단에 겹쳐 얹어 행 높이를 늘리지 않는다(레이아웃 보존).
          <div
            ref={handleRef}
            className="absolute top-0 right-0 z-[1] flex-none cursor-grab select-none p-1 rounded border line-color bg-[var(--c-surface-2)] text-faint"
            title="드래그해 순서 변경"
            aria-label="순서 변경 핸들"
          >
            <FaArrowsAlt size={12} />
          </div>
        )}
        {/* 콘텐츠 래퍼 — display:contents 로 자체 박스는 레이아웃에서 제거해 기존 flex 성장
            배분을 그대로 보존하면서, 자식 유무(비었는지)만 관찰한다(빈 행 감지의 진실). */}
        <div ref={contentRef} className="contents">
          {children}
        </div>
      </div>
    );
  },
);

// 앵커(고정) 키인지 — PreSetEdtior 가 드래그 래퍼 제외 판정에 쓴다.
export function isPresetAnchorKey(key: string): boolean {
  return PRESET_LAYOUT_ANCHOR_KEYS.includes(key);
}
