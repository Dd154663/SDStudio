// 변형 씬 조합 전개(2026-10-04 B4) — 미러·I2I·인페인트(P1) 조합 모드 씬의 프롬프트를 이미지생성 씬과 같은 규칙으로 전개한다.
// 판정은 comboMode.ts, 계약은 SPEC_GUIDE §7-4 「I2I 조합 모드」·§11-4 「조합 전개 공용 함수」.
//
// - 전개 = PromptService.createSDPrompts·createSDCharacterPrompts 그대로(`|` 교차·추가 프롬프트·조각 캐릭터 프롬프트·
//   이지 모드 재배열·활성 조각 0개인 열 = 0종). 예전 미러 전용 DFS(빈 열 '' 대입·교차 없음)는 없앴다.
// - 상위/하위/전역 네거티브 출처: 'shared'(미러 포함) = 현재 사전 세팅 실시간, 'snapshot' = 씬 프리셋의 frontPrompt·backPrompt·globalUc.
// - 핸들러(createSDI2IHandler)에는 전개 결과를 프리셋 사본의 COMBO_EXPANDED_KEY 로 넘긴다(저장되지 않는 예약 전용 값).
import { promptService } from '.';
import {
  createSDCharacterPrompts,
  createSDPrompts,
  reorderEasyFront,
  toPARR,
} from './PromptService';
import { getOrderedBaseCharacterPrompts } from './sceneCharacterPrompts';
import {
  CharacterPrompt,
  InpaintScene,
  IPromptPieceSlot,
  PromptNode,
  PromptPiece,
  PromptPieceSlot,
  Scene,
  Session,
} from './types';
import { isComboVariant, normalizeComboMode, variantComboMode } from './comboMode';

/** 이지 모드 사전 세팅 타입 — 상위에 캐릭터 태그, 하위 앞에 배경 태그, 네거티브 앞에 태그 밴이 붙는다. */
const EASY_WORKFLOW = 'SDImageGenEasy';

/** 전개에 쓰는 상위/하위/전역 네거티브 출처. */
export interface ComboPromptSource {
  /** createSDPrompts 의 preset 자리(frontPrompt·backPrompt). */
  front: string;
  back: string;
  /** createSDPrompts 의 shared 자리 — 이지 모드면 캐릭터·배경 태그. */
  sharedType: string;
  characterPrompt?: string;
  backgroundPrompt?: string;
  /** 전역 네거티브(씬 네거티브 앞에 붙는다). */
  globalUc: string;
  /** 추가 프롬프트 — undefined = 프로젝트 추가 프롬프트 실시간(생성 경로와 같음), '' = 이미 상위에 포함(snapshot). */
  extraPrompt?: string;
}

/** 쉼표 이어 붙이기(빈 칸 제외). */
export function joinPromptParts(...parts: (string | undefined | null)[]): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/** 사전 세팅(생성 워크플로우 preset·shared)에서 출처를 만든다 — 'shared'(미러 포함)의 실시간 값. */
export function comboSourceFromGenSetup(
  genType: string | undefined,
  genPreset: any,
  genShared: any,
): ComboPromptSource {
  const easy = genType === EASY_WORKFLOW;
  return {
    front: genPreset?.frontPrompt ?? '',
    back: genPreset?.backPrompt ?? '',
    sharedType: easy ? EASY_WORKFLOW : genType ?? 'SDImageGen',
    ...(easy
      ? {
          characterPrompt: genShared?.characterPrompt ?? '',
          backgroundPrompt: genShared?.backgroundPrompt ?? '',
        }
      : {}),
    // 생성 경로와 같은 순서 — 이지 모드 태그 밴(shared.uc) 뒤에 사전 세팅 네거티브.
    globalUc: joinPromptParts(easy ? genShared?.uc : '', genPreset?.uc),
  };
}

/** 「복사 시점 1회 복제」 씬 — 프리셋에 고정한 값(추가 프롬프트·이지 태그는 복사 때 상위/하위에 이미 합쳤다). */
export function comboSourceFromSnapshot(preset: any): ComboPromptSource {
  return {
    front: preset?.frontPrompt ?? '',
    back: preset?.backPrompt ?? '',
    sharedType: 'SDImageGen',
    globalUc: preset?.globalUc ?? '',
    extraPrompt: '',
  };
}

/** 고정값으로 저장할 상위/하위/전역 네거티브(B1 「복사 시점 설정을 1회 복제」). */
export interface ComboSnapshotFields {
  frontPrompt: string;
  backPrompt: string;
  globalUc: string;
}

/**
 * 지금 사전 세팅으로 고정값을 만든다 — 실시간 전개와 같은 결과가 되도록 상위 = 상위(+이지 캐릭터 태그 재배열)+추가 프롬프트,
 * 하위 = (이지 배경)+하위, 전역 네거티브 = (이지 태그 밴)+네거티브. `|` 교차 표식은 그대로 남는다(주석 `##…##` 는 빠짐).
 */
export async function snapshotComboFields(
  genType: string | undefined,
  genPreset: any,
  genShared: any,
  extraPrompt: string | undefined,
): Promise<ComboSnapshotFields> {
  const source = comboSourceFromGenSetup(genType, genPreset, genShared);
  let front = toPARR(source.front);
  if (source.sharedType === EASY_WORKFLOW) {
    front = await reorderEasyFront(front.concat(toPARR(source.characterPrompt ?? '')));
  }
  front = front.concat(toPARR(extraPrompt ?? ''));
  return {
    frontPrompt: front.join(', '),
    backPrompt: joinPromptParts(source.backgroundPrompt, source.back),
    globalUc: source.globalUc,
  };
}

/** 씬의 전개 출처 — 조합 모드가 아니면 undefined. 'shared' 는 현재 프로젝트의 선택 사전 세팅(없으면 빈 값). */
export function variantComboSource(
  session: Session,
  scene: InpaintScene,
  preset: any = scene.preset,
): ComboPromptSource | undefined {
  const mode = variantComboMode(scene);
  if (!mode) return undefined;
  if (mode === 'snapshot') return comboSourceFromSnapshot(preset);
  if (session.selectedWorkflow) {
    try {
      const [genType, genPreset, genShared] = session.getCommonSetup(
        session.selectedWorkflow,
      );
      return comboSourceFromGenSetup(genType, genPreset, genShared);
    } catch (e) {
      console.warn('사전 세팅을 읽지 못해 상위/하위 없이 전개합니다:', e);
    }
  }
  return comboSourceFromGenSetup(undefined, undefined, undefined);
}

/** 슬롯 깊은 복사(toJSON→fromJSON) — 씬끼리 조각 객체·캐릭터 배열을 공유하지 않는다. */
export function cloneSlots(
  slots: readonly (PromptPieceSlot | IPromptPieceSlot)[] | undefined,
): PromptPieceSlot[] {
  return (slots ?? []).map((slot) =>
    slot.map((piece) => {
      const json = piece instanceof PromptPiece ? piece.toJSON() : piece;
      return PromptPiece.fromJSON({
        ...json,
        characterPrompts: [...(json.characterPrompts ?? [])],
      });
    }),
  );
}

/**
 * 대량 작업 「씬 내용 복제」(변형 씬) — 조합 모드·조합(slots)을 옮긴다. 대상 workflowType 을 먼저 맞춘 뒤 부른다.
 * 결과가 조합을 쓰지 않는 씬(단일 인페인트·단일 I2I·이미지 수정)이면 slots 를 비운다(남은 조각이 다시 쓰이지 않게).
 */
export function copyComboContent(
  source: { comboMode?: unknown; slots?: readonly (PromptPieceSlot | IPromptPieceSlot)[] },
  target: InpaintScene,
): void {
  target.comboMode = normalizeComboMode(source.comboMode);
  target.slots = isComboVariant(target) ? cloneSlots(source.slots) : [];
}

/** 한 조합의 전개 결과 — 핸들러가 그대로 잡에 싣는다(조각은 PromptNode 로 풀려 있고 {a|b} 는 실행 때 고른다). */
export interface ExpandedCombo {
  prompt: PromptNode;
  characterPrompts: CharacterPrompt<PromptNode>[];
}

/** 예약 전용 프리셋 사본 키 — 핸들러가 이 값이 있으면 프리셋 prompt 대신 전개 결과를 쓴다(저장되지 않음). */
export const COMBO_EXPANDED_KEY = '__comboExpanded';

/**
 * 조합 전개 — 미러·I2I 조합 모드 씬의 조합마다 프롬프트·캐릭터 프롬프트(생성 경로 createSDPrompts 와 같은 규칙).
 * 슬롯이 없으면 preset.prompt 한 조각짜리 열 하나로 본다(옛 미러: 조합 에디터를 연 적 없는 씬).
 * 캐릭터 프롬프트 기준 = 씬 프리셋 characterPrompts(order 정렬), 조각의 캐릭터 프롬프트가 같은 번호에 합쳐지고,
 * 꺼진 캐릭터(enabled === false)는 뺀다(이미지생성 잡과 같음).
 */
export async function expandVariantCombos(
  session: Session,
  scene: InpaintScene,
  source: ComboPromptSource,
  preset: any = scene.preset,
): Promise<ExpandedCombo[]> {
  const presetLike = {
    frontPrompt: source.front,
    backPrompt: source.back,
    characterPrompts: preset?.characterPrompts ?? [],
  };
  const sharedLike = {
    type: source.sharedType,
    characterPrompt: source.characterPrompt ?? '',
    backgroundPrompt: source.backgroundPrompt ?? '',
    characterPrompts: [],
  };
  const promptScene = (
    scene.slots.length > 0
      ? scene
      : {
          name: scene.name,
          type: scene.type,
          slots: [
            [
              PromptPiece.fromJSON({
                prompt: preset?.prompt ?? '',
                characterPrompts: [],
                enabled: true,
                id: 'preset-prompt',
              }),
            ],
          ],
        }
  ) as unknown as Scene;
  const prompts = await createSDPrompts(
    session,
    presetLike,
    sharedLike,
    promptScene,
    source.extraPrompt,
  );
  const characterNodes = await createSDCharacterPrompts(
    session,
    presetLike,
    sharedLike,
    promptScene,
  );
  const base = getOrderedBaseCharacterPrompts(presetLike, sharedLike);
  return prompts.map((prompt, i) => ({
    prompt,
    characterPrompts: base
      .map((cp, index) => ({ cp, node: characterNodes[i]?.[index] }))
      .filter(({ cp }) => cp.enabled !== false)
      .map(({ cp, node }) => ({
        ...cp,
        prompt: node ?? { type: 'text' as const, text: cp.prompt || '' },
      })),
  }));
}

/** 조합 하나를 넘길 프리셋 사본 — 네거티브 = 전역 네거티브 + 씬 네거티브(미러 기존 규칙). */
export function comboHandlerPreset(
  preset: any,
  combo: ExpandedCombo,
  globalUc: string,
): any {
  return {
    ...preset,
    uc: joinPromptParts(globalUc, preset?.uc),
    [COMBO_EXPANDED_KEY]: combo,
  };
}

/**
 * 단일 프롬프트 변형 씬(인페인트·조합 모드가 아닌 I2I)의 preset.prompt → PromptNode(2026-10-04 B4 C4 — 기존 결함 수정).
 * `<모음.조각>` 이 있으면 생성 경로처럼 parseWord 로 풀고(없는 조각은 예외 — 생성 경로와 같음), 없으면 예전처럼 글자 그대로.
 */
export function resolvePresetPromptNode(
  text: string | undefined,
  session: Session,
  scene: InpaintScene | Scene | undefined,
): PromptNode {
  const raw = text ?? '';
  const words = toPARR(raw);
  if (!words.some((w) => w.charAt(0) === '<' && w.charAt(w.length - 1) === '>')) {
    return { type: 'text', text: raw };
  }
  return {
    type: 'group',
    children: words.map((w) => promptService.parseWord(w, session, scene)),
  };
}

/** 핸들러용 — 프리셋 사본에 실린 전개 결과(없으면 undefined). */
export function comboExpandedOf(preset: any): ExpandedCombo | undefined {
  const value = preset?.[COMBO_EXPANDED_KEY];
  return value && typeof value === 'object' ? (value as ExpandedCombo) : undefined;
}
