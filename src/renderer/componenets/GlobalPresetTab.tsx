import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Buffer } from 'buffer';
import {
  FaStar,
  FaRegStar,
  FaTrash,
  FaShare,
  FaFont,
  FaDownload,
  FaTimes,
  FaCheckSquare,
  FaSquare,
  FaFileUpload,
} from 'react-icons/fa';
import {
  backend,
  globalPresetService,
  imageService,
  isMobile,
} from '../models';
import {
  GlobalPresetType,
  IGlobalPresetEntry,
  SUPPORTED_GLOBAL_PRESET_TYPES,
} from '../models/GlobalPresetService';
import { appState } from '../models/AppService';
import Tooltip from './Tooltip';

const GlobalVibeImage = observer(
  ({
    profile,
    className,
  }: {
    profile?: string;
    className: string;
  }) => {
    const [image, setImage] = useState<string | null>(null);
    useEffect(() => {
      let cancelled = false;
      if (!profile) {
        setImage(null);
        return;
      }
      (async () => {
        try {
          const data = await globalPresetService.fetchProfileImage(profile);
          if (!cancelled) setImage(data);
        } catch (e) {
          if (!cancelled) setImage(null);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [profile]);
    if (image) {
      return (
        <img
          className={className}
          src={image}
          draggable={false}
        />
      );
    }
    return (
      <div
        className={
          className +
          ' flex items-center justify-center bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600'
        }
      >
        <span className="text-xs text-gray-500 dark:text-gray-400 text-center px-1 select-none">
          NO IMAGE
        </span>
      </div>
    );
  },
);

interface EasyCardProps {
  entry: IGlobalPresetEntry;
  selected: boolean;
  multiSelectMode: boolean;
  onToggleSelect: () => void;
  onImportToSession: () => void;
  onToggleDefault: () => void;
  onRename: () => void;
  onExport: () => void;
  onDelete: () => void;
}

const EasyCard = observer(
  ({
    entry,
    selected,
    multiSelectMode,
    onToggleSelect,
    onImportToSession,
    onToggleDefault,
    onRename,
    onExport,
    onDelete,
  }: EasyCardProps) => {
    // 모바일에선 호버가 없으므로:
    //  - 이미지 탭 시 자동 불러오기 금지 (대신 아래 "불러오기" 버튼)
    //  - 액션 버튼은 항상 표시
    // 데스크탑에선 기존대로 이미지 탭 = 불러오기, 호버 시 버튼 노출
    return (
      <div
        className={
          'relative flex-none group rounded-lg overflow-hidden flex flex-col ' +
          (selected
            ? 'border-4 border-sky-500'
            : 'border-2 border-gray-300 dark:border-slate-600')
        }
      >
        <div
          className={
            'relative ' +
            (multiSelectMode || !isMobile
              ? 'cursor-pointer hover:brightness-95 active:brightness-90'
              : '')
          }
          onClick={() => {
            if (multiSelectMode) onToggleSelect();
            else if (!isMobile) onImportToSession();
          }}
        >
          <GlobalVibeImage
            profile={entry.profile}
            className="w-56 h-80 md:w-64 md:h-96 object-cover"
          />
          {/* 이름 배지 */}
          <div
            className="absolute bottom-0 right-0 bg-gray-700/80 text-base text-white px-2 py-1 rounded-xl m-2 truncate select-none"
            style={{ maxWidth: '90%' }}
          >
            {entry.name}
          </div>
          {/* 기본 표시 */}
          {entry.isDefault && (
            <div
              className="absolute top-2 left-2 bg-orange-500 text-white rounded-full p-2 shadow-lg"
              title="기본으로 지정됨"
            >
              <FaStar size={16} />
            </div>
          )}
          {/* 멀티선택 체크박스 */}
          {multiSelectMode && (
            <div className="absolute top-2 right-2 bg-white dark:bg-slate-800 rounded p-2 shadow-lg">
              {selected ? (
                <FaCheckSquare className="text-sky-500" size={22} />
              ) : (
                <FaSquare className="text-gray-400" size={22} />
              )}
            </div>
          )}
          {/* 데스크탑 호버 툴바 */}
          {!multiSelectMode && !isMobile && (
            <div className="absolute inset-x-0 top-0 p-2 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-b from-black/60 to-transparent">
              <Tooltip content={entry.isDefault ? '기본 해제' : '기본으로 지정'}>
                <button
                  className="icon-button bg-orange-500 p-2 rounded text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleDefault();
                  }}
                >
                  {entry.isDefault ? <FaStar size={16} /> : <FaRegStar size={16} />}
                </button>
              </Tooltip>
              <Tooltip content="이름 변경">
                <button
                  className="icon-button bg-green-500 p-2 rounded text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename();
                  }}
                >
                  <FaFont size={16} />
                </button>
              </Tooltip>
              <Tooltip content="PNG로 내보내기">
                <button
                  className="icon-button bg-sky-500 p-2 rounded text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExport();
                  }}
                >
                  <FaShare size={16} />
                </button>
              </Tooltip>
              <Tooltip content="삭제">
                <button
                  className="icon-button bg-red-500 p-2 rounded text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  <FaTrash size={16} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {/* 모바일 전용 액션 바 (항상 노출) */}
        {!multiSelectMode && isMobile && (
          <div className="flex gap-1 p-2 bg-gray-100 dark:bg-slate-800 border-t border-gray-300 dark:border-slate-600">
            <button
              className="flex-1 round-button back-sky text-sm py-2 font-medium"
              onClick={onImportToSession}
            >
              불러오기
            </button>
            <button
              className="icon-button bg-orange-500 p-2 rounded text-white"
              onClick={onToggleDefault}
              title={entry.isDefault ? '기본 해제' : '기본으로 지정'}
            >
              {entry.isDefault ? <FaStar size={16} /> : <FaRegStar size={16} />}
            </button>
            <button
              className="icon-button bg-green-500 p-2 rounded text-white"
              onClick={onRename}
              title="이름 변경"
            >
              <FaFont size={16} />
            </button>
            <button
              className="icon-button bg-sky-500 p-2 rounded text-white"
              onClick={onExport}
              title="내보내기"
            >
              <FaShare size={16} />
            </button>
            <button
              className="icon-button bg-red-500 p-2 rounded text-white"
              onClick={onDelete}
              title="삭제"
            >
              <FaTrash size={16} />
            </button>
          </div>
        )}
      </div>
    );
  },
);

interface GenRowProps {
  entry: IGlobalPresetEntry;
  selected: boolean;
  multiSelectMode: boolean;
  onToggleSelect: () => void;
  onImportToSession: () => void;
  onToggleDefault: () => void;
  onRename: () => void;
  onExport: () => void;
  onDelete: () => void;
}

const GenRow = observer(
  ({
    entry,
    selected,
    multiSelectMode,
    onToggleSelect,
    onImportToSession,
    onToggleDefault,
    onRename,
    onExport,
    onDelete,
  }: GenRowProps) => {
    return (
      <div
        className={
          'flex flex-col gap-2 p-3 border-2 rounded-lg mb-2 bg-white dark:bg-slate-800 ' +
          (selected
            ? 'border-sky-500 bg-sky-50 dark:bg-sky-900'
            : 'border-gray-300 dark:border-slate-600')
        }
      >
        {/* 1행: 기본 토글 + 이름 (전체 너비) */}
        <div className="flex items-center gap-3 min-w-0">
          {multiSelectMode && (
            <button
              className="icon-button flex-none"
              onClick={onToggleSelect}
            >
              {selected ? (
                <FaCheckSquare className="text-sky-500" size={22} />
              ) : (
                <FaSquare className="text-gray-400" size={22} />
              )}
            </button>
          )}
          <button
            className="icon-button p-1 flex-none"
            onClick={onToggleDefault}
            title={entry.isDefault ? '기본 해제' : '기본으로 지정'}
          >
            {entry.isDefault ? (
              <FaStar className="text-orange-500" size={22} />
            ) : (
              <FaRegStar className="text-gray-400" size={22} />
            )}
          </button>
          <span className="flex-1 truncate text-default text-base font-medium">
            {entry.name}
          </span>
        </div>
        {/* 2행: 액션 버튼들 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="round-button back-sky text-base px-4 py-2 flex-1 md:flex-none"
            onClick={onImportToSession}
            disabled={multiSelectMode}
          >
            세션으로 가져오기
          </button>
          <div className="flex gap-2 md:ml-auto">
            <Tooltip content="이름 변경">
              <button
                className="icon-button bg-green-500 p-3 rounded text-white"
                onClick={onRename}
              >
                <FaFont size={16} />
              </button>
            </Tooltip>
            <Tooltip content="PNG로 내보내기">
              <button
                className="icon-button bg-sky-500 p-3 rounded text-white"
                onClick={onExport}
              >
                <FaShare size={16} />
              </button>
            </Tooltip>
            <Tooltip content="삭제">
              <button
                className="icon-button bg-red-500 p-3 rounded text-white"
                onClick={onDelete}
              >
                <FaTrash size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  },
);

export const GlobalPresetTab = observer(() => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const easyPresets = globalPresetService.list('SDImageGenEasy');
  const genPresets = globalPresetService.list('SDImageGen');

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitMultiSelect = () => {
    setMultiSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleFiles = async (files: FileList) => {
    if (!files || files.length === 0) return;
    appState.setProgressDialog({
      text: '글로벌 프리셋 가져오는 중...',
      done: 0,
      total: files.length,
    });
    let ok = 0;
    let fail = 0;
    const failNames: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const buf = await file.arrayBuffer();
        const base64 = Buffer.from(buf).toString('base64');
        const entry = await globalPresetService.importFromPng(base64);
        if (entry) ok++;
        else {
          fail++;
          failNames.push(file.name);
        }
      } catch (e: any) {
        fail++;
        failNames.push(file.name);
        console.error('Failed to import global preset:', file.name, e);
      }
      appState.setProgressDialog({
        text: '글로벌 프리셋 가져오는 중...',
        done: i + 1,
        total: files.length,
      });
    }
    appState.setProgressDialog(undefined);
    if (fail === 0) {
      appState.pushDialog({
        type: 'yes-only',
        text: `${ok}개의 글로벌 프리셋을 가져왔습니다.`,
      });
    } else {
      appState.pushDialog({
        type: 'yes-only',
        text: `성공 ${ok}개 / 실패 ${fail}개${
          failNames.length > 0
            ? '\n실패 파일: ' + failNames.slice(0, 5).join(', ')
            : ''
        }${failNames.length > 5 ? '\n...' : ''}`,
      });
    }
  };

  const handleRename = async (entry: IGlobalPresetEntry) => {
    const newName = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: `새 이름을 입력하세요 (현재: ${entry.name})`,
    });
    if (!newName) return;
    try {
      await globalPresetService.rename(entry.id, newName);
    } catch (e: any) {
      appState.pushMessage(e.message || '이름 변경 실패');
    }
  };

  const handleDelete = (entry: IGlobalPresetEntry) => {
    appState.pushDialog({
      type: 'confirm',
      text: `"${entry.name}" 글로벌 프리셋을 삭제하시겠습니까?`,
      callback: async () => {
        try {
          await globalPresetService.delete(entry.id);
        } catch (e: any) {
          appState.pushMessage(e.message || '삭제 실패');
        }
      },
    });
  };

  const handleToggleDefault = async (entry: IGlobalPresetEntry) => {
    try {
      await globalPresetService.setDefault(entry.id, !entry.isDefault);
    } catch (e: any) {
      appState.pushMessage(e.message || '기본 설정 실패');
    }
  };

  const handleImportToSession = async (entry: IGlobalPresetEntry) => {
    if (!appState.curSession) {
      appState.pushMessage('세션을 먼저 선택해주세요.');
      return;
    }
    await appState.importGlobalPresetIntoSession(
      appState.curSession,
      entry.id,
    );
  };

  const handleExport = async (entry: IGlobalPresetEntry) => {
    await appState.exportGlobalPresetToPng(entry);
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    appState.pushDialog({
      type: 'confirm',
      text: `${selectedIds.size}개의 글로벌 프리셋을 삭제하시겠습니까?`,
      callback: async () => {
        for (const id of Array.from(selectedIds)) {
          try {
            await globalPresetService.delete(id);
          } catch (e) {
            /* ignore */
          }
        }
        exitMultiSelect();
      },
    });
  };

  const handleBulkImportToSession = async () => {
    if (selectedIds.size === 0) return;
    if (!appState.curSession) {
      appState.pushMessage('세션을 먼저 선택해주세요.');
      return;
    }
    const session = appState.curSession;
    appState.setProgressDialog({
      text: '세션으로 가져오는 중...',
      done: 0,
      total: selectedIds.size,
    });
    let done = 0;
    let fail = 0;
    for (const id of Array.from(selectedIds)) {
      try {
        await globalPresetService.instantiateIntoSession(session, id);
      } catch (e) {
        fail++;
      }
      done++;
      appState.setProgressDialog({
        text: '세션으로 가져오는 중...',
        done,
        total: selectedIds.size,
      });
    }
    appState.setProgressDialog(undefined);
    appState.pushMessage(
      `${done - fail}개 가져오기 완료${fail > 0 ? ` (${fail}개 실패)` : ''}`,
    );
    exitMultiSelect();
  };

  const handleBulkSetDefault = async (value: boolean) => {
    if (selectedIds.size === 0) return;
    for (const id of Array.from(selectedIds)) {
      try {
        await globalPresetService.setDefault(id, value);
      } catch (e) {
        /* ignore */
      }
    }
    exitMultiSelect();
  };

  const total = easyPresets.length + genPresets.length;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-white dark:bg-slate-900">
      {/* 상단 툴바 */}
      <div className="flex-none p-3 border-b border-gray-300 dark:border-slate-600 flex flex-wrap gap-3 items-center bg-gray-50 dark:bg-slate-800">
        <button
          className="round-button back-sky flex items-center gap-2 px-4 py-2 text-base"
          onClick={() => fileInputRef.current?.click()}
        >
          <FaFileUpload size={18} />
          <span>PNG 가져오기</span>
        </button>
        <input
          type="file"
          accept="image/png"
          multiple
          ref={fileInputRef}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          className={
            'round-button px-4 py-2 text-base ' +
            (multiSelectMode ? 'back-orange' : 'back-gray')
          }
          onClick={() => {
            if (multiSelectMode) exitMultiSelect();
            else setMultiSelectMode(true);
          }}
        >
          {multiSelectMode
            ? `멀티선택 취소 (${selectedIds.size})`
            : '멀티선택 모드'}
        </button>
        {multiSelectMode && (
          <>
            <button
              className="round-button back-sky px-4 py-2 text-base"
              disabled={selectedIds.size === 0}
              onClick={handleBulkImportToSession}
            >
              세션으로 일괄 가져오기
            </button>
            <button
              className="round-button back-orange px-4 py-2 text-base"
              disabled={selectedIds.size === 0}
              onClick={() => handleBulkSetDefault(true)}
            >
              일괄 기본 지정
            </button>
            <button
              className="round-button back-gray px-4 py-2 text-base"
              disabled={selectedIds.size === 0}
              onClick={() => handleBulkSetDefault(false)}
            >
              일괄 기본 해제
            </button>
            <button
              className="round-button back-red px-4 py-2 text-base"
              disabled={selectedIds.size === 0}
              onClick={handleBulkDelete}
            >
              일괄 삭제
            </button>
          </>
        )}
        <div className="flex-1" />
        <div className="text-sm text-gray-600 dark:text-gray-300">
          총 {total}개 (그림체(이지모드) {easyPresets.length} / 그림체{' '}
          {genPresets.length})
        </div>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto p-6">
        {total === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <p className="mb-2 text-lg">글로벌 프리셋이 비어있습니다.</p>
            <p className="text-sm">
              세션 프리셋을 우클릭하여 "글로벌 프리셋으로 저장"하거나,
            </p>
            <p className="text-sm">
              상단의 "PNG 가져오기" 버튼을 사용하세요.
            </p>
          </div>
        )}

        {/* 그림체(이지모드) 섹션 */}
        {easyPresets.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-bold mb-4 text-default border-b-2 border-gray-300 dark:border-slate-600 pb-2">
              그림체 (이지모드)
            </h2>
            <div className="flex flex-wrap gap-4">
              {easyPresets.map((entry) => (
                <EasyCard
                  key={entry.id}
                  entry={entry}
                  selected={selectedIds.has(entry.id)}
                  multiSelectMode={multiSelectMode}
                  onToggleSelect={() => toggleSelect(entry.id)}
                  onImportToSession={() => handleImportToSession(entry)}
                  onToggleDefault={() => handleToggleDefault(entry)}
                  onRename={() => handleRename(entry)}
                  onExport={() => handleExport(entry)}
                  onDelete={() => handleDelete(entry)}
                />
              ))}
            </div>
          </div>
        )}

        {/* 그림체 섹션 */}
        {genPresets.length > 0 && (
          <div>
            <h2 className="text-xl font-bold mb-4 text-default border-b-2 border-gray-300 dark:border-slate-600 pb-2">
              그림체
            </h2>
            <div>
              {genPresets.map((entry) => (
                <GenRow
                  key={entry.id}
                  entry={entry}
                  selected={selectedIds.has(entry.id)}
                  multiSelectMode={multiSelectMode}
                  onToggleSelect={() => toggleSelect(entry.id)}
                  onImportToSession={() => handleImportToSession(entry)}
                  onToggleDefault={() => handleToggleDefault(entry)}
                  onRename={() => handleRename(entry)}
                  onExport={() => handleExport(entry)}
                  onDelete={() => handleDelete(entry)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * 현재 세션으로 가져오기 위한 글로벌 프리셋 선택 다이얼로그.
 * appState.globalPresetPicker가 설정되면 App.tsx에서 렌더링.
 */
export const GlobalPresetPickerOverlay = observer(() => {
  const picker = appState.globalPresetPicker;
  if (!picker) return null;
  const entries = globalPresetService.list(picker.workflowType);
  const displayName =
    picker.workflowType === 'SDImageGenEasy' ? '그림체 (이지모드)' : '그림체';

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[5000]"
      onClick={() => appState.closeGlobalPresetPicker()}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-5xl w-11/12 max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-default">
            글로벌 프리셋에서 가져오기 — {displayName}
          </h2>
          <button
            className="icon-button p-2 text-default"
            onClick={() => appState.closeGlobalPresetPicker()}
          >
            <FaTimes size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {entries.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 p-8 text-lg">
              저장된 글로벌 프리셋이 없습니다.
            </div>
          ) : picker.workflowType === 'SDImageGenEasy' ? (
            <div className="flex flex-wrap gap-4">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="relative flex-none cursor-pointer hover:brightness-95 active:brightness-90 border-2 border-gray-300 dark:border-slate-600 rounded-lg overflow-hidden"
                  onClick={() => picker.onSelect(entry.id)}
                >
                  <GlobalVibeImage
                    profile={entry.profile}
                    className="w-48 h-64 object-cover"
                  />
                  <div
                    className="absolute bottom-0 right-0 bg-gray-700/80 text-sm text-white px-2 py-1 rounded-xl m-2 truncate"
                    style={{ maxWidth: '90%' }}
                  >
                    {entry.name}
                  </div>
                  {entry.isDefault && (
                    <div className="absolute top-2 left-2 bg-orange-500 text-white rounded-full p-2 shadow-lg">
                      <FaStar size={14} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div>
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  className="w-full flex items-center gap-3 p-3 border-2 rounded-lg mb-2 text-left hover:bg-gray-100 dark:hover:bg-slate-700 border-gray-300 dark:border-slate-600"
                  onClick={() => picker.onSelect(entry.id)}
                >
                  {entry.isDefault && (
                    <FaStar className="text-orange-500" size={20} />
                  )}
                  <span className="flex-1 truncate text-default text-base font-medium">
                    {entry.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
