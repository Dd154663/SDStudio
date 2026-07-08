/**
 * storageLayout — 신 배치(workspace/, storage v2) 런타임 상태·레지스트리·명명 규칙
 * (트랙1 (b) B2, 스펙 §2). 물리 폴더명 정제 규칙과 이름→폴더 레지스트리 계약을 고정한다.
 */
import {
  makeWorkspaceDirName,
  isWorkspaceLayout,
  setWorkspaceLayoutActive,
  registerProjectDir,
  unregisterProjectDir,
  renameProjectDirKey,
  physicalDirOf,
  nameOfPhysicalDir,
} from '../storageLayout';

const ID = 'ab12cd34-0000-4000-8000-000000000000';
const SHORT = 'ab12cd34'; // 하이픈 제거 앞 8자

describe('makeWorkspaceDirName — 정제이름__짧은id (§2-2)', () => {
  it('정상 이름은 그대로 + __shortId', () => {
    expect(makeWorkspaceDirName('내 프로젝트', ID)).toBe('내 프로젝트__' + SHORT);
    expect(makeWorkspaceDirName('foo.bar', ID)).toBe('foo.bar__' + SHORT);
  });

  it('shortId = uuid 하이픈 제거 앞 8자', () => {
    const dir = makeWorkspaceDirName('p', ID);
    expect(dir.endsWith('__' + SHORT)).toBe(true);
  });

  it('Windows 금지문자·제어문자를 제거한다', () => {
    expect(makeWorkspaceDirName('a<b>c:d"e/f\\g|h?i*j', ID)).toBe('abcdefghij__' + SHORT);
    expect(makeWorkspaceDirName('abc', ID)).toBe('abc__' + SHORT);
  });

  it('연속 공백은 1개로, 앞뒤 공백·점은 제거', () => {
    expect(makeWorkspaceDirName('  a   b  ', ID)).toBe('a b__' + SHORT);
    expect(makeWorkspaceDirName('...name...', ID)).toBe('name__' + SHORT);
  });

  it('40자 초과는 절단(접미 id 는 별도)', () => {
    const long = 'x'.repeat(80);
    const dir = makeWorkspaceDirName(long, ID);
    const base = dir.slice(0, dir.length - ('__' + SHORT).length);
    expect(base.length).toBe(40);
    expect(base).toBe('x'.repeat(40));
  });

  it('정제 결과가 비면 "project" 폴백', () => {
    expect(makeWorkspaceDirName('', ID)).toBe('project__' + SHORT);
    expect(makeWorkspaceDirName('///', ID)).toBe('project__' + SHORT);
    expect(makeWorkspaceDirName('   ', ID)).toBe('project__' + SHORT);
  });

  it('id 가 비면 noid 폴백', () => {
    expect(makeWorkspaceDirName('p', '')).toBe('p__noid');
  });
});

describe('레지스트리 — 이름→물리폴더 + 역조회 (§5)', () => {
  afterEach(() => setWorkspaceLayoutActive(false));

  it('등록/조회/역조회', () => {
    registerProjectDir('내 프로젝트', '내 프로젝트__ab12cd34');
    expect(physicalDirOf('내 프로젝트')).toBe('내 프로젝트__ab12cd34');
    expect(nameOfPhysicalDir('내 프로젝트__ab12cd34')).toBe('내 프로젝트');
    expect(physicalDirOf('없음')).toBeUndefined();
    expect(nameOfPhysicalDir('없음__x')).toBeUndefined();
  });

  it('이름변경은 물리 폴더를 유지한 채 키만 이관', () => {
    registerProjectDir('구이름', '구이름__ab12cd34');
    renameProjectDirKey('구이름', '새이름');
    expect(physicalDirOf('구이름')).toBeUndefined();
    expect(physicalDirOf('새이름')).toBe('구이름__ab12cd34'); // 폴더명 불변
  });

  it('unregister 후 조회 불가', () => {
    registerProjectDir('삭제대상', '삭제대상__ab12cd34');
    unregisterProjectDir('삭제대상');
    expect(physicalDirOf('삭제대상')).toBeUndefined();
  });

  it('setWorkspaceLayoutActive(false) 는 활성 플래그 해제 + 레지스트리 clear', () => {
    setWorkspaceLayoutActive(true);
    registerProjectDir('p', 'p__ab12cd34');
    expect(isWorkspaceLayout()).toBe(true);
    setWorkspaceLayoutActive(false);
    expect(isWorkspaceLayout()).toBe(false);
    expect(physicalDirOf('p')).toBeUndefined(); // clear 됨
  });
});
