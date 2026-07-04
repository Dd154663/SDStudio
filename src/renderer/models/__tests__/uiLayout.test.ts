// resolveToolbar 순수 함수 단위 테스트.
// uiLayout.ts 는 config 타입만 import 하므로 별도 mock 없이 직접 import 한다.

import {
  projectToolbarRegistry,
  resolveToolbar,
  sceneToolbarRegistry,
  ToolbarButtonMeta,
} from '../uiLayout';

// 테스트 전용 소형 레지스트리 — tier/pcOnly 조합을 전부 커버
const registry: ToolbarButtonMeta[] = [
  { id: 'p1', name: '프라이머리1', tier: 'primary' },
  { id: 's1', name: '세컨더리1', tier: 'secondary' },
  { id: 'o1', name: '오버플로1', tier: 'overflow' },
  { id: 'pc1', name: 'PC전용(secondary)', pcOnly: true, tier: 'secondary' },
  { id: 'm1', name: '모바일프라이머리1', tier: 'mobile-primary' },
  { id: 'p2', name: '프라이머리2', tier: 'primary' },
];

describe('resolveToolbar — 기본 등급 (오버라이드 없음)', () => {
  it('PC: primary+secondary 인라인, overflow+mobile-primary 는 메뉴', () => {
    const r = resolveToolbar(registry, undefined, false);
    expect(r.inline).toEqual(['p1', 's1', 'pc1', 'p2']);
    expect(r.menu).toEqual(['o1', 'm1']);
  });
  it('모바일: primary+mobile-primary 인라인, secondary+overflow 는 메뉴, pcOnly 완전 제외', () => {
    const r = resolveToolbar(registry, undefined, true);
    expect(r.inline).toEqual(['p1', 'm1', 'p2']);
    expect(r.menu).toEqual(['s1', 'o1']);
    expect([...r.inline, ...r.menu]).not.toContain('pc1');
  });
  it('overrides 가 빈 객체여도 undefined 와 동일', () => {
    expect(resolveToolbar(registry, {}, false)).toEqual(
      resolveToolbar(registry, undefined, false),
    );
  });
});

describe('resolveToolbar — classic 롤백', () => {
  it('전 버튼을 레지스트리 순서로 인라인, 메뉴 없음', () => {
    const r = resolveToolbar(registry, { classic: true }, false);
    expect(r.inline).toEqual(['p1', 's1', 'o1', 'pc1', 'm1', 'p2']);
    expect(r.menu).toEqual([]);
  });
  it('buttons 오버라이드가 있어도 무시한다', () => {
    const r = resolveToolbar(
      registry,
      { classic: true, buttons: { p1: 'hidden', o1: 'pinned' } },
      false,
    );
    expect(r.inline).toEqual(['p1', 's1', 'o1', 'pc1', 'm1', 'p2']);
  });
  it('모바일에서도 pcOnly 를 필터하지 않는다 (기존 렌더와 100% 동일 계약)', () => {
    const r = resolveToolbar(registry, { classic: true }, true);
    expect(r.inline).toContain('pc1');
  });
});

describe('resolveToolbar — 사용자 오버라이드', () => {
  it('hidden 은 양쪽에서 제외', () => {
    const r = resolveToolbar(registry, { buttons: { p1: 'hidden' } }, false);
    expect(r.inline).not.toContain('p1');
    expect(r.menu).not.toContain('p1');
  });
  it('pinned 는 tier 와 무관하게 인라인', () => {
    const r = resolveToolbar(registry, { buttons: { o1: 'pinned' } }, true);
    expect(r.inline).toContain('o1');
  });
  it('menu 는 tier 와 무관하게 메뉴로', () => {
    const r = resolveToolbar(registry, { buttons: { p1: 'menu' } }, false);
    expect(r.menu).toContain('p1');
    expect(r.inline).not.toContain('p1');
  });
  it("'default' 는 미설정과 동일하게 tier 규칙을 따른다", () => {
    const r = resolveToolbar(
      registry,
      { buttons: { p1: 'default', o1: 'default' } },
      false,
    );
    expect(r.inline).toContain('p1');
    expect(r.menu).toContain('o1');
  });
  it('모바일 pcOnly 는 pinned 오버라이드보다 우선해 제외된다', () => {
    const r = resolveToolbar(registry, { buttons: { pc1: 'pinned' } }, true);
    expect(r.inline).not.toContain('pc1');
    expect(r.menu).not.toContain('pc1');
  });
  it('레지스트리에 없는 id(과거 설정 잔재)는 조용히 무시', () => {
    const r = resolveToolbar(
      registry,
      { buttons: { ghost: 'pinned', p1: 'menu' } },
      false,
    );
    expect([...r.inline, ...r.menu]).not.toContain('ghost');
    expect(r.menu).toContain('p1'); // 유효한 오버라이드는 정상 반영
  });
  it('오버라이드로 섞어도 결과는 레지스트리 순서를 유지', () => {
    const r = resolveToolbar(
      registry,
      { buttons: { p2: 'pinned', s1: 'pinned' } },
      false,
    );
    expect(r.inline).toEqual(['p1', 's1', 'pc1', 'p2']);
  });
});

describe('레지스트리 계약', () => {
  it('전 레지스트리 합집합에 id 중복이 없다 (config.buttons 공용 저장 키)', () => {
    const ids = [...sceneToolbarRegistry, ...projectToolbarRegistry].map(
      (b) => b.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('모든 항목에 tier 가 있다', () => {
    for (const b of [...sceneToolbarRegistry, ...projectToolbarRegistry]) {
      expect(['primary', 'secondary', 'mobile-primary', 'overflow']).toContain(
        b.tier,
      );
    }
  });
});
