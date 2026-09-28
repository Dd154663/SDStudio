// 프로젝트 템플릿 백업 형식·병합 계획 (드라이브 동기화 C안 ④, 2026-09-28)
//
// 백업 tar = `_manifest.json`(type sdstudio-project-templates, version 1)
//          + `project_templates.json`(앱 파일과 같은 형식 { version: 1, templates })
//          + `project_template_images/<파일명>`(담긴 템플릿이 참조하는 이미지만)
//
// - 담는 것: 전역 템플릿만. 폴더 전용 로컬 템플릿(folderLocal — 폴더 기본 템플릿의
//   실체)과 배지 색(폴더 지정의 정체성)은 기기의 폴더 구성에 매인 값이라 빼고 담는다.
//   폴더 기본 템플릿 지정·적용 기록은 원래 다른 파일(templates.json)이라 담기지 않는다.
// - 불러오기: 이름 충돌은 전역 템플릿 이름 기준으로 센다(관리 화면에 보이는 목록).
//   새 이름으로 추가 = 새 id + 이름 뒤 (2)(3)…, 건너뛰기 = 제외, 덮어쓰기 = 기존 템플릿의
//   id 를 유지한 채 내용만 갱신(폴더 지정·적용 기록 참조 보존, 한 기존 항목은 한 번만).
//   이름은 전 템플릿에서 유일해야 하므로(ProjectTemplateService.create·rename 규칙)
//   폴더 로컬 템플릿과만 같은 이름이면 정책과 무관하게 새 이름으로 추가한다.
// - 이미지는 항상 새 파일명으로 복사하고, 백업에 파일이 없는 참조는 버린다.
//
// 순수 함수만 둔다(서비스·backend 의존 없음) — __tests__/projectTemplateBackup.test.ts.

import type { IProjectTemplateEntry } from './ProjectTemplateService';

export const PROJECT_TEMPLATE_BACKUP = {
  label: '프로젝트 템플릿',
  manifestType: 'sdstudio-project-templates',
  // tar 안 경로(앱 데이터 파일·폴더 이름과 같게 둔다)
  storeName: 'project_templates.json',
  imageDir: 'project_template_images',
} as const;

export type TemplateImportPolicy = 'rename' | 'skip' | 'overwrite';

// 템플릿 "내용" — id·이름·시각·폴더 표식을 뺀 부분(덮어쓰기가 바꾸는 범위).
export type TemplateContent = Pick<
  IProjectTemplateEntry,
  'preset' | 'characterPresets' | 'vibes' | 'characterReferences' | 'scenes'
>;

export interface BackupTemplate extends TemplateContent {
  name: string;
  createdAt?: number;
}

export type TemplateImportStep =
  | { kind: 'add'; name: string }
  | { kind: 'skip' }
  | { kind: 'overwrite'; targetId: string };

// 경로 조각을 뺀 파일명. 토큰은 원래 '<uuid>.<ext>' 파일명이다.
export function imageTokenBase(token: unknown): string {
  if (typeof token !== 'string') return '';
  return token.replace(/\\/g, '/').split('/').pop() || '';
}

// 백업(외부 파일)에서 온 이미지 파일명이 템플릿 이미지 폴더 밖을 가리키지 않는지.
export function isSafeImageToken(base: string): boolean {
  return (
    typeof base === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(base) &&
    !base.includes('..')
  );
}

// 복사본 확장자(원본 보존, 이상한 값이면 png).
export function imageFileExt(base: string): string {
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'png';
}

// 템플릿이 참조하는 이미지 토큰 전부(ProjectTemplateService 의 삭제·복제와 같은 범위).
export function collectTemplateImageTokens(
  entry: Partial<TemplateContent> | null | undefined,
): string[] {
  const tokens: string[] = [];
  if (!entry) return tokens;
  if (entry.preset?.profile) tokens.push(entry.preset.profile);
  for (const cp of entry.characterPresets || []) {
    if (!cp) continue;
    for (const v of cp.vibes || []) if (v?.path) tokens.push(v.path);
    for (const r of cp.characterReferences || []) if (r?.path) tokens.push(r.path);
    if (cp.representativeImage) tokens.push(cp.representativeImage);
  }
  for (const v of entry.vibes || []) if (v?.path) tokens.push(v.path);
  for (const r of entry.characterReferences || []) if (r?.path) tokens.push(r.path);
  return tokens;
}

// 내보내기: 담을 저장 형식({ version: 1, templates })과 동반 이미지 파일명 목록.
// 입력은 바꾸지 않는다(깊은 복사).
export function buildTemplateBackupStore(templates: IProjectTemplateEntry[]): {
  store: { version: 1; templates: IProjectTemplateEntry[] };
  imageFiles: string[];
} {
  const picked: IProjectTemplateEntry[] = [];
  const images = new Set<string>();
  for (const t of templates) {
    if (!t || t.folderLocal) continue;
    const copy: IProjectTemplateEntry = JSON.parse(JSON.stringify(t));
    delete copy.folderLocal;
    delete copy.badgeColor;
    picked.push(copy);
    for (const token of collectTemplateImageTokens(copy)) {
      const base = imageTokenBase(token);
      if (isSafeImageToken(base)) images.add(base);
    }
  }
  return {
    store: { version: 1, templates: picked },
    imageFiles: Array.from(images),
  };
}

const arr = (v: any) => (Array.isArray(v) ? v : []);
const objArr = (v: any) =>
  arr(v).filter((x: any) => x && typeof x === 'object');

// 불러오기: 백업 JSON → 받을 수 있는 템플릿 목록(ProjectTemplateService.load 와 같은
// 호환 정규화 — 구형 presets 목록은 첫 항목을 1벌로). 이름 없는 항목·폴더 로컬 항목은 뺀다.
export function readBackupTemplates(store: any): BackupTemplate[] {
  const out: BackupTemplate[] = [];
  for (const t of arr(store?.templates)) {
    if (!t || typeof t !== 'object' || t.folderLocal) continue;
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    if (!name) continue;
    const preset =
      t.preset ?? (Array.isArray(t.presets) ? (t.presets[0] ?? null) : null);
    out.push({
      name,
      createdAt: typeof t.createdAt === 'number' ? t.createdAt : undefined,
      preset: preset && typeof preset === 'object' ? preset : null,
      characterPresets: objArr(t.characterPresets),
      vibes: objArr(t.vibes),
      characterReferences: objArr(t.characterReferences),
      scenes: objArr(t.scenes),
    });
  }
  return out;
}

// 이미지 토큰을 새 파일명으로 바꾼 내용 사본. map 에 없는 토큰(백업에 파일이 없던
// 참조)은 버린다 — 바이브·레퍼런스 항목째 빼고, 프로필·대표 이미지는 지운다.
export function remapTemplateImages(
  content: TemplateContent,
  map: Map<string, string>,
): TemplateContent {
  const c: TemplateContent = JSON.parse(
    JSON.stringify({
      preset: content.preset ?? null,
      characterPresets: content.characterPresets ?? [],
      vibes: content.vibes ?? [],
      characterReferences: content.characterReferences ?? [],
      scenes: content.scenes ?? [],
    }),
  );
  const keepMapped = <T extends { path?: string }>(list: T[] | undefined) =>
    (list || [])
      .filter((x) => !x?.path || map.has(x.path))
      .map((x) => (x?.path ? { ...x, path: map.get(x.path)! } : x));
  if (c.preset && c.preset.profile) {
    const next = map.get(c.preset.profile);
    if (next) c.preset.profile = next;
    else delete c.preset.profile;
  }
  for (const cp of c.characterPresets) {
    if (!cp) continue;
    if (cp.vibes) cp.vibes = keepMapped(cp.vibes);
    if (cp.characterReferences)
      cp.characterReferences = keepMapped(cp.characterReferences);
    if (cp.representativeImage) {
      const next = map.get(cp.representativeImage);
      if (next) cp.representativeImage = next;
      else delete cp.representativeImage;
    }
  }
  c.vibes = keepMapped(c.vibes);
  c.characterReferences = keepMapped(c.characterReferences);
  return c;
}

// 이름 충돌 계산 = 전역 템플릿 이름(관리 화면 목록) 기준.
export function globalTemplateNames(
  existing: Array<Pick<IProjectTemplateEntry, 'name' | 'folderLocal'>>,
): string[] {
  return existing.filter((t) => !t.folderLocal).map((t) => t.name);
}

// 들어오는 항목별 처리 계획(입력 순서 그대로).
export function planTemplateImport(
  incomingNames: string[],
  existing: Array<Pick<IProjectTemplateEntry, 'id' | 'name' | 'folderLocal'>>,
  policy: TemplateImportPolicy,
): TemplateImportStep[] {
  const globalsByName = new Map<string, string>();
  for (const t of existing) {
    if (!t.folderLocal && !globalsByName.has(t.name)) {
      globalsByName.set(t.name, t.id);
    }
  }
  const used = new Set(existing.map((t) => t.name));
  const overwritten = new Set<string>();
  const uniqueName = (name: string) => {
    if (!used.has(name)) return name;
    let i = 2;
    while (used.has(`${name} (${i})`)) i++;
    return `${name} (${i})`;
  };
  return incomingNames.map((name): TemplateImportStep => {
    const targetId = globalsByName.get(name);
    if (targetId) {
      if (policy === 'skip') return { kind: 'skip' };
      if (policy === 'overwrite' && !overwritten.has(targetId)) {
        overwritten.add(targetId);
        return { kind: 'overwrite', targetId };
      }
    }
    const finalName = uniqueName(name);
    used.add(finalName);
    return { kind: 'add', name: finalName };
  });
}
