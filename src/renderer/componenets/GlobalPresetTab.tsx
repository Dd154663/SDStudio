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
  FaPen,
  FaFileArchive,
  FaFileImport,
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
import { PresetEditModal } from './PresetEditModal';

// 템플릿 관리(글로벌 프리셋 카드 선택)와 공유 — export
export const GlobalVibeImage = observer(
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
          ' flex items-center justify-center bg-[var(--c-surface)] border line-color'
        }
      >
        <span className="text-xs text-muted text-center px-1 select-none">
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
  onEdit: () => void;
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
    onEdit,
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
          // 테두리 폭은 항상 border-2 로 고정(선택 시 크기 변화 방지).
          // 선택 강조는 레이아웃에 영향 없는 안쪽 ring(ring-inset)으로 표현.
          // 모바일은 한 줄에 2개(50%-half gap), 데스크톱은 고정폭.
          'relative flex-none w-[calc(50%-8px)] md:w-64 group rounded-lg overflow-hidden flex flex-col border-2 ' +
          (selected
            ? 'border-sky-500 ring-2 ring-inset ring-sky-500'
            : 'line-color')
        }
      >
        <div
          className={
            'relative ' +
            (multiSelectMode
              ? 'cursor-pointer hover:brightness-95 active:brightness-90'
              : '')
          }
          onClick={() => {
            // 실수 클릭 임포트 방지 — 임포트는 호버 시 나타나는 중앙 버튼으로만.
            if (multiSelectMode) onToggleSelect();
          }}
        >
          <GlobalVibeImage
            profile={entry.profile}
            className="w-full aspect-[3/4] md:aspect-auto md:h-96 object-cover"
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
            <div className="absolute top-2 right-2 bg-[var(--c-surface-2)] rounded p-2 shadow-lg">
              {selected ? (
                <FaCheckSquare className="text-sky-500" size={22} />
              ) : (
                <FaSquare className="text-faint" size={22} />
              )}
            </div>
          )}
          {/* PC: 호버 시 어두워지는 레이어 (버튼 클릭을 막지 않도록 pointer-events-none) */}
          {!multiSelectMode && !isMobile && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition-colors duration-200 z-10 pointer-events-none" />
          )}
          {/* PC: 중앙 큰 불러오기 버튼 (솔리드 — 어둠 레이어와 무관하게 선명) */}
          {!multiSelectMode && !isMobile && (
            <button
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex items-center gap-2 whitespace-nowrap px-5 py-2.5 rounded-lg btn-solid-sky text-base font-semibold shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              onClick={(e) => {
                e.stopPropagation();
                onImportToSession();
              }}
            >
              <FaDownload size={16} />
              불러오기
            </button>
          )}
          {/* PC: 하단 액션 바 (솔리드 색·확대·균등 배치 — 씬 카드 스타일) */}
          {!multiSelectMode && !isMobile && (
            <div className="absolute bottom-0 left-0 right-0 z-20 flex justify-center items-center gap-2 py-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <Tooltip content={entry.isDefault ? '기본 해제' : '기본으로 지정'}>
                <button
                  className="icon-button btn-solid-orange p-3 !rounded-lg shadow-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleDefault();
                  }}
                >
                  {entry.isDefault ? <FaStar size={18} /> : <FaRegStar size={18} />}
                </button>
              </Tooltip>
              <Tooltip content="이름 변경">
                <button
                  className="icon-button btn-solid-green p-3 !rounded-lg shadow-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename();
                  }}
                >
                  <FaFont size={18} />
                </button>
              </Tooltip>
              <Tooltip content="편집 (프롬프트·설정·대표 이미지)">
                <button
                  className="icon-button btn-solid-indigo p-3 !rounded-lg shadow-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                >
                  <FaPen size={18} />
                </button>
              </Tooltip>
              <Tooltip content="PNG로 내보내기">
                <button
                  className="icon-button btn-solid-sky p-3 !rounded-lg shadow-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExport();
                  }}
                >
                  <FaShare size={18} />
                </button>
              </Tooltip>
              <Tooltip content="삭제">
                <button
                  className="icon-button btn-solid-red p-3 !rounded-lg shadow-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  <FaTrash size={18} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {/* 모바일 전용 액션 바 (항상 노출, 좁은 카드라 다단 배치 + 큰 터치 타깃) */}
        {!multiSelectMode && isMobile && (
          <div className="flex flex-col gap-1.5 p-2 bg-[var(--c-surface)] border-t line-color">
            <button
              className="w-full round-button back-sky text-sm py-2.5 font-medium"
              onClick={onImportToSession}
            >
              불러오기
            </button>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                className="icon-button btn-solid-orange py-2.5 rounded flex items-center justify-center"
                onClick={onToggleDefault}
                title={entry.isDefault ? '기본 해제' : '기본으로 지정'}
              >
                {entry.isDefault ? <FaStar size={18} /> : <FaRegStar size={18} />}
              </button>
              <button
                className="icon-button btn-solid-green py-2.5 rounded flex items-center justify-center"
                onClick={onRename}
                title="이름 변경"
              >
                <FaFont size={18} />
              </button>
              <button
                className="icon-button btn-solid-indigo py-2.5 rounded flex items-center justify-center"
                onClick={onEdit}
                title="편집"
              >
                <FaPen size={18} />
              </button>
              <button
                className="icon-button btn-solid-sky py-2.5 rounded flex items-center justify-center"
                onClick={onExport}
                title="내보내기"
              >
                <FaShare size={18} />
              </button>
              <button
                className="icon-button btn-solid-red py-2.5 rounded flex items-center justify-center"
                onClick={onDelete}
                title="삭제"
              >
                <FaTrash size={18} />
              </button>
            </div>
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
          'flex flex-col gap-2 p-3 border-2 rounded-lg mb-2 bg-[var(--c-surface-2)] ' +
          (selected
            ? 'border-sky-500 bg-sky-50 dark:bg-sky-900'
            : 'line-color')
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
                <FaSquare className="text-faint" size={22} />
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
              <FaRegStar className="text-faint" size={22} />
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
                className="icon-button btn-solid-green p-3 rounded"
                onClick={onRename}
              >
                <FaFont size={16} />
              </button>
            </Tooltip>
            <Tooltip content="PNG로 내보내기">
              <button
                className="icon-button btn-solid-sky p-3 rounded"
                onClick={onExport}
              >
                <FaShare size={16} />
              </button>
            </Tooltip>
            <Tooltip content="삭제">
              <button
                className="icon-button btn-solid-red p-3 rounded"
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
  // 통합: 이지/일반 구분 없이 하나의 라이브러리 + 검색/정렬
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'default'>('recent');
  const [editing, setEditing] = useState<IGlobalPresetEntry | null>(null);

  const allPresets = globalPresetService.list();

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
        const entry = await globalPresetService.importFromImage(base64);
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

  // 적용 시 변환 대상 모드: 현재 활성 워크플로우가 일반(SDImageGen)이면 일반,
  // 그 외(이지/미선택/기타)는 이지. (출처 타입이 아니라 "현재 활성 모드"를 따른다)
  const targetMode = (): GlobalPresetType =>
    appState.curSession?.selectedWorkflow?.workflowType === 'SDImageGen'
      ? 'SDImageGen'
      : 'SDImageGenEasy';

  const handleImportToSession = async (entry: IGlobalPresetEntry) => {
    if (!appState.curSession) {
      appState.pushMessage('세션을 먼저 선택해주세요.');
      return;
    }
    await appState.importGlobalPresetIntoSession(
      appState.curSession,
      entry.id,
      targetMode(),
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
    const target = targetMode();
    for (const id of Array.from(selectedIds)) {
      try {
        await globalPresetService.instantiateIntoSession(session, id, target);
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

  const total = allPresets.length;
  const q = query.trim().toLowerCase();
  let visible = q
    ? allPresets.filter((p) => p.name.toLowerCase().includes(q))
    : allPresets.slice();
  visible = [...visible].sort((a, b) => {
    if (sortBy === 'name')
      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    if (sortBy === 'default')
      return (
        (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) ||
        (b.updatedAt || 0) - (a.updatedAt || 0)
      );
    return (b.updatedAt || 0) - (a.updatedAt || 0); // recent
  });

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[var(--c-surface)]">
      {/* 상단 툴바 */}
      <div className="flex-none p-3 border-b line-color flex flex-wrap gap-3 items-center bg-[var(--c-surface)]">
        <Tooltip content="글로벌 프리셋 이미지뿐 아니라, 프롬프트 메타데이터가 있는 PNG도 그림체 프리셋으로 가져옵니다.">
          <button
            className="round-button back-sky flex items-center gap-2 px-4 py-2 text-base"
            onClick={() => fileInputRef.current?.click()}
          >
            <FaFileUpload size={18} />
            <span>PNG 가져오기</span>
          </button>
        </Tooltip>
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
        <Tooltip content="글로벌 프리셋 전체를 tar 파일로 백업">
          <button
            className="round-button back-gray flex items-center gap-2 px-4 py-2 text-base"
            onClick={() => appState.globalPresetBackupExport()}
          >
            <FaFileArchive size={16} />
            <span>백업</span>
          </button>
        </Tooltip>
        <Tooltip content="백업 파일에서 글로벌 프리셋 복원 (동명 처리 선택)">
          <button
            className="round-button back-gray flex items-center gap-2 px-4 py-2 text-base"
            onClick={() => appState.globalPresetBackupImport()}
          >
            <FaFileImport size={16} />
            <span>복원</span>
          </button>
        </Tooltip>
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
        {/* 검색 */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="프리셋 검색..."
          className="px-3 py-2 text-base rounded border line-color bg-[var(--c-input-bg)] text-default focus:outline-none focus:ring-2 focus:ring-sky-400 w-44"
        />
        {/* 정렬 */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="px-2 py-2 text-base rounded border line-color bg-[var(--c-input-bg)] text-default"
        >
          <option value="recent">최근 수정순</option>
          <option value="name">이름순</option>
          <option value="default">기본 우선</option>
        </select>
        <div className="text-sm text-muted whitespace-nowrap">
          {q ? `검색 ${visible.length} / 총 ${total}개` : `총 ${total}개`}
        </div>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto p-6">
        {total === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted">
            <p className="mb-2 text-lg">글로벌 프리셋이 비어있습니다.</p>
            <p className="text-sm">
              세션 프리셋을 우클릭하여 "글로벌 프리셋으로 저장"하거나,
            </p>
            <p className="text-sm">
              상단의 "PNG 가져오기" 버튼을 사용하세요.
            </p>
          </div>
        )}

        {/* 통합 카드 그리드 (이지/일반 구분 없음) */}
        {total > 0 && visible.length === 0 && (
          <div className="text-center text-muted py-10">
            "{query}" 검색 결과가 없습니다.
          </div>
        )}
        {visible.length > 0 && (
          <div className="flex flex-wrap gap-4">
            {visible.map((entry) => (
              <EasyCard
                key={entry.id}
                entry={entry}
                selected={selectedIds.has(entry.id)}
                multiSelectMode={multiSelectMode}
                onToggleSelect={() => toggleSelect(entry.id)}
                onImportToSession={() => handleImportToSession(entry)}
                onToggleDefault={() => handleToggleDefault(entry)}
                onRename={() => handleRename(entry)}
                onEdit={() => setEditing(entry)}
                onExport={() => handleExport(entry)}
                onDelete={() => handleDelete(entry)}
              />
            ))}
          </div>
        )}
      </div>
      {editing && (
        <PresetEditModal
          title="글로벌 프리셋 편집"
          initialName={editing.name}
          preset={editing.preset}
          adapter={{
            fetchProfile: () =>
              editing.profile
                ? globalPresetService.fetchProfileImage(editing.profile)
                : Promise.resolve(null),
            save: async (nm, patch, newRep) => {
              if (nm !== editing.name)
                await globalPresetService.rename(editing.id, nm);
              await globalPresetService.updatePreset(editing.id, patch);
              if (newRep)
                await globalPresetService.replaceProfileImage(
                  editing.id,
                  newRep,
                );
            },
          }}
          onClose={() => setEditing(null)}
        />
      )}
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
  // 통합: 전체 글로벌 프리셋을 보여주고, 선택 시 현재 모드로 자동 변환해 적용한다.
  const entries = globalPresetService.list();
  const displayName =
    picker.workflowType === 'SDImageGenEasy' ? '그림체 (이지모드)' : '그림체';

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[var(--z-modal)]"
      onClick={() => appState.closeGlobalPresetPicker()}
    >
      <div
        className="bg-[var(--c-zone)] rounded-lg r-modal p-6 max-w-5xl w-11/12 max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-default">
            글로벌 프리셋에서 가져오기 <span className="text-sm font-normal text-muted">(→ {displayName}로 적용)</span>
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
            <div className="text-center text-muted p-8 text-lg">
              저장된 글로벌 프리셋이 없습니다.
            </div>
          ) : (
            <div className="flex flex-wrap gap-4">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="relative flex-none cursor-pointer hover:brightness-95 active:brightness-90 border-2 line-color rounded-lg overflow-hidden"
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
          )}
        </div>
      </div>
    </div>
  );
});
