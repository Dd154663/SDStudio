import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaFilm,
  FaPen,
  FaCopy,
  FaTrashAlt,
  FaFileImport,
  FaFileExport,
  FaPlus,
  FaCheck,
  FaTimes,
} from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import Tooltip from './Tooltip';
import { sessionService, templateService } from '../models';
import { appState } from '../models/AppService';

// 씬 템플릿 관리 오버레이 (씬 템플릿 개편 후속, 2026-07-18 실기 피드백):
// select 다이얼로그 연쇄(선택→동작→확인)가 불편 → 캐릭터 프리셋 관리와 같은
// 모달 목록 UI 로 대체. 템플릿은 숨김 프로젝트라 일반 프로젝트 목록에 없으므로
// 여기가 유일한 관리 지점이다. 행 클릭 = 열어서 씬 수정(모달 닫힘).
const SceneTemplateManager = observer(({ onClose }: { onClose: () => void }) => {
  const templates = templateService.listSceneTemplates();
  const curSession = appState.curSession;
  // 인라인 이름 변경 (드로어 프로젝트 행과 같은 패턴)
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // listSceneTemplates 는 sessionService.list()(비-observable)로 실존 필터를
  // 하므로, 복제/삭제 등 목록 변경을 listupdated 이벤트로 리렌더한다.
  const [, setVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => setVersion((v) => v + 1);
    sessionService.addEventListener('listupdated', onUpdate);
    return () => sessionService.removeEventListener('listupdated', onUpdate);
  }, []);

  const openTemplate = async (name: string) => {
    const tpl = await sessionService.get(name);
    if (!tpl) {
      appState.pushMessage('씬 템플릿 프로젝트를 불러올 수 없습니다.');
      return;
    }
    appState.curSession = tpl;
    onClose();
  };

  const startRename = (name: string) => {
    setEditing(name);
    setEditValue(name);
  };

  const commitRename = async () => {
    const old = editing;
    const newName = editValue.trim();
    setEditing(null);
    if (!old || !newName || old === newName) return;
    if (sessionService.list().includes(newName)) {
      appState.pushMessage('같은 이름의 프로젝트가 이미 존재합니다.');
      return;
    }
    try {
      // renameProject 캐스케이드가 sceneNames/hiddenNames 를 함께 이관한다
      await sessionService.renameProject(old, newName);
      const loaded = sessionService.getLoaded(newName);
      if (loaded) loaded.name = newName;
      appState.pushMessage('씬 템플릿 이름이 변경되었습니다.');
    } catch (e: any) {
      appState.pushMessage(e.message || '이름 변경에 실패했습니다.');
    }
  };

  const handleDuplicate = async (name: string) => {
    const tpl = await sessionService.get(name);
    if (!tpl) {
      appState.pushMessage('씬 템플릿 프로젝트를 불러올 수 없습니다.');
      return;
    }
    await templateService.createSceneTemplate(tpl);
  };

  const handleDelete = (name: string) => {
    appState.pushDialog({
      type: 'confirm',
      text: `씬 템플릿 "${name}"을(를) 삭제할까요?\n휴지통으로 이동되어 복구할 수 있습니다.`,
      callback: async () => {
        try {
          await sessionService.get(name);
          await sessionService.delete(name);
          appState.pushMessage('씬 템플릿이 휴지통으로 이동되었습니다.');
        } catch (e: any) {
          appState.pushMessage(e.message || '삭제에 실패했습니다.');
        }
      },
    });
  };

  const createFromCurrent = async () => {
    if (!curSession) return;
    await templateService.createSceneTemplate(curSession);
  };

  const createEmpty = async () => {
    const name = await templateService.createEmptySceneTemplate();
    if (name) onClose(); // 만든 템플릿이 열리므로 모달은 닫는다
  };

  const importToCurrent = async () => {
    if (!curSession) return;
    const names = await templateService.importSceneTemplate(curSession);
    if (names && names.length > 0) onClose(); // 가져온 씬을 바로 보도록
  };

  return (
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      title="씬 템플릿 관리"
      width="max-w-2xl"
    >
      {/* 상단 액션 */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Tooltip content="현재 프로젝트의 씬 전체를 복제해 새 템플릿으로 만듭니다">
          <button
            onClick={createFromCurrent}
            disabled={!curSession}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium btn-neutral text-body transition-colors whitespace-nowrap disabled:opacity-40"
          >
            <FaFileExport size={13} /> 현재 씬 전체로 만들기
          </button>
        </Tooltip>
        <Tooltip content="빈 템플릿을 만들어 바로 열어줍니다">
          <button
            onClick={createEmpty}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium btn-neutral text-body transition-colors whitespace-nowrap"
          >
            <FaPlus size={13} /> 빈 템플릿
          </button>
        </Tooltip>
        <Tooltip content="선택한 템플릿의 씬들을 현재 프로젝트에 추가합니다">
          <button
            onClick={importToCurrent}
            disabled={!curSession || templates.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium btn-neutral text-body transition-colors whitespace-nowrap disabled:opacity-40"
          >
            <FaFileImport size={13} /> 현재 프로젝트로 가져오기
          </button>
        </Tooltip>
      </div>
      <div className="text-xs text-muted mb-3">
        템플릿은 숨김 프로젝트로 저장되어 일반 프로젝트 목록에는 보이지
        않습니다. 행을 클릭하면 열어서 씬을 수정할 수 있습니다.
      </div>

      {/* 템플릿 목록 */}
      {templates.length === 0 ? (
        <div className="text-sm text-faint text-center py-10">
          씬 템플릿이 없습니다 — 위 버튼으로 만들어보세요
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {templates.map((name) =>
            editing === name ? (
              <div
                key={name}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border line-color"
              >
                <FaFilm
                  size={13}
                  className="flex-none text-purple-500 dark:text-purple-400"
                />
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    else if (e.key === 'Escape') setEditing(null);
                  }}
                  className="flex-1 min-w-0 px-2 py-1 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
                <Tooltip content="확인">
                  <button
                    onClick={commitRename}
                    className="btn-ghost p-2 rounded-md text-faint hover:text-green-500"
                  >
                    <FaCheck size={13} />
                  </button>
                </Tooltip>
                <Tooltip content="취소">
                  <button
                    onClick={() => setEditing(null)}
                    className="btn-ghost p-2 rounded-md text-faint hover:text-red-500"
                  >
                    <FaTimes size={13} />
                  </button>
                </Tooltip>
              </div>
            ) : (
              <div
                key={name}
                onClick={() => openTemplate(name)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border line-color cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <FaFilm
                  size={13}
                  className="flex-none text-purple-500 dark:text-purple-400"
                />
                <span className="flex-1 min-w-0 truncate text-sm text-default">
                  {name}
                </span>
                <Tooltip content="이름 변경">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(name);
                    }}
                    className="btn-ghost p-2 rounded-md text-faint hover:text-sky-500"
                  >
                    <FaPen size={13} />
                  </button>
                </Tooltip>
                <Tooltip content="복제">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDuplicate(name);
                    }}
                    className="btn-ghost p-2 rounded-md text-faint hover:text-sky-500"
                  >
                    <FaCopy size={13} />
                  </button>
                </Tooltip>
                <Tooltip content="삭제 (휴지통으로 이동)">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(name);
                    }}
                    className="btn-ghost p-2 rounded-md text-faint hover:text-red-500"
                  >
                    <FaTrashAlt size={13} />
                  </button>
                </Tooltip>
              </div>
            ),
          )}
        </div>
      )}
    </ModalOverlay>
  );
});

export default SceneTemplateManager;
