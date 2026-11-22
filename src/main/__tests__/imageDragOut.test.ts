/**
 * @jest-environment node
 */
// 이미지를 끌어서 다른 프로그램에 놓기(2026-11-22) — main 쪽 경로 확인과 끌기 아이콘 고르기.
// 실제 파일·electron 없이 주입한 가짜로만 확인한다.
import {
  buildDragOutIcon,
  DRAG_ICON_SIZE,
  DragIconLike,
  resolveDragOutFile,
} from '../imageDragOut';

const WIN_ROOT = 'C:\\Users\\me\\AppData\\Roaming\\SDStudio';
const POSIX_ROOT = '/home/me/.config/SDStudio';

const yes = { isFile: () => true };

describe('resolveDragOutFile — 데이터 루트 안·실제 파일·이미지 확장자만', () => {
  test('저장소 상대 경로의 이미지는 절대 경로로 (win32)', () => {
    expect(
      resolveDragOutFile(WIN_ROOT, 'outs/프로젝트/씬 1/123.png', { ...yes, platform: 'win32' }),
    ).toBe(WIN_ROOT + '\\outs\\프로젝트\\씬 1\\123.png');
    expect(
      resolveDragOutFile(WIN_ROOT, 'workspace/p__id/outs/s/a.WEBP', { ...yes, platform: 'win32' }),
    ).toBe(WIN_ROOT + '\\workspace\\p__id\\outs\\s\\a.WEBP');
  });

  test('posix 도 같은 규칙', () => {
    expect(resolveDragOutFile(POSIX_ROOT, 'outs/p/s/a.jpg', { ...yes, platform: 'linux' })).toBe(
      POSIX_ROOT + '/outs/p/s/a.jpg',
    );
    expect(resolveDragOutFile(POSIX_ROOT, 'outs/p/s/a.jpeg', { ...yes, platform: 'linux' })).toBe(
      POSIX_ROOT + '/outs/p/s/a.jpeg',
    );
  });

  test('밖을 가리키는 경로는 거부(.. · 절대 경로 · 다른 드라이브 · UNC)', () => {
    const o = { ...yes, platform: 'win32' as const };
    expect(resolveDragOutFile(WIN_ROOT, '../a.png', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, 'outs/../../a.png', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, 'outs\\..\\..\\a.png', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, 'C:\\Windows\\a.png', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, WIN_ROOT + '\\outs\\a.png', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, 'D:a.png', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, '\\\\server\\share\\a.png', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, '/a.png', o)).toBeNull();
    expect(resolveDragOutFile(POSIX_ROOT, '/etc/a.png', { ...yes, platform: 'linux' })).toBeNull();
    expect(resolveDragOutFile(POSIX_ROOT, '../SDStudio2/a.png', { ...yes, platform: 'linux' })).toBeNull();
  });

  test('루트 안이라도 .. 로 되돌아오는 경로는 루트 안이면 허용', () => {
    expect(
      resolveDragOutFile(POSIX_ROOT, 'outs/x/../p/a.png', { ...yes, platform: 'linux' }),
    ).toBe(POSIX_ROOT + '/outs/p/a.png');
  });

  test('이미지 확장자가 아니면 거부(토큰·json·폴더 이름 등)', () => {
    const o = { ...yes, platform: 'win32' as const };
    expect(resolveDragOutFile(WIN_ROOT, 'TOKEN.txt', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, 'projects/a.json', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, 'outs/p/s', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, 'outs/p/a.png.exe', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, 'outs/p/a.gif', o)).toBeNull();
  });

  test('없는 파일·폴더·확인 오류면 거부', () => {
    const o = { platform: 'win32' as const };
    expect(resolveDragOutFile(WIN_ROOT, 'outs/a.png', { ...o, isFile: () => false })).toBeNull();
    expect(
      resolveDragOutFile(WIN_ROOT, 'outs/a.png', {
        ...o,
        isFile: () => {
          throw new Error('EACCES');
        },
      }),
    ).toBeNull();
  });

  test('이상한 입력은 거부하고 파일 확인도 하지 않는다', () => {
    const isFile = jest.fn(() => true);
    const o = { isFile, platform: 'win32' as const };
    for (const bad of [undefined, null, 1, {}, '', '   ', 'outs/a\0.png']) {
      expect(resolveDragOutFile(WIN_ROOT, bad as any, o)).toBeNull();
    }
    expect(resolveDragOutFile('', 'outs/a.png', o)).toBeNull();
    expect(resolveDragOutFile(WIN_ROOT, '.', o)).toBeNull();
    expect(isFile).not.toHaveBeenCalled();
  });
});

class FakeImage implements DragIconLike {
  constructor(public w: number, public h: number, public tag = '') {}
  isEmpty() {
    return this.w === 0 || this.h === 0;
  }
  getSize() {
    return { width: this.w, height: this.h };
  }
  resize(opts: { width?: number; height?: number }): FakeImage {
    if (opts.width) return new FakeImage(opts.width, Math.round((this.h * opts.width) / this.w), this.tag);
    return new FakeImage(Math.round((this.w * opts.height!) / this.h), opts.height!, this.tag);
  }
}

const EMPTY = new FakeImage(0, 0, 'empty');

describe('buildDragOutIcon — 작은 축소본, 실패하면 앱 아이콘, 끝내 비면 null', () => {
  test('png 는 nativeImage 로 바로 읽고 한 변 최대 크기로 줄인다', async () => {
    const thumbnailPng = jest.fn();
    const icon = await buildDragOutIcon('/r/a.png', {
      fromPath: (p) => (p === '/r/a.png' ? new FakeImage(832, 1216, 'img') : EMPTY),
      fromBuffer: () => EMPTY,
      thumbnailPng,
      fallbackPath: '/assets/icon.png',
    });
    expect(icon?.tag).toBe('img');
    expect(icon?.getSize().height).toBe(DRAG_ICON_SIZE);
    expect(icon!.getSize().width).toBeLessThan(DRAG_ICON_SIZE);
    expect(thumbnailPng).not.toHaveBeenCalled();
  });

  test('webp 는 sharp 축소본(PNG 버퍼)을 쓴다', async () => {
    const icon = await buildDragOutIcon('/r/a.webp', {
      fromPath: () => EMPTY,
      fromBuffer: () => new FakeImage(96, 64, 'thumb'),
      thumbnailPng: async () => Buffer.from('x'),
      fallbackPath: '/assets/icon.png',
    });
    expect(icon?.tag).toBe('thumb');
  });

  test('webp 축소본이 제한 시간 안에 안 오면 앱 아이콘', async () => {
    const icon = await buildDragOutIcon('/r/a.webp', {
      fromPath: (p) => (p === '/assets/icon.png' ? new FakeImage(256, 256, 'app') : EMPTY),
      fromBuffer: () => new FakeImage(96, 64, 'thumb'),
      thumbnailPng: () => new Promise(() => {}),
      fallbackPath: '/assets/icon.png',
      timeoutMs: 5,
    });
    expect(icon?.tag).toBe('app');
    expect(icon?.getSize()).toEqual({ width: DRAG_ICON_SIZE, height: DRAG_ICON_SIZE });
  });

  test('읽기 실패·빈 그림·예외면 앱 아이콘', async () => {
    const fallback = (p: string) => (p === '/assets/icon.png' ? new FakeImage(64, 64, 'app') : EMPTY);
    expect(
      (await buildDragOutIcon('/r/a.png', { fromPath: fallback, fromBuffer: () => EMPTY, fallbackPath: '/assets/icon.png' }))?.tag,
    ).toBe('app');
    expect(
      (
        await buildDragOutIcon('/r/a.jpg', {
          fromPath: (p) => {
            if (p === '/r/a.jpg') throw new Error('bad');
            return fallback(p);
          },
          fromBuffer: () => EMPTY,
          fallbackPath: '/assets/icon.png',
        })
      )?.tag,
    ).toBe('app');
    expect(
      (
        await buildDragOutIcon('/r/a.webp', {
          fromPath: fallback,
          fromBuffer: () => EMPTY,
          thumbnailPng: async () => {
            throw new Error('sharp');
          },
          fallbackPath: '/assets/icon.png',
        })
      )?.tag,
    ).toBe('app');
  });

  test('앱 아이콘까지 비면 null(빈 아이콘으로 끌지 않음)', async () => {
    const icon = await buildDragOutIcon('/r/a.png', {
      fromPath: () => EMPTY,
      fromBuffer: () => EMPTY,
      fallbackPath: '/assets/icon.png',
    });
    expect(icon).toBeNull();
  });
});
