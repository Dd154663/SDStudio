// 환경설정 → 시스템 「예제 프리셋 잔존 이미지 정리」 섹션(2026-11-15) 렌더 검사.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';

const mockScan = jest.fn();
const mockDelete = jest.fn();
jest.mock('../exampleVibeCleanupRuntime', () => ({
  scanExampleVibesNow: (...a: any[]) => mockScan(...a),
  deleteExampleVibesNow: (...a: any[]) => mockDelete(...a),
}));
jest.mock('../BackStackService', () => ({ useBackLayer: () => {}, backStackService: { push: () => ({ remove: () => {} }) } }));
jest.mock('../index', () => ({
  isMobile: false,
  taskQueueService: { taskLogs: [] },
  appUpdateNoticeService: {},
  backend: {},
  sessionService: {},
}));
const mockAppState: any = { pushMessage: jest.fn(), pushDialog: jest.fn() };
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../platform', () => ({ platform: {} }));
jest.mock('../TaskQueueService', () => ({}));
jest.mock('../MigrationService', () => ({ migrationService: {} }));
jest.mock('../PersistenceService', () => ({ persistService: {} }));
jest.mock('../legacyCleanup', () => ({ scanLegacyRemnants: jest.fn(), deleteLegacyRemnants: jest.fn() }));

import { ExampleVibeCleanupSection } from '../../componenets/ConfigSystemTab';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockScan.mockReset();
  mockDelete.mockReset();
  mockAppState.pushMessage = jest.fn();
  mockAppState.pushDialog = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;

test('검사 0건 — 「남은 예제 이미지가 없습니다.」, 정리 버튼 없음', async () => {
  mockScan.mockResolvedValue({ items: [], projectsScanned: 3, projectsFailed: [], removableBytes: 0 });
  await act(async () => root.render(<ExampleVibeCleanupSection />));
  expect(q('[data-example-vibe-section]')!.textContent).toContain('예제 프리셋 잔존 이미지 정리');
  await act(async () => Simulate.click(q('[data-example-vibe-scan]')!));
  expect(q('[data-example-vibe-empty]')!.textContent).toBe('남은 예제 이미지가 없습니다.');
  expect(q('[data-example-vibe-clean]')).toBeNull();
});

test('퀵 생성 전용 프로젝트의 이지 모드 프리셋 — 요약·배지·확인 문구에 함께 제거 안내', async () => {
  const items = [
    { project: '퀵 생성', fileName: 'a.png', label: '동글', size: 1421908, referenced: false, easyPresets: ['동글'] },
  ];
  mockScan.mockResolvedValue({ items, projectsScanned: 1, projectsFailed: [], removableBytes: 1421908 });
  await act(async () => root.render(<ExampleVibeCleanupSection />));
  await act(async () => Simulate.click(q('[data-example-vibe-scan]')!));
  expect(q('[data-example-vibe-summary]')!.textContent).toBe(
    '프로젝트 1개 · 파일 1개 · 총 1.4 MB · 이지 모드 프리셋 1개도 함께 제거',
  );
  expect(q('[data-example-vibe-easy-preset]')).not.toBeNull();
  expect(q('[data-example-vibe-referenced]')).toBeNull();
  await act(async () => Simulate.click(q('[data-example-vibe-clean]')!));
  expect(mockAppState.pushDialog.mock.calls[0][0].text).toContain(
    '퀵 생성 전용 프로젝트의 이지 모드 예제 프리셋 1개도 함께 제거합니다.',
  );
});

test('검사 결과 — 프로젝트별 목록·사용 중 배지, 정리 → 확인 창 → 미참조만 넘김 → 재검사', async () => {
  const items = [
    { project: 'p1', fileName: 'a.png', label: '애니스타일', size: 1172170, referenced: false },
    { project: 'p1', fileName: 'b.png', label: '동글', size: 1421908, referenced: true },
  ];
  mockScan.mockResolvedValue({ items, projectsScanned: 1, projectsFailed: [], removableBytes: 1172170 });
  mockDelete.mockResolvedValue({ deleted: 1, failed: [], presetsRemoved: 0 });
  await act(async () => root.render(<ExampleVibeCleanupSection />));
  await act(async () => Simulate.click(q('[data-example-vibe-scan]')!));
  expect(q('[data-example-vibe-summary]')!.textContent).toBe('프로젝트 1개 · 파일 1개 · 총 1.1 MB');
  expect(container.querySelectorAll('[data-example-vibe-item]').length).toBe(2);
  expect(q('[data-example-vibe-item="b.png"] [data-example-vibe-referenced]')!.textContent).toBe('사용 중 — 제외');
  expect(q('[data-example-vibe-item="a.png"] [data-example-vibe-referenced]')).toBeNull();
  const btn = q('[data-example-vibe-clean]') as HTMLButtonElement;
  expect(btn.textContent).toBe('휴지통으로 이동');
  expect(btn.disabled).toBe(false);

  await act(async () => Simulate.click(btn));
  expect(mockAppState.pushDialog).toHaveBeenCalledTimes(1);
  const dlg = mockAppState.pushDialog.mock.calls[0][0];
  expect(dlg.text).toContain('OS 휴지통');
  await act(async () => dlg.callback());
  expect(mockDelete.mock.calls[0][0]).toEqual([items[0]]);
  expect(mockScan).toHaveBeenCalledTimes(2);
  expect(mockAppState.pushMessage).toHaveBeenCalledWith('예제 프리셋 잔존 이미지 1개를 정리했습니다.', 'success');
});
