// resolveLayout 순수 함수 단위 테스트.
// layoutTemplates.ts 는 외부 import 가 없으므로 별도 mock 없이 직접 import 한다.

import { layoutTemplates, resolveLayout } from '../layoutTemplates';

describe('resolveLayout — 폴백/강제', () => {
  it('미지정(undefined) → classic 폴백', () => {
    const r = resolveLayout(undefined, false);
    expect(r.id).toBe('classic');
    expect(r.bottomBar).toBe('bottom');
    expect(r.sessionSelectTop).toBe(false);
  });
  it("미존재 id('ghost') → classic 폴백", () => {
    const r = resolveLayout('ghost', false);
    expect(r.id).toBe('classic');
    expect(r.bottomBar).toBe('bottom');
    expect(r.sessionSelectTop).toBe(false);
  });
  it('compact + 모바일 → classic 강제(mobileAllowed=false)', () => {
    const r = resolveLayout('compact', true);
    expect(r.id).toBe('classic');
    expect(r.bottomBar).toBe('bottom');
    expect(r.sessionSelectTop).toBe(false);
  });
  it('compact + PC → bottomBar none + sessionSelectTop true', () => {
    const r = resolveLayout('compact', false);
    expect(r.id).toBe('compact');
    expect(r.bottomBar).toBe('none');
    expect(r.sessionSelectTop).toBe(true);
  });
});

describe('레지스트리 계약', () => {
  it('id 중복이 없다 (config 저장 키 공용)', () => {
    const ids = layoutTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("'classic' 이 존재하고 mobileAllowed=true", () => {
    const classic = layoutTemplates.find((t) => t.id === 'classic');
    expect(classic).toBeDefined();
    expect(classic?.mobileAllowed).toBe(true);
  });
});
