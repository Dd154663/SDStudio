// 개발 실행(npm start)에서만 저장소 루트 .env 를 읽는다 (2026-10-02)
//
// 개발 모드는 main 을 번들 없이 ts-node 로 실행하므로 webpack EnvironmentPlugin 의 치환이 없다.
// googleDrive/client.ts 가 모듈 평가 시점에 process.env 를 읽기 때문에, main.ts 에서 googleDrive 를
// 불러오는 어떤 모듈보다 먼저 import 해야 한다.
// 프로덕션 번들: webpack 이 NODE_ENV 를 'production' 으로 치환해 아래 분기가 상수 false 가 되므로
// 로더 모듈과 .env 경로 접근은 번들에 들어가지 않는다(값은 빌드 시 주입본만 쓴다).

if (process.env.NODE_ENV === 'development') {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const { loadDotEnv } = require('../../.erb/configs/loadDotEnv');
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const path = require('path');
  loadDotEnv(path.resolve(__dirname, '../../.env'));
}

export {};
