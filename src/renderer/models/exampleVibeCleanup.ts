// 잔존 예제 프리셋 이미지 정리 (2026-11-15, 플랜 guides/plans/2026-11-15-example-vibe-cleanup.md)
//
// 배경: PR #11(cf7cb6d) 이전 버전은 빈 새 프로젝트마다 번들 예제 프리셋 3종(애니스타일·동글·선명동글)을
// 넣으면서 프리셋 PNG 원본을 그 프로젝트의 vibes/{uuid}.(PNG) 로 그대로 썼다. 사용자가 예제 프리셋을 지워도
// 그 PNG 는 남는다(프로젝트당 약 3.8 MB 정크).
//
// 안전 원칙:
//   · 식별은 「크기 일치 → 내용 SHA-256 일치」 두 단계. 해시가 다르면 절대 대상이 아니다.
//     「미참조 vibes 전부 정리」로 일반화하지 않는다(사용자 파일 오삭제 위험).
//   · 프로젝트 JSON 어디서든 그 파일명을 가리키면 「사용 중」으로 제외한다. 참조 수집은 알려진 필드
//     (프리셋 profile·vibes[].path·characterReferences[].path, 캐릭터 프리셋 representativeImage·vibes·
//     characterReferences, presetShareds, 변형 씬 preset, mirrorImage …)만 고르지 않고 JSON 전체의
//     문자열 값을 훑는다 — 알려진 필드의 상위 집합이라 새 필드가 생겨도 덜 지우는 쪽으로만 틀린다.
//   · 예외 하나(사용자 실기 피드백 2026-11-15): 퀵 생성 전용 숨김 프로젝트(templateService.quickGenName)는
//     이지 모드로 들어갈 수 없어 SDImageGenEasy 프리셋을 쓸 수 없다. 그 프로젝트에서 파일을 가리키는 곳이
//     **오직** presets.SDImageGenEasy[*].profile 뿐이면 정리 대상으로 보고, 정리 때 그 프리셋 항목을 먼저
//     지운 뒤 파일을 지운다(파일만 지우면 깨진 참조가 남는다). 다른 참조가 하나라도 있으면 종전대로 사용 중.
//   · 메모리에 로드된 프로젝트(현재 열린 프로젝트 포함)는 메모리 세션과 디스크 JSON 의 참조 합집합.
//   · 검사는 무쓰기(목록·읽기만). 정리는 사용자 확인 뒤 미참조 항목만, 직전에 참조를 한 번 더 확인한다.
//   · 경로는 projectPaths.projectPath 로만 만든다(문자열 직접 결합 금지).
//
// 이 모듈은 backend·UI 에 의존하지 않는다(의존성 주입) — 실제 연결은 exampleVibeCleanupRuntime.ts.
// jest: __tests__/exampleVibeCleanup.test.ts

import type { FileStatEntry } from '../backend';
import { formatBytes } from './googleDrive';
import { PNG_IMAGE_EXT } from './imageFormats';
import { projectPath } from './projectPaths';

export interface BundledExamplePng {
  label: string;
  fileName: string; // 제거 전 번들 자산 이름(참고용 — 프로젝트 안 파일명은 uuid)
  size: number; // bytes
  sha256: string; // 소문자 hex
}

// 단일 출처 — cf7cb6d^ 의 src/renderer/defaultassets/ 의 PNG 원본(base64 그대로 기록돼 내용 동일).
export const BUNDLED_EXAMPLE_PNGS: readonly BundledExamplePng[] = [
  {
    label: '애니스타일',
    fileName: `anime.${PNG_IMAGE_EXT}`,
    size: 1172170,
    sha256: '6455e8b8f981af592e1c41af3d767c20ebfb5dbd6df87040d20e32942c2bde0c',
  },
  {
    label: '동글',
    fileName: `round.${PNG_IMAGE_EXT}`,
    size: 1421908,
    sha256: 'b12e9418ea33cae919c62949d71256179824b50b968cea9fc7b712bb29e955a1',
  },
  {
    label: '선명동글',
    fileName: `sharpRound.${PNG_IMAGE_EXT}`,
    size: 1374084,
    sha256: '2082aa701c539cd73945c9d344a7702a58a1eb8c79c20617d1d1337428e0c242',
  },
];

/** 이지 모드 프리셋 종류(퀵 생성 전용 프로젝트 예외의 대상) */
export const EASY_PRESET_TYPE = 'SDImageGenEasy';

export interface ExampleVibeItem {
  project: string;
  fileName: string; // vibes/ 안 파일명
  label: string; // 예제 종류
  size: number;
  referenced: boolean; // true = 사용 중 — 정리 제외
  /** 퀵 생성 전용 프로젝트에서 이 파일을 profile 로만 가리키는 이지 모드 프리셋 이름 — 정리 때 함께 제거 */
  easyPresets?: string[];
}

export interface ExampleVibeScanResult {
  items: ExampleVibeItem[];
  projectsScanned: number;
  projectsFailed: string[];
  removableBytes: number; // 미참조 항목 합
}

// ── 순수 판정 ────────────────────────────────────────────────────────────

/** 경로('vibes/p/a'·'x\a' 등)의 마지막 조각 = 파일명 */
export function normalizeVibeFileName(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

const MAX_REF_STRING = 2048; // 이보다 긴 문자열(프롬프트·data URI 등)은 파일명이 아니다
const MAX_DEPTH = 64;

/** 참조 집합 — general = 아래 easyProfiles 를 뺀 모든 문자열 참조, easyProfiles = 파일명 → 이지 프리셋 이름들 */
export interface VibeRefs {
  general: Set<string>;
  easyProfiles: Map<string, string[]>;
}

function easyPresetList(json: any): any[] {
  const presets = json?.presets;
  if (!presets) return [];
  const list = presets instanceof Map ? presets.get(EASY_PRESET_TYPE) : presets[EASY_PRESET_TYPE];
  return Array.isArray(list) ? list : [];
}

/**
 * 프로젝트 JSON(또는 그와 같은 모양의 객체) 안에서 파일을 가리킬 수 있는 문자열을 모두 모은다.
 * presets.SDImageGenEasy[*].profile 만 따로 떼어(easyProfiles) 기록하고, 나머지는 general.
 */
export function collectVibeRefs(projectJsonLike: unknown): VibeRefs {
  const general = new Set<string>();
  const easyProfiles = new Map<string, string[]>();
  const easyObjs = new Set<object>();
  for (const p of easyPresetList(projectJsonLike)) {
    if (!p || typeof p !== 'object') continue;
    easyObjs.add(p);
    if (typeof p.profile === 'string' && p.profile) {
      const f = normalizeVibeFileName(p.profile);
      const names = easyProfiles.get(f) ?? [];
      names.push(String(p.name ?? ''));
      easyProfiles.set(f, names);
    }
  }
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number) => {
    if (depth > MAX_DEPTH || v == null) return;
    if (typeof v === 'string') {
      if (v && v.length <= MAX_REF_STRING) general.add(normalizeVibeFileName(v));
      return;
    }
    if (typeof v !== 'object') return;
    if (seen.has(v as object)) return;
    seen.add(v as object);
    if (v instanceof Map) {
      for (const [k, x] of v) {
        walk(k, depth + 1);
        walk(x, depth + 1);
      }
      return;
    }
    if (Array.isArray(v) || v instanceof Set) {
      for (const x of v as Iterable<unknown>) walk(x, depth + 1);
      return;
    }
    const isEasy = easyObjs.has(v as object);
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (isEasy && k === 'profile') continue; // easyProfiles 로 따로 셌다
      walk(x, depth + 1);
    }
  };
  walk(projectJsonLike, 0);
  return { general, easyProfiles };
}

/** 모든 참조(일반 + 이지 프리셋 profile)의 파일명 집합 */
export function collectReferencedVibeFiles(projectJsonLike: unknown): Set<string> {
  const r = collectVibeRefs(projectJsonLike);
  const out = new Set(r.general);
  for (const f of r.easyProfiles.keys()) out.add(f);
  return out;
}

function mergeRefs(a: VibeRefs, b: VibeRefs): VibeRefs {
  const general = new Set(a.general);
  for (const x of b.general) general.add(x);
  const easyProfiles = new Map<string, string[]>();
  for (const src of [a.easyProfiles, b.easyProfiles]) {
    for (const [f, names] of src) {
      const cur = easyProfiles.get(f) ?? [];
      for (const n of names) if (!cur.includes(n)) cur.push(n);
      easyProfiles.set(f, cur);
    }
  }
  return { general, easyProfiles };
}

/**
 * 파일 하나의 판정. 퀵 생성 전용 프로젝트이고 그 파일을 가리키는 곳이 이지 프리셋 profile 뿐이면
 * { referenced: false, easyPresets }, 다른 참조가 있으면 사용 중, 참조가 없으면 미참조.
 */
export function judgeVibeFile(
  refs: VibeRefs,
  fileName: string,
  isQuickGenProject: boolean,
): { referenced: boolean; easyPresets?: string[] } {
  if (refs.general.has(fileName)) return { referenced: true };
  const easy = refs.easyProfiles.get(fileName);
  if (!easy || easy.length === 0) return { referenced: false };
  // 이름 없는 프리셋은 이름으로 지울 수 없다 — 안전하게 사용 중
  if (!isQuickGenProject || easy.some((n) => !n)) return { referenced: true };
  return { referenced: false, easyPresets: [...easy] };
}

export function isExampleCandidateSize(size: number): boolean {
  return BUNDLED_EXAMPLE_PNGS.some((p) => p.size === size);
}

export function matchExampleHash(hex: string): BundledExamplePng | undefined {
  const h = (hex || '').toLowerCase();
  return BUNDLED_EXAMPLE_PNGS.find((p) => p.sha256 === h);
}

/** readDataFile 결과(Electron·Android 모두 data URI, 혹시 모를 순수 base64 도 허용) → 바이트 */
export function dataFileToBytes(data: string): Uint8Array {
  const s = String(data ?? '');
  const b64 = s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function sha256HexWebCrypto(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis as any).crypto?.subtle;
  if (!subtle) throw new Error('이 환경에서는 SHA-256(WebCrypto)을 사용할 수 없습니다.');
  const digest: ArrayBuffer = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── 요약 문구 ────────────────────────────────────────────────────────────

export const EXAMPLE_VIBE_TEXT = {
  label: '예제 프리셋 잔존 이미지 정리',
  description:
    '이전 버전이 새 프로젝트마다 넣던 예제 프리셋(애니스타일·동글·선명동글)의 이미지가 프리셋을 지운 뒤에도 vibes 폴더에 남습니다. 검사는 파일을 바꾸지 않습니다.',
  none: '남은 예제 이미지가 없습니다.',
  referencedBadge: '사용 중 — 제외',
  easyPresetBadge: '이지 모드 프리셋 — 퀵 생성 전용 프로젝트에서는 쓸 수 없음',
} as const;

export function removableItems(scan: ExampleVibeScanResult): ExampleVibeItem[] {
  return scan.items.filter((i) => !i.referenced);
}

/** 함께 제거할 이지 모드 프리셋 수(프로젝트·이름 중복 제거) */
export function countEasyPresetsToRemove(items: readonly ExampleVibeItem[]): number {
  const keys = new Set<string>();
  for (const i of items) {
    if (i.referenced) continue;
    for (const n of i.easyPresets ?? []) keys.add(i.project + '\u0000' + n);
  }
  return keys.size;
}

/** 「프로젝트 n개 · 파일 m개 · 총 X MB[ · 이지 모드 프리셋 k개도 함께 제거]」 + 사용 중 k개 제외 안내 */
export function summarizeExampleVibeScan(scan: ExampleVibeScanResult): {
  summary: string;
  referencedNote: string | null;
  easyPresetCount: number;
} {
  const rem = removableItems(scan);
  const projects = new Set(rem.map((i) => i.project)).size;
  const referenced = scan.items.length - rem.length;
  const easy = countEasyPresetsToRemove(rem);
  return {
    summary:
      `프로젝트 ${projects}개 · 파일 ${rem.length}개 · 총 ${formatBytes(scan.removableBytes)}` +
      (easy > 0 ? ` · 이지 모드 프리셋 ${easy}개도 함께 제거` : ''),
    referencedNote:
      referenced > 0 ? `프로젝트에서 사용 중인 ${referenced}개는 정리에서 제외합니다.` : null,
    easyPresetCount: easy,
  };
}

// ── 검사(무쓰기) ─────────────────────────────────────────────────────────

export interface ExampleVibeScanDeps {
  /** 활성 프로젝트 이름(휴지통 제외) */
  listProjects(): readonly string[];
  /** 메모리에 로드된 세션(현재 열린 프로젝트 포함)이면 그 객체(또는 toJSON 결과), 아니면 undefined */
  loadedProject(name: string): unknown | undefined;
  /** 디스크 project JSON 원문(쓰기 없음) */
  readProjectJson(name: string): Promise<string>;
  listFilesWithStats(dir: string): Promise<FileStatEntry[]>;
  readDataFile(path: string): Promise<string>;
  /** 퀵 생성 전용 숨김 프로젝트 이름(없으면 undefined) — 이 이름 하나만 이지 프리셋 예외 대상 */
  quickGenProjectName?(): string | undefined | null;
  sha256Hex?(bytes: Uint8Array): Promise<string>;
}

/**
 * 프로젝트 하나의 참조. 메모리 세션이 있으면 메모리 ∪ 디스크(디스크 실패는 무시),
 * 없으면 디스크만(실패 시 throw — 참조를 모르면 그 프로젝트는 판정하지 않는다).
 */
export async function collectProjectVibeRefs(
  deps: Pick<ExampleVibeScanDeps, 'loadedProject' | 'readProjectJson'>,
  name: string,
): Promise<VibeRefs> {
  const loaded = deps.loadedProject(name);
  if (loaded !== undefined && loaded !== null) {
    const json =
      typeof (loaded as any).toJSON === 'function' ? (loaded as any).toJSON() : loaded;
    let refs = collectVibeRefs(json);
    try {
      refs = mergeRefs(refs, collectVibeRefs(JSON.parse(await deps.readProjectJson(name))));
    } catch (e) {}
    return refs;
  }
  return collectVibeRefs(JSON.parse(await deps.readProjectJson(name)));
}

/** 모든 참조 파일명 집합(일반 + 이지 프리셋 profile) */
export async function collectProjectRefs(
  deps: Pick<ExampleVibeScanDeps, 'loadedProject' | 'readProjectJson'>,
  name: string,
): Promise<Set<string>> {
  const r = await collectProjectVibeRefs(deps, name);
  const out = new Set(r.general);
  for (const f of r.easyProfiles.keys()) out.add(f);
  return out;
}

export async function scanExampleVibes(
  deps: ExampleVibeScanDeps,
): Promise<ExampleVibeScanResult> {
  const hash = deps.sha256Hex ?? sha256HexWebCrypto;
  const quick = deps.quickGenProjectName?.() || undefined;
  const items: ExampleVibeItem[] = [];
  const projectsFailed: string[] = [];
  let projectsScanned = 0;
  for (const project of deps.listProjects()) {
    try {
      const dir = projectPath('vibes', project);
      let stats: FileStatEntry[];
      try {
        stats = (await deps.listFilesWithStats(dir)) ?? [];
      } catch (e) {
        stats = []; // vibes 폴더 없음
      }
      const candidates = stats.filter((s) => isExampleCandidateSize(s.size));
      const found: Omit<ExampleVibeItem, 'referenced'>[] = [];
      for (const c of candidates) {
        const bytes = dataFileToBytes(
          await deps.readDataFile(projectPath('vibes', project, c.name)),
        );
        const hit = matchExampleHash(await hash(bytes));
        if (hit && hit.size === c.size) {
          found.push({ project, fileName: c.name, label: hit.label, size: c.size });
        }
      }
      if (found.length) {
        const refs = await collectProjectVibeRefs(deps, project);
        for (const f of found) {
          const j = judgeVibeFile(refs, f.fileName, project === quick);
          items.push(
            j.easyPresets
              ? { ...f, referenced: j.referenced, easyPresets: j.easyPresets }
              : { ...f, referenced: j.referenced },
          );
        }
      }
      projectsScanned++;
    } catch (e) {
      projectsFailed.push(project);
    }
  }
  return {
    items,
    projectsScanned,
    projectsFailed,
    removableBytes: items.filter((i) => !i.referenced).reduce((s, i) => s + i.size, 0),
  };
}

// ── 정리(사용자 확인 뒤) ─────────────────────────────────────────────────

export interface ExampleVibeDeleteDeps {
  isMobile: boolean;
  trashFile(path: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  /**
   * 삭제 직전 참조 재확인(있으면). 실패하면 그 프로젝트 항목은 지우지 않는다.
   * 이지 프리셋 항목(easyPresets)은 이 재확인이 반드시 있어야 지운다.
   */
  collectRefs?(project: string): Promise<VibeRefs>;
  /** 퀵 생성 전용 프로젝트 이름(재확인 판정용) */
  quickGenProjectName?(): string | undefined | null;
  /** 이지 모드 프리셋 항목 제거(세션을 올려 removePreset). 실패하면 그 파일은 지우지 않는다. */
  removeEasyPreset?(project: string, presetName: string, fileName: string): Promise<void>;
}

export async function deleteExampleVibes(
  items: readonly ExampleVibeItem[],
  deps: ExampleVibeDeleteDeps,
  onProgress?: (done: number, total: number) => void,
): Promise<{ deleted: number; failed: string[]; presetsRemoved: number }> {
  const targets = items.filter((i) => i.referenced === false);
  const quick = deps.quickGenProjectName?.() || undefined;
  let deleted = 0;
  let presetsRemoved = 0;
  const failed: string[] = [];
  const refCache = new Map<string, VibeRefs | null>();
  for (let i = 0; i < targets.length; i++) {
    const it = targets[i];
    const label = `${it.project}/${it.fileName}`;
    try {
      const wantsEasy = !!it.easyPresets && it.easyPresets.length > 0;
      if (deps.collectRefs) {
        if (!refCache.has(it.project)) {
          try {
            refCache.set(it.project, await deps.collectRefs(it.project));
          } catch (e) {
            refCache.set(it.project, null);
          }
        }
        const refs = refCache.get(it.project);
        // 참조를 확인할 수 없거나, 검사 때와 판정이 달라졌으면 지우지 않는다
        const now = refs ? judgeVibeFile(refs, it.fileName, it.project === quick) : null;
        const sameEasy =
          !!now &&
          !now.referenced &&
          (wantsEasy
            ? !!now.easyPresets &&
              now.easyPresets.length === it.easyPresets!.length &&
              now.easyPresets.every((n) => it.easyPresets!.includes(n))
            : !now.easyPresets);
        if (!sameEasy) {
          failed.push(label);
          onProgress?.(i + 1, targets.length);
          continue;
        }
      } else if (wantsEasy) {
        failed.push(label); // 재확인 없이 프리셋을 지우지 않는다
        onProgress?.(i + 1, targets.length);
        continue;
      }
      if (wantsEasy) {
        if (!deps.removeEasyPreset) throw new Error('이지 프리셋 제거 경로 없음');
        // 프리셋 항목 먼저 — 실패하면 throw 로 파일은 건드리지 않는다
        for (const name of it.easyPresets!) {
          await deps.removeEasyPreset(it.project, name, it.fileName);
          presetsRemoved++;
        }
        refCache.delete(it.project); // 같은 프로젝트 다음 항목은 갱신된 참조로 재확인
      }
      const path = projectPath('vibes', it.project, it.fileName);
      if (deps.isMobile) {
        // Android 는 OS 휴지통이 없어 trashFile = 영구 삭제(androidBackend.trashFile → deleteFile)
        await deps.trashFile(path);
      } else {
        let trashed = false;
        try {
          await deps.trashFile(path); // PC = OS 휴지통(복구 가능)
          trashed = true;
        } catch (e) {}
        if (!trashed) await deps.deleteFile(path); // 휴지통 실패 폴백 = 직접 삭제(legacyCleanup 과 같음)
      }
      deleted++;
    } catch (e) {
      failed.push(label);
    }
    onProgress?.(i + 1, targets.length);
  }
  return { deleted, failed, presetsRemoved };
}
