// 작은 그림 먼저 → 원본으로 바꿔 끼우기(2026-11-26 히스토리 확대) — 상태 전이만 정하는 순수 리듀서, jest historyViewer.test.ts.
//
// · 읽기마다 key(증가하는 번호)를 붙인다. 지금 key 가 아닌 응답(늦게 도착한 이전 장의 읽기)은 무시한다.
// · 썸네일이 원본보다 늦게 와도 원본을 덮지 않는다.
// · 파일이 없으면(읽기 결과 null) 'missing' — 부르는 쪽이 히스토리에서 지우는 등 처리한다.
// · 원본 읽기가 실패해도 썸네일이 있으면 썸네일을 그대로 보여 준다(빈 화면 대신).

export type ProgressiveStage = 'idle' | 'loading' | 'thumb' | 'full' | 'missing' | 'error';

export interface ProgressiveImageState {
  key: number;
  stage: ProgressiveStage;
  src?: string;
}

export type ProgressiveImageEvent =
  | { type: 'start'; key: number }
  | { type: 'thumb'; key: number; src: string }
  | { type: 'full'; key: number; src: string }
  | { type: 'missing'; key: number }
  | { type: 'fail'; key: number };

export const initialProgressiveImageState: ProgressiveImageState = { key: 0, stage: 'idle' };

export function progressiveImageReducer(
  state: ProgressiveImageState,
  ev: ProgressiveImageEvent,
): ProgressiveImageState {
  if (ev.type === 'start') {
    if (ev.key <= state.key) return state; // 뒤처진 시작은 무시
    return { key: ev.key, stage: 'loading' };
  }
  if (ev.key !== state.key) return state; // 늦게 도착한 이전 장의 응답
  switch (ev.type) {
    case 'thumb':
      if (state.stage === 'full' || state.stage === 'missing') return state;
      return { key: state.key, stage: 'thumb', src: ev.src };
    case 'full':
      if (state.stage === 'missing') return state;
      return { key: state.key, stage: 'full', src: ev.src };
    case 'missing':
      if (state.stage === 'full') return state;
      return { key: state.key, stage: 'missing' };
    case 'fail':
      if (state.stage === 'thumb' || state.stage === 'full') return state;
      return { key: state.key, stage: 'error' };
    default:
      return state;
  }
}
