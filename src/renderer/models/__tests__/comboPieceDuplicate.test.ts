// 조합 칸 조각 「복제」(2026-11-22) — 자리·새 id·이름·원본 불변 + 버튼 배선(소스 검사).
import fs from 'fs';
import path from 'path';
import { planSlotPieceDuplicate } from '../comboPieceDuplicate';
import { UNDO_TEXT } from '../undoService';

jest.mock('../appStateRef', () => ({ getAppState: () => ({}) }));

const p = (id: string, extra: Record<string, unknown> = {}) => ({
  prompt: `prompt-${id}`,
  characterPrompts: [`c-${id}`],
  id,
  enabled: true,
  ...extra,
});

describe('planSlotPieceDuplicate', () => {
  test('같은 열의 바로 다음 자리, 새 id, 내용은 같게', () => {
    const a = p('a');
    const b = p('b', { enabled: false, characterPrompts: ['x', 'y'] });
    const c = p('c');
    const slots = [[a], [b, c]];
    const plan = planSlotPieceDuplicate(slots, b, 'new-id')!;
    expect(plan.slotIndex).toBe(1);
    expect(plan.insertAt).toBe(1);
    expect(plan.json).toEqual({
      prompt: 'prompt-b',
      characterPrompts: ['x', 'y'],
      id: 'new-id',
      enabled: false,
    });
    // 캐릭터 프롬프트 배열은 사본(원본과 공유하지 않음)
    expect(plan.json.characterPrompts).not.toBe(b.characterPrompts);
  });

  test('원본·슬롯은 바뀌지 않는다', () => {
    const a = p('a', { name: '머리' });
    const slots = [[a]];
    const before = JSON.stringify(slots);
    planSlotPieceDuplicate(slots, a, 'z');
    expect(JSON.stringify(slots)).toBe(before);
    expect(a.id).toBe('a');
  });

  test('이름이 있으면 「X 복사본」, 겹치면 「X 복사본 (2)」', () => {
    const a = p('a', { name: '머리' });
    expect(planSlotPieceDuplicate([[a]], a, 'z')!.json.name).toBe('머리 복사본');
    const copy = p('b', { name: '머리 복사본' });
    expect(planSlotPieceDuplicate([[a], [copy]], a, 'z')!.json.name).toBe('머리 복사본 (2)');
  });

  test('이름이 없으면 이름 없이', () => {
    const a = p('a');
    const plan = planSlotPieceDuplicate([[a]], a, 'z')!;
    expect('name' in plan.json).toBe(false);
  });

  test('toJSON 이 있으면 그 필드를 쓴다(이름은 복제 규칙으로 다시 정함)', () => {
    const a = {
      ...p('a', { name: 'n' }),
      toJSON: () => ({ prompt: 'P', characterPrompts: ['C'], id: 'a', enabled: undefined, name: 'n' }),
    };
    const plan = planSlotPieceDuplicate([[a]], a, 'z')!;
    expect(plan.json).toEqual({ prompt: 'P', characterPrompts: ['C'], id: 'z', enabled: undefined, name: 'n 복사본' });
  });

  test('슬롯에 없는 조각이면 undefined', () => {
    expect(planSlotPieceDuplicate([[p('a')]], p('x'), 'z')).toBeUndefined();
  });
});

describe('조각 복제 버튼 배선', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../componenets/SceneEditor.tsx'), 'utf8');
  const slotPiece = src.slice(src.indexOf('export const SlotPiece'), src.indexOf('// 씬별 캐릭터 프롬프트 에디터'));

  test('editSlots 와 새 문구 comboDuplicatePiece 로 1항목', () => {
    expect(slotPiece).toMatch(
      /editSlots\(scene, UNDO_TEXT\.comboDuplicatePiece\(slotsSceneName\(scene\)\), \(\) => \{\s*scene\.slots\[plan\.slotIndex\]\.splice\(plan\.insertAt, 0, PromptPiece\.fromJSON\(plan\.json\)\);/,
    );
    expect(UNDO_TEXT.comboDuplicatePiece('씬1')).toBe('조합 셀 복제: 씬1');
  });

  test('버튼은 삭제 앞, 중립 색, 툴팁·aria-label 「조각 복제」', () => {
    const dup = slotPiece.indexOf('data-slot-piece-duplicate');
    const del = slotPiece.indexOf('aria-label="셀 삭제"');
    expect(dup).toBeGreaterThan(0);
    expect(dup).toBeLessThan(del);
    const block = slotPiece.slice(
      slotPiece.lastIndexOf('<Tooltip', dup),
      slotPiece.indexOf('<Tooltip content="셀 삭제">'),
    );
    expect(block).toContain('content="조각 복제"');
    expect(block).toContain('aria-label="조각 복제"');
    expect(block).toContain('text-[var(--c-icon-text)]');
    expect(block).not.toMatch(/text-red|back-red/);
    expect(block).toContain('<ActionIcon id="duplicate" size={20} />');
  });
});
