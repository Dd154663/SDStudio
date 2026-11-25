/**
 * 새 레퍼런스 기본값(2026-11-25) — 계열(V4.5 / V5) 분리·자르기·하위 호환 이동(한 번만·멱등)·예외 삼킴.
 */
jest.mock('..', () => ({}));

import { ModelVersion } from '../../backends/imageGen';
import {
  migrateReferenceDefaults,
  readReferenceDefaults,
  REFERENCE_DEFAULT_KEYS,
  referenceDefaultsFamily,
  referenceDefaultsFor,
  referenceDefaultsStrengthMax,
  writeReferenceDefault,
} from '../referenceDefaults';

const L = REFERENCE_DEFAULT_KEYS.legacy;
const V = REFERENCE_DEFAULT_KEYS.v5;

beforeEach(() => localStorage.clear());

describe('계열 판정', () => {
  test('능력표의 의상 지원으로 가른다', () => {
    expect(referenceDefaultsFamily(ModelVersion.V4_5)).toBe('legacy');
    expect(referenceDefaultsFamily(ModelVersion.V4)).toBe('legacy');
    expect(referenceDefaultsFamily(ModelVersion.V5)).toBe('v5');
    expect(referenceDefaultsFamily(ModelVersion.V5Curated)).toBe('v5');
    expect(referenceDefaultsStrengthMax('legacy')).toBe(2);
    expect(referenceDefaultsStrengthMax('v5')).toBe(5);
  });
  test('종전 키 이름은 그대로', () => {
    expect(L).toEqual({
      strength: 'sdstudio-ref-default-strength',
      fidelity: 'sdstudio-ref-default-fidelity',
      type: 'sdstudio-ref-default-type',
    });
    expect(V).toEqual({ strength: 'sdstudio-ref-default-v5-strength', type: 'sdstudio-ref-default-v5-type' });
  });
});

describe('읽기·쓰기', () => {
  test('값이 없으면 기본값', () => {
    expect(readReferenceDefaults('legacy')).toEqual({ strength: 0.6, fidelity: 1, referenceType: 'character' });
    expect(readReferenceDefaults('v5')).toEqual({ strength: 0.6, fidelity: 1, referenceType: 'character' });
  });
  test('계열마다 따로 저장된다', () => {
    writeReferenceDefault('v5', 'strength', 3.5);
    writeReferenceDefault('v5', 'referenceType', 'costume');
    writeReferenceDefault('legacy', 'strength', 1.2);
    writeReferenceDefault('legacy', 'fidelity', 0.8);
    writeReferenceDefault('legacy', 'referenceType', 'style');
    expect(readReferenceDefaults('v5')).toEqual({ strength: 3.5, fidelity: 1, referenceType: 'costume' });
    expect(readReferenceDefaults('legacy')).toEqual({ strength: 1.2, fidelity: 0.8, referenceType: 'style' });
    expect(referenceDefaultsFor(ModelVersion.V5).strength).toBe(3.5);
    expect(referenceDefaultsFor(ModelVersion.V4_5).strength).toBe(1.2);
  });
  test('v5 의 fidelity 쓰기는 아무것도 하지 않는다(키 없음)', () => {
    writeReferenceDefault('v5', 'fidelity', 0.3);
    expect(localStorage.length).toBe(0);
  });
  test('자르기·숫자 아님·모르는 종류', () => {
    localStorage.setItem(V.strength, '9');
    localStorage.setItem(V.type, 'weird');
    expect(readReferenceDefaults('v5')).toMatchObject({ strength: 5, referenceType: 'character' });
    localStorage.setItem(V.strength, '-1');
    expect(readReferenceDefaults('v5').strength).toBe(0);
    localStorage.setItem(V.strength, 'abc');
    expect(readReferenceDefaults('v5').strength).toBe(0.6);
    localStorage.setItem(L.strength, 'NaN');
    localStorage.setItem(L.fidelity, '');
    localStorage.setItem(L.type, 'character&style');
    expect(readReferenceDefaults('legacy')).toEqual({ strength: 0.6, fidelity: 1, referenceType: 'character&style' });
  });
});

describe('하위 호환 이동', () => {
  test('종전 키의 V5 값(의상·2 초과)은 v5 키로 옮기고 종전 키는 V4.5 값으로', () => {
    localStorage.setItem(L.type, 'costume');
    localStorage.setItem(L.strength, '3.2');
    expect(readReferenceDefaults('legacy')).toMatchObject({ strength: 2, referenceType: 'character' });
    expect(localStorage.getItem(L.type)).toBe('character');
    expect(localStorage.getItem(L.strength)).toBe('2');
    expect(localStorage.getItem(V.type)).toBe('costume');
    expect(localStorage.getItem(V.strength)).toBe('3.2');
    expect(readReferenceDefaults('v5')).toMatchObject({ strength: 3.2, referenceType: 'costume' });
  });
  test('여러 번 불러도 같다(멱등) — 옮긴 뒤 v5 값을 바꿔도 다시 덮지 않는다', () => {
    localStorage.setItem(L.type, 'costume');
    localStorage.setItem(L.strength, '4');
    migrateReferenceDefaults();
    writeReferenceDefault('v5', 'strength', 1.5);
    migrateReferenceDefaults();
    migrateReferenceDefaults();
    expect(localStorage.getItem(V.strength)).toBe('1.5');
    expect(localStorage.getItem(V.type)).toBe('costume');
    expect(localStorage.getItem(L.strength)).toBe('2');
    expect(localStorage.getItem(L.type)).toBe('character');
  });
  test('v5 키가 이미 있으면 덮지 않고 종전 키만 되돌린다', () => {
    localStorage.setItem(V.type, 'style');
    localStorage.setItem(V.strength, '1');
    localStorage.setItem(L.type, 'costume');
    localStorage.setItem(L.strength, '5');
    migrateReferenceDefaults();
    expect(localStorage.getItem(V.type)).toBe('style');
    expect(localStorage.getItem(V.strength)).toBe('1');
    expect(localStorage.getItem(L.type)).toBe('character');
    expect(localStorage.getItem(L.strength)).toBe('2');
  });
  test('V4.5 범위 값은 건드리지 않는다', () => {
    localStorage.setItem(L.type, 'style');
    localStorage.setItem(L.strength, '2');
    migrateReferenceDefaults();
    expect(localStorage.getItem(L.type)).toBe('style');
    expect(localStorage.getItem(L.strength)).toBe('2');
    expect(localStorage.getItem(V.type)).toBeNull();
    expect(localStorage.getItem(V.strength)).toBeNull();
  });
});

describe('localStorage 예외', () => {
  test('읽기·쓰기 예외를 삼키고 기본값', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(readReferenceDefaults('v5')).toEqual({ strength: 0.6, fidelity: 1, referenceType: 'character' });
      expect(() => writeReferenceDefault('legacy', 'strength', 1)).not.toThrow();
      expect(() => migrateReferenceDefaults()).not.toThrow();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
