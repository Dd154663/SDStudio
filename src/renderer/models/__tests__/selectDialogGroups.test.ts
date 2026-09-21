/** @jest-environment jsdom */
import {
  groupPreview,
  loadOpenGroups,
  saveOpenGroups,
  sectionsOf,
} from '../selectDialogGroups';

describe('sectionsOf', () => {
  it('같은 group 끼리 첫 등장 순서대로 묶고, group 없는 항목은 제자리에 낱개로 둔다', () => {
    const secs = sectionsOf([
      { text: 'a', value: 'a', group: 'G1' },
      { text: 'x', value: 'x' },
      { text: 'b', value: 'b', group: 'G2' },
      { text: 'c', value: 'c', group: 'G1' },
    ]);
    expect(secs.map((s) => (s.kind === 'group' ? s.name + ':' + s.items.map((i) => i.value).join('') : s.item.value))).toEqual([
      'G1:ac',
      'x',
      'G2:b',
    ]);
  });
  it('group 이 하나도 없으면 기존과 같은 낱개 목록이다', () => {
    const secs = sectionsOf([{ text: 'a', value: 'a' }, { text: 'b', value: 'b' }]);
    expect(secs.every((s) => s.kind === 'item')).toBe(true);
  });
});

describe('펼침 상태 저장', () => {
  beforeEach(() => localStorage.clear());
  it('저장값이 없으면 전부 접힘', () => {
    expect(loadOpenGroups('k').size).toBe(0);
  });
  it('저장한 상태를 다시 읽는다(키별로 분리)', () => {
    saveOpenGroups('k', new Set(['이미지', '씬']));
    expect([...loadOpenGroups('k')].sort()).toEqual(['씬', '이미지']);
    expect(loadOpenGroups('other').size).toBe(0);
  });
  it('깨진 저장값은 전부 접힘으로 읽는다', () => {
    localStorage.setItem('selectDialogFold:k', '{not json');
    expect(loadOpenGroups('k').size).toBe(0);
    localStorage.setItem('selectDialogFold:k', '{"a":1}');
    expect(loadOpenGroups('k').size).toBe(0);
  });
});

describe('groupPreview', () => {
  it('앞의 이모지를 떼고 가운뎃점으로 잇는다', () => {
    expect(groupPreview([
      { text: '📁 이미지 내보내기', value: 'a' },
      { text: '🗑️ 이미지 삭제', value: 'b' },
    ])).toBe('이미지 내보내기 · 이미지 삭제');
  });
});
