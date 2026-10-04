import { maskCanvasAction } from '../maskCanvasSync';

// 인페인트 편집기 마스크 롤백(2026-10-04): 생성 결과 표시처럼 이미지만 바뀌면 캔버스(최신 붓질)를 유지한다.
describe('maskCanvasAction', () => {
  const scene = {};
  const base = { mask: 'data:image/png;base64,AAA', width: 832, height: 1216, resetKey: scene };

  test('처음에는 다시 그린다', () => {
    expect(maskCanvasAction(undefined, base)).toBe('reload');
  });

  test('마스크·크기·씬이 같으면(이미지만 바뀜 — 생성 결과 표시) 유지', () => {
    expect(maskCanvasAction(base, { ...base })).toBe('keep');
  });

  test('불러온 마스크가 바뀌면 다시 그린다', () => {
    expect(maskCanvasAction(base, { ...base, mask: 'data:image/png;base64,BBB' })).toBe('reload');
    expect(maskCanvasAction(base, { ...base, mask: undefined })).toBe('reload');
  });

  test('캔버스 크기가 바뀌면 다시 그린다', () => {
    expect(maskCanvasAction(base, { ...base, width: 1024 })).toBe('reload');
    expect(maskCanvasAction(base, { ...base, height: 1024 })).toBe('reload');
  });

  test('씬이 바뀌면 마스크가 둘 다 비어 있어도 다시 그린다(이전 씬 붓질 제거)', () => {
    const empty = { ...base, mask: undefined };
    expect(maskCanvasAction(empty, { ...empty, resetKey: {} })).toBe('reload');
  });

  test('생성 흐름: 결과 표시 → 원본 다시 읽기를 거쳐도 유지', () => {
    // 열 때 마스크로 한 번 그린 뒤, 붓질은 캔버스에만 있고 mask 값은 그대로다.
    let applied = base;
    for (let i = 0; i < 3; i++) {
      const next = { ...base };
      expect(maskCanvasAction(applied, next)).toBe('keep');
      applied = next;
    }
  });
});
