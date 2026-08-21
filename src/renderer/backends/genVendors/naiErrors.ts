export type NaiApiErrorKind =
  | 'auth'
  | 'quota'
  | 'rate-limit'
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

function classify(status: number, detail: string): NaiApiErrorKind {
  const lower = detail.toLowerCase();
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
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
    status === 409 ||
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
    this.retryable = kind === 'rate-limit' || kind === 'server' || kind === 'network';
  }
}

export function createNaiApiError(
  status: number,
  body: string,
  correlationId?: string,
): NaiApiError {
  return new NaiApiError(status, body, correlationId);
}
