// exportPresetUtils 순수 함수 단위 테스트.
// 의존성이 없어 별도 mock 없이 직접 import 한다.

import {
  sanitizeFilenamePart,
  buildPatternPrefix,
  resolveExportTargetFolder,
} from '../exportPresetUtils';

describe('sanitizeFilenamePart', () => {
  it('파일시스템 위험 문자를 치환한다', () => {
    expect(sanitizeFilenamePart('a/b:c*d?')).toBe('a_b_c_d');
  });
  it('공백을 치환문자로 바꾼다', () => {
    expect(sanitizeFilenamePart('hello world')).toBe('hello_world');
  });
  it('앞뒤 점/공백/치환문자를 제거한다', () => {
    expect(sanitizeFilenamePart('  ..name..  ')).toBe('name');
  });
  it('빈 입력/비문자열을 안전하게 처리한다', () => {
    expect(sanitizeFilenamePart('')).toBe('');
    expect(sanitizeFilenamePart(undefined as any)).toBe('');
  });
});

describe('buildPatternPrefix', () => {
  it("'scene'(기본)이면 빈 문자열", () => {
    expect(buildPatternPrefix('scene', 'F', 'P', '.')).toBe('');
    expect(buildPatternPrefix(undefined, 'F', 'P', '.')).toBe('');
  });
  it("'project.scene'은 프로젝트명+구분자", () => {
    expect(buildPatternPrefix('project.scene', 'F', 'Proj', '.')).toBe('Proj.');
  });
  it("'folder.project.scene'은 폴더명.프로젝트명.", () => {
    expect(buildPatternPrefix('folder.project.scene', 'Fold', 'Proj', '.')).toBe(
      'Fold.Proj.',
    );
  });
  it('폴더명이 비면 folder 패턴이라도 폴더 부분을 생략', () => {
    expect(buildPatternPrefix('folder.project.scene', '', 'Proj', '.')).toBe(
      'Proj.',
    );
  });
  it('구분자가 바뀌면 그 구분자를 사용', () => {
    expect(buildPatternPrefix('folder.project.scene', 'Fold', 'Proj', '_')).toBe(
      'Fold_Proj_',
    );
  });
  it('프로젝트/폴더명도 sanitize 한다', () => {
    expect(buildPatternPrefix('project.scene', 'F', 'a/b', '.')).toBe('a_b.');
  });
});

describe('resolveExportTargetFolder', () => {
  it('프리셋·기본 폴더 모두 없으면 null', () => {
    expect(resolveExportTargetFolder({}, null, undefined)).toBeNull();
  });
  it('기본 폴더로 폴백한다', () => {
    expect(resolveExportTargetFolder({}, null, '/base')).toBe('/base');
  });
  it('프리셋 폴더가 기본 폴더보다 우선', () => {
    expect(
      resolveExportTargetFolder({ targetFolder: '/preset' }, null, '/base'),
    ).toBe('/preset');
  });
  it('프로젝트 상대 경로가 켜지면 폴더 하위로', () => {
    expect(
      resolveExportTargetFolder(
        { targetFolder: '/preset', useProjectRelativePath: true },
        '캐릭터/소녀',
        undefined,
      ),
    ).toBe('/preset/캐릭터/소녀');
  });
  it('상대 경로가 켜져도 프로젝트가 폴더에 없으면 그대로', () => {
    expect(
      resolveExportTargetFolder(
        { targetFolder: '/preset', useProjectRelativePath: true },
        null,
        undefined,
      ),
    ).toBe('/preset');
  });
});
