import * as React from 'react';
import { useEffect, useState, useMemo, useRef, useLayoutEffect } from 'react';
import { observer } from 'mobx-react-lite';
import Tooltip from './Tooltip';
import {
  FaPlus,
  FaTrash,
  FaCopy,
  FaFont,
  FaUserAlt,
  FaCheck,
  FaTimes,
  FaEdit,
  FaArrowLeft,
  FaToggleOn,
  FaToggleOff,
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
import { FaPlay, FaPause, FaStop, FaSync, FaDownload, FaUpload, FaGlobe, FaUsers, FaCloudUploadAlt, FaCloudDownloadAlt } from 'react-icons/fa';
import type { IGlobalCharacterPresetEntry } from '../models/GlobalCharacterPresetService';
import { saveJsonFile } from '../models/exportUtil';
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
import HelpIcon from './HelpIcon';

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
    appState.pushMessage('내보낼 캐릭터 프리셋이 없습니다');
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
      JSON.stringify(exportData),
    );
  } catch (e: any) {
    appState.pushMessage('내보내기 실패: ' + e.message);
    return;
  }
  appState.pushMessage(`${presets.length}개 캐릭터 프리셋을 내보냈습니다`);
}

// ─── 글로벌 캐릭터 프리셋 내보내기/불러오기 (PC↔모바일 크로스, 2026-07-18) ───
// 파일 형식은 로컬(ExportedPresetData v1)과 동일 — 직렬화/복원은 서비스가 담당
// (GlobalCharacterPresetService.exportToFileData/importFromFileData 참조).
// 로컬에서 내보낸 파일을 글로벌로, 글로벌 파일을 로컬로 교차 불러올 수 있다.

async function exportGlobalCharacterPresets() {
  const entries = globalCharacterPresetService.list();
  if (entries.length === 0) {
    appState.pushMessage('내보낼 글로벌 프리셋이 없습니다');
    return;
  }
  try {
    const data = await globalCharacterPresetService.exportToFileData();
    await saveJsonFile('global_character_presets.json', JSON.stringify(data));
  } catch (e: any) {
    appState.pushMessage('내보내기 실패: ' + e.message);
    return;
  }
  appState.pushMessage(`${entries.length}개 글로벌 프리셋을 내보냈습니다`);
}

async function importGlobalCharacterPresets(file: File) {
  const text = await file.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    appState.pushMessage('올바른 캐릭터 프리셋 파일이 아닙니다');
    return;
  }
  try {
    const n = await globalCharacterPresetService.importFromFileData(data);
    appState.pushMessage(`${n}개 프리셋을 글로벌로 불러왔습니다`);
  } catch (e: any) {
    appState.pushMessage(e.message || '불러오기에 실패했습니다');
  }
}

async function importCharacterPresets(session: any, file: File) {
  const text = await file.text();
  let data: ExportedPresetData;
  try {
    data = JSON.parse(text);
  } catch (e) {
    appState.pushMessage('올바른 캐릭터 프리셋 파일이 아닙니다');
    return;
  }

  if (!data.presets || !Array.isArray(data.presets)) {
    appState.pushMessage('올바른 캐릭터 프리셋 파일이 아닙니다');
    return;
  }

  let imported = 0;
  for (const presetJson of data.presets) {
    // 바이브 이미지 복원 (원래 파일명으로 직접 저장)
    if (presetJson.vibeImages) {
      for (const img of presetJson.vibeImages) {
        try {
          const path = imageService.getVibesDir(session) + '/' + img.filename;
          await backend.writeDataFile(path, img.data);
        } catch (e) {}
      }
    }

    // 레퍼런스 이미지 복원
    if (presetJson.referenceImages) {
      for (const img of presetJson.referenceImages) {
        try {
          const path = imageService.getReferenceDir(session) + '/' + img.filename;
          await backend.writeDataFile(path, img.data);
        } catch (e) {}
      }
    }

    // 대표 이미지 복원
    if (presetJson.representativeImageData && presetJson.representativeImage) {
      try {
        const path = imageService.getVibesDir(session) + '/' + presetJson.representativeImage;
        await backend.writeDataFile(path, presetJson.representativeImageData);
      } catch (e) {}
    }

    // 임시 필드 제거 후 프리셋 생성
    delete presetJson.vibeImages;
    delete presetJson.referenceImages;
    delete presetJson.representativeImageData;

    const preset = CharacterPreset.fromJSON(presetJson as ICharacterPreset);

    // 중복 이름 처리
    while (session.hasCharacterPreset(preset.name)) {
      preset.name = preset.name + '_1';
    }

    session.addCharacterPreset(preset);
    imported++;
  }

  appState.pushMessage(`${imported}개 캐릭터 프리셋을 불러왔습니다`);
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
          if (entry) globalCharacterPresetService.setFolder(entry.id, dropFolder);
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
              className="text-faint hover:text-gray-600 dark:hover:text-gray-200 px-0.5"
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
            droppable && isOver ? 'ring-2 ring-purple-400 ' : ''
          }${active ? 'bg-purple-500 text-white' : 'btn-neutral text-body'}`}
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
}

export const CharacterPresetEditor = observer(({
  onApplyPreset,
}: CharacterPresetEditorProps) => {
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

  // 목록 높이 고정: 글로벌/로컬 전환·폴더 필터로 카드 수가 달라져도 지금까지
  // 본 것 중 가장 큰 높이를 minHeight 로 유지해 모달이 출렁이지 않게 한다.
  // (마운트 동안만 유효 — 모달을 닫으면 리셋, 창 크기 변경 시 재측정)
  const listRootRef = useRef<HTMLDivElement | null>(null);
  const [minListHeight, setMinListHeight] = useState(0);
  useLayoutEffect(() => {
    const el = listRootRef.current;
    if (el && el.offsetHeight > minListHeight) {
      setMinListHeight(el.offsetHeight);
    }
  });
  useEffect(() => {
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
    return <div className="p-4 text-muted">세션을 선택해주세요</div>;
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
        appState.pushMessage(e.message || '글로벌 프리셋 저장 실패');
      }
    } else {
      if (isNew) {
        curSession.addCharacterPreset(preset);
      } else {
        curSession.updateCharacterPreset(editingPreset!.name, preset);
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

  const handleDelete = (preset: CharacterPreset) => {
    appState.pushDialog({
      type: 'confirm',
      text: `"${preset.name}" 프리셋을 삭제하시겠습니까?`,
      callback: () => {
        // 삭제하려는 프리셋이 현재 적용 중이면 먼저 해제 (해당 프리셋만 — W4 다중 적용)
        if (appState.appliedCharacterPresetNames.includes(preset.name)) {
          appState.removeAppliedCharacterPreset(preset.name);
        }
        curSession.removeCharacterPreset(preset.name);
      },
    });
  };

  const handleDuplicate = (preset: CharacterPreset) => {
    const copy = CharacterPreset.fromJSON(preset.toJSON());
    copy.name = preset.name + ' 복사본';
    // 복제본은 독립 로컬 — 글로벌 유래 링크를 끊어 원본만 재적용 갱신 대상으로 유지
    copy.fromGlobalId = '';
    copy.fromGlobalRev = 0;
    curSession.addCharacterPreset(copy);
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
      const locals: CharacterPreset[] = [];
      for (const e of entries) {
        try {
          locals.push(
            await globalCharacterPresetService.instantiateIntoSession(
              curSession,
              e.id,
            ),
          );
        } catch (err: any) {
          appState.pushMessage(
            err.message || `"${e.name}" 불러오기에 실패했습니다`,
          );
        }
      }
      appState.applyCharacterPresets(locals);
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

  // 로컬 → 글로벌 일괄 복사 (무파괴 승격 — 원본 유지, 중복 이름은 _n 접미)
  const handleSendAllToGlobal = () => {
    appState.pushDialog({
      type: 'confirm',
      text: `로컬 프리셋 ${presets.length}개를 모두 글로벌로 복사할까요?\n(원본은 유지되며, 중복 이름에는 _n 접미사가 붙습니다)`,
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
    try {
      const p = await globalCharacterPresetService.instantiateIntoSession(
        curSession,
        entry.id,
      );
      appState.pushMessage(`"${p.name}"을(를) 프로젝트로 불러왔습니다`);
    } catch (e: any) {
      appState.pushMessage(e.message || '불러오기에 실패했습니다');
    }
  };

  const handleRenameGlobal = (entry: IGlobalCharacterPresetEntry) => {
    appState.pushDialog({
      type: 'input-confirm',
      text: '새 글로벌 프리셋 이름을 입력해주세요',
      callback: async (v?: string) => {
        if (!v) return;
        try {
          await globalCharacterPresetService.rename(entry.id, v);
        } catch (e: any) {
          appState.pushMessage(e.message || '이름 변경에 실패했습니다');
        }
      },
    });
  };

  const handleDeleteGlobal = (entry: IGlobalCharacterPresetEntry) => {
    appState.pushDialog({
      type: 'confirm',
      text: `글로벌 프리셋 "${entry.name}"을(를) 삭제하시겠습니까?\n(이 작업은 모든 프로젝트에 영향을 줍니다)`,
      callback: async () => {
        await globalCharacterPresetService.delete(entry.id);
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
    try {
      const local = await globalCharacterPresetService.instantiateIntoSession(
        curSession,
        entry.id,
      );
      if (onApplyPreset) onApplyPreset(local, mode);
      appState.pushMessage(`"${entry.name}"을(를) 불러와 적용했습니다`);
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
      const name = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '새 폴더 이름을 입력해주세요',
      });
      if (!name || !name.trim()) return undefined;
      return name.trim();
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
      await globalCharacterPresetService.setFolder(entry.id, target);
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
      for (const id of ids) {
        await globalCharacterPresetService.setFolder(id, target);
      }
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
      const created = await globalCharacterPresetService.createFolder(name);
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
      await globalCharacterPresetService.renameFolder(oldName, newName);
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
      text: `폴더 "${folder}"를 삭제할까요?\n소속 프리셋 ${count}개는 미분류로 이동합니다.`,
      callback: async () => {
        await globalCharacterPresetService.deleteFolder(folder);
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

  // 편집 모드
  if (editingPreset) {
    return (
      <CharacterPresetInnerEditor
        preset={editingPreset}
        onSave={handleSave}
        onCancel={handleCancel}
        isNew={isNew}
        imageBackend={
          editTarget === 'global'
            ? globalImageBackend
            : makeSessionImageBackend(curSession)
        }
      />
    );
  }

  // 순회 진행 중 상태 표시
  if (cyclingState === 'running' || cyclingState === 'paused') {
    return (
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
              취소
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 카드 그리드 모드
  return (
    <div
      ref={listRootRef}
      className="text-default"
      style={{ minHeight: minListHeight || undefined }}
    >
      {/* 상단 컨트롤 */}
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {/* 로컬/글로벌 전환 토글 */}
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              globalView
                ? 'bg-purple-500 text-white'
                : 'btn-neutral text-body'
            }`}
            onClick={() => {
              if (cyclingMode) exitCyclingMode();
              if (selectMode) exitSelectMode();
              setGlobalView(!globalView);
            }}
          >
            {globalView ? <FaGlobe size={12} /> : <FaUsers size={12} />}
            {globalView ? '글로벌' : '로컬'}
          </button>
          {(globalView ? globalEntries.length >= 2 : presets.length >= 2) && (
            <button
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                cyclingMode
                  ? (globalView ? 'bg-purple-500 text-white' : 'bg-sky-500 text-white')
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
                    ? 'bg-purple-500 text-white'
                    : 'bg-sky-500 text-white'
                  : 'btn-neutral text-body'
              }`}
              onClick={() => (selectMode ? exitSelectMode() : enterSelectMode())}
            >
              <FaCheckSquare size={11} />
              {selectMode ? '선택 모드 끄기' : '선택'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!globalView && presets.length > 0 && (
            <Tooltip content="모든 로컬 프리셋을 글로벌로 복사 (원본 유지)">
              <button
                className="px-3 py-1.5 rounded-lg text-sm btn-neutral text-body transition-colors flex items-center gap-1.5 disabled:opacity-50"
                disabled={bulkSending}
                onClick={handleSendAllToGlobal}
              >
                <FaCloudUploadAlt size={11} />
                {bulkSending ? '보내는 중...' : '모두 글로벌로 보내기'}
              </button>
            </Tooltip>
          )}
          {!globalView && presets.length > 0 && (
            <Tooltip content="모든 프리셋 내보내기">
              <button
                className="px-3 py-1.5 rounded-lg text-sm btn-neutral text-body transition-colors flex items-center gap-1.5"
                onClick={() => exportCharacterPresets(curSession)}
              >
                <FaDownload size={11} />
                내보내기
              </button>
            </Tooltip>
          )}
          {!globalView && (
            <Tooltip content="프리셋 파일 불러오기">
              <label className="px-3 py-1.5 rounded-lg text-sm btn-neutral text-body transition-colors flex items-center gap-1.5 cursor-pointer">
                <FaUpload size={11} />
                불러오기
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
          {/* 글로벌 내보내기/불러오기 — PC↔모바일 크로스 작업 이동용.
              파일 형식이 로컬과 동일해 로컬 내보내기 파일도 불러올 수 있다. */}
          {globalView && globalEntries.length > 0 && (
            <Tooltip content="모든 글로벌 프리셋 내보내기">
              <button
                className="px-3 py-1.5 rounded-lg text-sm btn-neutral text-body transition-colors flex items-center gap-1.5"
                onClick={exportGlobalCharacterPresets}
              >
                <FaDownload size={11} />
                내보내기
              </button>
            </Tooltip>
          )}
          {globalView && (
            <Tooltip content="프리셋 파일 불러오기 (로컬에서 내보낸 파일도 가능)">
              <label className="px-3 py-1.5 rounded-lg text-sm btn-neutral text-body transition-colors flex items-center gap-1.5 cursor-pointer">
                <FaUpload size={11} />
                불러오기
                <input
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
          <HelpIcon
            content={
              '캐릭터 프리셋은 캐릭터 프롬프트, 네거티브, 바이브, 레퍼런스의 묶음입니다.\n' +
              '카드 버튼으로 현재 프로젝트에 적용/해제합니다 (여러 개 일괄 적용 가능).\n' +
              '글로벌 프리셋은 모든 프로젝트에서 공유되며, 적용하면 현재 프로젝트로 사본이 들어갑니다.'
            }
          />
        </div>
      </div>

      {/* 일괄 선택 액션 바 — 다중 선택 후 일괄 적용(양 뷰) / 폴더 이동(글로벌) */}
      {selectMode && (
        <div className="mb-2 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {(globalView ? selectedGlobalIds.size : selectedPresets.size)}개
            선택
          </span>
          <button
            className="text-xs btn-link"
            onClick={() => {
              if (globalView) {
                // 폴더 필터 중엔 보이는 항목만 토글 — 다른 폴더의 선택은 유지
                const all =
                  visibleGlobalEntries.length > 0 &&
                  visibleGlobalEntries.every((e) =>
                    selectedGlobalIds.has(e.id),
                  );
                const next = new Set(selectedGlobalIds);
                visibleGlobalEntries.forEach((e) =>
                  all ? next.delete(e.id) : next.add(e.id),
                );
                setSelectedGlobalIds(next);
              } else {
                const all =
                  presets.length > 0 &&
                  presets.every((p) => selectedPresets.has(p.name));
                setSelectedPresets(
                  new Set<string>(all ? [] : presets.map((p) => p.name)),
                );
              }
            }}
          >
            {(
              globalView
                ? visibleGlobalEntries.length > 0 &&
                  visibleGlobalEntries.every((e) =>
                    selectedGlobalIds.has(e.id),
                  )
                : presets.length > 0 &&
                  presets.every((p) => selectedPresets.has(p.name))
            )
              ? '전체 해제'
              : '전체 선택'}
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
        </div>
      )}

      {/* 프리셋 선택 바 (순차 생성 모드): 실제 선택 카드 바로 위에 두어 조작 위치를 일치시킴 */}
      {cyclingMode && (
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            프리셋 선택 (
            {globalView ? selectedGlobalIds.size : selectedPresets.size}/
            {globalView ? visibleGlobalEntries.length : presets.length})
          </span>
          <button
            onClick={() => {
              if (globalView) {
                // 폴더 필터 중엔 보이는 항목만 토글 — 다른 폴더의 선택은 유지
                const all =
                  visibleGlobalEntries.length > 0 &&
                  visibleGlobalEntries.every((e) =>
                    selectedGlobalIds.has(e.id),
                  );
                const next = new Set(selectedGlobalIds);
                visibleGlobalEntries.forEach((e) =>
                  all ? next.delete(e.id) : next.add(e.id),
                );
                setSelectedGlobalIds(next);
              } else {
                const all =
                  presets.length > 0 &&
                  presets.every((p) => selectedPresets.has(p.name));
                setSelectedPresets(
                  new Set<string>(all ? [] : presets.map((p) => p.name)),
                );
              }
            }}
            className="text-xs btn-link"
          >
            {(
              globalView
                ? visibleGlobalEntries.length > 0 &&
                  visibleGlobalEntries.every((e) => selectedGlobalIds.has(e.id))
                : presets.length > 0 &&
                  presets.every((p) => selectedPresets.has(p.name))
            )
              ? '전체 해제'
              : '전체 선택'}
          </button>
        </div>
      )}

      {globalView ? (
        <div className="flex flex-col md:flex-row gap-3">
          {/* 좌측 폴더 패널 (PC: 세로 목록 / 모바일: 상단 가로 스크롤 —
              그리드 탐색기 좌측 패널 관례의 경량판) */}
          <div className="flex md:flex-col gap-1.5 md:w-44 md:flex-none flex-none overflow-x-auto md:overflow-y-auto md:max-h-[65vh] pb-1 md:pb-0">
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
          </div>
          {/* 우측 카드 그리드 */}
          <div className="flex-1 min-w-0">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile
                  ? 'repeat(2, 1fr)'
                  : 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '0.75rem',
                alignContent: 'start',
              }}
            >
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
              {visibleGlobalEntries.map((entry) => (
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
                    globalCharacterPresetService.reorder(from, to)
                  }
                  onMoveToFolder={() => handleMoveToFolder(entry)}
                />
              ))}
              {visibleGlobalEntries.length === 0 &&
                (cyclingMode || selectMode) && (
                  <div className="col-span-full text-sm text-faint py-8 text-center">
                    이 폴더에 프리셋이 없습니다
                  </div>
                )}
            </div>
          </div>
        </div>
      ) : presets.length === 0 ? (
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
      ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '0.75rem',
              alignContent: 'start',
            }}
          >
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

            {/* 프리셋 카드들 */}
            {presets.map((preset, i) => (
              <div key={preset.name} className="relative">
                {(cyclingMode || selectMode) && (
                  <div
                    className="absolute top-2 left-2 z-30 cursor-pointer"
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
                  index={i}
                  onEdit={() => (cyclingMode || selectMode) ? togglePresetSelection(preset.name) : handleEdit(preset)}
                  onDelete={() => handleDelete(preset)}
                  onApplyEasy={() => handleApplyEasy(preset)}
                  onApplyCharacter={() => handleApplyCharacter(preset)}
                  onDuplicate={() => handleDuplicate(preset)}
                  onMove={(from, to) => curSession.moveCharacterPreset(from, to)}
                  onCopyToGlobal={() => handleCopyToGlobal(preset)}
                  isEasyMode={isEasyMode}
                  hideActions={cyclingMode || selectMode}
                />
              </div>
            ))}
          </div>
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
                  <div className="flex items-center gap-3">
                    {/* 씬 템플릿을 현 프로젝트에 가져와 바로 순차 생성 대상으로 쓴다
                        (2026-07-18 재검증 피드백 1) — 가져온 씬은 자동 선택 */}
                    <button
                      onClick={async () => {
                        const names =
                          await templateService.importSceneTemplate(curSession);
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
                      씬 템플릿 가져오기
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
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="씬 이름 검색..."
                  value={sceneFilter}
                  onChange={(e) => setSceneFilter(e.target.value)}
                  className="w-full mb-1 px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
                <div className="max-h-36 overflow-y-auto border line-color rounded-lg p-2 space-y-1">
                  {filteredScenes.map((scene) => (
                    <label key={scene.name} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={selectedScenes.has(scene.name)}
                        onChange={() => toggleSceneSelection(scene.name)}
                        className="rounded line-color"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{scene.name}</span>
                    </label>
                  ))}
                  {filteredScenes.length === 0 && (
                    <div className="text-xs text-faint py-1">일치하는 씬이 없습니다</div>
                  )}
                </div>
              </div>
              {/* 프로젝트 파일 생성 모드 토글 */}
              <label className="flex items-start gap-2 mb-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={projectFileMode}
                  onChange={(e) => setProjectFileMode(e.target.checked)}
                  className="mt-0.5 rounded line-color"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">프로젝트 파일 생성으로 동작</span>
                  <span className="block text-xs text-muted">
                    각 프리셋을 프리셋 이름의 새 프로젝트로 복제(이미지 미포함)해 생성합니다. 원본 프로젝트는 그대로 유지됩니다.
                  </span>
                </span>
              </label>
              {/* 생성 수 + 시작 버튼 */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-sm text-muted">
                  프리셋: <span className="font-medium text-body">{selectedCyclingCount}개</span>
                </div>
                <div className="text-sm text-muted">
                  씬: <span className="font-medium text-body">{selectedScenes.size}개</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted">생성 수:</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={cyclingSamples}
                    onChange={(e) => setCyclingSamples(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 px-2 py-1 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
                <button
                  className={`ml-auto px-4 py-1.5 rounded-lg text-white text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    globalView ? 'bg-purple-500 hover:bg-purple-600' : 'bg-green-500 hover:bg-green-600'
                  }`}
                  onClick={startCycling}
                  disabled={selectedCyclingCount === 0 || selectedScenes.size === 0}
                >
                  <FaPlay size={10} />
                  순차 생성 시작
                </button>
              </div>
            </div>
          )}
    </div>
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
  return (
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      title="캐릭터 프리셋 관리"
      width="max-w-5xl"
    >
      <CharacterPresetEditor
        onApplyPreset={(preset, mode) => {
          if (onApplyPreset) onApplyPreset(preset, mode);
        }}
      />
    </ModalOverlay>
  );
});

// 하위호환: 기존 import명 유지
export const CharacterPresetFloatEditor = CharacterPresetModalEditor;

export default CharacterPresetEditor;
