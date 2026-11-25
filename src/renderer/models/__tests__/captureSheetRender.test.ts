// 「캡처」 캔버스 합성(2026-11-25) — models/captureSheetRender.ts
// jsdom 에 캔버스가 없어 가짜 2D 컨텍스트로 그리는 순서·좌표·취소·읽기 실패 시 계속을 확인한다.
import { buildGridCaptureContent, buildSceneCaptureContent, CAPTURE_COLORS, layoutCapture } from '../captureSheet';
import { encodeCaptureCanvas, fitDrawRect, renderCaptureSheet } from '../captureSheetRender';

type Call = [string, ...unknown[]];

function fakeCanvas(dataUrl = 'data:image/jpeg;base64,QUJD') {
  const calls: Call[] = [];
  const ctx: any = {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    imageSmoothingEnabled: false,
    fillRect: (...a: unknown[]) => calls.push(['fillRect', ctx.fillStyle, ...a]),
    drawImage: (img: any, ...a: unknown[]) => calls.push(['drawImage', img.id, ...a]),
    fillText: (t: string, x: number, y: number) => calls.push(['fillText', t, x, y, ctx.font]),
    measureText: (t: string) => ({ width: t.length * 10 }),
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: jest.fn((_t?: string, _q?: number) => dataUrl),
  };
  return { canvas, calls };
}

const img = (id: string, width = 100, height = 100) => ({ id, width, height });

describe('그리기', () => {
  test('배경 → 칸마다 읽기·그리기·놓기(순서대로), 진행 콜백', async () => {
    const layout = layoutCapture({
      content: buildGridCaptureContent(['a', 'b', 'c'], '씬', false),
      columns: 2,
      cellWidth: 100,
      aspect: 1,
      gap: false,
      showNames: false,
    });
    const { canvas, calls } = fakeCanvas();
    const order: string[] = [];
    const progress: [number, number][] = [];
    const out = await renderCaptureSheet(layout, 'cover', {
      createCanvas: (w, h) => {
        canvas.width = w;
        canvas.height = h;
        return canvas;
      },
      loadImage: async (s) => {
        order.push(`load ${s.path}`);
        return img(s.path);
      },
      releaseImage: (i: any) => order.push(`release ${i.id}`),
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(out).toBe(canvas);
    expect([canvas.width, canvas.height]).toEqual([200, 200]);
    expect(calls[0]).toEqual(['fillRect', CAPTURE_COLORS.background, 0, 0, 200, 200]);
    expect(order).toEqual(['load a', 'release a', 'load b', 'release b', 'load c', 'release c']);
    const draws = calls.filter((c) => c[0] === 'drawImage');
    expect(draws.map((d) => [d[1], d[6], d[7]])).toEqual([
      ['a', 0, 0],
      ['b', 100, 0],
      ['c', 0, 100],
    ]);
    expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  });

  test('한 장을 못 읽으면(null·오류) 그 칸은 회색 빈 칸, 나머지는 계속', async () => {
    const layout = layoutCapture({
      content: buildGridCaptureContent(['a', 'bad', 'err'], '씬', false),
      columns: 3,
      cellWidth: 100,
      aspect: 1,
      gap: false,
      showNames: false,
    });
    const { canvas, calls } = fakeCanvas();
    const out = await renderCaptureSheet(layout, 'cover', {
      createCanvas: () => canvas,
      loadImage: async (s) => {
        if (s.path === 'bad') return null;
        if (s.path === 'err') throw new Error('x');
        return img(s.path);
      },
    });
    expect(out).toBe(canvas);
    expect(calls.filter((c) => c[0] === 'drawImage')).toHaveLength(1);
    const empties = calls.filter((c) => c[0] === 'fillRect' && c[1] === CAPTURE_COLORS.empty);
    expect(empties.map((c) => c[2])).toEqual([100, 200]);
  });

  test('빈 씬 칸은 읽지 않고 회색으로', async () => {
    const layout = layoutCapture({
      content: buildSceneCaptureContent(
        [{ name: 'e', favorites: [], outputs: [] }],
        { perScene: 'main', includeEmpty: true, columns: 4 },
      ),
      columns: 4,
      cellWidth: 100,
      aspect: 1,
      gap: false,
      showNames: true,
    });
    const { canvas, calls } = fakeCanvas();
    const load = jest.fn();
    await renderCaptureSheet(layout, 'cover', { createCanvas: () => canvas, loadImage: load, fontFamily: 'X' });
    expect(load).not.toHaveBeenCalled();
    expect(calls.some((c) => c[0] === 'fillRect' && c[1] === CAPTURE_COLORS.empty)).toBe(true);
    // 이름 띠 글자 — 가운데 정렬, 지정 글꼴
    const t = calls.find((c) => c[0] === 'fillText')!;
    expect(t[1]).toBe('e');
    expect(String(t[4])).toContain('X');
  });

  test('취소하면 undefined, 그 뒤 칸은 읽지 않는다', async () => {
    const layout = layoutCapture({
      content: buildGridCaptureContent(['a', 'b', 'c'], '씬', false),
      columns: 3,
      cellWidth: 100,
      aspect: 1,
      gap: false,
      showNames: false,
    });
    const { canvas } = fakeCanvas();
    let cancelled = false;
    const loaded: string[] = [];
    const released: string[] = [];
    const out = await renderCaptureSheet(layout, 'cover', {
      createCanvas: () => canvas,
      loadImage: async (s) => {
        loaded.push(s.path);
        if (s.path === 'b') cancelled = true;
        return img(s.path);
      },
      releaseImage: (i: any) => released.push(i.id),
      isCancelled: () => cancelled,
    });
    expect(out).toBeUndefined();
    expect(loaded).toEqual(['a', 'b']);
    // 취소 순간 읽고 있던 이미지도 놓는다
    expect(released).toEqual(['a', 'b']);
  });

  test('글자는 폰트를 기다린 뒤, 기다리기가 실패해도 그린다 · 긴 이름은 말줄임', async () => {
    const layout = layoutCapture({
      content: buildGridCaptureContent(['a'], '아주아주아주아주아주아주아주아주아주아주긴이름', true),
      columns: 1,
      cellWidth: 100,
      aspect: 1,
      gap: false,
      showNames: true,
    });
    const { canvas, calls } = fakeCanvas();
    const wait = jest.fn(async () => {
      throw new Error('font');
    });
    await renderCaptureSheet(layout, 'cover', {
      createCanvas: () => canvas,
      loadImage: async () => img('a'),
      waitForFont: wait,
    });
    expect(wait).toHaveBeenCalled();
    const t = calls.find((c) => c[0] === 'fillText')!;
    expect(String(t[1]).endsWith('…')).toBe(true);
    expect(String(t[1]).length * 10).toBeLessThanOrEqual(100);
  });
});

describe('채우기 영역', () => {
  test('cover = 가운데를 잘라 칸을 채움', () => {
    const r = fitDrawRect(200, 100, { x: 10, y: 20, w: 100, h: 100 }, 'cover');
    expect(r).toEqual({ sx: 50, sy: 0, sw: 100, sh: 100, dx: 10, dy: 20, dw: 100, dh: 100 });
  });
  test('contain = 전체가 보이게, 가운데 정렬', () => {
    const r = fitDrawRect(200, 100, { x: 0, y: 0, w: 100, h: 100 }, 'contain');
    expect(r).toEqual({ sx: 0, sy: 0, sw: 200, sh: 100, dx: 0, dy: 25, dw: 100, dh: 50 });
  });
});

describe('인코딩', () => {
  test('형식별 MIME·품질, 조용한 실패(data:,)는 오류', () => {
    const ok = fakeCanvas('data:image/jpeg;base64,QUJD').canvas;
    expect(encodeCaptureCanvas(ok, 'jpeg')).toBe('QUJD');
    expect(ok.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9);
    const png = fakeCanvas('data:image/png;base64,UE5H').canvas;
    expect(encodeCaptureCanvas(png, 'png')).toBe('UE5H');
    expect(png.toDataURL).toHaveBeenCalledWith('image/png', undefined);
    expect(() => encodeCaptureCanvas(fakeCanvas('data:,').canvas, 'jpeg')).toThrow();
    // JPEG 를 요청했는데 PNG 가 돌아오면(미지원) 확장자가 어긋나므로 실패
    expect(() => encodeCaptureCanvas(fakeCanvas('data:image/png;base64,UE5H').canvas, 'jpeg')).toThrow();
  });
});
