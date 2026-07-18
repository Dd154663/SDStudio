import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { DropdownSelect, Option } from './UtilComponents';
import { FaEllipsisH, FaTrash, FaTrashRestore, FaUserAlt, FaTimes, FaBars, FaChevronDown, FaEye } from 'react-icons/fa';
import { pushRecentProject } from './ProjectBrowser';
import Tooltip from './Tooltip';
import { sessionService, imageService, backend, zipService, trashService, isMobile, templateService } from '../models';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { TOOLBAR_VIEW_MAIN, resolveToolbarView } from '../models/uiLayout';
import { companionAssignedIds } from '../models/companionSlots';
import ToolbarOverflowMenu from './ToolbarOverflowMenu';
import {
  DraggableToolbarButton,
  ToolbarHideZone,
  ToolbarMenuDropTarget,
  toolbarDndType,
  toolbarRowHighlightClass,
  useToolbarDragState,
  useToolbarRowDrop,
} from './ToolbarDnd';
import { portableToolbarButtons } from './PortableToolbarButtons';

// ===== ProjectTrashView 컴포넌트 (씬 휴지통 SceneTrashView 패턴 재사용) =====
// 전역 오버레이(App.tsx)에서 마운트 — appState.projectTrashOpen 호스트가 사용한다.
export function ProjectTrashView() {
  const [deletedProjects, setDeletedProjects] = useState<
    { name: string; deletedAt: number }[]
  >([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await trashService.getDeletedProjects();
      items.sort((a, b) => b.deletedAt - a.deletedAt);
      setDeletedProjects(items);
    } catch (e) {
      appState.pushMessage(
        '휴지통 목록을 불러오지 못했습니다 (파일 접근 오류). 잠시 후 다시 시도해주세요.',
      );
      setDeletedProjects([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const formatDate = (ts: number) => {
    if (!ts) return '알 수 없음';
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  };

  const handleRestore = async (name: string) => {
    try {
      await trashService.restoreProject(name);
      // 복원은 .deleted→.json 파일만 바꾸므로 목록 재스캔을 즉시 트리거한다.
      await sessionService.update();
      appState.pushMessage(`프로젝트 "${name}"이(가) 복원되었습니다.`);
      await refresh();
    } catch (e: any) {
      appState.pushMessage(e.message || '프로젝트 복원에 실패했습니다.');
    }
  };

  const handlePermanentDelete = (name: string) => {
    appState.pushDialog({
      type: 'confirm',
      text: `"${name}" 프로젝트를 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
      callback: async () => {
        await trashService.permanentlyDeleteProject(name);
        appState.pushMessage(`프로젝트 "${name}"이(가) 영구 삭제되었습니다.`);
        await refresh();
      },
    });
  };

  const handleEmptyAll = () => {
    appState.pushDialog({
      type: 'confirm',
      text: `휴지통의 모든 프로젝트(${deletedProjects.length}개)를 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
      callback: async () => {
        for (const p of deletedProjects) {
          try {
            await trashService.permanentlyDeleteProject(p.name);
          } catch (e) {}
        }
        appState.pushMessage('프로젝트 휴지통을 비웠습니다.');
        await refresh();
      },
    });
  };

  const isEmpty = deletedProjects.length === 0 && !loading;

  return (
    <div className="flex flex-col gap-2">
      {deletedProjects.length > 0 && (
        <div className="flex justify-end mb-1">
          <button className="round-button back-red" onClick={handleEmptyAll}>
            <FaTrash className="mr-1" />
            모두 비우기
          </button>
        </div>
      )}
      {isEmpty ? (
        <div className="text-center text-faint text-lg py-10">
          휴지통이 비어있습니다
        </div>
      ) : (
        deletedProjects.map((item) => (
          <div
            key={item.name}
            className="flex items-center gap-3 p-3 border line-color rounded r-card bg-[var(--c-surface-2)]"
          >
            <div className="flex-1 min-w-0">
              <div className="font-bold text-default truncate">
                📁 {item.name}
              </div>
              <div className="text-sm text-faint">
                삭제일 · {formatDate(item.deletedAt)}
              </div>
            </div>
            <button
              className="round-button back-green flex-none"
              onClick={() => handleRestore(item.name)}
            >
              <FaTrashRestore className="mr-1" />
              복원
            </button>
            <button
              className="round-button back-red flex-none"
              onClick={() => handlePermanentDelete(item.name)}
            >
              영구삭제
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// variant='bar'(기본): 하단/상단 바용 가로 툴바(레거시). 'sidebar': 프로젝트 사이드 바용
// 세로 아이콘 스택 — bar 와 동일하게 레지스트리+resolveToolbarView 가 배치를 결정하며
// (⋯메뉴·드래그 재배열 포함), 프로젝트 선택기만 빠진다(사이드 바 상단 존이 대체).
// side: 사이드 바의 도킹 방향 — ⋯ 팝오버가 화면 안쪽으로 펼쳐지게 정렬을 정한다.
const SessionSelect = observer(({ variant = 'bar', side = 'left' }: { variant?: 'bar' | 'sidebar'; side?: 'left' | 'right' }) => {
  const [sessionNames, setSessionNames] = useState<string[]>([]);
  // 프로젝트 바 ⋯(더보기) 오버플로 메뉴
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  // 적용된 캐릭터 프리셋 칩의 팝오버(W4 다중 적용 — 목록·개별 해제)
  const [showPresetPopover, setShowPresetPopover] = useState(false);
  // 팝오버 내 일괄 해제용 체크 선택 (팝오버를 열 때마다 초기화)
  const [presetClearSel, setPresetClearSel] = useState<Set<string>>(
    () => new Set(),
  );
  // 팝오버 적응 배치(W2 팝오버 패턴): 프로젝트 툴바가 상단(컴팩트)·하단·사이드
  // 어디에 있어도 화면 밖으로 나가지 않게 — 앵커(칩) 아래 우선, 여유 없으면 위,
  // 뷰포트 8px 클램프. 측정 전에는 visibility:hidden 으로 깜빡임 방지.
  const presetChipRef = React.useRef<HTMLDivElement | null>(null);
  const presetPopRef = React.useRef<HTMLDivElement | null>(null);
  const [presetPopPos, setPresetPopPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  React.useLayoutEffect(() => {
    if (!showPresetPopover) {
      if (presetPopPos) setPresetPopPos(null);
      return;
    }
    const anchor = presetChipRef.current?.getBoundingClientRect();
    const pop = presetPopRef.current?.getBoundingClientRect();
    if (!anchor || !pop) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = anchor.bottom + 4;
    if (top + pop.height > vh - 8) top = anchor.top - pop.height - 4;
    top = Math.max(8, Math.min(top, vh - pop.height - 8));
    const left = Math.max(8, Math.min(anchor.left, vw - pop.width - 8));
    // 매 렌더 실행되는 훅이라 실제 변화가 있을 때만 set (무한 루프 방지)
    if (
      !presetPopPos ||
      Math.abs(presetPopPos.left - left) > 0.5 ||
      Math.abs(presetPopPos.top - top) > 0.5
    ) {
      setPresetPopPos({ left, top });
    }
  });
  // 툴바 버튼 드래그 재배치 (클래식 툴바에선 비활성)
  const toolbarDrag = useToolbarDragState('project');
  const toolbarDragActive = toolbarDrag.active;
  const { drop: toolbarRowDrop, isOver: toolbarRowOver } =
    useToolbarRowDrop('project', 'project');
  useEffect(() => {
    const onListUpdated = () => {
      // 숨김 씬 템플릿 제외 (씬 템플릿 개편 2026-07-18)
      setSessionNames(
        templateService.filterVisibleProjects(sessionService.list()),
      );
    };
    onListUpdated();
    sessionService.addEventListener('listupdated', onListUpdated);
    return () => {
      sessionService.removeEventListener('listupdated', onListUpdated);
    };
  }, []);
  const selectSession = (opt: Option<string>) => {
    (async () => {
      const session = await sessionService.get(opt.value);
      if (session) {
        imageService.refreshBatch(session);
        appState.curSession = session;
        pushRecentProject(opt.value);
      }
    })();
  };

  // ── 프로젝트 바 버튼 바인딩: 레지스트리 id → 실제 버튼 노드 ──
  // 구성·배치는 TOOLBAR_VIEW_MAIN 의 'project' 영역 + resolveToolbarView 가 결정한다.
  // 프로젝트 버튼은 전부 portable(shared)로 승격됨 — 로컬 전용 노드는 없다.
  const toolbarButtons: Record<string, React.ReactNode> = {};
  // portable 공유 버튼(add-session·delete-session·project-trash·backup-export·
  // character-presets·piece-editor) — 크로스 영역 렌더용.
  // 프로젝트 바는 모바일 아이콘 축약 개념이 없어 mobileIcon=false(현 렌더와 동일).
  // variant='project': 타 영역발 버튼도 프로젝트 바 표준(무배경 icon-button)으로 적응.
  // 사이드 바(w-12 세로 스택)는 텍스트 버튼이 안 들어가므로 아이콘 축약(iconOnly).
  const shared = portableToolbarButtons({
    mobileIcon: false,
    variant: 'project',
    iconOnly: variant === 'sidebar',
  });
  const buttonNode = (id: string): React.ReactNode =>
    toolbarButtons[id] ?? shared[id];

  // 사용자 설정(appState.uiToolbar, observable)에 따라 인라인/⋯메뉴 배치 결정.
  // 편집 모드 v2: resolveToolbarView 가 전 영역을 해석 → 이 컴포넌트의 'project' 영역만 사용.
  // 동반 슬롯에 배정된 버튼은 파생 숨김(이동 의미론) — 툴바 표면에서 사라지고 프리셋
  // 에디터 호스트 행 옆으로 이동한다(uiToolbar 데이터는 불변, 제외 집합 필터).
  const projectView = resolveToolbarView(
    TOOLBAR_VIEW_MAIN,
    appState.uiToolbar,
    isMobile,
    companionAssignedIds(appState.uiCompanionSlots),
  );
  const projectAreaResolved = projectView.find((a) => a.area === 'project');
  const toolbarLayout = {
    inline: projectAreaResolved?.inline ?? [],
    menu: projectAreaResolved?.menu ?? [],
  };
  // 커스터마이징 이름(레지스트리 라벨) 조회용 — 크로스 영역 id(portable)의
  // 이름도 표시해야 하므로 View 전체 레지스트리에서 찾는다.
  const projectName = (id: string) => {
    for (const { registry } of TOOLBAR_VIEW_MAIN) {
      const found = registry.find((b) => b.id === id);
      if (found) return found.name;
    }
    return id;
  };

  // ── 적용된 캐릭터 프리셋 칩의 팝오버 (bar/sidebar 공용) ──
  // 적응형 fixed 배치(위 useLayoutEffect)라 칩이 상단/하단/사이드 어디에 있어도 동작.
  const togglePresetPopover = () =>
    setShowPresetPopover((v) => {
      if (!v) setPresetClearSel(new Set());
      return !v;
    });
  const presetPopover = showPresetPopover && (
    <>
      {/* 바깥 클릭 닫기용 투명 백드롭 */}
      <div
        className="fixed inset-0"
        style={{ zIndex: 'var(--z-context-menu)' }}
        onClick={() => setShowPresetPopover(false)}
      />
      <div
        ref={presetPopRef}
        className="fixed w-56 bg-[var(--c-zone)] border line-color rounded-lg shadow-xl overflow-hidden"
        style={{
          zIndex: 'var(--z-context-menu)',
          left: presetPopPos?.left ?? 0,
          top: presetPopPos?.top ?? 0,
          visibility: presetPopPos ? 'visible' : 'hidden',
        }}
      >
        <div className="px-3 py-1.5 text-xs font-semibold text-muted border-b line-color">
          적용된 캐릭터 프리셋
        </div>
        {appState.appliedCharacterPresetNames.map((name) => (
          <div
            key={name}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-default hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer"
            onClick={() => {
              // 행 클릭 = 일괄 해제용 체크 토글
              setPresetClearSel((prev) => {
                const next = new Set(prev);
                if (next.has(name)) next.delete(name);
                else next.add(name);
                return next;
              });
            }}
          >
            <input
              type="checkbox"
              checked={presetClearSel.has(name)}
              readOnly
              className="flex-none rounded line-color pointer-events-none"
            />
            <FaUserAlt
              className="flex-none text-green-600 dark:text-green-400"
              size={11}
            />
            <span className="flex-1 truncate">{name}</span>
            <Tooltip content="이 프리셋 해제 (연결 항목 함께 제거)">
              <button
                className="flex-none text-muted hover:text-red-500 dark:hover:text-red-400 p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  appState.removeAppliedCharacterPreset(name);
                  setPresetClearSel((prev) => {
                    const next = new Set(prev);
                    next.delete(name);
                    return next;
                  });
                  if (appState.appliedCharacterPresetNames.length === 0) {
                    setShowPresetPopover(false);
                  }
                }}
              >
                <FaTimes size={12} />
              </button>
            </Tooltip>
          </div>
        ))}
        {presetClearSel.size > 0 && (
          <button
            className="w-full px-3 py-1.5 text-xs text-left font-medium text-red-500 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-slate-700 border-t line-color"
            onClick={() => {
              appState.removeAppliedCharacterPresets(
                appState.appliedCharacterPresetNames.filter((n) =>
                  presetClearSel.has(n),
                ),
              );
              setPresetClearSel(new Set());
              if (appState.appliedCharacterPresetNames.length === 0) {
                setShowPresetPopover(false);
              }
            }}
          >
            선택 {presetClearSel.size}개 해제
          </button>
        )}
        {appState.appliedCharacterPresetNames.length > 1 && (
          <button
            className="w-full px-3 py-1.5 text-xs text-left text-muted hover:text-red-500 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-slate-700 border-t line-color"
            onClick={() => {
              appState.clearAppliedCharacterPreset();
              setShowPresetPopover(false);
            }}
          >
            모두 해제
          </button>
        )}
      </div>
    </>
  );

  // 읽기 전용 미러 배지(같은 프로젝트 중복 열기) — 현재 프로젝트가 이 창에서 미러로
  // 열려 있을 때만. 좁은 폭에서 레이아웃을 밀지 않게 flex-none+truncate. 앰버 계열
  // (양 테마 지정) — 색 하드코딩 없이 기존 칩 팔레트 클래스 사용.
  const isMirrorCur =
    !!appState.curSession && sessionService.isMirror(appState.curSession.name);
  const mirrorTooltip =
    '읽기 전용 미러 — 열람·비교·생성 예약·이미지 즐겨찾기·삭제만 가능하고, 그 외 편집은 저장되지 않습니다.';

  // 프로젝트 사이드 바(세로 스택) — bar 와 동일한 레지스트리 해석 결과(toolbarLayout)를
  // 세로로 렌더한다: 인라인/⋯메뉴/숨김·순서 커스터마이징과 편집 모드 드래그 재배열까지
  // 전부 반영(프로젝트 툴바 버튼 최종 이관). 버튼 노드는 위 정의를 재사용.
  // (프로젝트 휴지통 모달은 전역 오버레이 App.tsx 로 이관됨)
  if (variant === 'sidebar') {
    return (
      <div
        ref={toolbarRowDrop as any}
        className={`w-full flex flex-col items-center gap-1.5${toolbarRowHighlightClass(toolbarDrag, toolbarRowOver)}`}
      >
        {/* 읽기 전용 미러 배지 (컴팩트: 아이콘) */}
        {isMirrorCur && (
          <Tooltip content={mirrorTooltip}>
            <div className="flex-none w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
              <FaEye className="text-amber-700 dark:text-amber-300" size={14} />
            </div>
          </Tooltip>
        )}
        {/* 적용된 캐릭터 프리셋 칩 (컴팩트: 아이콘+개수 배지) — bar 와 같은 팝오버 공유 */}
        {appState.appliedCharacterPresetNames.length > 0 && (
          <div ref={presetChipRef} className="relative titlebar-no-drag">
            <Tooltip
              content={`적용된 캐릭터 프리셋: ${appState.appliedCharacterPresetNames.join(', ')}`}
            >
              <button
                className="relative w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center clickable"
                onClick={togglePresetPopover}
              >
                <FaUserAlt
                  className="text-green-600 dark:text-green-400"
                  size={14}
                />
                {appState.appliedCharacterPresetNames.length > 1 && (
                  <span className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-0.5 rounded-full bg-green-500 text-white text-[10px] leading-4 text-center font-semibold">
                    {appState.appliedCharacterPresetNames.length}
                  </span>
                )}
              </button>
            </Tooltip>
            {presetPopover}
          </div>
        )}
        {toolbarLayout.inline.map((id, i) => (
          <DraggableToolbarButton
            key={id}
            group="project"
            id={id}
            name={projectName(id)}
            area="project"
            index={i}
            orientation="v"
            disabled={!!appState.uiToolbar.classic}
          >
            {buttonNode(id)}
          </DraggableToolbarButton>
        ))}
        {(toolbarLayout.menu.length > 0 || toolbarDragActive) && (
          <div className="relative">
            <ToolbarMenuDropTarget group="project" area="project">
              <Tooltip content="더보기">
                <button
                  className={`icon-button mx-1${toolbarLayout.menu.length === 0 ? ' opacity-40' : ''}`}
                  onClick={() => {
                    if (toolbarLayout.menu.length > 0)
                      setShowProjectMenu(!showProjectMenu);
                  }}
                >
                  <FaEllipsisH size={18} />
                </button>
              </Tooltip>
            </ToolbarMenuDropTarget>
            <ToolbarOverflowMenu
              isOpen={showProjectMenu}
              onClose={() => setShowProjectMenu(false)}
              title="프로젝트 메뉴"
              align={side === 'right' ? 'right' : 'left'}
              group="project"
              dndType={
                appState.uiToolbar.classic ? undefined : toolbarDndType('project')
              }
              items={toolbarLayout.menu.map((id) => ({
                id,
                name: projectName(id),
                node: buttonNode(id),
              }))}
            />
          </div>
        )}
        {/* 프로젝트 탐색은 레지스트리 편입(④) — toolbarLayout 인라인/⋯로 렌더 */}
        <ToolbarHideZone group="project" />
      </div>
    );
  }

  return (
    // 행 전체가 드롭 타깃 — 메뉴에서 끌어다 놓으면 인라인 고정(pinned)
    <div
      ref={toolbarRowDrop as any}
      className={`flex gap-2 items-center w-full flex-wrap${toolbarRowHighlightClass(toolbarDrag, toolbarRowOver)}`}
    >
      {/* 현재 적용된 캐릭터 프리셋 — 통합 칩 1개 + 팝오버(W4 다중 적용, 개별 해제) */}
      {appState.appliedCharacterPresetNames.length > 0 && (
        <div
          ref={presetChipRef}
          className="relative titlebar-no-drag hidden md:block"
        >
          <Tooltip content={appState.appliedCharacterPresetNames.join(', ')}>
            <button
              className="flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900 rounded-lg text-sm clickable"
              onClick={togglePresetPopover}
            >
              <FaUserAlt
                className="text-green-600 dark:text-green-400"
                size={12}
              />
              <span className="text-green-700 dark:text-green-300 max-w-24 truncate">
                {appState.appliedCharacterPresetNames.length === 1
                  ? appState.appliedCharacterPresetNames[0]
                  : `프리셋 ${appState.appliedCharacterPresetNames.length}개`}
              </span>
              <FaChevronDown
                className="text-green-600 dark:text-green-400"
                size={9}
              />
            </button>
          </Tooltip>
          {presetPopover}
        </div>
      )}

      {/* 프로젝트 선택 영역: 기본 = 버튼과 한 줄 공유(폭 변동은 truncate가 흡수, 최소폭 미달 시 버튼이 다음 줄로 래핑) / 클래식 = 모바일 1행 전체 */}
      {/* md:min-w-[13rem]: 좁은 창(W6 후속)에서 이 영역이 무한 축소(min-w-0)로 뭉개지는
          1순위였던 문제 수정 — 최소폭을 보장해 대신 뒤의 버튼들이 다음 줄로 래핑되게 한다. */}
      <div
        className={`titlebar-no-drag flex items-center gap-1 ${
          appState.uiToolbar.classic
            ? 'w-full md:w-auto md:flex-1 md:min-w-[13rem] md:max-w-80 min-w-0'
            : 'flex-1 min-w-[9rem] md:min-w-[13rem] md:max-w-80'
        }`}
      >
        {appState.legacyProjectMode ? (
          <>
            <Tooltip content="프로젝트 목록(폴더)">
              <button
                className="icon-button flex-none bg-sky-100 dark:bg-sky-900/50 ring-1 ring-sky-300 dark:ring-sky-700"
                onClick={() => {
                  appState.projectDrawerOpen = true;
                }}
              >
                <FaBars size={16} />
              </button>
            </Tooltip>
            {/* 좁은 창(<lg) 다이어트 — 라벨 없어도 선택기 형태로 의미가 통한다 */}
            <span className="hidden lg:inline whitespace-nowrap text-sub">
              프로젝트:{' '}
            </span>
            <div className="flex-1 min-w-0">
              <DropdownSelect
                menuPlacement="top"
                selectedOption={appState.curSession?.name}
                options={
                  [...sessionNames]
                    .sort((a, b) => {
                      const aFav = sessionService.isFavorite(a);
                      const bFav = sessionService.isFavorite(b);
                      if (aFav !== bFav) return aFav ? -1 : 1;
                      return a.localeCompare(b);
                    })
                    .map((name) => ({
                      label: sessionService.isFavorite(name) ? '⭐ ' + name : name,
                      value: name,
                    }))
                }
                onSelect={selectSession}
              />
            </div>
          </>
        ) : (
          <>
            <span className="hidden lg:inline whitespace-nowrap text-sub">
              프로젝트:{' '}
            </span>
            <Tooltip content="프로젝트 목록 열기 (폴더 드로어)">
              <button
                className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/40 text-default hover:bg-sky-100 dark:hover:bg-sky-900/70 transition-colors"
                onClick={() => {
                  appState.projectDrawerOpen = true;
                }}
              >
                <FaBars size={14} className="flex-none text-sky-500 dark:text-sky-300" />
                <span className="truncate flex-1 text-left text-sm">
                  {appState.curSession
                    ? (sessionService.isFavorite(appState.curSession.name) ? '⭐ ' : '') +
                      appState.curSession.name
                    : '프로젝트 선택'}
                </span>
                <FaChevronDown size={12} className="flex-none text-faint" />
              </button>
            </Tooltip>
          </>
        )}
        {/* 프로젝트 탐색은 레지스트리 편입(④) — 툴바 클러스터에서 렌더 */}
      </div>
      {/* 읽기 전용 미러 배지 — flex-none 으로 좁은 폭에서도 레이아웃을 밀지 않는다 */}
      {isMirrorCur && (
        <Tooltip content={mirrorTooltip}>
          <span className="flex-none titlebar-no-drag inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 text-xs font-medium max-w-[9rem]">
            <FaEye size={11} className="flex-none" />
            <span className="truncate">읽기 전용 미러</span>
          </span>
        </Tooltip>
      )}
      {/* 툴바 버튼·⋯ 메뉴는 no-drag 그룹으로 묶는다 — 버튼은 조작되되, 이 그룹 밖의
          빈 공간(래퍼 여백·클러스터 사이)은 drag 로 남아 상단 바가 창 이동 핸들이 된다. */}
      <span className="titlebar-no-drag flex items-center gap-2">
      {toolbarLayout.inline.map((id, i) => (
        <DraggableToolbarButton
          key={id}
          group="project"
          id={id}
          name={projectName(id)}
          area="project"
          index={i}
          disabled={!!appState.uiToolbar.classic}
        >
          {buttonNode(id)}
        </DraggableToolbarButton>
      ))}
      {(toolbarLayout.menu.length > 0 || toolbarDragActive) && (
        // 메뉴가 비어도 드래그 중엔 반투명 유령 ⋯(드롭 타깃)로 나타난다
        <div className="relative">
          <ToolbarMenuDropTarget group="project" area="project">
            <Tooltip content="더보기">
              <button
                className={`icon-button mx-1${toolbarLayout.menu.length === 0 ? ' opacity-40' : ''}`}
                onClick={() => {
                  if (toolbarLayout.menu.length > 0)
                    setShowProjectMenu(!showProjectMenu);
                }}
              >
                <FaEllipsisH size={18} />
              </button>
            </Tooltip>
          </ToolbarMenuDropTarget>
          <ToolbarOverflowMenu
            isOpen={showProjectMenu}
            onClose={() => setShowProjectMenu(false)}
            title="프로젝트 메뉴"
            dropUp
            group="project"
            dndType={
              appState.uiToolbar.classic ? undefined : toolbarDndType('project')
            }
            items={toolbarLayout.menu.map((id) => ({
              id,
              name: projectName(id),
              node: buttonNode(id),
            }))}
          />
        </div>
      )}
      </span>
      <ToolbarHideZone group="project" />
    </div>
  );
});

export default SessionSelect;
