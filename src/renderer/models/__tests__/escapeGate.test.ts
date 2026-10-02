// 닫기 관문(Esc·뒤로 가기 맨 위 한 겹만) — 2026-10-03 U1·X2
import {
  decide,
  hasOwnEscCancel,
  isEditableTarget,
  isImeComposing,
  LayerEntry,
  pickLayer,
} from '../escapeGate';

const entry = (id: number, opts: LayerEntry['opts'] = {}): LayerEntry => ({
  id,
  onClose: jest.fn(),
  opts,
});

describe('pickLayer / decide', () => {
  test('맨 위(마지막 등록) 항목만 고른다', () => {
    const a = entry(1);
    const b = entry(2);
    expect(pickLayer([a, b], 'escape')).toBe(b);
    const d = decide([a, b], 'escape');
    expect(d.kind).toBe('run');
    if (d.kind === 'run') d.run();
    expect(b.onClose).toHaveBeenCalledTimes(1);
    expect(a.onClose).not.toHaveBeenCalled();
  });

  test('빈 스택 = none (Esc 통과, 뒤로 가기는 최소화)', () => {
    expect(decide([], 'escape').kind).toBe('none');
    expect(decide([], 'back').kind).toBe('none');
  });

  test('preempt 항목은 나중에 열린 일반 항목보다 먼저 받는다(확인 창·편집 모드)', () => {
    const confirm = entry(1, { preempt: true });
    const modal = entry(2);
    expect(pickLayer([confirm, modal], 'escape')).toBe(confirm);
    // preempt 끼리는 최근 등록 우선
    const edit = entry(3, { preempt: true });
    expect(pickLayer([edit, modal, confirm], 'escape')).toBe(confirm);
  });

  test("'skip' 은 건너뛰고 바로 아래가 받는다", () => {
    const a = entry(1);
    const edit = entry(2, { preempt: true, back: 'skip' });
    expect(pickLayer([a, edit], 'back')).toBe(a);
    expect(pickLayer([a, edit], 'escape')).toBe(edit);
  });

  test("'consume' 은 아무것도 부르지 않고 삼킨다(진행 창·만료 프로젝트 창)", () => {
    const below = entry(1);
    const progress = entry(2, { escape: 'consume', back: 'consume' });
    expect(decide([below, progress], 'escape').kind).toBe('consume');
    expect(decide([below, progress], 'back').kind).toBe('consume');
    expect(below.onClose).not.toHaveBeenCalled();
  });

  test("'self' 는 Esc 에서 손대지 않음, 뒤로 가기에서는 삼킴", () => {
    const menu = entry(1, { escape: 'self' });
    expect(decide([menu], 'escape').kind).toBe('self');
    // escape 만 지정하면 뒤로 가기는 기본(onClose)
    expect(decide([menu], 'back').kind).toBe('run');
    const both = entry(2, { escape: 'self', back: 'self' });
    expect(decide([both], 'back').kind).toBe('consume');
  });

  test('함수 동작은 onClose 대신 그 함수를 부른다(드로어 단계별 Esc)', () => {
    const staged = jest.fn();
    const drawer = entry(1, { escape: staged });
    const d = decide([drawer], 'escape');
    expect(d.kind).toBe('run');
    if (d.kind === 'run') d.run();
    expect(staged).toHaveBeenCalledTimes(1);
    expect(drawer.onClose).not.toHaveBeenCalled();
    // 뒤로 가기는 기본 onClose
    const b = decide([drawer], 'back');
    if (b.kind === 'run') b.run();
    expect(drawer.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('입력칸 규칙', () => {
  test('글자 입력 요소 판정', () => {
    const text = document.createElement('input');
    const check = document.createElement('input');
    check.type = 'checkbox';
    const area = document.createElement('textarea');
    const button = document.createElement('button');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom 은 isContentEditable 을 구현하지 않아 직접 지정
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isEditableTarget(text)).toBe(true);
    expect(isEditableTarget(area)).toBe(true);
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(check)).toBe(false);
    expect(isEditableTarget(button)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  test('data-esc-cancel 표시(자신·조상, "false" 는 해제)', () => {
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    wrap.appendChild(input);
    expect(hasOwnEscCancel(input)).toBe(false);
    input.setAttribute('data-esc-cancel', '');
    expect(hasOwnEscCancel(input)).toBe(true);
    input.removeAttribute('data-esc-cancel');
    wrap.setAttribute('data-esc-cancel', 'true');
    expect(hasOwnEscCancel(input)).toBe(true);
    wrap.setAttribute('data-esc-cancel', 'false');
    expect(hasOwnEscCancel(input)).toBe(false);
  });

  test('IME 조합 판정', () => {
    expect(isImeComposing({ isComposing: true })).toBe(true);
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
