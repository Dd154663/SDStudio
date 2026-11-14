// 오버레이 묶음 D(2026-11-14) — 직접 만든 창 3개를 공용 ModalOverlay 로 흡수한 결과의 검사.
// 렌더 검사: 그림체 프리셋 편집(size m·바닥줄 [저장][취소]·미저장 가드) · 즐겨찾기 추가/편집(size s·바닥줄
// [추가/저장][취소]·편집 모드만 footerStart [삭제]·미저장 가드 신설·빈 칸 안내 유지) · 작업 로그(size m·바닥줄
// [다운로드][닫기]·footerStart [초기화]·0개면 비활성·✕ aria-label).
// 소스 검사: 세 창 코드에 직접 창(fixed inset-0·bg-black/50·useBackdropClose)이 남지 않는다.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import * as fs from 'fs';
import * as path from 'path';

const mockLogs: { taskLogs: any[]; clearLogs: jest.Mock } = { taskLogs: [], clearLogs: jest.fn() };
// backStack 에 올라온 닫기 콜백(Esc·뒤로 가기 경로) — 맨 위 항목을 부르면 Esc 와 같다
const mockStack: (() => void)[] = [];

jest.mock('../BackStackService', () => ({
  useBackLayer: () => {},
  backStackService: {
    push: (fn: () => void) => {
      mockStack.push(fn);
      return {
        remove: () => {
          const i = mockStack.indexOf(fn);
          if (i >= 0) mockStack.splice(i, 1);
        },
      };
    },
  },
}));
jest.mock('../index', () => ({
  isMobile: false,
  taskQueueService: mockLogs,
  appUpdateNoticeService: {},
  backend: {},
  sessionService: {},
}));
const mockAppState: any = {
  pushMessage: jest.fn(),
  confirmAsync: jest.fn(async () => true),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../platform', () => ({ platform: {} }));
jest.mock('../TaskQueueService', () => ({}));
jest.mock('../MigrationService', () => ({ migrationService: {} }));
jest.mock('../PersistenceService', () => ({ persistService: {} }));
jest.mock('../legacyCleanup', () => ({ scanLegacyRemnants: jest.fn(), deleteLegacyRemnants: jest.fn() }));
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));
jest.mock('../../componenets/PromptEditTextArea', () => () => null);
jest.mock('../../componenets/UtilComponents', () => ({ FileUploadBase64: () => null }));
jest.mock('../../backends/imageGen', () => ({
  Sampling: { KEulerAncestral: 'k_euler_ancestral' },
  NoiseSchedule: { Karras: 'karras' },
}));

import { BookmarkDialog } from '../../componenets/EmbeddedBrowser';
import { PresetEditModal } from '../../componenets/PresetEditModal';
import { TaskLogSection } from '../../componenets/ConfigSystemTab';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockAppState.pushMessage = jest.fn();
  mockAppState.confirmAsync = jest.fn(async () => true);
  mockLogs.taskLogs = [];
  mockLogs.clearLogs = jest.fn();
  mockStack.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const slotButtons = (slot: 'footer') =>
  Array.from(q(`[data-modal-slot="${slot}"]`)!.querySelectorAll('button')).map((b) => b.textContent?.trim());
/** 바닥줄의 왼쪽(footerStart)·오른쪽(footer) 묶음 — ModalOverlay 는 왼쪽 div 뒤에 ml-auto div 를 둔다 */
const footerParts = () => {
  const footer = q('[data-modal-slot="footer"]')!;
  const right = footer.querySelector(':scope > .ml-auto')!;
  const left = Array.from(footer.children).filter((c) => c !== right);
  const texts = (els: Element[]) =>
    els.flatMap((e) => Array.from(e.querySelectorAll('button')).map((b) => b.textContent?.trim()));
  return { left: texts(left), right: texts([right]) };
};
const button = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const closeX = () => container.querySelector('button[aria-label="닫기"]') as HTMLButtonElement;
const flush = () => act(async () => {});

describe('그림체 프리셋 편집(PresetEditModal) — size m·바닥줄·미저장 가드', () => {
  const renderPreset = async (onClose: jest.Mock) => {
    const adapter = { fetchProfile: jest.fn(async () => null), save: jest.fn(async () => {}) };
    await act(async () =>
      root.render(
        <PresetEditModal title="프리셋 편집" initialName="이름A" preset={{}} adapter={adapter} onClose={onClose} />,
      ),
    );
    return adapter;
  };

  test('size m 등급 경로, 제목은 머리줄, 바닥줄 = [저장][취소](오른쪽), 왼쪽은 비어 있음', async () => {
    await renderPreset(jest.fn());
    expect(q('[data-modal-size]')!.getAttribute('data-modal-size')).toBe('m');
    expect(q('h2')!.textContent).toBe('프리셋 편집');
    expect(footerParts()).toEqual({ left: [], right: ['저장', '취소'] });
    expect(button('저장').className).toContain('btn-solid-sky');
    expect(button('취소').className).toContain('btn-neutral');
    expect(closeX()).not.toBeNull();
  });

  test('변경 없으면 ✕ 는 묻지 않고 닫는다', async () => {
    const onClose = jest.fn();
    await renderPreset(onClose);
    await act(async () => Simulate.click(closeX()));
    expect(mockAppState.confirmAsync).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('이름을 바꾸면 ✕·[취소]·Esc 모두 확인을 묻고, 거절하면 닫지 않고 확인하면 닫는다(한 번만 묻는다)', async () => {
    const onClose = jest.fn();
    await renderPreset(onClose);
    act(() => Simulate.change(container.querySelector('input')!, { target: { value: '이름B' } } as any));

    mockAppState.confirmAsync = jest.fn(async () => false);
    await act(async () => Simulate.click(closeX()));
    await flush();
    expect(mockAppState.confirmAsync).toHaveBeenCalledTimes(1);
    await act(async () => Simulate.click(button('취소')));
    await flush();
    expect(mockAppState.confirmAsync).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();

    mockAppState.confirmAsync = jest.fn(async () => true);
    expect(mockStack.length).toBe(1); // backStack 은 ModalOverlay 한 겹뿐(자체 useBackLayer 없음)
    await act(async () => mockStack[mockStack.length - 1]());
    await flush();
    expect(mockAppState.confirmAsync).toHaveBeenCalledTimes(1); // 이중 확인 없음(dirty 미전달)
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('[저장] 성공 뒤 닫기는 가드를 거치지 않는다', async () => {
    const onClose = jest.fn();
    const adapter = await renderPreset(onClose);
    act(() => Simulate.change(container.querySelector('input')!, { target: { value: '이름B' } } as any));
    await act(async () => Simulate.click(button('저장')));
    await flush();
    expect(adapter.save).toHaveBeenCalledTimes(1);
    expect(mockAppState.confirmAsync).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('즐겨찾기 추가/편집(BookmarkDialog) — size s·바닥줄·미저장 가드', () => {
  test('추가 모드: size s, 제목 「즐겨찾기 추가」, 바닥줄 = [추가][취소], [삭제] 없음, 이름 칸 autoFocus', async () => {
    await act(async () =>
      root.render(<BookmarkDialog mode="add" initialLabel="" initialUrl="" onConfirm={jest.fn()} onClose={jest.fn()} />),
    );
    expect(q('[data-modal-size]')!.getAttribute('data-modal-size')).toBe('s');
    expect(q('h2')!.textContent).toBe('즐겨찾기 추가');
    expect(footerParts()).toEqual({ left: [], right: ['추가', '취소'] });
    expect(button('삭제')).toBeUndefined();
    expect(document.activeElement).toBe(container.querySelector('input'));
  });

  test('편집 모드: 바닥줄 왼쪽 = [삭제], 오른쪽 = [저장][취소], [삭제] 는 onDelete', async () => {
    const onDelete = jest.fn();
    await act(async () =>
      root.render(
        <BookmarkDialog
          mode="edit"
          initialLabel="A"
          initialUrl="https://a"
          onConfirm={jest.fn()}
          onDelete={onDelete}
          onClose={jest.fn()}
        />,
      ),
    );
    expect(q('h2')!.textContent).toBe('즐겨찾기 편집');
    expect(footerParts()).toEqual({ left: ['삭제'], right: ['저장', '취소'] });
    expect(button('삭제').className).toContain('text-red-500');
    expect(button('저장').className).toContain('btn-solid-sky');
    act(() => Simulate.click(button('삭제')));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  test('편집 모드라도 onDelete 가 없으면 [삭제] 를 그리지 않는다', async () => {
    await act(async () =>
      root.render(<BookmarkDialog mode="edit" initialLabel="A" initialUrl="https://a" onConfirm={jest.fn()} onClose={jest.fn()} />),
    );
    expect(button('삭제')).toBeUndefined();
  });

  test('바꾼 게 없으면 [취소]·✕ 는 묻지 않고 닫는다', async () => {
    const onClose = jest.fn();
    await act(async () =>
      root.render(<BookmarkDialog mode="edit" initialLabel="A" initialUrl="https://a" onConfirm={jest.fn()} onClose={onClose} />),
    );
    await act(async () => Simulate.click(button('취소')));
    await act(async () => Simulate.click(closeX()));
    expect(mockAppState.confirmAsync).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('이름을 바꾸면 [취소]·Esc 가 확인을 묻고, 거절하면 유지·확인하면 닫는다', async () => {
    const onClose = jest.fn();
    await act(async () =>
      root.render(<BookmarkDialog mode="edit" initialLabel="A" initialUrl="https://a" onConfirm={jest.fn()} onClose={onClose} />),
    );
    act(() => Simulate.change(container.querySelector('input')!, { target: { value: 'B' } } as any));
    mockAppState.confirmAsync = jest.fn(async () => false);
    await act(async () => Simulate.click(button('취소')));
    await flush();
    expect(mockAppState.confirmAsync).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    mockAppState.confirmAsync = jest.fn(async () => true);
    expect(mockStack.length).toBe(1);
    await act(async () => mockStack[0]());
    await flush();
    expect(mockAppState.confirmAsync).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('빈 칸이면 [추가] 는 칸 이름 토스트만, 확정·닫기 안 함(M1 유지)', async () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    await act(async () =>
      root.render(<BookmarkDialog mode="add" initialLabel="" initialUrl="" onConfirm={onConfirm} onClose={onClose} />),
    );
    act(() => Simulate.click(button('추가')));
    expect(mockAppState.pushMessage).toHaveBeenCalledWith('다음 칸을 확인해 주세요: 이름, URL', 'error');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const [labelInput, urlInput] = Array.from(container.querySelectorAll('input'));
    act(() => Simulate.change(labelInput, { target: { value: ' 이름 ' } } as any));
    act(() => Simulate.change(urlInput, { target: { value: ' https://x ' } } as any));
    act(() => Simulate.click(button('추가')));
    expect(onConfirm).toHaveBeenCalledWith('이름', 'https://x');
    expect(mockAppState.confirmAsync).not.toHaveBeenCalled();
  });
});

describe('작업 로그(TaskLogSection) — size m·바닥줄', () => {
  const open = async () => {
    await act(async () => root.render(<TaskLogSection />));
    expect(q('[data-modal-size]')).toBeNull(); // 열기 전에는 창 없음
    await act(async () => Simulate.click(button('작업 로그 보기')));
  };

  test('로그 0개: size m, 제목 「작업 로그」, 바닥줄 = 왼쪽 [초기화]·오른쪽 [다운로드][닫기], [다운로드]·[초기화] 비활성, 빈 안내', async () => {
    await open();
    expect(q('[data-modal-size]')!.getAttribute('data-modal-size')).toBe('m');
    expect(q('h2')!.textContent).toBe('작업 로그');
    expect(footerParts()).toEqual({ left: ['초기화'], right: ['다운로드', '닫기'] });
    expect(button('다운로드').disabled).toBe(true);
    expect(button('초기화').disabled).toBe(true);
    expect(button('닫기').disabled).toBe(false);
    expect(button('초기화').className).toContain('btn-solid-red');
    expect(q('[data-task-log-list]')!.textContent).toContain('로그가 없습니다.');
    expect(closeX().getAttribute('aria-label')).toBe('닫기');
  });

  test('로그가 있으면 목록(font-mono·최신 먼저)·버튼 활성, [초기화] = clearLogs, [닫기]·✕ 로 닫힌다', async () => {
    mockLogs.taskLogs = [
      { timestamp: Date.now() - 1000, level: 'info', scene: 's1', message: '첫째' },
      { timestamp: Date.now(), level: 'error', scene: 's2', message: '둘째' },
    ];
    await open();
    const list = q('[data-task-log-list]')!;
    expect(list.className).toContain('font-mono');
    const rows = Array.from(list.children);
    expect(rows[0].textContent).toContain('둘째');
    expect(rows[0].className).toContain('text-red-500');
    expect(button('다운로드').disabled).toBe(false);
    act(() => Simulate.click(button('초기화')));
    expect(mockLogs.clearLogs).toHaveBeenCalledTimes(1);
    expect(mockAppState.confirmAsync).not.toHaveBeenCalled(); // 초기화 확인 없음(종전 그대로)
    act(() => Simulate.click(button('닫기')));
    expect(q('[data-modal-size]')).toBeNull();
    await act(async () => Simulate.click(button('작업 로그 보기')));
    await act(async () => Simulate.click(closeX()));
    expect(q('[data-modal-size]')).toBeNull();
  });
});

describe('소스 검사 — 세 창에 직접 창이 남지 않는다', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '../../componenets', f), 'utf8');
  /** start 표식부터 end 표식(없으면 파일 끝)까지 — 같은 파일의 다른 정당한 창을 건드리지 않게 창 코드만 자른다 */
  const section = (f: string, start: string, end?: string) => {
    const src = read(f);
    const a = src.indexOf(start);
    expect(a).toBeGreaterThanOrEqual(0);
    const b = end ? src.indexOf(end, a) : src.length;
    expect(b).toBeGreaterThan(a);
    return src.slice(a, b);
  };
  test.each([
    ['그림체 프리셋 편집', 'PresetEditModal.tsx', 'export const PresetEditModal', undefined, 'm'],
    ['즐겨찾기 추가/편집', 'EmbeddedBrowser.tsx', 'export const BookmarkDialog', '// webview 태그 타입은', 's'],
    ['작업 로그', 'ConfigSystemTab.tsx', 'export const TaskLogSection', 'export default SystemTab', 'm'],
  ])('%s(%s): ModalOverlay size="%s"·직접 창 흔적 없음', (_n, file, start, end, size) => {
    const code = section(file, start, end as string | undefined);
    expect(code).toContain('<ModalOverlay');
    expect(code).toContain(`size="${size}"`);
    expect(code).not.toMatch(/fixed inset-0/);
    expect(code).not.toMatch(/bg-black/);
    expect(code).not.toMatch(/useBackdropClose|useBackLayer/);
    expect(code).not.toMatch(/\sdirty=\{/); // 래퍼 dirty 미전달(이중 확인 방지)
  });
  test('세 파일 모두 자체 뒤로 가기·바깥 클릭 훅을 더는 import 하지 않는다', () => {
    for (const f of ['PresetEditModal.tsx', 'EmbeddedBrowser.tsx', 'ConfigSystemTab.tsx']) {
      expect(read(f)).not.toMatch(/useBackdropClose|useBackLayer/);
    }
  });
});
