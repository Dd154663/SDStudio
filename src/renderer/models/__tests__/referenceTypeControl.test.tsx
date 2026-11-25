/**
 * 레퍼런스 「유형」 드롭다운 + 「같은 의상 선호」 자리(2026-11-25) — 편집기 세 곳·기본값 구역 공용 부품.
 */
jest.mock('..', () => ({}));

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';
import { ModelVersion } from '../../backends/imageGen';
import { referenceEditorSpec } from '../referenceEditorSpec';
import { ReferenceTypeControl } from '../../componenets/ReferenceTypeControl';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const V45 = referenceEditorSpec(ModelVersion.V4_5);
const V5 = referenceEditorSpec(ModelVersion.V5);

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = (el: React.ReactElement) => act(async () => root.render(el));
const select = () => container.querySelector<HTMLSelectElement>('select')!;
const optionValues = () => Array.from(select().options).map((o) => o.value);
const slot = () => container.querySelector<HTMLElement>('[data-same-outfit-slot]');

describe('ReferenceTypeControl', () => {
  test('드롭다운 = 공용 .app-select, 의상은 V5 에서만(이미 의상인 항목은 V4.5 에서도)', async () => {
    await render(<ReferenceTypeControl type="character" spec={V45} onTypeChange={() => {}} />);
    expect(select().className).toContain('app-select');
    expect(select().className).toContain('app-select-tight');
    expect(optionValues()).toEqual(['character', 'style', 'character&style']);
    expect(Array.from(select().options).map((o) => o.textContent)).toEqual(['캐릭터', '스타일', '캐릭터+스타일']);
    await render(<ReferenceTypeControl type="costume" spec={V45} onTypeChange={() => {}} />);
    expect(optionValues()).toEqual(['character', 'style', 'character&style', 'costume']);
    expect(select().value).toBe('costume');
    await render(<ReferenceTypeControl type="character" spec={V5} onTypeChange={() => {}} />);
    expect(optionValues()).toEqual(['character', 'style', 'character&style', 'costume']);
  });

  test('유형 변경 콜백', async () => {
    const spy = jest.fn();
    await render(<ReferenceTypeControl type="character" spec={V5} onTypeChange={spy} />);
    const s = select();
    await act(async () => {
      s.value = 'costume';
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(spy).toHaveBeenCalledWith('costume');
  });

  test.each(['character', 'character&style'])('V5 %s: 같은 의상 선호 보임·누르면 콜백', async (t) => {
    const spy = jest.fn();
    await render(
      <ReferenceTypeControl type={t} spec={V5} onTypeChange={() => {}} onSameOutfitChange={spy} />,
    );
    const label = slot()!;
    expect(label.getAttribute('data-same-outfit-slot')).toBe('shown');
    expect(label.className).not.toContain('invisible');
    expect(label.getAttribute('aria-hidden')).toBeNull();
    const box = label.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.className).toBe('setting-check setting-check-sm');
    // 종류별 기본(effectiveSameOutfit): 캐릭터 = 꺼짐, 캐릭터+스타일 = 켜짐
    expect(box.checked).toBe(t === 'character&style');
    await act(async () => box.click());
    expect(spy).toHaveBeenCalledWith(t !== 'character&style');
  });

  test.each(['style', 'costume'])('V5 %s: 자리는 있고 숨겨짐(포커스·누름 불가)', async (t) => {
    const spy = jest.fn();
    await render(
      <ReferenceTypeControl type={t} spec={V5} onTypeChange={() => {}} onSameOutfitChange={spy} />,
    );
    const label = slot()!;
    expect(label).not.toBeNull();
    expect(label.getAttribute('data-same-outfit-slot')).toBe('hidden');
    expect(label.className).toContain('invisible');
    expect(label.className).toContain('pointer-events-none');
    expect(label.getAttribute('aria-hidden')).toBe('true');
    const box = label.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.tabIndex).toBe(-1);
    expect(box.disabled).toBe(true);
    await act(async () => box.click());
    expect(spy).not.toHaveBeenCalled();
  });

  test('V4.5 와 기본값 구역(typeOnly)에는 체크 상자 자리 자체가 없다', async () => {
    await render(<ReferenceTypeControl type="character" spec={V45} onTypeChange={() => {}} />);
    expect(slot()).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    await render(<ReferenceTypeControl typeOnly type="character" spec={V5} onTypeChange={() => {}} />);
    expect(slot()).toBeNull();
  });

  test('편집기 세 곳이 공용 부품을 쓰고 종전 라디오가 없다', () => {
    const dir = path.join(__dirname, '../../componenets');
    for (const f of ['CharacterReferenceEditor.tsx', 'CharacterPresetInnerEditor.tsx', 'TemplateManagerModal.tsx']) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect({ f, uses: src.includes('<ReferenceTypeControl') }).toEqual({ f, uses: true });
      expect({ f, radio: /refType-|ref-default-type/.test(src) }).toEqual({ f, radio: false });
    }
  });
});
