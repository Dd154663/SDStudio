// 이미지 그리드 「번호로 골라서 다운로드」(2026-11-23 — 옛 DownloadDialog 의 번호 고르기 되살림):
// 순수 규칙(models/gridDownloadPick)·창(componenets/GridDownloadPicker)·선택 창 연결(ResultViewer 소스 확인).
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import fs from 'fs';
import path from 'path';

const mockEnv = { mobile: false };

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
// 다운로드 서비스(창의 저장 폴더·미리보기가 쓰는 부분만) — 미리보기는 실제 규칙 함수(buildDownloadNamePreview)로
const mockDl: any = {
  settings: { autoNumbering: true, overwriteExisting: false, includeTimestamp: false, lastSavePath: 'D:/Default' },
  get supportsSaveFolder() {
    return !mockEnv.mobile;
  },
  pickFolderOnce: jest.fn(async (): Promise<string | undefined> => undefined),
  previewDownloadNames: (scene: any, paths: readonly string[], cp?: any) =>
    jest.requireActual('../ImageDownloadService').buildDownloadNamePreview({
      scene,
      imagePaths: paths,
      settings: mockDl.settings,
      characterPreset: cp,
      mobile: mockEnv.mobile,
    }),
};
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
  get imageDownloadService() {
    return mockDl;
  },
}));
jest.mock('../ImageService', () => ({}));
jest.mock('../platform', () => ({ platform: { isMobile: false } }));
const mockAppState: any = {
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
  confirmAsync: jest.fn(async () => true),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));

import {
  GRID_PICK_TEXT,
  initialGridPick,
  pickAllGrid,
  pickedInGridOrder,
  pickNoneGrid,
  toggleGridPick,
} from '../gridDownloadPick';
import GridDownloadPicker from '../../componenets/GridDownloadPicker';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const P = ['/o/c.png', '/o/a.png', '/o/b.png', '/o/d.png'];

describe('고르기 규칙(gridDownloadPick)', () => {
  test('처음 상태: 고른 것이 없으면 전부, 있으면 그것만(목록 밖 경로는 버림)', () => {
    expect([...initialGridPick(P, [])]).toEqual(P);
    expect([...initialGridPick(P, ['/o/b.png', '/o/c.png'])].sort()).toEqual(['/o/b.png', '/o/c.png']);
    // 고른 것이 전부 목록 밖이면 전부 켜짐
    expect([...initialGridPick(P, ['/o/gone.png'])]).toEqual(P);
  });

  test('켜고 끄기·전체 선택·전체 해제는 새 집합을 돌려준다', () => {
    const s = new Set(P);
    const off = toggleGridPick(s, '/o/a.png');
    expect(off.has('/o/a.png')).toBe(false);
    expect(s.has('/o/a.png')).toBe(true);
    expect(toggleGridPick(off, '/o/a.png').has('/o/a.png')).toBe(true);
    expect([...pickAllGrid(P)]).toEqual(P);
    expect(pickNoneGrid().size).toBe(0);
  });

  test('고른 경로는 그리드 순서대로', () => {
    expect(pickedInGridOrder(P, new Set(['/o/d.png', '/o/c.png', '/o/x.png']))).toEqual(['/o/c.png', '/o/d.png']);
  });

  test('문구', () => {
    expect(GRID_PICK_TEXT.title('씬 A')).toBe('"씬 A" 이미지 골라서 다운로드');
    expect(GRID_PICK_TEXT.count(3, 19)).toBe('3장 선택 / 전체 19장');
    expect(GRID_PICK_TEXT.download(3)).toBe('3장 다운로드');
    expect(GRID_PICK_TEXT.exportPicked).toBe('프리셋으로 내보내기…');
    expect(GRID_PICK_TEXT.numberLabel(2, true)).toBe('2번 이미지 (즐겨찾기)');
  });
});

describe('번호 고르기 창(GridDownloadPicker)', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mockEnv.mobile = false;
    mockDl.settings = { autoNumbering: true, overwriteExisting: false, includeTimestamp: false, lastSavePath: 'D:/Default' };
    mockDl.pickFolderOnce.mockReset();
    mockDl.pickFolderOnce.mockResolvedValue(undefined);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (over: Partial<React.ComponentProps<typeof GridDownloadPicker>> = {}) => {
    const props = {
      sceneName: '씬 A',
      paths: P,
      preselected: [] as string[],
      isFavorite: (p: string) => p === '/o/a.png',
      canExport: true,
      scene: { type: 'scene', name: '씬 A' } as any,
      characterPreset: undefined as any,
      onDownload: jest.fn(),
      onExport: jest.fn(),
      onClose: jest.fn(),
      ...over,
    };
    act(() => root.render(<GridDownloadPicker {...props} />));
    return props;
  };
  const numbers = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-grid-pick-list] button'));
  const btn = (text: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text)!;
  const click = (el: Element) => act(() => (el as HTMLElement).click());
  const count = () => host.querySelector('[data-grid-pick-count]')!.textContent;

  test('창 모양: 제목·m 등급·1…M 번호·처음 전부 켜짐·즐겨찾기 표시', () => {
    render();
    expect(host.textContent).toContain('"씬 A" 이미지 골라서 다운로드');
    expect(host.querySelector('[data-modal-size="m"]')).not.toBeNull();
    expect(numbers().map((b) => b.textContent)).toEqual(['1', '2', '3', '4']);
    expect(numbers().every((b) => b.getAttribute('aria-pressed') === 'true' && b.className.includes('back-sky'))).toBe(true);
    // 켜짐 링(.toggle-on)은 두지 않는다 — 수백 개가 한꺼번에 켜지는 목록(2026-11-23 사용자: 어수선함)
    expect(numbers().some((b) => b.className.includes('toggle-on'))).toBe(false);
    expect(count()).toBe('4장 선택 / 전체 4장');
    // 2번 = a.png(즐겨찾기)만 별
    expect(numbers()[1].getAttribute('aria-label')).toBe('2번 이미지 (즐겨찾기)');
    expect(numbers()[1].querySelector('[data-grid-pick-fav]')).not.toBeNull();
    expect(numbers()[0].querySelector('[data-grid-pick-fav]')).toBeNull();
    // 「전체 선택」「전체 해제」 둘 다 항상
    expect(btn('전체 선택')).toBeTruthy();
    expect(btn('전체 해제')).toBeTruthy();
    // 직접 색 클래스 없음(켜짐 = back-sky, 꺼짐 = back-gray)
    expect(host.innerHTML).not.toMatch(/bg-sky-\d/);
  });

  test('선택 모드에서 고른 것이 있으면 그것만 켜고 시작', () => {
    render({ preselected: ['/o/b.png'] });
    expect(numbers().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false']);
    expect(numbers()[0].className).toContain('back-gray');
    expect(count()).toBe('1장 선택 / 전체 4장');
  });

  test('번호 켜고 끄기 → 다운로드는 고른 경로를 그리드 순서로 넘긴다', () => {
    const props = render();
    click(numbers()[0]);
    click(numbers()[2]);
    expect(count()).toBe('2장 선택 / 전체 4장');
    click(numbers()[0]); // 다시 켬
    expect(btn('3장 다운로드')).toBeTruthy();
    click(btn('3장 다운로드'));
    expect(props.onDownload).toHaveBeenCalledWith(['/o/c.png', '/o/a.png', '/o/d.png']);
  });

  test('전체 해제 = 0장 → 다운로드·내보내기 비활성, 전체 선택으로 되돌림', () => {
    render();
    click(btn('전체 해제'));
    expect(count()).toBe('0장 선택 / 전체 4장');
    expect(btn('0장 다운로드').disabled).toBe(true);
    expect(btn('프리셋으로 내보내기…').disabled).toBe(true);
    click(btn('전체 선택'));
    expect(btn('4장 다운로드').disabled).toBe(false);
  });

  test('내보내기 버튼: canExport 일 때만, 고른 경로를 그리드 순서로', () => {
    const props = render({ preselected: ['/o/d.png', '/o/c.png'] });
    click(btn('프리셋으로 내보내기…'));
    expect(props.onExport).toHaveBeenCalledWith(['/o/c.png', '/o/d.png']);
    act(() => root.unmount());
    root = createRoot(host);
    render({ canExport: false });
    expect(host.querySelector('[data-grid-pick-export]')).toBeNull();
  });

  test('주 동작만 색(다운로드 = 초록 솔리드), 내보내기·취소는 회색', () => {
    render();
    expect(btn('4장 다운로드').className).toContain('btn-solid-green');
    expect(btn('프리셋으로 내보내기…').className).not.toMatch(/btn-solid-/);
    expect(btn('취소').className).not.toMatch(/btn-solid-/);
  });

  test('Esc·취소·✕ 로 닫힘(= 취소, 다운로드 없음)', () => {
    const props = render();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    click(btn('취소'));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    click(host.querySelector('[aria-label="닫기"]')!);
    expect(props.onClose).toHaveBeenCalledTimes(3);
    expect(props.onDownload).not.toHaveBeenCalled();
  });

  test('모바일: 같은 창, 번호 칸이 더 크다', () => {
    mockEnv.mobile = true;
    render();
    expect(numbers()[0].className).toContain('h-11');
    expect((host.querySelector('[data-grid-pick-list]') as HTMLElement).style.gridTemplateColumns).toContain('48px');
  });

  // ── 아래 구역: 다운로드 저장 폴더(설정의 복사본, 이번에만)·파일명 미리보기(2026-11-23) ──
  const folderPath = () => host.querySelector('[data-grid-pick-folder-path]')?.textContent;
  const previewNames = () =>
    Array.from(host.querySelectorAll('[data-grid-pick-preview-name]')).map((e) => e.textContent);
  const previewRest = () => host.querySelector('[data-grid-pick-preview-rest]')?.textContent;
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  test('저장 폴더: 처음 = 설정 값 복사본, 번호 격자 아래 붙박이 구역(본문 맨 아래 sticky)', () => {
    render();
    expect(folderPath()).toBe('D:/Default');
    expect(host.textContent).toContain('다운로드 저장 폴더');
    expect(host.querySelector('[data-grid-pick-folder-temp]')).toBeNull();
    const info = host.querySelector('[data-grid-pick-info]') as HTMLElement;
    expect(info.className).toContain('sticky');
    expect(info.className).toContain('bottom-0');
    // 같은 본문 안, 번호 격자 뒤(스크롤 영역은 본문 하나)
    const body = host.querySelector('[data-modal-slot="body"]')!;
    expect(body.contains(info)).toBe(true);
    expect(host.querySelector('[data-grid-pick-list]')!.nextElementSibling).toBe(info);
    // 새 직접 색 금지
    expect(info.innerHTML).not.toMatch(/bg-(gray|slate)-\d/);
  });

  test('저장 폴더 미지정이면 안내, 바꾸지 않고 다운로드하면 opts 없음(평소 경로)', () => {
    mockDl.settings = { ...mockDl.settings, lastSavePath: undefined };
    const props = render();
    expect(folderPath()).toBe('미지정 (다운로드할 때 폴더를 고릅니다)');
    click(btn('4장 다운로드'));
    expect(props.onDownload).toHaveBeenCalledWith(P);
    expect((props.onDownload as jest.Mock).mock.calls[0]).toHaveLength(1);
  });

  test('[바꾸기] → 이 창의 값만 바뀜(설정 불변)·안내·[기본값으로], 다운로드에 그 폴더가 넘어감', async () => {
    const props = render();
    mockDl.pickFolderOnce.mockResolvedValueOnce('E:/Once');
    await act(async () => btn('바꾸기').click());
    await flush();
    expect(mockDl.pickFolderOnce).toHaveBeenCalledTimes(1);
    expect(folderPath()).toBe('E:/Once');
    expect(mockDl.settings.lastSavePath).toBe('D:/Default');
    expect(host.querySelector('[data-grid-pick-folder-temp]')!.textContent).toContain('이번 다운로드에만 적용');
    click(btn('4장 다운로드'));
    expect(props.onDownload).toHaveBeenLastCalledWith(P, { savePath: 'E:/Once' });
    // 취소하면 그대로
    mockDl.pickFolderOnce.mockResolvedValueOnce(undefined);
    await act(async () => btn('바꾸기').click());
    await flush();
    expect(folderPath()).toBe('E:/Once');
    // [기본값으로] = 설정 값으로 되돌림, 안내 사라짐, 다운로드는 opts 없음
    click(btn('기본값으로'));
    expect(folderPath()).toBe('D:/Default');
    expect(host.querySelector('[data-grid-pick-folder-temp]')).toBeNull();
    click(btn('4장 다운로드'));
    expect((props.onDownload as jest.Mock).mock.calls[1]).toEqual([P]);
  });

  test('설정과 같은 폴더를 고르면 「이번에만」이 아님(opts 없음)', async () => {
    const props = render();
    mockDl.pickFolderOnce.mockResolvedValueOnce('D:/Default');
    await act(async () => btn('바꾸기').click());
    await flush();
    expect(host.querySelector('[data-grid-pick-folder-temp]')).toBeNull();
    click(btn('4장 다운로드'));
    expect((props.onDownload as jest.Mock).mock.calls[0]).toEqual([P]);
  });

  test('파일명 미리보기: 고른 것을 따라 바뀜·처음 3개 + 외 N개·1장 규칙·0장 안내', () => {
    render();
    // 4장(그리드 순서 c,a,b,d) = 여러 장 규칙: 씬 이름 폴더/이름_번호
    expect(previewNames()).toEqual(['씬 A/씬 A_001.png', '씬 A/씬 A_002.png', '씬 A/씬 A_003.png']);
    expect(previewRest()).toBe('… 외 1개');
    click(numbers()[0]);
    expect(previewNames()).toEqual(['씬 A/씬 A_001.png', '씬 A/씬 A_002.png', '씬 A/씬 A_003.png']);
    expect(previewRest()).toBeUndefined();
    click(numbers()[1]);
    click(numbers()[2]);
    // 1장 = 폴더·번호 없음
    expect(previewNames()).toEqual(['씬 A.png']);
    click(numbers()[3]);
    expect(previewNames()).toEqual([]);
    expect(host.querySelector('[data-grid-pick-preview]')!.textContent).toContain('고른 이미지가 없습니다');
  });

  test('미리보기: 캐릭터 프리셋 접두사·설정 접미사·타임스탬프 자리 표시', () => {
    mockDl.settings = { ...mockDl.settings, defaultSuffix: 'suf', includeTimestamp: true };
    render({ characterPreset: { filenamePrefix: 'cp' } as any, preselected: ['/o/b.png'] });
    expect(previewNames()).toEqual(['cp_씬 A_suf_{시각}.png']);
    expect(host.querySelector('[data-grid-pick-preview-ts]')!.textContent).toBe(
      '{시각} 자리에는 저장하는 순간의 시각 숫자가 들어갑니다',
    );
  });

  test('모바일: 저장 폴더 칸 없이 한 줄 안내, 미리보기는 원본 파일명', () => {
    mockEnv.mobile = true;
    render();
    expect(host.querySelector('[data-grid-pick-folder]')).toBeNull();
    expect(host.querySelector('[data-grid-pick-mobile-folder]')!.textContent).toBe('기기의 다운로드 폴더에 저장됩니다');
    expect(previewNames()).toEqual(['씬 A/c.png', '씬 A/a.png', '씬 A/b.png']);
  });
});

describe('선택 창 연결(ResultViewer)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../componenets/ResultViewer.tsx'), 'utf8');
  test("'pick' 은 그리드 보기 순서 목록으로 번호 고르기 창을 열고, 다운로드·내보내기는 선택 창과 같은 함수", () => {
    expect(src).toMatch(/choice === 'pick'[\s\S]{0,300}setDownloadPick\(\{ paths, preselected: selectedPaths \}\)/);
    expect(src).toContain('const paths = viewPaths();');
    // 선택 창의 대상 저장과 번호 고르기 창이 같은 downloadGridPaths → imageDownloadService.downloadImages
    expect(src).toMatch(/const downloadGridPaths = async[\s\S]{0,200}imageDownloadService\.downloadImages\(/);
    expect(src).toMatch(/await downloadGridPaths\(targets\);/);
    // 번호 고르기 창만 이번에만 쓰는 저장 폴더(opts)를 넘긴다 — 같은 downloadGridPaths → downloadImages(…, true, opts)
    expect(src).toMatch(/onDownload=\{\(targets, opts\) => \{\s*setDownloadPick\(undefined\);\s*void downloadGridPaths\(targets, opts\);/);
    expect(src).toMatch(/appState\.getAppliedCharacterPreset\(\),\s*true,\s*opts,\s*\);/);
    // 미리보기는 저장과 같은 캐릭터 프리셋
    expect(src).toMatch(/<GridDownloadPicker[\s\S]{0,400}characterPreset=\{appState\.getAppliedCharacterPreset\(\)\}/);
    expect(src).toMatch(/onExport=\{\(targets\) => \{\s*setDownloadPick\(undefined\);\s*exportGridPaths\(targets\);/);
    expect(src).toMatch(/choice === 'export-selected'\) \{\s*exportGridPaths\(selectedPaths\);/);
  });
  test('창이 열려 있는 동안 그리드 단축키를 끈다', () => {
    expect(src).toContain('const active = !isMobile && selectedImageIndex == null && !pickerOpen;');
    expect(src).toContain('if (pickerOpen) return; // 번호 고르기 창 열림');
    expect(src).toContain('if (tournament || selectedImageIndex != null || pickerOpen) return;');
  });
});
