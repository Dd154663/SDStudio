import { EmptyState } from './EmptyState';
import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 } from 'uuid';
import {
  FaPlay,
  FaPlus,
  FaPen,
  FaStop,
  FaTimes,
  FaToggleOn,
  FaToggleOff,
  FaTrash,
  FaFileArchive,
  FaFileImport,
  FaChevronDown,
  FaChevronUp,
} from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';
import ModalOverlay, { DIALOG_PRIMARY_BTN } from './ModalOverlay';
import Tooltip from './Tooltip';
import PromptEditTextArea from './PromptEditTextArea';
import { CharacterPresetInnerEditor } from './CharacterPresetInnerEditor';
import { PresetImageBackend, storeWithSourceSize, VibeImage } from './CharacterPresetCards';
import { getImageDimensions } from './BrushTool';
import {
  REFERENCE_EDITOR_TEXT,
  referenceEditorSpec,
  showCostumeUnsupported,
} from '../models/referenceEditorSpec';
import { ReferenceTypeControl } from './ReferenceTypeControl';
import { BatchCreatePanel, BatchCreateController } from './BatchCreateModal';
import { GlobalPresetPicker } from './GlobalPresetPicker';
import { EditableSliderValue } from './VibeEditor';
import { ReferenceStrengthSlider } from './ReferenceStrengthSlider';
import { FileUploadBase64 } from './UtilComponents';
import {
  backend,
  globalCharacterPresetService,
  globalPresetService,
  isMobile,
  projectTemplateService,
  sessionService,
  templateService,
} from '../models';
import { appState } from '../models/AppService';
import { nameErrorMessage, promptName } from '../models/nameInput';
import {
  attachmentRemoveConfirmText,
  deleteConfirmText,
} from '../models/deleteFlowRules';
import { CharacterPreset, CharacterPrompt } from '../models/types';
import { Sampling, NoiseSchedule, ModelVersion } from '../backends/imageGen';
import HelpIcon from './HelpIcon';
import { SettingField, SettingGroup } from './SettingControls';
import { HelpPanelButton } from './HelpPanel';
import { TEMPLATE_MANAGER_HELP } from '../models/helpPanelTexts';
import { renameTemplateRecorded } from '../models/globalLibraryUndo';
import { V5MediumNegativeNotice } from './PreSetEdtior';
import { normalizeModelVersion } from '../backends/genVendors/naiModelCapabilities';
import {
  MODEL_FAMILY_LABEL,
  MODEL_FAMILY_NAME,
  MODEL_SAMPLING_FAMILIES,
  ModelSamplingFamily,
  V5_MEDIUM_TEXT,
} from '../models/modelSamplingProfiles';
import {
  TEMPLATE_SAMPLING_TEXT,
  TemplateSamplingField,
  buildTemplateSamplingPatch,
  initialTemplateSamplingFamily,
  readTemplateSamplingValue,
  templateSamplingLocks,
} from '../models/templateSamplingFamily';

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
// 편집기 본체(TemplateWorkflowBody + useTemplateWorkflowPanel)는 폴더 기본 템플릿 모달과 공유한다
// (폴더 템플릿 = 동일 화면 + 상단 "전역 템플릿 불러오기").

// 템플릿 이미지 디렉터리 기반 캐릭터 편집기 백엔드
const templateImageBackend: PresetImageBackend = {
  storeVibe: (b) => projectTemplateService.storeImageForEditor(b),
  storeReference: (b) =>
    storeWithSourceSize((x) => projectTemplateService.storeImageForEditor(x), b),
  vibePath: (t) => projectTemplateService.getImagePath(t),
  referencePath: (t) => projectTemplateService.getImagePath(t),
};

// 씬 구성 목록 기본 접힘 기준(이 개수를 넘으면 접힌 채로 시작) — 2026-11-15 실기 피드백 3
const SCENE_FOLD_THRESHOLD = 6;
const sectionCls =
  'p-3 rounded-lg border line-color bg-[var(--c-surface)] flex flex-col gap-2';
const rowCls =
  'flex items-center gap-2 px-2 py-1.5 rounded-md bg-[var(--c-surface-2)] border line-color';
const addBtnCls =
  'px-2 py-1 rounded-md text-xs btn-neutral text-body whitespace-nowrap';
const iconBtnCls = 'btn-ghost p-1.5 rounded-md text-muted'; // 아이콘만 버튼 = muted(SPEC §2 R2, 그룹 2-a)
// 백업/복원(드라이브 동기화 ④) — 글로벌 프리셋 탭 모바일 툴바 버튼과 같은 모양(작은 알약)
const backupBtnCls =
  'round-button back-gray h-8 px-3 text-sm flex items-center gap-1.5';
// 샘플링 인라인 컨트롤 입력 (PresetEditModal 과 동일 스타일)
const numCls =
  'mt-1 w-full px-2 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default';
// 모델이 고정·미사용으로 두는 샘플링 칸(V5M 스텝·샘플러·CFG 리스케일, V5 계열 노이즈 스케줄) — 표시만 고정, 저장값은 보존
const lockedCls = ' opacity-60 cursor-not-allowed';
// 선택 칸(샘플링·노이즈 스케줄, 2026-11-20 UI 정돈 그룹 1-c) = .app-select. 숫자 칸(numCls)과 같은 높이(위아래 6px + 글자 20 + 테두리).
// 잠금 표시는 .app-select:disabled 의 흐림(0.5)만 쓴다 — lockedCls 의 opacity-60 을 겹치면 0.3 까지 흐려진다.
const selectCls = 'mt-1 w-full app-select';
const selectLockedCls = ' cursor-not-allowed';
// PC 두 열 본문의 열(2026-11-15 C-3b) — 열마다 세로 스크롤 하나(SPEC 높이 규칙 우선순위 (2)). 일괄 생성 패널(BatchCreateModal batchColCls)과 같은 값.
const templateColCls =
  'flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col gap-4';
// 캐릭터 프롬프트 번호 마커 팔레트 (메인 화면 CharacterPromptEditor 와 동일)
const charColors = ['#38bdf8', '#f472b6', '#a78bfa', '#fb923c', '#4ade80', '#facc15', '#f87171', '#94a3b8'];

// ===== 템플릿 워크플로우 편집기 본문 (프롬프트/캐릭터/씬 3영역) =====
//
// 전역 "템플릿 관리"와 폴더 기본 템플릿 모달이 완전히 동일한 화면을 공유하는
// 단일 출처. key={templateId} 로 마운트해 템플릿 전환 시 상태를 초기화하고,
// 언마운트 시(창 닫기·전환 포함) 프롬프트 로컬 편집을 자동 커밋한다.
// 2026-11-15 오버레이 묶음 C-2(SPEC 「오버레이 창 크기 체계」 슬롯 규약 ⑥ 보강): 탭 머리·[저장]·[N개 생성]은
// 호스트 창의 도구줄·바닥줄로 옮겼다 — useTemplateWorkflowPanel 이 그 슬롯을 만들고, 프롬프트 상태·key 재마운트·
// 언마운트 커밋은 이 본문 컴포넌트에 그대로 남는다(훅으로 옮기지 않는다).
type TemplateWorkflowTab = 'template' | 'batch';

const TemplateWorkflowBody = observer(
  ({
    templateId,
    tab,
    syncSignal = 0,
    commitRef,
    saveRef,
    onEditingCharChange,
    batchFolder,
    onBatchCompleted,
    onBatchRunningChange,
    onControllerChange,
  }: {
    templateId: string;
    // [템플릿]|[일괄 생성] 탭 — 상태는 호스트 훅(useTemplateWorkflowPanel)이 든다
    tab: TemplateWorkflowTab;
    // 바닥줄 [저장]이 부르는 명시적 저장(saveTemplate) — 매 렌더 최신 함수로 등록
    saveRef?: React.MutableRefObject<() => Promise<void> | void>;
    // 일괄 생성 탭 바닥줄 조작 상태(BatchCreatePanel → 호스트 바닥줄)
    onControllerChange?: (c: BatchCreateController | null) => void;
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
    // 마지막으로 템플릿에서 읽어 온(동기화한) 프롬프트 값 — 커밋할 칸을 가린다
    const syncedPromptRef = useRef({ frontPrompt: '', backPrompt: '', uc: '' });
    // 외부 변경(불러오기·비우기) 후 인라인 필드 재동기화 트리거
    const [syncKey, setSyncKey] = useState(0);
    // 글로벌 프리셋 카드 선택 모달 (프롬프트 영역 불러오기)
    const [globalPickerOpen, setGlobalPickerOpen] = useState(false);
    // 씬 구성 목록 접기(2026-11-15 사용자 실기 피드백 3) — 씬이 많으면(기본 접힘 기준 SCENE_FOLD_THRESHOLD 초과)
    // 오른쪽 열 스크롤이 길어져 기본 접힘. 템플릿별 본문(key 재마운트)마다 초기화되는 가벼운 보기 상태.
    const [scenesOpen, setScenesOpen] = useState<boolean | null>(null);
    // 캐릭터 프리셋 편집 (CharacterPresetInnerEditor 인라인 전환)
    const [editChar, setEditChar] = useState<{
      index: number | null; // null = 새로 만들기
      preset: CharacterPreset;
    } | null>(null);

    // 샘플링 칸의 모델 계열 알약(2026-11-15 B안) — null = 아직 고르지 않음(미러 계열 → 앱 모델 계열 → 4.5 로 정한다).
    // 템플릿별 본문(key 재마운트)마다 초기화되는 보기 상태이고, 알약 전환 자체는 저장하지 않는다.
    const [pickedFamily, setPickedFamily] = useState<ModelSamplingFamily | null>(null);
    const [globalModel, setGlobalModel] = useState<ModelVersion | undefined>(undefined);
    useEffect(() => {
      const loadModel = async () => {
        try {
          const config = await backend.getConfig();
          setGlobalModel(normalizeModelVersion(config.modelVersion));
        } catch {
          // 설정을 못 읽으면 미러 계열 → 4.5 규칙만 쓴다
        }
      };
      void loadModel();
      sessionService.addEventListener('config-changed', loadModel);
      return () => sessionService.removeEventListener('config-changed', loadModel);
    }, []);

    const entry = projectTemplateService.get(templateId);
    const samplingFamily: ModelSamplingFamily =
      pickedFamily ?? initialTemplateSamplingFamily(entry?.preset, globalModel);
    const samplingLocks = templateSamplingLocks(samplingFamily);
    // 캐릭터 레퍼런스 편집 규칙 — 템플릿을 적용한 뒤 생성은 전역 모델로 가므로 전역 모델 기준(referenceEditorSpec).
    const refSpec = referenceEditorSpec(globalModel);

    const asStr =(v: any) => (typeof v === 'string' ? v : '');

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
      syncedPromptRef.current = { ...next };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [templateId, syncKey, syncSignal]);

    // 프롬프트 로컬 편집값을 템플릿에 반영 — [저장]·언마운트 등 명시적
    // 시점에만 호출한다 (타이핑 중 자동 저장 없음).
    // 커밋은 이 창에서 실제로 고친 칸만 — 마지막 동기화 때 값과 다른 칸. 다른 창 저장으로 목록이 다시 읽혀 바뀐 칸을
    // 손대지 않은 초안 값으로 되돌려 덮지 않게 한다(2026-11-17 여러 창 동기화).
    const commitPrompts = () => {
      const e = projectTemplateService.get(templateId);
      if (!e) return;
      const v = promptRef.current;
      // 빈 템플릿에 빈 값 커밋 → 불필요한 골격 생성 방지
      if (!e.preset && !v.frontPrompt && !v.backPrompt && !v.uc) return;
      const synced = syncedPromptRef.current;
      const patch: Partial<typeof v> = {};
      for (const k of ['frontPrompt', 'backPrompt', 'uc'] as const) {
        if (v[k] !== synced[k] && asStr(e.preset?.[k]) !== v[k]) patch[k] = v[k];
      }
      if (Object.keys(patch).length === 0) return; // 변경 없음
      projectTemplateService
        .patchPreset(templateId, patch)
        .then(() => {
          syncedPromptRef.current = { ...syncedPromptRef.current, ...patch };
        })
        .catch(() => {});
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
    if (saveRef) saveRef.current = saveTemplate;

    // ----- 불러오기 -----

    // 프롬프트 영역 덮어쓰기 (글로벌 프리셋 / 현재 프로젝트)
    const importStylePreset = async () => {
      if (!entry) return;
      const source = await appState.pushDialogAsync({
        type: 'select',
        text: '어디서 복사해 올까요? (프롬프트·샘플링 설정을 1회 덮어씁니다)',
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
          const flat: Array<{ text: string; value: string; danger?: boolean }> = [];
          const lookup: Record<string, any> = {};
          for (const [type, list] of session.presets.entries()) {
            for (const p of list) {
              const key = `${type} ${p.name}`;
              // 고르는 즉시 프롬프트·샘플링 설정을 덮어쓴다 — 빨강(D1)
              flat.push({ text: `${p.name} (${type})`, value: key, danger: true });
              lookup[key] = p;
            }
          }
          if (flat.length === 0) {
            appState.pushMessage('현재 프로젝트에 프리셋이 없습니다.');
            return;
          }
          const key = await appState.pushDialogAsync({
            type: 'select',
            text: '복사해 올 프리셋',
            items: flat,
          });
          if (!key) return;
          await projectTemplateService.importSessionPreset(
            entry.id,
            lookup[key],
          );
        }
        setSyncKey((k) => k + 1);
        setPickedFamily(null); // 알약 = 복사해 온 프리셋의 미러 계열(없으면 앱 모델 계열)
        appState.pushMessage('프롬프트·샘플링 설정을 덮어썼습니다.');
      } catch (e: any) {
        appState.pushMessage(e.message || '복사하지 못했습니다.');
      }
    };

    // 카드 선택 모달에서 글로벌 프리셋 확정 — 기존 importGlobalPreset 흐름 그대로
    const pickGlobalPreset = async (globalId: string) => {
      setGlobalPickerOpen(false);
      try {
        await projectTemplateService.importGlobalPreset(templateId, globalId);
        setSyncKey((k) => k + 1);
        setPickedFamily(null); // 알약 = 복사해 온 글로벌 프리셋의 미러 계열(없으면 앱 모델 계열)
        appState.pushMessage('프롬프트·샘플링 설정을 덮어썼습니다.');
      } catch (e: any) {
        appState.pushMessage(e.message || '복사하지 못했습니다.');
      }
    };

    // ----- 샘플링 인라인 커밋 -----
    // 숫자/셀렉트는 onChange 즉시 patchPreset 커밋 — 프롬프트와 달리 마운트
    // 클로저 캡처(저장 유실) 성질이 없어 안전하다. 값 표시는 entry.preset 직독.
    // 2026-11-15 B안: 선택 계열의 값으로 읽고 쓴다(겉 필드 + samplingProfiles[계열] + samplingProfileFamily 를 한 번에).
    const patchSampling = (field: TemplateSamplingField, value: number | string) => {
      const current = projectTemplateService.get(templateId)?.preset;
      projectTemplateService
        .patchPreset(
          templateId,
          buildTemplateSamplingPatch(current, samplingFamily, field, value),
        )
        .catch(() => {});
    };
    const samplingValue = (field: TemplateSamplingField) =>
      readTemplateSamplingValue(entry?.preset, samplingFamily, field);

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
        danger: true,
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
        text: '어디서 복사해 올까요? (목록에 추가됩니다)',
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
            text: '복사해 올 캐릭터 프리셋',
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
            text: '복사해 올 캐릭터 프리셋',
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
        appState.pushMessage(e.message || '복사하지 못했습니다.');
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
          '복사해 올 소스가 없습니다. 씬 프리셋(씬 템플릿)을 만들거나 프로젝트를 열어주세요.',
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
              : '복사해 올 씬이 없어 기존 구성을 유지합니다.',
          );
        } catch (e: any) {
          appState.pushMessage(e.message || '복사하지 못했습니다.');
        }
      };
      if (entry.scenes.length > 0) {
        appState.pushDialog({
          type: 'confirm',
          danger: true,
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
            // PC = 돌아가기 줄 고정 → 두 열(열마다 스크롤) → 자체 바닥줄 [저장][취소]. 호스트가 이때
            // bodyPadding 'none' 을 준다(C-3a 캐릭터 프리셋 관리와 같은 모양, 2026-11-15 C-3b). 모바일 = 종전 inline.
            layout={isMobile ? 'inline' : 'frame'}
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
                  <ActionIcon id="copy-to-project" className="inline mr-1" size={11} />
                  복사해 오기
                </button>
              </div>
              {!entry.preset && (
                <div className="text-xs text-faint">
                  아래에 직접 입력하거나 글로벌 프리셋에서 복사해 오세요. 비워 두면
                  새 프로젝트는 기본 프리셋으로 시작합니다.
                </div>
              )}
              <div>
                <div className="text-xs font-medium text-muted mb-1">
                  상위 프롬프트
                </div>
                {/* min-h-20·max-h-40: 비어 있어도 3줄, 길어도 약 6줄까지만 자라고 그 뒤는 칸 안 스크롤(SPEC 높이 규칙 (3) 입력칸 고정 높이 허용, 2026-11-15) */}
                <div className="flex flex-col min-h-20 max-h-40" data-template-prompt-box="front">
                  <PromptEditTextArea
                    className="flex-1 min-h-0"
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
              </div>
              <div>
                <div className="text-xs font-medium text-muted mb-1">
                  하위 프롬프트
                </div>
                <div className="flex flex-col min-h-20 max-h-40" data-template-prompt-box="back">
                  <PromptEditTextArea
                    className="flex-1 min-h-0"
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
              </div>
              <div>
                <div className="text-xs font-medium text-muted mb-1">
                  네거티브 프롬프트
                </div>
                <div
                  className={
                    'flex flex-col min-h-20 max-h-40' +
                    (samplingLocks.negativeUnused ? ' opacity-60' : '')
                  }
                  data-template-prompt-box="uc"
                >
                  <PromptEditTextArea
                    className="flex-1 min-h-0"
                    value={uc}
                    onChange={(v: string) => {
                      setUc(v);
                      promptRef.current = { ...promptRef.current, uc: v };
                    }}
                    disabled={false}
                  />
                </div>
                {/* V5M: 입력은 막지 않고(값 보존) 흐리게 + 「쓰이지 않음」 안내 */}
                {samplingLocks.negativeUnused && <V5MediumNegativeNotice under />}
              </div>
              {/* 샘플링 설정 (인라인 — 변경 즉시 저장). 2026-11-15 B안: 머리 알약으로 고칠 모델 계열을 고른다
                  — 앱 모델은 바꾸지 않고, 선택 계열의 값(samplingProfiles[계열])을 읽고 쓴다.
                  모바일은 알약을 둘째 줄로(줄바꿈 허용, 가로 스크롤 없음).
                  2026-11-20 UI 정돈 그룹 1-c: 구획을 묶음 상자(SettingGroup 「샘플링」)로 — 제목은 상자 제목 한 번만이라
                  머리 줄의 「샘플링」 글자는 뺐다(모바일 첫 줄 = 도움말만, PC = 알약 줄 끝 도움말 그대로). */}
              <SettingGroup title="샘플링">
              <SettingField>
              <div
                className={
                  isMobile
                    ? 'flex flex-col gap-1.5'
                    : 'flex items-center gap-2 flex-wrap'
                }
                data-template-sampling-head={isMobile ? 'stacked' : 'row'}
              >
                {isMobile && (
                  <div className="flex items-center gap-2">
                    <HelpIcon content={TEMPLATE_SAMPLING_TEXT.familyHelp} size={13} />
                  </div>
                )}
                {/* 택일 묶음 .seg-group(UI 정돈 그룹 2-c — 종전 작은 알약 칩). 칩 자리라 작은 칸(.seg-sm 28px). */}
                <div
                  className="seg-group seg-sm inline-flex flex-wrap"
                  role="group"
                  aria-label="샘플링 값을 고칠 모델 계열"
                  data-template-sampling-family={samplingFamily}
                >
                  {MODEL_SAMPLING_FAMILIES.map((f) => {
                    const selected = samplingFamily === f;
                    return (
                      <button
                        key={f}
                        type="button"
                        className={
                          'seg-item text-xs' + (selected ? ' seg-on' : '')
                        }
                        data-family={f}
                        aria-pressed={selected}
                        aria-label={MODEL_FAMILY_NAME[f] + ' 계열 값 편집'}
                        onClick={() => setPickedFamily(f)}
                      >
                        {MODEL_FAMILY_LABEL[f]}
                      </button>
                    );
                  })}
                </div>
                {!isMobile && (
                  <HelpIcon content={TEMPLATE_SAMPLING_TEXT.familyHelp} size={13} />
                )}
              </div>
              </SettingField>
              <SettingField>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-default">
                  스탭 수
                  <input
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={samplingLocks.fixedSteps ?? samplingValue('steps')}
                    onChange={(e) =>
                      patchSampling('steps', Number(e.target.value))
                    }
                    disabled={samplingLocks.fixedSteps !== undefined}
                    title={
                      samplingLocks.fixedSteps !== undefined
                        ? V5_MEDIUM_TEXT.fixedField(String(samplingLocks.fixedSteps))
                        : undefined
                    }
                    className={
                      numCls + (samplingLocks.fixedSteps !== undefined ? lockedCls : '')
                    }
                  />
                  {samplingLocks.fixedSteps !== undefined && (
                    <div className="text-xs text-sub mt-1" data-template-v5m-fixed="steps">
                      {V5_MEDIUM_TEXT.fixedField(String(samplingLocks.fixedSteps))}
                    </div>
                  )}
                </label>
                <label className="text-sm text-default">
                  프롬프트 가이던스
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={samplingValue('promptGuidance')}
                    onChange={(e) =>
                      patchSampling('promptGuidance', Number(e.target.value))
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
                    value={samplingValue('cfgRescale')}
                    onChange={(e) =>
                      patchSampling('cfgRescale', Number(e.target.value))
                    }
                    disabled={samplingLocks.cfgRescaleUnsupported}
                    title={
                      samplingLocks.cfgRescaleUnsupported
                        ? V5_MEDIUM_TEXT.cfgRescaleUnsupported
                        : undefined
                    }
                    className={
                      numCls + (samplingLocks.cfgRescaleUnsupported ? lockedCls : '')
                    }
                  />
                  {samplingLocks.cfgRescaleUnsupported && (
                    <div className="text-xs text-sub mt-1" data-template-v5m-fixed="cfgRescale">
                      {V5_MEDIUM_TEXT.cfgRescaleUnsupported}
                    </div>
                  )}
                </label>
                <label className="text-sm text-default">
                  샘플링
                  <select
                    value={samplingLocks.fixedSampler ?? samplingValue('sampling')}
                    onChange={(e) => patchSampling('sampling', e.target.value)}
                    disabled={samplingLocks.fixedSampler !== undefined}
                    title={
                      samplingLocks.fixedSampler !== undefined
                        ? V5_MEDIUM_TEXT.fixedField(samplingLocks.fixedSampler)
                        : undefined
                    }
                    className={
                      selectCls + (samplingLocks.fixedSampler !== undefined ? selectLockedCls : '')
                    }
                  >
                    {Object.values(Sampling).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {samplingLocks.fixedSampler !== undefined && (
                    <div className="text-xs text-sub mt-1" data-template-v5m-fixed="sampling">
                      {V5_MEDIUM_TEXT.fixedField(samplingLocks.fixedSampler)}
                    </div>
                  )}
                </label>
                <label className="text-sm text-default">
                  노이즈 스케줄
                  <select
                    value={
                      samplingLocks.forcedNoiseSchedule ?? samplingValue('noiseSchedule')
                    }
                    onChange={(e) => patchSampling('noiseSchedule', e.target.value)}
                    disabled={samplingLocks.forcedNoiseSchedule !== undefined}
                    className={
                      selectCls +
                      (samplingLocks.forcedNoiseSchedule !== undefined ? selectLockedCls : '')
                    }
                  >
                    {Object.values(NoiseSchedule).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {samplingLocks.forcedNoiseSchedule !== undefined && (
                    <div className="text-xs text-sub mt-1" data-template-forced="noiseSchedule">
                      {TEMPLATE_SAMPLING_TEXT.noiseScheduleForced(
                        samplingLocks.forcedNoiseSchedule,
                      )}
                    </div>
                  )}
                </label>
              </div>
              </SettingField>
              {samplingLocks.negativeUnused && (
                <SettingField>
                <div className="text-xs text-sub" data-template-v5m-notice="">
                  {V5_MEDIUM_TEXT.modelNotice}
                </div>
                </SettingField>
              )}
              </SettingGroup>
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
                  <ActionIcon id="copy-to-project" className="inline mr-1" size={11} />
                  복사해 오기
                </button>
              </div>
              {entry.characterPresets.length === 0 && (
                <div className="text-xs text-faint">
                  없음 — 직접 만들거나 복사해 오면 새 프로젝트에 캐릭터
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
                      <ActionIcon id="edit" size={12} />
                    </button>
                  </Tooltip>
                  <Tooltip content="제거">
                    <button
                      className={iconBtnCls + ' hover:text-red-500'}
                      onClick={async () => {
                        // 제거하면 딸린 이미지 파일이 바로 영구 삭제된다 — 확인 1회(2026-10-03 E1-4)
                        if (
                          !(await appState.confirmAsync(
                            attachmentRemoveConfirmText({ what: '캐릭터 프리셋', name: cp.name }),
                          ))
                        )
                          return;
                        // 확인 창이 떠 있는 동안 목록이 바뀌어 같은 자리에 다른 항목이 오면 지우지 않는다
                        const cur = projectTemplateService.get(entry.id)?.characterPresets[i];
                        if (!cur || cur.name !== cp.name) return;
                        await projectTemplateService.removeCharacterPreset(entry.id, i);
                      }}
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
            // 2026-11-15 C-3b: PC 두 열 배치를 위해 캐릭터 프롬프트(왼쪽 열 — 글 입력) / 바이브·레퍼런스(오른쪽 열 —
            // 이미지)로 나눴다. JSX 실물은 그대로, 모바일 한 열 순서도 종전과 같다.
            const charPromptSection = (
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
                    {/* min-h-20·max-h-40: 비어 있어도 3줄, 길어도 약 6줄까지만 자라고 그 뒤는 칸 안 스크롤(SPEC 높이 규칙 (3) 입력칸 고정 높이 허용, 2026-11-15) */}
                    <div className="flex flex-col min-h-20 max-h-40" data-template-prompt-box="char-prompt">
                      <PromptEditTextArea
                        className="flex-1 min-h-0"
                        value={character.prompt}
                        onChange={(value: string) =>
                          updateCharPrompt(character.id, { prompt: value })
                        }
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 gray-label mb-1">
                    네거티브 프롬프트
                  </div>
                  <div className="flex flex-col min-h-20 max-h-40" data-template-prompt-box="char-uc">
                    <PromptEditTextArea
                      className="flex-1 min-h-0"
                      value={character.uc}
                      onChange={(value: string) =>
                        updateCharPrompt(character.id, { uc: value })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            );
            const vibeRefSections = (
            <>
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
                          className="round-button icon-only h-8 back-red"
                          onClick={async () => {
                            // 제거하면 이미지 파일이 바로 영구 삭제된다 — 확인 1회(2026-10-03 E1-4)
                            if (
                              !(await appState.confirmAsync(
                                attachmentRemoveConfirmText({ what: '이미지', name: `바이브 ${i + 1}` }),
                              ))
                            )
                              return;
                            const cur = projectTemplateService.get(entry.id)?.vibes?.[i];
                            if (!cur || cur.path !== v.path) return;
                            await projectTemplateService.removeVibe(entry.id, i);
                          }}
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
                    // 원본을 직접 넣는 경로 — 원본 크기를 항목에 적는다(V5 로 보낼 때 여백 자르기).
                    getImageDimensions(b64)
                      .catch(() => undefined)
                      .then((size) =>
                        projectTemplateService.addCharacterReference(
                          entry.id,
                          b64,
                          size && size.width > 0 && size.height > 0
                            ? { srcWidth: size.width, srcHeight: size.height }
                            : undefined,
                        ),
                      )
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
                            ? 'bg-sky-600 text-white dark:bg-sky-500'
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
                          className="round-button icon-only h-8 back-red"
                          onClick={async () => {
                            // 제거하면 이미지 파일이 바로 영구 삭제된다 — 확인 1회(2026-10-03 E1-4)
                            if (
                              !(await appState.confirmAsync(
                                attachmentRemoveConfirmText({
                                  what: '이미지',
                                  name: `레퍼런스 ${i + 1}`,
                                }),
                              ))
                            )
                              return;
                            const cur = projectTemplateService.get(entry.id)?.characterReferences?.[i];
                            if (!cur || cur.path !== r.path) return;
                            await projectTemplateService.removeCharacterReference(entry.id, i);
                          }}
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
                        <ReferenceStrengthSlider
                          value={r.strength}
                          max={refSpec.strengthMax}
                          onChange={(val) =>
                            projectTemplateService.updateCharacterReference(
                              entry.id,
                              i,
                              { strength: val },
                            )
                          }
                        />
                        <EditableSliderValue
                          value={r.strength}
                          min={0}
                          max={refSpec.strengthMax}
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
                    {/* Fidelity — 모델이 받지 않으면 숨김(저장값은 그대로) */}
                    {refSpec.showFidelity && (
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
                    )}
                    {/* 레퍼런스 타입 */}
                    <ReferenceTypeControl
                      type={r.referenceType}
                      preferSameOutfit={r.preferSameOutfit}
                      spec={refSpec}
                      onTypeChange={(t) =>
                        projectTemplateService.updateCharacterReference(
                          entry.id,
                          i,
                          // 종류를 바꾸면 「같은 의상 선호」 명시 값을 지워 그 종류의 기본으로
                          { referenceType: t, preferSameOutfit: undefined },
                        )
                      }
                      onSameOutfitChange={(checked) =>
                        projectTemplateService.updateCharacterReference(
                          entry.id,
                          i,
                          { preferSameOutfit: checked },
                        )
                      }
                    />
                    {showCostumeUnsupported(refSpec, r.referenceType) && (
                      <div className="text-xs text-muted">{REFERENCE_EDITOR_TEXT.costumeUnsupported}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            </>
            );
            // 씬 구성 — 편집 탭 전용 (배치 탭은 이 자리에 씬 축)
            const scenesExpanded =
              scenesOpen ?? entry.scenes.length <= SCENE_FOLD_THRESHOLD;
            const sceneSection = (
            <div className={sectionCls}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-default flex-1">
                  씬 구성 ({entry.scenes.length})
                </span>
                {entry.scenes.length > 0 && (
                  <button
                    className={addBtnCls}
                    onClick={() => setScenesOpen(!scenesExpanded)}
                    aria-expanded={scenesExpanded}
                    data-template-scenes-toggle=""
                  >
                    {scenesExpanded ? (
                      <FaChevronUp className="inline mr-1" size={10} />
                    ) : (
                      <FaChevronDown className="inline mr-1" size={10} />
                    )}
                    {scenesExpanded ? '접기' : '펼치기'}
                  </button>
                )}
                <button className={addBtnCls} onClick={importScenes}>
                  <ActionIcon id="copy-to-project" className="inline mr-1" size={11} />
                  복사해 오기
                </button>
              </div>
              {entry.scenes.length === 0 ? (
                <div className="text-xs text-faint">
                  없음 — 새 프로젝트는 빈 씬 1개로 시작합니다. 복사해 오기 = 선택한
                  프로젝트/씬 프리셋의 씬 전체로 교체.
                </div>
              ) : (
                <div className="text-xs text-faint">
                  씬 내용 수정은 원본 프로젝트에서 고친 뒤 다시 복사해 와
                  교체해주세요.
                </div>
              )}
              {/* 씬 목록 높이 상한 없음 — 열 스크롤 하나가 맡는다(2026-11-15 높이 규칙 우선순위). 접힘이면 목록 자체를 그리지 않는다 */}
              {entry.scenes.length > 0 && scenesExpanded && (
                <div className="flex flex-col gap-2" data-template-scenes-list="">
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
            // ----- 레이아웃: [템플릿]|[일괄 생성] 탭 내용 (배치 R3) — 탭 머리는 호스트 도구줄,
            // [저장]·[N개 생성]은 호스트 바닥줄(2026-11-15 묶음 C-2) -----
            // PC(2026-11-15 C-3b, SPEC 높이 규칙 우선순위 (2)): 본문은 h-full 로 창 본문을 채우고 스크롤하지 않으며,
            // 왼쪽 열 = 글 입력(프롬프트·캐릭터 프롬프트) / 오른쪽 열 = 카드·이미지·목록(캐릭터 프리셋·바이브·
            // 레퍼런스·씬 구성)이 열마다 스크롤 하나를 가진다. 일괄 생성 탭은 패널 안에서 같은 두 열을 만든다.
            // 모바일 = 종전 한 열(창 본문 스크롤 하나).
            if (!isMobile && tab === 'template') {
              return (
                <div className="h-full min-h-0 flex gap-4" data-template-body="two-col">
                  <div className={templateColCls} data-template-col="left">
                    {promptSection}
                    {charPromptSection}
                  </div>
                  <div className={templateColCls} data-template-col="right">
                    {charPresetSection}
                    {vibeRefSections}
                    {sceneSection}
                  </div>
                </div>
              );
            }
            return (
              <div className={isMobile ? 'flex flex-col gap-4' : 'h-full min-h-0'}>
                {tab === 'template' ? (
                  <>
                    {promptSection}
                    {charPresetSection}
                    {charPromptSection}
                    {vibeRefSections}
                    {sceneSection}
                  </>
                ) : (
                  <BatchCreatePanel
                    templateId={templateId}
                    batchFolder={batchFolder}
                    onCompleted={onBatchCompleted}
                    onRunningChange={(r) => onBatchRunningChange?.(r)}
                    isPromptFilled={() =>
                      !!(
                        promptRef.current.frontPrompt.trim() ||
                        promptRef.current.backPrompt.trim()
                      )
                    }
                    beforeExecute={commitPrompts}
                    renderPromptSection={() => promptSection}
                    // 전역 프리셋 즉석 생성 중 — 호스트가 탭 머리·바닥줄·상단 조작을 숨긴다
                    // (편집 탭의 캐릭터 프리셋 편집과 같은 동선)
                    onEditingChange={(v) => onEditingCharChange?.(v)}
                    onControllerChange={onControllerChange}
                  />
                )}
              </div>
            );
          })()
        )}
        {/* 글로벌 프리셋 카드 선택 — 공용 고르기 창(size xl·검색·정렬, 2026-11-14 M3). 고르면 덮어쓰기 확인 후
            기존 importGlobalPreset 흐름(pickGlobalPreset) 그대로 */}
        {globalPickerOpen && (
          <GlobalPresetPicker
            isOpen={globalPickerOpen}
            onClose={() => setGlobalPickerOpen(false)}
            onPick={pickGlobalPreset}
            title="글로벌 프리셋에서 복사"
            description="선택한 프리셋의 프롬프트·샘플링 설정을 이 템플릿에 1회 덮어씁니다."
            danger
          />
        )}
      </>
    );
  },
);

// ===== 공용 편집기 슬롯 훅 (2026-11-15 오버레이 묶음 C-2, SPEC 슬롯 규약 ⑥ 보강) =====
//
// 템플릿 관리·폴더 기본 템플릿 두 창이 같은 편집기를 ModalOverlay 슬롯에 나눠 넣는다:
//  tabs = [템플릿][일괄 생성] 알약 탭(도구줄) · body = 편집기 본문(key={templateId} 재마운트·언마운트 커밋 그대로) ·
//  footer = 템플릿 탭 [저장] / 일괄 생성 탭 [N개 생성] · footerStart = 일괄 생성 진행 「생성 중... n/m」+[취소] 또는 완료 요약.
// 훅은 호스트 슬롯에 필요한 것(탭·실행 중·캐릭터 편집 중·일괄 생성 조작 상태)만 든다 — 프롬프트 상태는 본문에.
// 캐릭터 프리셋 편집 중(charEditing)에는 tabs·footer·footerStart 가 비고(안쪽 편집기 자체 [저장][취소]), 호스트는
// 상단 조작을 숨기거나 잠근다.
export interface TemplateWorkflowPanelOptions {
  // 부모가 엔티티를 통째로 바꾼 뒤(전역 템플릿 불러오기·백업 복원) 재동기화 신호
  syncSignal?: number;
  // 부모가 언마운트 전에 강제 커밋해야 할 때(복제·백업·닫기 처리)
  commitRef?: React.MutableRefObject<() => void>;
  // 일괄 생성 탭의 폴더 컨텍스트(폴더 기본 템플릿 창만)
  batchFolder?: string;
  // 일괄 생성 실행 완료 통지(폴더 창의 전파 확인 기준 리셋)
  onBatchCompleted?: () => void;
}

export interface TemplateWorkflowPanel {
  tab: TemplateWorkflowTab;
  tabs: React.ReactNode;
  body: React.ReactNode;
  footer: React.ReactNode;
  footerStart: React.ReactNode;
  // 캐릭터 프리셋 편집(편집 탭)·전역 프리셋 즉석 생성(일괄 생성 탭) 중
  charEditing: boolean;
  // 일괄 생성 실행 중 — 호스트 닫기 차단·상단 조작 잠금
  batchRunning: boolean;
}

export function useTemplateWorkflowPanel(
  templateId: string | undefined,
  opts: TemplateWorkflowPanelOptions = {},
): TemplateWorkflowPanel {
  const { syncSignal, commitRef, batchFolder, onBatchCompleted } = opts;
  // 탭 — 템플릿이 바뀌면 렌더 즉시 「템플릿」(효과로 되돌리면 새 본문이 한 번 일괄 생성 탭으로 마운트된다)
  const [tabState, setTabState] = useState<{
    id: string | undefined;
    tab: TemplateWorkflowTab;
  }>({ id: undefined, tab: 'template' });
  const tab: TemplateWorkflowTab =
    tabState.id === templateId ? tabState.tab : 'template';
  const [charEditing, setCharEditing] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [controller, setController] = useState<BatchCreateController | null>(
    null,
  );
  const saveRef = useRef<() => Promise<void> | void>(() => {});

  // 템플릿 전환 — 캐릭터 편집 표시도 비운다(새 본문은 편집 중이 아니다)
  useEffect(() => {
    setCharEditing(false);
  }, [templateId]);

  const selectTab = (key: TemplateWorkflowTab) => {
    if (batchRunning) {
      appState.pushMessage(
        '일괄 생성이 진행 중입니다 — 완료 후 전환할 수 있습니다.',
      );
      return;
    }
    setTabState({ id: templateId, tab: key });
  };

  const show = !!templateId && !charEditing;

  // 탭 머리 = 작업 탭(본문이 템플릿 편집 ↔ 일괄 생성으로 통째로 바뀜) — 밑줄 탭 .tab-line(UI 정돈 그룹 2-c).
  // 창 도구줄에 이미 아래 테두리가 있어 줄 아래 가는 선은 빼고(.tab-line-bare) 도구줄 높이에 맞춰 32px(.tab-line-compact).
  const tabs = show ? (
    <div className="tab-line tab-line-bare tab-line-compact flex" data-template-tabs="">
      {(
        [
          ['template', '템플릿'],
          ['batch', '일괄 생성'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          className={
            'tab-line-item text-sm' + (tab === key ? ' tab-line-on' : '')
          }
          aria-pressed={tab === key}
          onClick={() => selectTab(key)}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null;

  const body = templateId ? (
    <TemplateWorkflowBody
      key={templateId}
      templateId={templateId}
      tab={tab}
      syncSignal={syncSignal}
      commitRef={commitRef}
      saveRef={saveRef}
      onEditingCharChange={setCharEditing}
      batchFolder={batchFolder}
      onBatchCompleted={onBatchCompleted}
      onBatchRunningChange={setBatchRunning}
      onControllerChange={setController}
    />
  ) : null;

  // 바닥줄 — 확정 버튼 규격(SPEC §5)
  let footer: React.ReactNode = null;
  let footerStart: React.ReactNode = null;
  if (show && tab === 'template') {
    footer = (
      <button
        className={DIALOG_PRIMARY_BTN}
        data-template-save=""
        onClick={() => {
          saveRef.current();
        }}
      >
        저장
      </button>
    );
  } else if (show && tab === 'batch') {
    const c = controller;
    footer = (
      <button
        className="px-4 py-2 rounded-lg text-sm font-medium btn-solid-purple transition-colors flex items-center gap-1.5"
        data-batch-run=""
        disabled={!c?.canRun}
        onClick={() => c?.execute()}
      >
        <FaPlay size={10} />
        {c?.running ? '생성 중...' : `${c?.count ?? 0}개 생성`}
      </button>
    );
    if (c?.running && c.progress) {
      footerStart = (
        <>
          <span className="text-sm text-default" data-batch-status="running">
            생성 중... {c.progress.done}/{c.progress.total}
          </span>
          <button
            className="px-3 py-1.5 rounded-lg text-sm font-medium btn-solid-red flex items-center gap-1.5"
            data-batch-cancel=""
            title="현재 항목 완료 후 중단"
            onClick={() => c.cancel()}
          >
            <FaStop size={10} />
            취소
          </button>
        </>
      );
    } else if (c?.result && !c.running) {
      footerStart = (
        <span className="text-sm text-default" data-batch-status="done">
          완료 — 성공 {c.result.created.length}개
          {c.result.failed.length > 0 && (
            <span className="text-red-500 dark:text-red-400">
              {' '}
              · 실패 {c.result.failed.length}개
            </span>
          )}
          {c.result.cancelled && ' (취소로 중단됨)'}
        </span>
      );
    }
  }

  return { tab, tabs, body, footer, footerStart, charEditing, batchRunning };
}

// ===== "템플릿 관리" 오버레이 (전역 템플릿 목록 + CRUD + 편집기) =====
// 2026-11-15 오버레이 묶음 C-2: size l(고정 760). PC = aside [새 템플릿]+템플릿 목록(선택 행에 [이름 변경][복제][삭제]),
// 도구줄 = [템플릿][일괄 생성] 탭 + [백업][백업 불러오기], 바닥줄 = 공용 훅의 [저장]/[N개 생성]·진행.
// 모바일 = aside 대신 종전 <select>+CRUD 아이콘을 도구줄 첫 줄에. 본문 스크롤 하나(높이 규칙 우선순위).
export const TemplateManagerModal = observer(
  ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    const [selectedId, setSelectedId] = useState<string>('');
    const commitRef = useRef<() => void>(() => {});
    // 백업 복원(덮어쓰기)으로 엔티티가 바뀐 뒤 편집기 프롬프트 재동기화 신호
    const [syncSignal, setSyncSignal] = useState(0);

    const templates = projectTemplateService.listGlobal();
    const entry = selectedId
      ? projectTemplateService.get(selectedId)
      : undefined;

    // 공용 편집기 슬롯 — 편집기가 캐릭터 편집 화면으로 전환되면(charEditing) 상단 조작을 숨기고 목록을 잠근다.
    // 일괄 생성(배치 탭) 실행 중(batchRunning)이면 모달 닫기 차단 (배치 R3, 전역 호스트)
    const panel = useTemplateWorkflowPanel(entry?.id, {
      syncSignal,
      commitRef,
    });
    const { charEditing, batchRunning } = panel;

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
        setSelectedId((prev) => {
          const globals = projectTemplateService.listGlobal();
          return prev && globals.some((t) => t.id === prev)
            ? prev
            : (globals[0]?.id ?? '');
        });
      })();
    }, [isOpen]);

    // ----- 템플릿 CRUD -----
    // 전환·닫기 시 프롬프트 커밋은 편집기의 언마운트 훅이 담당한다.
    const createTemplate = async () => {
      const name = await promptName({
        title: '새 템플릿 이름을 입력해주세요',
        kind: 'template',
        pathSafe: true,
        existing: (n) => !!projectTemplateService.getByName(n),
      });
      if (!name) return;
      const created = await projectTemplateService.create(name);
      setSelectedId(created.id);
    };

    const renameTemplate = async () => {
      if (!entry) return;
      // 현재 이름을 채워 연다 — 바꾸지 않고 확인하면 아무것도 하지 않는다(D2)
      const name = await promptName({
        title: '새 템플릿 이름을 입력해주세요',
        kind: 'template',
        pathSafe: true,
        current: entry.name,
        existing: (n) => {
          const other = projectTemplateService.getByName(n);
          return !!other && other.id !== entry.id;
        },
      });
      if (!name) return;
      try {
        await renameTemplateRecorded(entry.id, name);
      } catch (e: any) {
        appState.pushMessage(
          nameErrorMessage(e, 'template', name, '이름 변경에 실패했습니다'),
          'error',
        );
      }
    };

    const duplicateTemplate = async () => {
      if (!entry) return;
      commitRef.current(); // 편집 중 프롬프트까지 포함해 복제
      const clone = await projectTemplateService.duplicate(entry.id);
      setSelectedId(clone.id);
    };

    // ----- 백업/복원 (드라이브 동기화 ④ — 전역 템플릿 전체, tar) -----
    const backupTemplates = async () => {
      commitRef.current(); // 편집 중 프롬프트까지 포함해 백업
      await appState.projectTemplateBackupExport();
    };

    const restoreTemplates = async () => {
      // 편집 중 프롬프트를 먼저 반영 — 덮어쓰기 뒤 편집기의 옛 값이 되써지지 않게
      // 복원 후 재동기화한다(창 닫기 커밋이 복원 내용을 되돌리지 않도록).
      commitRef.current();
      await appState.projectTemplateBackupImport();
      setSyncSignal((s) => s + 1);
      setSelectedId((prev) => {
        const globals = projectTemplateService.listGlobal();
        return prev && globals.some((t) => t.id === prev)
          ? prev
          : (globals[0]?.id ?? '');
      });
    };

    const deleteTemplate = () => {
      if (!entry) return;
      appState.pushDialog({
        type: 'confirm',
        // 템플릿은 휴지통이 없다 — 영구 삭제(Enter 무시, 2026-10-03 E1)
        ...deleteConfirmText({
          kind: 'template',
          name: entry.name,
          outcome: 'permanent',
          extra: '이 템플릿을 쓰는 폴더 자동 적용 지정도 해제됩니다.',
        }),
        callback: async () => {
          await projectTemplateService.delete(entry.id);
          setSelectedId(projectTemplateService.listGlobal()[0]?.id ?? '');
        },
      });
    };

    // 배치 실행 중·캐릭터 편집 중엔 목록·CRUD(전환·삭제 등)를 잠근다 — 실행 대상
    // 템플릿을 도중에 바꾸거나 지우는 사고 방지 (배치 R3)
    const listLocked = charEditing || batchRunning;
    const lockedMessage = batchRunning
      ? '일괄 생성이 진행 중입니다 — 완료 후 바꿀 수 있습니다.'
      : '편집을 먼저 끝내세요';

    // 백업/복원 — 편집 중·실행 중엔 숨긴다(종전 상단 줄과 같은 조건)
    const backupButtons = !listLocked ? (
      <div className="flex items-center gap-1.5 ml-auto" data-template-backup="">
        <Tooltip
          content={
            templates.length === 0
              ? '백업할 템플릿이 없습니다'
              : '프로젝트 템플릿 전체를 tar 파일로 백업'
          }
        >
          <button
            type="button"
            className={backupBtnCls}
            disabled={templates.length === 0}
            onClick={backupTemplates}
          >
            <FaFileArchive size={14} />
            <span>백업</span>
          </button>
        </Tooltip>
        <Tooltip content="백업 파일에서 프로젝트 템플릿 불러오기 (동명 처리 선택)">
          <button
            type="button"
            className={backupBtnCls}
            onClick={restoreTemplates}
          >
            <FaFileImport size={14} />
            <span>백업 불러오기</span>
          </button>
        </Tooltip>
      </div>
    ) : null;

    // 모바일 — 종전 템플릿 선택 + CRUD 줄(도구줄 첫 줄)
    const mobileSelectRow =
      isMobile && !listLocked ? (
        <div
          className="w-full flex items-center gap-1.5"
          data-template-select-row=""
        >
          <select
            className="app-select flex-1 min-w-[140px]"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {templates.length === 0 && <option value="">템플릿 없음</option>}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Tooltip content="새 템플릿">
            <button
              className={iconBtnCls}
              aria-label="새 템플릿"
              onClick={createTemplate}
            >
              <FaPlus size={14} />
            </button>
          </Tooltip>
          {entry && (
            <>
              <Tooltip content="이름 변경">
                <button
                  className={iconBtnCls}
                  aria-label="이름 변경"
                  onClick={renameTemplate}
                >
                  <FaPen size={14} />
                </button>
              </Tooltip>
              <Tooltip content="복제">
                <button
                  className={iconBtnCls}
                  aria-label="복제"
                  onClick={duplicateTemplate}
                >
                  <ActionIcon id="duplicate" size={14} />
                </button>
              </Tooltip>
              <Tooltip content="삭제">
                <button
                  className={iconBtnCls + ' hover:text-red-500'}
                  aria-label="삭제"
                  onClick={deleteTemplate}
                >
                  <ActionIcon id="delete" size={14} />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      ) : null;

    const toolbar =
      mobileSelectRow || panel.tabs || backupButtons ? (
        <>
          {mobileSelectRow}
          {panel.tabs}
          {backupButtons}
        </>
      ) : undefined;

    // PC aside — [새 템플릿] + 이름 목록(선택 행 강조·행 동작). 잠금 중이면 누를 때 안내만(열 폭은 유지)
    const rowActionCls = 'p-1.5 rounded text-faint transition-colors';
    const aside = !isMobile ? (
      <div
        className={
          'flex flex-col gap-2 p-3' + (listLocked ? ' opacity-60' : '')
        }
        data-template-aside=""
        aria-disabled={listLocked || undefined}
        onClickCapture={(e) => {
          if (!listLocked) return;
          e.preventDefault();
          e.stopPropagation();
          appState.pushMessage(lockedMessage);
        }}
      >
        <button
          onClick={createTemplate}
          className="add-slot w-full flex items-center gap-2 px-3 py-2 text-sm"
          data-template-new=""
        >
          <FaPlus size={12} />새 템플릿
        </button>
        {templates.length === 0 ? (
          <EmptyState className="py-6">
            템플릿이 없습니다
          </EmptyState>
        ) : (
          <div className="border line-color rounded-lg divide-y divide-[color:var(--c-line)] overflow-hidden">
            {templates.map((t) => {
              const selected = t.id === selectedId;
              return (
                <div
                  key={t.id}
                  data-template-row={t.id}
                  aria-selected={selected}
                  onClick={() => setSelectedId(t.id)}
                  className={`px-3 py-2 cursor-pointer flex justify-between items-center gap-2 ${
                    selected
                      ? 'list-row-selected'
                      : 'hover-row'
                  }`}
                >
                  <span className="min-w-0 text-sm font-medium text-default truncate">
                    {t.name}
                  </span>
                  {selected && (
                    <div className="flex-none flex items-center gap-0.5">
                      <Tooltip content="이름 변경">
                        <button
                          aria-label="이름 변경"
                          onClick={(e) => {
                            e.stopPropagation();
                            renameTemplate();
                          }}
                          className={
                            rowActionCls +
                            ' hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/20'
                          }
                        >
                          <FaPen size={11} />
                        </button>
                      </Tooltip>
                      <Tooltip content="복제">
                        <button
                          aria-label="복제"
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateTemplate();
                          }}
                          className={
                            rowActionCls +
                            ' hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/20'
                          }
                        >
                          <ActionIcon id="duplicate" size={11} />
                        </button>
                      </Tooltip>
                      <Tooltip content="삭제">
                        <button
                          aria-label="삭제"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteTemplate();
                          }}
                          className={
                            rowActionCls +
                            ' hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                          }
                        >
                          <ActionIcon id="delete" size={11} />
                        </button>
                      </Tooltip>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    ) : undefined;

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={guardedClose}
        title={
          <span className="inline-flex items-center gap-1.5">
            템플릿 관리
            {/* 도움말 패널(2026-11-20 그룹 1-b — 종전 3줄 툴팁). 문구 = models/helpPanelTexts.ts */}
            <HelpPanelButton data={TEMPLATE_MANAGER_HELP} width={420} exampleWidth={110} />
          </span>
        }
        // xl(1280 고정, 2026-11-15 사용자 실기 피드백 — 작업 밀도가 높아 l 1000 은 좁음). 폴더 기본 템플릿은 l.
        size="xl"
        toolbar={toolbar}
        aside={aside}
        footer={panel.footer ?? undefined}
        footerStart={panel.footerStart ?? undefined}
        // 캐릭터 편집(PC) = 안쪽 편집기 layout="frame" 이 창 본문을 채우고 자체 바닥줄을 그린다(2026-11-15 C-3b)
        bodyPadding={panel.charEditing && !isMobile ? 'none' : 'normal'}
      >
        {!entry ? (
          <EmptyState size="lg" className="py-6">
            {isMobile ? (
              <>
                템플릿이 없습니다. <b>+</b> 버튼으로 새 템플릿을 만들거나{' '}
              </>
            ) : (
              <>
                템플릿이 없습니다. 왼쪽 <b>[새 템플릿]</b>으로 새 템플릿을
                만들거나{' '}
              </>
            )}
            <b>[백업 불러오기]</b>로 백업 파일에서 불러와 주세요.
          </EmptyState>
        ) : (
          panel.body
        )}
      </ModalOverlay>
    );
  },
);
