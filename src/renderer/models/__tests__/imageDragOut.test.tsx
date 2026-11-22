// 이미지를 끌어서 다른 프로그램에 놓기(2026-11-22) — 렌더러 공용 헬퍼의 PC/모바일 분기·보조 키·클릭 삼키기,
// 붙인 자리(히스토리 칸·상세 보기·그리드 칸)와 앱 전체 드롭 안내 예외의 배선.
import fs from 'fs';
import path from 'path';

jest.mock('../index', () => ({
  backend: { startImageDragOut: jest.fn(async () => true) },
}));

import {
  DRAG_OUT_GRACE_MS,
  isDragOutModifier,
  isImageDragOutActive,
  makeImageDragOutProps,
  resetImageDragOutStateForTest,
} from '../imageDragOut';

function fakeDragEvent(keys: { ctrlKey?: boolean; altKey?: boolean } = {}) {
  return {
    ...keys,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  } as any;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetImageDragOutStateForTest());

describe('makeImageDragOutProps', () => {
  test('모바일(비활성)·경로 없음이면 아무 속성도 없다', () => {
    const start = jest.fn(async () => true);
    expect(makeImageDragOutProps('outs/a.png', {}, { enabled: false, isMac: false, start })).toEqual({});
    expect(makeImageDragOutProps('outs/a.png', { modifier: true }, { enabled: false, isMac: false, start })).toEqual({});
    expect(makeImageDragOutProps(undefined, {}, { enabled: true, isMac: false, start })).toEqual({});
    expect(makeImageDragOutProps('', {}, { enabled: true, isMac: false, start })).toEqual({});
  });

  test('PC: draggable + dragstart 를 막고 원본 경로로 끌기 시작', async () => {
    const start = jest.fn(async () => true);
    const props = makeImageDragOutProps('outs/p/s/1.png', {}, { enabled: true, isMac: false, start });
    expect(props.draggable).toBe(true);
    const e = fakeDragEvent();
    props.onDragStart!(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith('outs/p/s/1.png');
  });

  test('보조 키 모드: draggable 을 붙이지 않고, 키 없이 끌면 이벤트를 건드리지 않는다(기존 끌기 유지)', () => {
    const start = jest.fn(async () => true);
    const props = makeImageDragOutProps('outs/a.png', { modifier: true }, { enabled: true, isMac: false, start });
    expect('draggable' in props).toBe(false);
    const plain = fakeDragEvent();
    props.onDragStart!(plain);
    expect(plain.preventDefault).not.toHaveBeenCalled();
    expect(plain.stopPropagation).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    // Windows: Alt 는 보조 키가 아니다(탐색기에서 Alt 놓기 = 바로 가기)
    props.onDragStart!(fakeDragEvent({ altKey: true }));
    expect(start).not.toHaveBeenCalled();
    const ctrl = fakeDragEvent({ ctrlKey: true });
    props.onDragStart!(ctrl);
    expect(ctrl.preventDefault).toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith('outs/a.png');
  });

  test('mac 은 Option(Alt) 이 보조 키', () => {
    expect(isDragOutModifier({ altKey: true }, true)).toBe(true);
    expect(isDragOutModifier({ ctrlKey: true }, true)).toBe(false);
    expect(isDragOutModifier({ ctrlKey: true }, false)).toBe(true);
    expect(isDragOutModifier({ altKey: true }, false)).toBe(false);
  });

  test('끄는 동안과 끝난 직후에는 클릭을 삼키고, 시간이 지나면 다시 통과', async () => {
    let now = 1000;
    let finish!: (v: boolean) => void;
    const start = jest.fn(() => new Promise<boolean>((r) => (finish = r)));
    const props = makeImageDragOutProps('outs/a.png', {}, { enabled: true, isMac: false, start, now: () => now });
    const click = () => ({ preventDefault: jest.fn(), stopPropagation: jest.fn() }) as any;

    const before = click();
    props.onClickCapture!(before);
    expect(before.stopPropagation).not.toHaveBeenCalled();

    props.onDragStart!(fakeDragEvent());
    expect(isImageDragOutActive(now)).toBe(true);
    const during = click();
    props.onClickCapture!(during);
    expect(during.stopPropagation).toHaveBeenCalled();

    finish(true);
    await flush();
    expect(isImageDragOutActive(now + 1)).toBe(true);
    now += DRAG_OUT_GRACE_MS + 1;
    expect(isImageDragOutActive(now)).toBe(false);
    const after = click();
    props.onClickCapture!(after);
    expect(after.stopPropagation).not.toHaveBeenCalled();
  });

  test('끌기 시작이 실패해도(거부·예외) 상태가 풀린다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let now = 0;
    const rejecting = makeImageDragOutProps('outs/a.png', {}, {
      enabled: true,
      isMac: false,
      start: async () => {
        throw new Error('ipc');
      },
      now: () => now,
    });
    rejecting.onDragStart!(fakeDragEvent());
    await flush();
    now += DRAG_OUT_GRACE_MS + 1;
    expect(isImageDragOutActive(now)).toBe(false);

    const throwing = makeImageDragOutProps('outs/a.png', {}, {
      enabled: true,
      isMac: false,
      start: () => {
        throw new Error('sync');
      },
      now: () => now,
    });
    throwing.onDragStart!(fakeDragEvent());
    now += DRAG_OUT_GRACE_MS + 1;
    expect(isImageDragOutActive(now)).toBe(false);
    warn.mockRestore();
  });
});

describe('imageDragOutProps — 플랫폼 판정', () => {
  const load = (electron: boolean) => {
    let mod: typeof import('../imageDragOut') | undefined;
    let backend: any;
    const w = window as any;
    const prev = w.electron;
    if (electron) w.electron = { ipcRenderer: {} };
    else delete w.electron;
    try {
      jest.isolateModules(() => {
        mod = require('../imageDragOut');
        backend = require('../index').backend;
      });
    } finally {
      if (prev === undefined) delete w.electron;
      else w.electron = prev;
    }
    return { mod: mod!, backend };
  };

  test('모바일(window.electron 없음)은 빈 객체', () => {
    expect(load(false).mod.imageDragOutProps('outs/a.png')).toEqual({});
  });

  test('PC 는 backend.startImageDragOut 으로 시작', () => {
    const { mod, backend } = load(true);
    const props = mod.imageDragOutProps('outs/a.png');
    expect(props.draggable).toBe(true);
    props.onDragStart!(fakeDragEvent());
    expect(backend.startImageDragOut).toHaveBeenCalledWith('outs/a.png');
  });
});

describe('붙인 자리 배선(소스 확인 — 끌기 자체는 실기 확인)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  test('히스토리 칸 img: draggable={false} 뒤에 펼친다(모바일은 그대로 끌기 없음)', () => {
    expect(read('componenets/ImageHistory.tsx')).toMatch(
      /draggable=\{false\}\s*\n\s*\/\/[^\n]*\n\s*\{\.\.\.imageDragOutProps\(entry\.path\)\}/,
    );
  });

  test('상세 보기 큰 이미지와 그리드 칸(보조 키 모드)', () => {
    const src = read('componenets/ResultViewer.tsx');
    expect(src).toContain('{...imageDragOutProps(paths[selectedIndex])}');
    expect(src).toMatch(/draggable=\{!selectMode\}[\s\S]{0,400}\{\.\.\.imageDragOutProps\(path, \{ modifier: true \}\)\}/);
    expect(src.match(/imageDragOutProps\(/g)?.length).toBe(2);
  });

  test('앱 전체 드롭 안내·불러오기는 밖으로 끄는 중이면 건너뛴다', () => {
    const src = read('componenets/App.tsx');
    expect(src.match(/if \(isImageDragOutActive\(\)\) return;/g)?.length).toBe(2);
  });

  test('backend 계약: 양 플랫폼 구현(Android 는 no-op false)', () => {
    expect(read('backend.ts')).toMatch(/abstract startImageDragOut\(imagePath: string\): Promise<boolean>;/);
    expect(read('backends/electronBackend.ts')).toContain("invoke('start-image-drag-out', imagePath)");
    expect(read('backends/androidBackend.ts')).toMatch(/async startImageDragOut\(imagePath: string\): Promise<boolean> \{\s*return false;\s*\}/);
  });
});
