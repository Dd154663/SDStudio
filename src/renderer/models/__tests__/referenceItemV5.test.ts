/**
 * V5 캐릭터(정밀) 레퍼런스(2026-11-25) — 저장 형식 호환·편집기 규칙·메타 읽기.
 * - ReferenceItem: 새 선택 필드(preferSameOutfit·srcWidth·srcHeight)는 값이 있을 때만 키를 낸다(종전 JSON 과 같게)
 * - 되돌리기 되살리기가 새 필드를 잃지 않고, 값이 없던 항목에 키를 만들지 않는다
 * - referenceEditorSpec·종류 선택지
 */
jest.mock('..', () => ({}));

import { ReferenceItem } from '../types';
import { restoreWorkflowValue } from '../presetUndo';
import { ModelVersion } from '../../backends/imageGen';
import {
  newReferenceType,
  REFERENCE_TYPE_LABELS,
  referenceEditorSpec,
  referenceLockText,
  referenceTypeOptions,
  showCostumeUnsupported,
  showSameOutfitToggle,
} from '../referenceEditorSpec';

const LEGACY = {
  path: 'a.png',
  info: 1,
  strength: 0.6,
  fidelity: 1,
  referenceType: 'character' as const,
  enabled: true,
};

describe('ReferenceItem JSON', () => {
  test('새 필드가 없으면 종전 JSON 과 완전히 같다', () => {
    const item = ReferenceItem.fromJSON(LEGACY);
    expect(JSON.stringify(item.toJSON())).toBe(
      JSON.stringify({ ...LEGACY, fromPreset: undefined }),
    );
    expect(Object.keys(item.toJSON())).toEqual([
      'path',
      'info',
      'strength',
      'fidelity',
      'referenceType',
      'enabled',
      'fromPreset',
    ]);
  });

  test('새 필드 왕복', () => {
    const json = {
      ...LEGACY,
      referenceType: 'costume' as const,
      preferSameOutfit: false,
      srcWidth: 800,
      srcHeight: 600,
    };
    const back = ReferenceItem.fromJSON(json).toJSON();
    expect(back).toMatchObject({ referenceType: 'costume', preferSameOutfit: false, srcWidth: 800, srcHeight: 600 });
    expect(ReferenceItem.fromJSON(back).toJSON()).toEqual(back);
  });

  test('이상한 크기 값은 읽지 않는다(둘 다 양수일 때만)', () => {
    const back = ReferenceItem.fromJSON({ ...LEGACY, srcWidth: 0, srcHeight: 600 } as any).toJSON();
    expect(back).not.toHaveProperty('srcWidth');
    expect(back).not.toHaveProperty('srcHeight');
  });

  test('되돌리기 되살리기: 새 필드 보존, 값이 없던 항목에는 키를 만들지 않는다', () => {
    const live = ReferenceItem.fromJSON({ ...LEGACY, preferSameOutfit: true, srcWidth: 10, srcHeight: 20 });
    // 사본(값이 없던 시점) → 같은 경로 객체에 되살림
    const restored = restoreWorkflowValue('characterReferences', [{ ...LEGACY }], [live]) as ReferenceItem[];
    expect(restored[0]).toBe(live);
    expect(JSON.stringify(restored[0].toJSON())).toBe(JSON.stringify(ReferenceItem.fromJSON(LEGACY).toJSON()));
    // 사본(값이 있던 시점) → 값이 돌아옴
    const plain = ReferenceItem.fromJSON({ ...LEGACY, preferSameOutfit: false, srcWidth: 3, srcHeight: 4 }).toJSON();
    const again = restoreWorkflowValue('characterReferences', [plain], [live]) as ReferenceItem[];
    expect(again[0].toJSON()).toMatchObject({ preferSameOutfit: false, srcWidth: 3, srcHeight: 4 });
  });
});

describe('referenceEditorSpec', () => {
  test('V4.5: 상한 2·Fidelity 보임·의상 없음', () => {
    const s = referenceEditorSpec(ModelVersion.V4_5);
    expect(s).toEqual({ supported: true, blockReason: undefined, showFidelity: true, strengthMax: 2, outfit: false });
    expect(referenceTypeOptions(s, 'character')).toEqual(['character', 'style', 'character&style']);
    // 이미 의상인 항목은 선택지를 보이고 안내를 붙인다
    expect(referenceTypeOptions(s, 'costume')).toEqual(['character', 'style', 'character&style', 'costume']);
    expect(showCostumeUnsupported(s, 'costume')).toBe(true);
    expect(showSameOutfitToggle(s, 'character')).toBe(false);
    expect(newReferenceType(s, 'costume')).toBe('character');
    expect(newReferenceType(s, 'style')).toBe('style');
  });

  test.each([ModelVersion.V5, ModelVersion.V5Curated])('%s: 상한 5·Fidelity 숨김·의상', (v) => {
    const s = referenceEditorSpec(v);
    expect(s).toEqual({ supported: true, blockReason: undefined, showFidelity: false, strengthMax: 5, outfit: true });
    expect(referenceTypeOptions(s, 'character')).toEqual(['character', 'style', 'character&style', 'costume']);
    expect(showSameOutfitToggle(s, 'character')).toBe(true);
    expect(showSameOutfitToggle(s, 'character&style')).toBe(true);
    expect(showSameOutfitToggle(s, 'style')).toBe(false);
    expect(showSameOutfitToggle(s, 'costume')).toBe(false);
    expect(showCostumeUnsupported(s, 'costume')).toBe(false);
    expect(newReferenceType(s, 'costume')).toBe('costume');
  });

  test('잠금: V4·V5 Medium', () => {
    expect(referenceEditorSpec(ModelVersion.V4).blockReason).toBe('v4');
    expect(referenceEditorSpec(ModelVersion.V5Medium)).toMatchObject({ supported: false, blockReason: 'v5-medium' });
    expect(referenceLockText('v4').label).toBe('캐릭터 레퍼런스 (V4 모델 미지원)');
    expect(referenceLockText('v4').inline).toBe('(v4 미지원)');
    expect(referenceLockText('v5-medium').tooltip).toContain('V5 Full(High)·Curated');
  });

  test('라벨 단일 출처', () => {
    expect(REFERENCE_TYPE_LABELS).toEqual({
      character: '캐릭터',
      style: '스타일',
      'character&style': '캐릭터+스타일',
      costume: '의상',
    });
  });
});
