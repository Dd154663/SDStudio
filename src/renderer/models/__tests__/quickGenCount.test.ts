// 퀵 생성 장수(2026-11-22) — models/sampleCount.ts
// 판정(범위·잘못된 값) = 일반 생성 개수와 공용, 누름·길게 누름이 그 값을 넘김, appState.samples 와 분리,
// 보존 = 퀵 생성 전용 프로젝트 default 씬 meta(해상도와 같은 곳, 없으면 1).
import fs from 'fs';
import path from 'path';

jest.mock('..', () => ({ workFlowService: {} }));

import { Scene } from '../types';
import {
  getQuickGenCount,
  parseSampleCount,
  QUICK_GEN_COUNT_META_KEY,
  SAMPLE_COUNT_MAX,
  SAMPLE_COUNT_MIN,
  setQuickGenCount,
} from '../sampleCount';

const ROOT = path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const sceneJSON = (meta: Record<string, any> = {}) => ({
  type: 'scene' as const,
  name: 'default',
  resolution: 'portrait',
  slots: [[{ id: 'p', prompt: '', characterPrompts: [], enabled: true }]],
  mains: [],
  imageMap: [],
  meta,
  round: undefined,
  game: undefined,
});

describe('장수 판정(일반 생성 개수와 같은 규칙)', () => {
  test('범위 1~99', () => {
    expect([SAMPLE_COUNT_MIN, SAMPLE_COUNT_MAX]).toEqual([1, 99]);
    expect(parseSampleCount('1')).toBe(1);
    expect(parseSampleCount('7')).toBe(7);
    expect(parseSampleCount('99')).toBe(99);
    expect(parseSampleCount('100')).toBe(99);
    expect(parseSampleCount('0')).toBe(1);
    expect(parseSampleCount('-3')).toBe(1);
    expect(parseSampleCount(12)).toBe(12);
  });
  test('빈 값·숫자 아님 = 1, 소수는 정수 부분', () => {
    expect(parseSampleCount('')).toBe(1);
    expect(parseSampleCount('abc')).toBe(1);
    expect(parseSampleCount(undefined)).toBe(1);
    expect(parseSampleCount(null)).toBe(1);
    expect(parseSampleCount(NaN)).toBe(1);
    expect(parseSampleCount('3.7')).toBe(3);
  });
  test('일반 생성 개수 입력도 같은 판정 함수', () => {
    const tqc = read('componenets/TaskQueueControl.tsx');
    expect(tqc).toContain('appState.samples = parseSampleCount(e.currentTarget.value);');
    expect(tqc).toContain('min={SAMPLE_COUNT_MIN}');
    expect(tqc).toContain('max={SAMPLE_COUNT_MAX}');
  });
});

describe('보존 — 퀵 씬 meta(프로젝트 파일)', () => {
  test('예전 씬(키 없음)·씬 없음 = 1', () => {
    expect(getQuickGenCount(Scene.fromJSON(sceneJSON()))).toBe(1);
    expect(getQuickGenCount(undefined)).toBe(1);
    expect(getQuickGenCount(null)).toBe(1);
  });
  test('저장 → JSON → 다시 읽기', () => {
    const s = Scene.fromJSON(sceneJSON({ SDImageGen: { keep: 1 } }));
    expect(setQuickGenCount(s, '4')).toBe(4);
    const json = JSON.parse(JSON.stringify(s.toJSON()));
    expect(json.meta[QUICK_GEN_COUNT_META_KEY]).toBe(4);
    expect(json.meta.SDImageGen).toEqual({ keep: 1 }); // 다른 meta 는 그대로
    expect(getQuickGenCount(Scene.fromJSON(json))).toBe(4);
  });
  test('손상 값은 같은 판정으로', () => {
    expect(getQuickGenCount(Scene.fromJSON(sceneJSON({ [QUICK_GEN_COUNT_META_KEY]: 'x' })))).toBe(1);
    expect(getQuickGenCount(Scene.fromJSON(sceneJSON({ [QUICK_GEN_COUNT_META_KEY]: 500 })))).toBe(99);
    const s = Scene.fromJSON(sceneJSON());
    expect(setQuickGenCount(s, '')).toBe(1);
    expect(s.meta.get(QUICK_GEN_COUNT_META_KEY)).toBe(1);
  });
});

describe('퀵 생성 탭', () => {
  const tab = read('componenets/QuickModeTab.tsx');
  test('누름(한 번)·길게 누름(자동 반복의 다음 예약) 모두 그 장수를 넘긴다', () => {
    expect(tab).not.toMatch(/queueQuickScene\([^)]*,\s*1\)/);
    expect(tab.split('getQuickGenCount(scene));').length - 1).toBe(2);
    expect(tab).toContain('await queueQuickScene(curSession, quickSession!, scene, getQuickGenCount(scene));'); // startOnce(누름·길게 누름 첫 회)
    expect(tab).toContain('await queueQuickScene(curSession, quickSession, scene, getQuickGenCount(scene));'); // 자동 반복 다음 예약
    // 길게 누름 = startAuto → startOnce
    const auto = tab.slice(tab.indexOf('const startAuto = async'), tab.indexOf('const cancelAll'));
    expect(auto).toContain('await startOnce();');
  });
  test('appState.samples 와 분리 — 탭은 일반 생성 개수를 읽거나 쓰지 않는다', () => {
    expect(tab).not.toContain('appState.samples');
    expect(read('models/sampleCount.ts')).not.toContain("from './AppService'");
    const appState: any = { samples: 7 };
    const s = Scene.fromJSON(sceneJSON());
    setQuickGenCount(s, '3');
    expect(appState.samples).toBe(7);
    appState.samples = 20;
    expect(getQuickGenCount(s)).toBe(3);
  });
  test('입력칸 = 일반 생성 개수와 같은 클래스, 값은 퀵 씬에 저장(markDirty)', () => {
    expect(tab).toContain("className={'ml-1 md:ml-2 p-1 w-10 md:w-16 md:h-8 text-center gray-input'}");
    expect(tab).toContain('value={getQuickGenCount(quickScene)}');
    expect(tab).toContain('applyQuickScene((scene) => setQuickGenCount(scene, raw));');
    const apply = tab.slice(tab.indexOf('const applyQuickScene'), tab.indexOf('return (', tab.indexOf('const applyQuickScene')));
    expect(apply).toContain('sessionService.markDirty(quickSession.name);');
    // PC 줄과 V2 하단 바가 같은 controls 를 쓴다(장수 칸이 양쪽에)
    const controls = tab.slice(tab.indexOf('const controls = ('), tab.indexOf('if (v2Bar) return'));
    expect(controls).toContain('data-quick-gen-count=""');
  });
});
