import { parseRankCutoff } from '../rankCutoff';

describe('parseRankCutoff', () => {
  it('1 이상의 정수만 받는다', () => {
    expect(parseRankCutoff('3')).toBe(3);
    expect(parseRankCutoff(' 12 ')).toBe(12);
  });
  it('숫자가 아닌 입력은 거부한다 (slice(NaN) = 전부 삭제 방지)', () => {
    for (const bad of ['', '  ', 'abc', '3등', '-1', '0', '1.5', '1e3', undefined, null]) {
      expect(parseRankCutoff(bad as any)).toBeNull();
    }
  });
});
