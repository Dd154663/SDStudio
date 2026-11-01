// 요청별 토큰 지정(부스트 모드 B0, 2026-10-29) — 순수 모듈, 의존성 없음.
//
// backend.generateImage 는 원래 매 요청 저장된 로그인 토큰(TOKEN.txt)을 읽어 쓴다. 부스트 워커(B1~)는
// 계정마다 다른 토큰으로 동시에 요청해야 하므로 선택 인자로 토큰을 받을 수 있게 한다.
// 토큰은 이 별도 인자로만 흐른다 — ImageGenInput·요청 옵션(NaiRequestOptions)·로그·이미지 메타에 넣지
// 않는다(직렬화·로그 노출 방지). 오류 문구에도 토큰 값을 넣지 않는다.

export interface GenerateImageOptions {
  /** 이 요청에만 쓸 NovelAI 토큰. 생략(undefined)하면 종전처럼 저장된 로그인 토큰을 읽는다. */
  token?: string;
}

export const REQUEST_TOKEN_EMPTY_TEXT = '요청에 지정한 로그인 토큰이 비어 있습니다.';

/**
 * 이번 요청에 쓸 토큰. 옵션에 토큰이 없으면 readStoredToken(TOKEN.txt)을 그대로 쓴다(종전 동작).
 * 토큰을 지정했는데 비어 있으면 저장된 토큰으로 몰래 대신하지 않고 재시도 불가 오류로 끝낸다 —
 * 대신 보내면 다른 계정(활성 계정)으로 요청이 나가 계정당 동시 1요청 규칙이 깨진다.
 */
export async function resolveRequestToken(
  options: GenerateImageOptions | undefined,
  readStoredToken: () => Promise<string>,
): Promise<string> {
  if (options?.token === undefined) return await readStoredToken();
  const token = typeof options.token === 'string' ? options.token.trim() : '';
  if (!token) {
    const err: any = new Error(REQUEST_TOKEN_EMPTY_TEXT);
    err.retryable = false;
    throw err;
  }
  return token;
}
