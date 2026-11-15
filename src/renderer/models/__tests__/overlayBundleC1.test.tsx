// 오버레이 묶음 C-1(2026-11-15, SPEC 「오버레이 창 크기 체계」 높이 규칙 우선순위) —
// 작가 상세 m → l 두 열(PC: 왼쪽 이미지 채움·스크롤 없음, 오른쪽 = 유일한 세로 스크롤 + 「이 이미지의 프롬프트」 토글),
// 모바일 한 열, PromptView 읽기 전용 상자의 높이 상한·안쪽 스크롤 제거, 환경설정 단축키 50vh·드라이브 40vh·시스템 잔재 max-h-32 제거.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';

const mockEnv = { mobile: false };
const mockArtist: any = {
  id: 'a1',
  name: 'foo',
  favorite: false,
  tags: ['러프'],
  images: [
    { id: 'i1', path: 'artists/a1/1.png', family: 'v5' },
    { id: 'i2', path: 'artists/a1/2.png' },
  ],
};

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
  artistLibraryService: {
    getArtist: (id: string) => (id === 'a1' ? mockArtist : undefined),
    tagPresets: ['러프', '채색'],
    findArtistByName: jest.fn(() => undefined),
    addImage: jest.fn(),
    removeImage: jest.fn(),
    deleteArtist: jest.fn(),
  },
  imageService: { fetchImage: jest.fn(async () => 'data:image/png;base64,AAAA') },
  backend: { readDataFile: jest.fn(async () => 'data:image/png;base64,AAAA') },
}));
const mockAppState: any = {
  curSession: null,
  pushMessage: jest.fn(),
  pushDialog: jest.fn(),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../sceneQueueActions', () => ({ queueArtistSample: jest.fn() }));
jest.mock('../globalLibraryUndo', () => ({
  addArtistTagPresetRecorded: jest.fn(),
  addArtistTagRecorded: jest.fn(),
  removeArtistTagPresetRecorded: jest.fn(),
  removeArtistTagRecorded: jest.fn(),
  renameArtistRecorded: jest.fn(),
  setArtistImageFamilyRecorded: jest.fn(),
  setArtistThumbnailRecorded: jest.fn(),
  toggleArtistFavoriteRecorded: jest.fn(),
}));
jest.mock('../nameInput', () => ({ promptName: jest.fn() }));
jest.mock('../deleteFlowRules', () => ({
  batchResultLine: jest.fn(() => ''),
  deleteConfirmText: jest.fn(() => ({ text: '' })),
  failedNamesLine: jest.fn(() => ''),
}));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s.split(',')[1] ?? '' }));
jest.mock('../util', () => ({
  extractPromptDataFromBase64: jest.fn(async () => ({ prompt: '1girl, solo', uc: 'lowres' })),
}));
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));
jest.mock('../../componenets/Tooltip', () => ({ children }: any) => children);

import { ArtistDetailModal } from '../../componenets/ArtistLibraryTab';

let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.mobile = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const readComponent = (name: string) =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'componenets', name), 'utf8');
const renderDetail = async () => {
  await act(async () => root.render(<ArtistDetailModal artistId="a1" onClose={() => {}} />));
};
const toggleButton = () => q('[data-artist-prompt-toggle]') as HTMLButtonElement;

describe('작가 상세 — PC l 두 열', () => {
  test('size l, 본문 = h-full min-h-0 두 열(본문 자신은 스크롤하지 않음)', async () => {
    await renderDetail();
    expect(q('[data-modal-size]')?.getAttribute('data-modal-size')).toBe('l');
    const body = q('[data-artist-detail-body]')!;
    expect(body.className).toContain('h-full');
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('flex');
    const left = q('[data-artist-detail-left]')!;
    const right = q('[data-artist-detail-right]')!;
    expect(left.parentElement).toBe(body);
    expect(right.parentElement).toBe(body);
    // 오른쪽 = 이 창의 유일한 세로 스크롤, 왼쪽 = 스크롤 없음
    expect(right.className).toContain('overflow-y-auto');
    expect(right.className).toContain('min-h-0');
    expect(left.className).not.toMatch(/overflow-(y-)?auto/);
    // 동작 줄은 도구줄 그대로
    expect(q('[data-modal-slot="toolbar"] [data-artist-detail-actions]')).not.toBeNull();
  });

  test('왼쪽: 큰 이미지가 남은 높이를 채우고(contain), 썸네일은 가로 띠 한 줄', async () => {
    await renderDetail();
    const imgBox = q('[data-artist-detail-image]')!;
    expect(imgBox.className).toContain('flex-1 min-h-0');
    expect(imgBox.className).not.toContain('aspect-[3/4]');
    expect(imgBox.querySelector('img')?.className).toContain('object-contain');
    const thumbs = q('[data-artist-detail-thumbs]')!;
    expect(thumbs.className).toContain('flex-nowrap');
    expect(thumbs.className).toContain('overflow-x-auto');
    // 썸네일 이미지는 종전 cover
    expect(thumbs.querySelector('img')?.className).toContain('object-cover');
    // [대표로 지정][이미지 삭제] 는 왼쪽 열, 프롬프트 토글은 그 줄에 없다
    const actions = q('[data-artist-detail-image-actions]')!;
    expect(q('[data-artist-detail-left]')!.contains(actions)).toBe(true);
    expect(actions.textContent).toContain('이미지 삭제');
    expect(actions.textContent).not.toContain('프롬프트');
  });

  test('「이 이미지의 프롬프트」 토글은 오른쪽 열에 있고, 열면 프롬프트·네거티브가 오른쪽 열 안에 나온다', async () => {
    await renderDetail();
    const right = q('[data-artist-detail-right]')!;
    const btn = toggleButton();
    expect(right.contains(btn)).toBe(true);
    expect(right.textContent).toContain('이 이미지의 프롬프트');
    expect(btn.textContent).toContain('프롬프트 보기');
    await act(async () => btn.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(toggleButton().textContent).toContain('프롬프트 닫기');
    const promptBox = q('[data-artist-prompt-text]')!;
    const ucBox = q('[data-artist-uc-text]')!;
    expect(promptBox.textContent).toBe('1girl, solo');
    expect(ucBox.textContent).toBe('lowres');
    expect(right.contains(promptBox)).toBe(true);
    for (const box of [promptBox, ucBox]) {
      expect(box.className).not.toMatch(/max-h-/);
      expect(box.className).not.toMatch(/overflow-/);
    }
  });
});

describe('작가 상세 — 모바일 한 열', () => {
  test('한 열(flex-col·h-full 없음), 이미지는 종전 aspect-[3/4]·cover, 오른쪽 열 자체 스크롤 없음', async () => {
    mockEnv.mobile = true;
    await renderDetail();
    expect(q('[data-modal-size]')?.getAttribute('data-modal-size')).toBe('l');
    const body = q('[data-artist-detail-body]')!;
    expect(body.className).toContain('flex-col');
    expect(body.className).not.toContain('h-full');
    const imgBox = q('[data-artist-detail-image]')!;
    expect(imgBox.className).toContain('aspect-[3/4]');
    expect(imgBox.querySelector('img')?.className).toContain('object-cover');
    expect(q('[data-artist-detail-right]')!.className).not.toMatch(/overflow-/);
    expect(q('[data-artist-detail-thumbs]')!.className).toContain('flex-wrap');
  });
});

// 태그 프리셋 관리 — 공백 입력이면 [추가] 비활성·Enter 무시, 이미 있는 태그면 안내 후 입력 유지(2026-11-15)
describe('태그 프리셋 관리 — 추가 버튼 안내', () => {
  const setInput = async (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const openManage = async () => {
    await renderDetail();
    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === '관리',
    )!;
    await act(async () => btn.click());
    const add = q('[data-tag-preset-add]') as HTMLButtonElement;
    const input = add.parentElement!.querySelector('input') as HTMLInputElement;
    return { add, input };
  };
  const undo = () => jest.requireMock('../globalLibraryUndo');

  test('빈칸·공백뿐이면 [추가] 비활성, Enter 로도 추가하지 않는다', async () => {
    const { add, input } = await openManage();
    expect(add.disabled).toBe(true);
    expect(add.className).toContain('disabled:opacity-50');
    await setInput(input, '   ');
    expect((q('[data-tag-preset-add]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(undo().addArtistTagPresetRecorded).not.toHaveBeenCalled();
  });

  test('이미 있는 태그면 안내 토스트 1줄·입력 유지, 새 태그면 추가 후 입력 비움', async () => {
    const { input } = await openManage();
    await setInput(input, '러프');
    await act(async () => (q('[data-tag-preset-add]') as HTMLButtonElement).click());
    expect(undo().addArtistTagPresetRecorded).toHaveBeenCalledWith('러프');
    expect(mockAppState.pushMessage).toHaveBeenCalledWith('이미 있는 태그 프리셋입니다.');
    expect(input.value).toBe('러프');

    const svc = jest.requireMock('../index').artistLibraryService;
    const before = svc.tagPresets;
    undo().addArtistTagPresetRecorded.mockImplementationOnce((t: string) => {
      svc.tagPresets = [...svc.tagPresets, t];
    });
    mockAppState.pushMessage.mockClear();
    try {
      await setInput(input, '선화');
      await act(async () => (q('[data-tag-preset-add]') as HTMLButtonElement).click());
      expect(mockAppState.pushMessage).not.toHaveBeenCalled();
      expect(input.value).toBe('');
    } finally {
      svc.tagPresets = before;
    }
  });
});

describe('소스 검사 — 안쪽 스크롤·vh 높이 제거', () => {
  test('PromptView 에 max-h-·overflow-auto 가 없다', () => {
    const src = readComponent('ArtistLibraryTab.tsx');
    const start = src.indexOf('const PromptView');
    const end = src.indexOf('// ─── 카드 상세 모달', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const view = src.slice(start, end);
    expect(view).not.toContain('max-h-');
    expect(view).not.toContain('overflow-auto');
  });
  test('환경설정 단축키 탭에 50vh·안쪽 overflow-y-auto 가 없다', () => {
    const src = readComponent('ConfigKeyBindingsTab.tsx');
    expect(src).not.toContain('50vh');
    expect(src).not.toContain('overflow-y-auto');
  });
  test('드라이브 탭 백업 목록에 max-h-[40vh] 가 없다', () => {
    const src = readComponent('DriveSettingsTab.tsx');
    expect(src).not.toContain('max-h-[40vh]');
    expect(src).not.toContain('listClassName=');
  });
  test('시스템 탭 잔재 목록에 max-h-32 가 없다', () => {
    expect(readComponent('ConfigSystemTab.tsx')).not.toContain('max-h-32');
  });
});
