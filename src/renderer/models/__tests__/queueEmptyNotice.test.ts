// 예약 없이 「생성 시작」을 누르면 안내만 띄운다(2026-11-22) — 자동으로 예약하지 않는다(Anlas 가 나가는 동작).
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(
  path.resolve(__dirname, '../../componenets/TaskQueueControl.tsx'),
  'utf8',
);

describe('생성 시작 버튼 — 예약 없음 안내', () => {
  test('안내 문구 상수가 있고, 비용 계산·실행보다 먼저 빈 큐를 확인한다', () => {
    expect(src).toMatch(/export const QUEUE_EMPTY_NOTICE = '[^']+예약[^']+'/);
    const start = src.indexOf('aria-label="생성 시작"');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('aria-label="생성 중지"'));
    const empty = body.indexOf('taskQueueService.isEmpty()');
    expect(empty).toBeGreaterThan(-1);
    expect(body.indexOf('appState.pushMessage(QUEUE_EMPTY_NOTICE)')).toBeGreaterThan(empty);
    expect(body.indexOf('taskQueueService.calculateCost()')).toBeGreaterThan(empty);
    expect(body.indexOf('taskQueueService.run()')).toBeGreaterThan(empty);
  });
  test('빈 큐일 때 씬을 대신 예약하지 않는다', () => {
    const start = src.indexOf('aria-label="생성 시작"');
    const body = src.slice(start, src.indexOf('aria-label="생성 중지"'));
    expect(body).not.toMatch(/addScenesToQueue|queueAllScenes|addTask/);
  });
});
