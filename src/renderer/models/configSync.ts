// 환경설정 내보내기·불러오기 (드라이브 동기화 C안 ③, 2026-09-28)
//
// PC·모바일 작업 환경을 맞추기 위한 설정 파일. **화이트리스트만** 담는다 — 여기 표에
// 없는 config 필드(저장 위치·uuid·기기 고유 경로·권한 표식·토큰 순회 설정 등)는
// 내보내지도, 받아서 쓰지도 않는다. 새 config 필드는 여기에 넣기 전까지 기본 비공유다.
//
// 파일 형식 (sdstudio-config-<날짜>.json):
//   { type: 'sdstudio-config', version: 1, createdAt, appVersion, platform: 'pc'|'android',
//     groups: { generation: {...}, theme: {...}, layout: {...}, editing: {...} } }
//   - 각 군에는 그 군의 화이트리스트 필드를 **모두** 적는다. 설정되지 않은 값은 null
//     (= 받는 쪽도 기본값으로 되돌림). 파일에 아예 없는 필드(구버전 파일 등)는 받는 쪽
//     값을 그대로 둔다.
//   - 알 수 없는 군·필드는 무시하고, 형식이 맞지 않는 값은 건너뛴다.
//
// 토큰 파일 (sdstudio-token-<날짜>.json, 기본 꺼짐·경고 후 옵트인, 설정 파일과 섞지 않음):
//   { type: 'sdstudio-token', version: 1, createdAt, profiles: [{ name, token }] }
//   받기는 LoginService.importTokenProfiles 가 saveTokenProfile 로 **추가만** 한다.
//
// 순수 함수는 jest 로 검증한다(__tests__/configSync.test.ts). 이 모듈은 서비스·backend 를
// import 하지 않는다(문구·형식·계산만).

import type { Config } from '../../main/config';
import {
  legacyDelayTimeFor,
  normalizeRequestDelayJitterMs,
  normalizeRequestDelayMs,
} from './requestTiming';

export const CONFIG_FILE_TYPE = 'sdstudio-config';
export const CONFIG_FILE_VERSION = 1;
export const TOKEN_FILE_TYPE = 'sdstudio-token';
export const TOKEN_FILE_VERSION = 1;

export type ConfigGroupKey = 'generation' | 'theme' | 'layout' | 'editing';

// 미리보기 표시 순서 = 배열 순서.
export const CONFIG_GROUP_ORDER: readonly ConfigGroupKey[] = [
  'generation',
  'theme',
  'layout',
  'editing',
];

// 화이트리스트(단일 출처). 필드명은 src/main/config.ts 의 Config 와 1:1.
// as const = 필드명 리터럴 유지(테스트가 Config 전 필드 분류 여부를 컴파일 시점에 확인).
export const CONFIG_GROUP_FIELDS = {
  generation: [
    'modelVersion',
    'qualityPreset',
    'disableQuality',
    'ucPreset',
    'transparentBackground',
    'furryMode',
    'removeBgQuality',
    'imageSaveSettings',
    'requestDelayMs',
    'requestDelayJitterMs',
  ] as const,
  theme: [
    'uiTheme',
    'uiThemePresets',
    'whiteMode',
    'trueDark',
    'uiFont',
    'uiClassicFinish',
  ] as const,
  layout: [
    'quickMenu',
    'quickMenuButton',
    'uiPresetLayout',
    'uiPresetIconRow',
    'uiCompanionSlots',
    'uiCombinationView',
  ] as const,
  editing: [
    'classicSceneCard',
    'legacyProjectMode',
    'legacySceneEditor',
    'legacyWorkflowMode',
    'sceneToolbarLegacyText',
  ] as const,
};
// 형식 확인(없는 필드명이면 typecheck 실패).
const GROUP_FIELDS_TYPED: Record<ConfigGroupKey, readonly (keyof Config)[]> = CONFIG_GROUP_FIELDS;
void GROUP_FIELDS_TYPED;

// 절대 담지 않는 필드(기기 고유·경로·권한·토큰 순회·배치 구조 등). 화이트리스트와
// 겹치지 않는지 jest 로 확인한다. 문서 목적의 목록이며 필터는 화이트리스트만 쓴다.
export const CONFIG_SYNC_EXCLUDED = [
  'saveLocation',
  'uuid',
  'noIpCheck',
  'useCUDA',
  'useLocalBgRemoval',
  'modelType',
  'imageEditor',
  'refreshImage',
  'defaultExportFolder',
  'downloadSettings',
  'autoConvertWebp',
  'autoConvertWebpQuality',
  'exportConcurrency',
  'storageWriteGuard',
  'delayTime',
  'wdTaggerModel',
  'notifPermissionDeclined',
  'batteryPermissionDeclined',
  'uiMobileV2Parts',
  'mobileV2IntroDone',
  'genWidget',
  'uiLayoutTemplate',
  'uiLayoutSlots',
  'uiFloatViewMode',
  'uiToolbar',
  'allowDuplicateProjectOpen',
  'multiTokenAutoRotate',
  'multiTokenRotateWarningPercent',
  'multiTokenRotateTargetPercent',
  'multiTokenBalanceRotate',
  'multiTokenRotateBalancePercent',
  'syncFolder',
] as const;
const EXCLUDED_TYPED: readonly (keyof Config)[] = CONFIG_SYNC_EXCLUDED;
void EXCLUDED_TYPED;

type FieldKind =
  | 'boolean'
  | 'string'
  | 'object'
  | 'stringArray'
  | 'themePresets'
  | 'delayMs'
  | 'delayJitterMs';

const FIELD_KIND: Partial<Record<keyof Config, FieldKind>> = {
  modelVersion: 'string',
  qualityPreset: 'string',
  disableQuality: 'boolean',
  ucPreset: 'string',
  transparentBackground: 'boolean',
  furryMode: 'boolean',
  removeBgQuality: 'string',
  imageSaveSettings: 'object',
  requestDelayMs: 'delayMs',
  requestDelayJitterMs: 'delayJitterMs',
  uiTheme: 'object',
  uiThemePresets: 'themePresets',
  whiteMode: 'boolean',
  trueDark: 'boolean',
  uiFont: 'string',
  uiClassicFinish: 'boolean',
  quickMenu: 'stringArray',
  quickMenuButton: 'boolean',
  uiPresetLayout: 'object',
  uiPresetIconRow: 'boolean',
  uiCompanionSlots: 'object',
  uiCombinationView: 'string',
  classicSceneCard: 'boolean',
  legacyProjectMode: 'boolean',
  legacySceneEditor: 'boolean',
  legacyWorkflowMode: 'boolean',
  sceneToolbarLegacyText: 'boolean',
};

// 사용자에게 보이는 문구는 전부 여기 한 곳에 둔다.
export const CONFIG_SYNC_TEXT = {
  sectionTitle: '환경설정 내보내기 / 불러오기',
  sectionDescription:
    '생성 설정·테마·UI 배치·편집 방식을 파일로 옮겨 다른 기기(PC·모바일)와 맞춥니다. 저장 위치·폴더 경로·기기 권한 같은 기기 고유 설정은 담지 않습니다.',
  exportButton: '설정 내보내기',
  importButton: '설정 불러오기',
  savedOnlyNote: '저장 안 된 변경은 담기지 않습니다. 저장된 설정을 내보냅니다.',
  exportSavedOnly: '저장된 설정을 내보냅니다. (화면의 저장 안 된 변경은 담기지 않습니다)',
  exported: '환경설정 파일을 내보냈습니다.',
  exportFailed: (reason: string) => `환경설정 내보내기에 실패했습니다: ${reason}`,
  groupLabel: {
    generation: '생성 설정',
    theme: '테마',
    layout: 'UI 배치',
    editing: '편집 방식',
  } as Record<ConfigGroupKey, string>,
  // 불러오기
  unsavedConfirm:
    '환경설정 화면에 저장 안 된 변경이 있습니다. 불러오기를 계속하면 저장 안 된 변경이 사라집니다. 계속할까요?',
  unsavedConfirmButton: '계속',
  notConfigFile: '환경설정 파일이 아닙니다. SDStudio 에서 내보낸 sdstudio-config 파일을 골라 주세요.',
  newerVersion:
    '이 환경설정 파일은 더 새로운 버전의 SDStudio 에서 만들어졌습니다. 앱을 업데이트한 뒤 불러와 주세요.',
  readFailed: '파일을 읽지 못했습니다.',
  noChanges: '불러올 파일의 설정이 지금 설정과 같습니다. 바뀌는 항목이 없습니다.',
  previewTitle: '환경설정 불러오기',
  previewSource: (platform: string, appVersion: string, createdAt: string) =>
    `${platform === 'android' ? '모바일' : 'PC'}${appVersion ? ` · v${appVersion}` : ''}${createdAt ? ` · ${createdAt}` : ''} 에서 내보낸 파일`,
  previewHint: '켠 필드군만 바꿉니다. 바뀌는 항목이 없는 군은 고를 수 없습니다.',
  previewThemePresetNote: '내 테마 프리셋은 이름이 없는 것만 추가합니다(기존 프리셋은 그대로).',
  groupChanges: (n: number) => (n > 0 ? `바뀌는 항목 ${n}개` : '바뀌는 항목 없음'),
  previewApply: '불러오기',
  previewCancel: '취소',
  // 덮어쓰기 확인(importFlow.confirmOverwrite 형식): 「기존 <itemLabel> N개를 덮어씁니다…」
  itemLabel: '환경설정 항목',
  doneLabel: '환경설정',
  applyFailed: (reason: string) => `환경설정을 적용하지 못했습니다: ${reason}`,
  // 토큰
  tokenExportLabel: 'NovelAI 토큰 파일도 함께 내보내기',
  tokenExportDescription:
    '토큰은 설정 파일과 따로 sdstudio-token 파일로 저장됩니다. 내보낸 뒤에는 이 선택이 다시 꺼집니다.',
  tokenWarning:
    '토큰은 암호화되지 않은 채 파일에 들어갑니다. 이 파일을 가진 사람은 내 NovelAI 계정으로 생성할 수 있습니다. 개인 드라이브에만 두세요.',
  tokenWarningConfirm: '이해했습니다',
  tokenImportButton: '토큰 파일 불러오기',
  tokenImportDescription:
    '다른 기기에서 내보낸 토큰 파일의 토큰을 토큰 프리셋에 추가합니다. 같은 토큰·같은 이름은 건너뛰고, 지금 쓰는 토큰은 바꾸지 않습니다.',
  notTokenFile: '토큰 파일이 아닙니다. SDStudio 에서 내보낸 sdstudio-token 파일을 골라 주세요.',
  noToken: '내보낼 토큰이 없습니다. 로그인하거나 토큰 프리셋을 저장한 뒤 다시 시도해 주세요.',
  tokenExported: '토큰 파일을 내보냈습니다. 개인 드라이브에만 보관해 주세요.',
  tokenExportFailed: (reason: string) => `토큰 파일 내보내기에 실패했습니다: ${reason}`,
  tokenImportFailed: (reason: string) => `토큰 불러오기에 실패했습니다: ${reason}`,
  tokenDoneLabel: 'NovelAI 토큰',
  currentTokenName: '가져온 토큰',
};

// ── 값 검사·비교 ──

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeThemePresets(v: unknown): NonNullable<Config['uiThemePresets']> | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: NonNullable<Config['uiThemePresets']> = [];
  for (const p of v) {
    if (
      isPlainObject(p) &&
      typeof p.name === 'string' &&
      p.name.trim() &&
      typeof p.whiteMode === 'boolean' &&
      isPlainObject(p.theme) &&
      (p.trueDark === undefined || typeof p.trueDark === 'boolean')
    ) {
      out.push(clone(p) as any);
    }
  }
  return out;
}

// 받은 값 → 적용할 값. null = 「설정 안 됨」(기본값으로 되돌림), undefined = 형식 불일치(건너뜀).
function sanitizeFieldValue(field: keyof Config, v: unknown): unknown | null | undefined {
  if (v === null) return null;
  switch (FIELD_KIND[field]) {
    case 'boolean':
      return typeof v === 'boolean' ? v : undefined;
    case 'string':
      return typeof v === 'string' ? v : undefined;
    case 'object':
      return isPlainObject(v) ? clone(v) : undefined;
    case 'stringArray':
      return Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...v] : undefined;
    case 'themePresets':
      return sanitizeThemePresets(v);
    // 지연(ms): 숫자만 받고 범위를 보정한다(음수 → 0, 상한 초과 → 상한).
    case 'delayMs':
      return typeof v === 'number' && Number.isFinite(v) ? normalizeRequestDelayMs(v) : undefined;
    case 'delayJitterMs':
      return typeof v === 'number' && Number.isFinite(v) ? normalizeRequestDelayJitterMs(v) : undefined;
    default:
      return undefined;
  }
}

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

// 비교용 정규화: 화이트리스트의 불리언은 전부 「없음 = false」로 해석된다(ConfigScreen·
// generationSettings 의 ?? false). 없음과 false 를 같은 값으로 본다.
function comparable(field: keyof Config, v: unknown): unknown {
  if (FIELD_KIND[field] === 'boolean') return v === true;
  // 지연은 「없음 = 기본값」(기본 1초·랜덤 0)으로 읽힌다 — 없음과 기본값을 같은 값으로 본다.
  if (FIELD_KIND[field] === 'delayMs') return normalizeRequestDelayMs(v);
  if (FIELD_KIND[field] === 'delayJitterMs') return normalizeRequestDelayJitterMs(v);
  // 객체형(테마 색·요소 순서 등)은 빈 객체와 없음이 같은 뜻(저장 시 {} 로 쓰는 필드가 있다).
  if (FIELD_KIND[field] === 'object' && isPlainObject(v) && Object.keys(v).length === 0) {
    return null;
  }
  return v === undefined || v === null ? null : v;
}

// 키 순서와 무관한 깊은 비교(JSON 값 한정).
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => jsonEqual(a[k], b[k]));
  }
  return false;
}

// 테마 프리셋 이름 합집합: 기존 항목은 그대로, 받은 것 중 이름이 없는 것만 뒤에 추가.
export function mergeThemePresets(
  current: Config['uiThemePresets'],
  incoming: Config['uiThemePresets'],
): NonNullable<Config['uiThemePresets']> {
  const base = Array.isArray(current) ? current.map((p) => clone(p)) : [];
  const names = new Set(base.map((p) => p.name));
  for (const p of incoming ?? []) {
    if (names.has(p.name)) continue;
    names.add(p.name);
    base.push(clone(p));
  }
  return base;
}

// ── 내보내기 ──

export interface ConfigExportMeta {
  createdAt: string;
  appVersion: string;
  platform: 'pc' | 'android';
}

export interface ConfigExportFile extends ConfigExportMeta {
  type: typeof CONFIG_FILE_TYPE;
  version: number;
  groups: Record<ConfigGroupKey, Record<string, unknown>>;
}

export function buildConfigExport(config: Config, meta: ConfigExportMeta): ConfigExportFile {
  const groups = {} as ConfigExportFile['groups'];
  for (const g of CONFIG_GROUP_ORDER) {
    const out: Record<string, unknown> = {};
    for (const field of CONFIG_GROUP_FIELDS[g]) {
      const v = (config as any)?.[field];
      out[field] = v === undefined ? null : clone(v);
    }
    groups[g] = out;
  }
  return {
    type: CONFIG_FILE_TYPE,
    version: CONFIG_FILE_VERSION,
    createdAt: meta.createdAt,
    appVersion: meta.appVersion,
    platform: meta.platform,
    groups,
  };
}

// ── 불러오기 ──

// 적용 가능한 값만 남긴 받은 설정. 군별로 「파일에 있던 필드 → 값(null=설정 안 됨)」.
export type IncomingConfigGroups = Partial<Record<ConfigGroupKey, Partial<Record<keyof Config, unknown>>>>;

export interface ParsedConfigImport {
  createdAt: string;
  appVersion: string;
  platform: string;
  groups: IncomingConfigGroups;
}

export type ParseConfigResult =
  | { ok: true; value: ParsedConfigImport }
  | { ok: false; error: 'not-config' | 'newer-version' };

export function parseConfigImport(json: unknown): ParseConfigResult {
  let data: any = json;
  if (typeof json === 'string') {
    try {
      data = JSON.parse(json);
    } catch (e) {
      return { ok: false, error: 'not-config' };
    }
  }
  if (!isPlainObject(data) || data.type !== CONFIG_FILE_TYPE) {
    return { ok: false, error: 'not-config' };
  }
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    return { ok: false, error: 'not-config' };
  }
  if (data.version > CONFIG_FILE_VERSION) return { ok: false, error: 'newer-version' };
  if (!isPlainObject(data.groups)) return { ok: false, error: 'not-config' };

  const groups: IncomingConfigGroups = {};
  for (const g of CONFIG_GROUP_ORDER) {
    const src = (data.groups as any)[g];
    if (!isPlainObject(src)) continue;
    const out: Partial<Record<keyof Config, unknown>> = {};
    for (const field of CONFIG_GROUP_FIELDS[g]) {
      if (!Object.prototype.hasOwnProperty.call(src, field)) continue;
      const v = sanitizeFieldValue(field, src[field]);
      if (v === undefined) continue; // 형식 불일치 — 건너뜀
      out[field] = v;
    }
    groups[g] = out;
  }
  return {
    ok: true,
    value: {
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
      appVersion: typeof data.appVersion === 'string' ? data.appVersion : '',
      platform: typeof data.platform === 'string' ? data.platform : '',
      groups,
    },
  };
}

// 필드 하나를 적용한 결과 값(undefined = 키 제거).
function resolvedValue(current: Config, field: keyof Config, incoming: unknown): unknown {
  if (field === 'uiThemePresets') {
    const merged = mergeThemePresets(current.uiThemePresets, (incoming as any) ?? []);
    return merged.length > 0 ? merged : current.uiThemePresets;
  }
  return incoming === null ? undefined : incoming;
}

export interface ConfigGroupDiff {
  group: ConfigGroupKey;
  changed: (keyof Config)[];
}

export function diffConfigGroups(current: Config, incoming: IncomingConfigGroups): ConfigGroupDiff[] {
  return CONFIG_GROUP_ORDER.map((group) => {
    const src = incoming[group] ?? {};
    const changed: (keyof Config)[] = [];
    for (const field of CONFIG_GROUP_FIELDS[group]) {
      if (!Object.prototype.hasOwnProperty.call(src, field)) continue;
      const next = resolvedValue(current, field, (src as any)[field]);
      if (!jsonEqual(comparable(field, (current as any)[field]), comparable(field, next))) {
        changed.push(field);
      }
    }
    return { group, changed };
  });
}

export function countConfigChanges(diff: ConfigGroupDiff[], enabled?: Partial<Record<ConfigGroupKey, boolean>>): number {
  return diff.reduce(
    (n, d) => n + (enabled && !enabled[d.group] ? 0 : d.changed.length),
    0,
  );
}

// current 위에 켠 군의 받은 값을 덮은 새 config(current 는 바꾸지 않는다).
// uiThemePresets 는 이름 합집합, 그 외는 받은 값으로 교체(null = 키 제거 = 기본값).
export function applyConfigGroups(
  current: Config,
  incoming: IncomingConfigGroups,
  enabledGroups: Partial<Record<ConfigGroupKey, boolean>>,
): Config {
  const next: Config = { ...current };
  for (const group of CONFIG_GROUP_ORDER) {
    if (!enabledGroups[group]) continue;
    const src = incoming[group];
    if (!src) continue;
    for (const field of CONFIG_GROUP_FIELDS[group]) {
      if (!Object.prototype.hasOwnProperty.call(src, field)) continue;
      const v = resolvedValue(current, field, (src as any)[field]);
      if (v === undefined) delete (next as any)[field];
      else (next as any)[field] = clone(v);
    }
  }
  // 요청 지연을 바꿨으면 옛 키 delayTime 에도 min(…, 1000) 을 병기한다(롤백 호환 — requestTiming).
  if (next.requestDelayMs !== current.requestDelayMs) {
    next.delayTime = legacyDelayTimeFor(next.requestDelayMs);
  }
  return next;
}

// 사용자에게 보일 필드 이름.
export const CONFIG_FIELD_LABEL: Partial<Record<keyof Config, string>> = {
  modelVersion: '모델',
  qualityPreset: '품질 태그',
  disableQuality: '품질 태그 끄기',
  ucPreset: '네거티브 기본 프리셋',
  transparentBackground: '투명 배경',
  furryMode: '퍼리 모드',
  removeBgQuality: '배경 제거 품질',
  imageSaveSettings: '이미지 저장 방식',
  requestDelayMs: '요청 사이 지연',
  requestDelayJitterMs: '랜덤 지연',
  uiTheme: '테마 색',
  uiThemePresets: '내 테마 프리셋',
  whiteMode: '화이트 모드',
  trueDark: '트루 다크',
  uiFont: '글꼴',
  uiClassicFinish: '클래식 마감',
  quickMenu: '퀵 메뉴 구성',
  quickMenuButton: '퀵 메뉴 버튼',
  uiPresetLayout: '프리셋 요소 순서',
  uiPresetIconRow: '프리셋 하단 아이콘 행',
  uiCompanionSlots: '동반 버튼 위치',
  uiCombinationView: '조합 에디터 보기',
  classicSceneCard: '클래식 씬 카드',
  legacyProjectMode: '예전 프로젝트 모드',
  legacySceneEditor: '예전 씬 에디터',
  legacyWorkflowMode: '예전 작업 모드',
  sceneToolbarLegacyText: '씬 툴바 글자 표시',
};

export function configFieldLabel(field: keyof Config): string {
  return CONFIG_FIELD_LABEL[field] ?? String(field);
}

// ── 토큰 파일 ──

export interface TokenFileEntry {
  name: string;
  token: string;
}

export interface TokenExportFile {
  type: typeof TOKEN_FILE_TYPE;
  version: number;
  createdAt: string;
  profiles: TokenFileEntry[];
}

export function buildTokenExport(profiles: TokenFileEntry[], createdAt: string): TokenExportFile {
  return {
    type: TOKEN_FILE_TYPE,
    version: TOKEN_FILE_VERSION,
    createdAt,
    profiles: profiles.map((p) => ({ name: p.name, token: p.token })),
  };
}

export type ParseTokenResult =
  | { ok: true; profiles: TokenFileEntry[]; invalid: number }
  | { ok: false; error: 'not-token' | 'newer-version' };

export function parseTokenImport(json: unknown): ParseTokenResult {
  let data: any = json;
  if (typeof json === 'string') {
    try {
      data = JSON.parse(json);
    } catch (e) {
      return { ok: false, error: 'not-token' };
    }
  }
  if (!isPlainObject(data) || data.type !== TOKEN_FILE_TYPE || !Array.isArray(data.profiles)) {
    return { ok: false, error: 'not-token' };
  }
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    return { ok: false, error: 'not-token' };
  }
  if (data.version > TOKEN_FILE_VERSION) return { ok: false, error: 'newer-version' };
  const profiles: TokenFileEntry[] = [];
  let invalid = 0;
  for (const p of data.profiles) {
    if (isPlainObject(p) && typeof p.name === 'string' && typeof p.token === 'string') {
      profiles.push({ name: p.name, token: p.token });
    } else {
      invalid++;
    }
  }
  return { ok: true, profiles, invalid };
}

// 토큰 추가 계획(추가만): 같은 토큰·같은 이름(대소문자 무시)·빈 값·40자 넘는 이름은 건너뛴다.
// 파일 안에서 서로 겹치는 항목도 처음 것만 추가한다. 이름 규칙은 saveTokenProfile 과 같다.
export const TOKEN_NAME_MAX = 40;

export function planTokenImport(
  existing: TokenFileEntry[],
  incoming: TokenFileEntry[],
): { toAdd: TokenFileEntry[]; skipped: number } {
  const names = new Set(existing.map((p) => p.name.trim().toLowerCase()));
  const tokens = new Set(existing.map((p) => p.token.trim()));
  const toAdd: TokenFileEntry[] = [];
  let skipped = 0;
  for (const p of incoming) {
    const name = p.name.trim();
    const token = p.token.trim();
    if (!name || !token || name.length > TOKEN_NAME_MAX) {
      skipped++;
      continue;
    }
    if (names.has(name.toLowerCase()) || tokens.has(token)) {
      skipped++;
      continue;
    }
    names.add(name.toLowerCase());
    tokens.add(token);
    toAdd.push({ name, token });
  }
  return { toAdd, skipped };
}

// base64(파일 원본 바이트) → UTF-8 문자열. PC 선택기 경로는 readBinaryFile 로 읽는다.
export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}
