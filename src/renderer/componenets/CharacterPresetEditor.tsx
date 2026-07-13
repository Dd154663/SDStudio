import * as React from 'react';
import { useEffect, useState, useMemo } from 'react';
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
} from '../models';
import { appState } from '../models/AppService';
import { FaPlay, FaPause, FaStop, FaSync, FaDownload, FaUpload, FaGlobe, FaUsers, FaCloudUploadAlt, FaCloudDownloadAlt } from 'react-icons/fa';
import type { IGlobalCharacterPresetEntry } from '../models/GlobalCharacterPresetService';
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

  const jsonStr = JSON.stringify(exportData);
  const fileName = session.name + '_character_presets.json';

  if (isMobile) {
    // 모바일: Capacitor Filesystem으로 저장 후 Share
    try {
      const outPath = 'exports/' + fileName;
      await backend.writeFile(outPath, jsonStr);
      await backend.showFile(outPath);
    } catch (e: any) {
      appState.pushMessage('내보내기 실패: ' + e.message);
      return;
    }
  } else {
    // PC: Blob 다운로드
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
  appState.pushMessage(`${presets.length}개 캐릭터 프리셋을 내보냈습니다`);
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
  // 로컬/글로벌 뷰 전환
  const [globalView, setGlobalView] = useState(false);
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

  const cyclingState = cyclingSessionService.state;

  if (!curSession) {
    return <div className="p-4 text-muted">세션을 선택해주세요</div>;
  }

  const presets = curSession.getCharacterPresets();
  const scenes = Array.from(curSession.scenes.values());
  const isEasyMode = curSession.selectedWorkflow?.workflowType === 'SDImageGenEasy';

  // 씬 필터링
  const filteredScenes = useMemo(() => {
    if (!sceneFilter.trim()) return scenes;
    const q = sceneFilter.toLowerCase();
    return scenes.filter((s) => s.name.toLowerCase().includes(q));
  }, [scenes, sceneFilter]);

  // 순차 생성 모드 진입 시 모든 선택 해제 (기본값)
  // 글로벌 뷰에서는 프로젝트 파일 생성 모드를 기본 ON (요청 핵심 동작)
  const enterCyclingMode = () => {
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
        // 삭제하려는 프리셋이 현재 적용 중이면 먼저 해제
        if (appState.appliedCharacterPreset === preset.name) {
          appState.clearAppliedCharacterPreset();
        }
        curSession.removeCharacterPreset(preset.name);
      },
    });
  };

  const handleDuplicate = (preset: CharacterPreset) => {
    const copy = CharacterPreset.fromJSON(preset.toJSON());
    copy.name = preset.name + ' 복사본';
    curSession.addCharacterPreset(copy);
  };

  const handleApplyEasy = (preset: CharacterPreset) => {
    if (onApplyPreset) onApplyPreset(preset, 'easy');
  };

  const handleApplyCharacter = (preset: CharacterPreset) => {
    if (onApplyPreset) onApplyPreset(preset, 'character');
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

  const globalEntries = globalCharacterPresetService.list();

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
    <div className="text-default">
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
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* 프리셋 선택 바 (순차 생성 모드): 실제 선택 카드 바로 위에 두어 조작 위치를 일치시킴 */}
      {cyclingMode && (
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            프리셋 선택 (
            {globalView ? selectedGlobalIds.size : selectedPresets.size}/
            {globalView ? globalEntries.length : presets.length})
          </span>
          <button
            onClick={() => {
              if (globalView) {
                const all =
                  globalEntries.length > 0 &&
                  globalEntries.every((e) => selectedGlobalIds.has(e.id));
                setSelectedGlobalIds(
                  new Set<string>(all ? [] : globalEntries.map((e) => e.id)),
                );
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
                ? globalEntries.length > 0 &&
                  globalEntries.every((e) => selectedGlobalIds.has(e.id))
                : presets.length > 0 &&
                  presets.every((p) => selectedPresets.has(p.name))
            )
              ? '전체 해제'
              : '전체 선택'}
          </button>
        </div>
      )}

      {globalView ? (
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
          {/* 새 글로벌 프리셋 카드 (순차 생성 모드가 아닐 때만) */}
          {!cyclingMode && (
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
          {globalEntries.map((entry, i) => (
            <GlobalCharacterPresetCard
              key={entry.id}
              entry={entry}
              index={i}
              isEasyMode={isEasyMode}
              cyclingMode={cyclingMode}
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
            />
          ))}
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
            {/* 새 프리셋 카드 (순회 모드가 아닐 때만) */}
            {!cyclingMode && (
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
                {cyclingMode && (
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
                  onEdit={() => cyclingMode ? togglePresetSelection(preset.name) : handleEdit(preset)}
                  onDelete={() => handleDelete(preset)}
                  onApplyEasy={() => handleApplyEasy(preset)}
                  onApplyCharacter={() => handleApplyCharacter(preset)}
                  onDuplicate={() => handleDuplicate(preset)}
                  onMove={(from, to) => curSession.moveCharacterPreset(from, to)}
                  onCopyToGlobal={() => handleCopyToGlobal(preset)}
                  isEasyMode={isEasyMode}
                  hideActions={cyclingMode}
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
