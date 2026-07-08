// libuv 스레드풀 크기 확정 — 반드시 main 의 "첫 import" 로 둘 것.
//
// 이유: sharp(webp/avif 인코딩·리사이즈)의 비동기 연산은 libuv 스레드풀에서
// 실행되고, 동시에 처리되는 인코딩 수가 UV_THREADPOOL_SIZE(기본 4)로 제한된다.
// 내보내기·백업·WebP 일괄 변환이 worker-pool 로 N장을 동시에 던져도 네이티브가
// 4장만 인코딩하면 병렬이 4에서 막힌다(트랙2 WebP Phase 2).
//
// 함정(실측 2026-07-08): libuv 는 이 값을 스레드풀 "첫 사용" 시점에 한 번만 읽는데,
// Electron 은 앱 부팅 중(=main.js 실행 전)에 이미 스레드풀을 기본 4로 초기화한다.
// 따라서 main 최상단에서 process.env 를 바꿔도 늦다(슬라이더를 6 으로 올려도 4장까지만
// 병렬). 확실히 적용하려면, 원하는 값을 "프로세스 환경"에 물린 뒤 한 번 재실행해서
// 자식 프로세스의 libuv 가 부팅 초기화 전에 그 값을 읽게 해야 한다.
//
// 상한 32: 감지된 코어 수에 적응적으로 스케일하되(24코어면 24), 서버급 다코어의
// 병리적 값만 막는 가드 — 그 이상은 디스크 I/O·메모리가 먼저 병목이라 실익 없음.
// 렌더러의 platform.maxImageConcurrency(병렬 상한)와 같은 캡을 쓴다.
import os from 'os';
import { app } from 'electron';

// 자기 자신을 정확히 1회만 재실행하기 위한 표식(무한 재실행 방지 — 환경 전파가
// 실패해도 이 플래그가 있으면 자식은 재실행하지 않는다).
const RELAUNCH_FLAG = '--uv-pool-set';

const desired = Math.max(4, Math.min(os.cpus().length, 32));

// desired 가 4 이하면(=저코어) 기본값과 같으니 재실행 불필요. 패키징된 앱에서만
// 수행(개발 모드 npm start 는 argv 구조가 달라 인자 조작이 위험하므로 제외).
if (
  app.isPackaged &&
  desired > 4 &&
  !process.argv.includes(RELAUNCH_FLAG)
) {
  process.env.UV_THREADPOOL_SIZE = String(desired);
  // 현재 인자를 보존하고 표식을 덧붙여 재실행 → 현재 프로세스 종료 시 새 인스턴스가
  // 물려받은 환경(UV_THREADPOOL_SIZE=desired)으로 부팅한다.
  app.relaunch({ args: process.argv.slice(1).concat(RELAUNCH_FLAG) });
  app.exit(0);
} else if (!process.env.UV_THREADPOOL_SIZE) {
  // 개발 모드·저코어 등 재실행 경로를 타지 않는 경우에도 흔적은 남긴다(무해).
  process.env.UV_THREADPOOL_SIZE = String(desired);
}
