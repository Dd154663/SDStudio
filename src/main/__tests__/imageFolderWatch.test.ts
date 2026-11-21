/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import {
  createImageChangeDetector,
  isRootGoneEvent,
  watchedImageRelPath,
} from '../imageFolderWatch';

const DIR = 'outs\\scene1';
const FILE = 'outs\\scene1\\a.png';
const REL = 'outs/scene1/a.png';

type Ev = [string, string | null];

function setup(opts: { quietMs?: number; vanishedTtlMs?: number; maxVanished?: number } = {}) {
  const files = new Set<string>();
  const emitted: string[] = [];
  const isFile = jest.fn(async (rel: string) => files.has(rel));
  const emit = jest.fn((rel: string) => {
    emitted.push(rel);
  });
  const det = createImageChangeDetector({ isFile, emit, ...opts });
  const feed = (evs: Ev[]) => {
    for (const [t, f] of evs) det.onRawEvent(t, f);
  };
  return { files, emitted, isFile, emit, det, feed };
}

const settle = async (ms = 400) => {
  await jest.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('watchedImageRelPath', () => {
  test('세 루트 아래 이미지만 / 로 이은 상대 경로로 바꾼다', () => {
    expect(watchedImageRelPath(FILE)).toBe(REL);
    expect(watchedImageRelPath('inpaints/s/x.webp')).toBe('inpaints/s/x.webp');
    expect(watchedImageRelPath('workspace\\p\\outs\\s\\x.jpg')).toBe('workspace/p/outs/s/x.jpg');
    expect(watchedImageRelPath('.\\outs\\s\\x.jpeg')).toBe('outs/s/x.jpeg');
  });
  test('확장자는 대소문자를 가리지 않는다', () => {
    expect(watchedImageRelPath('outs\\s\\X.PNG')).toBe('outs/s/X.PNG');
    expect(watchedImageRelPath('outs\\s\\x.WebP')).toBe('outs/s/x.WebP');
    expect(watchedImageRelPath('outs\\s\\x.JPG')).toBe('outs/s/x.JPG');
  });
  test('한글·공백 이름도 그대로 둔다', () => {
    expect(watchedImageRelPath('outs\\내 씬 1\\그림 01.png')).toBe('outs/내 씬 1/그림 01.png');
  });
  test('대상이 아니면 null', () => {
    expect(watchedImageRelPath(null)).toBeNull();
    expect(watchedImageRelPath(undefined)).toBeNull();
    expect(watchedImageRelPath('')).toBeNull();
    expect(watchedImageRelPath(DIR)).toBeNull();
    expect(watchedImageRelPath('outs')).toBeNull();
    expect(watchedImageRelPath('outs\\s\\a.json')).toBeNull();
    expect(watchedImageRelPath('outs\\s\\a.png.tmp')).toBeNull();
    expect(watchedImageRelPath('outs\\s\\fastcache\\a.webp')).toBeNull();
    expect(watchedImageRelPath('vibes\\a.png')).toBeNull();
    expect(watchedImageRelPath('a.png')).toBeNull();
    expect(watchedImageRelPath('C:\\data\\outs\\s\\a.png')).toBeNull();
    expect(watchedImageRelPath('\\\\?\\C:\\data\\outs\\s\\a.png')).toBeNull();
    expect(watchedImageRelPath('/outs/s/a.png')).toBeNull();
  });
});

describe('isRootGoneEvent', () => {
  test('절대 경로만 true', () => {
    expect(isRootGoneEvent('\\\\?\\C:\\Users\\x\\SDStudio')).toBe(true);
    expect(isRootGoneEvent('C:\\Users\\x')).toBe(true);
    expect(isRootGoneEvent('/x')).toBe(true);
    expect(isRootGoneEvent(FILE)).toBe(false);
    expect(isRootGoneEvent(null)).toBe(false);
    expect(isRootGoneEvent(undefined)).toBe(false);
  });
});

describe('createImageChangeDetector — 실측 알림 순서', () => {
  test('제자리 덮어쓰기 → 여러 change 가 한 번의 emit', async () => {
    const s = setup();
    s.files.add(REL);
    s.feed([
      ['change', DIR],
      ['change', FILE],
      ['change', 'outs'],
      ['change', FILE],
      ['change', FILE],
    ]);
    await settle();
    expect(s.emitted).toEqual([REL]);
  });

  test('직접 써서 생성 → emit 없음', async () => {
    const s = setup();
    s.files.add(REL);
    s.feed([
      ['rename', FILE],
      ['change', DIR],
      ['change', FILE],
    ]);
    await settle();
    expect(s.emitted).toEqual([]);
  });

  test('옮겨 넣어 생성 → emit 없음', async () => {
    const s = setup();
    s.files.add(REL);
    s.feed([
      ['rename', FILE],
      ['change', DIR],
    ]);
    await settle();
    expect(s.emitted).toEqual([]);
  });

  test('임시 파일로 교체 → 대상 파일만 emit 1회', async () => {
    const s = setup();
    s.files.add(REL);
    const TMP = `${FILE}.tmp`;
    s.feed([
      ['rename', TMP],
      ['change', TMP],
      ['change', DIR],
      ['rename', FILE],
      ['rename', TMP],
      ['rename', FILE],
      ['change', DIR],
    ]);
    await settle();
    expect(s.emitted).toEqual([REL]);
  });

  test('삭제 → emit 없음', async () => {
    const s = setup();
    s.feed([['rename', FILE]]);
    await settle();
    expect(s.emitted).toEqual([]);
  });

  test('삭제 뒤 TTL 안에 같은 이름으로 다시 만들면 emit 1회', async () => {
    const s = setup();
    s.feed([['rename', FILE]]);
    await settle();
    s.files.add(REL);
    await settle(1000);
    s.feed([
      ['rename', FILE],
      ['change', DIR],
    ]);
    await settle();
    expect(s.emitted).toEqual([REL]);
  });

  test('삭제 뒤 직접 써서 다시 만들어도 TTL 안이면 emit 1회', async () => {
    const s = setup();
    s.feed([['rename', FILE]]);
    await settle();
    s.files.add(REL);
    s.feed([
      ['rename', FILE],
      ['change', DIR],
      ['change', FILE],
    ]);
    await settle();
    expect(s.emitted).toEqual([REL]);
  });

  test('삭제 뒤 TTL 밖에 다시 만들면 emit 없음', async () => {
    const s = setup();
    s.feed([['rename', FILE]]);
    await settle();
    await settle(6000);
    s.files.add(REL);
    s.feed([
      ['rename', FILE],
      ['change', DIR],
    ]);
    await settle();
    expect(s.emitted).toEqual([]);
  });

  test('폴더 change·json·fastcache·루트 밖·null·절대 경로는 무시', async () => {
    const s = setup();
    s.feed([
      ['change', DIR],
      ['change', 'outs\\s\\a.json'],
      ['change', 'outs\\s\\fastcache\\a.webp'],
      ['change', 'vibes\\a.png'],
      ['change', null],
      ['change', 'C:\\x\\outs\\s\\a.png'],
    ]);
    await settle();
    expect(s.isFile).not.toHaveBeenCalled();
    expect(s.emitted).toEqual([]);
  });

  test('후보라도 isFile 이 false 면 emit 없음', async () => {
    const s = setup();
    s.feed([['change', FILE]]);
    await settle();
    expect(s.isFile).toHaveBeenCalledWith(REL);
    expect(s.emitted).toEqual([]);
  });

  test('isFile 이 던져도 다음 알림 처리를 계속한다', async () => {
    const s = setup();
    s.files.add(REL);
    s.isFile.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    s.feed([['change', FILE]]);
    await settle();
    expect(s.emitted).toEqual([]);
    s.feed([['change', FILE]]);
    await settle();
    expect(s.emitted).toEqual([REL]);
  });

  test('isFile 이 동기로 던져도 감지기가 죽지 않는다', async () => {
    const s = setup();
    s.files.add(REL);
    s.isFile.mockImplementationOnce(((): Promise<boolean> => {
      throw new Error('sync boom');
    }) as any);
    s.feed([['change', FILE]]);
    await settle();
    s.feed([['change', FILE]]);
    await settle();
    expect(s.emitted).toEqual([REL]);
  });

  test('emit 이 던져도 다음 알림 처리를 계속한다', async () => {
    const s = setup();
    const B = 'outs\\scene1\\b.png';
    s.files.add(REL);
    s.files.add('outs/scene1/b.png');
    s.emit.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    s.feed([['change', FILE]]);
    await settle();
    s.feed([['change', B]]);
    await settle();
    expect(s.emit).toHaveBeenCalledTimes(2);
    expect(s.emit).toHaveBeenLastCalledWith('outs/scene1/b.png');
  });

  test('알림이 계속 오는 동안은 판정이 미뤄진다', async () => {
    const s = setup();
    s.files.add(REL);
    for (let i = 0; i < 5; i++) {
      s.feed([['change', FILE]]);
      await settle(200);
    }
    expect(s.isFile).not.toHaveBeenCalled();
    expect(s.emitted).toEqual([]);
    await settle(150);
    expect(s.emitted).toEqual([REL]);
  });

  test('경로마다 따로 판정하고, 늦게 온 경로는 그 경로의 조용한 시간 뒤에 판정한다', async () => {
    const s = setup();
    s.files.add(REL);
    s.files.add('outs/scene1/b.png');
    s.feed([['change', FILE]]);
    await settle(200);
    s.feed([['change', 'outs\\scene1\\b.png']]);
    await settle(150);
    expect(s.emitted).toEqual([REL]);
    await settle(200);
    expect(s.emitted).toEqual([REL, 'outs/scene1/b.png']);
  });

  test('대기 중인 경로가 없으면 타이머가 멈춘다', async () => {
    const s = setup();
    s.files.add(REL);
    expect(jest.getTimerCount()).toBe(0);
    s.feed([['change', FILE], ['change', FILE]]);
    expect(jest.getTimerCount()).toBe(1);
    await settle();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('대량 알림도 한 번씩만 판정한다', async () => {
    const s = setup();
    for (let i = 0; i < 20000; i++) {
      s.files.add(`outs/s/${i}.png`);
      s.det.onRawEvent('change', `outs\\s\\${i}.png`);
    }
    expect(jest.getTimerCount()).toBe(1);
    await settle();
    expect(s.emitted.length).toBe(20000);
  });

  test('dispose 뒤에는 아무것도 하지 않는다', async () => {
    const s = setup();
    s.files.add(REL);
    s.feed([['change', FILE]]);
    s.det.dispose();
    expect(jest.getTimerCount()).toBe(0);
    s.feed([['change', FILE]]);
    await settle();
    expect(s.isFile).not.toHaveBeenCalled();
    expect(s.emitted).toEqual([]);
  });

  test('「사라진 경로」 목록은 상한을 넘으면 오래된 것부터 버린다', async () => {
    const s = setup({ maxVanished: 2 });
    const name = (c: string) => `outs\\s\\${c}.png`;
    s.feed([['rename', name('a')], ['rename', name('b')], ['rename', name('c')]]);
    await settle();
    s.files.add('outs/s/a.png');
    s.files.add('outs/s/c.png');
    s.feed([['rename', name('a')], ['rename', name('c')]]);
    await settle();
    expect(s.emitted).toEqual(['outs/s/c.png']);
  });
});

describe('main.ts 전역 감시 분기', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.ts'), 'utf-8');
  const winStart = main.indexOf("if (config.refreshImage && os.platform() === 'win32') {");
  const otherStart = main.indexOf('} else if (config.refreshImage) {', winStart);

  test('win32 분기가 recursive 감시와 새 모듈을 쓰고 error 리스너가 있다', () => {
    expect(winStart).toBeGreaterThan(-1);
    expect(otherStart).toBeGreaterThan(winStart);
    const win = main.slice(winStart, otherStart);
    expect(win).toMatch(/fsSync\.watch\(\s*APP_DIR,\s*\{\s*recursive: true/);
    expect(win).toContain('createImageChangeDetector(');
    expect(win).toContain('isRootGoneEvent(filename)');
    expect(win).toContain("watcher.on('error'");
    expect(win).not.toContain('chokidar.watch');
    expect(main).toContain("from './imageFolderWatch'");
  });

  test('chokidar.watch(APP_DIR 는 win32 가 아닌 분기에만 한 번 남아 있다', () => {
    const hits = main.split('chokidar.watch(APP_DIR').length - 1;
    expect(hits).toBe(1);
    expect(main.indexOf('chokidar.watch(APP_DIR')).toBeGreaterThan(otherStart);
  });
});
