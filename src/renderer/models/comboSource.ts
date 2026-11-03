// 변형 씬(I2I·인페인트) 조합 모드 데이터 만들기 — 단일 출처(2026-11-03, SPEC_GUIDE §7-4 「조합 모드 만들기·켜기」).
// 세 곳이 같은 규칙을 쓴다:
//   ① 대량 작업 「I2I/인페인트로 이미지생성 씬 복사」(i2iBatchFlow — 원본 일반 씬의 조합 그대로)
//   ② 새 변형 씬 생성 직전 3택(SceneQueueControl — 이미지 상세 「인페인팅 씬 생성」·「이미지 변형 → 변형 씬 생성」·검수 인페인트,
//      변형 탭 +)
//   ③ 편집 창 「조합 모드 켜기」(InPaintEditor — 「조합 모드 끄기」의 짝)
// 규칙(복사 흐름 B1/P1 에서 추출, 동작 불변):
//   · 원본 일반 씬 → 프리셋 prompt = 첫 조합의 중간 프롬프트, uc = 씬 네거티브(씬 캐릭터 UC + 씬 전용 네거티브),
//     characterPrompts = resolveSceneCharacterPrompts(사전 세팅, 원본) 순서 그대로, slots = 원본 slots 깊은 복사.
//   · 'snapshot' 이면 frontPrompt·backPrompt·globalUc = snapshotComboFields(묶음당 1회 — prepareComboContext).
//   · 빈 조합(변형 탭 +) = 중간 프롬프트 ''·조합 1×1 빈 칸(일반 씬 새 씬과 같은 모양).
//   · 현재 프롬프트 → 중간(「조합 모드 끄기」의 역) = preset.prompt 그대로 중간 프롬프트(slots[0][0] 이중 보관),
//     uc·캐릭터·이미지·강도·마스크는 그대로. 끄기 뒤 남은 slots 의 첫 조합이 지금 프롬프트와 같으면 slots 를 그대로 되살린다.
// 씬·프리셋 쓰기는 MobX 대입뿐(저장은 toJSON reaction → 저장 큐). 새 저장 키 없음.
import { runInAction } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { workFlowService } from '.';
import { getAppState } from './appStateRef';
import {
  COMBO_EDITOR_TEXT,
  COMBO_OPTIONAL_WORKFLOWS,
  ComboMode,
  normalizeComboMode,
  variantComboMode,
} from './comboMode';
import {
  askComboMode,
  I2I_COPY_SOURCE_WORKFLOWS,
  i2iComboPresetFromJob,
} from './i2iBatch';
import { combinationMiddlePrompt, enumerateCombinations } from './PromptService';
import {
  resolveSceneCharacterPrompts,
  usesSceneCharacterPromptData,
} from './sceneCharacterPrompts';
import type { GenericScene, InpaintScene, IPromptPieceSlot, PromptNode, Scene, Session } from './types';
import { PromptPiece } from './types';
import { joinPromptParts, snapshotComboFields } from './variantCombo';
import type { ComboSnapshotFields } from './variantCombo';
import { buildSDImageGenJob } from './workflows/SDWorkFlow';
import { editVariantFields } from './variantSceneUndo';
import { UNDO_TEXT } from './undoService';
import type { UndoService } from './undoService';

/** 조합 모드가 쓰는 변형 프리셋의 프롬프트 계열 키(켜기 되돌리기·변형 씬 → 변형 씬 승계가 함께 다룬다). */
export const COMBO_PRESET_KEYS = [
  'prompt',
  'uc',
  'characterPrompts',
  'frontPrompt',
  'backPrompt',
  'globalUc',
  'useGlobalUc',
] as const;

/** 원본 일반 씬에서 가져올 때 덮는 프리셋 키 — 전역 네거티브 「사용」(useGlobalUc)은 씬의 값을 그대로 둔다. */
const SCENE_IMPORT_PRESET_KEYS = ['prompt', 'uc', 'characterPrompts', 'frontPrompt', 'backPrompt', 'globalUc'] as const;

/** 고정값(snapshot) 키 */
const SNAPSHOT_KEYS = ['frontPrompt', 'backPrompt', 'globalUc'] as const;

export const COMBO_SOURCE_TEXT = {
  /** 생성 직전 3택(SPEC §5 select — 취소는 창의 내장 취소 = 생성 중단) */
  layoutQuestion: '프롬프트 구성을 선택해 주세요',
  layoutSingle: '단일 프롬프트 (현재 방식)',
  // 조합 2택은 편집 창 모드 표시와 같은 문구(COMBO_EDITOR_TEXT.modeShared·modeSnapshot)
  layoutShared: COMBO_EDITOR_TEXT.modeShared,
  layoutSnapshot: COMBO_EDITOR_TEXT.modeSnapshot,
  /** 켜기 — 원본 씬이 있을 때 출처 2택 */
  sourceQuestion: (sceneRef: string) =>
    `조합을 어디에서 가져올까요?\n` +
    `· 원본 씬(${sceneRef})의 조합 가져오기: 지금의 프롬프트·네거티브·캐릭터 프롬프트가 원본 씬의 조합으로 바뀝니다(중간 프롬프트 = 원본 씬 첫 조합). 이미지·강도·마스크는 그대로입니다.\n` +
    `· 현재 프롬프트를 중간 프롬프트로: 상위·하위 프롬프트와 전역 네거티브가 메인(사전 세팅)에서 붙으니, 겹치는 태그가 있으면 다듬어 주세요.`,
  sourceScene: '원본 씬의 조합 가져오기',
  sourceCurrent: '현재 프롬프트를 중간 프롬프트로',
  /** 현재 프롬프트 → 중간 프롬프트로 바꾼 뒤 안내 한 줄 */
  currentNotice:
    '현재 프롬프트를 중간 프롬프트로 옮겼습니다. 상위·하위 프롬프트와 전역 네거티브는 메인(사전 세팅)에서 붙으니, 겹치는 태그가 있으면 다듬어 주세요.',
  noSetup:
    '현재 생성 설정(사전 세팅)을 찾을 수 없어 조합 모드를 만들 수 없습니다. 이미지생성 탭에서 사전 세팅을 고른 뒤 다시 시도해 주세요.',
} as const;

/** 생성 직전 선택 — 단일 프롬프트 또는 조합 모드(공유/고정). */
export type VariantPromptLayout = 'single' | ComboMode;

/** 생성 직전 3택(「프롬프트 구성을 선택해 주세요」). 취소 = undefined(생성 중단). */
export async function askVariantPromptLayout(): Promise<VariantPromptLayout | undefined> {
  const value = await getAppState().pushDialogAsync({
    type: 'select',
    text: COMBO_SOURCE_TEXT.layoutQuestion,
    items: [
      { text: COMBO_SOURCE_TEXT.layoutSingle, value: 'single' },
      { text: COMBO_SOURCE_TEXT.layoutShared, value: 'shared' },
      { text: COMBO_SOURCE_TEXT.layoutSnapshot, value: 'snapshot' },
    ],
  });
  return value === 'single' || value === 'shared' || value === 'snapshot' ? value : undefined;
}

/** 조합 모드를 고를 수 있는 변형 워크플로우인가(I2I·인페인트 — 미러는 늘 조합, 그 밖은 대상 아님). */
export function canChooseComboMode(workflowType: string | undefined): boolean {
  return !!workflowType && COMBO_OPTIONAL_WORKFLOWS.has(workflowType);
}

/** 조합 데이터를 만들 때 쓰는 현재 생성 설정(사전 세팅)과 고정값. */
export interface ComboContext {
  genType: string;
  genPreset: any;
  genShared: any;
  /** 'snapshot' 일 때만 — 묶음 전체가 같은 값 */
  snapshot?: ComboSnapshotFields;
}

/**
 * 현재 생성 설정을 읽고('SDImageGen'·'SDImageGenEasy' 만) 'snapshot' 이면 고정값을 한 번 만든다.
 * 사전 세팅이 없거나 다른 워크플로우거나 고정값을 만들지 못하면 undefined(호출부가 안내 후 중단).
 */
export async function prepareComboContext(
  session: Session,
  mode: ComboMode,
): Promise<ComboContext | undefined> {
  const selectedWorkflow = session.selectedWorkflow;
  const [genType, genPreset, genShared] = selectedWorkflow
    ? session.getCommonSetup(selectedWorkflow)
    : [undefined, undefined, undefined];
  if (!genType || !genPreset || !I2I_COPY_SOURCE_WORKFLOWS.has(genType)) return undefined;
  let snapshot: ComboSnapshotFields | undefined;
  if (mode === 'snapshot') {
    try {
      snapshot = await snapshotComboFields(genType, genPreset, genShared, session.extraPrompt);
    } catch (e: any) {
      console.error('조합 모드 고정값 만들기 실패:', e);
      return undefined;
    }
  }
  return { genType, genPreset, genShared, snapshot };
}

/** 잡 조립용 빈 프롬프트(생성 설정만 옮기고 프롬프트는 조합 모드 규칙으로 채운다). */
const EMPTY_PROMPT: PromptNode = { type: 'text', text: '' };

/** 원본 일반 씬에서 만든 조합 모드 데이터 — 프리셋 전체와 씬 필드. */
export interface ComboFromScene {
  /** buildPreset(workflow) 에 생성 설정·조합 프롬프트 칸을 채운 새 프리셋 */
  preset: any;
  /** 프롬프트 계열 키만(기존 프리셋에 덮을 때 — 이미지·강도·마스크 등은 건드리지 않음) */
  presetPatch: Record<string, unknown>;
  /** 원본 slots 깊은 복사(JSON — InpaintScene.fromJSON·PromptPiece.fromJSON 으로 새 조각 객체) */
  slots: IPromptPieceSlot[];
  comboMode: ComboMode;
  /** 원본 씬 이름(결과 보기 「원본 씬으로 이미지 복사」·변형 씬 목록) */
  sceneRef: string;
}

/**
 * 원본 일반 씬 → 조합 모드 데이터(B1/P1 복사 흐름 규칙 그대로). 조각은 풀지 않는다(예약 때 전개).
 * buildPreset 은 테스트 주입용(기본 = workFlowService.buildPreset).
 */
export function buildComboFromScene(
  src: Scene,
  workflow: string,
  mode: ComboMode,
  ctx: ComboContext,
  buildPreset: (workflow: string) => any = (w) => workFlowService.buildPreset(w),
): ComboFromScene {
  // 생성 설정(샘플링 등)은 예약과 같은 잡 조립에서 옮기고, 프롬프트는 조합 모드 규칙(조합은 slots 로 복사)
  const job = buildSDImageGenJob(src, EMPTY_PROMPT, [], ctx.genPreset, ctx.genShared);
  const first = enumerateCombinations(src, 1)[0];
  const preset = i2iComboPresetFromJob(buildPreset(workflow), job, {
    middlePrompt: first ? combinationMiddlePrompt(first) : '',
    sceneUc: joinPromptParts(
      usesSceneCharacterPromptData(src) ? src.sceneCharacterUC : '',
      src.sceneUC,
    ),
    characterPrompts: resolveSceneCharacterPrompts(ctx.genPreset, ctx.genShared, src),
    mode,
    snapshot: ctx.snapshot,
  });
  const presetPatch: Record<string, unknown> = {};
  for (const key of SCENE_IMPORT_PRESET_KEYS) presetPatch[key] = clone(preset[key]);
  return {
    preset,
    presetPatch,
    // 조합 깊은 복사(toJSON — 원본 씬과 조각 객체를 공유하지 않음, 조합이 1개뿐이어도 복사)
    slots: src.toJSON().slots ?? [],
    comboMode: mode,
    sceneRef: src.name,
  };
}

/** 새 조합 1×1 빈 칸 — 일반 씬 「씬 추가」의 첫 slots 와 같은 모양(조각마다 새 id). */
export function emptyComboSlots(): IPromptPieceSlot[] {
  return [[{ id: uuidv4(), prompt: '', characterPrompts: [], enabled: true }]];
}

/** 빈 조합(변형 탭 +) — 새 프리셋(중간 프롬프트 '')·조합 1×1 빈 칸, 'snapshot' 이면 메인 사전 세팅 고정값. */
export function emptyCombo(
  workflow: string,
  mode: ComboMode,
  ctx: ComboContext,
  buildPreset: (workflow: string) => any = (w) => workFlowService.buildPreset(w),
): { preset: any; slots: IPromptPieceSlot[]; comboMode: ComboMode } {
  const preset = buildPreset(workflow);
  preset.prompt = '';
  if (mode === 'snapshot' && ctx.snapshot) applySnapshot(preset, ctx.snapshot);
  return { preset, slots: emptyComboSlots(), comboMode: mode };
}

/** 기존 씬에 덮을 조합 모드 변경분 — preset 은 덮을 키만, slots 가 undefined 면 지금 slots 를 그대로 둔다. */
export interface ComboPatch {
  comboMode: ComboMode;
  preset: Record<string, unknown>;
  slots?: IPromptPieceSlot[];
}

/**
 * 현재 프롬프트 → 중간 프롬프트(「조합 모드 끄기」의 역). preset.prompt 를 그대로 중간 프롬프트로 쓰고(slots[0][0] 이중 보관),
 * uc·캐릭터·이미지·강도·마스크는 그대로. 'snapshot' 이면 고정값을 넣는다('shared' 는 고정값 칸을 건드리지 않음 — 쓰이지 않음).
 * 남아 있는 slots(끄기 뒤 등)의 첫 조합이 지금 프롬프트와 같으면 slots 를 그대로 둔다(끄기 → 켜기 왕복 보존),
 * 아니면 지금 프롬프트 한 조각짜리 1×1 로 새로 만든다.
 */
export function comboFromSinglePreset(
  scene: { preset: any; slots: readonly (readonly { prompt: string; enabled?: boolean }[])[] },
  mode: ComboMode,
  ctx: ComboContext | undefined,
): ComboPatch {
  const prompt: string = scene.preset?.prompt ?? '';
  const preset: Record<string, unknown> = { prompt };
  if (mode === 'snapshot' && ctx?.snapshot) Object.assign(preset, snapshotPatch(ctx.snapshot));
  let keep = false;
  if (scene.slots.length > 0) {
    const first = enumerateCombinations(scene as unknown as Scene, 1)[0];
    keep = !!first && combinationMiddlePrompt(first) === prompt;
  }
  return {
    comboMode: mode,
    preset,
    slots: keep
      ? undefined
      : [[{ id: uuidv4(), prompt, characterPrompts: [], enabled: true }]],
  };
}

/**
 * 원본이 조합 모드 변형 씬일 때 그대로 승계할 변경분(변형 씬 결과 이미지에서 다시 변형 씬을 만들 때) —
 * comboMode·slots(깊은 복사)·프롬프트 계열 키 전부(고정값·useGlobalUc 포함). 조합 모드가 아니면 undefined.
 */
export function comboPatchFromVariant(src: InpaintScene): ComboPatch | undefined {
  if (!canChooseComboMode(src.workflowType)) return undefined;
  const mode = normalizeComboMode(src.comboMode);
  if (!mode) return undefined;
  const preset: Record<string, unknown> = {};
  for (const key of COMBO_PRESET_KEYS) {
    if (src.preset && key in src.preset) preset[key] = clone(src.preset[key]);
  }
  return { comboMode: mode, preset, slots: src.toJSON().slots ?? [] };
}

/** 변경분을 씬에 대입(MobX 한 번) — 프리셋에 없는 키는 만들지 않는다. */
export function applyComboPatch(scene: InpaintScene, patch: ComboPatch): void {
  runInAction(() => {
    const preset = scene.preset as Record<string, unknown> | undefined;
    if (preset) {
      for (const [key, value] of Object.entries(patch.preset)) {
        if (!(key in preset)) continue;
        preset[key] = clone(value);
      }
    }
    if (patch.slots) {
      scene.slots = patch.slots.map((slot) => slot.map((piece) => PromptPiece.fromJSON(clone(piece))));
    }
    scene.comboMode = patch.comboMode;
  });
}

/**
 * 새 변형 씬의 프롬프트 구성 정하기(SceneQueueControl.createInpaintScene — 생성 직전, 이미지를 저장하기 전에 부른다).
 * - 대상 워크플로우가 I2I·인페인트가 아니면 묻지 않고 단일(미러·그 밖은 기존 그대로).
 * - 원본이 조합 모드 변형 씬이면 묻지 않고 그 조합을 승계.
 * - 그 밖은 3택. 조합이면 원본 일반 씬의 조합(buildComboFromScene)을, 원본이 단일 변형 씬이면 「현재 프롬프트 → 중간」.
 * 반환: undefined = 중단(취소·설정 없음 — 설정 없음은 여기서 안내), 'single' = 기존 동작,
 *       그 밖 = 메타데이터 프리셋으로 만든 새 씬에 apply(scene) 를 부른다(이미지·해상도·강도·마스크는 기존 규칙 그대로).
 */
export type NewVariantCombo =
  | { kind: 'single' }
  | { kind: 'combo'; apply: (scene: InpaintScene) => ComboMode; mode: ComboMode; fromCurrent: boolean };

export async function chooseNewVariantCombo(
  session: Session,
  source: GenericScene,
  workflow: string,
): Promise<NewVariantCombo | undefined> {
  if (!canChooseComboMode(workflow)) return { kind: 'single' };
  if (source.type === 'inpaint') {
    const inherited = comboPatchFromVariant(source as InpaintScene);
    if (inherited) {
      return {
        kind: 'combo',
        mode: inherited.comboMode,
        fromCurrent: false,
        apply: (scene) => {
          applyComboPatch(scene, inherited);
          return inherited.comboMode;
        },
      };
    }
  }
  const layout = await askVariantPromptLayout();
  if (!layout) return undefined;
  if (layout === 'single') return { kind: 'single' };
  const ctx = await prepareComboContext(session, layout);
  if (!ctx) {
    getAppState().pushMessage(COMBO_SOURCE_TEXT.noSetup, 'error');
    return undefined;
  }
  if (source.type === 'scene') {
    const combo = buildComboFromScene(source as Scene, workflow, layout, ctx);
    return {
      kind: 'combo',
      mode: layout,
      fromCurrent: false,
      apply: (scene) => {
        applyComboPatch(scene, { comboMode: layout, preset: combo.presetPatch, slots: combo.slots });
        return layout;
      },
    };
  }
  return {
    kind: 'combo',
    mode: layout,
    fromCurrent: true,
    apply: (scene) => {
      applyComboPatch(scene, comboFromSinglePreset(scene, layout, ctx));
      return layout;
    },
  };
}

/**
 * 편집 창 「조합 모드 켜기」(단일 I2I·인페인트 — 미러·조합 모드 씬은 대상 아님).
 * 공유/고정(askComboMode) → 출처: sceneRef 가 세션의 일반 씬을 가리키면 [원본 씬의 조합 가져오기][현재 프롬프트를 중간 프롬프트로],
 * 없으면 바로 현재 프롬프트 → 중간(안내 토스트). 되돌리기 = 한 항목(scene comboMode·slots + preset 프롬프트 계열 키).
 * 켰으면 true.
 */
export async function turnOnComboMode(
  session: Session | undefined,
  scene: InpaintScene,
  opts: { service?: UndoService } = {},
): Promise<boolean> {
  const appState = getAppState();
  if (!session || !canChooseComboMode(scene.workflowType) || variantComboMode(scene)) return false;
  const mode = await askComboMode();
  if (!mode) return false;
  const ref = scene.sceneRef ? session.scenes.get(scene.sceneRef) : undefined;
  const src = ref && ref.type === 'scene' ? (ref as Scene) : undefined;
  let from: 'scene' | 'current' = 'current';
  if (src) {
    const value = await appState.pushDialogAsync({
      type: 'select',
      text: COMBO_SOURCE_TEXT.sourceQuestion(src.name),
      items: [
        { text: COMBO_SOURCE_TEXT.sourceScene, value: 'scene' },
        { text: COMBO_SOURCE_TEXT.sourceCurrent, value: 'current' },
      ],
    });
    if (value !== 'scene' && value !== 'current') return false;
    from = value;
  }
  const ctx = await prepareComboContext(session, mode);
  if (!ctx) {
    appState.pushMessage(COMBO_SOURCE_TEXT.noSetup, 'error');
    return false;
  }
  // 묻는 사이 씬이 바뀌었으면(이미 켜짐·워크플로우 변경) 그만둔다
  if (!canChooseComboMode(scene.workflowType) || variantComboMode(scene)) return false;
  const patch: ComboPatch =
    from === 'scene' && src
      ? (() => {
          const combo = buildComboFromScene(src, scene.workflowType, mode, ctx);
          return { comboMode: mode, preset: combo.presetPatch, slots: combo.slots };
        })()
      : comboFromSinglePreset(scene, mode, ctx);
  editVariantFields(
    session,
    scene,
    { scene: ['comboMode', 'slots'], preset: COMBO_PRESET_KEYS },
    UNDO_TEXT.variantComboOn(scene.name),
    () => applyComboPatch(scene, patch),
    { service: opts.service },
  );
  if (from === 'current') appState.pushMessage(COMBO_SOURCE_TEXT.currentNotice, 'info');
  return true;
}

function applySnapshot(preset: any, snapshot: ComboSnapshotFields) {
  Object.assign(preset, snapshotPatch(snapshot));
}

function snapshotPatch(snapshot: ComboSnapshotFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SNAPSHOT_KEYS) out[key] = snapshot[key];
  return out;
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
