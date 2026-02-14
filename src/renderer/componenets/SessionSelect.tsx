import * as React from 'react';
import { useEffect, useState } from 'react';
import { DropdownSelect, Option } from './UtilComponents';
import { FaPlus, FaShare, FaTrashAlt, FaUserAlt, FaTimes } from 'react-icons/fa';
import { sessionService, imageService, backend, zipService, workFlowService } from '../models';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { CharacterPresetFloatEditor } from './CharacterPresetEditor';
import { CharacterPreset, VibeItem, ReferenceItem } from '../models/types';
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
      }
    })();
  };

  const deleteSession = () => {
    appState.pushDialog({
      type: 'confirm',
      text: '정말로 이 프로젝트를 삭제하시겠습니까?',
      callback: async () => {
        await sessionService.delete(appState.curSession!.name);
        appState.curSession = undefined;
      },
    });
  };

  return (
    <div className="flex gap-2 items-center w-full">
      {showCharacterPresets && appState.curSession && (
        <CharacterPresetFloatEditor
          onClose={() => setShowCharacterPresets(false)}
          onApplyPreset={(preset: CharacterPreset) => {
            const curSession = appState.curSession;
            if (!curSession) return;
            
            // 현재 선택된 워크플로우 타입 가져오기
            const workflowType = curSession.selectedWorkflow?.workflowType;
            if (!workflowType) {
              appState.pushMessage('워크플로우를 먼저 선택해주세요');
              return;
            }
            
            // shared 설정 가져오기
            let shared = curSession.presetShareds.get(workflowType);
            if (!shared) {
              shared = workFlowService.buildShared(workflowType);
              curSession.presetShareds.set(workflowType, shared);
            }
            
            // MobX runInAction으로 모든 변경사항을 한 번에 적용
            runInAction(() => {
              // 프리셋 값 적용
              // 바이브 트랜스퍼 적용
              if (preset.vibes && preset.vibes.length > 0) {
                shared.vibes = preset.vibes.map((v: VibeItem) => VibeItem.fromJSON(v.toJSON()));
              }
              
              // 캐릭터 레퍼런스 적용
              if (preset.characterReferences && preset.characterReferences.length > 0) {
                shared.characterReferences = preset.characterReferences.map((r: ReferenceItem) => ReferenceItem.fromJSON(r.toJSON()));
              }
              
              // SDImageGenEasy의 경우 characterPrompt와 backgroundPrompt 필드 적용
              if (workflowType === 'SDImageGenEasy') {
                // 캐릭터 관련 태그 적용
                if (preset.characterPrompt) {
                  shared.characterPrompt = preset.characterPrompt;
                }
                
                // 배경 관련 태그 적용
                if (preset.backgroundPrompt) {
                  shared.backgroundPrompt = preset.backgroundPrompt;
                }
                
                // 태그 밴 리스트 적용
                if (preset.characterUC) {
                  shared.uc = preset.characterUC;
                }
              }
              
              // 적용된 프리셋 이름 저장
              appState.setAppliedCharacterPreset(preset.name);
            });
            
            setShowCharacterPresets(false);
            appState.pushMessage(`"${preset.name}" 프리셋이 적용되었습니다`);
          }}
        />
      )}
      
      {/* 현재 적용된 캐릭터 프리셋 표시 */}
      {appState.appliedCharacterPreset && (
        <div className="hidden md:flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900 rounded-lg text-sm">
          <FaUserAlt className="text-green-600 dark:text-green-400" size={12} />
          <span className="text-green-700 dark:text-green-300 max-w-24 truncate" title={appState.appliedCharacterPreset}>
            {appState.appliedCharacterPreset}
          </span>
          <button
            className="ml-1 text-green-600 dark:text-green-400 hover:text-red-500 dark:hover:text-red-400"
            onClick={() => appState.clearAppliedCharacterPreset()}
            title="캐릭터 프리셋 해제"
          >
            <FaTimes size={12} />
          </button>
        </div>
      )}
      
      <span className="hidden md:inline whitespace-nowrap text-sub">
        프로젝트:{' '}
      </span>
      <div className="md:max-w-80 w-full">
        <DropdownSelect
          menuPlacement="top"
          selectedOption={appState.curSession?.name}
          options={sessionNames.map((name) => ({ label: name, value: name }))}
          onSelect={selectSession}
        />
      </div>
      <button className={`icon-button nback-sky mx-1`} onClick={addSession}>
        <FaPlus size={18} />
      </button>
      <button
        className={`icon-button nback-green mx-1`}
        onClick={() => {
          if (!appState.curSession) {
            appState.pushMessage('프로젝트를 먼저 선택해주세요');
            return;
          }
          setShowCharacterPresets(true);
        }}
        title="캐릭터 프리셋 관리"
      >
        <FaUserAlt size={18} />
      </button>
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
    </div>
  );
});

export default SessionSelect;
