import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 } from 'uuid';
import {
  FaPlus,
  FaPen,
  FaCopy,
  FaTrashAlt,
  FaTimes,
  FaCloudDownloadAlt,
  FaToggleOn,
  FaToggleOff,
  FaTrash,
} from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import Tooltip from './Tooltip';
import PromptEditTextArea from './PromptEditTextArea';
import { CharacterPresetInnerEditor } from './CharacterPresetInnerEditor';
import { PresetImageBackend, VibeImage } from './CharacterPresetCards';
import { BatchCreatePanel } from './BatchCreateModal';
import { GlobalVibeImage } from './GlobalPresetTab';
import { EditableSliderValue } from './VibeEditor';
import { FileUploadBase64 } from './UtilComponents';
import {
  globalCharacterPresetService,
  globalPresetService,
  projectTemplateService,
  templateService,
} from '../models';
import { appState } from '../models/AppService';
import { CharacterPreset, CharacterPrompt } from '../models/types';
import { Sampling, NoiseSchedule } from '../backends/imageGen';
import HelpIcon from './HelpIcon';

// "템플릿 관리" 오버레이 (프로젝트 상속 v2 — 2026-07-16 워크플로우형 재설계).
//
// 템플릿 = "모든 걸 미리 세팅/수정 가능한 하나의 완전한 프리셋 워크플로우".
// 세 영역 모두 우상단 [불러오기] + 수동 편집 가능:
//  - 프롬프트(스타일 프리셋 1벌): 상위/하위/네거티브 인라인 직접 편집,
//    글로벌 프리셋 불러오기 = 프롬프트·샘플링 1회성 덮어쓰기
//  - 캐릭터 프리셋: 목록형, 불러오기 = 추가(선적용), 새로 만들기/편집 가능
//  - 씬 구성: 씬 템플릿/프로젝트에서 불러오기 = 전체 교체(일괄 적용)
// 새 프로젝트에 적용은 "불러오기"일 뿐 — 생성 후 프로젝트에서 자유 조정.
//
// 편집기 본체(TemplateWorkflowEditor)는 폴더 기본 템플릿 모달과 공유한다
// (폴더 템플릿 = 동일 화면 + 상단 "전역 템플릿 불러오기").

// 템플릿 이미지 디렉터리 기반 캐릭터 편집기 백엔드
const templateImageBackend: PresetImageBackend = {
  storeVibe: (b) => projectTemplateService.storeImageForEditor(b),
  storeReference: (b) => projectTemplateService.storeImageForEditor(b),
  vibePath: (t) => projectTemplateService.getImagePath(t),
  referencePath: (t) => projectTemplateService.getImagePath(t),
};

const sectionCls =
  'p-3 rounded-lg border line-color bg-[var(--c-surface)] flex flex-col gap-2';
const rowCls =
  'flex items-center gap-2 px-2 py-1.5 rounded-md bg-[var(--c-surface-2)] border line-color';
const addBtnCls =
  'px-2 py-1 rounded-md text-xs btn-neutral text-body whitespace-nowrap';
const iconBtnCls = 'btn-ghost p-1.5 rounded-md text-faint';
// 샘플링 인라인 컨트롤 입력 (PresetEditModal 과 동일 스타일)
const numCls =
  'mt-1 w-full px-2 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default';
// 캐릭터 프롬프트 번호 마커 팔레트 (메인 화면 CharacterPromptEditor 와 동일)
const charColors = ['#38bdf8', '#f472b6', '#a78bfa', '#fb923c', '#4ade80', '#facc15', '#f87171', '#94a3b8'];

// ===== 글로벌 프리셋 카드 선택 모달 =====
//
// 프롬프트 영역 "불러오기"의 글로벌 소스 선택 — 텍스트 목록 대신 대표 이미지
// 포함 카드 그리드로 고른다 (GlobalPresetTab 카드의 이미지+이름+타입 구성 재사용).
const GlobalPresetPickerModal = observer(
  ({
    isOpen,
    onClose,
    onPick,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onPick: (globalId: string) => void;
  }) => {
    useEffect(() => {
      if (!isOpen) return;
      if (!globalPresetService.loaded) globalPresetService.load();
    }, [isOpen]);
    const presets = globalPresetService.presets;
    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title="글로벌 프리셋 불러오기"
        width="max-w-3xl"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            선택한 프리셋의 프롬프트·샘플링 설정을 이 템플릿에 1회 덮어씁니다.
          </p>
          {presets.length === 0 ? (
            <div className="text-sm text-default py-6 text-center">
              글로벌 프리셋이 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-1">
              {presets.map((p) => (
                <button
                  key={p.id}
                  className="btn rounded-lg overflow-hidden border-2 line-color hover:border-sky-500 flex flex-col text-left bg-[var(--c-surface-2)]"
                  onClick={() => onPick(p.id)}
                >
                  <GlobalVibeImage
                    profile={p.profile}
                    className="w-full aspect-[3/4] object-cover"
                  />
                  <div className="px-2 py-1.5 w-full">
                    <div className="text-sm text-default truncate">
                      {p.name}
                    </div>
                    <div className="text-xs text-faint truncate">
                      {p.workflowType}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </ModalOverlay>
    );
  },
);

// ===== 템플릿 워크플로우 편집기 (프롬프트/캐릭터/씬 3영역 + [저장]) =====
//
// 전역 "템플릿 관리"와 폴더 기본 템플릿 모달이 완전히 동일한 화면을 공유하는
// 단일 출처. key={templateId} 로 마운트해 템플릿 전환 시 상태를 초기화하고,
// 언마운트 시(창 닫기·전환 포함) 프롬프트 로컬 편집을 자동 커밋한다.
export const TemplateWorkflowEditor = observer(
  ({
    templateId,
    syncSignal = 0,
    commitRef,
    onEditingCharChange,
    batchFolder,
    onBatchCompleted,
    onBatchRunningChange,
  }: {
    templateId: string;
    // 부모가 엔티티를 통째로 바꾼 뒤(전역 템플릿 불러오기 등) 재동기화 신호
    syncSignal?: number;
    // 부모가 언마운트 전에 강제 커밋해야 할 때(복제·닫기 처리) 쓰는 훅
    commitRef?: React.MutableRefObject<() => void>;
    // 캐릭터 프리셋 편집(전체 영역 전환) 중 여부 통지 — 부모 상단 UI 숨김용
    onEditingCharChange?: (editing: boolean) => void;
    // 일괄 생성 탭의 폴더 컨텍스트 — FolderTemplateModal 경유일 때만 폴더
    // 경로가 온다. 없으면(전역 템플릿 관리) 배치 탭에 "대상 폴더 — 새로 생성"
    // 입력 섹션이 뜬다 (배치 R3 스펙 3항).
    batchFolder?: string;
    // 일괄 생성 실행 완료 통지 — 부모(폴더 모달)가 전파 확인 기준(updatedAt)을
    // 리셋하는 데 쓴다 (방금 만든 자식에게 또 "덮어쓸까요?"가 뜨지 않도록).
    onBatchCompleted?: () => void;
    // 일괄 생성 실행 중 여부 통지 — 호스트 모달이 닫기를 차단하는 데 쓴다.
    onBatchRunningChange?: (running: boolean) => void;
  }) => {
    // 프롬프트 영역 인라인 편집 상태 — 명시적 커밋([저장]·창 닫기·전환)
    // 전까지는 로컬에만 존재한다. 에디터 onChange 클로저가 마운트 시점에
    // 고정되므로(PromptEditTextArea 내부 EditorModel), 최신 값은 ref 로 추적.
    const [frontPrompt, setFrontPrompt] = useState('');
    const [backPrompt, setBackPrompt] = useState('');
    const [uc, setUc] = useState('');
    const promptRef = useRef({ frontPrompt: '', backPrompt: '', uc: '' });
    // 외부 변경(불러오기·비우기) 후 인라인 필드 재동기화 트리거
    const [syncKey, setSyncKey] = useState(0);
    // 글로벌 프리셋 카드 선택 모달 (프롬프트 영역 불러오기)
    const [globalPickerOpen, setGlobalPickerOpen] = useState(false);
    // [템플릿]|[일괄 생성] 탭 (배치 R3) — 기본값=템플릿, 비영속(1회성)
    const [tab, setTab] = useState<'template' | 'batch'>('template');
    // 일괄 생성 실행 중 — 탭 전환 비활성+호스트 닫기 차단용
    const [batchRunning, setBatchRunning] = useState(false);
    // 배치 탭의 전역 프리셋 즉석 생성 중 — 탭 헤더 숨김(전체 영역 전환)
    const [batchCharEditing, setBatchCharEditing] = useState(false);
    // 캐릭터 프리셋 편집 (CharacterPresetInnerEditor 인라인 전환)
    const [editChar, setEditChar] = useState<{
      index: number | null; // null = 새로 만들기
      preset: CharacterPreset;
    } | null>(null);

    const entry = projectTemplateService.get(templateId);

    const asStr = (v: any) => (typeof v === 'string' ? v : '');

    // 프롬프트 인라인 필드 동기화 — 마운트/불러오기/세부 설정 후에만
    // (타이핑 중에는 로컬 상태가 진실이므로 매 렌더 동기화 금지)
    useEffect(() => {
      const p = projectTemplateService.get(templateId)?.preset;
      const next = {
        frontPrompt: asStr(p?.frontPrompt),
        backPrompt: asStr(p?.backPrompt),
        uc: asStr(p?.uc),
      };
      setFrontPrompt(next.frontPrompt);
      setBackPrompt(next.backPrompt);
      setUc(next.uc);
      promptRef.current = next;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [templateId, syncKey, syncSignal]);

    // 프롬프트 로컬 편집값을 템플릿에 반영 — [저장]·언마운트 등 명시적
    // 시점에만 호출한다 (타이핑 중 자동 저장 없음).
    const commitPrompts = () => {
      const e = projectTemplateService.get(templateId);
      if (!e) return;
      const v = promptRef.current;
      // 빈 템플릿에 빈 값 커밋 → 불필요한 골격 생성 방지
      if (!e.preset && !v.frontPrompt && !v.backPrompt && !v.uc) return;
      if (
        e.preset &&
        asStr(e.preset.frontPrompt) === v.frontPrompt &&
        asStr(e.preset.backPrompt) === v.backPrompt &&
        asStr(e.preset.uc) === v.uc
      ) {
        return; // 변경 없음
      }
      projectTemplateService.patchPreset(templateId, { ...v }).catch(() => {});
    };
    const commitPromptsRef = useRef(commitPrompts);
    commitPromptsRef.current = commitPrompts;
    if (commitRef) commitRef.current = commitPrompts;

    // 언마운트(창 닫기·템플릿 전환) 시 자동 커밋 — "닫으면 저장되나?"
    // 불확실성 제거. 엔티티가 이미 삭제됐으면 커밋은 스킵된다.
    useEffect(
      () => () => {
        commitPromptsRef.current();
        projectTemplateService.flushSave().catch(() => {});
      },
      [],
    );

    useEffect(() => {
      onEditingCharChange?.(!!editChar);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editChar]);

    // 명시적 [저장] — 프롬프트 커밋 + 디스크 즉시 반영 + 확인 토스트
    const saveTemplate = async () => {
      if (!entry) return;
      commitPrompts();
      await projectTemplateService.flushSave();
      appState.pushMessage(`템플릿 "${entry.name}"이(가) 저장되었습니다.`);
    };

    // ----- 불러오기 -----

    // 프롬프트 영역 덮어쓰기 (글로벌 프리셋 / 현재 프로젝트)
    const importStylePreset = async () => {
      if (!entry) return;
      const source = await appState.pushDialogAsync({
        type: 'select',
        text: '어디서 불러올까요? (프롬프트·샘플링 설정을 1회 덮어씁니다)',
        items: [
          { text: '🌐 글로벌 프리셋에서', value: 'global' },
          { text: '📁 현재 프로젝트에서', value: 'session' },
        ],
      });
      if (!source) return;
      try {
        if (source === 'global') {
          // 카드 그리드(대표 이미지 포함)로 선택 — 선택 처리는 pickGlobalPreset
          if (!globalPresetService.loaded) await globalPresetService.load();
          if (globalPresetService.presets.length === 0) {
            appState.pushMessage('글로벌 프리셋이 없습니다.');
            return;
          }
          setGlobalPickerOpen(true);
          return;
        } else {
          const session = appState.curSession;
          if (!session) {
            appState.pushMessage('열려 있는 프로젝트가 없습니다.');
            return;
          }
          const flat: Array<{ text: string; value: string }> = [];
          const lookup: Record<string, any> = {};
          for (const [type, list] of session.presets.entries()) {
            for (const p of list) {
              const key = `${type} ${p.name}`;
              flat.push({ text: `${p.name} (${type})`, value: key });
              lookup[key] = p;
            }
          }
          if (flat.length === 0) {
            appState.pushMessage('현재 프로젝트에 프리셋이 없습니다.');
            return;
          }
          const key = await appState.pushDialogAsync({
            type: 'select',
            text: '불러올 프리셋',
            items: flat,
          });
          if (!key) return;
          await projectTemplateService.importSessionPreset(
            entry.id,
            lookup[key],
          );
        }
        setSyncKey((k) => k + 1);
        appState.pushMessage('프롬프트·샘플링 설정을 덮어썼습니다.');
      } catch (e: any) {
        appState.pushMessage(e.message || '불러오기에 실패했습니다.');
      }
    };

    // 카드 선택 모달에서 글로벌 프리셋 확정 — 기존 importGlobalPreset 흐름 그대로
    const pickGlobalPreset = async (globalId: string) => {
      setGlobalPickerOpen(false);
      try {
        await projectTemplateService.importGlobalPreset(templateId, globalId);
        setSyncKey((k) => k + 1);
        appState.pushMessage('프롬프트·샘플링 설정을 덮어썼습니다.');
      } catch (e: any) {
        appState.pushMessage(e.message || '불러오기에 실패했습니다.');
      }
    };

    // ----- 샘플링 인라인 커밋 -----
    // 숫자/셀렉트는 onChange 즉시 patchPreset 커밋 — 프롬프트와 달리 마운트
    // 클로저 캡처(저장 유실) 성질이 없어 안전하다. 값 표시는 entry.preset 직독.
    const patchSampling = (patch: Record<string, any>) => {
      projectTemplateService.patchPreset(templateId, patch).catch(() => {});
    };

    // ----- 캐릭터 프롬프트 (NAI 멀티 캐릭터, preset.characterPrompts) -----
    // 항상 서비스에서 최신 목록을 읽어 커밋한다 — 로컬 상태 캡처 없음(안전).
    const getCharPrompts = (): CharacterPrompt[] =>
      (projectTemplateService.get(templateId)?.preset?.characterPrompts ??
        []) as CharacterPrompt[];
    const commitCharPrompts = (list: CharacterPrompt[]) => {
      projectTemplateService
        .patchPreset(templateId, { characterPrompts: list })
        .catch(() => {});
    };
    const addCharPrompt = () => {
      commitCharPrompts([
        ...getCharPrompts(),
        {
          id: v4(),
          prompt: '',
          uc: '',
          position: { x: 0.5, y: 0.5 },
          enabled: true,
        },
      ]);
    };
    const updateCharPrompt = (
      id: string,
      updates: Partial<CharacterPrompt>,
    ) => {
      commitCharPrompts(
        getCharPrompts().map((c) => (c.id === id ? { ...c, ...updates } : c)),
      );
    };
    const removeCharPrompt = (id: string) => {
      commitCharPrompts(getCharPrompts().filter((c) => c.id !== id));
    };

    const clearStylePreset = () => {
      if (!entry || !entry.preset) return;
      appState.pushDialog({
        type: 'confirm',
        text: '프롬프트 영역(프리셋 1벌)을 비우시겠습니까?',
        callback: async () => {
          await projectTemplateService.removePreset(entry.id);
          setSyncKey((k) => k + 1);
        },
      });
    };

    // 캐릭터 프리셋 불러오기 = 목록에 추가 (여러 캐릭터 선적용 가능)
    const importCharacterPreset = async () => {
      if (!entry) return;
      const source = await appState.pushDialogAsync({
        type: 'select',
        text: '어디서 불러올까요? (목록에 추가됩니다)',
        items: [
          { text: '🌐 글로벌 캐릭터 프리셋에서', value: 'global' },
          { text: '📁 현재 프로젝트에서', value: 'session' },
        ],
      });
      if (!source) return;
      try {
        if (source === 'global') {
          if (!globalCharacterPresetService.loaded)
            await globalCharacterPresetService.load();
          const items = globalCharacterPresetService.list().map((p) => ({
            text: p.name,
            value: p.id,
          }));
          if (items.length === 0) {
            appState.pushMessage('글로벌 캐릭터 프리셋이 없습니다.');
            return;
          }
          const id = await appState.pushDialogAsync({
            type: 'select',
            text: '불러올 캐릭터 프리셋',
            items,
          });
          if (!id) return;
          await projectTemplateService.importGlobalCharacterPreset(
            entry.id,
            id,
          );
        } else {
          const session = appState.curSession;
          if (!session) {
            appState.pushMessage('열려 있는 프로젝트가 없습니다.');
            return;
          }
          const names = Array.from(session.characterPresets.keys());
          if (names.length === 0) {
            appState.pushMessage('현재 프로젝트에 캐릭터 프리셋이 없습니다.');
            return;
          }
          const name = await appState.pushDialogAsync({
            type: 'select',
            text: '불러올 캐릭터 프리셋',
            items: names.map((n) => ({ text: n, value: n })),
          });
          if (!name) return;
          const preset = session.characterPresets.get(name);
          if (!preset) return;
          await projectTemplateService.importSessionCharacterPreset(
            entry.id,
            session,
            preset,
          );
        }
        appState.pushMessage('캐릭터 프리셋을 추가했습니다.');
      } catch (e: any) {
        appState.pushMessage(e.message || '불러오기에 실패했습니다.');
      }
    };

    // 씬 불러오기 = 씬 구성 전체 교체 (일괄 적용)
    const importScenes = async () => {
      if (!entry) return;
      const sceneTemplates = templateService.listSceneTemplates();
      const items: Array<{ text: string; value: string }> = sceneTemplates.map(
        (n) => ({ text: `🧩 씬 프리셋: ${n}`, value: n }),
      );
      if (appState.curSession) {
        items.push({
          text: `📁 현재 프로젝트: ${appState.curSession.name}`,
          value: appState.curSession.name,
        });
      }
      if (items.length === 0) {
        appState.pushMessage(
          '불러올 소스가 없습니다. 씬 프리셋(씬 템플릿)을 만들거나 프로젝트를 열어주세요.',
        );
        return;
      }
      const src = await appState.pushDialogAsync({
        type: 'select',
        text: '어느 프로젝트의 씬으로 교체할까요? (전체 씬, 이미지 제외)',
        items,
      });
      if (!src) return;
      const run = async () => {
        try {
          const added = await projectTemplateService.importScenesFromProject(
            entry.id,
            src,
          );
          appState.pushMessage(
            added > 0
              ? `씬 구성을 ${added}개 씬으로 교체했습니다.`
              : '불러올 씬이 없어 기존 구성을 유지합니다.',
          );
        } catch (e: any) {
          appState.pushMessage(e.message || '불러오기에 실패했습니다.');
        }
      };
      if (entry.scenes.length > 0) {
        appState.pushDialog({
          type: 'confirm',
          text: `기존 씬 구성 ${entry.scenes.length}개를 새 구성으로 교체합니다. 계속할까요?`,
          callback: run,
        });
      } else {
        await run();
      }
    };

    // ----- 캐릭터 프리셋 편집 -----
    const startNewCharPreset = () => {
      const p = new CharacterPreset();
      p.name = '새 캐릭터 프리셋';
      setEditChar({ index: null, preset: p });
    };

    const startEditCharPreset = (index: number) => {
      if (!entry) return;
      const p = CharacterPreset.fromJSON(
        JSON.parse(JSON.stringify(entry.characterPresets[index])),
      );
      setEditChar({ index, preset: p });
    };

    const saveCharPreset = async (preset: CharacterPreset) => {
      if (!entry || !editChar) return;
      await projectTemplateService.putCharacterPreset(
        entry.id,
        preset.toJSON(),
        editChar.index ?? undefined,
      );
      setEditChar(null);
    };

    if (!entry) return null;

    return (
      <>
        {editChar ? (
          <CharacterPresetInnerEditor
            preset={editChar.preset}
            onSave={(p) => {
              saveCharPreset(p);
            }}
            onCancel={() => setEditChar(null)}
            isNew={editChar.index === null}
            imageBackend={templateImageBackend}
          />
        ) : (
          (() => {
            // ----- 섹션 요소 (배치 R3: 편집 탭·일괄 생성 탭이 같은 실물을
            // 공유한다 — JSX 중복 금지, 상태·커밋 로직 단일 출처) -----
            // 프롬프트(+샘플링) — 양 탭 공유
            const promptSection = (
            <div className={sectionCls}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-default flex-1">
                  프롬프트
                </span>
                {entry.preset && (
                  <Tooltip content="프롬프트 영역 비우기">
                    <button
                      className={iconBtnCls + ' hover:text-red-500'}
                      onClick={clearStylePreset}
                    >
                      <FaTimes size={13} />
                    </button>
                  </Tooltip>
                )}
                <button className={addBtnCls} onClick={importStylePreset}>
                  <FaCloudDownloadAlt className="inline mr-1" size={11} />
                  불러오기
                </button>
              </div>
              {!entry.preset && (
                <div className="text-xs text-faint">
                  아래에 직접 입력하거나 글로벌 프리셋을 불러오세요. 비워 두면
                  새 프로젝트는 기본 프리셋으로 시작합니다.
                </div>
              )}
              <div>
                <div className="text-xs font-medium text-muted mb-1">
                  상위 프롬프트
                </div>
                <PromptEditTextArea
                  value={frontPrompt}
                  onChange={(v: string) => {
                    setFrontPrompt(v);
                    promptRef.current = {
                      ...promptRef.current,
                      frontPrompt: v,
                    };
                  }}
                  disabled={false}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-muted mb-1">
                  하위 프롬프트
                </div>
                <PromptEditTextArea
                  value={backPrompt}
                  onChange={(v: string) => {
                    setBackPrompt(v);
                    promptRef.current = {
                      ...promptRef.current,
                      backPrompt: v,
                    };
                  }}
                  disabled={false}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-muted mb-1">
                  네거티브 프롬프트
                </div>
                <PromptEditTextArea
                  value={uc}
                  onChange={(v: string) => {
                    setUc(v);
                    promptRef.current = { ...promptRef.current, uc: v };
                  }}
                  disabled={false}
                />
              </div>
              {/* 샘플링 설정 (인라인 — 변경 즉시 저장) */}
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-default">
                  스탭 수
                  <input
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={
                      typeof entry.preset?.steps === 'number'
                        ? entry.preset.steps
                        : 28
                    }
                    onChange={(e) =>
                      patchSampling({ steps: Number(e.target.value) })
                    }
                    className={numCls}
                  />
                </label>
                <label className="text-sm text-default">
                  프롬프트 가이던스
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={
                      typeof entry.preset?.promptGuidance === 'number'
                        ? entry.preset.promptGuidance
                        : 5
                    }
                    onChange={(e) =>
                      patchSampling({ promptGuidance: Number(e.target.value) })
                    }
                    className={numCls}
                  />
                </label>
                <label className="text-sm text-default">
                  CFG 리스케일
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={
                      typeof entry.preset?.cfgRescale === 'number'
                        ? entry.preset.cfgRescale
                        : 0
                    }
                    onChange={(e) =>
                      patchSampling({ cfgRescale: Number(e.target.value) })
                    }
                    className={numCls}
                  />
                </label>
                <label className="text-sm text-default">
                  샘플링
                  <select
                    value={entry.preset?.sampling ?? Sampling.KEulerAncestral}
                    onChange={(e) =>
                      patchSampling({ sampling: e.target.value })
                    }
                    className={numCls}
                  >
                    {Object.values(Sampling).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-default">
                  노이즈 스케줄
                  <select
                    value={
                      entry.preset?.noiseSchedule ?? NoiseSchedule.Karras
                    }
                    onChange={(e) =>
                      patchSampling({ noiseSchedule: e.target.value })
                    }
                    className={numCls}
                  >
                    {Object.values(NoiseSchedule).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            );
            // 캐릭터 프리셋 목록 — 편집 탭 전용 (배치 탭은 이 자리에 캐릭터 축)
            const charPresetSection = (
            <div className={sectionCls}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-default flex-1">
                  캐릭터 프리셋 ({entry.characterPresets.length})
                </span>
                <button className={addBtnCls} onClick={startNewCharPreset}>
                  <FaPlus className="inline mr-1" size={10} />
                  새로 만들기
                </button>
                <button className={addBtnCls} onClick={importCharacterPreset}>
                  <FaCloudDownloadAlt className="inline mr-1" size={11} />
                  불러오기
                </button>
              </div>
              {entry.characterPresets.length === 0 && (
                <div className="text-xs text-faint">
                  없음 — 직접 만들거나 불러오면 새 프로젝트에 캐릭터
                  프리셋(바이브·레퍼런스 포함)이 선적용됩니다.
                </div>
              )}
              {entry.characterPresets.map((cp, i) => (
                <div key={i} className={rowCls}>
                  <span className="text-sm text-default truncate flex-1">
                    {cp.name}
                    <span className="text-xs text-faint ml-1.5">
                      {(cp.vibes?.length || 0) > 0 && `V:${cp.vibes.length} `}
                      {(cp.characterReferences?.length || 0) > 0 &&
                        `R:${cp.characterReferences.length}`}
                    </span>
                  </span>
                  <Tooltip content="편집">
                    <button
                      className={iconBtnCls}
                      onClick={() => startEditCharPreset(i)}
                    >
                      <FaPen size={12} />
                    </button>
                  </Tooltip>
                  <Tooltip content="제거">
                    <button
                      className={iconBtnCls + ' hover:text-red-500'}
                      onClick={() =>
                        projectTemplateService.removeCharacterPreset(
                          entry.id,
                          i,
                        )
                      }
                    >
                      <FaTimes size={13} />
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>
            );
            // 캐릭터 프롬프트·바이브·레퍼런스 — 편집 탭 전용. 배치 탭에선
            // 노출하지 않는다(수동 삽입의 영향이 불확실 — 캐릭터 프리셋 축
            // 사용으로 유도, 2026-07-17 결정).
            // (캐릭터 프롬프트 데이터는 프리셋 소속(preset.characterPrompts)
            // 이지만 사용자 관점에선 캐릭터 세팅의 일부 — 캐릭터 프리셋과
            // 바이브 사이 배치, 2026-07-16 실기 피드백)
            const middleSections = (
            <>
            <div className={sectionCls}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-default flex-1">
                  캐릭터 프롬프트 (
                  {(entry.preset?.characterPrompts?.length ?? 0) as number})
                </span>
                <button className={addBtnCls} onClick={addCharPrompt}>
                  <FaPlus className="inline mr-1" size={10} />
                  캐릭터 추가
                </button>
              </div>
              {(entry.preset?.characterPrompts?.length ?? 0) === 0 && (
                <div className="text-xs text-faint">
                  없음 — 멀티 캐릭터 프롬프트를 미리 세팅하면 새 프로젝트의
                  프리셋에 그대로 적용됩니다.
                </div>
              )}
              {((entry.preset?.characterPrompts ??
                []) as CharacterPrompt[]).map((character, i) => (
                <div
                  key={character.id || i}
                  className={`border rounded-md r-card mt-2 p-3 ${
                    character.enabled === false
                      ? 'opacity-60 line-color'
                      : 'border-sky-500 bg-[var(--c-surface-2)]'
                  }`}
                >
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2 gray-label">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                        style={{
                          backgroundColor: charColors[i % charColors.length],
                        }}
                      >
                        {i + 1}
                      </div>
                      캐릭터 프롬프트
                    </div>
                    <div className="flex items-center gap-2">
                      <Tooltip
                        content={
                          character.enabled !== false ? '비활성화' : '활성화'
                        }
                      >
                        <button
                          className={`round-button h-8 px-4 ${
                            character.enabled !== false
                              ? 'back-sky'
                              : 'back-gray'
                          }`}
                          onClick={() =>
                            updateCharPrompt(character.id, {
                              enabled: character.enabled === false,
                            })
                          }
                        >
                          {character.enabled !== false ? (
                            <FaToggleOn className="mr-1" />
                          ) : (
                            <FaToggleOff className="mr-1" />
                          )}
                          {character.enabled !== false
                            ? '활성화됨'
                            : '비활성화됨'}
                        </button>
                      </Tooltip>
                      <Tooltip content="캐릭터 삭제">
                        <button
                          className="icon-button back-red"
                          onClick={() => removeCharPrompt(character.id)}
                        >
                          <FaTrash />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="mb-2">
                    <PromptEditTextArea
                      value={character.prompt}
                      onChange={(value: string) =>
                        updateCharPrompt(character.id, { prompt: value })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2 gray-label mb-1">
                    네거티브 프롬프트
                  </div>
                  <PromptEditTextArea
                    value={character.uc}
                    onChange={(value: string) =>
                      updateCharPrompt(character.id, { uc: value })
                    }
                  />
                </div>
              ))}
            </div>
            {/* 바이브 이미지 (프로젝트 공통 — 캐릭터 프리셋 없이 직접 지정) */}
            <div className={sectionCls}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-default flex-1">
                  바이브 이미지 ({entry.vibes?.length ?? 0})
                </span>
              </div>
              <div className="text-xs text-faint">
                캐릭터 프리셋을 거치지 않고 프로젝트 공통 바이브로 적용됩니다.
                아래에 이미지를 드래그하거나 클릭해 추가하세요.
              </div>
              <FileUploadBase64
                notext
                disabled={false}
                onFileSelect={(b64: string) => {
                  if (b64)
                    projectTemplateService
                      .addVibe(entry.id, b64)
                      .catch((e: any) =>
                        appState.pushMessage(e.message || '추가에 실패했습니다.'),
                      );
                }}
              />
              {(entry.vibes || []).map((v, i) => (
                <div
                  key={(v.path || '') + i}
                  className="border line-color mt-1 p-2 flex md:flex-row flex-col gap-2 items-start rounded-lg"
                >
                  <VibeImage
                    path={templateImageBackend.vibePath(v.path)}
                    className="flex-none w-28 h-28 object-cover rounded"
                  />
                  <div className="flex flex-col gap-2 w-full min-w-0">
                    <div className="flex w-full items-center md:flex-row flex-col">
                      <div className="whitespace-nowrap flex-none mr-auto md:mr-2 gray-label">
                        정보 추출률 (IS):
                      </div>
                      <div className="flex flex-1 md:w-auto w-full gap-1">
                        <input
                          className="flex-1 min-w-0"
                          type="range"
                          step="0.01"
                          min="0"
                          max="1"
                          value={v.info}
                          onChange={(e) =>
                            projectTemplateService.updateVibe(entry.id, i, {
                              info: parseFloat(e.target.value),
                            })
                          }
                        />
                        <EditableSliderValue
                          value={v.info}
                          min={0}
                          max={1}
                          onChange={(val: number) =>
                            projectTemplateService.updateVibe(entry.id, i, {
                              info: val,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="flex w-full items-center md:flex-row flex-col">
                      <div className="whitespace-nowrap flex-none mr-auto md:mr-2 gray-label">
                        레퍼런스 강도 (RS):
                      </div>
                      <div className="flex flex-1 md:w-auto w-full gap-1">
                        <input
                          className="flex-1 min-w-0"
                          type="range"
                          step="0.01"
                          min="0"
                          max="1"
                          value={v.strength}
                          onChange={(e) =>
                            projectTemplateService.updateVibe(entry.id, i, {
                              strength: parseFloat(e.target.value),
                            })
                          }
                        />
                        <EditableSliderValue
                          value={v.strength}
                          min={0}
                          max={1}
                          onChange={(val: number) =>
                            projectTemplateService.updateVibe(entry.id, i, {
                              strength: val,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="flex justify-end mt-auto">
                      <Tooltip content="바이브 삭제">
                        <button
                          className="round-button h-8 px-6 back-red"
                          onClick={() =>
                            projectTemplateService.removeVibe(entry.id, i)
                          }
                        >
                          <FaTrash />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* 캐릭터 레퍼런스 (프로젝트 공통 — 캐릭터 프리셋 없이 직접 지정) */}
            <div className={sectionCls}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-default flex-1">
                  캐릭터 레퍼런스 ({entry.characterReferences?.length ?? 0})
                </span>
              </div>
              <div className="text-xs text-faint">
                프로젝트 공통 캐릭터 레퍼런스로 적용됩니다. 아래에 이미지를
                드래그하거나 클릭해 추가하세요.
              </div>
              <FileUploadBase64
                notext
                disabled={false}
                onFileSelect={(b64: string) => {
                  if (b64)
                    projectTemplateService
                      .addCharacterReference(entry.id, b64)
                      .catch((e: any) =>
                        appState.pushMessage(e.message || '추가에 실패했습니다.'),
                      );
                }}
              />
              {(entry.characterReferences || []).map((r, i) => (
                <div
                  key={(r.path || '') + i}
                  className={`mt-1 p-2 flex md:flex-row flex-col gap-2 items-start rounded-lg ${
                    r.enabled !== false
                      ? 'border border-sky-500 bg-[var(--c-surface-2)]'
                      : 'border line-color opacity-60'
                  }`}
                >
                  <VibeImage
                    path={templateImageBackend.referencePath(r.path)}
                    className="flex-none w-28 h-28 object-cover rounded"
                  />
                  <div className="flex flex-col gap-2 w-full min-w-0">
                    {/* 활성화 토글 + 삭제 */}
                    <div className="flex items-center justify-between">
                      <button
                        className={`text-sm px-3 py-1 rounded flex items-center gap-1 transition-colors ${
                          r.enabled !== false
                            ? 'bg-sky-500 text-white'
                            : 'bg-gray-200 dark:bg-slate-600 text-muted'
                        }`}
                        onClick={() =>
                          projectTemplateService.updateCharacterReference(
                            entry.id,
                            i,
                            { enabled: r.enabled === false },
                          )
                        }
                      >
                        {r.enabled !== false ? (
                          <FaToggleOn size={13} />
                        ) : (
                          <FaToggleOff size={13} />
                        )}
                        {r.enabled !== false ? '활성화됨' : '비활성화됨'}
                      </button>
                      <Tooltip content="레퍼런스 삭제">
                        <button
                          className="round-button h-8 px-6 back-red"
                          onClick={() =>
                            projectTemplateService.removeCharacterReference(
                              entry.id,
                              i,
                            )
                          }
                        >
                          <FaTrash />
                        </button>
                      </Tooltip>
                    </div>
                    {/* Strength */}
                    <div className="flex w-full items-center md:flex-row flex-col">
                      <div className="whitespace-nowrap flex-none mr-auto md:mr-2 gray-label">
                        Strength:
                      </div>
                      <div className="flex flex-1 md:w-auto w-full gap-1">
                        <input
                          className="flex-1 min-w-0"
                          type="range"
                          step="0.01"
                          min="0"
                          max="2"
                          value={r.strength}
                          onChange={(e) =>
                            projectTemplateService.updateCharacterReference(
                              entry.id,
                              i,
                              { strength: parseFloat(e.target.value) },
                            )
                          }
                        />
                        <EditableSliderValue
                          value={r.strength}
                          min={0}
                          max={2}
                          onChange={(val: number) =>
                            projectTemplateService.updateCharacterReference(
                              entry.id,
                              i,
                              { strength: val },
                            )
                          }
                        />
                      </div>
                    </div>
                    {/* Fidelity */}
                    <div className="flex w-full items-center md:flex-row flex-col">
                      <div className="whitespace-nowrap flex-none mr-auto md:mr-2 gray-label">
                        Fidelity:
                      </div>
                      <div className="flex flex-1 md:w-auto w-full gap-1">
                        <input
                          className="flex-1 min-w-0"
                          type="range"
                          step="0.01"
                          min="0"
                          max="2"
                          value={r.fidelity}
                          onChange={(e) =>
                            projectTemplateService.updateCharacterReference(
                              entry.id,
                              i,
                              { fidelity: parseFloat(e.target.value) },
                            )
                          }
                        />
                        <EditableSliderValue
                          value={r.fidelity}
                          min={0}
                          max={2}
                          onChange={(val: number) =>
                            projectTemplateService.updateCharacterReference(
                              entry.id,
                              i,
                              { fidelity: val },
                            )
                          }
                        />
                      </div>
                    </div>
                    {/* 레퍼런스 타입 */}
                    <div className="flex items-center gap-4 flex-wrap">
                      {(['character', 'style', 'character&style'] as const).map(
                        (t) => (
                          <label
                            key={t}
                            className="flex items-center gap-1 cursor-pointer"
                          >
                            <input
                              type="radio"
                              name={`tpl-refType-${entry.id}-${i}`}
                              checked={r.referenceType === t}
                              onChange={() =>
                                projectTemplateService.updateCharacterReference(
                                  entry.id,
                                  i,
                                  { referenceType: t },
                                )
                              }
                              className="accent-sky-500"
                            />
                            <span className="gray-label">
                              {t === 'character'
                                ? '캐릭터'
                                : t === 'style'
                                  ? '스타일'
                                  : '캐릭터+스타일'}
                            </span>
                          </label>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </>
            );
            // 씬 구성 — 편집 탭 전용 (배치 탭은 이 자리에 씬 축)
            const sceneSection = (
            <div className={sectionCls}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-default flex-1">
                  씬 구성 ({entry.scenes.length})
                </span>
                <button className={addBtnCls} onClick={importScenes}>
                  <FaCloudDownloadAlt className="inline mr-1" size={11} />
                  불러오기
                </button>
              </div>
              {entry.scenes.length === 0 ? (
                <div className="text-xs text-faint">
                  없음 — 새 프로젝트는 빈 씬 1개로 시작합니다. 불러오기 = 선택한
                  프로젝트/씬 프리셋의 씬 전체로 교체.
                </div>
              ) : (
                <div className="text-xs text-faint">
                  씬 내용 수정은 원본 프로젝트에서 고친 뒤 다시 불러와
                  교체해주세요.
                </div>
              )}
              {/* 씬이 많아도(수십 개) 모달 전체 스크롤이 밀리지 않도록
                  목록만 자체 스크롤 컨테이너에 가둔다 */}
              {entry.scenes.length > 0 && (
                <div className="max-h-60 overflow-y-auto pr-1 flex flex-col gap-2">
                  {entry.scenes.map((s, i) => (
                    <div key={i} className={rowCls + ' flex-none'}>
                      <span className="text-sm text-default truncate flex-1">
                        {s.name}
                      </span>
                      <Tooltip content="제거">
                        <button
                          className={iconBtnCls + ' hover:text-red-500'}
                          onClick={() =>
                            projectTemplateService.removeScene(entry.id, i)
                          }
                        >
                          <FaTimes size={13} />
                        </button>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
            // ----- 레이아웃: [템플릿]|[일괄 생성] 탭 전환 (배치 R3) -----
            return (
              <div className="flex flex-col gap-4">
                {/* 탭 헤더 — tab-seg 마커 계약 (SPEC_GUIDE §2, back-llgray/
                    rounded-md 는 클래식 마감 복원용 병기). 배치 탭의 프리셋
                    즉석 생성(전체 영역 전환) 중에는 숨긴다. */}
                {!batchCharEditing && (
                <div className="tab-seg flex gap-2">
                  {(
                    [
                      ['template', '템플릿'],
                      ['batch', '일괄 생성'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      className={
                        'active:brightness-90 hover:brightness-95 select-none h-8 px-4 text-sm rounded-md transition-colors ' +
                        (tab === key ? 'back-sky' : 'back-llgray tab-seg-off')
                      }
                      onClick={() => {
                        if (batchRunning) {
                          appState.pushMessage(
                            '일괄 생성이 진행 중입니다 — 완료 후 전환할 수 있습니다.',
                          );
                          return;
                        }
                        setTab(key);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                )}
                {tab === 'template' ? (
                  <>
                    {promptSection}
                    {charPresetSection}
                    {middleSections}
                    {sceneSection}
                    {/* 명시적 저장 */}
                    <div className="flex justify-end">
                      <button
                        className="px-5 py-2 rounded-lg text-sm font-medium btn-solid-sky"
                        onClick={saveTemplate}
                      >
                        저장
                      </button>
                    </div>
                  </>
                ) : (
                  <BatchCreatePanel
                    templateId={templateId}
                    batchFolder={batchFolder}
                    onCompleted={onBatchCompleted}
                    onRunningChange={(r) => {
                      setBatchRunning(r);
                      onBatchRunningChange?.(r);
                    }}
                    isPromptFilled={() =>
                      !!(
                        promptRef.current.frontPrompt.trim() ||
                        promptRef.current.backPrompt.trim()
                      )
                    }
                    beforeExecute={commitPrompts}
                    renderPromptSection={() => promptSection}
                    onEditingChange={(v) => {
                      setBatchCharEditing(v);
                      // 호스트 상단 조작도 같이 숨긴다 (편집 탭의 캐릭터
                      // 프리셋 편집과 같은 동선)
                      onEditingCharChange?.(v);
                    }}
                  />
                )}
              </div>
            );
          })()
        )}
        {globalPickerOpen && (
          <GlobalPresetPickerModal
            isOpen={globalPickerOpen}
            onClose={() => setGlobalPickerOpen(false)}
            onPick={pickGlobalPreset}
          />
        )}
      </>
    );
  },
);

// ===== "템플릿 관리" 오버레이 (전역 템플릿 목록 + CRUD + 편집기) =====
export const TemplateManagerModal = observer(
  ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    const [selectedId, setSelectedId] = useState<string>('');
    // 편집기가 캐릭터 편집 화면으로 전환되면 상단(안내문·CRUD 행)을 숨긴다
    const [charEditing, setCharEditing] = useState(false);
    // 일괄 생성(배치 탭) 실행 중 — 모달 닫기 차단 (배치 R3, 전역 호스트)
    const [batchRunning, setBatchRunning] = useState(false);
    const commitRef = useRef<() => void>(() => {});

    // 실행 중 닫기 차단 — 진행률·취소 수단 유실 방지
    const guardedClose = () => {
      if (batchRunning) {
        appState.pushMessage(
          '일괄 생성이 진행 중입니다 — [취소] 버튼으로 중단한 뒤 닫을 수 있습니다.',
        );
        return;
      }
      onClose();
    };

    useEffect(() => {
      if (!isOpen) return;
      (async () => {
        await projectTemplateService.ensureLoaded();
        await templateService.ensureLoaded();
        setCharEditing(false);
        setSelectedId((prev) => {
          const globals = projectTemplateService.listGlobal();
          return prev && globals.some((t) => t.id === prev)
            ? prev
            : (globals[0]?.id ?? '');
        });
      })();
    }, [isOpen]);

    const templates = projectTemplateService.listGlobal();
    const entry = selectedId
      ? projectTemplateService.get(selectedId)
      : undefined;

    // ----- 템플릿 CRUD -----
    // 전환·닫기 시 프롬프트 커밋은 편집기의 언마운트 훅이 담당한다.
    const createTemplate = async () => {
      const name = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '새 템플릿 이름을 입력해주세요',
      });
      if (!name) return;
      const created = await projectTemplateService.create(name);
      setSelectedId(created.id);
    };

    const renameTemplate = async () => {
      if (!entry) return;
      const name = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '새 템플릿 이름을 입력해주세요',
      });
      if (!name) return;
      try {
        await projectTemplateService.rename(entry.id, name);
      } catch (e: any) {
        appState.pushMessage(e.message || '이름 변경에 실패했습니다');
      }
    };

    const duplicateTemplate = async () => {
      if (!entry) return;
      commitRef.current(); // 편집 중 프롬프트까지 포함해 복제
      const clone = await projectTemplateService.duplicate(entry.id);
      setSelectedId(clone.id);
    };

    const deleteTemplate = () => {
      if (!entry) return;
      appState.pushDialog({
        type: 'confirm',
        text: `템플릿 "${entry.name}"을(를) 삭제하시겠습니까?\n(이 템플릿을 쓰는 폴더 자동 적용 지정도 해제됩니다)`,
        callback: async () => {
          await projectTemplateService.delete(entry.id);
          setSelectedId(projectTemplateService.listGlobal()[0]?.id ?? '');
        },
      });
    };

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={guardedClose}
        title={
          <span className="inline-flex items-center gap-1.5">
            템플릿 관리
            <HelpIcon
              content={
                '새 프로젝트 생성 시 시작 구성(프리셋, 캐릭터, 바이브, 레퍼런스, 씬)을 자동 세팅합니다.\n' +
                '프롬프트는 [저장] 시점에, 나머지 항목은 즉시 저장됩니다.'
              }
            />
          </span>
        }
        width="max-w-3xl"
      >
        <div className="flex flex-col gap-4">
          {/* 배치 실행 중엔 상단 CRUD(전환·삭제 등)도 잠근다 — 실행 대상
              템플릿을 도중에 바꾸거나 지우는 사고 방지 (배치 R3) */}
          {!charEditing && !batchRunning && (
            <>
              <p className="text-sm text-muted">
                템플릿은 새 프로젝트의 시작 구성을 미리 세팅하는
                워크플로우입니다. 모든 영역은 직접 편집할 수 있고, 불러오기는
                설정을 1회 덮어쓰는 편의 기능입니다. 프롬프트 수정은 아래{' '}
                <b>[저장]</b> 버튼 또는 창을 닫을 때 저장되고, 그 외 변경
                (불러오기·캐릭터·씬)은 즉시 저장됩니다.
              </p>
              {/* 템플릿 선택 + CRUD */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <select
                  className="gray-input flex-1 min-w-[140px]"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  {templates.length === 0 && (
                    <option value="">템플릿 없음</option>
                  )}
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <Tooltip content="새 템플릿">
                  <button className={iconBtnCls} onClick={createTemplate}>
                    <FaPlus size={14} />
                  </button>
                </Tooltip>
                {entry && (
                  <>
                    <Tooltip content="이름 변경">
                      <button className={iconBtnCls} onClick={renameTemplate}>
                        <FaPen size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="복제">
                      <button
                        className={iconBtnCls}
                        onClick={duplicateTemplate}
                      >
                        <FaCopy size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="삭제">
                      <button
                        className={iconBtnCls + ' hover:text-red-500'}
                        onClick={deleteTemplate}
                      >
                        <FaTrashAlt size={14} />
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
            </>
          )}
          {!entry ? (
            <div className="text-sm text-default py-6 text-center">
              템플릿이 없습니다. <b>+</b> 버튼으로 새 템플릿을 만들어주세요.
            </div>
          ) : (
            <TemplateWorkflowEditor
              key={entry.id}
              templateId={entry.id}
              commitRef={commitRef}
              onEditingCharChange={setCharEditing}
              onBatchRunningChange={setBatchRunning}
            />
          )}
        </div>
      </ModalOverlay>
    );
  },
);
