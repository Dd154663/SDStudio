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

describe('슬롯 개인화 — 회귀 가드(기존 필드 불변 + 새 필드 기본값)', () => {
  // slots 미지정/undefined/빈객체에서 기존 필드는 이전과 100% 동일해야 하고,
  // 새 필드는 템플릿 기본값(classic: right/left/docked, compact: right/left/floating).
  it('classic + slots 미지정 → 기존 필드 불변 + 기본 슬롯(right/left/docked)', () => {
    const r = resolveLayout('classic', false);
    expect(r.id).toBe('classic');
    expect(r.bottomBar).toBe('bottom');
    expect(r.sessionSelectTop).toBe(false);
    expect(r.historySide).toBe('right');
    expect(r.presetSide).toBe('left');
    expect(r.genControl).toBe('docked');
  });
  it('classic + slots undefined → 기본 슬롯', () => {
    const r = resolveLayout('classic', false, undefined);
    expect(r.historySide).toBe('right');
    expect(r.presetSide).toBe('left');
    expect(r.genControl).toBe('docked');
  });
  it('classic + slots 빈객체 → 기본 슬롯', () => {
    const r = resolveLayout('classic', false, {});
    expect(r.historySide).toBe('right');
    expect(r.presetSide).toBe('left');
    expect(r.genControl).toBe('docked');
  });
  it('compact + PC + slots 미지정 → 기존 필드 불변 + 기본 슬롯(right/left/floating)', () => {
    const r = resolveLayout('compact', false);
    expect(r.id).toBe('compact');
    expect(r.bottomBar).toBe('none');
    expect(r.sessionSelectTop).toBe(true);
    expect(r.historySide).toBe('right');
    expect(r.presetSide).toBe('left');
    expect(r.genControl).toBe('floating');
  });
});

describe('슬롯 개인화 — 오버라이드 반영(PC)', () => {
  it('historySide=left 단독', () => {
    const r = resolveLayout('classic', false, { historySide: 'left' });
    expect(r.historySide).toBe('left');
    expect(r.presetSide).toBe('left'); // 미지정은 기본 유지
    expect(r.genControl).toBe('docked');
  });
  it('presetSide=right 단독', () => {
    const r = resolveLayout('classic', false, { presetSide: 'right' });
    expect(r.presetSide).toBe('right');
    expect(r.historySide).toBe('right');
    expect(r.genControl).toBe('docked');
  });
  it('genControl=floating 단독', () => {
    const r = resolveLayout('classic', false, { genControl: 'floating' });
    expect(r.genControl).toBe('floating');
    expect(r.historySide).toBe('right');
    expect(r.presetSide).toBe('left');
  });
  it('세 필드 조합 오버라이드', () => {
    const r = resolveLayout('classic', false, {
      historySide: 'left',
      presetSide: 'right',
      genControl: 'floating',
    });
    expect(r.historySide).toBe('left');
    expect(r.presetSide).toBe('right');
    expect(r.genControl).toBe('floating');
    // 기존 필드는 여전히 classic 값
    expect(r.id).toBe('classic');
    expect(r.bottomBar).toBe('bottom');
  });
});

describe('슬롯 개인화 — 모바일 무시', () => {
  it('classic + 모바일 + slots → slots 전부 무시(기본 슬롯 강제)', () => {
    const r = resolveLayout('classic', true, {
      historySide: 'left',
      presetSide: 'right',
      genControl: 'floating',
    });
    expect(r.id).toBe('classic');
    expect(r.bottomBar).toBe('bottom');
    expect(r.historySide).toBe('right');
    expect(r.presetSide).toBe('left');
    expect(r.genControl).toBe('docked');
  });
});

describe('슬롯 개인화 — stale 안전', () => {
  it('잘못된 slot 값(타입 밖 문자열)은 기본값으로', () => {
    const r = resolveLayout('classic', false, {
      historySide: 'top' as any,
      presetSide: 'bottom' as any,
      genControl: 'hidden' as any,
    });
    expect(r.historySide).toBe('right');
    expect(r.presetSide).toBe('left');
    expect(r.genControl).toBe('docked');
  });
  it("미존재 id('ghost') + slots → classic 폴백 위에 slots 적용", () => {
    const r = resolveLayout('ghost', false, {
      historySide: 'left',
      genControl: 'floating',
    });
    expect(r.id).toBe('classic');
    expect(r.bottomBar).toBe('bottom');
    expect(r.historySide).toBe('left');
    expect(r.presetSide).toBe('left'); // 미지정 기본
    expect(r.genControl).toBe('floating');
  });
});
