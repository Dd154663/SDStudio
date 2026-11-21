import * as React from 'react';
import { useEffect, useState, useMemo, useRef, useLayoutEffect } from 'react';
import { observer } from 'mobx-react-lite';
import Tooltip from './Tooltip';
import {
  FaPlus,
  FaTrash,
  FaUserAlt,
  FaCheck,
  FaTimes,
  FaFolder,
  FaPen,
  FaCheckSquare,
} from 'react-icons/fa';
import {
  CharacterPreset,
  VibeItem,
  ReferenceItem,
  ICharacterPreset,
} from '../models/types';
import {
  imageService,
  cyclingSessionService,
  taskQueueService,
  backend,
  isMobile,
  globalCharacterPresetService,
  templateService,
} from '../models';
import { appState } from '../models/AppService';
import { nameErrorMessage, NAME_INPUT_TEXT, promptName, suggestFolderCopyName } from '../models/nameInput';
import { FaPlay, FaPause, FaStop, FaSync, FaGlobe, FaUsers } from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';
import type { IGlobalCharacterPresetEntry } from '../models/GlobalCharacterPresetService';
import { saveJsonFile } from '../models/exportUtil';
import { syncFileName } from '../models/driveSync';
import { importGlobalCharacterPresetsText, importLocalCharacterPresetsText } from '../models/characterPresetImport';
import { interceptFileImportClick } from '../models/driveImport';
import { stringifyExportJson } from '../models/jsonExport';
import { FileUploadBase64 } from './UtilComponents';
import PromptEditTextArea from './PromptEditTextArea';
import ModalOverlay from './ModalOverlay';
import { useDrag, useDrop } from 'react-dnd';
import {
  makeSessionImageBackend,
  globalImageBackend,
  CharacterPresetCard,
  GlobalCharacterPresetCard,
} from './CharacterPresetCards';
import { CharacterPresetInnerEditor } from './CharacterPresetInnerEditor';
import { HelpPanelButton } from './HelpPanel';
import { SettingCheckRow } from './SettingControls';
import { CHARACTER_PRESET_HELP } from '../models/helpPanelTexts';
import { ListDragLockedHint, ListSearchBar } from './ListSearchBar';
import { hasQuery, matchesQuery } from '../models/listSearch';
import { deleteConfirmText } from '../models/deleteFlowRules';
import {
  addCharacterPresetRecorded,
  editCharacterPresets,
  instantiateGlobalCharacterPresetsRecorded,
} from '../models/presetUndo';
import { recordSceneTemplateImport } from '../models/sceneImportUndo';
import { UNDO_TEXT } from '../models/undoService';
import {
  createGlobalCharacterFolderRecorded,
  deleteGlobalCharacterFolderRecorded,
  renameGlobalCharacterFolderRecorded,
  renameGlobalCharacterRecorded,
  reorderGlobalCharactersRecorded,
  setGlobalCharacterFolderRecorded,
  setGlobalCharactersFolderRecorded,
} from '../models/globalLibraryUndo';
import { prepareGlobalDelete } from '../models/globalLibraryDeleteUndo';

// ─── 캐릭터 프리셋 내보내기/불러오기 ─────────────────────────

interface ExportedPresetData {
  version: 1;
  presets: (ICharacterPreset & {
    vibeImages?: { filename: string; data: string }[];
    referenceImages?: { filename: string; data: string }[];
    representativeImageData?: string;
  })[];
}

async function exportCharacterPresets(session: any) {
  const presets = session.getCharacterPresets() as CharacterPreset[];
  if (presets.length === 0) {
    appState.pushMessage('백업할 캐릭터 프리셋이 없습니다');
    return;
  }

  const exportData: ExportedPresetData = { version: 1, presets: [] };

  for (const preset of presets) {
    const json: any = preset.toJSON();

    // 바이브 이미지 데이터 포함
    json.vibeImages = [];
    for (const vibe of preset.vibes) {
      try {
        const path = imageService.getVibeImagePath(session, vibe.path);
        const data = await backend.readDataFile(path);
        json.vibeImages.push({ filename: vibe.path.split('/').pop()!, data });
      } catch (e) {}
    }

    // 레퍼런스 이미지 데이터 포함
    json.referenceImages = [];
    for (const ref of preset.characterReferences) {
      try {
        const path = imageService.getReferenceImagePath(session, ref.path);
        const data = await backend.readDataFile(path);
        json.referenceImages.push({ filename: ref.path.split('/').pop()!, data });
      } catch (e) {}
    }

    // 대표 이미지 데이터 포함
    if (preset.representativeImage) {
      try {
        const path = imageService.getVibeImagePath(session, preset.representativeImage);
        const data = await backend.readDataFile(path);
        json.representativeImageData = data;
      } catch (e) {}
    }

    exportData.presets.push(json);
  }

  try {
    await saveJsonFile(
      session.name + '_character_presets.json',
      stringifyExportJson(exportData),
    );
  } catch (e: any) {
    appState.pushMessage('백업 실패: ' + e.message);
    return;
  }
  appState.pushMessage(`캐릭터 프리셋 ${presets.length}개를 백업했습니다`);
}

// ─── 글로벌 캐릭터 프리셋 내보내기/불러오기 (PC↔모바일 크로스, 2026-07-18) ───
// 파일 형식은 로컬(ExportedPresetData v1)과 동일 — 직렬화/복원은 서비스가 담당
// (GlobalCharacterPresetService.exportToFileData/importFromFileData 참조).
// 로컬에서 내보낸 파일을 글로벌로, 글로벌 파일을 로컬로 교차 불러올 수 있다.

async function exportGlobalCharacterPresets() {
  const entries = globalCharacterPresetService.list();
  if (entries.length === 0) {
    appState.pushMessage('백업할 글로벌 캐릭터 프리셋이 없습니다');
    return;
  }
  try {
    const data = await globalCharacterPresetService.exportToFileData();
    // 파일명은 공용 규칙 sdstudio-character-presets-<날짜>.json (드라이브 동기화 ①,
    // 구 고정 이름 global_character_presets.json 은 불러오기에 그대로 쓸 수 있다).
    const result = await saveJsonFile(
      syncFileName('character-presets', new Date(), 'json'),
      stringifyExportJson(data),
      'character-presets',
    );
    if (result === 'cancelled') return;
  } catch (e: any) {
    appState.pushMessage('백업 실패: ' + e.message);
    return;
  }
  appState.pushMessage(`글로벌 캐릭터 프리셋 ${entries.length}개를 백업했습니다`);
}

// 텍스트 이후 단계는 models/characterPresetImport.ts(드라이브에서 받은 파일과 공용 — 드라이브 API ③).
async function importGlobalCharacterPresets(file: File) {
  await importGlobalCharacterPresetsText(await file.text());
}

// 프로젝트 로컬 캐릭터 프리셋 파일 불러오기 — 이름이 같은 항목은 공용 정책 흐름으로 묻는다
// (2026-11-16 M5 묶음 b R1-b, 종전 묻지 않고 「X (2)」). 본문은 models/characterPresetImport.ts.
async function importCharacterPresets(session: any, file: File) {
  await importLocalCharacterPresetsText(session, await file.text());
}

// ─── 글로벌 폴더 패널 행 (그리드 탐색기 NavItem 경량판, 2026-07-16 UX 개편) ───
//
// PC = 좌측 세로 목록 / 모바일 = 상단 가로 스크롤 (부모가 flex 방향 제어).
// 카드(react-dnd 'global-character-preset-card')를 행에 드롭하면 그 폴더로
// 이동한다. 편집 모드 = 행이 인라인 입력으로 전환 (드로어 폴더 이름변경 UX).
const GlobalFolderRow = observer(
  ({
    label,
    icon,
    count,
    active,
    onClick,
    droppable = false,
    dropFolder = null,
    onRename,
    onDelete,
    editing,
    editValue,
    onEditChange,
    onEditCommit,
    onEditCancel,
  }: {
    label: string;
    icon: React.ReactNode;
    count: number;
    active: boolean;
    onClick: () => void;
    // 카드 드롭 수락 여부 + 드롭 시 이동할 폴더 (null = 미분류)
    droppable?: boolean;
    dropFolder?: string | null;
    onRename?: () => void;
    onDelete?: () => void;
    editing?: boolean;
    editValue?: string;
    onEditChange?: (v: string) => void;
    onEditCommit?: () => void;
    onEditCancel?: () => void;
  }) => {
    const [{ isOver }, drop] = useDrop(
      () => ({
        accept: 'global-character-preset-card',
        drop: (item: { index: number }) => {
          const entry = globalCharacterPresetService.list()[item.index];
          // 되돌리기 전역 스택에 기록(2차 묶음 4 P5)
          if (entry) void setGlobalCharacterFolderRecorded(entry.id, dropFolder ?? null).catch(() => {});
        },
        collect: (m) => ({ isOver: m.isOver() }),
      }),
      [dropFolder],
    );
    if (editing) {
      return (
        <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm whitespace-nowrap flex-none md:w-full bg-[var(--c-surface)] ring-2 ring-purple-400">
          {icon}
          <input
            autoFocus
            data-esc-cancel
            value={editValue}
            onChange={(e) => onEditChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onEditCommit?.();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onEditCancel?.();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-24 md:w-auto md:flex-1 min-w-0 bg-transparent outline-none text-default text-sm"
          />
          <Tooltip content="저장">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditCommit?.();
              }}
              className="text-green-500 hover:text-green-600 px-0.5"
            >
              <FaCheck size={13} />
            </span>
          </Tooltip>
          <Tooltip content="취소">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditCancel?.();
              }}
              className="text-muted hover:text-gray-800 dark:hover:text-gray-200 px-0.5"
            >
              <FaTimes size={13} />
            </span>
          </Tooltip>
        </div>
      );
    }
    return (
      <div
        ref={droppable ? (drop as any) : undefined}
        className="flex-none md:w-full"
      >
        <button
          onClick={onClick}
          className={`group flex w-full items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
            droppable && isOver ? 'card-drop-target ' : ''
          }${active ? 'bg-purple-600 text-white dark:bg-purple-500' : 'btn-neutral text-body'}`}
        >
          {icon}
          <span className="truncate min-w-0 max-w-[7rem] md:max-w-none md:flex-1 text-left">
            {label}
          </span>
          <span
            className={`text-xs flex-none ${
              active ? 'text-purple-100' : 'text-faint'
            }`}
          >
            {count}
          </span>
          {onRename && (
            <Tooltip content="이름 변경">
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRename();
                }}
                className={`flex-none opacity-60 hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 ${
                  active ? 'text-white md:opacity-100' : 'hover:text-sky-500'
                }`}
              >
                <FaPen size={11} />
              </span>
            </Tooltip>
          )}
          {onDelete && (
            <Tooltip content="폴더 삭제">
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className={`flex-none opacity-60 hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 ${
                  active ? 'text-white md:opacity-100' : 'hover:text-red-500'
                }`}
              >
                <FaTrash size={11} />
              </span>
            </Tooltip>
          )}
        </button>
      </div>
    );
  },
);

// ─── 메인 프리셋 매니저 (목록/편집 전환) ───────────────────────
interface CharacterPresetEditorProps {
  onApplyPreset?: (preset: CharacterPreset, mode: 'easy' | 'character') => void;
  /** 안쪽 편집 폼의 미저장 판정을 바깥 창에 넘기는 자리(2026-10-03 E2-4, CharacterPresetInnerEditor.dirtyRef) */
  editDirtyRef?: React.MutableRefObject<(() => boolean) | null>;
}

// 캐릭터 프리셋 관리 화면 조각(2026-11-15 C-3, SPEC 「오버레이 창 크기 체계」 슬롯 규약 ⑥) — 래퍼가 ModalOverlay
// 슬롯에 넣는다. PC = xl 고정 높이: aside(로컬/글로벌 전환 + 폴더/프로젝트 행)·toolbar(모드·검색·파일 버튼, 선택 모드 둘째 줄)·
// body(카드 그리드 = 유일한 스크롤 / 순차 생성 = 「카드 | 설정」 두 칸)·footer([순차 생성 시작])·footerStart(요약).
// 안쪽 편집 중에는 body 만(bodyPadding 'none', 편집기 layout="frame" 이 자체 바닥줄을 그림).
// 모바일은 종전 한 열 그대로 body 하나(가로 폴더 줄·본문 안 버튼·JS 최소 높이).
export interface CharacterPresetPanel {
  toolbar?: React.ReactNode;
  aside?: React.ReactNode;
  body: React.ReactNode;
  footer?: React.ReactNode;
  footerStart?: React.ReactNode;
  bodyPadding: 'normal' | 'none';
}

export function useCharacterPresetPanel({
  onApplyPreset,
  editDirtyRef,
}: CharacterPresetEditorProps): CharacterPresetPanel {
  const { curSession } = appState;
  const [editingPreset, setEditingPreset] = useState<CharacterPreset | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editTarget, setEditTarget] = useState<'local' | 'global'>('local');
  const [editGlobalId, setEditGlobalId] = useState<string | null>(null);
  // 로컬/글로벌 뷰 전환 — 글로벌이 기본 화면(주종 역전, 2026-07-16 합의).
  // 로컬은 하위호환용 서브 뷰로 토글 진입.
  const [globalView, setGlobalView] = useState(true);
  // 글로벌 폴더 필터 (좌측 폴더 패널 — 1단계 평면):
  // '__all__' 전체 / '__unfiled__' 미분류 / 그 외 = 폴더 이름
  const [folderFilter, setFolderFilter] = useState<string>('__all__');
  // 목록 이름 검색(2026-11-14 M4) — 보기 전용, 로컬/글로벌 공용 한 칸(보기를 바꾸면 비움).
  // 글로벌은 지금 보이는 폴더 범위 안에서 거른다. 검색 중에는 카드 순서 드래그를 막는다.
  const [listQuery, setListQuery] = useState('');
  // 폴더 패널 인라인 편집 상태 (새 폴더 입력 / 폴더 이름 변경)
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderValue, setNewFolderValue] = useState('');
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editFolderValue, setEditFolderValue] = useState('');
  // 일괄 선택 모드 (카드 다중 선택 → 폴더 이동) — 순차 생성 모드와 배타
  const [selectMode, setSelectMode] = useState(false);
  const [, setGlobalVersion] = useState(0);
  useEffect(() => {
    const onChanged = () => setGlobalVersion((v) => v + 1);
    globalCharacterPresetService.addEventListener('changed', onChanged);
    return () =>
      globalCharacterPresetService.removeEventListener('changed', onChanged);
  }, []);
  // 순차 생성 모드
  const [cyclingMode, setCyclingMode] = useState(false);
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());
  const [selectedGlobalIds, setSelectedGlobalIds] = useState<Set<string>>(new Set());
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(new Set());
  const [cyclingSamples, setCyclingSamples] = useState(10);
  const [sceneFilter, setSceneFilter] = useState('');
  // 프로젝트 파일 생성 모드: 프리셋마다 현재 프로젝트를 복제해 새 프로젝트로 생성
  const [projectFileMode, setProjectFileMode] = useState(false);

  // 목록 높이 고정(모바일 전용 — 2026-11-15 C-3): 글로벌/로컬 전환·폴더 필터로 카드 수가 달라져도 지금까지
  // 본 것 중 가장 큰 높이를 minHeight 로 유지해 모달이 출렁이지 않게 한다.
  // (마운트 동안만 유효 — 모달을 닫으면 리셋, 창 크기 변경 시 재측정)
  // PC 는 래퍼가 xl 고정 높이라 재지 않는다(SPEC 높이 규칙 우선순위 — JS 측정 높이 금지, 모바일 기존 장치만 허용).
  const listRootRef = useRef<HTMLDivElement | null>(null);
  // 글로벌 [불러오기] 의 숨은 파일 입력 — 출처 선택 뒤 「파일」이면 이걸 눌러 선택기를 연다.
  const globalImportInputRef = useRef<HTMLInputElement | null>(null);
  const [minListHeight, setMinListHeight] = useState(0);
  useLayoutEffect(() => {
    if (!isMobile) return;
    const el = listRootRef.current;
    if (el && el.offsetHeight > minListHeight) {
      setMinListHeight(el.offsetHeight);
    }
  });
  useEffect(() => {
    if (!isMobile) return;
    const onResize = () => setMinListHeight(0);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 로컬 → 글로벌 일괄 복사 진행 중 (모두 글로벌로 보내기)
  const [bulkSending, setBulkSending] = useState(false);

  const cyclingState = cyclingSessionService.state;

  // ⚠ 아래 훅들은 !curSession 조기 return 앞에 있어야 한다 — 세션 유무가
  // 바뀔 때 훅 개수가 달라지면 React 훅 순서 오류(#300/#310)가 난다.
  const scenes = curSession ? Array.from(curSession.scenes.values()) : [];

  // 씬 필터링
  const filteredScenes = useMemo(() => {
    if (!sceneFilter.trim()) return scenes;
    const q = sceneFilter.toLowerCase();
    return scenes.filter((s) => s.name.toLowerCase().includes(q));
  }, [scenes, sceneFilter]);

  if (!curSession) {
    return {
      body: <div className="p-4 text-muted">세션을 선택해주세요</div>,
      bodyPadding: 'normal',
    };
  }

  const presets = curSession.getCharacterPresets();
  const isEasyMode = curSession.selectedWorkflow?.workflowType === 'SDImageGenEasy';

  // 순차 생성 모드 진입 시 모든 선택 해제 (기본값)
  // 글로벌 뷰에서는 프로젝트 파일 생성 모드를 기본 ON (요청 핵심 동작)
  // 일괄 선택 모드와 배타 — 진입 시 다른 쪽 해제.
  const enterCyclingMode = () => {
    setSelectMode(false);
    setCyclingMode(true);
    setSelectedPresets(new Set());
    setSelectedGlobalIds(new Set());
    setSelectedScenes(new Set());
    setSceneFilter('');
    setProjectFileMode(globalView);
  };

  const exitCyclingMode = () => {
    setCyclingMode(false);
    setSelectedPresets(new Set());
    setSelectedGlobalIds(new Set());
    setSelectedScenes(new Set());
    setSceneFilter('');
  };

  // 일괄 선택 모드 (로컬/글로벌 공통) — 카드 체크 다중 선택 후
  // 일괄 적용(캐릭터 프롬프트, W4 다중 적용) / 폴더 이동(글로벌 전용)
  const enterSelectMode = () => {
    if (cyclingMode) exitCyclingMode();
    setSelectMode(true);
    setSelectedGlobalIds(new Set());
    setSelectedPresets(new Set());
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedGlobalIds(new Set());
    setSelectedPresets(new Set());
  };

  const togglePresetSelection = (name: string) => {
    const next = new Set(selectedPresets);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedPresets(next);
  };

  const toggleGlobalSelection = (id: string) => {
    const next = new Set(selectedGlobalIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedGlobalIds(next);
  };

  const toggleSceneSelection = (name: string) => {
    const next = new Set(selectedScenes);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedScenes(next);
  };

  const selectedCyclingCount = globalView
    ? selectedGlobalIds.size
    : selectedPresets.size;

  const startCycling = () => {
    // 순차 생성은 큐 외 자체 상태 머신(세션 스왑 포함)이라 위임 범위 밖 — 1차 범위에선
    // 생성 호스트(주) 창에서만 시작 가능(W6 P3). 보조 창은 안내로 차단한다.
    if (!taskQueueService.isGenerationHost) {
      appState.pushMessage('순차 생성은 주 창에서 실행해주세요.');
      return;
    }
    const selectedSceneList = scenes.filter((s) => selectedScenes.has(s.name));
    // 현재 뷰에 따라 큐 항목(디스크립터) 구성
    const items = globalView
      ? globalEntries
          .filter((e) => selectedGlobalIds.has(e.id))
          .map((e) => ({
            kind: 'global' as const,
            name: e.name,
            preset: CharacterPreset.fromJSON(
              JSON.parse(JSON.stringify(e.preset)),
            ),
            globalId: e.id,
          }))
      : presets
          .filter((p) => selectedPresets.has(p.name))
          .map((p) => ({
            kind: 'local' as const,
            name: p.name,
            preset: p,
          }));
    if (items.length === 0) {
      appState.pushMessage('프리셋을 하나 이상 선택해주세요');
      return;
    }
    if (selectedSceneList.length === 0) {
      appState.pushMessage('씬을 하나 이상 선택해주세요');
      return;
    }
    cyclingSessionService.start(
      curSession,
      items,
      selectedSceneList,
      cyclingSamples,
      { projectFileMode },
    );
  };

  const handleAddNew = () => {
    const newPreset = new CharacterPreset();
    newPreset.name = '새 캐릭터 프리셋';
    setEditTarget('local');
    setEditGlobalId(null);
    setEditingPreset(newPreset);
    setIsNew(true);
  };

  const handleEdit = (preset: CharacterPreset) => {
    const copy = CharacterPreset.fromJSON(preset.toJSON());
    setEditTarget('local');
    setEditGlobalId(null);
    setEditingPreset(copy);
    setIsNew(false);
  };

  const handleAddNewGlobal = () => {
    const newPreset = new CharacterPreset();
    newPreset.name = '새 글로벌 프리셋';
    setEditTarget('global');
    setEditGlobalId(null);
    setEditingPreset(newPreset);
    setIsNew(true);
  };

  const handleEditGlobal = (entry: IGlobalCharacterPresetEntry) => {
    const copy = CharacterPreset.fromJSON(
      JSON.parse(JSON.stringify(entry.preset)),
    );
    setEditTarget('global');
    setEditGlobalId(entry.id);
    setEditingPreset(copy);
    setIsNew(false);
  };

  const handleSave = async (preset: CharacterPreset) => {
    if (editTarget === 'global') {
      try {
        if (isNew) {
          await globalCharacterPresetService.addPresetObject(preset);
        } else if (editGlobalId) {
          await globalCharacterPresetService.updateEntry(editGlobalId, preset);
        }
      } catch (e: any) {
        // 실패하면 편집 폼을 닫지 않는다(입력 보존 — D2)
        appState.pushMessage(
          nameErrorMessage(e, 'characterPreset', preset.name, '글로벌 프리셋 저장 실패'),
          'error',
        );
        return;
      }
    } else {
      // 되돌리기(U3b): 로컬 저장만 기록(글로벌 저장은 전역 라이브러리 — 보류). 편집 중 올린 이미지 파일은 남는다(무해)
      if (isNew) {
        // 같은 이름이면 「X1」로 들어간다 — 라벨도 그 이름으로(M1 U2)
        addCharacterPresetRecorded(curSession, preset, UNDO_TEXT.characterPresetAdd);
      } else {
        // 이름을 다른 로컬 프리셋 이름으로 바꾸면 updateCharacterPreset 이 그 프리셋을 조용히 덮어쓴다 —
        // 저장 전에 거부하고 폼을 유지한다(D2, updateCharacterPreset 자체는 그대로).
        const oldName = editingPreset!.name;
        if (preset.name !== oldName && curSession.hasCharacterPreset(preset.name)) {
          appState.pushMessage(
            NAME_INPUT_TEXT.duplicate('characterPreset', preset.name),
            'error',
          );
          return;
        }
        editCharacterPresets(curSession, UNDO_TEXT.characterPresetSave(preset.name), () =>
          curSession.updateCharacterPreset(oldName, preset),
        );
      }
    }
    setEditingPreset(null);
    setIsNew(false);
    setEditGlobalId(null);
  };

  const handleCancel = () => {
    setEditingPreset(null);
    setIsNew(false);
    setEditGlobalId(null);
  };

  // 글로벌 프리셋 삭제 확인 창의 덧붙임 줄 — 단건·여러 개 공통
  const GLOBAL_PRESET_DELETE_EXTRA = '첨부 이미지도 함께 삭제되며, 모든 프로젝트에 영향을 줍니다.';

  const handleDelete = (preset: CharacterPreset) => {
    appState.pushDialog({
      type: 'confirm',
      // 로컬 프리셋은 휴지통 없이 바로 사라진다 — Enter 무시(2026-10-03 E1). editCharacterPresets 기록으로 되돌리기 가능(2026-11-15)
      ...deleteConfirmText({ kind: 'characterPreset', name: preset.name, outcome: 'undoable' }),
      callback: () => {
        // 해제 + 삭제 = 1항목(되돌리면 프리셋과 적용 항목이 함께 돌아온다 — U3b)
        editCharacterPresets(curSession, UNDO_TEXT.characterPresetRemove([preset.name]), () => {
          // 삭제하려는 프리셋이 현재 적용 중이면 먼저 해제 (해당 프리셋만 — W4 다중 적용)
          if (appState.appliedCharacterPresetNames.includes(preset.name)) {
            appState.removeAppliedCharacterPreset(preset.name);
          }
          curSession.removeCharacterPreset(preset.name);
        });
      },
    });
  };

  const handleDuplicate = (preset: CharacterPreset) => {
    const copy = CharacterPreset.fromJSON(preset.toJSON());
    // 복제 이름 단일 규칙(2026-11-14 M2 C4) — 「X 복사본」→「X 복사본 (2)」. 현재 로컬 목록과 대조해 빈 이름을 넘기므로
    // Session.addCharacterPreset 의 공백 없는 숫자 접미(「X 복사본1」)는 걸리지 않는다
    copy.name = suggestFolderCopyName(preset.name, (n) => curSession.hasCharacterPreset(n));
    // 복제본은 독립 로컬 — 글로벌 유래 링크를 끊어 원본만 재적용 갱신 대상으로 유지
    copy.fromGlobalId = '';
    copy.fromGlobalRev = 0;
    // 라벨은 실제 이름으로(M1 U1)
    addCharacterPresetRecorded(curSession, copy, UNDO_TEXT.characterPresetDuplicate);
  };

  const handleApplyEasy = (preset: CharacterPreset) => {
    if (onApplyPreset) onApplyPreset(preset, 'easy');
  };

  const handleApplyCharacter = (preset: CharacterPreset) => {
    if (onApplyPreset) onApplyPreset(preset, 'character');
  };

  // 일괄 적용 (선택 모드): 선택한 프리셋들을 캐릭터 프롬프트로 순서대로 추가
  // 적용 (W4 다중 적용 — 기존 적용·수동 항목은 유지). 글로벌은 단건 적용과
  // 동일하게 먼저 프로젝트로 불러온(이미지 복사) 뒤 적용한다. 토스트 1회.
  const bulkApplyCharacter = async () => {
    if (globalView) {
      const entries = globalEntries.filter((e) => selectedGlobalIds.has(e.id));
      if (entries.length === 0) return;
      // 되돌리기(U3b): 프로젝트로 복사 + 적용 = 1항목(복사한 이미지 파일은 남김). 라벨은 실제 로컬 이름(M1 U5)
      const { failures } = await instantiateGlobalCharacterPresetsRecorded(
        curSession,
        entries,
        (id) => globalCharacterPresetService.instantiateIntoSession(curSession, id),
        UNDO_TEXT.characterPresetApply,
        (locals) => appState.applyCharacterPresets(locals),
      );
      for (const { entry: e, error: err } of failures) {
        appState.pushMessage(
          err?.message || `"${e.name}"을(를) 프로젝트로 복사하지 못했습니다`,
        );
      }
    } else {
      appState.applyCharacterPresets(
        presets.filter((p) => selectedPresets.has(p.name)),
      );
    }
    exitSelectMode();
  };

  // ─── 글로벌 캐릭터 프리셋 ───
  const handleCopyToGlobal = async (preset: CharacterPreset) => {
    try {
      await globalCharacterPresetService.addFromSessionPreset(curSession, preset);
      appState.pushMessage(`"${preset.name}"을(를) 글로벌로 복사했습니다`);
    } catch (e: any) {
      appState.pushMessage(e.message || '글로벌 복사에 실패했습니다');
    }
  };

  // 로컬 → 글로벌 일괄 복사 (무파괴 승격 — 원본 유지, 중복 이름은 「X (2)」 접미, M2 K7)
  const handleSendAllToGlobal = () => {
    appState.pushDialog({
      type: 'confirm',
      text: `로컬 프리셋 ${presets.length}개를 모두 글로벌로 복사할까요?\n(원본은 유지되며, 중복 이름에는 (2) 같은 번호가 붙습니다)`,
      callback: async () => {
        setBulkSending(true);
        let ok = 0;
        let fail = 0;
        try {
          for (const p of curSession.getCharacterPresets()) {
            try {
              await globalCharacterPresetService.addFromSessionPreset(
                curSession,
                p,
              );
              ok++;
            } catch (e) {
              fail++;
            }
          }
        } finally {
          setBulkSending(false);
        }
        appState.pushMessage(
          fail > 0
            ? `${ok}개를 글로벌로 복사했습니다 (${fail}개 실패)`
            : `${ok}개를 글로벌로 복사했습니다`,
        );
      },
    });
  };

  const handleLoadGlobal = async (entry: IGlobalCharacterPresetEntry) => {
    // 되돌리기(U3b): 로컬 사본 추가·갱신 = 1항목(글로벌 쪽은 그대로, 복사한 이미지 파일은 남김)
    // 라벨·토스트 모두 실제 로컬 이름(겹치면 「X (글로벌)」 — M1 U3)
    const { presets, failures } = await instantiateGlobalCharacterPresetsRecorded(
      curSession,
      [entry],
      (id) => globalCharacterPresetService.instantiateIntoSession(curSession, id),
      (names) => UNDO_TEXT.characterPresetFromGlobal(names.length, names[0]),
    );
    if (presets.length > 0) {
      appState.pushMessage(`"${presets[0].name}"을(를) 프로젝트로 복사했습니다`);
    } else {
      appState.pushMessage(failures[0]?.error?.message || '프로젝트로 복사하지 못했습니다');
    }
  };

  const handleRenameGlobal = async (entry: IGlobalCharacterPresetEntry) => {
    // 현재 이름을 채워 연다 — 다른 글로벌 캐릭터 프리셋과 겹치면 창 안에서 거부(D2)
    const v = await promptName({
      title: '새 글로벌 프리셋 이름을 입력해주세요',
      kind: 'characterPreset',
      current: entry.name,
      existing: (n) => {
        const other = globalCharacterPresetService.getByName(n);
        return !!other && other.id !== entry.id;
      },
    });
    if (!v) return;
    try {
      await renameGlobalCharacterRecorded(entry.id, v);
    } catch (e: any) {
      appState.pushMessage(
        nameErrorMessage(e, 'characterPreset', v, '이름 변경에 실패했습니다'),
        'error',
      );
    }
  };

  const handleDeleteGlobal = async (entry: IGlobalCharacterPresetEntry) => {
    // 되돌리기(Ctrl+Z)로 되살아난다(2026-11-18) — 첨부 이미지 내용을 확인 창 전에 보관. 보관 한도를 넘거나 기록할 수 없으면 영구 문구
    let plan;
    try {
      plan = await prepareGlobalDelete('characters', [entry.id]);
    } catch (e: any) {
      appState.pushMessage(e?.message || '삭제하지 못했습니다');
      return;
    }
    appState.pushDialog({
      type: 'confirm',
      ...deleteConfirmText({
        kind: 'globalPreset',
        name: entry.name,
        outcome: plan.undoable ? 'undoable' : 'permanent',
        extra: GLOBAL_PRESET_DELETE_EXTRA,
      }),
      callback: async () => {
        const r = await plan.run();
        if (r.failed.length > 0) appState.pushMessage(r.failed[0].error || '삭제하지 못했습니다');
      },
    });
  };

  // 선택 모드 일괄 삭제. 단건 삭제와 동일한 서비스 경로를 사용해 글로벌
  // 첨부 이미지 정리와 로컬 적용 상태 해제를 빠뜨리지 않는다.
  const handleDeleteSelected = async () => {
    const count = globalView
      ? selectedGlobalIds.size
      : selectedPresets.size;
    if (count === 0) return;
    // 글로벌 선택 삭제 = 되돌리기 한 항목(2026-11-18). 이미지 내용을 확인 창 전에 보관(한도 초과·기록 불가면 영구 문구)
    const globalIds = Array.from(selectedGlobalIds);
    let plan: Awaited<ReturnType<typeof prepareGlobalDelete>> | undefined;
    if (globalView) {
      try {
        plan = await prepareGlobalDelete('characters', globalIds);
      } catch (e: any) {
        appState.pushMessage(e?.message || '삭제하지 못했습니다');
        return;
      }
    }

    appState.pushDialog({
      type: 'confirm',
      // 글로벌·로컬 모두 휴지통 없이 바로 사라진다 — Enter 무시(2026-10-03 E1). 글로벌 = 첨부 이미지 내용을 기록에 담아
      // 되돌리기 가능(2026-11-18, 한도 초과면 영구), 로컬 = editCharacterPresets 기록 → 되돌리기 가능(2026-11-15)
      ...(globalView
        ? deleteConfirmText({
            kind: 'globalPreset',
            count,
            outcome: plan?.undoable ? 'undoable' : 'permanent',
            extra: GLOBAL_PRESET_DELETE_EXTRA,
          })
        : deleteConfirmText({
            kind: 'characterPreset',
            count,
            outcome: 'undoable',
            extra: '현재 프로젝트의 로컬 프리셋입니다.',
          })),
      callback: async () => {
        if (globalView && plan) {
          const ids = globalIds;
          const r = await plan.run();
          const failed = new Set<string>(r.failed.map((f) => f.id));
          setSelectedGlobalIds(failed);
          if (failed.size > 0) {
            appState.pushMessage(
              `${ids.length - failed.size}개를 삭제하고 ${failed.size}개는 삭제하지 못했습니다`,
            );
          } else {
            appState.pushMessage(`${ids.length}개 글로벌 프리셋을 삭제했습니다`);
          }
          return;
        }

        const names = Array.from(selectedPresets);
        editCharacterPresets(curSession, UNDO_TEXT.characterPresetRemove(names), () => {
          appState.removeAppliedCharacterPresets(names);
          for (const name of names) curSession.removeCharacterPreset(name);
        });
        setSelectedPresets(new Set());
        appState.pushMessage(`${names.length}개 로컬 프리셋을 삭제했습니다`);
      },
    });
  };

  const handleDuplicateGlobal = (entry: IGlobalCharacterPresetEntry) => {
    globalCharacterPresetService.duplicateEntry(entry.id);
  };

  // 글로벌 프리셋 적용: 현재 프로젝트로 자동 불러온 뒤(이미지 복사) 적용
  const handleApplyGlobal = async (
    entry: IGlobalCharacterPresetEntry,
    mode: 'easy' | 'character',
  ) => {
    // 되돌리기(U3b): 프로젝트로 복사 + 적용 = 1항목
    // 라벨·토스트 모두 실제 로컬 이름(M1 U4)
    try {
      const { presets, failures } = await instantiateGlobalCharacterPresetsRecorded(
        curSession,
        [entry],
        (id) => globalCharacterPresetService.instantiateIntoSession(curSession, id),
        UNDO_TEXT.characterPresetApply,
        (locals) => {
          if (locals[0] && onApplyPreset) onApplyPreset(locals[0], mode);
        },
      );
      if (presets.length > 0) {
        appState.pushMessage(`"${presets[0].name}"을(를) 프로젝트로 복사해 적용했습니다`);
      } else {
        appState.pushMessage(failures[0]?.error?.message || '적용에 실패했습니다');
      }
    } catch (e: any) {
      appState.pushMessage(e.message || '적용에 실패했습니다');
    }
  };

  // ─── 글로벌 폴더 (1단계 평면, 좌측 패널) ───

  // 폴더 선택 다이얼로그 (단건 이동·일괄 이동 공용).
  // 반환: undefined = 취소 / null = 미분류 / string = 폴더 이름.
  // 'f:' 접두로 폴더 이름과 예약 값('__new__' 등)의 충돌을 차단한다.
  const pickFolderTarget = async (
    text: string,
    showRoot: boolean,
  ): Promise<string | null | undefined> => {
    const folders = globalCharacterPresetService.listFolders();
    const items = [
      ...folders.map((f) => ({ text: `📁 ${f}`, value: 'f:' + f })),
      { text: '➕ 새 폴더...', value: '__new__' },
      ...(showRoot ? [{ text: '📂 미분류로 이동', value: '__root__' }] : []),
    ];
    const v = await appState.pushDialogAsync({ type: 'select', text, items });
    if (!v) return undefined;
    if (v === '__new__') {
      // 이미 있는 폴더 이름이면 그 폴더로 옮긴다(기존 동작) — 빈 값만 창 안에서 거부
      const name = await promptName({
        title: '새 폴더 이름을 입력해주세요',
        kind: 'folder',
      });
      if (!name) return undefined;
      return name;
    }
    if (v === '__root__') return null;
    return v.slice(2);
  };

  const handleMoveToFolder = async (entry: IGlobalCharacterPresetEntry) => {
    const target = await pickFolderTarget(
      `"${entry.name}"을(를) 어느 폴더로 이동할까요?`,
      !!entry.folder,
    );
    if (target === undefined) return;
    try {
      await setGlobalCharacterFolderRecorded(entry.id, target);
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 이동에 실패했습니다');
    }
  };

  // 일괄 선택 모드: 선택한 카드들을 한 번에 폴더로 이동 (이동 후 선택 해제)
  const bulkMoveToFolder = async () => {
    const ids = Array.from(selectedGlobalIds);
    if (ids.length === 0) return;
    const target = await pickFolderTarget(
      `선택한 ${ids.length}개를 어느 폴더로 이동할까요?`,
      true,
    );
    if (target === undefined) return;
    try {
      // 한 동작 = 되돌리기 한 항목(2차 묶음 4 P5)
      await setGlobalCharactersFolderRecorded(ids, target);
      appState.pushMessage(
        target
          ? `${ids.length}개를 "${target}" 폴더로 이동했습니다`
          : `${ids.length}개를 미분류로 이동했습니다`,
      );
      setSelectedGlobalIds(new Set());
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 이동에 실패했습니다');
    }
  };

  // 패널: 새 폴더 인라인 입력 확정 (생성 후 그 폴더를 바로 선택)
  const commitNewFolder = async () => {
    const name = newFolderValue.trim();
    if (!name) {
      setNewFolderMode(false);
      return;
    }
    try {
      const created = await createGlobalCharacterFolderRecorded(name);
      setFolderFilter(created);
      setNewFolderMode(false);
      setNewFolderValue('');
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 생성에 실패했습니다');
    }
  };

  // 패널: 폴더 이름 인라인 변경 확정
  const commitFolderRename = async () => {
    const oldName = editingFolder;
    if (!oldName) return;
    const newName = editFolderValue.trim();
    if (!newName || newName === oldName) {
      setEditingFolder(null);
      return;
    }
    try {
      await renameGlobalCharacterFolderRecorded(oldName, newName);
      // 현재 필터가 이 폴더였으면 새 이름을 따라간다
      setFolderFilter((prev) => (prev === oldName ? newName : prev));
      setEditingFolder(null);
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 이름 변경에 실패했습니다');
    }
  };

  // 패널: 폴더 삭제 (소속 프리셋은 미분류로 이동)
  const handleDeleteFolder = (folder: string) => {
    const count = globalCharacterPresetService
      .list()
      .filter((e) => e.folder === folder).length;
    appState.pushDialog({
      type: 'confirm',
      // 공용 삭제 문구(2026-11-15) — deleteGlobalCharacterFolderRecorded 기록으로 되돌리기 가능(폴더·소속 복귀)
      ...deleteConfirmText({
        kind: 'folder',
        name: folder,
        outcome: 'undoable',
        extra: `소속 프리셋 ${count}개는 미분류로 이동합니다.`,
      }),
      callback: async () => {
        await deleteGlobalCharacterFolderRecorded(folder);
        setFolderFilter((prev) => (prev === folder ? '__all__' : prev));
      },
    });
  };

  const globalEntries = globalCharacterPresetService.list();
  const globalFolders = globalCharacterPresetService.listFolders();
  // 필터 대상 폴더가 소멸(항목 전부 이동)했으면 전체로 폴백
  const effectiveFolderFilter =
    folderFilter === '__all__' ||
    folderFilter === '__unfiled__' ||
    globalFolders.includes(folderFilter)
      ? folderFilter
      : '__all__';
  const visibleGlobalEntries =
    effectiveFolderFilter === '__all__'
      ? globalEntries
      : globalEntries.filter((e) =>
          effectiveFolderFilter === '__unfiled__'
            ? !e.folder
            : e.folder === effectiveFolderFilter,
        );
  // 검색 적용(2026-11-14 M4) — 「전체 선택」·순차 생성 개수도 이 보이는 목록 기준
  const listSearching = hasQuery(listQuery);
  const shownGlobalEntries = visibleGlobalEntries.filter((e) =>
    matchesQuery(e.name, listQuery),
  );
  const shownPresets = presets.filter((p) => matchesQuery(p.name, listQuery));
  // 「전체 선택/해제」 = 보이는 항목만 토글 — 폴더 필터·검색으로 숨은 항목의 선택은 유지
  const allShownSelected = globalView
    ? shownGlobalEntries.length > 0 &&
      shownGlobalEntries.every((e) => selectedGlobalIds.has(e.id))
    : shownPresets.length > 0 &&
      shownPresets.every((p) => selectedPresets.has(p.name));
  const toggleSelectAllShown = () => {
    if (globalView) {
      const next = new Set(selectedGlobalIds);
      shownGlobalEntries.forEach((e) =>
        allShownSelected ? next.delete(e.id) : next.add(e.id),
      );
      setSelectedGlobalIds(next);
    } else {
      const next = new Set(selectedPresets);
      shownPresets.forEach((p) =>
        allShownSelected ? next.delete(p.name) : next.add(p.name),
      );
      setSelectedPresets(next);
    }
  };
  // 이름 검색 줄(모바일 — 본문 안. PC 는 도구줄 안 compact)
  const listSearchBar = (total: number, shown: number) => (
    <div className="mb-3">
      <ListSearchBar
        query={listQuery}
        onQueryChange={setListQuery}
        placeholder="프리셋 이름 검색"
        shown={shown}
        total={total}
      />
      {listSearching && <ListDragLockedHint className="mt-1" />}
    </div>
  );

  // PC(2026-11-15 C-3) = 슬롯 배치(xl 고정 높이), 모바일 = 종전 한 열(body 하나)
  const wide = !isMobile;

  // 로컬/글로벌 보기 전환 — 모드·검색을 비우고 바꾼다(PC aside 분할 버튼·모바일 토글 공용). 같은 보기면 무동작.
  const switchView = (toGlobal: boolean) => {
    if (toGlobal === globalView) return;
    if (cyclingMode) exitCyclingMode();
    if (selectMode) exitSelectMode();
    setListQuery('');
    setGlobalView(toGlobal);
  };

  // 편집 모드 — PC 는 안쪽 편집기가 창 본문을 채우는 frame 배치(돌아가기 줄 · 두 열 · 자체 바닥줄),
  // 도구줄·aside·바닥줄은 주지 않는다. 모바일은 종전 인라인 폼.
  if (editingPreset) {
    return {
      body: (
        <CharacterPresetInnerEditor
          preset={editingPreset}
          onSave={handleSave}
          onCancel={handleCancel}
          isNew={isNew}
          dirtyRef={editDirtyRef}
          layout={wide ? 'frame' : 'inline'}
          imageBackend={
            editTarget === 'global'
              ? globalImageBackend
              : makeSessionImageBackend(curSession)
          }
        />
      ),
      bodyPadding: wide ? 'none' : 'normal',
    };
  }

  // 순회 진행 중 상태 표시 — 고정 높이 본문 안에 그대로(슬롯 없음, [중단] 은 패널 안)
  if (cyclingState === 'running' || cyclingState === 'paused') {
    return {
      bodyPadding: 'normal',
      body: (
      <div className="text-default">
        <div className="p-4 border border-sky-300 dark:border-sky-600 rounded-lg bg-sky-50 dark:bg-sky-900/20">
          <div className="flex items-center gap-2 mb-3">
            <FaSync className={`text-sky-500 ${cyclingState === 'running' ? 'animate-spin' : ''}`} />
            <span className="text-base font-medium text-sky-700 dark:text-sky-300">
              {cyclingState === 'running' ? '순차 생성 진행 중' : '순차 생성 일시정지'}
            </span>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
            현재: <span className="font-medium">{cyclingSessionService.currentPresetName}</span>
            {' '}({cyclingSessionService.completedPresets + 1}/{cyclingSessionService.totalPresets})
          </div>
          {/* 진행률 바 */}
          <div className="w-full h-2 bg-[var(--c-surface)] rounded-full mb-3">
            <div
              className="h-full bg-sky-500 rounded-full transition-all"
              style={{ width: `${(cyclingSessionService.completedPresets / cyclingSessionService.totalPresets) * 100}%` }}
            />
          </div>
          {/* 남은 프리셋 목록 */}
          {cyclingSessionService.remainingPresets.length > 0 && (
            <div className="text-xs text-muted mb-3">
              남은 프리셋: {cyclingSessionService.remainingPresets.map((p) => p.name).join(', ')}
            </div>
          )}
          {/* 컨트롤 버튼 */}
          <div className="flex gap-2">
            {cyclingState === 'running' ? (
              <button
                className="px-4 py-1.5 rounded-lg btn-solid-yellow text-sm font-medium transition-colors flex items-center gap-1.5"
                onClick={() => {
                  taskQueueService.stop();
                }}
              >
                <FaPause size={10} />
                일시정지
              </button>
            ) : (
              <button
                className="px-4 py-1.5 rounded-lg btn-solid-green text-sm font-medium transition-colors flex items-center gap-1.5"
                onClick={() => cyclingSessionService.resume()}
              >
                <FaPlay size={10} />
                재개
              </button>
            )}
            <button
              className="px-4 py-1.5 rounded-lg btn-solid-red text-sm font-medium transition-colors flex items-center gap-1.5"
              onClick={() => {
                taskQueueService.stop();
                cyclingSessionService.cancel();
              }}
            >
              <FaStop size={10} />
              중단
            </button>
          </div>
        </div>
      </div>
      ),
    };
  }

  // ─── 카드 그리드 모드 — 조각 ───

  // 로컬/글로벌 전환 토글(모바일 — 종전 한 버튼, 누르면 반대 보기)
  const mobileViewToggle = (
    <button
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
        globalView
          ? 'bg-purple-600 text-white dark:bg-purple-500'
          : 'btn-neutral text-body'
      }`}
      onClick={() => switchView(!globalView)}
    >
      {globalView ? <FaGlobe size={12} /> : <FaUsers size={12} />}
      {globalView ? '글로벌' : '로컬'}
    </button>
  );

  // 로컬/글로벌 분할 버튼(PC aside 맨 위 — 선례 프롬프트조각 aside 의 로컬/전역 전환).
  // 택일 묶음 .seg-group(UI 정돈 그룹 2-c — 프롬프트조각 전환과 같은 모양). 선택 표시 = 로컬 .seg-on(하늘)·
  // 글로벌 .seg-on-purple(솔리드 보라 — 뜻 구분). aside 전체 폭은 .seg-fill 로 칸이 나눠 채운다.
  const asideViewToggle = (
    <div className="seg-group seg-fill flex" role="group" aria-label="프리셋 보기" data-character-view-toggle="">
      <button
        aria-pressed={!globalView}
        className={'seg-item text-sm' + (!globalView ? ' seg-on' : '')}
        onClick={() => switchView(false)}
      >
        <FaUsers size={12} />
        로컬
      </button>
      <button
        aria-pressed={globalView}
        className={'seg-item text-sm' + (globalView ? ' seg-on-purple' : '')}
        onClick={() => switchView(true)}
      >
        <FaGlobe size={12} />
        글로벌
      </button>
    </div>
  );

  // [순차 생성 모드][선택]
  const modeButtons = (
    <>
      {(globalView ? globalEntries.length >= 2 : presets.length >= 2) && (
        <button
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
            cyclingMode
              ? (globalView ? 'bg-purple-600 text-white dark:bg-purple-500' : 'bg-sky-600 text-white dark:bg-sky-500')
              : 'btn-neutral text-body'
          }`}
          onClick={() => cyclingMode ? exitCyclingMode() : enterCyclingMode()}
        >
          <FaSync size={11} />
          {cyclingMode ? '순차 생성 모드 끄기' : '순차 생성 모드'}
        </button>
      )}
      {/* 일괄 선택 → 일괄 적용(양 뷰) / 폴더 이동(글로벌) — 순차 생성과 배타 */}
      {(globalView ? globalEntries.length > 0 : presets.length > 0) && (
        <button
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
            selectMode
              ? globalView
                ? 'bg-purple-600 text-white dark:bg-purple-500'
                : 'bg-sky-600 text-white dark:bg-sky-500'
              : 'btn-neutral text-body'
          }`}
          onClick={() => (selectMode ? exitSelectMode() : enterSelectMode())}
        >
          <FaCheckSquare size={11} />
          {selectMode ? '선택 모드 끄기' : '선택'}
        </button>
      )}
    </>
  );

  // [모두 글로벌로 복사](로컬)·[백업]·[백업 불러오기]·도움말 — 명칭 규칙(2026-11-16 M5 묶음 b R1):
  // 목록 전부를 한 파일로 = 「백업」, 그 파일 들여오기 = 「백업 불러오기」(아이콘 backup / import)
  const fileButtons = (
    <>
      {!globalView && presets.length > 0 && (
        <Tooltip content="모든 로컬 프리셋을 글로벌로 복사 (원본 유지)">
          <button
            className="px-3 py-1.5 rounded-lg text-sm btn-neutral text-body transition-colors flex items-center gap-1.5 disabled:opacity-50"
            disabled={bulkSending}
            onClick={handleSendAllToGlobal}
          >
            <ActionIcon id="copy-to-global" size={11} />
            {bulkSending ? '복사하는 중...' : '모두 글로벌로 복사'}
          </button>
        </Tooltip>
      )}
      {!globalView && presets.length > 0 && (
        <Tooltip content="이 프로젝트의 캐릭터 프리셋 전체를 한 파일로 백업">
          <button
            className="px-3 py-1.5 rounded-lg text-sm btn-neutral text-body transition-colors flex items-center gap-1.5 whitespace-nowrap"
            onClick={() => exportCharacterPresets(curSession)}
          >
            <ActionIcon id="backup" size={11} />
            백업
          </button>
        </Tooltip>
      )}
      {!globalView && (
        <Tooltip content="백업 파일에서 캐릭터 프리셋 불러오기 (동명 처리 선택, 글로벌 백업 파일도 가능)">
          <label className="px-3 py-1.5 rounded-lg text-sm btn-neutral text-body transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
            <ActionIcon id="import" size={11} />
            백업 불러오기
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  await importCharacterPresets(curSession, file);
                  e.target.value = '';
                }
              }}
            />
          </label>
        </Tooltip>
      )}
      {/* 글로벌 백업/백업 불러오기 — PC↔모바일 크로스 작업 이동용.
          파일 형식이 로컬과 동일해 로컬 백업 파일도 불러올 수 있다. */}
      {globalView && globalEntries.length > 0 && (
        <Tooltip content="글로벌 캐릭터 프리셋 전체를 한 파일로 백업">
          <button
            className="px-3 py-1.5 rounded-lg text-sm btn-neutral text-body transition-colors flex items-center gap-1.5 whitespace-nowrap"
            onClick={exportGlobalCharacterPresets}
          >
            <ActionIcon id="backup" size={11} />
            백업
          </button>
        </Tooltip>
      )}
      {globalView && (
        <Tooltip content="백업 파일에서 글로벌 캐릭터 프리셋 불러오기 (동명 처리 선택, 로컬 백업 파일도 가능)">
          {/* PC 에서 Google 드라이브에 연결돼 있으면 출처([Google 드라이브 / 파일])를 먼저 묻는다
              (드라이브 API ③). Android·미연결은 기존처럼 바로 파일 선택기. */}
          <label
            className="px-3 py-1.5 rounded-lg text-sm btn-neutral text-body transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            onClick={(e) =>
              interceptFileImportClick(e, globalImportInputRef.current, 'character-presets')
            }
          >
            <ActionIcon id="import" size={11} />
            백업 불러오기
            <input
              ref={globalImportInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  await importGlobalCharacterPresets(file);
                  e.target.value = '';
                }
              }}
            />
          </label>
        </Tooltip>
      )}
      {/* 도움말은 행 맨 끝 고정 (버튼 사이 배치가 어색하다는 피드백) */}
      {/* 2026-11-20 그룹 1-b: 3줄 툴팁 → 누르면 열리는 짧은 패널(문구 = models/helpPanelTexts.ts) */}
      <HelpPanelButton data={CHARACTER_PRESET_HELP} width={380} />
    </>
  );

  // 일괄 선택 액션 바 — 다중 선택 후 일괄 적용(양 뷰) / 폴더 이동(글로벌). PC = 도구줄 둘째 줄, 모바일 = 본문 안
  const selectionBar = (className: string) => (
    <div className={className} data-character-selection-bar="">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {(globalView ? selectedGlobalIds.size : selectedPresets.size)}개
        선택
      </span>
      <button
        className="text-xs btn-link"
        onClick={toggleSelectAllShown}
      >
        {allShownSelected ? '전체 해제' : '전체 선택'}
      </button>
      <Tooltip content="선택한 프리셋을 캐릭터 프롬프트로 일괄 적용 (기존 적용에 추가)">
        <button
          className="px-3 py-1 rounded-lg text-xs font-medium btn-solid-yellow"
          disabled={
            (globalView ? selectedGlobalIds.size : selectedPresets.size) ===
            0
          }
          onClick={bulkApplyCharacter}
        >
          <FaUserAlt className="inline mr-1" size={10} />
          선택 적용
        </button>
      </Tooltip>
      {globalView && (
        <button
          className="px-3 py-1 rounded-lg text-xs font-medium btn-solid-purple"
          disabled={selectedGlobalIds.size === 0}
          onClick={bulkMoveToFolder}
        >
          <FaFolder className="inline mr-1" size={10} />
          폴더로 이동
        </button>
      )}
      <button
        className="px-3 py-1 rounded-lg text-xs btn-neutral text-body"
        disabled={
          (globalView ? selectedGlobalIds.size : selectedPresets.size) === 0
        }
        onClick={() => {
          setSelectedGlobalIds(new Set());
          setSelectedPresets(new Set());
        }}
      >
        선택 해제
      </button>
      <button
        className="px-3 py-1 rounded-lg text-xs font-medium btn-solid-red disabled:opacity-50"
        disabled={
          (globalView ? selectedGlobalIds.size : selectedPresets.size) === 0
        }
        onClick={handleDeleteSelected}
      >
        <FaTrash className="inline mr-1" size={10} />
        선택 삭제
      </button>
    </div>
  );

  // 프리셋 선택 바 (순차 생성 모드): 실제 선택 카드 바로 위에 두어 조작 위치를 일치시킴
  const cyclingSelectBar = (className: string) => (
    <div className={className}>
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        프리셋 선택 (
        {globalView ? selectedGlobalIds.size : selectedPresets.size}/
        {globalView ? shownGlobalEntries.length : shownPresets.length})
      </span>
      <button
        onClick={toggleSelectAllShown}
        className="text-xs btn-link"
      >
        {allShownSelected ? '전체 해제' : '전체 선택'}
      </button>
    </div>
  );

  // 글로벌 폴더 행(전체·미분류·폴더들·[＋ 새 폴더]) — PC aside 세로 목록 / 모바일 가로 줄(부모가 방향 결정)
  const folderRows = (
    <>
      <GlobalFolderRow
        label="전체"
        icon={<FaFolder className="opacity-70 flex-none" size={13} />}
        count={globalEntries.length}
        active={effectiveFolderFilter === '__all__'}
        onClick={() => setFolderFilter('__all__')}
      />
      <GlobalFolderRow
        label="미분류"
        icon={<FaFolder className="opacity-40 flex-none" size={13} />}
        count={globalEntries.filter((e) => !e.folder).length}
        active={effectiveFolderFilter === '__unfiled__'}
        onClick={() => setFolderFilter('__unfiled__')}
        droppable
        dropFolder={null}
      />
      {globalFolders.map((f) => (
        <GlobalFolderRow
          key={f}
          label={f}
          icon={
            <FaFolder
              className="text-purple-400 dark:text-purple-500 flex-none"
              size={13}
            />
          }
          count={globalEntries.filter((e) => e.folder === f).length}
          active={effectiveFolderFilter === f}
          onClick={() => setFolderFilter(f)}
          droppable
          dropFolder={f}
          onRename={() => {
            setEditingFolder(f);
            setEditFolderValue(f);
          }}
          onDelete={() => handleDeleteFolder(f)}
          editing={editingFolder === f}
          editValue={editFolderValue}
          onEditChange={setEditFolderValue}
          onEditCommit={commitFolderRename}
          onEditCancel={() => setEditingFolder(null)}
        />
      ))}
      {/* 새 폴더 — 인라인 입력 (Enter 확정 / Escape 취소) */}
      {newFolderMode ? (
        <GlobalFolderRow
          label=""
          icon={
            <FaFolder
              className="text-purple-400 dark:text-purple-500 flex-none"
              size={13}
            />
          }
          count={0}
          active={false}
          onClick={() => {}}
          editing
          editValue={newFolderValue}
          onEditChange={setNewFolderValue}
          onEditCommit={commitNewFolder}
          onEditCancel={() => {
            setNewFolderMode(false);
            setNewFolderValue('');
          }}
        />
      ) : (
        <button
          className="btn-ghost flex items-center justify-center md:justify-start gap-1.5 px-2.5 py-1.5 rounded-lg text-sm whitespace-nowrap flex-none md:w-full border border-dashed line-color text-muted"
          onClick={() => {
            setNewFolderMode(true);
            setNewFolderValue('');
          }}
        >
          <FaPlus size={11} />새 폴더
        </button>
      )}
    </>
  );

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile
      ? 'repeat(2, 1fr)'
      : 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '0.75rem',
    alignContent: 'start',
  };

  // 글로벌 카드 그리드
  const globalGrid = (
    <div style={gridStyle} data-character-grid="global">
      {/* 새 글로벌 프리셋 카드 (순차 생성·선택 모드가 아닐 때만) */}
      {!cyclingMode && !selectMode && (
        <div
          className="rounded-lg border-2 border-dashed border-purple-300 dark:border-purple-600 hover:border-purple-500 cursor-pointer flex flex-col items-center justify-center aspect-[3/4] transition-colors group"
          onClick={handleAddNewGlobal}
        >
          <FaPlus className="text-2xl text-purple-400 dark:text-purple-500 group-hover:text-purple-600 transition-colors mb-2" />
          <span className="text-sm text-purple-400 dark:text-purple-500 group-hover:text-purple-600 transition-colors">
            새 글로벌 프리셋
          </span>
        </div>
      )}
      {shownGlobalEntries.map((entry) => (
        <GlobalCharacterPresetCard
          key={entry.id}
          entry={entry}
          // 드래그 정렬·폴더 드롭은 전체 목록 기준 인덱스로 동작해야
          // 한다 (폴더 필터로 걸러진 화면 인덱스와 다름)
          index={globalEntries.indexOf(entry)}
          isEasyMode={isEasyMode}
          // 선택 모드도 순차 생성과 같은 체크 오버레이 UI 를 재사용
          cyclingMode={cyclingMode || selectMode}
          selected={selectedGlobalIds.has(entry.id)}
          onToggleSelect={() => toggleGlobalSelection(entry.id)}
          onApplyEasy={() => handleApplyGlobal(entry, 'easy')}
          onApplyCharacter={() => handleApplyGlobal(entry, 'character')}
          onLoad={() => handleLoadGlobal(entry)}
          onEdit={() => handleEditGlobal(entry)}
          onDuplicate={() => handleDuplicateGlobal(entry)}
          onDelete={() => handleDeleteGlobal(entry)}
          onMove={(from, to) =>
            reorderGlobalCharactersRecorded(from, to)
          }
          onMoveToFolder={() => handleMoveToFolder(entry)}
          reorderLocked={listSearching}
        />
      ))}
      {listSearching && shownGlobalEntries.length === 0 && (
        <div
          className="col-span-full text-sm text-faint py-8 text-center"
          data-list-no-hits=""
        >
          검색 결과가 없습니다
        </div>
      )}
      {!listSearching &&
        visibleGlobalEntries.length === 0 &&
        (cyclingMode || selectMode) && (
          <div className="col-span-full text-sm text-faint py-8 text-center">
            이 폴더에 프리셋이 없습니다
          </div>
        )}
    </div>
  );

  // 로컬 프리셋이 없을 때
  const localEmpty = (
    <div className="text-center py-12">
      <FaUserAlt className="text-4xl mx-auto mb-3 text-gray-300 dark:text-gray-600" />
      <div className="text-muted mb-1">캐릭터 프리셋이 없습니다</div>
      <div className="text-sm text-faint mb-4">새 프리셋을 추가해보세요</div>
      <button
        className="px-4 py-2 rounded-lg btn-solid-sky text-sm font-medium transition-colors"
        onClick={handleAddNew}
      >
        <FaPlus className="inline mr-1.5" size={11} />
        새 프리셋 추가
      </button>
    </div>
  );

  // 로컬 카드 그리드
  const localGrid = (
    <div style={gridStyle} data-character-grid="local">
      {/* 새 프리셋 카드 (순회·선택 모드가 아닐 때만) */}
      {!cyclingMode && !selectMode && (
        <div
          className="rounded-lg border-2 border-dashed line-color hover:border-sky-400 dark:hover:border-sky-500 cursor-pointer flex flex-col items-center justify-center aspect-[3/4] transition-colors group"
          onClick={handleAddNew}
        >
          <FaPlus className="text-2xl text-faint group-hover:text-sky-500 transition-colors mb-2" />
          <span className="text-sm text-faint group-hover:text-sky-500 transition-colors">
            새 프리셋
          </span>
        </div>
      )}

      {/* 프리셋 카드들 — 검색으로 걸러도 index 는 원래 목록 위치(순서 이동 기준) */}
      {shownPresets.map((preset) => (
        <div key={preset.name} className="relative">
          {(cyclingMode || selectMode) && (
            <div
              className="absolute top-2 left-2 z-30 cursor-pointer"
              aria-label={selectedPresets.has(preset.name) ? '선택 해제' : '선택'}
              onClick={(e) => { e.stopPropagation(); togglePresetSelection(preset.name); }}
            >
              <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                selectedPresets.has(preset.name)
                  ? 'bg-sky-500 border-sky-500 text-white'
                  : 'bg-white/80 dark:bg-slate-800/80 line-color'
              }`}>
                {selectedPresets.has(preset.name) && <FaCheck size={12} />}
              </div>
            </div>
          )}
          <CharacterPresetCard
            preset={preset}
            index={presets.indexOf(preset)}
            onEdit={() => (cyclingMode || selectMode) ? togglePresetSelection(preset.name) : handleEdit(preset)}
            onDelete={() => handleDelete(preset)}
            onApplyEasy={() => handleApplyEasy(preset)}
            onApplyCharacter={() => handleApplyCharacter(preset)}
            onDuplicate={() => handleDuplicate(preset)}
            onMove={(from, to) =>
              editCharacterPresets(curSession, UNDO_TEXT.characterPresetMove, () =>
                curSession.moveCharacterPreset(from, to),
              )
            }
            onCopyToGlobal={() => handleCopyToGlobal(preset)}
            isEasyMode={isEasyMode}
            hideActions={cyclingMode || selectMode}
            reorderLocked={listSearching}
          />
        </div>
      ))}
      {listSearching && shownPresets.length === 0 && (
        <div
          className="col-span-full text-sm text-faint py-8 text-center"
          data-list-no-hits=""
        >
          검색 결과가 없습니다
        </div>
      )}
    </div>
  );

  // 지금 보기의 카드 영역(빈 로컬이면 안내)
  const cardsArea = globalView ? globalGrid : presets.length === 0 ? localEmpty : localGrid;

  // 순차 생성 — 씬 선택 머리 버튼(씬 템플릿 가져오기·전체 선택/해제)
  const sceneHeaderButtons = (
    <>
      {/* 씬 템플릿을 현 프로젝트에 가져와 바로 순차 생성 대상으로 쓴다
          (2026-07-18 재검증 피드백 1) — 가져온 씬은 자동 선택 */}
      <button
        onClick={async () => {
          const result =
            await templateService.importSceneTemplate(curSession);
          // 되돌리기 1항목(들어간 씬 + 덮어쓰기로 휴지통에 보낸 기존 씬 — 2차 묶음 5)
          recordSceneTemplateImport(curSession, result);
          const names = result?.names;
          if (names && names.length > 0) {
            setSelectedScenes((prev) => {
              const next = new Set(prev);
              names.forEach((n) => next.add(n));
              return next;
            });
          }
        }}
        className="text-xs btn-link"
      >
        씬 템플릿을 프로젝트로 복사
      </button>
      <button
        onClick={() => {
          const targets = filteredScenes.map((s) => s.name);
          const allSelected = targets.every((n) => selectedScenes.has(n));
          const next = new Set(selectedScenes);
          targets.forEach((n) => allSelected ? next.delete(n) : next.add(n));
          setSelectedScenes(next);
        }}
        className="text-xs btn-link"
      >
        {filteredScenes.every((s) => selectedScenes.has(s.name)) ? '전체 해제' : '전체 선택'}
        {sceneFilter.trim() && ` (${filteredScenes.length}개)`}
      </button>
    </>
  );

  const sceneFilterInput = (
    <input
      type="text"
      placeholder="씬 이름 검색..."
      value={sceneFilter}
      onChange={(e) => setSceneFilter(e.target.value)}
      className="w-full mb-1 px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--c-focus-ring)]"
    />
  );

  // 씬 목록 — PC 는 설정 열의 남은 높이 전부(그 열의 유일한 스크롤), 모바일은 종전 높이 상한
  const sceneList = (
    <div
      className={
        (wide ? 'flex-1 min-h-0' : 'max-h-36') +
        ' overflow-y-auto border line-color rounded-lg p-2 space-y-1'
      }
      data-cycling-scene-list=""
    >
      {filteredScenes.map((scene) => (
        <label key={scene.name} className="flex items-center gap-2 cursor-pointer hover-row rounded px-1 py-0.5">
          <input
            type="checkbox"
            checked={selectedScenes.has(scene.name)}
            onChange={() => toggleSceneSelection(scene.name)}
            className="setting-check"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{scene.name}</span>
        </label>
      ))}
      {filteredScenes.length === 0 && (
        <div className="text-xs text-faint py-1">일치하는 씬이 없습니다</div>
      )}
    </div>
  );

  // 프로젝트 파일 생성 모드 토글
  const projectFileToggle = (
    // 체크 줄(2026-11-20 UI 정돈 그룹 1-c) — 실행 전 옵션이라 체크 상자. 줄 안쪽 여백(10px)만큼 당겨 주변 칸과 왼쪽을 맞춘다.
    <div className="-mx-2.5 mb-1 select-none">
      <SettingCheckRow
        id="cyclingProjectFileMode"
        checked={projectFileMode}
        onChange={setProjectFileMode}
        label={<span className="font-medium">프로젝트 파일 생성으로 동작</span>}
        description="각 프리셋을 프리셋 이름의 새 프로젝트로 복제(이미지 미포함)해 생성합니다. 원본 프로젝트는 그대로 유지됩니다."
      />
    </div>
  );

  const samplesInput = (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-muted">생성 수:</span>
      <input
        type="number"
        min={1}
        max={100}
        value={cyclingSamples}
        onChange={(e) => setCyclingSamples(Math.max(1, parseInt(e.target.value) || 1))}
        className="w-16 px-2 py-1 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--c-focus-ring)]"
      />
    </div>
  );

  // [순차 생성 시작] — PC 는 바닥줄 오른쪽, 모바일은 설정 패널 맨 아래(종전)
  const startCyclingButton = (extraClass: string) => (
    <button
      className={`${extraClass}px-4 py-1.5 rounded-lg text-white text-sm font-medium transition-colors flex items-center gap-1.5 ${
        globalView ? 'btn-solid-purple' : 'btn-solid-green'
      }`}
      onClick={startCycling}
      disabled={selectedCyclingCount === 0 || selectedScenes.size === 0}
      data-cycling-start=""
    >
      <FaPlay size={10} />
      순차 생성 시작
    </button>
  );

  // ─── 모바일 — 종전 한 열 그대로(본문 하나) ───
  if (!wide) {
    return {
      bodyPadding: 'normal',
      body: (
    <div
      ref={listRootRef}
      className="text-default"
      style={{ minHeight: minListHeight || undefined }}
    >
      {/* 상단 컨트롤 */}
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {/* 로컬/글로벌 전환 토글 */}
          {mobileViewToggle}
          {modeButtons}
        </div>
        {/* 「백업 불러오기」로 글자가 늘어 좁은 폭에서는 줄을 바꾼다(2026-11-16 R1) */}
        <div className="flex items-center gap-2 flex-wrap">{fileButtons}</div>
      </div>

      {selectMode && selectionBar('mb-2 flex items-center gap-2 flex-wrap')}

      {cyclingMode && cyclingSelectBar('mb-2 flex items-center justify-between')}

      {globalView ? (
        <div className="flex flex-col md:flex-row gap-3">
          {/* 폴더 줄 (모바일: 상단 가로 스크롤 / 태블릿 폭: 왼쪽 세로 목록 — 2026-11-15 C-3 에서 세로 높이 상한·안쪽 스크롤 제거, 본문 스크롤 하나) */}
          <div className="flex md:flex-col gap-1.5 md:w-44 md:flex-none flex-none overflow-x-auto pb-1 md:pb-0">
            {folderRows}
          </div>
          {/* 우측 카드 그리드 — 맨 위 이름 검색(폴더 범위 안, 2026-11-14 M4) */}
          <div className="flex-1 min-w-0">
            {globalEntries.length > 0 &&
              listSearchBar(visibleGlobalEntries.length, shownGlobalEntries.length)}
            {globalGrid}
          </div>
        </div>
      ) : presets.length === 0 ? (
        localEmpty
      ) : (
          <>
          {listSearchBar(presets.length, shownPresets.length)}
          {localGrid}
          </>
      )}
      {/* 순차 생성 설정 패널 (로컬/글로벌 공통) */}
      {cyclingMode && (
            <div className="mt-4 p-3 border line-color rounded-lg">
              {/* 씬 선택 */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    씬 선택 ({selectedScenes.size}/{scenes.length})
                  </span>
                  <div className="flex items-center gap-3">{sceneHeaderButtons}</div>
                </div>
                {sceneFilterInput}
                {sceneList}
              </div>
              {projectFileToggle}
              {/* 생성 수 + 시작 버튼 */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-sm text-muted">
                  프리셋: <span className="font-medium text-body">{selectedCyclingCount}개</span>
                </div>
                <div className="text-sm text-muted">
                  씬: <span className="font-medium text-body">{selectedScenes.size}개</span>
                </div>
                {samplesInput}
                {startCyclingButton('ml-auto ')}
              </div>
            </div>
          )}
    </div>
      ),
    };
  }

  // ─── PC — xl 고정 높이 슬롯 배치 ───

  // aside: 맨 위 [로컬 | 글로벌] → 글로벌 = 폴더 행 / 로컬 = 「이 프로젝트 · n개」 + 안내. 두 보기 공통이라 그리드 폭이 출렁이지 않는다.
  // 폴더 행은 같은 React 트리라 카드 → 폴더 끌어 놓기(폴더로 이동)가 그대로 동작한다(검색 중에도 허용 — M4).
  const aside = (
    <div className="flex flex-col h-full min-h-0" data-character-preset-aside="">
      <div className="flex-none p-3 border-b line-color">{asideViewToggle}</div>
      <div
        className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1.5"
        data-character-aside-list={globalView ? 'global' : 'local'}
      >
        {globalView ? (
          folderRows
        ) : (
          <>
            <div
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm bg-sky-600 text-white dark:bg-sky-500"
              data-character-local-row=""
            >
              <FaUsers className="flex-none" size={12} />
              <span className="flex-1 min-w-0 truncate">
                이 프로젝트 · {presets.length}개
              </span>
            </div>
            <div className="px-1 pt-1 text-xs text-faint leading-relaxed">
              로컬 프리셋은 이 프로젝트에만 저장됩니다. 다른 프로젝트에서도 쓰려면 글로벌로 복사하세요.
            </div>
          </>
        )}
      </div>
    </div>
  );

  // toolbar: 왼쪽 [순차 생성 모드][선택] + 이름 검색(스크롤해도 남게), 오른쪽 파일 버튼·도움말. 선택 모드면 둘째 줄 = 선택 바.
  const showSearch = globalView ? globalEntries.length > 0 : presets.length > 0;
  const toolbar = (
    <div className="w-full flex flex-col gap-2" data-character-preset-toolbar="">
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        {modeButtons}
        {showSearch && (
          <div className="flex-1 min-w-[12rem] max-w-md flex items-center gap-2">
            <ListSearchBar
              compact
              className="flex-1"
              query={listQuery}
              onQueryChange={setListQuery}
              placeholder="프리셋 이름 검색"
              shown={globalView ? shownGlobalEntries.length : shownPresets.length}
              total={globalView ? visibleGlobalEntries.length : presets.length}
            />
            {listSearching && <ListDragLockedHint className="flex-none whitespace-nowrap" />}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">{fileButtons}</div>
      </div>
      {selectMode && selectionBar('flex items-center gap-2 flex-wrap')}
    </div>
  );

  if (!cyclingMode) {
    return {
      toolbar,
      aside,
      bodyPadding: 'normal',
      // 본문 = 카드 그리드만(창의 유일한 세로 스크롤)
      body: <div className="text-default" data-character-preset-body="">{cardsArea}</div>,
    };
  }

  // 순차 생성 모드: 「카드 | 설정 열」 두 칸(열마다 스크롤 하나), [순차 생성 시작] = 바닥줄
  return {
    toolbar,
    aside,
    bodyPadding: 'normal',
    body: (
      <div
        className="text-default h-full min-h-0 flex gap-4"
        data-character-preset-body=""
        data-cycling-columns=""
      >
        <div className="flex-1 min-w-0 min-h-0 flex flex-col" data-cycling-cards="">
          {cyclingSelectBar('flex-none mb-2 flex items-center justify-between')}
          <div className="flex-1 min-h-0 overflow-y-auto">{cardsArea}</div>
        </div>
        <div
          className="flex-none w-[300px] min-h-0 flex flex-col pl-4 border-l line-color"
          data-cycling-settings=""
        >
          {/* 씬 선택 — 목록이 이 열의 남은 높이를 채운다 */}
          <div className="flex-1 min-h-0 flex flex-col mb-3">
            <div className="flex-none mb-1">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                씬 선택 ({selectedScenes.size}/{scenes.length})
              </div>
              <div className="flex items-center gap-3 flex-wrap">{sceneHeaderButtons}</div>
            </div>
            <div className="flex-none">{sceneFilterInput}</div>
            {sceneList}
          </div>
          <div className="flex-none">
            {projectFileToggle}
            {samplesInput}
          </div>
        </div>
      </div>
    ),
    footerStart: (
      <span className="text-sm text-muted" data-cycling-summary="">
        프리셋 {selectedCyclingCount}개 × 씬 {selectedScenes.size}개 · 샘플 {cyclingSamples}장
      </span>
    ),
    footer: startCyclingButton(''),
  };
}

// 인라인 사용(테스트·호환) — 슬롯을 차례로 그린다. 창에서는 CharacterPresetModalEditor 가 슬롯에 나눠 넣는다.
export const CharacterPresetEditor = observer((props: CharacterPresetEditorProps) => {
  const panel = useCharacterPresetPanel(props);
  return (
    <>
      {panel.toolbar}
      {panel.aside}
      {panel.body}
      {panel.footerStart}
      {panel.footer}
    </>
  );
});

// ─── ModalOverlay 래퍼 (FloatView 대체) ──────────────────────
interface CharacterPresetFloatEditorProps {
  onClose: () => void;
  onApplyPreset?: (preset: CharacterPreset, mode: 'easy' | 'character') => void;
}

export const CharacterPresetModalEditor = observer(({
  onClose,
  onApplyPreset,
}: CharacterPresetFloatEditorProps) => {
  // 안쪽 편집 중 변경이 있으면 ✕·바깥 클릭으로 관리 창 전체를 닫을 때 한 번 묻는다(2026-10-03 E2-4).
  // Esc·뒤로 가기는 안쪽 편집 폼이 먼저 받아 「목록으로」 간다(같은 가드).
  const editDirtyRef = React.useRef<(() => boolean) | null>(null);
  const panel = useCharacterPresetPanel({
    editDirtyRef,
    onApplyPreset: (preset, mode) => {
      if (onApplyPreset) onApplyPreset(preset, mode);
    },
  });
  // xl 고정 높이(2026-11-15 C-3) — 목록·편집·순차 생성 전환에도 창 크기가 바뀌지 않는다
  return (
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      dirty={() => editDirtyRef.current?.() ?? false}
      title="캐릭터 프리셋 관리"
      size="xl"
      toolbar={panel.toolbar}
      aside={panel.aside}
      footer={panel.footer}
      footerStart={panel.footerStart}
      bodyPadding={panel.bodyPadding}
    >
      {panel.body}
    </ModalOverlay>
  );
});

// 하위호환: 기존 import명 유지
export const CharacterPresetFloatEditor = CharacterPresetModalEditor;

export default CharacterPresetEditor;
