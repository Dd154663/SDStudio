import { isSameOrInside, resolveInstallDir } from '../installDirGuard';

// 저장 경로 설치 폴더 금지(2026-10-06) — 포함 판정 순수 함수 회귀 테스트.
describe('isSameOrInside (win32)', () => {
  const inside = (child: string, parent: string) =>
    isSameOrInside(child, parent, 'win32');
  const installDir = 'C:\\Users\\me\\AppData\\Local\\Programs\\SDStudio';

  test('같은 경로는 포함으로 본다', () => {
    expect(inside(installDir, installDir)).toBe(true);
    expect(inside(installDir + '\\', installDir)).toBe(true);
  });

  test('하위 폴더는 포함이다', () => {
    expect(inside(installDir + '\\data', installDir)).toBe(true);
    expect(inside(installDir + '\\a\\b\\c', installDir)).toBe(true);
    expect(inside(installDir + '\\..data', installDir)).toBe(true);
  });

  test('형제·접두만 같은 폴더는 포함이 아니다', () => {
    expect(inside('C:\\Users\\me\\AppData\\Local\\Programs\\SDStudio2', installDir)).toBe(false);
    expect(inside('C:\\Users\\me\\AppData\\Local\\Programs\\Other', installDir)).toBe(false);
  });

  test('상위 폴더는 포함이 아니다', () => {
    expect(inside('C:\\Users\\me\\AppData\\Local\\Programs', installDir)).toBe(false);
    expect(inside('C:\\', installDir)).toBe(false);
  });

  test('대소문자를 무시한다', () => {
    expect(inside('c:\\users\\ME\\appdata\\local\\programs\\sdstudio\\Work', installDir)).toBe(true);
  });

  test('구분자 혼용과 상대 세그먼트를 정규화한다', () => {
    expect(inside('C:/Users/me/AppData/Local/Programs/SDStudio/work', installDir)).toBe(true);
    expect(inside('C:/Users/me/AppData/Local/Programs/SDStudio/work/../..', installDir)).toBe(false);
    expect(inside('C:\\Users\\me\\AppData\\Local\\Programs\\Other\\..\\SDStudio\\x', installDir)).toBe(true);
  });

  test('다른 드라이브는 포함이 아니다', () => {
    expect(inside('D:\\Users\\me\\AppData\\Local\\Programs\\SDStudio', installDir)).toBe(false);
  });

  test('빈 경로는 판정하지 않는다', () => {
    expect(inside('', installDir)).toBe(false);
    expect(inside(installDir, '')).toBe(false);
  });
});

describe('isSameOrInside (posix)', () => {
  const inside = (child: string, parent: string) =>
    isSameOrInside(child, parent, 'linux');

  test('같은 경로·하위는 포함, 형제·상위는 아니다', () => {
    expect(inside('/opt/SDStudio', '/opt/SDStudio')).toBe(true);
    expect(inside('/opt/SDStudio/data', '/opt/SDStudio')).toBe(true);
    expect(inside('/opt/SDStudio2', '/opt/SDStudio')).toBe(false);
    expect(inside('/opt', '/opt/SDStudio')).toBe(false);
  });

  test('win32 외에는 대소문자를 구분한다', () => {
    expect(inside('/opt/sdstudio/data', '/opt/SDStudio')).toBe(false);
  });
});

describe('resolveInstallDir', () => {
  test('패키징된 앱은 실행 파일 폴더', () => {
    expect(
      resolveInstallDir(true, 'C:\\Program Files\\SDStudio\\SDStudio.exe', 'win32'),
    ).toBe('C:\\Program Files\\SDStudio');
  });

  test('개발 실행은 null', () => {
    expect(resolveInstallDir(false, 'C:\\repo\\node_modules\\electron\\dist\\electron.exe', 'win32')).toBeNull();
  });
});
