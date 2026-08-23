jest.mock('../index', () => ({
  backend: {},
  isMobile: false,
  promptService: {},
  globalPieceService: {},
}));

import {
  expandInlineRandom,
  lowerPromptNode,
  toPARR,
} from '../PromptService';

describe('inline random prompt syntax', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('selects one pipe-delimited option inside braces', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(expandInlineRandom('{jeans|black pants}')).toBe('black pants');
  });

  it('supports nested alternatives', () => {
    jest
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0);
    expect(expandInlineRandom('{a|{b|c}}')).toBe('b');
  });

  it('preserves ordinary NovelAI emphasis braces', () => {
    expect(expandInlineRandom('{artist:foo}')).toBe('{artist:foo}');
    expect(lowerPromptNode({ type: 'text', text: '{best quality}' })).toBe(
      '{best quality}',
    );
  });
});

describe('prompt line endings', () => {
  it('normalizes CRLF, CR, and LF line breaks', () => {
    expect(toPARR('one\r\ntwo\rthree\nfour')).toEqual([
      'one',
      'two',
      'three',
      'four',
    ]);
  });
});
