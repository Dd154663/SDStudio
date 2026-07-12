import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { DropdownSelect, Option } from './UtilComponents';
import ModalOverlay from './ModalOverlay';
import { FaEllipsisH, FaPlus, FaThLarge, FaTrash, FaTrashAlt, FaTrashRestore, FaUserAlt, FaTimes, FaBars, FaChevronDown } from 'react-icons/fa';
import { pushRecentProject } from './ProjectBrowser';
import Tooltip from './Tooltip';
import { sessionService, imageService, backend, zipService, workFlowService, trashService, isMobile, templateService } from '../models';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { CharacterPresetFloatEditor } from './CharacterPresetEditor';
import { CharacterPreset, CharacterPrompt, VibeItem, ReferenceItem } from '../models/types';
import { TOOLBAR_VIEW_MAIN, resolveToolbarView } from '../models/uiLayout';
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
import { v4 as uuidv4 } from 'uuid';
import { runInAction } from 'mobx';

// ===== ProjectTrashView 컴포넌트 (씬 휴지통 SceneTrashView 패턴 재사용) =====
function ProjectTrashView() {
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
  const [showCharacterPresets, setShowCharacterPresets] = useState(false);
  const [showProjectTrash, setShowProjectTrash] = useState(false);
  // 프로젝트 바 ⋯(더보기) 오버플로 메뉴
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  // 툴바 버튼 드래그 재배치 (클래식 툴바에선 비활성)
  const toolbarDrag = useToolbarDragState('project');
  const toolbarDragActive = toolbarDrag.active;
  const { drop: toolbarRowDrop, isOver: toolbarRowOver } =
    useToolbarRowDrop('project', 'project');
  useEffect(() => {
    const onListUpdated = () => {
      setSessionNames(sessionService.list());
    };
    onListUpdated();
    sessionService.addEventListener('listupdated', onListUpdated);
    return () => {
      sessionService.removeEventListener('listupdated', onListUpdated);
    };
  }, []);
  const addSession = () => {
    (async () => {
      appState.pushDialog({
        type: 'input-confirm',
        text: '신규 프로젝트 이름을 입력해주세요',
        callback: async (inputValue) => {
          if (inputValue) {
            if (sessionNames.includes(inputValue)) {
              appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
              return;
            }
            const tpl = await templateService.pickTemplateForCreate();
            if (tpl === undefined) return; // 사용자가 템플릿 선택을 취소
            try {
              if (tpl) {
                await sessionService.createSessionFromTemplate(tpl, inputValue);
              } else {
                await sessionService.add(inputValue);
              }
              const newSession = (await sessionService.get(inputValue))!;
              appState.curSession = newSession;
            } catch (e: any) {
              appState.pushMessage(e.message || '프로젝트 생성에 실패했습니다.');
            }
          }
        },
      });
    })();
  };

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

  const deleteSession = () => {
    appState.pushDialog({
      type: 'confirm',
      text: '정말로 이 프로젝트를 삭제하시겠습니까? (휴지통으로 이동)',
      callback: async () => {
        await sessionService.delete(appState.curSession!.name);
        appState.curSession = undefined;
      },
    });
  };

  // ── 프로젝트 바 버튼 바인딩: 레지스트리 id → 실제 버튼 노드 ──
  // 구성·배치는 TOOLBAR_VIEW_MAIN 의 'project' 영역 + resolveToolbarView 가 결정한다.
  const toolbarButtons: Record<string, React.ReactNode> = {
    'add-session': (
      <button className={`icon-button mx-1`} onClick={addSession}>
        <FaPlus size={18} />
      </button>
    ),
    'character-presets': (
      <Tooltip content={appState.appliedCharacterPreset ? `프리셋: ${appState.appliedCharacterPreset} (길게 눌러 해제)` : '캐릭터 프리셋 관리'}>
      <button
        className={`icon-button mx-1 ${appState.appliedCharacterPreset ? 'back-green' : ''}`}
        onClick={() => {
          if (!appState.curSession) {
            appState.pushMessage('프로젝트를 먼저 선택해주세요');
            return;
          }
          // 모바일 + 프리셋 적용 중: 해제/관리 선택
          if (isMobile && appState.appliedCharacterPreset) {
            appState.pushDialog({
              type: 'select',
              text: `"${appState.appliedCharacterPreset}" 프리셋이 적용 중입니다.`,
              items: [
                { text: '프리셋 해제', value: 'clear' },
                { text: '프리셋 관리 열기', value: 'manage' },
              ],
              callback: (value?: string) => {
                if (value === 'clear') {
                  appState.clearAppliedCharacterPreset();
                } else if (value === 'manage') {
                  setShowCharacterPresets(true);
                }
              },
            });
            return;
          }
          setShowCharacterPresets(true);
        }}
      >
        <FaUserAlt size={18} />
      </button>
      </Tooltip>
    ),
    'delete-session': (
      <button className={`icon-button mx-1`} onClick={deleteSession}>
        <FaTrashAlt size={18} />{' '}
      </button>
    ),
    'project-trash': (
      <Tooltip content="프로젝트 휴지통">
      <button
        className={`icon-button mx-1`}
        onClick={() => setShowProjectTrash(true)}
      >
        <FaTrashRestore size={18} />
      </button>
      </Tooltip>
    ),
  };
  // portable 공유 버튼(backup-export·piece-editor 등) — 크로스 영역 렌더용.
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
  const projectView = resolveToolbarView(
    TOOLBAR_VIEW_MAIN,
    appState.uiToolbar,
    isMobile,
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

  const characterPresetModal =
    showCharacterPresets && appState.curSession ? (
        <CharacterPresetFloatEditor
          onClose={() => setShowCharacterPresets(false)}
          onApplyPreset={(preset: CharacterPreset, mode: 'easy' | 'character') => {
            const curSession = appState.curSession;
            if (!curSession) return;

            const workflowType = curSession.selectedWorkflow?.workflowType;
            if (!workflowType) {
              appState.pushMessage('워크플로우를 먼저 선택해주세요');
              return;
            }

            // Mode 1: 이지모드 적용 (SDImageGenEasy 전용)
            if (mode === 'easy') {
              if (workflowType !== 'SDImageGenEasy') {
                appState.pushMessage('이지모드 적용은 "이미지 생성 (이지모드)" 워크플로우에서만 사용 가능합니다');
                return;
              }
            }

            let shared = curSession.presetShareds.get(workflowType);
            if (!shared) {
              shared = workFlowService.buildShared(workflowType);
              curSession.presetShareds.set(workflowType, shared);
            }

            runInAction(() => {
              // 이전 프리셋에서 추가된 항목 제거 (사용자 직접 추가 항목은 유지)
              const prevVibes = (shared.vibes || []).filter((v: VibeItem) => !v.fromPreset);
              const prevRefs = (shared.characterReferences || []).filter((r: ReferenceItem) => !r.fromPreset);

              // 프리셋의 바이브/레퍼런스를 태그 붙여서 추가
              const presetVibes = (preset.vibes || []).map((v: VibeItem) => {
                const item = VibeItem.fromJSON(v.toJSON());
                item.fromPreset = preset.name;
                return item;
              });
              const presetRefs = (preset.characterReferences || []).map((r: ReferenceItem) => {
                const item = ReferenceItem.fromJSON(r.toJSON());
                item.fromPreset = preset.name;
                return item;
              });

              shared.vibes = [...prevVibes, ...presetVibes];
              shared.characterReferences = [...prevRefs, ...presetRefs];

              if (mode === 'easy') {
                shared.characterPrompt = preset.characterPrompt || '';
                shared.backgroundPrompt = preset.backgroundPrompt || '';
                shared.uc = preset.characterUC || '';
              } else {
                // 이전 프리셋 캐릭터 프롬프트 제거 (사용자 항목 유지)
                const prevPrompts = (shared.characterPrompts || []).filter(
                  (cp: CharacterPrompt) => !cp.fromPreset
                );
                if (preset.characterPrompt || preset.characterUC) {
                  const newEntry: CharacterPrompt = {
                    id: uuidv4(),
                    prompt: preset.characterPrompt || '',
                    uc: preset.characterUC || '',
                    position: { x: 0.5, y: 0.5 },
                    enabled: true,
                    fromPreset: preset.name,
                  };
                  shared.characterPrompts = [...prevPrompts, newEntry];
                } else {
                  shared.characterPrompts = prevPrompts;
                }
              }

              appState.setAppliedCharacterPreset(preset.name);
            });


            setShowCharacterPresets(false);
            const modeLabel = mode === 'easy' ? '이지모드' : '캐릭터 프롬프트';
            appState.pushMessage(`"${preset.name}" 프리셋이 ${modeLabel}로 적용되었습니다`);
          }}
        />
    ) : null;

  const projectTrashModal = (
    <ModalOverlay
      isOpen={showProjectTrash}
      onClose={() => setShowProjectTrash(false)}
      title="🗑️ 프로젝트 휴지통"
    >
      <ProjectTrashView />
    </ModalOverlay>
  );

  // 프로젝트 사이드 바(세로 스택) — bar 와 동일한 레지스트리 해석 결과(toolbarLayout)를
  // 세로로 렌더한다: 인라인/⋯메뉴/숨김·순서 커스터마이징과 편집 모드 드래그 재배열까지
  // 전부 반영(프로젝트 툴바 버튼 최종 이관). 버튼 노드·모달 로직은 위 정의를 재사용.
  if (variant === 'sidebar') {
    return (
      <div
        ref={toolbarRowDrop as any}
        className={`w-full flex flex-col items-center gap-1.5${toolbarRowHighlightClass(toolbarDrag, toolbarRowOver)}`}
      >
        {characterPresetModal}
        {projectTrashModal}
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
        <Tooltip content="프로젝트 탐색">
          <button
            className="icon-button mx-1"
            onClick={() => {
              appState.projectBrowserOpen = true;
            }}
          >
            <FaThLarge size={16} />
          </button>
        </Tooltip>
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
      {characterPresetModal}

      {/* 현재 적용된 캐릭터 프리셋 표시 */}
      {appState.appliedCharacterPreset && (
        <div className="titlebar-no-drag hidden md:flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900 rounded-lg text-sm">
          <FaUserAlt className="text-green-600 dark:text-green-400" size={12} />
          <Tooltip content={appState.appliedCharacterPreset ?? ''}>
          <span className="text-green-700 dark:text-green-300 max-w-24 truncate">
            {appState.appliedCharacterPreset}
          </span>
          </Tooltip>
          <Tooltip content="캐릭터 프리셋 해제">
          <button
            className="ml-1 text-green-600 dark:text-green-400 hover:text-red-500 dark:hover:text-red-400"
            onClick={() => appState.clearAppliedCharacterPreset()}
          >
            <FaTimes size={12} />
          </button>
          </Tooltip>
        </div>
      )}
      
      {/* 프로젝트 선택 영역: 기본 = 버튼과 한 줄 공유(폭 변동은 truncate가 흡수, 최소폭 미달 시 버튼이 다음 줄로 래핑) / 클래식 = 모바일 1행 전체 */}
      <div
        className={`titlebar-no-drag flex items-center gap-1 ${
          appState.uiToolbar.classic
            ? 'w-full md:w-auto md:flex-1 md:max-w-80 min-w-0'
            : 'flex-1 min-w-[9rem] md:min-w-0 md:max-w-80'
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
            <span className="hidden md:inline whitespace-nowrap text-sub">
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
            <span className="hidden md:inline whitespace-nowrap text-sub">
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
        <Tooltip content="프로젝트 탐색">
        <button className={`icon-button mx-1`} onClick={() => { appState.projectBrowserOpen = true; }}>
          <FaThLarge size={16} />
        </button>
        </Tooltip>
      </div>
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
      {projectTrashModal}
    </div>
  );
});

export default SessionSelect;
