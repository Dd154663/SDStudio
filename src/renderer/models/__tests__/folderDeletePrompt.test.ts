import { isInFolderTree, planFolderDeletePrompt } from '../folderDeleteFlow';

// 폴더 삭제 확인 창(2026-10-02 S5): 드로어·브라우저 공용. 개수는 실제 삭제 대상과 같은 기준(하위 포함).
// 예전 드로어는 직속만 세어, 하위에만 프로젝트가 있으면 단순 확인 뒤 조용히 미분류로 옮겼다.
const folderMap: Record<string, string | null> = {
  direct1: 'A',
  direct2: 'A',
  sub1: 'B/child',
  sub2: 'B/child/deep',
  mixedDirect: 'C',
  mixedSub: 'C/child',
  sibling: 'AB', // 'A' 의 하위가 아니다(접두 일치 함정)
  unfiled: null,
};
// SessionService.getProjectsInFolder 와 같은 규칙
const inTree = (folder: string) =>
  Object.keys(folderMap).filter((n) => isInFolderTree(folderMap[n], folder));

describe('isInFolderTree', () => {
  test('직속·하위는 포함, 접두만 같은 형제·미분류는 제외', () => {
    expect(isInFolderTree('A', 'A')).toBe(true);
    expect(isInFolderTree('A/x', 'A')).toBe(true);
    expect(isInFolderTree('A/x/y', 'A')).toBe(true);
    expect(isInFolderTree('AB', 'A')).toBe(false);
    expect(isInFolderTree(null, 'A')).toBe(false);
    expect(isInFolderTree(undefined, 'A')).toBe(false);
  });
});

describe('planFolderDeletePrompt', () => {
  test('직속만 있는 폴더 → 선택 창, 개수=직속', () => {
    const p = planFolderDeletePrompt('A', inTree('A'));
    expect(p.kind).toBe('choose');
    if (p.kind !== 'choose') return;
    expect(p.count).toBe(2);
    expect(p.text).toBe('폴더 "A" 삭제 (그 안의 프로젝트 2개, 하위 폴더 포함)');
  });

  test('하위 폴더에만 프로젝트 → 단순 확인이 아니라 선택 창(조용한 미분류 이동 금지)', () => {
    const p = planFolderDeletePrompt('B', inTree('B'));
    expect(p.kind).toBe('choose');
    if (p.kind !== 'choose') return;
    expect(p.count).toBe(2);
    expect(p.folderOnlyText).toBe('폴더만 삭제 (프로젝트는 미분류로 이동)');
    expect(p.withProjectsText).toBe('⚠️ 폴더와 프로젝트 모두 삭제');
    expect(p.confirmWithProjectsText).toContain('그 안의 프로젝트 2개(하위 폴더 포함)');
  });

  test('직속+하위 → 합계', () => {
    const p = planFolderDeletePrompt('C', inTree('C'));
    expect(p.kind === 'choose' && p.count).toBe(2);
  });

  test('빈 폴더 → 단순 확인', () => {
    const p = planFolderDeletePrompt('빈', inTree('빈'));
    expect(p).toEqual({ kind: 'empty', text: '폴더 "빈"를 삭제할까요?' });
  });
});

describe('A12(2026-11-04) — 「폴더만 삭제」 문구에 프로젝트가 갈 곳', () => {
  test('서브폴더 → 상위 폴더 이름', () => {
    const p = planFolderDeletePrompt('child', inTree('B/child'), 'B');
    expect(p.kind === 'choose' && p.folderOnlyText).toBe(
      '폴더만 삭제 (프로젝트는 상위 폴더 "B"로 이동)',
    );
  });
  test('루트 폴더(상위 null) → 미분류', () => {
    const p = planFolderDeletePrompt('B', inTree('B'), null);
    expect(p.kind === 'choose' && p.folderOnlyText).toBe(
      '폴더만 삭제 (프로젝트는 미분류로 이동)',
    );
  });
  test('그 외 문구(모두 삭제·확인)는 상위 폴더와 무관하게 불변', () => {
    const a = planFolderDeletePrompt('child', inTree('B/child'), 'B');
    const b = planFolderDeletePrompt('child', inTree('B/child'), null);
    if (a.kind !== 'choose' || b.kind !== 'choose') throw new Error('choose 기대');
    expect(a.withProjectsText).toBe(b.withProjectsText);
    expect(a.confirmWithProjectsText).toBe(b.confirmWithProjectsText);
    expect(a.text).toBe(b.text);
  });
});
