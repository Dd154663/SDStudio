// 이미지 상태 작업(즐겨찾기·북마크·순서·순위·생성 설정 적용)의 되돌리기 계측(2026-11-01 U3a, SPEC_GUIDE 「되돌리기 계약」,
// jest undoImageState.test.ts).
//
// · 최우선 원칙: 생성 중 되돌리기가 그사이 생긴 이미지와 충돌하지 않는다. 이 모듈은 imageMap·mains·game·round 에
//   대입하지 않는다(specGuard 「되돌리기 모듈의 이미지 필드 대입」) — 다음 공개 메서드만 부른다.
//   - 즐겨찾기 = ImageService.setImageMain(파일 하나 절대값, 다른 창 알림 notifySessionOp 포함). 다른 파일의 즐겨찾기는 그대로.
//   - 순서 = GameService.applyImageOrder(병합: 기록에 없는 새 이미지는 지금 상대 순서대로 뒤에, 사라진 이미지는 건너뜀).
//   - 순위 = GameService.applyRanking(지금 있는 파일의 참가자만, round 는 참가자가 모두 있을 때만 — 항상 새 객체).
// · 기록은 호출부(UI·흐름 계층)가 동작이 끝난 뒤(헬퍼가 감싼 mutate 가 끝난 뒤) 남긴다 — 잠금 안에서 불리지 않는다.
// · 씬은 손잡이(undoRef)로 잡고 실행 시점에 세션에 그 객체가 있는지 확인한다(없으면 그 항목만 실패·폐기).
// · 순위 매치 진행(월드컵 승패)은 기록하지 않는다(월드컵 자체 실행취소와 겹침 — D20 보류). 순위 초기화·대진 리롤만.
// · 생성 설정 적용은 프로젝트(세션) 부분만 — 환경설정(config)·글로벌 프리셋 대상은 기록하지 않는다.
// · 서비스는 models/index.ts 가 configureImageStateUndo 로 넣는다(순환 import 회피 — 테스트는 ops 를 직접 넘긴다).
import { runInAction } from 'mobx';
import { cloneRanking, rankingForFiles, RankingSnapshot, sameRanking } from './imageRanking';
import { captureSceneFields, flushSceneFieldEdit, SceneFieldKey } from './sceneFieldUndo';
import { sceneInSession } from './sceneStructureUndo';
import { ReferenceItem, VibeItem } from './types';
import type { GenericScene, IReferenceItem, IVibeItem, SelectedWorkflow, Session } from './types';
import {
  undoDeepClone,
  undoRef,
  undoService,
  UNDO_TEXT,
  UndoEntryInit,
  UndoPending,
  UndoService,
} from './undoService';

/** 이 모듈이 부르는 공개 메서드(각자 관문·알림을 지킨다) */
export interface ImageStateOps {
  /** 파일 하나의 즐겨찾기 절대값(+다른 창 알림) */
  setImageMain(session: Session, scene: GenericScene, filename: string, on: boolean): void;
  getImageBookmark(projectName: string, sceneName: string): string | undefined;
  setImageBookmark(projectName: string, sceneName: string, filename: string | undefined): Promise<void>;
  /** 순서 병합 적용 — 바뀌었으면 true */
  applyImageOrder(scene: GenericScene, order: readonly string[]): boolean;
  /** 순위 되살리기(지금 파일에 맞춰 거름·새 객체) */
  applyRanking(session: Session, scene: GenericScene, snap: RankingSnapshot): void;
  /** 순서를 바꾼 뒤 목록·캐시 갱신(ImageService.refresh) */
  refreshScene(session: Session, scene: GenericScene): Promise<unknown>;
}

let configuredOps: ImageStateOps | undefined;

export function configureImageStateUndo(ops: ImageStateOps): void {
  configuredOps = ops;
}

function resolveOps(ops?: ImageStateOps): ImageStateOps {
  const o = ops ?? configuredOps;
  if (!o) throw new Error('이미지 상태 되돌리기가 준비되지 않았습니다');
  return o;
}

export interface ImageStateUndoOptions {
  service?: UndoService;
  ops?: ImageStateOps;
}

function sceneGoneCheck(session: Session, scene: GenericScene): () => true | string {
  const ref = undoRef(scene);
  return () => (sceneInSession(session, ref.current) ? true : UNDO_TEXT.sceneGone(ref.current.name));
}

function recordable(service: UndoService, session: Session, scene: GenericScene): boolean {
  return service.canRecord(session) && sceneInSession(session, scene);
}

// ── 즐겨찾기 ──────────────────────────────────────────────────────────────

/** true = 지정, false = 해제, 'toggle' = 파일마다 반전 */
export type FavoriteMode = boolean | 'toggle';

interface FavoriteChange {
  file: string;
  before: boolean;
  after: boolean;
}

function applyFavorites(
  ops: ImageStateOps,
  session: Session,
  scene: GenericScene,
  filenames: readonly string[],
  mode: FavoriteMode,
): FavoriteChange[] {
  const changes: FavoriteChange[] = [];
  const seen = new Set<string>();
  // 사본으로 돈다 — filenames 가 scene.mains 자체여도 setImageMain 의 splice 에 흔들리지 않게
  for (const file of [...filenames]) {
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const before = scene.mains.includes(file);
    const after = mode === 'toggle' ? !before : mode;
    // 같은 값이어도 부른다(기존 호출 동작 유지 — 다른 창 알림 포함), 기록은 바뀐 것만
    ops.setImageMain(session, scene, file, after);
    if (before !== after) changes.push({ file, before, after });
  }
  return changes;
}

function favoriteLabel(scene: GenericScene, changes: readonly FavoriteChange[]): string {
  const on = changes.filter((c) => c.after).length;
  if (on === changes.length) return UNDO_TEXT.imageFavoriteOn(scene.name, changes.length);
  if (on === 0) return UNDO_TEXT.imageFavoriteOff(scene.name, changes.length);
  return UNDO_TEXT.imageFavoriteToggle(scene.name, changes.length);
}

function favoriteEntry(
  session: Session,
  scene: GenericScene,
  changes: readonly FavoriteChange[],
  label: string,
  getOps: () => ImageStateOps,
): UndoEntryInit {
  const ref = undoRef(scene);
  const run = (pick: 'before' | 'after', reverse: boolean) => {
    const ops = getOps();
    const target = ref.current;
    // 지정으로 되살릴 때 그사이 사라진 이미지는 건너뛴다(죽은 참조를 만들지 않음). 해제는 언제나 안전.
    const files = new Set(target.imageMap);
    const list = reverse ? [...changes].reverse() : changes;
    runInAction(() => {
      for (const c of list) {
        const on = c[pick];
        if (on && !files.has(c.file)) continue;
        ops.setImageMain(session, target, c.file, on);
      }
    });
  };
  return {
    label,
    verify: sceneGoneCheck(session, scene),
    undo: () => run('before', true),
    redo: () => run('after', false),
  };
}

/**
 * 한 씬의 즐겨찾기를 바꾸고(파일마다 setImageMain 절대값) 바뀐 것이 있으면 1항목.
 * 단일 토글·선택 일괄 토글·즐겨찾기 지정 공용. 반환 = 실제로 바뀐 파일 수.
 */
export function setImageFavorites(
  session: Session,
  scene: GenericScene,
  filenames: readonly string[],
  mode: FavoriteMode,
  opts: ImageStateUndoOptions & { label?: string } = {},
): number {
  const service = opts.service ?? undoService;
  const ops = resolveOps(opts.ops);
  const changes = applyFavorites(ops, session, scene, filenames, mode);
  if (changes.length === 0 || !recordable(service, session, scene)) return changes.length;
  flushSceneFieldEdit();
  service.record(
    session,
    favoriteEntry(session, scene, changes, opts.label ?? favoriteLabel(scene, changes), () =>
      resolveOps(opts.ops),
    ),
  );
  return changes.length;
}

/** 파일 하나 즐겨찾기 반전(그리드·상세·단축키·씬 카드·히스토리·컨텍스트 메뉴) */
export function toggleImageFavorite(
  session: Session,
  scene: GenericScene,
  filename: string,
  opts: ImageStateUndoOptions = {},
): void {
  setImageFavorites(session, scene, [filename], 'toggle', opts);
}

export interface SceneFavoritePlan {
  scene: GenericScene;
  filenames: readonly string[];
  on: boolean;
}

/** 여러 씬의 즐겨찾기를 한 번에(대량 작업 「전부 해제」·「상위 n등 지정」) — 1항목(묶음, 되돌림 역순). 반환 = 바뀐 파일 수 */
export function setFavoritesInScenes(
  session: Session,
  plans: readonly SceneFavoritePlan[],
  label: string,
  opts: ImageStateUndoOptions = {},
): number {
  const service = opts.service ?? undoService;
  const ops = resolveOps(opts.ops);
  const canRecord = service.canRecord(session);
  if (canRecord) flushSceneFieldEdit();
  const group = canRecord ? service.beginGroup(session, label) : undefined;
  let total = 0;
  try {
    for (const plan of plans) {
      const changes = applyFavorites(ops, session, plan.scene, plan.filenames, plan.on);
      total += changes.length;
      if (group && changes.length > 0 && sceneInSession(session, plan.scene)) {
        group.add(
          favoriteEntry(session, plan.scene, changes, favoriteLabel(plan.scene, changes), () =>
            resolveOps(opts.ops),
          ),
        );
      }
    }
  } finally {
    group?.commit();
  }
  return total;
}

// ── 이미지 북마크(씬당 1개) ────────────────────────────────────────────────

/** 이미지 북마크 반전 — 절대값 setImageBookmark(이전 값 ↔ 이후 값). 프로젝트·씬 이름은 실행 시점 값 */
export async function toggleImageBookmarkRecorded(
  session: Session,
  scene: GenericScene,
  filename: string,
  opts: ImageStateUndoOptions = {},
): Promise<void> {
  const service = opts.service ?? undoService;
  const ops = resolveOps(opts.ops);
  const prev = ops.getImageBookmark(session.name, scene.name);
  const next = prev === filename ? undefined : filename;
  const ref = undoRef(scene);
  const set = (value: string | undefined) => resolveOps(opts.ops).setImageBookmark(session.name, ref.current.name, value);
  if (!recordable(service, session, scene)) {
    await ops.setImageBookmark(session.name, scene.name, next);
    return;
  }
  flushSceneFieldEdit();
  await service.run(session, next ? UNDO_TEXT.imageBookmarkOn(scene.name) : UNDO_TEXT.imageBookmarkOff(scene.name), {
    apply: () => set(next),
    revert: () => set(prev),
    verify: sceneGoneCheck(session, scene),
  });
}

// ── 순서·순위 ──────────────────────────────────────────────────────────────

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((f, i) => f === b[i]);
}

/** 지금 씬 순위가 「snap 을 지금 파일에 맞춘 것」과 같은가(D16 겹침 판정 — 생성·삭제에 따른 자가 화해는 겹침이 아니다) */
function rankingMatches(scene: GenericScene, snap: RankingSnapshot): boolean {
  return sameRanking(cloneRanking(scene), rankingForFiles(snap, scene.imageMap));
}

/**
 * 그리드 드래그 순서 변경 — mutate(순서·순위 변경 + refresh) 전후의 순서 사본·순위 깊은 사본을 보관해 1항목.
 * 되돌림 = 순서는 병합 복원(새 이미지 유지·사라진 이미지 건너뜀), 순위가 함께 바뀌었으면 순위도 지금 파일에 맞춰 복원
 * (순위 쪽만 D16 겹침 확인 — 그사이 월드컵 진행 등). 변화가 없으면 기록하지 않는다.
 */
export async function recordImageOrder(
  session: Session | undefined,
  scene: GenericScene,
  mutate: () => unknown,
  opts: ImageStateUndoOptions = {},
): Promise<void> {
  const service = opts.service ?? undoService;
  if (!session || !recordable(service, session, scene)) {
    await mutate();
    return;
  }
  flushSceneFieldEdit();
  const beforeOrder = [...scene.imageMap];
  const beforeRank = cloneRanking(scene);
  await mutate();
  const afterOrder = [...scene.imageMap];
  const afterRank = cloneRanking(scene);
  const orderChanged = !sameOrder(beforeOrder, afterOrder);
  const rankChanged = !sameRanking(beforeRank, afterRank);
  if (!orderChanged && !rankChanged) return;
  const ref = undoRef(scene);
  const apply = async (order: readonly string[], rank: RankingSnapshot) => {
    const ops = resolveOps(opts.ops);
    const target = ref.current;
    if (orderChanged) ops.applyImageOrder(target, order);
    if (rankChanged) ops.applyRanking(session, target, rank);
    await ops.refreshScene(session, target);
  };
  service.record(session, {
    label: UNDO_TEXT.imageOrderDrag(scene.name),
    verify: sceneGoneCheck(session, scene),
    ...(rankChanged
      ? { conflict: (dir) => !rankingMatches(ref.current, dir === 'undo' ? afterRank : beforeRank) }
      : {}),
    undo: () => apply(beforeOrder, beforeRank),
    redo: () => apply(afterOrder, afterRank),
  });
}

/**
 * 순위 초기화·대진 리롤 — mutate 전후의 game·round 깊은 사본으로 1항목(비동기 mutate 허용, 끝난 뒤 기록).
 * 되돌림 = applyRanking(지금 파일에 있는 참가자만·round 새 객체). 통째 복원이라 D16 겹침 확인을 단다
 * (그사이 매치를 진행했으면 「이후 바뀐 내용도 함께 되돌아갑니다」). 변화가 없으면 기록하지 않는다.
 */
export async function recordRanking(
  session: Session | undefined,
  scene: GenericScene,
  label: string,
  mutate: () => unknown,
  opts: ImageStateUndoOptions = {},
): Promise<void> {
  const service = opts.service ?? undoService;
  if (!session || !recordable(service, session, scene)) {
    await mutate();
    return;
  }
  flushSceneFieldEdit();
  const before = cloneRanking(scene);
  await mutate();
  const after = cloneRanking(scene);
  if (sameRanking(before, after)) return;
  const ref = undoRef(scene);
  service.record(session, {
    label,
    verify: sceneGoneCheck(session, scene),
    conflict: (dir) => !rankingMatches(ref.current, dir === 'undo' ? after : before),
    undo: () => resolveOps(opts.ops).applyRanking(session, ref.current, before),
    redo: () => resolveOps(opts.ops).applyRanking(session, ref.current, after),
  });
}

// ── 생성 설정 적용(메타데이터) — 프로젝트(세션) 부분만 ──────────────────────

/** 메타 적용이 바꾸는 그림체(preset) 필드 */
export const META_APPLY_PRESET_KEYS = [
  'frontPrompt',
  'backPrompt',
  'uc',
  'characterPrompts',
  'sampling',
  'steps',
  'noiseSchedule',
  'promptGuidance',
  'cfgRescale',
  'useCoords',
  'varietyPlus',
  'deliberateEulerAncestralBug',
  'legacyPromptConditioning',
] as const;

/** 메타 적용이 바꾸는 공용 설정(shared) 필드 */
export const META_APPLY_SHARED_KEYS = [
  'characterPrompt',
  'backgroundPrompt',
  'seed',
  'vibes',
  'normalizeStrength',
  'characterReferences',
] as const;

function restoreSharedValue(key: string | number | symbol, plain: unknown): unknown {
  if (key === 'vibes' && Array.isArray(plain)) {
    return plain.filter((x) => x && (x as IVibeItem).path).map((x) => VibeItem.fromJSON(x as IVibeItem));
  }
  if (key === 'characterReferences' && Array.isArray(plain)) {
    return plain
      .filter((x) => x && (x as IReferenceItem).path)
      .map((x) => ReferenceItem.fromJSON(x as IReferenceItem));
  }
  return plain;
}

function presentKeys(target: object, keys: readonly string[]): string[] {
  return keys.filter((k) => k in target);
}

export interface MetaApplyRecorder {
  /** 기존 그림체(현재 그림체 대상) — 바꾸기 전에 부른다 */
  preset(preset: object): void;
  /** 공용 설정 — 처음 손대기 전에 부른다(새로 만든 공용 설정이면 그 기본값이 「이전 값」) */
  shared(shared: object): void;
  /** 씬 필드(조합·해상도) — 세션에 등록된 씬만 기록된다 */
  scene(scene: GenericScene | undefined, keys: readonly SceneFieldKey[]): void;
  /** 새 그림체로 적용 — addPreset·selectedWorkflow 변경 직후 부른다(prevSelected = 바꾸기 전 값) */
  presetAdded(preset: { type: string; name: string }, prevSelected: SelectedWorkflow | undefined): void;
  /** 끝 — 바뀐 것만 1항목(묶음). 기록했으면 true */
  commit(): boolean;
  cancel(): void;
}

/**
 * 생성 설정 적용(ExternalImageView.applyImport)의 세션 부분 기록기. 시작 때 세션 추가 프롬프트를 보관하고,
 * 호출부가 대상(preset·shared·scene)을 바꾸기 직전에 알려 주면 그때 이전 값을 보관한다. commit 은 동기로 한 묶음을 만든다
 * (적용 도중 await 동안 묶음 틀을 열어 두지 않는다). 환경설정·글로벌 프리셋은 대상이 아니다.
 */
export function beginMetaApplyRecord(
  session: Session,
  opts: { service?: UndoService } = {},
): MetaApplyRecorder {
  const service = opts.service ?? undoService;
  const label = UNDO_TEXT.metaApply;
  const noop: MetaApplyRecorder = {
    preset: () => {},
    shared: () => {},
    scene: () => {},
    presetAdded: () => {},
    commit: () => false,
    cancel: () => {},
  };
  if (!service.canRecord(session)) return noop;
  flushSceneFieldEdit();
  const pendings: UndoPending[] = [service.capture(session, label, session, ['extraPrompt'])];
  const seen = new Set<object>();
  const added: UndoEntryInit[] = [];
  let done = false;
  return {
    preset: (preset) => {
      if (done || seen.has(preset)) return;
      seen.add(preset);
      const keys = presentKeys(preset, META_APPLY_PRESET_KEYS) as (keyof typeof preset)[];
      pendings.push(service.capture(session, label, preset, keys));
    },
    shared: (shared) => {
      if (done || seen.has(shared)) return;
      seen.add(shared);
      const keys = presentKeys(shared, META_APPLY_SHARED_KEYS) as (keyof typeof shared)[];
      pendings.push(service.capture(session, label, shared, keys, { restore: restoreSharedValue }));
    },
    scene: (scene, keys) => {
      if (done || !scene || keys.length === 0) return;
      pendings.push(captureSceneFields(session, scene, keys, label, { service }));
    },
    presetAdded: (preset, prevSelected) => {
      if (done) return;
      const type = preset.type;
      const prev = prevSelected ? undoDeepClone(prevSelected) : undefined;
      const listHas = () => (session.presets.get(type) ?? []).includes(preset as never);
      const selectedIsThis = () =>
        session.selectedWorkflow?.workflowType === type && session.selectedWorkflow?.presetName === preset.name;
      added.push({
        label,
        undo: () =>
          runInAction(() => {
            if (listHas()) {
              session.presets.set(
                type,
                (session.presets.get(type) ?? []).filter((p) => p !== (preset as never)),
              );
            }
            // 그사이 사용자가 다른 그림체를 골랐으면 그 선택은 건드리지 않는다
            if (selectedIsThis()) session.selectedWorkflow = prev ? { ...prev } : undefined;
          }),
        redo: () =>
          runInAction(() => {
            if (!listHas()) session.addPreset(preset);
            session.selectedWorkflow = { workflowType: type, presetName: preset.name };
          }),
      });
    },
    commit: () => {
      if (done) return false;
      done = true;
      const group = service.beginGroup(session, label);
      for (const p of pendings) p.commit();
      for (const init of added) group.add(init);
      return group.commit();
    },
    cancel: () => {
      if (done) return;
      done = true;
      for (const p of pendings) p.cancel();
    },
  };
}
