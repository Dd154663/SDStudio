import { createNaiApiError } from '../naiErrors';

describe('NovelAI API 오류 진단', () => {
  test('서버 메시지와 요청 ID를 보존한다', () => {
    const error = createNaiApiError(
      422,
      JSON.stringify({ message: 'unsupported parameter' }),
      'request-123',
    );
    expect(error.message).toContain('unsupported parameter');
    expect(error.message).toContain('request-123');
    expect(error.kind).toBe('unsupported-request');
    expect(error.retryable).toBe(false);
  });

  test('할당량 오류는 재시도 불가로 분류한다', () => {
    const error = createNaiApiError(400, 'Insufficient Anlas balance');
    expect(error.kind).toBe('quota');
    expect(error.retryable).toBe(false);
  });

  test('429와 5xx는 재시도 가능하다', () => {
    expect(createNaiApiError(429, '').retryable).toBe(true);
    expect(createNaiApiError(503, 'maintenance').retryable).toBe(true);
  });

  test('409(이전 요청 처리 중)는 미지원 요청이 아니라 재시도 가능한 concurrent(T4)', () => {
    const error = createNaiApiError(409, 'Concurrent generation is locked', 'req-409');
    expect(error.kind).toBe('concurrent');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('이전 요청 처리 중 (409)');
    expect(error.message).toContain('req-409');
  });
});
