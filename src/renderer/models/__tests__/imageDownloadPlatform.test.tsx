// 이미지 다운로드 플랫폼 분기(2026-11-19 다운로드 창 개편): 모바일 = 폴더를 묻지 않고 다운로드 폴더 복사,
// PC = 저장 폴더·파일명 규칙(종전). 폴더 선택 취소 안내, 환경설정 「이미지 다운로드」 구획(PC 만).
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

let mockMobile = false;
let store: Record<string, any> = {};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const backend = {
  selectDir: jest.fn(async (): Promise<string | undefined> => undefined),
  copyToDownloads: jest.fn(async (_p: string, _sub?: string) => {}),
  existInDownloads: jest.fn(async (_n: string) => false),
  writeDataFileAbsolute: jest.fn(async (_p: string, _d: string) => {}),
  existFileAbsolute: jest.fn(async (_p: string) => false),
  existFile: jest.fn(async (_p: string) => false),
  getConfig: jest.fn(async () => clone(store)),
  setConfig: jest.fn(async (c: Record<string, any>) => {
    store = clone(c);
  }),
};
const imageService = { fetchImage: jest.fn(async (_p: string) => 'data:image/png;base64,iVBORw0KGgo') };
let svc: any;
jest.mock('..', () => ({
  backend,
  imageService,
  get imageDownloadService() {
    return svc;
  },
}));
const appState = { pushMessage: jest.fn(), setProgressDialog: jest.fn() };
jest.mock('../AppService', () => ({ appState }));
jest.mock('../ImageService', () => ({
  cropMirrorResultFromDataUri: jest.fn(async () => 'iVBORcropped'),
  dataUriToBase64: (d: string) => d.split(',')[1],
}));
jest.mock('../platform', () => ({
  platform: {
    get isMobile() {
      return mockMobile;
    },
  },
}));

import {
  ImageDownloadService,
  IMAGE_DOWNLOAD_TEXT,
  sanitizeDownloadFolderName,
  pickUniqueDownloadFolderName,
  DOWNLOAD_FOLDER_DEFAULT_NAME,
  DOWNLOAD_FOLDER_MAX_LENGTH,
} from '../ImageDownloadService';
import { cropMirrorResultFromDataUri } from '../ImageService';
import { DownloadSettingsSection } from '../../componenets/DownloadSettingsSection';

const session: any = { name: 'proj' };
const scene: any = { type: 'scene', name: 'scene' };
const mirror: any = { type: 'inpaint', name: 'mir', workflowType: 'SDMirror', mirrorCropX: 100 };

beforeEach(() => {
  jest.clearAllMocks();
  mockMobile = false;
  store = { unrelatedKey: 'keep-me' };
  svc = new ImageDownloadService();
});

describe('모바일', () => {
  beforeEach(() => {
    mockMobile = true;
  });
  test('한 장: 폴더를 묻지 않고 copyToDownloads 한 번, 종전 문구', async () => {
    expect(await svc.downloadSingleImage(session, scene, 'outs/a.png')).toBe(true);
    expect(backend.selectDir).not.toHaveBeenCalled();
    expect(backend.writeDataFileAbsolute).not.toHaveBeenCalled();
    expect(backend.copyToDownloads).toHaveBeenCalledWith('outs/a.png');
    // 한 장은 하위 폴더 인자 없이(종전 호출 그대로)
    expect(backend.copyToDownloads.mock.calls[0]).toHaveLength(1);
    expect(backend.existInDownloads).not.toHaveBeenCalled();
    expect(appState.pushMessage).toHaveBeenCalledWith('다운로드 폴더에 저장했습니다');
  });
  test('여러 장: 씬 이름 폴더로 장마다 순서대로 복사, 실패는 세고 계속, 진행 창 열고 닫음', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    backend.copyToDownloads.mockImplementation(async (p: string) => {
      if (p === 'b') throw new Error('x');
    });
    const r = await svc.downloadImages(session, scene, ['a', 'b', 'c'], undefined, true);
    expect(r).toEqual({ success: 2, failed: 1 });
    expect(backend.copyToDownloads.mock.calls).toEqual([
      ['a', 'scene'],
      ['b', 'scene'],
      ['c', 'scene'],
    ]);
    expect(backend.existInDownloads).toHaveBeenCalledWith('scene');
    expect(backend.selectDir).not.toHaveBeenCalled();
    expect(appState.pushMessage).toHaveBeenCalledWith('다운로드 폴더의 "scene"에 2장을 저장했습니다');
    expect(appState.pushMessage).toHaveBeenCalledWith(IMAGE_DOWNLOAD_TEXT.mobileFailed(1));
    const progress = appState.setProgressDialog.mock.calls.map((c) => c[0]?.done);
    expect(progress).toEqual([0, 1, 2, 3, undefined]);
    backend.copyToDownloads.mockImplementation(async () => {});
    errSpy.mockRestore();
  });
  test('여러 장: 같은 이름 폴더가 있으면 「씬이름 (2)」 폴더', async () => {
    backend.existInDownloads.mockImplementation(async (n: string) => n === 'scene');
    await svc.downloadImages(session, scene, ['a', 'b']);
    expect(backend.copyToDownloads.mock.calls.map((c) => c[1])).toEqual(['scene (2)', 'scene (2)']);
    expect(appState.pushMessage).toHaveBeenCalledWith(IMAGE_DOWNLOAD_TEXT.mobileSavedManyInFolder('scene (2)', 2));
    backend.existInDownloads.mockImplementation(async () => false);
  });
  test('우클릭 다운로드(진행 창 없음)도 같은 경로·같은 문구', async () => {
    await svc.downloadImages(session, scene, ['a', 'b']);
    expect(backend.copyToDownloads).toHaveBeenCalledTimes(2);
    expect(backend.copyToDownloads.mock.calls.map((c) => c[1])).toEqual(['scene', 'scene']);
    expect(appState.setProgressDialog).not.toHaveBeenCalled();
    expect(appState.pushMessage).toHaveBeenCalledWith('다운로드 폴더의 "scene"에 2장을 저장했습니다');
  });
  test('히스토리: 원본 씬을 찾지 않고 바로 복사(폴더 없이)', async () => {
    const resolve = jest.fn(async () => null);
    expect(await svc.downloadHistoryImage('outs/h.png', resolve)).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(backend.copyToDownloads).toHaveBeenCalledWith('outs/h.png');
    expect(backend.copyToDownloads.mock.calls[0]).toHaveLength(1);
  });
  test('저장 폴더 바꾸기는 아무것도 하지 않는다', async () => {
    expect(await svc.changeSavePath()).toBeUndefined();
    expect(backend.selectDir).not.toHaveBeenCalled();
  });
});

describe('PC', () => {
  test('저장 폴더가 없고 폴더 선택을 취소하면 안내만 하고 저장하지 않는다', async () => {
    expect(await svc.downloadSingleImage(session, scene, 'outs/a.png')).toBe(false);
    expect(appState.pushMessage).toHaveBeenCalledWith('저장 폴더를 고르지 않아 다운로드하지 않았습니다');
    const r = await svc.downloadImages(session, scene, ['a', 'b'], undefined, true);
    expect(r).toEqual({ success: 0, failed: 0 });
    expect(appState.pushMessage).toHaveBeenCalledTimes(2);
    expect(backend.writeDataFileAbsolute).not.toHaveBeenCalled();
    expect(backend.copyToDownloads).not.toHaveBeenCalled();
    // 폴더를 고르는 동안에는 진행 창을 띄우지 않는다(닫기만)
    expect(appState.setProgressDialog.mock.calls).toEqual([[undefined]]);
  });
  test('폴더를 고르면 기억하고(다른 config 키 보존) 종전 파일명 규칙으로 저장', async () => {
    backend.selectDir.mockResolvedValueOnce('D:/Out');
    expect(await svc.downloadSingleImage(session, scene, 'outs/a.png')).toBe(true);
    expect(store.downloadSettings.lastSavePath).toBe('D:/Out');
    expect(store.unrelatedKey).toBe('keep-me');
    expect(backend.writeDataFileAbsolute).toHaveBeenCalledWith('D:/Out/scene.png', 'iVBORw0KGgo');
    expect(backend.copyToDownloads).not.toHaveBeenCalled();
  });
  test('여러 장: 넘버링 이름·미러 자르기·진행 창', async () => {
    svc.settings = { ...svc.settings, lastSavePath: 'D:/Out', defaultPrefix: 'pre' };
    const r = await svc.downloadImages(session, mirror, ['a', 'b'], undefined, true);
    expect(r).toEqual({ success: 2, failed: 0 });
    expect(backend.selectDir).not.toHaveBeenCalled();
    expect(cropMirrorResultFromDataUri).toHaveBeenCalledTimes(2);
    // 씬 이름 폴더 안에 종전 파일명 규칙으로
    expect(backend.writeDataFileAbsolute.mock.calls.map((c) => c[0])).toEqual([
      'D:/Out/mir/pre_mir_001.png',
      'D:/Out/mir/pre_mir_002.png',
    ]);
    expect(backend.existFileAbsolute).toHaveBeenCalledWith('D:/Out/mir');
    expect(appState.pushMessage).toHaveBeenCalledWith('"mir" 폴더에 2개의 이미지를 저장했습니다');
    expect(appState.setProgressDialog.mock.calls.map((c) => c[0]?.done)).toEqual([0, 1, 2, undefined]);
  });
  test('여러 장: 같은 이름 폴더(또는 파일)가 있으면 「씬이름 (n)」 폴더, 기존 것은 건드리지 않음', async () => {
    svc.settings = { ...svc.settings, lastSavePath: 'D:/Out' };
    backend.existFileAbsolute.mockImplementation(
      async (p: string) => p === 'D:/Out/scene' || p === 'D:/Out/scene (2)',
    );
    await svc.downloadImages(session, scene, ['a', 'b']);
    expect(backend.writeDataFileAbsolute.mock.calls.map((c) => c[0])).toEqual([
      'D:/Out/scene (3)/scene_001.png',
      'D:/Out/scene (3)/scene_002.png',
    ]);
    expect(appState.pushMessage).toHaveBeenCalledWith(IMAGE_DOWNLOAD_TEXT.pcSavedManyInFolder('scene (3)', 2));
    backend.existFileAbsolute.mockImplementation(async () => false);
  });
  test('여러 장 전부 실패면 아무것도 쓰지 않고(빈 폴더 없음) 실패 안내만', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    svc.settings = { ...svc.settings, lastSavePath: 'D:/Out' };
    imageService.fetchImage.mockResolvedValue(null as any);
    const r = await svc.downloadImages(session, scene, ['a', 'b']);
    expect(r).toEqual({ success: 0, failed: 2 });
    expect(backend.writeDataFileAbsolute).not.toHaveBeenCalled();
    expect(appState.pushMessage.mock.calls).toEqual([[IMAGE_DOWNLOAD_TEXT.pcFailedMany(2)]]);
    imageService.fetchImage.mockResolvedValue('data:image/png;base64,iVBORw0KGgo');
    errSpy.mockRestore();
  });
  test('한 장(우클릭 한 장 포함)은 폴더 없이 저장 폴더에 바로', async () => {
    svc.settings = { ...svc.settings, lastSavePath: 'D:/Out' };
    await svc.downloadImages(session, scene, ['a']);
    expect(backend.writeDataFileAbsolute).toHaveBeenCalledWith('D:/Out/scene.png', 'iVBORw0KGgo');
    expect(backend.existFileAbsolute).not.toHaveBeenCalledWith('D:/Out/scene');
  });
  test('히스토리: resolveTarget 으로 씬을 찾아 저장, 못 찾으면 저장하지 않음', async () => {
    svc.settings = { ...svc.settings, lastSavePath: 'D:/Out' };
    expect(await svc.downloadHistoryImage('outs/h.png', async () => null)).toBe(false);
    expect(backend.writeDataFileAbsolute).not.toHaveBeenCalled();
    expect(await svc.downloadHistoryImage('outs/h.png', async () => ({ session, scene }))).toBe(true);
    expect(backend.writeDataFileAbsolute).toHaveBeenCalledWith('D:/Out/scene.png', 'iVBORw0KGgo');
  });
});

describe('여러 장 다운로드 폴더 이름', () => {
  test('안전한 이름: 금지 문자·제어 문자·끝 점/공백·예약 이름·빈 이름·긴 이름', () => {
    expect(sanitizeDownloadFolderName('a/b:c*?')).toBe('a_b_c__');
    expect(sanitizeDownloadFolderName('tab\there\u0001x')).toBe('tab here x');
    expect(sanitizeDownloadFolderName('  끝점. . ')).toBe('끝점');
    expect(sanitizeDownloadFolderName('CON')).toBe('_CON');
    expect(sanitizeDownloadFolderName('nul.txt')).toBe('_nul.txt');
    expect(sanitizeDownloadFolderName('COM1')).toBe('_COM1');
    expect(sanitizeDownloadFolderName('CONTEST')).toBe('CONTEST');
    expect(sanitizeDownloadFolderName('')).toBe(DOWNLOAD_FOLDER_DEFAULT_NAME);
    expect(sanitizeDownloadFolderName(' ... ')).toBe(DOWNLOAD_FOLDER_DEFAULT_NAME);
    expect(sanitizeDownloadFolderName('..')).toBe(DOWNLOAD_FOLDER_DEFAULT_NAME);
    const long = sanitizeDownloadFolderName('가'.repeat(150));
    expect(Array.from(long)).toHaveLength(DOWNLOAD_FOLDER_MAX_LENGTH);
    // 자른 끝이 점·공백이면 다시 정리
    expect(sanitizeDownloadFolderName('a'.repeat(99) + '. b')).toBe('a'.repeat(99));
  });
  test('중복이면 (2)(3)…, 상한(999)을 넘으면 시각 접미', async () => {
    expect(await pickUniqueDownloadFolderName('씬', async () => false)).toBe('씬');
    const taken = new Set(['씬', '씬 (2)']);
    expect(await pickUniqueDownloadFolderName('씬', async (n) => taken.has(n))).toBe('씬 (3)');
    const exists = jest.fn(async () => true);
    expect(await pickUniqueDownloadFolderName('씬', exists, () => 12345)).toBe('씬 (12345)');
    expect(exists).toHaveBeenCalledTimes(999); // 원래 이름 + (2)~(999)
  });
});

describe('환경설정 「이미지 다운로드」 구획', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeAll(() => {
    (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  });
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  test('모바일에는 그리지 않는다', async () => {
    mockMobile = true;
    await act(async () => root.render(<DownloadSettingsSection />));
    expect(container.innerHTML).toBe('');
  });

  test('PC: 저장 폴더·설정을 보이고, 바꾸면 config downloadSettings 에 바로 저장(형식 그대로)', async () => {
    store.downloadSettings = { autoNumbering: true, overwriteExisting: false, includeTimestamp: false, lastSavePath: 'D:/Old', defaultPrefix: 'p' };
    await svc.loadSettings();
    await act(async () => root.render(<DownloadSettingsSection />));
    expect(container.textContent).toContain('이미지 다운로드');
    expect(container.textContent).toContain('D:/Old');
    expect(container.textContent).toContain('여러 장을 받으면 씬 이름으로 폴더를 만들어 그 안에 저장합니다');
    const ts = container.querySelector<HTMLInputElement>('#cfgDlTimestamp')!;
    await act(async () => ts.click());
    await flush();
    expect(store.downloadSettings).toEqual({ autoNumbering: true, overwriteExisting: false, includeTimestamp: true, lastSavePath: 'D:/Old', defaultPrefix: 'p' });
    // 자동 넘버링이 켜져 있으면 덮어쓰기는 고를 수 없다(종전 창과 같음)
    expect(container.querySelector<HTMLInputElement>('#cfgDlOverwrite')!.disabled).toBe(true);
    // 접두사는 칸을 벗어날 때 한 번 저장
    const prefix = container.querySelector<HTMLInputElement>('#cfgDlPrefix')!;
    expect(prefix.value).toBe('p');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const writes = backend.setConfig.mock.calls.length;
    await act(async () => {
      setter.call(prefix, 'new');
      prefix.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(backend.setConfig.mock.calls.length).toBe(writes);
    await act(async () => {
      prefix.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await flush();
    expect(store.downloadSettings.defaultPrefix).toBe('new');
    // 폴더 변경 버튼
    backend.selectDir.mockResolvedValueOnce('D:/New');
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '다운로드 저장 폴더 변경')!;
    await act(async () => btn.click());
    await flush();
    expect(store.downloadSettings.lastSavePath).toBe('D:/New');
    expect(appState.pushMessage).toHaveBeenCalledWith('저장 폴더를 바꿨습니다: D:/New');
    expect(container.textContent).toContain('D:/New');
  });
});
