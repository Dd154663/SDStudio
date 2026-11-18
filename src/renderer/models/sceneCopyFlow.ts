// 「다른 프로젝트로 씬 복사」 공용 흐름(2026-11-16 M5 묶음 a, P4 — 피드백 1 에서 호출부 차이 통일·첨부 파일 복사 추가).
//
// 예전에는 씬 우클릭 메뉴(AppContextMenu)와 대량 작업 메뉴(BatchProcessService)에 같은 흐름이 두 벌 있었다.
// 이 파일이 단일 출처다: 대상 프로젝트 고르기 → 복사 방식 고르기 → 대상 불러오기 → 씬 복제(이름 `_n` 충돌 처리)
// → 첨부 파일(변형 씬 원본·마스크·바이브·캐릭터 레퍼런스) 복사 → (이미지 포함이면) outs/inpaints 이미지 파일 복사 → 결과 토스트.
//
// 규칙:
//  · 이름 규칙 = 씬 `_n`(원래 이름 → `이름_1` → `이름_2` …, 사용자 2026-11-14 결정). 종류(생성/변형)별로 따로 센다
//    (Session.hasScene(type, name)). 생성 탭·변형 탭 씬 모두 같은 흐름(모드 동등성).
//  · 복사하는 것 = 씬 JSON 전체(toJSON → genericSceneFromJSON). 「설정만」은 imageMap·mains 를 비운다.
//    「이미지 포함」은 imageMap 의 이미지 파일만 원본 씬 출력 폴더(imageService.getOutputDir — projectPaths 관문)에서
//    대상 씬 출력 폴더로 복사한다. 파일 하나의 실패는 로그만 남기고 계속한다.
//  · 첨부 파일(2026-11-16 피드백 1): 변형 씬 프리셋은 프로젝트별 `vibes`·`references` 폴더의 파일을 이름으로 가리킨다
//    (sceneAttachmentFiles). 첨부는 설정의 일부라 「설정만」·「이미지 포함」 두 방식 모두 대상 프로젝트의 같은 폴더로
//    같은 이름 그대로 복사한다(uuid 이름). 대상에 같은 이름이 있으면 건너뛰고(덮어쓰지 않음), 원본에 없으면 로그만 남기고
//    씬 복사는 계속한다. 인코딩된 바이브 캐시(vibes/encoded)는 있으면 함께 복사(재인코딩 방지, 퀵 생성 copyPresetAssets 선례).
//    씬을 대상에 넣기 전에 복사해 대상 씬이 없는 파일을 가리키는 순간을 만들지 않는다. 원본 파일은 읽기·복사만.
//    생성 씬 JSON 에는 프로젝트별 파일 참조가 없다(바이브·레퍼런스는 프로젝트 사전 세팅 소속).
//  · 이미지 원본 프로젝트 = 흐름 시작 때 잡은 프로젝트(두 호출부 모두, 피드백 1 ③).
//  · 되돌리기 기록 없음(원장상 제외 그대로). 새 withLock·직접 저장 없음 — Session.addScene 과 backend.copyFile 만.

import { backend, imageService, sessionService, templateService } from '.';
import { getAppState } from './appStateRef';
import { PNG_IMAGE_EXT } from './imageFormats';
import { genericSceneFromJSON } from './types';
import type { GenericScene, Session } from './types';
import type { Dialog } from '../componenets/ConfirmWindow';

export type SceneCopyMode = 'config' | 'with-images';

export const SCENE_COPY_TEXT = {
  noTargets: '복사할 다른 프로젝트가 없습니다',
  /** 대상 고르기 창 — 1개여도 숫자를 쓴다(피드백 1 ①) */
  targetPrompt: (count: number) => `씬 ${count}개를 복사할 프로젝트를 선택하세요`,
  modePrompt: '복사 방식을 선택하세요',
  modeConfig: '설정만 복사 (슬롯, 프롬프트 등)',
  modeWithImages: '이미지 포함 복사',
  loadFailed: '프로젝트를 불러올 수 없습니다',
  /**
   * 끝난 뒤 토스트(피드백 1 ②). undefined = 토스트 없음(복사한 씬이 0개).
   * 괄호 안 = 이미지 포함이면 「이미지 K장」(0장이어도 표시), 첨부 파일을 복사했으면 「첨부 파일 M개」(0개면 생략).
   */
  result: (r: {
    mode: SceneCopyMode;
    targetName: string;
    sceneCount: number;
    imageCount: number;
    attachmentCount: number;
  }): string | undefined => {
    if (r.sceneCount <= 0) return undefined;
    const extras: string[] = [];
    if (r.mode === 'with-images') extras.push(`이미지 ${r.imageCount}장`);
    if (r.attachmentCount > 0) extras.push(`첨부 파일 ${r.attachmentCount}개`);
    const tail = extras.length > 0 ? ` (${extras.join(', ')})` : '';
    return `씬 ${r.sceneCount}개를 "${r.targetName}" 프로젝트에 복사했습니다${tail}`;
  },
} as const;

/** 씬 JSON 이 가리키는 프로젝트별 첨부 파일(파일 이름 — 폴더 경로 없이) */
export interface SceneAttachmentFiles {
  /** vibes 폴더 — 변형 씬 preset.image·preset.mask, preset.vibes[].path */
  vibes: string[];
  /** vibes/encoded 캐시 — preset.vibes[] 의 (이름, info). 없어도 정상(생성 때 다시 인코딩) */
  encodedVibes: { name: string; info: number }[];
  /** references 폴더 — preset.characterReferences[].path(꺼진 항목 포함 — 다시 켤 수 있다) */
  references: string[];
}

const fileNameOf = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || !v) return undefined;
  const name = v.split('/').pop();
  return name ? name : undefined;
};

/**
 * 씬이 가리키는 프로젝트별 첨부 파일을 모은다(순수 함수, 중복 제거).
 * · 대상 = 변형 씬(type 'inpaint')의 preset 만 — 생성 씬(slots·meta·씬 전용 캐릭터 프롬프트)에는 파일 참조가 없다.
 * · preset.image·preset.mask = PNG 확장자로 끝나는 값만 파일 이름(storeVibeImage 결과). 그 밖(인라인 base64 등)은
 *   I2I 핸들러(SDWorkFlow)처럼 파일이 아니라고 본다.
 * · 이름은 읽는 쪽(imageService.fetchVibeImage·fetchReferenceImage)처럼 마지막 `/` 뒤만 쓴다.
 * · 구형 inpaint_orgs/inpaint_masks(<씬>.png)는 불러올 때 vibes 로 옮겨지고(legacy.migrateInpaintScene) 씬 JSON 이
 *   가리키지 않으므로 대상이 아니다. sceneRef·sourceImage 는 같은 프로젝트 원본 씬의 이름·출력 파일 이름(연결 정보)이라
 *   대상이 아니다.
 */
export function sceneAttachmentFiles(scene: { type?: string; preset?: any } | null | undefined): SceneAttachmentFiles {
  const out: SceneAttachmentFiles = { vibes: [], encodedVibes: [], references: [] };
  if (!scene || scene.type !== 'inpaint' || !scene.preset || typeof scene.preset !== 'object') return out;
  const preset = scene.preset;
  const vibeSet = new Set<string>();
  const encodedSet = new Set<string>();
  const refSet = new Set<string>();
  const addVibe = (name: string | undefined) => {
    if (name && !vibeSet.has(name)) {
      vibeSet.add(name);
      out.vibes.push(name);
    }
  };
  for (const key of ['image', 'mask'] as const) {
    const v = preset[key];
    if (typeof v === 'string' && v.endsWith('.' + PNG_IMAGE_EXT)) addVibe(fileNameOf(v));
  }
  for (const vibe of Array.isArray(preset.vibes) ? preset.vibes : []) {
    const name = fileNameOf(vibe?.path);
    if (!name) continue;
    addVibe(name);
    const info = vibe?.info;
    if (typeof info === 'number' && Number.isFinite(info)) {
      const k = `${name}&info=${info}`;
      if (!encodedSet.has(k)) {
        encodedSet.add(k);
        out.encodedVibes.push({ name, info });
      }
    }
  }
  for (const ref of Array.isArray(preset.characterReferences) ? preset.characterReferences : []) {
    const name = fileNameOf(ref?.path);
    if (name && !refSet.has(name)) {
      refSet.add(name);
      out.references.push(name);
    }
  }
  return out;
}

/**
 * 프로젝트 얕은 복제(폴더 복제·프로젝트 복제 「이미지 미포함」, 2026-11-16 플랜 `2026-11-16-shallow-clone-variant-scenes`)가
 * 새 프로젝트로 함께 옮길 변형 쪽 첨부 파일(순수 함수, 중복 제거).
 * = 세션 JSON 의 모든 변형 씬(inpaints) sceneAttachmentFiles 합 + 세션 미러 원본(mirrorImage — vibes 폴더 파일 이름,
 *   storeVibeImage 결과). 손상 값(객체가 아님·문자열이 아님)은 건너뛴다.
 */
export function sessionVariantAttachmentFiles(
  json: { inpaints?: unknown; mirrorImage?: unknown } | null | undefined,
): SceneAttachmentFiles {
  const out: SceneAttachmentFiles = { vibes: [], encodedVibes: [], references: [] };
  if (!json || typeof json !== 'object') return out;
  const vibeSet = new Set<string>();
  const encodedSet = new Set<string>();
  const refSet = new Set<string>();
  const addVibe = (name: string | undefined) => {
    if (name && !vibeSet.has(name)) {
      vibeSet.add(name);
      out.vibes.push(name);
    }
  };
  const inpaints = json.inpaints;
  const scenes =
    inpaints && typeof inpaints === 'object' && !Array.isArray(inpaints)
      ? Object.values(inpaints as Record<string, unknown>)
      : [];
  for (const scene of scenes) {
    if (!scene || typeof scene !== 'object') continue;
    const files = sceneAttachmentFiles(scene as { type?: string; preset?: any });
    for (const name of files.vibes) addVibe(name);
    for (const e of files.encodedVibes) {
      const k = `${e.name}&info=${e.info}`;
      if (!encodedSet.has(k)) {
        encodedSet.add(k);
        out.encodedVibes.push(e);
      }
    }
    for (const name of files.references) {
      if (!refSet.has(name)) {
        refSet.add(name);
        out.references.push(name);
      }
    }
  }
  const mirror = json.mirrorImage;
  if (typeof mirror === 'string' && mirror.endsWith('.' + PNG_IMAGE_EXT)) addVibe(fileNameOf(mirror));
  return out;
}

/**
 * 프로젝트 얕은 복제가 새 프로젝트로 함께 옮길 생성 쪽 첨부 파일(순수 함수, 중복 제거 — 2026-11-18 프리셋 유실 조사 경로 20).
 * = 로컬 캐릭터 프리셋(characterPresets)의 대표 이미지(representativeImage — vibes 폴더)·바이브(vibes[].path, 인코딩 캐시 포함)·
 *   캐릭터 레퍼런스(characterReferences[].path)
 * + 공용 설정(presetShareds — 워크플로 종류 무관)의 바이브·캐릭터 레퍼런스(적용 프리셋 유래 fromPreset 항목·꺼진 항목 포함).
 * 이름은 읽는 쪽처럼 마지막 `/` 뒤만 쓴다. 손상 값(객체가 아님·문자열이 아님)은 건너뛴다.
 */
export function sessionGenerationAttachmentFiles(
  json: { characterPresets?: unknown; presetShareds?: unknown } | null | undefined,
): SceneAttachmentFiles {
  const out: SceneAttachmentFiles = { vibes: [], encodedVibes: [], references: [] };
  if (!json || typeof json !== 'object') return out;
  const vibeSet = new Set<string>();
  const encodedSet = new Set<string>();
  const refSet = new Set<string>();
  const addVibe = (name: string | undefined) => {
    if (name && !vibeSet.has(name)) {
      vibeSet.add(name);
      out.vibes.push(name);
    }
  };
  const addHolder = (holder: any) => {
    if (!holder || typeof holder !== 'object') return;
    for (const vibe of Array.isArray(holder.vibes) ? holder.vibes : []) {
      const name = fileNameOf(vibe?.path);
      if (!name) continue;
      addVibe(name);
      const info = vibe?.info;
      if (typeof info === 'number' && Number.isFinite(info)) {
        const k = `${name}&info=${info}`;
        if (!encodedSet.has(k)) {
          encodedSet.add(k);
          out.encodedVibes.push({ name, info });
        }
      }
    }
    for (const ref of Array.isArray(holder.characterReferences) ? holder.characterReferences : []) {
      const name = fileNameOf(ref?.path);
      if (name && !refSet.has(name)) {
        refSet.add(name);
        out.references.push(name);
      }
    }
  };
  const valuesOf = (v: unknown): unknown[] =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v as Record<string, unknown>) : [];
  for (const preset of valuesOf(json.characterPresets)) {
    if (!preset || typeof preset !== 'object') continue;
    addHolder(preset);
    // 대표 이미지 = vibes 폴더 파일 이름(화면은 getVibeImagePath 로 읽는다). 편집기는 레퍼런스 path 를 그대로 고를 수도 있어
    // 그 경우는 레퍼런스 복사로 이미 따라가므로 vibes 에서 다시 찾지 않는다(없는 파일 경고 방지).
    const rep = fileNameOf((preset as any).representativeImage);
    const refs: any[] = Array.isArray((preset as any).characterReferences) ? (preset as any).characterReferences : [];
    if (rep && !refs.some((r) => fileNameOf(r?.path) === rep)) addVibe(rep);
  }
  for (const shared of valuesOf(json.presetShareds)) addHolder(shared);
  return out;
}

/** 첨부 파일 목록 합치기(순서 유지, 중복 제거) */
export function mergeAttachmentFiles(...lists: SceneAttachmentFiles[]): SceneAttachmentFiles {
  const out: SceneAttachmentFiles = { vibes: [], encodedVibes: [], references: [] };
  const vibeSet = new Set<string>();
  const encodedSet = new Set<string>();
  const refSet = new Set<string>();
  for (const l of lists) {
    for (const n of l.vibes) {
      if (vibeSet.has(n)) continue;
      vibeSet.add(n);
      out.vibes.push(n);
    }
    for (const e of l.encodedVibes) {
      const k = `${e.name}&info=${e.info}`;
      if (encodedSet.has(k)) continue;
      encodedSet.add(k);
      out.encodedVibes.push(e);
    }
    for (const n of l.references) {
      if (refSet.has(n)) continue;
      refSet.add(n);
      out.references.push(n);
    }
  }
  return out;
}

export interface SceneCopyDeps {
  /** 복사 대상 후보(숨김 씬 템플릿 제외 — templateService.filterVisibleProjects(sessionService.list())) */
  listProjects(): string[];
  pushMessage(msg: string): void;
  /** 선택 창(appState.pushDialogAsync) — 취소면 undefined */
  ask(dialog: Dialog): Promise<string | undefined>;
  /** 대상 프로젝트 불러오기(sessionService.get) */
  loadSession(name: string): Promise<Session | undefined>;
  /** 씬 복제(genericSceneFromJSON(scene.toJSON())) */
  cloneScene(scene: GenericScene): GenericScene | null;
  /** 씬 출력 폴더(imageService.getOutputDir — 생성 = outs, 변형 = inpaints) */
  outputDir(session: Session, scene: GenericScene): string;
  /** 첨부 파일 경로 — imageService.getVibeImagePath·getEncodedVibeImagePath·getReferenceImagePath(projectPaths 관문) */
  vibePath(session: Session, name: string): string;
  encodedVibePath(session: Session, name: string, info: number): string;
  referencePath(session: Session, name: string): string;
  existFile(path: string): Promise<boolean>;
  copyFile(src: string, dst: string): Promise<void>;
  logError(...args: unknown[]): void;
}

/** 실제 앱 의존성 — 호출 시점에 해석한다(AppService 순환 import 회피, appStateRef 게이트). */
export function defaultSceneCopyDeps(): SceneCopyDeps {
  return {
    listProjects: () => templateService.filterVisibleProjects(sessionService.list()),
    pushMessage: (msg) => getAppState().pushMessage(msg),
    ask: (dialog) => getAppState().pushDialogAsync(dialog),
    loadSession: (name) => sessionService.get(name),
    cloneScene: (scene) => genericSceneFromJSON(scene.toJSON()),
    outputDir: (session, scene) => imageService.getOutputDir(session, scene),
    vibePath: (session, name) => imageService.getVibeImagePath(session, name),
    encodedVibePath: (session, name, info) => imageService.getEncodedVibeImagePath(session, name, info),
    referencePath: (session, name) => imageService.getReferenceImagePath(session, name),
    existFile: (path) => backend.existFile(path),
    copyFile: (src, dst) => backend.copyFile(src, dst),
    logError: (...args) => console.error(...args),
  };
}

/**
 * 현재 프로젝트를 뺀 복사 대상 목록. 없으면 안내 토스트를 띄우고 null.
 * 대량 작업 메뉴는 씬 선택 창을 열기 전에, 우클릭 메뉴는 선택 창(대상 고르기) 전에 부른다(종전 순서).
 */
export function sceneCopyTargets(deps: SceneCopyDeps, currentName: string): string[] | null {
  const targets = deps.listProjects().filter((n) => n !== currentName);
  if (targets.length === 0) {
    deps.pushMessage(SCENE_COPY_TEXT.noTargets);
    return null;
  }
  return targets;
}

/** 대상 프로젝트 안에서 겹치지 않는 씬 이름 — `이름`, `이름_1`, `이름_2` …(종류별) */
export function nextSceneCopyName(
  taken: (name: string) => boolean,
  baseName: string,
): string {
  let cnt = 0;
  const nameAt = () => baseName + (cnt === 0 ? '' : '_' + cnt);
  while (taken(nameAt())) cnt++;
  return nameAt();
}

/** 첨부 파일 복사 결과(한 번의 흐름 누적) */
export interface SceneAttachmentCopyStats {
  copied: number;
  /** 대상에 같은 이름이 이미 있어 건너뜀 */
  skipped: number;
  /** 원본에 파일이 없거나 복사 실패(로그만) */
  missing: number;
}

/**
 * 씬 하나의 첨부 파일을 원본 → 대상 프로젝트로 복사한다(같은 이름, 덮어쓰기 없음).
 * done = 이번 흐름에서 이미 처리한 대상 경로(여러 씬이 같은 파일을 가리킬 때 한 번만). stats 에 누적.
 */
export async function copySceneAttachments(
  deps: SceneCopyDeps,
  source: Session,
  target: Session,
  files: SceneAttachmentFiles,
  done: Set<string>,
  stats: SceneAttachmentCopyStats,
): Promise<void> {
  const copyOne = async (src: string, dst: string, label: string) => {
    if (done.has(dst)) return;
    done.add(dst);
    try {
      if (await deps.existFile(dst)) {
        stats.skipped++;
        return;
      }
      if (!(await deps.existFile(src))) {
        stats.missing++;
        deps.logError('첨부 파일 없음(건너뜀):', label, src);
        return;
      }
      await deps.copyFile(src, dst);
      stats.copied++;
    } catch (e) {
      stats.missing++;
      deps.logError('첨부 파일 복사 실패:', label, e);
    }
  };
  for (const name of files.vibes) {
    await copyOne(deps.vibePath(source, name), deps.vibePath(target, name), name);
  }
  for (const name of files.references) {
    await copyOne(deps.referencePath(source, name), deps.referencePath(target, name), name);
  }
  // 인코딩 캐시 — 있으면 함께(없으면 생성 때 다시 인코딩되므로 조용히 넘어간다, 개수에 넣지 않는다)
  for (const { name, info } of files.encodedVibes) {
    const src = deps.encodedVibePath(source, name, info);
    const dst = deps.encodedVibePath(target, name, info);
    if (done.has(dst)) continue;
    done.add(dst);
    try {
      if (await deps.existFile(dst)) continue;
      if (!(await deps.existFile(src))) continue;
      await deps.copyFile(src, dst);
    } catch (e) {
      deps.logError('인코딩된 바이브 복사 실패:', name, e);
    }
  }
}

export interface SceneCopyOptions {
  scenes: GenericScene[];
  /** sceneCopyTargets 의 결과 */
  targets: string[];
  /** 원본 프로젝트 — 흐름 시작 때 잡은 값(두 호출부 모두, 피드백 1 ③). 이미지·첨부 파일을 여기서 읽는다 */
  sourceSession: Session;
}

export interface SceneCopyResult {
  targetName: string;
  mode: SceneCopyMode;
  sceneCount: number;
  imageCount: number;
  /** 대상 프로젝트로 새로 복사한 첨부 파일 수(인코딩 캐시 제외) */
  attachmentCount: number;
  attachmentSkipped: number;
  attachmentMissing: number;
}

/** 대상·방식을 묻고 씬을 복사한다. 취소·불러오기 실패면 undefined. */
export async function copyScenesToProjectFlow(
  deps: SceneCopyDeps,
  opts: SceneCopyOptions,
): Promise<SceneCopyResult | undefined> {
  const { scenes, targets, sourceSession } = opts;

  // 1) 대상 프로젝트
  const targetName = await deps.ask({
    text: SCENE_COPY_TEXT.targetPrompt(scenes.length),
    type: 'dropdown',
    items: targets.map((n) => ({ text: n, value: n })),
  });
  if (!targetName) return undefined;

  // 2) 복사 방식
  const mode = (await deps.ask({
    text: SCENE_COPY_TEXT.modePrompt,
    type: 'select',
    items: [
      { text: SCENE_COPY_TEXT.modeConfig, value: 'config' },
      { text: SCENE_COPY_TEXT.modeWithImages, value: 'with-images' },
    ],
  })) as SceneCopyMode | undefined;
  if (!mode) return undefined;

  // 3) 대상 불러오기
  const targetSession = await deps.loadSession(targetName);
  if (!targetSession) {
    deps.pushMessage(SCENE_COPY_TEXT.loadFailed);
    return undefined;
  }

  let sceneCount = 0;
  let imageCount = 0;
  const attachDone = new Set<string>();
  const attach: SceneAttachmentCopyStats = { copied: 0, skipped: 0, missing: 0 };
  for (const srcScene of scenes) {
    // 4) 씬 복제 — 살아있는 씬의 toJSON() 재역직렬화라 null 은 사실상 나오지 않는다(나오면 건너뜀)
    const newScene = deps.cloneScene(srcScene);
    if (!newScene) continue;
    newScene.name = nextSceneCopyName(
      (n) => targetSession.hasScene(newScene.type, n),
      newScene.name,
    );

    if (mode === 'config') {
      newScene.imageMap = [];
      newScene.mains = [];
    }

    // 5) 첨부 파일(두 방식 모두) — 씬을 넣기 전에
    await copySceneAttachments(
      deps,
      sourceSession,
      targetSession,
      sceneAttachmentFiles(newScene),
      attachDone,
      attach,
    );
    targetSession.addScene(newScene);

    // 6) 이미지 파일(이미지 포함일 때만, imageMap 기준)
    if (mode === 'with-images' && srcScene.imageMap.length > 0) {
      const srcDir = deps.outputDir(sourceSession, srcScene);
      const dstDir = deps.outputDir(targetSession, newScene);
      for (const img of [...srcScene.imageMap]) {
        try {
          await deps.copyFile(srcDir + '/' + img, dstDir + '/' + img);
          imageCount++;
        } catch (e) {
          deps.logError('이미지 복사 실패:', img, e);
        }
      }
    }
    sceneCount++;
  }

  const result: SceneCopyResult = {
    targetName,
    mode,
    sceneCount,
    imageCount,
    attachmentCount: attach.copied,
    attachmentSkipped: attach.skipped,
    attachmentMissing: attach.missing,
  };
  const msg = SCENE_COPY_TEXT.result(result);
  if (msg) deps.pushMessage(msg);
  return result;
}
