/**
 * CombinationList SSR 렌더 가드.
 *
 * 구 미리보기의 "아무것도 안 나옴" 런타임 버그(클래스/조건 실수)를 기계적으로 차단한다.
 * renderToStaticMarkup 으로 실제 DOM 문자열을 만들어 핵심 표시가 포함되는지 단언:
 *  - 총 개수 헤더("총 N종")
 *  - 간략 라벨(기본명 "열-행" + 지정 이름)
 *  - 자세히 모드의 실제 프롬프트 문자열
 *  - 0종(활성 없는 열) 경고 문구
 *
 * CombinationList → PromptService → models/index(전 서비스 배선)를 끌어오므로
 * combinationEnumerate.test.ts 와 동일하게 '../index' 를 mock 으로 우회한다.
 */

jest.mock('../index', () => ({
  backend: {},
  isMobile: false,
  promptService: {},
  globalPieceService: {},
}));

import { CombinationList } from '../../componenets/CombinationList';
import { PromptPiece, PromptPieceSlot } from '../types';

// jsdom 환경엔 TextEncoder/TextDecoder 가 없어 react-dom/server(browser 빌드)가
// 로드 시 참조 에러를 낸다. 폴리필을 먼저 심고 서버 렌더러를 지연 로드한다.
let renderToStaticMarkup: (node: any) => string;
beforeAll(() => {
  const util = require('util');
  (global as any).TextEncoder = (global as any).TextEncoder || util.TextEncoder;
  (global as any).TextDecoder = (global as any).TextDecoder || util.TextDecoder;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

let idc = 0;
function piece(
  prompt: string,
  opts?: { enabled?: boolean; name?: string },
): PromptPiece {
  return PromptPiece.fromJSON({
    prompt,
    characterPrompts: [],
    id: 'p' + idc++,
    enabled: opts?.enabled,
    ...(opts?.name ? { name: opts.name } : {}),
  } as any);
}

function scene(slots: PromptPieceSlot[]) {
  return { slots };
}

describe('CombinationList 렌더', () => {
  // 2열 × 2조각 = 4종. col1 row0 에만 이름 지정.
  const mock = scene([
    [piece('red'), piece('blue')],
    [piece('cat', { name: '고양이' }), piece('dog')],
  ]);

  it('간략 모드 — 총 개수·기본명·지정 이름 포함', () => {
    const html = renderToStaticMarkup(
      <CombinationList scene={mock} detailed={false} />,
    );
    expect(html).toContain('총 4종');
    // 기본명(열-행)과 지정 이름
    expect(html).toContain('1-1');
    expect(html).toContain('1-2');
    expect(html).toContain('2-2');
    expect(html).toContain('고양이');
  });

  it('자세히 모드 — 실제 조합 프롬프트 문자열 포함', () => {
    const html = renderToStaticMarkup(
      <CombinationList scene={mock} detailed={true} />,
    );
    expect(html).toContain('총 4종');
    expect(html).toContain('red');
    expect(html).toContain('blue');
    expect(html).toContain('cat');
    expect(html).toContain('dog');
  });

  it('0종(활성 없는 열) — 경고 문구 표시', () => {
    const empty = scene([
      [piece('a')],
      [piece('x', { enabled: false }), piece('y', { enabled: false })],
    ]);
    const html = renderToStaticMarkup(
      <CombinationList scene={empty} detailed={false} />,
    );
    expect(html).toContain('활성 조각이 없는 열이 있어 생성되지 않습니다');
    expect(html).not.toContain('총 ');
  });
});
