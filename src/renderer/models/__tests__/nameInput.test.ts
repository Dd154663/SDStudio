// 이름 입력 규칙(2026-10-03 D2) — models/nameInput.ts
const pushed: any[] = [];
let answer: string | undefined;
jest.mock('../appStateRef', () => ({
  getAppState: () => ({
    pushDialogAsync: (dialog: any) => {
      pushed.push(dialog);
      return Promise.resolve(answer);
    },
  }),
}));

import {
  josaEulReul,
  josaIGa,
  NAME_INPUT_TEXT,
  nameErrorMessage,
  projectNameRules,
  promptName,
  splitNameLines,
  suggestFolderCopyName,
  validateName,
  validateNameLines,
} from '../nameInput';

beforeEach(() => {
  pushed.splice(0);
  answer = undefined;
});

describe('validateName', () => {
  test('빈 값·공백만은 거부, 앞뒤 공백은 잘라서 판단', () => {
    expect(validateName('', { kind: 'piece' })).toBe(NAME_INPUT_TEXT.empty);
    expect(validateName('   ', { kind: 'piece' })).toBe(NAME_INPUT_TEXT.empty);
    expect(validateName('  a  ', { kind: 'piece', existing: ['b'] })).toBeNull();
    expect(validateName('  b ', { kind: 'piece', existing: ['b'] })).toBe(
      '같은 이름의 조각이 이미 있습니다: b',
    );
  });

  test('allowEmpty 면 빈 값 통과', () => {
    expect(validateName(' ', { kind: 'pieceGroup', allowEmpty: true })).toBeNull();
  });

  test('중복 — 목록·판정 함수 모두, 위치 설명 덧붙임', () => {
    expect(validateName('a', { kind: 'folder', existing: (n) => n === 'a' })).toBe(
      '같은 이름의 폴더가 이미 있습니다: a',
    );
    expect(
      validateName('p', {
        ...projectNameRules({ list: () => ['p'], getFolderOf: () => '작업' }),
      }),
    ).toBe('같은 이름의 프로젝트가 이미 있습니다: p ("작업" 폴더에 있음)');
  });

  test('current 와 같으면 통과(변경 없음) — 중복·경로 규칙보다 먼저', () => {
    expect(
      validateName(' 기존 ', { kind: 'project', current: '기존', existing: ['기존'] }),
    ).toBeNull();
    // 예전 데이터의 이름(점 시작)도 그대로 두면 통과
    expect(validateName('.old', { kind: 'scene', pathSafe: true, current: '.old' })).toBeNull();
  });

  test('pathSafe — 금지 글자·점 시작·예약 이름·제어 문자', () => {
    const r = { kind: 'scene' as const, pathSafe: true };
    expect(validateName('a/b', r)).toBe(NAME_INPUT_TEXT.badChars('/'));
    expect(validateName('a:b?c:', r)).toBe(NAME_INPUT_TEXT.badChars(': ?'));
    expect(validateName('a\\b', r)).toBe(NAME_INPUT_TEXT.badChars('\\'));
    expect(validateName('.trash', r)).toBe(NAME_INPUT_TEXT.dotStart);
    expect(validateName('..', r)).toBe(NAME_INPUT_TEXT.dotStart);
    expect(validateName('CON', r)).toBe(NAME_INPUT_TEXT.reserved('CON'));
    expect(validateName('lpt1.txt', r)).toBe(NAME_INPUT_TEXT.reserved('lpt1.txt'));
    expect(validateName('a' + String.fromCharCode(9) + 'b', r)).toBe(
      NAME_INPUT_TEXT.badChars('제어 문자'),
    );
    expect(validateName('씬 1.v2 (복사)', r)).toBeNull();
    // pathSafe 가 아니면 글자 제한 없음(메모리형 이름)
    expect(validateName('a/b:c', { kind: 'piece' })).toBeNull();
  });

  test('allowSlash — 폴더 경로는 단계마다 검사', () => {
    const r = { kind: 'folder' as const, pathSafe: true, allowSlash: true };
    expect(validateName('상위/하위', r)).toBeNull();
    expect(validateName('상위//하위', r)).toBe(NAME_INPUT_TEXT.emptySegment);
    expect(validateName('상위/.숨김', r)).toBe(NAME_INPUT_TEXT.dotStart);
    expect(validateName('상위/a:b', r)).toBe(NAME_INPUT_TEXT.badChars(':'));
  });

  test('길이 상한(maxLength)', () => {
    expect(validateName('a'.repeat(41), { kind: 'token', maxLength: 40 })).toBe(
      NAME_INPUT_TEXT.tooLong(40),
    );
    expect(validateName('a'.repeat(40), { kind: 'token', maxLength: 40 })).toBeNull();
  });
});

describe('조사·문구', () => {
  test('이/가 — 받침 유무, 한글이 아니면 이(가)', () => {
    expect(josaIGa('프로젝트')).toBe('가');
    expect(josaIGa('씬')).toBe('이');
    expect(josaIGa('조각그룹')).toBe('이');
    expect(josaIGa('작가')).toBe('가');
    expect(josaIGa('ABC')).toBe('이(가)');
    // 을/를(삭제 확인 문구 — deleteFlowRules)
    expect(josaEulReul('프로젝트')).toBe('를');
    expect(josaEulReul('씬')).toBe('을');
    expect(josaEulReul('장')).toBe('을');
    expect(josaEulReul('개')).toBe('를');
    expect(josaEulReul('ABC')).toBe('을(를)');
    expect(josaEulReul('')).toBe('을(를)');
    expect(NAME_INPUT_TEXT.duplicate('scene')).toBe('같은 이름의 씬이 이미 있습니다.');
    expect(NAME_INPUT_TEXT.duplicate('template', 't')).toBe(
      '같은 이름의 템플릿이 이미 있습니다: t',
    );
  });
});

describe('validateNameLines(여러 줄)', () => {
  const r = { kind: 'scene' as const, pathSafe: true, existing: ['있음'] };
  test('빈 줄 무시·이름이 없으면 빈 값 문구', () => {
    expect(validateNameLines('\n  \n', r)).toBe(NAME_INPUT_TEXT.empty);
    expect(validateNameLines('a\n\n b \n', r)).toBeNull();
    expect(splitNameLines('a\n\n b \n')).toEqual(['a', 'b']);
  });
  test('줄 번호와 사유, 입력 안 중복', () => {
    expect(validateNameLines('a\n있음', r)).toBe(
      NAME_INPUT_TEXT.line(2, '같은 이름의 씬이 이미 있습니다: 있음'),
    );
    expect(validateNameLines('a\nx/y', r)).toBe(NAME_INPUT_TEXT.line(2, NAME_INPUT_TEXT.badChars('/')));
    expect(validateNameLines('a\n b\na', r)).toBe(NAME_INPUT_TEXT.repeated('a'));
    // 한 줄이면 줄 번호 없이
    expect(validateNameLines('.a', r)).toBe(NAME_INPUT_TEXT.dotStart);
  });
});

describe('nameErrorMessage(서비스 오류 매핑)', () => {
  test('영문 내부 오류는 한국어로, 그 밖은 원래 문구·fallback', () => {
    expect(nameErrorMessage(new Error('Resource already exists'), 'project', 'p')).toBe(
      '같은 이름의 프로젝트가 이미 있습니다: p',
    );
    expect(nameErrorMessage(new Error('Resource not found'), 'project')).toBe(
      NAME_INPUT_TEXT.notFound,
    );
    expect(nameErrorMessage(new Error('이미 존재하는 폴더입니다.'), 'folder')).toBe(
      '이미 존재하는 폴더입니다.',
    );
    expect(nameErrorMessage({}, 'folder', 'f', '실패')).toBe('실패');
    expect(nameErrorMessage('Resource already exists', 'scene')).toBe(
      '같은 이름의 씬이 이미 있습니다.',
    );
  });
});

describe('suggestFolderCopyName', () => {
  test('복사본 → 복사본 (2)…', () => {
    expect(suggestFolderCopyName('A', () => false)).toBe('A 복사본');
    const taken = new Set(['A 복사본', 'A 복사본 (2)']);
    expect(suggestFolderCopyName('A', (n) => taken.has(n))).toBe('A 복사본 (3)');
  });
});

describe('promptName', () => {
  test('input-confirm 창에 제목·현재 이름을 채우고 validate 를 단다, 결과는 trim', async () => {
    answer = '  새 이름 ';
    const v = await promptName({ title: '이름', kind: 'piece', current: '옛 이름' });
    expect(v).toBe('새 이름');
    expect(pushed[0].type).toBe('input-confirm');
    expect(pushed[0].text).toBe('이름');
    expect(pushed[0].inputValue).toBe('옛 이름');
    expect(typeof pushed[0].validate).toBe('function');
  });

  test('initial 이 있으면 그 값을 채운다(복제 제안값)', async () => {
    answer = 'x';
    await promptName({ title: 't', kind: 'folder', initial: '제안', current: '원본' });
    expect(pushed[0].inputValue).toBe('제안');
  });

  test('취소 = undefined, 변경 없음 = undefined, allowEmpty 빈 값 = ""', async () => {
    answer = undefined;
    expect(await promptName({ title: 't', kind: 'piece' })).toBeUndefined();
    answer = ' 그대로 ';
    expect(await promptName({ title: 't', kind: 'piece', current: '그대로' })).toBeUndefined();
    answer = '  ';
    expect(await promptName({ title: 't', kind: 'pieceGroup', allowEmpty: true })).toBe('');
  });

  test('validate — 공통 규칙 먼저, 통과하면 추가 검사(trim 값)', async () => {
    answer = 'ok';
    const extra = jest.fn((n: string) => (n === '금지' ? '추가 규칙 위반' : null));
    await promptName({
      title: 't',
      kind: 'scene',
      pathSafe: true,
      current: '현재',
      existing: ['있음'],
      validate: extra,
    });
    const validate = pushed[0].validate as (v: string) => Promise<string | null>;
    expect(await validate('')).toBe(NAME_INPUT_TEXT.empty);
    expect(await validate('a/b')).toBe(NAME_INPUT_TEXT.badChars('/'));
    expect(await validate('있음')).toBe('같은 이름의 씬이 이미 있습니다: 있음');
    expect(await validate(' 현재 ')).toBeNull();
    expect(await validate(' 금지 ')).toBe('추가 규칙 위반');
    expect(extra).toHaveBeenLastCalledWith('금지');
    expect(await validate('좋음')).toBeNull();
    // 현재 이름 그대로는 추가 검사도 건너뛴다
    expect(extra).not.toHaveBeenCalledWith('현재');
  });
});
