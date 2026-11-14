import { fireEvent, render, waitFor } from '@testing-library/react';
import PromptEditTextArea from '../../componenets/PromptEditTextArea';

jest.mock('../index', () => ({
  isMobile: false,
  backend: {},
  artistLibraryService: {},
}));
jest.mock('../AppService', () => ({ appState: {} }));
jest.mock('../sceneFieldUndo', () => ({ holdSceneFieldEdit: jest.fn() }));

beforeEach(() => {
  const createRange = document.createRange.bind(document);
  jest
    .spyOn(document, 'createRange')
    .mockImplementation(() =>
      Object.assign(createRange(), {
        getBoundingClientRect: () => ({ bottom: 0 }),
      }),
    );
});

afterEach(() => {
  window.getSelection()!.removeAllRanges();
  jest.restoreAllMocks();
});

function placeCaret(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

it.each([
  ['Windows CRLF', 'cat\r\ndog', 'cat\ndog'],
  [
    'lone CR and mixed line endings',
    'cat\rdog\r\nbird\nfox',
    'cat\ndog\nbird\nfox',
  ],
  ['LF and intentional blank lines', 'cat\n\ndog', 'cat\n\ndog'],
])(
  'preserves the intended line breaks when pasting %s',
  async (_, text, expected) => {
    const onChange = jest.fn();
    const { container } = render(
      <PromptEditTextArea value="prefix suffix" onChange={onChange} />,
    );
    const editor = container.querySelector('[contenteditable="true"]')!;
    placeCaret(editor.firstChild!.firstChild!, 'prefix '.length);

    fireEvent.paste(editor, { clipboardData: { getData: () => text } });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        'prefix ' + expected + 'suffix',
      );
      expect(editor.textContent).toBe('prefix ' + expected + 'suffix');
      expect(window.getSelection()!.anchorNode?.textContent).toBe(
        expected.split('\n').pop() + 'suffix',
      );
      expect(window.getSelection()!.anchorOffset).toBe(
        expected.split('\n').pop()!.length,
      );
    });
  },
);

it('uses the same line endings for existing prompt text and caret offsets', async () => {
  const onChange = jest.fn();
  const { container, rerender } = render(
    <PromptEditTextArea value="first" onChange={onChange} />,
  );
  rerender(<PromptEditTextArea value={'cat\r\ndog'} onChange={onChange} />);
  const editor = container.querySelector('[contenteditable="true"]')!;
  const lastLine = editor.querySelectorAll('.syntax-line')[1];
  placeCaret(lastLine.firstChild!, 1);

  fireEvent.paste(editor, { clipboardData: { getData: () => '!' } });

  await waitFor(() => {
    expect(onChange).toHaveBeenLastCalledWith('cat\nd!og');
    expect(window.getSelection()!.anchorOffset).toBe(2);
  });
});
