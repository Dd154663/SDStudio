/**
 * 부스트 모드 B0(2026-10-29) 선행 결함 수정의 순수 모듈:
 * - outputFileName: 결과 파일명 단조 증가 할당기(같은 ms 연속 호출도 서로 다른 이름, 숫자·자연 정렬 유지)
 * - seedSchedule: 장 번호 시드(seedForImageIndex) = 예전 job.seed 제자리 변이 연쇄와 같은 값
 * - requestToken: backend.generateImage 요청별 토큰 옵션(없으면 저장된 토큰)
 */
import {
  nextOutputPngPath,
  nextOutputTimestamp,
  resetOutputTimestampForTest,
} from '../outputFileName';
import { PNG_IMAGE_EXT } from '../imageFormats';
import {
  advanceSeedCursor,
  chainsSeed,
  seedForImageIndex,
  stepSeed,
} from '../seedSchedule';
import {
  REQUEST_TOKEN_EMPTY_TEXT,
  resolveRequestToken,
} from '../../backends/requestToken';

describe('결과 파일명 단조 증가 할당기', () => {
  beforeEach(() => resetOutputTimestampForTest());

  test('같은 ms 연속 호출은 서로 다른 숫자를 받는다(직전 + 1)', () => {
    const now = 1_760_000_000_000;
    expect(nextOutputTimestamp(now)).toBe(now);
    expect(nextOutputTimestamp(now)).toBe(now + 1);
    expect(nextOutputTimestamp(now)).toBe(now + 2);
  });

  test('시계가 앞서 가면 현재 시각을 그대로 쓴다(예전 Date.now() 이름과 같음)', () => {
    expect(nextOutputTimestamp(1000)).toBe(1000);
    expect(nextOutputTimestamp(5000)).toBe(5000);
  });

  test('시계가 뒤로 가도 직전보다 작아지지 않는다', () => {
    expect(nextOutputTimestamp(5000)).toBe(5000);
    expect(nextOutputTimestamp(4000)).toBe(5001);
  });

  test('소수·비유한 입력도 정수 증가를 지킨다', () => {
    expect(nextOutputTimestamp(1000.7)).toBe(1000);
    expect(nextOutputTimestamp(Number.NaN)).toBe(1001);
  });

  test('경로 = 출력 폴더/숫자.png, 같은 ms 라도 경로가 겹치지 않고 자연 정렬 순서 = 할당 순서', () => {
    const now = 1_760_000_000_123;
    const paths = [0, 1, 2, 3].map(() => nextOutputPngPath('outs/project/scene', now));
    expect(new Set(paths).size).toBe(4);
    expect(paths[0]).toBe(`outs/project/scene/${now}.${PNG_IMAGE_EXT}`);
    for (const p of paths) expect(p).toMatch(/^outs\/project\/scene\/\d+\.png$/);
    const names = paths.map((p) => p.split('/').pop()!);
    const sorted = [...names].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    expect(sorted).toEqual(names);
  });

  test('now 생략 시 Date.now() 를 쓴다', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(42_000);
    try {
      expect(nextOutputPngPath('o')).toBe(`o/42000.${PNG_IMAGE_EXT}`);
      expect(nextOutputPngPath('o')).toBe(`o/42001.${PNG_IMAGE_EXT}`);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('장 번호 시드(seedForImageIndex)', () => {
  test('stepSeed(xorshift32, 최소 1) 값은 예전과 같다', () => {
    expect(stepSeed(0)).toBe(1);
    expect(stepSeed(1)).toBe(270369);
    expect(stepSeed(0xffffffff)).toBeGreaterThanOrEqual(1);
  });

  test('k번째 = 시작 시드에 stepSeed 를 k번 적용', () => {
    const base = 123456789;
    expect(seedForImageIndex(base, 0)).toBe(base);
    expect(seedForImageIndex(base, 1)).toBe(stepSeed(base));
    expect(seedForImageIndex(base, 3)).toBe(stepSeed(stepSeed(stepSeed(base))));
  });

  test('랜덤(undefined)·0 은 연쇄하지 않는다(예전 if (job.seed))', () => {
    expect(seedForImageIndex(undefined, 5)).toBeUndefined();
    expect(seedForImageIndex(0, 5)).toBe(0);
    expect(chainsSeed(undefined)).toBe(false);
    expect(chainsSeed(0)).toBe(false);
    expect(chainsSeed(7)).toBe(true);
    expect(advanceSeedCursor(undefined, 2)).toBe(2);
    expect(advanceSeedCursor(0, undefined)).toBe(0);
    expect(advanceSeedCursor(7, undefined)).toBe(1);
    expect(advanceSeedCursor(7, 4)).toBe(5);
  });

  test('음수·소수·비유한 k 는 0 이하 내림으로 본다', () => {
    expect(seedForImageIndex(99, -3)).toBe(99);
    expect(seedForImageIndex(99, Number.NaN)).toBe(99);
    expect(seedForImageIndex(99, 1.9)).toBe(stepSeed(99));
  });

  test('성공·실패가 섞여도 예전 job.seed 제자리 변이 연쇄와 요청 시드 열이 같다', () => {
    // 예전: 요청 시드 = job.seed, 성공하면 job.seed = stepSeed(job.seed)(0·랜덤 제외).
    // 지금: 요청 시드 = seedForImageIndex(시작 시드, 커서), 성공하면 커서 = advanceSeedCursor.
    const outcomes = [true, false, false, true, true, false, true, true, false, true];
    for (const base of [undefined, 0, 1, 42, 2_100_000_001, 0xffffffff]) {
      let legacySeed = base;
      let cursor: number | undefined;
      const legacy: (number | undefined)[] = [];
      const now: (number | undefined)[] = [];
      for (const ok of outcomes) {
        legacy.push(legacySeed);
        now.push(seedForImageIndex(base, cursor ?? 0));
        if (ok) {
          if (legacySeed) legacySeed = stepSeed(legacySeed);
          cursor = advanceSeedCursor(base, cursor);
        }
      }
      expect(now).toEqual(legacy);
    }
  });
});

describe('요청별 토큰 옵션(resolveRequestToken)', () => {
  test('옵션이 없거나 token 이 없으면 저장된 토큰을 읽는다(종전)', async () => {
    const read = jest.fn(async () => 'stored');
    await expect(resolveRequestToken(undefined, read)).resolves.toBe('stored');
    await expect(resolveRequestToken({}, read)).resolves.toBe('stored');
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('token 을 지정하면 저장된 토큰을 읽지 않고 그 값을 쓴다(앞뒤 공백 제거)', async () => {
    const read = jest.fn(async () => 'stored');
    await expect(resolveRequestToken({ token: ' pst-abc \n' }, read)).resolves.toBe('pst-abc');
    expect(read).not.toHaveBeenCalled();
  });

  test('빈 토큰은 저장된 토큰으로 대신하지 않고 재시도 불가 오류', async () => {
    const read = jest.fn(async () => 'stored');
    await expect(resolveRequestToken({ token: '   ' }, read)).rejects.toMatchObject({
      message: REQUEST_TOKEN_EMPTY_TEXT,
      retryable: false,
    });
    expect(read).not.toHaveBeenCalled();
  });
});
