// 오버레이 A2(2026-11-12) 아티스트 태깅 창 재배치안 (가) — 렌더 검사.
// PC: 왼쪽 결과 열이 창 높이를 채움(작가 1 : 일반 2, textarea 는 rows 없이 flex), 신뢰도는 「신뢰도 보기」 접기,
//     「모두 복사」는 카드 머리, 캐릭터 태그는 있을 때만 한 줄, 오른쪽 = 이미지 → WD 모델 → [분석] → 요약·[전체 복사].
// 모바일: 종전 한 열 그대로(rows 고정·칩 상시·모델 토글은 WD 카드 머리).
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

const mockEnv = { mobile: false };
const mockResults: { artists: any[]; wd: any } = { artists: [], wd: null };

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
const mockService: any = {
  installed: { kaloscope: true, 'wd-swinv2': true, 'wd-eva02': true },
  wdModel: 'wd-swinv2',
  downloading: null,
  downloadPercent: 0,
  statsModels: jest.fn(),
  setWdModel: jest.fn(async (m: string) => {
    mockService.wdModel = m;
  }),
  analyzeArtists: jest.fn(async () => mockResults.artists),
  analyzeWd: jest.fn(async () => mockResults.wd),
  download: jest.fn(async () => undefined),
};
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
  artistTagService: mockService,
}));
jest.mock('../ArtistTagService', () => ({
  ARTIST_MODELS: {
    kaloscope: { sizeText: '1MB' },
    'wd-swinv2': { sizeText: '1MB' },
    'wd-eva02': { sizeText: '1MB' },
  },
}));
const mockAppState: any = {
  pushMessage: jest.fn(),
  pushDialog: jest.fn(),
  confirmAsync: jest.fn(),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));

import ArtistTagModal from '../../componenets/ArtistTagModal';

let root: Root;
let container: HTMLDivElement;
const writeText = jest.fn(async () => undefined);
beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.mobile = false;
  mockService.wdModel = 'wd-swinv2';
  mockResults.artists = [
    { tag: 'artist_a', score: 0.9 },
    { tag: 'artist_b', score: 0.05 },
  ];
  mockResults.wd = {
    rating: [],
    character: [{ tag: 'hatsune_miku', score: 0.95 }],
    general: [
      { tag: '1girl', score: 0.99 },
      { tag: 'long_hair', score: 0.8 },
      { tag: 'smile', score: 0.4 },
    ],
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const buttonByText = (text: string, scope: Element | null = container) =>
  Array.from(scope?.querySelectorAll('button') ?? []).find(
    (b) => (b.textContent ?? '').trim() === text,
  ) as HTMLButtonElement | undefined;

const renderModal = async () => {
  await act(async () => root.render(<ArtistTagModal isOpen onClose={jest.fn()} />));
};

// 클립보드 붙여넣기로 이미지를 넣는다(FileReader 비동기 완료까지 기다림)
const pasteImage = async () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
  const ev: any = new Event('paste');
  ev.clipboardData = { items: [{ type: 'image/png', getAsFile: () => file }] };
  await act(async () => {
    window.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 30));
  });
};

const analyzeNow = async () => {
  await pasteImage();
  const btn = buttonByText('분석');
  expect(btn?.disabled).toBe(false);
  await act(async () => {
    btn!.click();
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe('PC — 왼쪽 결과 열이 창 높이를 채움', () => {
  test('열 h-full min-h-0, 작가 카드 flex-1 · 일반 카드 flex-[2]', async () => {
    await renderModal();
    const col = q('[data-artist-tag-results]');
    expect(col?.className).toContain('h-full');
    expect(col?.className).toContain('min-h-0');
    expect(col?.className).toContain('flex-col');
    const artist = q('[data-artist-tag-card="artist"]');
    const general = q('[data-artist-tag-card="general"]');
    expect(artist?.className.split(' ')).toContain('flex-1');
    expect(general?.className.split(' ')).toContain('flex-[2]');
    expect(artist?.className).toContain('min-h-0');
    // 2열 줄도 PC 는 h-full(묶음 A 그대로)
    expect(q('[data-artist-tag-columns]')?.className).toContain('h-full min-h-0');
  });

  test('분석 뒤 textarea 는 rows 없이 flex-1 min-h-0 resize-none, 제목에 개수', async () => {
    await renderModal();
    await analyzeNow();
    const areas = Array.from(container.querySelectorAll('textarea'));
    expect(areas).toHaveLength(2);
    for (const ta of areas) {
      expect(ta.hasAttribute('rows')).toBe(false);
      expect(ta.className).toContain('flex-1');
      expect(ta.className).toContain('min-h-0');
      expect(ta.className).toContain('resize-none');
    }
    expect(areas[0].value).toBe('artist:artist a, artist:artist b');
    expect(areas[1].value).toBe('1girl, long hair, smile');
    expect(q('[data-artist-tag-card="artist"]')?.textContent).toContain('작가 태그 (Kaloscope) · 2');
    expect(q('[data-artist-tag-card="general"]')?.textContent).toContain('WD 일반 태그 · 3');
  });

  test('「모두 복사」는 카드 머리(제목 옆)에 있고 종전 형식으로 복사', async () => {
    await renderModal();
    await analyzeNow();
    const head = q('[data-artist-tag-card="artist"]')?.firstElementChild ?? null;
    const copy = buttonByText('모두 복사', head);
    expect(copy).toBeTruthy();
    await act(async () => copy!.click());
    expect(writeText).toHaveBeenCalledWith('artist:artist a, artist:artist b');
    expect(mockAppState.pushMessage).toHaveBeenCalledWith('2개 태그 복사됨');
  });
});

describe('PC — 신뢰도 보기 접기', () => {
  test('details 기본 접힘, 펼치면 종전 칩 문자열', async () => {
    await renderModal();
    await analyzeNow();
    const details = Array.from(
      container.querySelectorAll<HTMLDetailsElement>('[data-artist-tag-scores]'),
    );
    expect(details).toHaveLength(2);
    for (const d of details) {
      expect(d.tagName).toBe('DETAILS');
      expect(d.open).toBe(false);
      expect(d.querySelector('summary')?.textContent).toBe('신뢰도 보기');
    }
    details[0].open = true;
    expect(details[0].open).toBe(true);
    expect(details[0].textContent).toContain('artist a 90% · artist b 5.0%');
  });
});

describe('PC — 캐릭터 태그 한 줄', () => {
  test('결과가 있으면 일반 카드 안에 한 줄 섹션', async () => {
    await renderModal();
    await analyzeNow();
    const row = q('[data-artist-tag-character]');
    expect(row).toBeTruthy();
    expect(q('[data-artist-tag-card="general"]')?.contains(row)).toBe(true);
    expect(row?.textContent).toContain('캐릭터 · 1');
    expect(row?.querySelector('input')?.value).toBe('hatsune miku');
  });

  test('캐릭터 태그가 없으면 섹션을 그리지 않고 「(없음)」도 없다', async () => {
    mockResults.wd.character = [];
    await renderModal();
    await analyzeNow();
    expect(q('[data-artist-tag-character]')).toBeNull();
    expect(q('[data-artist-tag-card="general"]')?.textContent).not.toContain('(없음)');
  });
});

describe('PC — 오른쪽 열 = 입력 → 설정 → 실행 → 요약', () => {
  test('모델 토글은 오른쪽 열에 있고 결과 카드 머리에는 없다', async () => {
    await renderModal();
    const side = q('[data-artist-tag-side]');
    const toggles = container.querySelectorAll('[data-wd-model-toggle]');
    expect(toggles).toHaveLength(1);
    expect(side?.contains(toggles[0])).toBe(true);
    expect(q('[data-artist-tag-results]')?.textContent).not.toContain('SwinV2');
    expect(q('[data-artist-tag-model]')?.textContent).toContain('WD 모델');
    // 순서: 이미지 → 모델 → [분석]
    const kids = Array.from(side!.children);
    const iDrop = kids.findIndex((k) => k.hasAttribute('data-artist-tag-drop'));
    const iModel = kids.findIndex((k) => k.hasAttribute('data-artist-tag-model'));
    const iRun = kids.findIndex((k) => k.textContent?.trim() === '분석');
    expect(iDrop).toBe(0);
    expect(iModel).toBe(1);
    expect(iRun).toBe(2);
  });

  test('모델 전환은 종전 동작(setWdModel + WD 결과 비움)', async () => {
    await renderModal();
    await analyzeNow();
    await act(async () => buttonByText('EVA02 (정밀)')!.click());
    expect(mockService.setWdModel).toHaveBeenCalledWith('wd-eva02');
    expect(q('[data-artist-tag-card="general"]')?.querySelector('textarea')).toBeNull();
  });

  test('결과 없으면 요약 숨김, 분석 뒤 개수와 [전체 복사]', async () => {
    await renderModal();
    expect(q('[data-artist-tag-summary]')).toBeNull();
    await analyzeNow();
    const sum = q('[data-artist-tag-summary]');
    expect(sum?.textContent).toContain('작가 2 · 캐릭터 1 · 일반 3');
    await act(async () => buttonByText('전체 복사', sum)!.click());
    expect(writeText).toHaveBeenCalledWith(
      'artist:artist a, artist:artist b, hatsune miku, 1girl, long hair, smile',
    );
    expect(mockAppState.pushMessage).toHaveBeenCalledWith('6개 태그 복사됨');
  });

  test('전체 복사는 빈 결과를 건너뛴다(캐릭터 없음)', async () => {
    mockResults.wd.character = [];
    await renderModal();
    await analyzeNow();
    await act(async () => buttonByText('전체 복사', q('[data-artist-tag-summary]'))!.click());
    expect(writeText).toHaveBeenCalledWith('artist:artist a, artist:artist b, 1girl, long hair, smile');
  });
});

describe('모바일 — 종전 구조 그대로', () => {
  test('한 열(h-full 없음), rows 유지, 칩 상시, 모델 토글은 WD 카드 머리, 요약 없음', async () => {
    mockEnv.mobile = true;
    await renderModal();
    expect(q('[data-artist-tag-columns]')?.className).toBe('flex flex-col-reverse md:flex-row gap-4');
    expect(q('[data-artist-tag-results]')).toBeNull();
    expect(q('[data-artist-tag-side]')).toBeNull();
    await analyzeNow();
    const rows = Array.from(container.querySelectorAll('textarea')).map((t) => t.getAttribute('rows'));
    expect(rows).toEqual(['3', '2', '5']);
    expect(container.querySelectorAll('details')).toHaveLength(0);
    expect(container.textContent).toContain('artist a 90% · artist b 5.0%');
    expect(container.textContent).toContain('WD 태그 분석');
    expect(container.querySelectorAll('[data-wd-model-toggle]')).toHaveLength(1);
    expect(q('[data-artist-tag-summary]')).toBeNull();
    // 모바일 토글 버튼은 늘이지 않음(종전 모양)
    expect(buttonByText('SwinV2 (권장)')?.className.split(' ')).not.toContain('flex-1');
  });

  test('모바일에서 캐릭터 태그가 없으면 종전처럼 「(없음)」', async () => {
    mockEnv.mobile = true;
    mockResults.wd.character = [];
    await renderModal();
    await analyzeNow();
    expect(container.textContent).toContain('(없음)');
  });
});
