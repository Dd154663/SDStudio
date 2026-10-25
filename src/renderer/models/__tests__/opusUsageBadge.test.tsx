import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const login = Object.assign(new EventTarget(), {
  activeProfileId: 'one',
  listTokenProfiles: jest.fn(() => [{ id: 'one', name: '주 계정' }, { id: 'two', name: '보조 계정' }]),
  loadTokenProfiles: jest.fn(async () => {}),
  activateTokenProfile: jest.fn(async (_id: string) => 'valid'),
});
const usage = Object.assign(new EventTarget(), {
  status: { percent: 91, isNegative: false, timeUntilNextPercent: 1 },
  state: 'ready', fetchedAt: Date.now(), refreshing: false,
  refresh: jest.fn(async () => undefined),
  quiet: false, quietLoaded: true,
  loadQuiet: jest.fn(async () => false),
  setQuiet: jest.fn(async (value: boolean) => { usage.quiet = value; }),
});
jest.mock('..', () => ({ loginService: login, opusUsageService: usage }));
jest.mock('../AppService', () => ({ appState: { incrementModalOverlay: jest.fn(), decrementModalOverlay: jest.fn() } }));
jest.mock('../BackStackService', () => ({ backStackService: { push: () => ({ remove() {} }) } }));
import OpusUsageBadge from '../../componenets/OpusUsageBadge';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  (global as any).ResizeObserver = class { observe() {} disconnect() {} };
  jest.clearAllMocks();
  login.activeProfileId = 'one';
  login.listTokenProfiles.mockReturnValue([{ id: 'one', name: '주 계정' }, { id: 'two', name: '보조 계정' }]);
  login.activateTokenProfile.mockResolvedValue('valid');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function open() {
  await act(async () => root.render(<OpusUsageBadge />));
  await act(async () => container.querySelector('button')!.click());
}
const target = () => document.querySelector<HTMLButtonElement>('button[aria-label="보조 계정으로 전환"]');

test('저장된 토큰이 2개면 전환 UI가 열리며 열기만으로 계정을 조회/전환하지 않는다', async () => {
  await open();
  expect(target()).not.toBeNull();
  expect(login.activateTokenProfile).not.toHaveBeenCalled();
  expect(usage.refresh).not.toHaveBeenCalled();
});

test('저장 토큰 1개면 전환 영역을 표시하지 않는다', async () => {
  login.listTokenProfiles.mockReturnValue([{ id: 'one', name: '주 계정' }]);
  await open();
  expect(target()).toBeNull();
  expect(document.body.textContent).not.toContain('계정 전환');
});

test('전환 중 중복 클릭을 막고 성공하면 잔량을 갱신한다', async () => {
  let finish!: (value: string) => void;
  login.activateTokenProfile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await open();
  await act(async () => { target()!.click(); target()!.click(); });
  expect(login.activateTokenProfile).toHaveBeenCalledTimes(1);
  expect(target()!.disabled).toBe(true);
  await act(async () => { login.activeProfileId = 'two'; finish('valid'); });
  expect(usage.refresh).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain('사용 중');
});

test('전환 실패는 팝업에서 안내하고 재시도할 수 있다', async () => {
  login.activateTokenProfile.mockRejectedValueOnce(new Error('토큰이 유효하지 않습니다'));
  await open();
  await act(async () => target()!.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('토큰이 유효하지 않습니다');
  expect(target()!.disabled).toBe(false);
  expect(login.activeProfileId).toBe('one');
});

test('상세 창에 「할당량 경고 하지 않음」 토글이 있고 누르면 즉시 저장을 요청한다', async () => {
  usage.quiet = false;
  await open();
  const toggle = document.querySelector<HTMLInputElement>('#opusUsageQuietOverlay');
  expect(toggle).not.toBeNull();
  expect(toggle!.checked).toBe(false);
  expect(document.body.textContent).toContain('할당량 경고 하지 않음');
  await act(async () => toggle!.click());
  expect(usage.setQuiet).toHaveBeenCalledWith(true);
});

test('추가 충전분이 있으면 배지는 합산 수치를 보인다', async () => {
  const saved = usage.status;
  (usage as any).status = { opusSubscribed: true, percent: 80, purchasedPercent: 100, isNegative: false, timeUntilNextPercent: 1 };
  try {
    await act(async () => root.render(<OpusUsageBadge />));
    const button = container.querySelector('button')!;
    expect(button.textContent).toContain('180%');
    expect(button.getAttribute('aria-label')).toContain('추가 충전 100%');
    // 눈금 0~100 고정: 보라 = min(100, 100), 무료 80, 겹침 0~80
    expect(button.querySelector<HTMLElement>('[data-opus-bar="purchased"]')!.style.width).toBe('100%');
    expect(button.querySelector<HTMLElement>('[data-opus-bar="free"]')!.style.width).toBe('80%');
    expect(button.querySelector<HTMLElement>('[data-opus-bar="overlap"]')!.style.width).toBe('80%');
  } finally {
    (usage as any).status = saved;
  }
});

test('모바일 일렬 표기(inline)는 Anlas·할당량 두 칸과 하단 선 막대를 그리고, 기존 세로 표기는 그대로다', async () => {
  await act(async () => root.render(<OpusUsageBadge credits={10000} inline />));
  let button = container.querySelector('button')!;
  expect(button.className).toContain('inline-flex');
  expect(button.className).toContain('rounded-lg');
  expect(button.className).not.toContain('round-tag');
  expect(button.textContent).toContain('10000');
  expect(button.querySelector('[role="progressbar"]')!.className).toContain('absolute');

  await act(async () => root.render(<OpusUsageBadge credits={10000} />));
  button = container.querySelector('button')!;
  expect(button.className).toContain('round-tag');
  expect(button.querySelector('[role="progressbar"]')!.className).toContain('h-1.5');
});
