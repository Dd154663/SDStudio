// 가중치 숫자 태그 공백 보정(N1)의 「프롬프트 편집 단계 확인 + 해제 토글」 흐름 — SPEC_GUIDE §12 「가중치 숫자 태그 공백」.
// (2026-11-06 사용자 설계: 전송 단계 강제 → 편집 확정 때 묻기 + 끄는 방법 제공)
//
//  · 보정 규칙 자체는 promptWeightSpacing.ts(padDigitEdgedWeightGroups, 멱등) 단일 출처 — 여기서는 판정·문구·흐름만.
//  · config `promptWeightSpacingFix`(없으면 true) = 보정 기능. 환경설정 「커스텀」 탭 토글.
//  · appState `promptWeightSpacingSkipSession`(저장 안 함) = 「이번 세션에는 보정 안 함」.
//  · 편집 확정(PromptEditTextArea 의 칸을 떠날 때) — 기능 켬·세션 스킵 아님·보정 결과가 다르면 select 확인 창 1회.
//      [보정 적용] = 그 칸을 보정 결과로 교체(되돌리기는 같은 편집 확정 1항목에 포함 — 호출부가 편집 세션을 붙잡는다)
//      [이번 세션에는 보정 안 함] = 세션 플래그 · [다시 알리지 않음(기능 끄기)] = config 저장 + 토스트
//      내장 취소·Esc = 이 칸만 그대로(다음 편집 때 다시 물을 수 있음)
//  · 전송(nai.ts generateImage)은 호출부(TaskHandlers)가 weightSpacingSendOption() 으로 계산한 옵션을 넘긴다 —
//    켬·세션 스킵 아님이면 예전처럼 패딩(편집기를 거치지 않은 저장 데이터·불러온 프롬프트·조각/조합 합성 결과 보호),
//    아니면 입력 그대로.

import type { Dialog } from '../componenets/ConfirmWindow';
import { findPromptWeightGroups, padDigitEdgedWeightGroups } from './promptWeightSpacing';

export interface WeightSpacingConfig {
  promptWeightSpacingFix?: boolean;
}

export interface WeightSpacingSessionState {
  /** config.promptWeightSpacingFix 미러(App.tsx·설정 화면이 채운다). */
  promptWeightSpacingFix: boolean;
  promptWeightSpacingSkipSession: boolean;
}

export const WEIGHT_SPACING_CHOICE = {
  apply: 'weight-spacing-apply',
  skipSession: 'weight-spacing-skip-session',
  disable: 'weight-spacing-disable',
} as const;

/** 예시 한 줄의 최대 길이(넘으면 말줄임). */
const EXAMPLE_MAX = 80;

function clip(s: string): string {
  const one = s.replace(/\r?\n/g, ' ');
  return one.length > EXAMPLE_MAX ? `${one.slice(0, EXAMPLE_MAX - 1)}…` : one;
}

export const WEIGHT_SPACING_TEXT = {
  toggleLabel: '가중치 안 숫자 태그 공백 보정',
  toggleHelp:
    'NovelAI 가 1.5::0aaa0:: 처럼 :: 에 숫자가 맞닿은 태그를 가중치 숫자로 잘못 읽는 버그를 피하려고, 맞닿은 쪽에 공백을 넣습니다. 끄면 입력한 그대로 보냅니다.',
  dialog: (example: WeightSpacingExample) =>
    '이 프롬프트에 NovelAI 가 잘못 읽을 수 있는 가중치 묶음이 있습니다.\n' +
    `${clip(example.before)}  →  ${clip(example.after)}` +
    (example.more > 0 ? `  (외 ${example.more}곳)` : '') +
    '\n' +
    'NovelAI 는 가중치 묶음 안 태그의 숫자가 :: 에 맞닿으면(예: 0aaa0, bbb1) 그 숫자를 가중치로 잘못 읽습니다. 맞닿은 쪽에 공백을 넣으면 피할 수 있습니다.\n' +
    '취소하면 이 칸은 그대로 두고, 생성할 때만 공백을 넣어 보냅니다.',
  apply: '보정 적용',
  skipSession: '이번 세션에는 보정 안 함',
  disable: '다시 알리지 않음(기능 끄기)',
  skippedToast: '이번 세션에는 가중치 숫자 태그 공백 보정을 하지 않습니다. 입력한 그대로 보냅니다.',
  disabledToast:
    '가중치 숫자 태그 공백 보정을 껐습니다. 환경설정 - 커스텀 탭에서 다시 켤 수 있습니다.',
  disableFailed: (msg: string) => `설정을 저장하지 못했습니다: ${msg}`,
};

/** config 값 해석 — 없으면 켬. */
export function isWeightSpacingFixEnabled(config: WeightSpacingConfig | undefined | null): boolean {
  return config?.promptWeightSpacingFix !== false;
}

/** 전송 단계 패딩 여부(nai.ts 의 ImageGenInput.padWeightDigitTags). 켬·세션 스킵 아님일 때만 true. */
export function weightSpacingSendOption(
  config: WeightSpacingConfig | undefined | null,
  state: Pick<WeightSpacingSessionState, 'promptWeightSpacingSkipSession'>,
): boolean {
  return isWeightSpacingFixEnabled(config) && !state.promptWeightSpacingSkipSession;
}

/** 편집 확정 때 확인 창을 띄울지. */
export function shouldOfferWeightSpacing(
  text: string,
  config: WeightSpacingConfig | undefined | null,
  state: Pick<WeightSpacingSessionState, 'promptWeightSpacingSkipSession'>,
): boolean {
  if (!weightSpacingSendOption(config, state)) return false;
  if (!text) return false;
  return padDigitEdgedWeightGroups(text) !== text;
}

export interface WeightSpacingExample {
  before: string;
  after: string;
  /** 첫 예시 말고 바뀌는 묶음 수. */
  more: number;
}

/**
 * 실제 텍스트에서 바뀌는 묶음 예시 — 앞에서부터 첫 후보(여는 숫자 ~ 닫는 `::`, 닫히지 않으면 끝까지)를 따로 보정해 보여 준다.
 * 바뀌는 묶음이 없으면 null.
 */
export function weightSpacingExample(text: string): WeightSpacingExample | null {
  if (!text || padDigitEdgedWeightGroups(text) === text) return null;
  const groups = [...findPromptWeightGroups(text)].sort((a, b) => a.openerStart - b.openerStart);
  const changed: { before: string; after: string }[] = [];
  for (const g of groups) {
    const end = g.closeStart === null ? text.length : g.closeStart + 2;
    const before = text.slice(g.openerStart, end);
    const after = padDigitEdgedWeightGroups(before);
    if (after !== before) changed.push({ before, after });
  }
  if (!changed.length) {
    // 이론상 오지 않는다(전체 결과가 다르면 어느 묶음이든 바뀐다) — 전체를 보여 준다.
    return { before: text, after: padDigitEdgedWeightGroups(text), more: 0 };
  }
  return { ...changed[0], more: changed.length - 1 };
}

export type WeightSpacingOfferResult = 'applied' | 'skipped-session' | 'disabled' | 'cancelled' | 'busy' | 'none';

export interface WeightSpacingFlowDeps {
  appState: WeightSpacingSessionState & {
    pushDialogAsync(d: Dialog): Promise<string | undefined>;
    pushMessage(msg: string, kind?: any): void;
  };
  backend: {
    getConfig(): Promise<any>;
    setConfig(c: any): Promise<void>;
  };
  /** 설정 저장 뒤 다른 화면에 알림(sessionService.configChanged). */
  onConfigChanged?: () => void;
}

let offerOpen = false;

/** 테스트·진단용 — 확인 창이 떠 있는가 */
export function isWeightSpacingOfferOpen(): boolean {
  return offerOpen;
}

/** 확인 창의 선택값을 처리한다(창을 띄우는 부분과 분리 — 테스트용). */
export async function applyWeightSpacingChoice(
  choice: string | undefined,
  text: string,
  apply: (padded: string) => void,
  deps: WeightSpacingFlowDeps,
): Promise<WeightSpacingOfferResult> {
  const { appState, backend } = deps;
  if (choice === WEIGHT_SPACING_CHOICE.apply) {
    apply(padDigitEdgedWeightGroups(text));
    return 'applied';
  }
  if (choice === WEIGHT_SPACING_CHOICE.skipSession) {
    appState.promptWeightSpacingSkipSession = true;
    appState.pushMessage(WEIGHT_SPACING_TEXT.skippedToast, 'info');
    return 'skipped-session';
  }
  if (choice === WEIGHT_SPACING_CHOICE.disable) {
    try {
      const config = await backend.getConfig();
      await backend.setConfig({ ...config, promptWeightSpacingFix: false });
    } catch (e: any) {
      appState.pushMessage(WEIGHT_SPACING_TEXT.disableFailed(String(e?.message ?? e)), 'error');
      return 'cancelled';
    }
    appState.promptWeightSpacingFix = false;
    deps.onConfigChanged?.();
    appState.pushMessage(WEIGHT_SPACING_TEXT.disabledToast, 'info');
    return 'disabled';
  }
  return 'cancelled';
}

/**
 * 편집 확정 때 부른다. 조건이 맞으면 확인 창을 띄우고 선택을 처리한다. 확인 창은 한 번에 하나 — 이미 떠 있으면 'busy'.
 * apply 는 [보정 적용] 때 보정 결과로 부른다(호출부가 그 칸의 텍스트를 교체).
 */
export async function offerWeightSpacing(
  text: string,
  apply: (padded: string) => void,
  deps: WeightSpacingFlowDeps,
): Promise<WeightSpacingOfferResult> {
  const { appState } = deps;
  const config = { promptWeightSpacingFix: appState.promptWeightSpacingFix };
  if (!shouldOfferWeightSpacing(text, config, appState)) return 'none';
  if (offerOpen) return 'busy';
  const example = weightSpacingExample(text);
  if (!example) return 'none';
  offerOpen = true;
  try {
    const choice = await appState.pushDialogAsync({
      type: 'select',
      text: WEIGHT_SPACING_TEXT.dialog(example),
      items: [
        { text: WEIGHT_SPACING_TEXT.apply, value: WEIGHT_SPACING_CHOICE.apply },
        { text: WEIGHT_SPACING_TEXT.skipSession, value: WEIGHT_SPACING_CHOICE.skipSession },
        { text: WEIGHT_SPACING_TEXT.disable, value: WEIGHT_SPACING_CHOICE.disable },
      ],
    });
    return await applyWeightSpacingChoice(choice, text, apply, deps);
  } finally {
    offerOpen = false;
  }
}
