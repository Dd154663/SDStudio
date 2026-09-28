// Google 드라이브 연동 — OAuth 클라이언트·엔드포인트 상수 (드라이브 API ①, 2026-09-28)
//
// 데스크톱(설치형) 앱 OAuth 클라이언트. 토큰 교환에는 PKCE 와 함께 client_secret 이 필수다
// (2026-09-28 실험: 생략 시 400).
//
// 값은 소스에 두지 않고 빌드 시 주입한다(2026-10-02). installed app 의 client_secret 은 Google 정책상
// 비밀로 취급되지 않지만, 공개 저장소의 푸시 보호(GH013)가 리터럴을 막기 때문이다.
//   - 프로덕션: webpack.config.main.prod.ts 의 EnvironmentPlugin 이 아래 process.env.X 를 문자열로 치환
//     (값 출처 = 저장소 루트 .env(gitignore) 또는 CI Secrets). renderer 번들에는 들어가지 않는다.
//   - 개발(npm start): src/main/devDotEnv.ts 가 이 모듈보다 먼저 .env 를 process.env 에 채운다.
// 치환이 되도록 process.env.X 를 직접 참조한다(구조 분해·동적 키 금지).
// 값이 비어 있으면(포크·기여자 빌드, Secrets 미등록) 드라이브 연동은 「설정 없음」(not-configured).

export const GOOGLE_OAUTH_CLIENT_ID: string = process.env.SDSTUDIO_GOOGLE_CLIENT_ID || '';
export const GOOGLE_OAUTH_CLIENT_SECRET: string = process.env.SDSTUDIO_GOOGLE_CLIENT_SECRET || '';

// 클라이언트 ID·시크릿이 둘 다 주입된 빌드인지.
export function isGoogleOAuthConfigured(): boolean {
  return GOOGLE_OAUTH_CLIENT_ID.trim() !== '' && GOOGLE_OAUTH_CLIENT_SECRET.trim() !== '';
}

// 앱이 만든 파일·폴더에만 접근하는 비민감 범위(앱 검증 불필요).
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_DRIVE_ABOUT_ENDPOINT =
  'https://www.googleapis.com/drive/v3/about?fields=' +
  encodeURIComponent('user(emailAddress),storageQuota');

// 브라우저 승인 대기 한도.
export const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
// access token 만료 이만큼 전이면 미리 갱신한다.
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
// 토큰·about·revoke 요청 한 번의 제한 시간.
export const HTTP_TIMEOUT_MS = 20 * 1000;
