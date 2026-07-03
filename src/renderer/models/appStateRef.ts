import type { AppState } from './AppService';

// ── AppService ↔ 서비스 모듈 간 순환 import 게이트 ──
// AppService 모듈이 평가를 마치면서 setAppState() 로 자신을 등록하고,
// 서비스들은 getAppState() 로 "호출 시점"에 접근한다.
//
// 배경: 서비스 → AppService 를 정적 import 하면 (AppService 는 models/index 를
// import 하므로) 순환 평가 순서에 따라 TDZ 크래시 위험이 있어, 종전에는 곳곳에서
// await import('./AppService') 로 우회했다. 이 게이트는 그 우회를 대체한다 —
// 타입은 type-only import 라 순환 평가를 유발하지 않는다.
let ref: AppState | null = null;

export function setAppState(s: AppState) {
  ref = s;
}

export function getAppState(): AppState {
  if (!ref) {
    // index.tsx → App/bootstrap 이 AppService 를 먼저 평가하므로 정상 경로에선 불가능
    throw new Error('AppState가 아직 초기화되지 않았습니다 (부팅 순서 오류)');
  }
  return ref;
}
