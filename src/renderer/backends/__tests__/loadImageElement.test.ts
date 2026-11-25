import * as fs from 'fs';
import * as path from 'path';
import { loadImageElement } from '../loadImageElement';

// 2026-11-25 모바일 레퍼런스 「NO IMAGE」: Android 썸네일 생성이 img.decode() 에서 다음 화면 프레임까지 멈췄다.
// load 이벤트만으로 끝나는지, Android 리사이즈가 decode() 로 돌아가지 않는지 고정한다.

const fakeImage = () => {
  const img: any = { decode: jest.fn(() => new Promise(() => {})) };
  return img;
};

describe('loadImageElement', () => {
  test('load 이벤트로 끝나고 decode() 를 부르지 않는다', async () => {
    const img = fakeImage();
    const p = loadImageElement('data:image/png;base64,AAAA', () => img);
    expect(img.src).toBe('data:image/png;base64,AAAA');
    expect(typeof img.onload).toBe('function');
    img.onload();
    await expect(p).resolves.toBe(img);
    expect(img.decode).not.toHaveBeenCalled();
  });

  test('src 를 넣기 전에 핸들러를 단다(즉시 load 도 놓치지 않음)', async () => {
    const img: any = {};
    let handlerAtSrc: any;
    Object.defineProperty(img, 'src', {
      set(v) {
        handlerAtSrc = img.onload;
        this._src = v;
      },
      get() {
        return this._src;
      },
    });
    const p = loadImageElement('x', () => img);
    expect(typeof handlerAtSrc).toBe('function');
    img.onload();
    await expect(p).resolves.toBe(img);
  });

  test('error 이벤트면 reject 한다(ImageService 가 원본으로 대신 보여 줌)', async () => {
    const img = fakeImage();
    const p = loadImageElement('bad', () => img);
    img.onerror();
    await expect(p).rejects.toThrow();
  });

  test('Android 백엔드는 decode() 대신 loadImageElement 를 쓴다', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'androidBackend.ts'), 'utf8');
    expect(src).not.toMatch(/\.decode\(\)/);
    expect(src).toMatch(/await loadImageElement\(/);
  });
});
