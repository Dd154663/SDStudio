/**
 * 환경설정 내보내기·불러오기(드라이브 동기화 C안 ③, 2026-09-28) — 화이트리스트 필터,
 * 파일 형식 검사, 필드군 차이 계산, 적용(테마 프리셋 이름 합집합), 토큰 파일·추가 계획.
 */
import type { Config } from '../../../main/config';
import {
  applyConfigGroups,
  buildConfigExport,
  buildTokenExport,
  CONFIG_GROUP_FIELDS,
  CONFIG_GROUP_ORDER,
  CONFIG_SYNC_EXCLUDED,
  countConfigChanges,
  decodeBase64Utf8,
  diffConfigGroups,
  jsonEqual,
  mergeThemePresets,
  parseConfigImport,
  parseTokenImport,
  planTokenImport,
} from '../configSync';

// 컴파일 시점 점검: Config 의 모든 필드는 화이트리스트나 제외 목록 중 한 곳에 분류돼야
// 한다(새 필드를 추가하면 여기서 typecheck 가 알려 준다 — 분류 전까지는 비공유).
type Whitelisted = (typeof CONFIG_GROUP_FIELDS)[keyof typeof CONFIG_GROUP_FIELDS][number];
type Classified = Whitelisted | (typeof CONFIG_SYNC_EXCLUDED)[number];
type Unclassified = Exclude<keyof Config, Classified>;
const allClassified: [Unclassified] extends [never] ? true : Unclassified = true;
void allClassified;

const META = { createdAt: '2026-09-28T01:02:03.000Z', appVersion: '5.4.0', platform: 'pc' as const };

const fullConfig: Config = {
  // 기기 고유(제외)
  saveLocation: 'D:/SDStudio',
  uuid: 'uuid-1',
  syncFolder: 'G:/My Drive/sd',
  defaultExportFolder: 'C:/exports',
  useCUDA: true,
  uiLayoutTemplate: 'modern',
  uiToolbar: { classic: true },
  multiTokenAutoRotate: true,
  mobileV2IntroDone: true,
  storageWriteGuard: false,
  delayTime: 300,
  // 공유
  modelVersion: '5-full' as any,
  furryMode: true,
  whiteMode: true,
  uiTheme: { surface: '#112233' },
  uiThemePresets: [{ name: 'A', whiteMode: true, theme: { surface: '#000000' } }],
  quickMenu: ['a', 'b'],
  classicSceneCard: true,
};

describe('화이트리스트', () => {
  it('화이트리스트와 제외 목록은 겹치지 않는다', () => {
    const white = new Set<string>(CONFIG_GROUP_ORDER.flatMap((g) => CONFIG_GROUP_FIELDS[g]));
    for (const f of CONFIG_SYNC_EXCLUDED) expect(white.has(f)).toBe(false);
  });

  it('내보내기 파일에는 화이트리스트만 담기고 제외 필드·토큰류 값은 없다', () => {
    const file = buildConfigExport(fullConfig, META);
    const text = JSON.stringify(file);
    for (const secret of ['D:/SDStudio', 'uuid-1', 'G:/My Drive/sd', 'C:/exports', 'modern']) {
      expect(text).not.toContain(secret);
    }
    for (const f of CONFIG_SYNC_EXCLUDED) expect(text).not.toContain(`"${f}"`);
    expect(file).toMatchObject({ type: 'sdstudio-config', version: 1, ...META });
    expect(Object.keys(file.groups)).toEqual(['generation', 'theme', 'layout', 'editing']);
    expect(file.groups.generation.furryMode).toBe(true);
    expect(file.groups.theme.uiTheme).toEqual({ surface: '#112233' });
    // 설정 안 된 값은 null 로 명시(받는 쪽도 기본값으로)
    expect(file.groups.generation.ucPreset).toBeNull();
    expect(Object.keys(file.groups.editing).sort()).toEqual(
      [...CONFIG_GROUP_FIELDS.editing].sort(),
    );
  });

  it('내보낸 값은 원본과 참조를 공유하지 않는다', () => {
    const file = buildConfigExport(fullConfig, META);
    (file.groups.theme.uiTheme as any).surface = '#ffffff';
    expect(fullConfig.uiTheme!.surface).toBe('#112233');
  });
});

describe('parseConfigImport', () => {
  it('type·version 검사', () => {
    expect(parseConfigImport('not json')).toEqual({ ok: false, error: 'not-config' });
    expect(parseConfigImport({ type: 'sdstudio-token', version: 1, groups: {} })).toEqual({
      ok: false,
      error: 'not-config',
    });
    expect(parseConfigImport({ type: 'sdstudio-config', groups: {} })).toEqual({
      ok: false,
      error: 'not-config',
    });
    expect(parseConfigImport({ type: 'sdstudio-config', version: 2, groups: {} })).toEqual({
      ok: false,
      error: 'newer-version',
    });
  });

  it('알 수 없는 군·필드는 무시하고, 형식이 틀린 값은 건너뛴다', () => {
    const res = parseConfigImport(
      JSON.stringify({
        type: 'sdstudio-config',
        version: 1,
        groups: {
          generation: { furryMode: 'yes', ucPreset: 'heavy', saveLocation: 'X:/evil' },
          theme: {
            uiTheme: 'red',
            whiteMode: false,
            uiThemePresets: [{ name: 'ok', whiteMode: false, theme: {} }, { name: 3 }],
          },
          unknownGroup: { whiteMode: true },
          layout: { quickMenu: ['x', 1] },
        },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.groups.generation).toEqual({ ucPreset: 'heavy' });
    expect(res.value.groups.theme).toEqual({
      whiteMode: false,
      uiThemePresets: [{ name: 'ok', whiteMode: false, theme: {} }],
    });
    expect(res.value.groups.layout).toEqual({});
    expect((res.value.groups as any).unknownGroup).toBeUndefined();
  });

  it('내보내기 → 불러오기 왕복', () => {
    const res = parseConfigImport(JSON.stringify(buildConfigExport(fullConfig, META)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.platform).toBe('pc');
    expect(res.value.appVersion).toBe('5.4.0');
    // 같은 설정에 대면 바뀌는 항목이 없다
    expect(countConfigChanges(diffConfigGroups(fullConfig, res.value.groups))).toBe(0);
  });
});

describe('diffConfigGroups / applyConfigGroups', () => {
  const incomingFile = buildConfigExport(
    {
      furryMode: false,
      modelVersion: '4-5-full' as any,
      whiteMode: false,
      uiTheme: {},
      uiThemePresets: [
        { name: 'A', whiteMode: false, theme: { surface: '#ffffff' } },
        { name: 'B', whiteMode: false, theme: {} },
      ],
      quickMenu: ['a', 'b'],
      legacyWorkflowMode: true,
    },
    { ...META, platform: 'android' },
  );
  const parsed = parseConfigImport(incomingFile);
  if (!parsed.ok) throw new Error('parse');
  const incoming = parsed.value.groups;

  it('필드군별 바뀌는 항목 목록', () => {
    const diff = diffConfigGroups(fullConfig, incoming);
    const by = Object.fromEntries(diff.map((d) => [d.group, d.changed]));
    expect(by.generation).toEqual(['modelVersion', 'furryMode']);
    expect(by.theme).toEqual(['uiTheme', 'uiThemePresets', 'whiteMode']);
    expect(by.layout).toEqual([]);
    expect(by.editing).toEqual(['classicSceneCard', 'legacyWorkflowMode']);
    expect(countConfigChanges(diff)).toBe(7);
    expect(countConfigChanges(diff, { generation: true, editing: true })).toBe(4);
  });

  it('없음과 false, 빈 객체와 없음은 같은 값으로 본다', () => {
    const diff = diffConfigGroups(
      { uiTheme: {} },
      { generation: { furryMode: false, disableQuality: null }, theme: { uiTheme: null } },
    );
    expect(countConfigChanges(diff)).toBe(0);
  });

  it('켠 군만 적용, 제외 필드는 그대로, 테마 프리셋은 이름 합집합', () => {
    const next = applyConfigGroups(fullConfig, incoming, { theme: true, editing: true });
    // 끈 군(생성 설정)은 그대로
    expect(next.furryMode).toBe(true);
    expect(next.modelVersion).toBe('5-full');
    // 켠 군은 받은 값으로 교체
    expect(next.whiteMode).toBe(false);
    expect(next.legacyWorkflowMode).toBe(true);
    // 받은 쪽 null(설정 안 됨) = 키 제거 = 기본값
    expect('classicSceneCard' in next).toBe(false);
    // 받은 쪽 빈 객체 = 빈 객체로 교체(색 사용자화 없음)
    expect(next.uiTheme).toEqual({});
    // 테마 프리셋: 기존 A 유지(내용 불변) + B 추가
    expect(next.uiThemePresets).toEqual([
      { name: 'A', whiteMode: true, theme: { surface: '#000000' } },
      { name: 'B', whiteMode: false, theme: {} },
    ]);
    // 기기 고유 값 보존
    expect(next.saveLocation).toBe('D:/SDStudio');
    expect(next.syncFolder).toBe('G:/My Drive/sd');
    expect(next.uiLayoutTemplate).toBe('modern');
    expect(next.multiTokenAutoRotate).toBe(true);
    // 원본 불변
    expect(fullConfig.whiteMode).toBe(true);
    expect(fullConfig.uiThemePresets).toHaveLength(1);
  });

  it('파일에 없는 필드(구버전 파일)는 받는 쪽 값을 그대로 둔다', () => {
    const next = applyConfigGroups(
      fullConfig,
      { generation: { furryMode: false } },
      { generation: true },
    );
    expect(next.furryMode).toBe(false);
    expect(next.modelVersion).toBe('5-full');
  });

  it('mergeThemePresets 는 이름이 없는 것만 뒤에 추가', () => {
    expect(
      mergeThemePresets(undefined, [{ name: 'X', whiteMode: true, theme: {} }]),
    ).toEqual([{ name: 'X', whiteMode: true, theme: {} }]);
  });

  it('jsonEqual 은 키 순서와 무관', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe('토큰 파일', () => {
  it('형식 검사와 왕복', () => {
    const file = buildTokenExport([{ name: '토큰 1', token: 'secret' }], META.createdAt);
    expect(file).toEqual({
      type: 'sdstudio-token',
      version: 1,
      createdAt: META.createdAt,
      profiles: [{ name: '토큰 1', token: 'secret' }],
    });
    const res = parseTokenImport(JSON.stringify(file));
    expect(res).toEqual({ ok: true, profiles: [{ name: '토큰 1', token: 'secret' }], invalid: 0 });
    // 설정 파일은 토큰 파일로 받지 않는다(서로 섞이지 않음)
    expect(parseTokenImport(buildConfigExport({}, META))).toEqual({ ok: false, error: 'not-token' });
    expect(parseConfigImport(file)).toEqual({ ok: false, error: 'not-config' });
    expect(parseTokenImport({ type: 'sdstudio-token', version: 9, profiles: [] })).toEqual({
      ok: false,
      error: 'newer-version',
    });
    expect(
      parseTokenImport({ type: 'sdstudio-token', version: 1, profiles: [{ name: 1 }, null] }),
    ).toEqual({ ok: true, profiles: [], invalid: 2 });
  });

  it('추가 계획: 같은 토큰·같은 이름(대소문자 무시)·빈 값·긴 이름은 건너뛴다', () => {
    const plan = planTokenImport(
      [{ name: 'Main', token: 't1' }],
      [
        { name: 'main', token: 't9' }, // 같은 이름
        { name: 'Other', token: ' t1 ' }, // 같은 토큰
        { name: '', token: 't2' }, // 빈 이름
        { name: 'x'.repeat(41), token: 't3' }, // 40자 초과
        { name: ' Sub ', token: 't4' }, // 추가(공백 정리)
        { name: 'Sub2', token: 't4' }, // 파일 안 중복 토큰
      ],
    );
    expect(plan).toEqual({ toAdd: [{ name: 'Sub', token: 't4' }], skipped: 5 });
  });

  it('decodeBase64Utf8 는 한글·BOM 을 처리', () => {
    // jsdom 환경엔 TextDecoder 가 없다(다른 테스트 선례와 같은 보충).
    const util = require('util');
    (global as any).TextDecoder ??= util.TextDecoder;
    const text = '\uFEFF{"a":"한글"}';
    const b64 = Buffer.from(text, 'utf-8').toString('base64');
    expect(decodeBase64Utf8(b64)).toBe('{"a":"한글"}');
  });
});
