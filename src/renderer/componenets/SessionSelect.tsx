import * as React from 'react';
import { useEffect, useState } from 'react';
import { DropdownSelect, Option } from './UtilComponents';
import { FaPlus, FaPuzzlePiece, FaShare, FaThLarge, FaTrashAlt, FaTrashRestore, FaUserAlt, FaTimes, FaBars } from 'react-icons/fa';
import { pushRecentProject } from './ProjectBrowser';
import Tooltip from './Tooltip';
import { sessionService, imageService, backend, zipService, workFlowService, trashService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { CharacterPresetFloatEditor } from './CharacterPresetEditor';
import { CharacterPreset, CharacterPrompt, VibeItem, ReferenceItem } from '../models/types';
import { v4 as uuidv4 } from 'uuid';
import { runInAction } from 'mobx';

const SessionSelect = observer(() => {
  const [sessionNames, setSessionNames] = useState<string[]>([]);
  const [showCharacterPresets, setShowCharacterPresets] = useState(false);
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
            await sessionService.add(inputValue);
            const newSession = (await sessionService.get(inputValue))!;
            appState.curSession = newSession;
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

  const openProjectTrash = async () => {
    const deletedProjects = await trashService.getDeletedProjects();
    if (deletedProjects.length === 0) {
      appState.pushMessage('프로젝트 휴지통이 비어있습니다.');
      return;
    }
    const items = deletedProjects.map((p) => {
      const d = new Date(p.deletedAt);
      const dateStr = p.deletedAt
        ? d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '알 수 없음';
      return {
        text: p.name + ' (' + dateStr + ')',
        value: p.name,
      };
    });
    const selected = await appState.pushDialogAsync({
      type: 'select',
      text: '복원 또는 영구삭제할 프로젝트를 선택하세요',
      items: items,
    });
    if (!selected) return;
    const action = await appState.pushDialogAsync({
      type: 'select',
      text: `"${selected}" 프로젝트에 대해 수행할 작업을 선택하세요`,
      items: [
        { text: '프로젝트 복원', value: 'restore' },
        { text: '영구 삭제', value: 'delete' },
      ],
    });
    if (action === 'restore') {
      try {
        await trashService.restoreProject(selected);
        appState.pushMessage(`프로젝트 "${selected}"이(가) 복원되었습니다.`);
      } catch (e: any) {
        appState.pushMessage(e.message || '프로젝트 복원에 실패했습니다.');
      }
    } else if (action === 'delete') {
      appState.pushDialog({
        type: 'confirm',
        text: `"${selected}" 프로젝트를 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
        callback: async () => {
          await trashService.permanentlyDeleteProject(selected);
          appState.pushMessage(`프로젝트 "${selected}"이(가) 영구 삭제되었습니다.`);
        },
      });
    }
  };

  return (
    <div className="flex gap-2 items-center w-full flex-wrap">
      {showCharacterPresets && appState.curSession && (
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
      )}
      
      {/* 현재 적용된 캐릭터 프리셋 표시 */}
      {appState.appliedCharacterPreset && (
        <div className="hidden md:flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900 rounded-lg text-sm">
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
      
      {/* 프로젝트 선택 영역: 모바일에서 1행 전체, PC에서는 인라인 */}
      <div className="flex items-center gap-1 w-full md:w-auto md:flex-1 md:max-w-80 min-w-0">
        <span className="hidden md:inline whitespace-nowrap text-sub">
          프로젝트:{' '}
        </span>
        <Tooltip content="프로젝트 목록(폴더)">
          <button
            className="icon-button nback-sky flex-none"
            onClick={() => {
              appState.projectDrawerOpen = true;
            }}
          >
            <FaBars size={16} />
          </button>
        </Tooltip>
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
        <Tooltip content="프로젝트 탐색">
        <button className={`icon-button nback-sky mx-1`} onClick={() => { appState.projectBrowserOpen = true; }}>
          <FaThLarge size={16} />
        </button>
        </Tooltip>
      </div>
      <button className={`icon-button nback-sky mx-1`} onClick={addSession}>
        <FaPlus size={18} />
      </button>
      <Tooltip content={appState.appliedCharacterPreset ? `프리셋: ${appState.appliedCharacterPreset} (길게 눌러 해제)` : '캐릭터 프리셋 관리'}>
      <button
        className={`icon-button mx-1 ${appState.appliedCharacterPreset ? 'back-green' : 'nback-green'}`}
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
      <button
        className={`icon-button nback-orange mx-1`}
        onClick={() => {
          appState.projectBackupMenu();
        }}
      >
        <FaShare />
      </button>
      <button className={`icon-button nback-red mx-1`} onClick={deleteSession}>
        <FaTrashAlt size={18} />{' '}
      </button>
      <Tooltip content="프로젝트 휴지통">
      <button
        className={`icon-button nback-gray mx-1`}
        onClick={openProjectTrash}
      >
        <FaTrashRestore size={18} />
      </button>
      </Tooltip>
      <button
        className="round-button back-green flex items-center gap-1 ml-1"
        onClick={() => appState.openPieceEditor()}
      >
        <FaPuzzlePiece size={18} />
        <span className="hidden md:inline">프롬프트조각</span>
      </button>
    </div>
  );
});

export default SessionSelect;
