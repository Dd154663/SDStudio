export type NaiApiErrorKind =
  | 'auth'
  | 'quota'
  | 'rate-limit'
  | 'concurrent'
  | 'prompt-limit'
  | 'unsupported-request'
  | 'server'
  | 'network';

function serverMessage(rawBody: string): string {
  const text = rawBody.trim();
  if (!text) return '';
  try {
    const json = JSON.parse(text);
    const value =
      json?.message ?? json?.error?.message ?? json?.error ?? json?.detail;
    return typeof value === 'string' ? value : text;
  } catch {
    return text;
  }
}

const CONCURRENT_LOCK_PATTERN = /concurrent generation is locked/i;

function classify(status: number, detail: string): NaiApiErrorKind {
  const lower = detail.toLowerCase();
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  // 409 = 같은 계정의 이전 생성 요청을 서버가 아직 처리 중(「Concurrent generation is locked」).
  // 잠시 뒤 회복되므로 재시도한다(2026-10-04 T4 — 예전엔 미지원 요청으로 즉시 중단).
  if (status === 409 || CONCURRENT_LOCK_PATTERN.test(detail)) return 'concurrent';
  if (
    /anlas|quota|balance|subscription|shared.?trial|usage|credit/.test(lower)
  ) {
    return 'quota';
  }
  if (/token|context length|prompt.{0,20}(long|length|limit)/.test(lower)) {
    return 'prompt-limit';
  }
  if (
    status === 400 ||
    status === 404 ||
    status === 405 ||
    status === 415 ||
    status === 422
  ) {
    return 'unsupported-request';
  }
  return status >= 500 ? 'server' : 'network';
}

const KIND_LABEL: Record<NaiApiErrorKind, string> = {
  auth: '로그인 인증 오류',
  quota: '할당량 또는 Anlas 오류',
  'rate-limit': '요청 제한',
  concurrent: '이전 요청 처리 중',
  'prompt-limit': '프롬프트 길이 오류',
  'unsupported-request': '지원하지 않는 요청',
  server: 'NovelAI 서버 오류',
  network: '네트워크 오류',
};

export class NaiApiError extends Error {
  readonly status: number;
  readonly correlationId?: string;
  readonly kind: NaiApiErrorKind;
  readonly retryable: boolean;

  constructor(
    status: number,
    rawBody: string,
    correlationId?: string,
  ) {
    const detail = serverMessage(rawBody);
    const kind = classify(status, detail);
    const requestText = correlationId ? ` / 요청 ID ${correlationId}` : '';
    super(
      `${KIND_LABEL[kind]} (${status})${detail ? `: ${detail}` : ''}${requestText}`,
    );
    this.name = 'NaiApiError';
    this.status = status;
    this.correlationId = correlationId;
    this.kind = kind;
    this.retryable =
      kind === 'rate-limit' ||
      kind === 'concurrent' ||
      kind === 'server' ||
      kind === 'network';
  }
}

/**
 * 요청 제한(429) 판정. NaiApiError 의 status/kind 를 먼저 보고, status·kind 가 없는 오류만
 * 메시지 문자열로 폴백한다(요청 ID·cf-ray 에 섞인 「429」 오판정 방지).
 */
export function isNaiRateLimitError(e: unknown): boolean {
  const err = e as any;
  if (!err) return false;
  if (typeof err.status === 'number') return err.status === 429;
  if (typeof err.kind === 'string') return err.kind === 'rate-limit';
  return typeof err.message === 'string' && /\b429\b/.test(err.message);
}

/** 오류 종류의 사용자 표시 이름(예: 「이전 요청 처리 중」). */
export function naiErrorKindLabel(kind: NaiApiErrorKind): string {
  return KIND_LABEL[kind];
}

/**
 * 이전 요청 처리 중(409, 「Concurrent generation is locked」) 판정. NaiApiError 의 kind/status 를
 * 먼저 보고, status·kind 가 없는 오류만 메시지 문구로 폴백한다(요청 ID 의 「409」 오판정 방지 —
 * 숫자만으로는 판정하지 않는다). 큐는 이 오류를 사다리 대신 고정 30초 뒤 재시도한다(requestTiming).
 */
export function isNaiConcurrentError(e: unknown): boolean {
  const err = e as any;
  if (!err) return false;
  if (err.kind === 'concurrent') return true;
  if (typeof err.status === 'number') return err.status === 409;
  if (typeof err.kind === 'string') return false;
  return typeof err.message === 'string' && CONCURRENT_LOCK_PATTERN.test(err.message);
}

export function createNaiApiError(
  status: number,
  body: string,
  correlationId?: string,
): NaiApiError {
  return new NaiApiError(status, body, correlationId);
}
