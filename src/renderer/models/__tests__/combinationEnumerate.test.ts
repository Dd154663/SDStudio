/**
 * 조합 에디터 미리보기용 enumerateCombinations 파리티 가드.
 *
 * 미리보기가 실제 생성(createSDPrompts → dfsPrompts, collectFn = piece?.prompt)과
 * 어긋나지 않도록, 조합 열거 규칙을 고정한다:
 *  - 각 열에서 활성 조각 하나씩 고르는 데카르트 곱(∏ 활성 수).
 *  - enabled === false 제외.
 *  - 어떤 열에 활성 조각이 0개면 전체 0종.
 *  - 세그먼트 순서 = 열 순서.
 * 무거운 index.ts(전 서비스 배선)는 mock 으로 우회한다.
 */

jest.mock('../index', () => ({
  backend: {},
  isMobile: false,
  promptService: {},
  globalPieceService: {},
}));

import {
  enumerateCombinations,
  combinationMiddlePrompt,
  combinationCount,
} from '../PromptService';
import { PromptPiece, Scene } from '../types';

let idc = 0;
function piece(prompt: string, enabled?: boolean): PromptPiece {
  return PromptPiece.fromJSON({
    prompt,
    characterPrompts: [],
    id: 'p' + idc++,
    enabled,
  } as any);
}
// enumerateCombinations 는 scene.slots 만 참조하므로 최소 객체로 충분.
function scene(slots: PromptPiece[][]): Scene {
  return { slots } as any as Scene;
}

describe('enumerateCombinations — 데카르트 곱 규칙', () => {
  it('단일 열 2조각 → 2종, 열 순서 유지', () => {
    const combos = enumerateCombinations(scene([[piece('a'), piece('b')]]));
    expect(combos.length).toBe(2);
    expect(combos.map((c) => combinationMiddlePrompt(c))).toEqual(['a', 'b']);
    expect(combos[0][0].columnIndex).toBe(0);
  });

  it('2열(2행×3행) → 6종(데카르트 곱)', () => {
    const combos = enumerateCombinations(
      scene([
        [piece('a'), piece('b')],
        [piece('x'), piece('y'), piece('z')],
      ]),
    );
    expect(combos.length).toBe(6);
    expect(combos.map((c) => combinationMiddlePrompt(c))).toEqual([
      'a, x',
      'a, y',
      'a, z',
      'b, x',
      'b, y',
      'b, z',
    ]);
    // 세그먼트 columnIndex = 열 순서.
    expect(combos[0].map((s) => s.columnIndex)).toEqual([0, 1]);
  });

  it('enabled===false 조각은 제외', () => {
    const combos = enumerateCombinations(
      scene([[piece('a'), piece('b', false), piece('c')]]),
    );
    expect(combos.map((c) => combinationMiddlePrompt(c))).toEqual(['a', 'c']);
  });

  it('enabled===undefined 는 활성으로 취급(기존 데이터 하위호환)', () => {
    const combos = enumerateCombinations(scene([[piece('a')]]));
    expect(combos.length).toBe(1);
  });

  it('한 열의 모든 조각이 비활성이면 전체 0종(생성 경로 일치)', () => {
    const combos = enumerateCombinations(
      scene([
        [piece('a')],
        [piece('x', false), piece('y', false)],
      ]),
    );
    expect(combos.length).toBe(0);
  });

  it('slots 가 비어 있으면 빈 조합 1종(생성 경로 일치)', () => {
    const combos = enumerateCombinations(scene([]));
    expect(combos.length).toBe(1);
    expect(combinationMiddlePrompt(combos[0])).toBe('');
  });
});

describe('enumerateCombinations limit — 상한 조기 중단', () => {
  it('limit 지정 시 그 수만큼만 반환', () => {
    const combos = enumerateCombinations(
      scene([
        [piece('a'), piece('b')],
        [piece('x'), piece('y'), piece('z')],
      ]),
      4,
    );
    expect(combos.length).toBe(4);
    expect(combos.map((c) => combinationMiddlePrompt(c))).toEqual([
      'a, x',
      'a, y',
      'a, z',
      'b, x',
    ]);
  });
});

describe('combinationCount — 저비용 개수(enumerate 없이)', () => {
  it('∏ 활성 수', () => {
    expect(
      combinationCount(
        scene([
          [piece('a'), piece('b')],
          [piece('x'), piece('y'), piece('z')],
        ]),
      ),
    ).toBe(6);
  });
  it('비활성 제외 반영', () => {
    expect(
      combinationCount(scene([[piece('a'), piece('b', false), piece('c')]])),
    ).toBe(2);
  });
  it('활성 0인 열 있으면 0', () => {
    expect(
      combinationCount(scene([[piece('a')], [piece('x', false)]])),
    ).toBe(0);
  });
  it('slots 비면 1', () => {
    expect(combinationCount(scene([]))).toBe(1);
  });
  it('enumerateCombinations 길이와 일치(파리티)', () => {
    const s = scene([
      [piece('a'), piece('b'), piece('c')],
      [piece('x'), piece('y')],
    ]);
    expect(combinationCount(s)).toBe(enumerateCombinations(s).length);
  });
});

describe('combinationMiddlePrompt — 빈 조각 제외 후 조인', () => {
  it('빈 prompt 는 제외하고 ", " 로 조인', () => {
    const combos = enumerateCombinations(
      scene([[piece('a')], [piece('')], [piece('c')]]),
    );
    expect(combos.length).toBe(1);
    expect(combinationMiddlePrompt(combos[0])).toBe('a, c');
  });
});
