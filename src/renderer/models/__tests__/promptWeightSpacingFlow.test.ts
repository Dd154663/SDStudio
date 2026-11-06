/**
 * 가중치 숫자 태그 공백 보정(N1) 편집 단계 확인 + 해제 토글 — 2026-11-06 (SPEC_GUIDE §12 「가중치 숫자 태그 공백」).
 *  - 판정(기능 켬·세션 스킵·후보 유무), 예시 생성, 3버튼 분기, 한 번에 하나, 전송 옵션 계산
 */
import {
  applyWeightSpacingChoice,
  isWeightSpacingFixEnabled,
  isWeightSpacingOfferOpen,
  offerWeightSpacing,
  shouldOfferWeightSpacing,
  WEIGHT_SPACING_CHOICE,
  WEIGHT_SPACING_TEXT,
  weightSpacingExample,
  weightSpacingSendOption,
  WeightSpacingFlowDeps,
} from '../promptWeightSpacingFlow';

function makeDeps(choice?: string) {
  let resolveDialog: (v: string | undefined) => void = () => {};
  const stored: any = { other: 1 };
  const deps = {
    appState: {
      promptWeightSpacingFix: true,
      promptWeightSpacingSkipSession: false,
      pushDialogAsync: jest.fn(
        (_d: any) =>
          new Promise<string | undefined>((resolve) => {
            if (choice === 'manual') resolveDialog = resolve;
            else resolve(choice);
          }),
      ),
      pushMessage: jest.fn(),
    },
    backend: {
      getConfig: jest.fn(async () => ({ ...stored })),
      setConfig: jest.fn(async (c: any) => {
        Object.assign(stored, c);
      }),
    },
    onConfigChanged: jest.fn(),
  };
  return { deps, stored, resolve: (v: string | undefined) => resolveDialog(v) };
}

describe('판정·전송 옵션', () => {
  test('config 값 없음 = 켬, false 만 끔', () => {
    expect(isWeightSpacingFixEnabled({})).toBe(true);
    expect(isWeightSpacingFixEnabled(undefined)).toBe(true);
    expect(isWeightSpacingFixEnabled({ promptWeightSpacingFix: true })).toBe(true);
    expect(isWeightSpacingFixEnabled({ promptWeightSpacingFix: false })).toBe(false);
  });

  test('전송 옵션 = 켬 && 세션 스킵 아님', () => {
    expect(weightSpacingSendOption({}, { promptWeightSpacingSkipSession: false })).toBe(true);
    expect(weightSpacingSendOption({}, { promptWeightSpacingSkipSession: true })).toBe(false);
    expect(weightSpacingSendOption({ promptWeightSpacingFix: false }, { promptWeightSpacingSkipSession: false })).toBe(false);
  });

  test('확인 창 판정: 후보가 있을 때만, 기능 끔·세션 스킵이면 묻지 않음', () => {
    const on = { promptWeightSpacingSkipSession: false };
    expect(shouldOfferWeightSpacing('a, 1.5::0aaa0::', {}, on)).toBe(true);
    expect(shouldOfferWeightSpacing('a, 1.5:: 0aaa0 ::', {}, on)).toBe(false); // 이미 보정됨(멱등)
    expect(shouldOfferWeightSpacing('a, 1.5::girl::', {}, on)).toBe(false);
    expect(shouldOfferWeightSpacing('', {}, on)).toBe(false);
    expect(shouldOfferWeightSpacing('1.5::0aaa0::', { promptWeightSpacingFix: false }, on)).toBe(false);
    expect(shouldOfferWeightSpacing('1.5::0aaa0::', {}, { promptWeightSpacingSkipSession: true })).toBe(false);
  });
});

describe('예시 생성', () => {
  test('첫 후보 묶음을 앞 → 뒤로, 나머지는 개수', () => {
    expect(weightSpacingExample('girl, 1.5::0aaa0::, 2::x9::, 1.2::cat::')).toEqual({
      before: '1.5::0aaa0::',
      after: '1.5:: 0aaa0 ::',
      more: 1,
    });
  });

  test('숫자가 접촉한 쪽만 공백인 예시(2026-11-06 정밀화)', () => {
    expect(weightSpacingExample('girl, 1.5::bbb1::')).toEqual({ before: '1.5::bbb1::', after: '1.5::bbb1 ::', more: 0 });
    expect(weightSpacingExample('girl, 1.5::0aaa::, 2::x9::')).toEqual({
      before: '1.5::0aaa::',
      after: '1.5:: 0aaa::',
      more: 1,
    });
    // 이미 접촉한 쪽에 공백이 있으면 후보가 아니다
    expect(weightSpacingExample('girl, 1.5::bbb1 ::, 1.5:: 0aaa::')).toBeNull();
  });

  test('닫히지 않은 묶음은 끝까지, 후보 없으면 null', () => {
    expect(weightSpacingExample('a, 2::9lives')).toEqual({ before: '2::9lives', after: '2:: 9lives', more: 0 });
    expect(weightSpacingExample('a, 1.5::girl::')).toBeNull();
    expect(weightSpacingExample('')).toBeNull();
  });

  test('확인 창 본문에 예시·버그 설명이 들어간다', () => {
    const text = WEIGHT_SPACING_TEXT.dialog({ before: '1.5::0aaa0::', after: '1.5:: 0aaa0 ::', more: 2 });
    expect(text).toContain('1.5::0aaa0::  →  1.5:: 0aaa0 ::');
    expect(text).toContain('(외 2곳)');
    expect(text).toContain('가중치로 잘못 읽습니다');
  });
});

describe('3버튼 분기', () => {
  test('[보정 적용] = 보정 결과로 교체', async () => {
    const { deps } = makeDeps();
    const apply = jest.fn();
    const r = await applyWeightSpacingChoice(WEIGHT_SPACING_CHOICE.apply, 'a, 1.5::0aaa0::', apply, deps as any);
    expect(r).toBe('applied');
    expect(apply).toHaveBeenCalledWith('a, 1.5:: 0aaa0 ::');
    expect(deps.backend.setConfig).not.toHaveBeenCalled();
  });

  test('[이번 세션에는 보정 안 함] = 세션 플래그만(저장 없음)', async () => {
    const { deps } = makeDeps();
    const apply = jest.fn();
    const r = await applyWeightSpacingChoice(WEIGHT_SPACING_CHOICE.skipSession, '1.5::0aaa0::', apply, deps as any);
    expect(r).toBe('skipped-session');
    expect(deps.appState.promptWeightSpacingSkipSession).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    expect(deps.backend.setConfig).not.toHaveBeenCalled();
  });

  test('[다시 알리지 않음(기능 끄기)] = config 저장(다른 키 보존)·미러·알림·토스트', async () => {
    const { deps, stored } = makeDeps();
    const apply = jest.fn();
    const r = await applyWeightSpacingChoice(WEIGHT_SPACING_CHOICE.disable, '1.5::0aaa0::', apply, deps as any);
    expect(r).toBe('disabled');
    expect(stored).toEqual({ other: 1, promptWeightSpacingFix: false });
    expect(deps.appState.promptWeightSpacingFix).toBe(false);
    expect(deps.onConfigChanged).toHaveBeenCalled();
    expect(deps.appState.pushMessage).toHaveBeenCalledWith(WEIGHT_SPACING_TEXT.disabledToast, 'info');
    expect(apply).not.toHaveBeenCalled();
  });

  test('저장 실패면 기능을 끄지 않고 오류 토스트', async () => {
    const { deps } = makeDeps();
    deps.backend.setConfig.mockRejectedValueOnce(new Error('disk'));
    const r = await applyWeightSpacingChoice(WEIGHT_SPACING_CHOICE.disable, '1.5::0aaa0::', jest.fn(), deps as any);
    expect(r).toBe('cancelled');
    expect(deps.appState.promptWeightSpacingFix).toBe(true);
    expect(deps.appState.pushMessage.mock.calls[0][1]).toBe('error');
  });

  test('내장 취소·Esc(undefined) = 아무것도 하지 않음', async () => {
    const { deps } = makeDeps();
    const apply = jest.fn();
    expect(await applyWeightSpacingChoice(undefined, '1.5::0aaa0::', apply, deps as any)).toBe('cancelled');
    expect(apply).not.toHaveBeenCalled();
    expect(deps.appState.promptWeightSpacingSkipSession).toBe(false);
  });
});

describe('offerWeightSpacing — 창 띄우기', () => {
  test('select 창: 3항목(취소류 없음), 본문 예시', async () => {
    const { deps } = makeDeps(WEIGHT_SPACING_CHOICE.apply);
    const apply = jest.fn();
    expect(await offerWeightSpacing('x, 1.5::0aaa0::', apply, deps as unknown as WeightSpacingFlowDeps)).toBe('applied');
    const dialog = deps.appState.pushDialogAsync.mock.calls[0][0];
    expect(dialog.type).toBe('select');
    expect(dialog.items.map((i: any) => i.text)).toEqual([
      WEIGHT_SPACING_TEXT.apply,
      WEIGHT_SPACING_TEXT.skipSession,
      WEIGHT_SPACING_TEXT.disable,
    ]);
    expect(dialog.text).toContain('1.5::0aaa0::  →  1.5:: 0aaa0 ::');
    expect(apply).toHaveBeenCalledWith('x, 1.5:: 0aaa0 ::');
  });

  test('후보 없음·기능 끔·세션 스킵이면 창을 띄우지 않는다', async () => {
    const { deps } = makeDeps(WEIGHT_SPACING_CHOICE.apply);
    expect(await offerWeightSpacing('x, 1.5::girl::', jest.fn(), deps as any)).toBe('none');
    deps.appState.promptWeightSpacingSkipSession = true;
    expect(await offerWeightSpacing('1.5::0aaa0::', jest.fn(), deps as any)).toBe('none');
    deps.appState.promptWeightSpacingSkipSession = false;
    deps.appState.promptWeightSpacingFix = false;
    expect(await offerWeightSpacing('1.5::0aaa0::', jest.fn(), deps as any)).toBe('none');
    expect(deps.appState.pushDialogAsync).not.toHaveBeenCalled();
  });

  test('한 번에 하나 — 떠 있는 동안 다른 칸의 확정은 busy', async () => {
    const { deps, resolve } = makeDeps('manual');
    const first = offerWeightSpacing('1.5::0aaa0::', jest.fn(), deps as any);
    expect(isWeightSpacingOfferOpen()).toBe(true);
    expect(await offerWeightSpacing('2::9x::', jest.fn(), deps as any)).toBe('busy');
    resolve(undefined);
    expect(await first).toBe('cancelled');
    expect(isWeightSpacingOfferOpen()).toBe(false);
    expect(deps.appState.pushDialogAsync).toHaveBeenCalledTimes(1);
  });
});
