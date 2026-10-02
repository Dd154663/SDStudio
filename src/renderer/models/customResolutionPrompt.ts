// 커스텀 해상도 직접 입력 대화상자(너비→높이) 공용 흐름(2026-10-03 X15c).
// 씬 편집 창·변형 씬 편집 창·대량 작업 「해상도 변경」이 같은 검증·64px 보정 규칙을 쓴다
// (규칙 원본 deleteFlowRules.parseCustomResolution — ResolutionPicker 와 같음).
// 예전에는 숫자 검증이 없어 빈칸·문자 입력이 0x0 으로 저장됐다.
import { getAppState } from './appStateRef';
import {
  customResolutionAdjustedText,
  parseCustomResolution,
} from './deleteFlowRules';

/** 취소·잘못된 입력이면 undefined(잘못된 입력은 안내 토스트). 보정됐으면 보정 안내. */
export async function promptCustomResolution(
  current?: { width?: number; height?: number },
): Promise<{ width: number; height: number } | undefined> {
  const appState = getAppState();
  const width = await appState.pushDialogAsync({
    type: 'input-confirm',
    text: '해상도 너비를 입력해주세요',
    inputValue: current?.width ? String(current.width) : undefined,
  });
  if (width == null) return undefined;
  const height = await appState.pushDialogAsync({
    type: 'input-confirm',
    text: '해상도 높이를 입력해주세요',
    inputValue: current?.height ? String(current.height) : undefined,
  });
  if (height == null) return undefined;
  const parsed = parseCustomResolution(width, height);
  if (!parsed.ok) {
    appState.pushMessage(parsed.message);
    return undefined;
  }
  if (parsed.adjusted) {
    appState.pushMessage(customResolutionAdjustedText(parsed.width, parsed.height));
  }
  return { width: parsed.width, height: parsed.height };
}
