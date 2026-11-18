// 프로젝트 사전 세팅 중 이 버전이 모르는 워크플로 종류 보존(2026-11-18 프리셋 유실 조사 경로 14).
//  · 읽을 때 버리지 않고 원본 JSON 을 세션에 보존(heldUnknownPresets) → 저장(toJSON) 때 같은 키·같은 자리에 원본 그대로
//  · 화면 목록(session.presets)에는 없다
//  · 아는 종류만 있는 파일은 읽기 → 저장이 종전과 같다
//  · 얕은 내보내기처럼 저장 결과를 고쳐 써도 보존분은 바뀌지 않는다

const mockKnown = new Set(['SDImageGen', 'SDImageGenEasy']);
const mockWrap = (json: any) => {
  const obj: any = JSON.parse(JSON.stringify(json));
  Object.defineProperty(obj, 'toJSON', { value: () => JSON.parse(JSON.stringify(json)), enumerable: false });
  return obj;
};
jest.mock('..', () => ({
  workFlowService: {
    presetFromJSON: jest.fn((json: any) => (mockKnown.has(json.type) ? mockWrap(json) : null)),
    sharedFromJSON: jest.fn((json: any) => mockWrap(json)),
  },
}));

import { ISession, Session } from '../types';

const preset = (type: string, name: string) => ({ type, name, frontPrompt: name, nested: { a: [1, { b: 2 }] } });
const baseJson = (presets: Record<string, any[]>): ISession =>
  ({
    version: 1,
    name: 'P',
    presets,
    inpaints: {},
    scenes: {},
    library: {},
    presetShareds: { SDImageGen: { type: 'SDImageGen', vibes: [] } },
    characterPresets: {},
    mirrorMode: 'blank',
    sceneCardStyle: {},
  }) as any;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

describe('Session — 모르는 종류의 사전 세팅 보존', () => {
  test('읽기 → 저장 결과에 원본 그대로, 같은 키·같은 자리', () => {
    const json = baseJson({
      SDImageGen: [preset('SDImageGen', 'a'), preset('SDImageGenV9', 'mixed'), preset('SDImageGen', 'b')],
      SDImageGenV9: [preset('SDImageGenV9', 'x'), preset('SDImageGenV9', 'y')],
      SDImageGenEasy: [preset('SDImageGenEasy', 'e')],
    });
    const session = Session.fromJSON(plain(json));
    // 화면 목록에는 아는 종류만
    expect(session.presets.get('SDImageGen')!.map((p: any) => p.name)).toEqual(['a', 'b']);
    expect(session.presets.get('SDImageGenV9')).toEqual([]);
    const out = plain(session.toJSON());
    expect(Object.keys(out.presets)).toEqual(['SDImageGen', 'SDImageGenV9', 'SDImageGenEasy']);
    expect(out.presets).toEqual(json.presets);
    // 다시 읽어도 같은 결과(구버전·신버전 모두 다시 읽을 수 있는 형태)
    expect(plain(Session.fromJSON(out).toJSON()).presets).toEqual(json.presets);
  });

  test('아는 종류만 있는 파일은 읽기 → 저장이 종전과 같다', () => {
    const json = baseJson({
      SDImageGen: [preset('SDImageGen', 'a'), preset('SDImageGen', 'b')],
      SDImageGenEasy: [],
    });
    const session = Session.fromJSON(plain(json));
    expect(session.heldUnknownPresets.size).toBe(0);
    expect(plain(session.toJSON()).presets).toEqual(json.presets);
  });

  test('아는 사전 세팅을 더하거나 지워도 보존분은 빠지지 않는다', () => {
    const unknown = preset('SDImageGenV9', 'u');
    const json = baseJson({ SDImageGen: [preset('SDImageGen', 'a'), unknown, preset('SDImageGen', 'b')] });
    const session = Session.fromJSON(plain(json));
    session.removePreset('SDImageGen', 'a');
    session.removePreset('SDImageGen', 'b');
    let out = plain(session.toJSON());
    expect(out.presets.SDImageGen).toEqual([unknown]);
    session.addPreset(mockWrap(preset('SDImageGen', 'c')));
    out = plain(session.toJSON());
    expect(out.presets.SDImageGen.map((p: any) => p.name)).toEqual(['c', 'u']);
  });

  test('저장 결과를 고쳐 써도(얕은 내보내기의 profile 치환 등) 보존분은 그대로', () => {
    const unknown = { ...preset('SDImageGenV9', 'u'), profile: 'pic.png' };
    const session = Session.fromJSON(plain(baseJson({ SDImageGenV9: [unknown] })));
    const first = session.toJSON();
    first.presets.SDImageGenV9[0].profile = 'BASE64...';
    first.presets.SDImageGenV9[0].nested.a.push(9);
    expect(plain(session.toJSON()).presets.SDImageGenV9).toEqual([unknown]);
  });

  test('보존분은 원본 JSON 사본 — 읽기에 쓴 입력 객체를 나중에 고쳐도 바뀌지 않는다', () => {
    const input: any = plain(baseJson({ SDImageGenV9: [preset('SDImageGenV9', 'u')] }));
    const session = Session.fromJSON(input);
    input.presets.SDImageGenV9[0].name = 'changed';
    expect(plain(session.toJSON()).presets.SDImageGenV9[0].name).toBe('u');
  });
});
