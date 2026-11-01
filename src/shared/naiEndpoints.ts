// NovelAI 엔드포인트 단일 출처 + 개발자용 API 주소 전환(2026-11-01, 부스트 모드 디버그 — 플랜 §11)
//
// 평소에는 아래 두 상수(실제 NovelAI 주소)를 그대로 쓴다. 개발자가 PC 에서 환경 변수
// `SDSTUDIO_NAI_API_BASE`(예 `http://127.0.0.1:18080`)를 주고 앱을 실행하면 main 이 부팅 때 그 값을
// 읽어 IPC(`DEV_NAI_API_BASE_CHANNEL`)로 렌더러에 1회 넘기고, nai.ts 의 api/image 주소가 모두 그 주소로
// 바뀐다(로컬 가짜 서버 `dev/mock-nai/server.cjs` 용). UI·config 키는 없다. Android 는 범위 밖(종전 그대로).
//
// 안전: 토큰이 엉뚱한 곳으로 가지 않도록 **이 PC 안(루프백) 주소만** 받는다 — localhost·127.x.x.x·[::1].
// 그 밖의 값·형식 오류는 무시하고 실제 주소를 쓴다(main 이 경고 로그).
// 순수 함수만 둔다(jest naiEndpoints.test.ts).

/** 실제 NovelAI 계정·로그인 API(잔존 경로 전용 — SPEC §7). */
export const NAI_API_ENDPOINT = 'https://api.novelai.net';
/** 실제 NovelAI 이미지·사용자 정보 API(모든 신규 호출 — SPEC §7). */
export const NAI_IMAGE_ENDPOINT = 'https://image.novelai.net';

/** 개발자용 주소 전환 환경 변수 이름(PC main 프로세스가 읽는다). */
export const DEV_NAI_API_BASE_ENV = 'SDSTUDIO_NAI_API_BASE';
/** main → 렌더러 전달 IPC 채널(preload Channels 에 등록). 응답 = 정규화된 주소 또는 null. */
export const DEV_NAI_API_BASE_CHANNEL = 'get-dev-nai-api-base';
/** 전환 중일 때 콘솔 경고 문구(main·렌더러 각 1회). */
export const DEV_NAI_API_BASE_WARNING = '개발용 가짜 서버로 연결 중';

export interface NaiEndpoints {
  /** nai.ts `apiEndpoint`(api.novelai.net 자리) */
  api: string;
  /** nai.ts `apiEndpoint2`(image.novelai.net 자리) */
  image: string;
  /** 개발자용 주소로 바뀌었는가 */
  overridden: boolean;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * 환경 변수 값을 검사해 `프로토콜://호스트[:포트]` 형태(끝 `/`·경로 없음)로 돌려준다.
 * 비었거나·URL 이 아니거나·http(s) 가 아니거나·루프백이 아니거나·경로/쿼리가 있으면 undefined(= 전환 안 함).
 */
export function normalizeDevNaiApiBase(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined;
  if (!isLoopbackHost(url.hostname)) return undefined;
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return undefined;
  return `${url.protocol}//${url.host}`;
}

/**
 * nai.ts 가 쓸 주소 두 개. base 가 없거나 무효면 실제 NovelAI 상수 그대로(`overridden:false`).
 * 유효하면 api·image 모두 그 주소(가짜 서버 하나가 두 역할을 한다).
 */
export function resolveNaiEndpoints(base?: string | null): NaiEndpoints {
  const normalized = normalizeDevNaiApiBase(base);
  if (!normalized) {
    return { api: NAI_API_ENDPOINT, image: NAI_IMAGE_ENDPOINT, overridden: false };
  }
  return { api: normalized, image: normalized, overridden: true };
}
