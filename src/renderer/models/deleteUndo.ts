// 삭제·휴지통 복원·복제·복사·붙여넣기의 되돌리기 계측(2026-11-02 U4, SPEC_GUIDE 「되돌리기 계약」·§8, jest undoDelete.test.ts).
//
// · 모든 파일 이동은 휴지통 관문 경유 — 씬 = TrashService.moveSceneToTrash / restoreScene(sceneStructureUndo 의 짝을 재사용),
//   이미지 = deleteImageFilesDetailed(휴지통 이동·캐시·목록 재로딩) / TrashService.restoreImages. 영구 삭제·비우기는 대상 아님.
// · 기록은 호출부(UI·흐름 계층)가 확인 창 뒤 서비스가 **성공한 뒤** 남긴다(이 모듈의 recorder 가 서비스를 대신 불러 결과를 모은다).
//   잠금(withLock)을 쓰지 않는다 — 각 서비스가 자기 관문(다른 창 잠금·meta 큐·이동 검증)을 지킨다.
// · 최우선 원칙(생성 중 새 이미지 보존): imageMap·mains·game·round 에 대입하지 않는다. 이미지 삭제 되돌림은
//   restoreImages → 목록 재로딩 → GameService.applyImageOrder(삭제 직전 순서로 병합 — 그사이 생긴 이미지는 뒤에 유지)
//   → 삭제 직전 즐겨찾기였던 복원 파일만 setImageMain(on) → 순위는 지금이 삭제 직후와 같을 때만 applyRanking(아니면 건너뛰고 안내).
// · 실패는 사유를 나눠 알린다 — 휴지통에서 이미 사라짐(보존 기간 경과·비우기) / 같은 이름 파일·이동 실패 / 씬 없음.
//   일부만 되면 된 것만 복원하고 다시 실행은 복원된 것만 다시 지운다. 하나도 못 하면 그 항목만 버린다(D15).
// · 다시 실행(재삭제)은 확인 창을 띄우지 않는다(D17 — 휴지통행이라 복원 가능).
// · 서비스는 models/index.ts 가 configureDeleteUndo 로 넣는다(순환 import 회피 — 테스트는 ops 를 직접 넘긴다).
import type { RankingSnapshot } from './imageRanking';
import { cloneRanking, sameRanking } from './imageRanking';
import { flushSceneFieldEdit } from './sceneFieldUndo';
import {
  sceneDeletedEntry,
  sceneInSession,
  sceneRestoredEntry,
  SceneStructureOps,
  TrashedSceneInfo,
} from './sceneStructureUndo';
import type { ImageTrashRestoreResult } from './TrashService';
import type { GenericScene, Session } from './types';
import {
  undoRef,
  undoService,
  UNDO_TEXT,
  UndoEntryInit,
  UndoOutcome,
  UndoRef,
  UndoService,
} from './undoService';

/** 이미지 쪽 공개 메서드(각자 관문을 지킨다) */
export interface ImageFileOps {
  outputDir(session: Session, scene: GenericScene): string;
  /** 휴지통 이동 + 캐시 무효화 + 목록 재로딩(ImageService.deleteImageFilesDetailed — 입력 경로 그대로 돌려줌) */
  deleteImageFiles(
    session: Session,
    scene: GenericScene,
    paths: string[],
    opts: { notify?: boolean },
  ): Promise<{ moved: string[]; failed: string[] }>;
  restoreImages(session: Session, scene: GenericScene, filenames: string[]): Promise<ImageTrashRestoreResult>;
  refreshScene(session: Session, scene: GenericScene): Promise<unknown>;
  setImageMain(session: Session, scene: GenericScene, filename: string, on: boolean): void;
  applyImageOrder(scene: GenericScene, order: readonly string[]): boolean;
  applyRanking(session: Session, scene: GenericScene, snap: RankingSnapshot): void;
  /** 복사 + 목록 재로딩(ImageService.copyImageFilesInto — 새 파일 이름 반환) */
  copyImageFiles(
    session: Session,
    scene: GenericScene,
    srcPaths: readonly string[],
  ): Promise<{ created: string[]; failed: string[] }>;
  /** 실패 문구용 이미지 휴지통 보존 기간(일, TrashService.IMAGE_RETENTION_DAYS) */
  imageRetentionDays: number;
}

let configuredImageOps: ImageFileOps | undefined;
let configuredSceneOps: SceneStructureOps | undefined;

export function configureDeleteUndo(ops: { images: ImageFileOps; scenes: SceneStructureOps }): void {
  configuredImageOps = ops.images;
  configuredSceneOps = ops.scenes;
}

export interface DeleteUndoOptions {
  service?: UndoService;
  imageOps?: ImageFileOps;
  sceneOps?: SceneStructureOps;
}

function imageOpsOf(opts: DeleteUndoOptions): ImageFileOps {
  const o = opts.imageOps ?? configuredImageOps;
  if (!o) throw new Error('삭제 되돌리기가 준비되지 않았습니다');
  return o;
}

function sceneOpsOf(opts: DeleteUndoOptions): SceneStructureOps {
  const o = opts.sceneOps ?? configuredSceneOps;
  if (!o) throw new Error('삭제 되돌리기가 준비되지 않았습니다');
  return o;
}

const baseName = (path: string) => path.split('/').pop()!;

// ── 씬 삭제·휴지통 복원 ─────────────────────────────────────────────────────

export interface SceneDeleteRecorder {
  /**
   * moveSceneToTrash 그대로(반환 = 슬롯, 다른 창 잠금 = undefined, 이동 실패 = throw) — 실제로 세션에서 빠진 씬만
   * 삭제 직전 이름·자리와 함께 모은다.
   */
  trash(scene: GenericScene): Promise<string | undefined>;
  /** 모은 씬을 1항목으로 기록(D14 — 한 번의 사용자 동작 = 1항목, 여러 개면 되돌림 역순). 없으면 false */
  commit(): boolean;
}

/** 씬 삭제(단일·다중) — 확인 창 콜백 안에서 만들고, 서비스 호출을 recorder.trash 로 바꾼 뒤 끝에 commit */
export function beginSceneDelete(
  session: Session | undefined,
  opts: DeleteUndoOptions = {},
): SceneDeleteRecorder {
  const service = opts.service ?? undoService;
  const done: { scene: GenericScene; info: TrashedSceneInfo }[] = [];
  let committed = false;
  return {
    trash: async (scene) => {
      if (!session) return undefined;
      const ops = sceneOpsOf(opts);
      const name = scene.name;
      const index = session.getScenes(scene.type).indexOf(scene);
      const slot = await ops.moveSceneToTrash(session, scene);
      // 다른 창 잠금으로 조용히 돌아왔으면(씬이 남아 있음) 기록하지 않는다
      if (slot && !sceneInSession(session, scene)) done.push({ scene, info: { slot, name, index } });
      return slot;
    },
    commit: () => {
      if (committed) return false;
      committed = true;
      if (!session || done.length === 0 || !service.canRecord(session)) return false;
      flushSceneFieldEdit();
      const label = UNDO_TEXT.sceneDelete(done.map((d) => d.info.name));
      if (done.length === 1) {
        return !!service.record(session, sceneDeletedEntry(session, done[0].scene, done[0].info, label, { ops: sceneOpsOf(opts) }));
      }
      const g = service.beginGroup(session, label);
      for (const d of done) g.add(sceneDeletedEntry(session, d.scene, d.info, label, { ops: sceneOpsOf(opts) }));
      return g.commit();
    },
  };
}

/**
 * 씬 휴지통 탭 「복원」 — restoreScene 그대로(반환 = 세션에 넣은 씬, 다른 창 잠금 = undefined, 실패 = throw).
 * 복원됐으면 기록(되돌림 = 다시 휴지통으로, 다시 실행 = 다시 꺼냄 — 씬 생성 항목과 같은 짝).
 */
export async function restoreSceneFromTrashRecorded(
  session: Session,
  slot: string,
  opts: DeleteUndoOptions = {},
): Promise<GenericScene | undefined> {
  const service = opts.service ?? undoService;
  const ops = sceneOpsOf(opts);
  const restored = await ops.restoreScene(session, slot);
  if (restored && sceneInSession(session, restored) && service.canRecord(session)) {
    flushSceneFieldEdit();
    service.record(
      session,
      sceneRestoredEntry(session, restored, UNDO_TEXT.sceneTrashRestore(restored.name), { ops }),
    );
  }
  return restored;
}

// ── 이미지 파일(삭제·휴지통 복원·복제·복사·붙여넣기) ─────────────────────────

/** 한 씬의 파일 묶음 — files 는 지금 옮겨 다니는 파일 이름(삭제 뒤 = 휴지통에 있는 것, 복원 뒤 = 폴더에 있는 것) */
interface ImagePart {
  ref: UndoRef<GenericScene>;
  files: string[];
  /** 휴지통으로 보내기 직전의 순서·즐겨찾기·순위(되살릴 때 병합 기준) */
  orderBefore: string[];
  mainsBefore: string[];
  rankBefore: RankingSnapshot;
  /** 휴지통으로 보낸 직후의 순위 — 되살릴 때 지금이 이것과 같아야 순위를 되돌린다 */
  rankAfter: RankingSnapshot;
}

interface PartTally {
  total: number;
  failed: number;
  missing: number;
  blocked: number;
  moveFailed: number;
  alreadyGone: number;
  sceneGone: { name: string; count: number }[];
  rankingSkipped: boolean;
}

function newTally(): PartTally {
  return {
    total: 0,
    failed: 0,
    missing: 0,
    blocked: 0,
    moveFailed: 0,
    alreadyGone: 0,
    sceneGone: [],
    rankingSkipped: false,
  };
}

function tallyOutcome(t: PartTally, days: number): UndoOutcome | void {
  const notes: string[] = [];
  if (t.missing > 0) notes.push(UNDO_TEXT.imagesTrashGone(t.missing, days));
  if (t.blocked > 0) notes.push(UNDO_TEXT.imagesRestoreBlocked(t.blocked));
  if (t.alreadyGone > 0) notes.push(UNDO_TEXT.imagesAlreadyGone(t.alreadyGone));
  if (t.moveFailed > 0) notes.push(UNDO_TEXT.imagesMoveFailed(t.moveFailed));
  for (const g of t.sceneGone) notes.push(UNDO_TEXT.imagesSceneGone(g.count, g.name));
  if (t.rankingSkipped) notes.push(UNDO_TEXT.rankingNotRestored);
  if (notes.length === 0 && t.failed === 0) return;
  const notice = notes.join(' · ');
  return { total: t.total, failed: t.failed, firstError: notice, notice };
}

/** 폴더 → 휴지통(지금 폴더에 있는 part.files 만). 직전 상태를 새로 보관해 다음 되살리기의 기준으로 삼는다. */
async function partToTrash(
  session: Session,
  part: ImagePart,
  ops: ImageFileOps,
  t: PartTally,
): Promise<void> {
  const scene = part.ref.current;
  const count = part.files.length;
  t.total += count;
  if (!sceneInSession(session, scene)) {
    t.failed += count;
    t.sceneGone.push({ name: scene.name, count });
    part.files = [];
    return;
  }
  // 목록을 먼저 맞춘다(방금 복원·복사한 파일이 아직 목록에 없을 수 있음)
  await ops.refreshScene(session, scene);
  const present = new Set(scene.imageMap);
  const targets = part.files.filter((f) => present.has(f));
  const gone = count - targets.length;
  const order = [...scene.imageMap];
  const mains = [...scene.mains];
  const rankBefore = cloneRanking(scene);
  let moved: string[] = [];
  if (targets.length > 0) {
    const dir = ops.outputDir(session, scene);
    const res = await ops.deleteImageFiles(
      session,
      scene,
      targets.map((f) => dir + '/' + f),
      { notify: false },
    );
    moved = res.moved.map(baseName);
  }
  const moveFailed = targets.length - moved.length;
  t.failed += gone + moveFailed;
  t.alreadyGone += gone;
  t.moveFailed += moveFailed;
  part.files = moved;
  part.orderBefore = order;
  part.mainsBefore = mains;
  part.rankBefore = rankBefore;
  part.rankAfter = cloneRanking(scene);
}

/** 휴지통 → 폴더(part.files). 순서는 병합, 즐겨찾기는 복원 파일만 절대값, 순위는 지금이 보낸 직후와 같을 때만. */
async function partFromTrash(
  session: Session,
  part: ImagePart,
  ops: ImageFileOps,
  t: PartTally,
): Promise<void> {
  const scene = part.ref.current;
  const count = part.files.length;
  t.total += count;
  if (!sceneInSession(session, scene)) {
    t.failed += count;
    t.sceneGone.push({ name: scene.name, count });
    part.files = [];
    return;
  }
  if (count === 0) return;
  const r = await ops.restoreImages(session, scene, part.files);
  // 복원된 파일을 목록에 넣는다(끝에 붙음) → 보내기 직전 순서로 병합(그사이 생긴 이미지는 지금 상대 순서대로 뒤에)
  await ops.refreshScene(session, scene);
  if (r.restored.length > 0) {
    ops.applyImageOrder(scene, part.orderBefore);
    const wasMain = new Set(part.mainsBefore);
    for (const f of r.restored) {
      if (wasMain.has(f)) ops.setImageMain(session, scene, f, true);
    }
    if (!sameRanking(part.rankBefore, part.rankAfter)) {
      if (sameRanking(cloneRanking(scene), part.rankAfter)) {
        ops.applyRanking(session, scene, part.rankBefore);
      } else {
        t.rankingSkipped = true;
      }
    }
    await ops.refreshScene(session, scene);
  }
  const missing = r.missing?.length ?? 0;
  t.failed += r.failed.length;
  t.missing += missing;
  t.blocked += r.failed.length - missing;
  part.files = [...r.restored];
}

/**
 * 이미지 파일 묶음 항목 — 처음 상태가 「휴지통에 있음」(삭제 직후)이면 되돌림 = 휴지통에서 꺼냄·다시 실행 = 휴지통으로,
 * 「폴더에 있음」(휴지통 복원·복제·복사·붙여넣기 직후)이면 그 반대.
 */
function imageFilesEntry(
  session: Session,
  parts: ImagePart[],
  label: string,
  startsInTrash: boolean,
  getOps: () => ImageFileOps,
): UndoEntryInit {
  const runParts = async (toTrash: boolean): Promise<UndoOutcome | void> => {
    const ops = getOps();
    const t = newTally();
    for (const part of toTrash ? parts : [...parts].reverse()) {
      if (toTrash) await partToTrash(session, part, ops, t);
      else await partFromTrash(session, part, ops, t);
    }
    return tallyOutcome(t, ops.imageRetentionDays);
  };
  return {
    label,
    kind: 'file',
    verify: () => {
      if (parts.some((p) => sceneInSession(session, p.ref.current))) return true;
      return UNDO_TEXT.sceneGone(parts[0]?.ref.current.name ?? '');
    },
    undo: () => runParts(!startsInTrash),
    redo: () => runParts(startsInTrash),
  };
}

function emptyPart(scene: GenericScene, files: string[]): ImagePart {
  return {
    ref: undoRef(scene),
    files,
    orderBefore: [],
    mainsBefore: [],
    rankBefore: {},
    rankAfter: {},
  };
}

export interface ImageDeleteResult {
  moved: string[];
  failed: string[];
}

export interface ImageDeleteRecorder {
  /**
   * deleteImageFilesDetailed 그대로(휴지통 이동·캐시 무효화·목록 재로딩·실패 알림 — notify:false 면 알리지 않음).
   * 실제로 옮겨진 파일과 직전 순서·즐겨찾기·순위를 씬별로 모은다.
   */
  delete(scene: GenericScene, paths: string[], opts?: { notify?: boolean }): Promise<ImageDeleteResult>;
  /** 모은 것을 1항목으로 기록(여러 씬 일괄도 1항목). 옮겨진 것이 없으면 false */
  commit(): boolean;
}

/** 이미지 삭제(여러 씬 일괄 포함) — 확인 창 뒤에 만들고 서비스 호출을 recorder.delete 로, 끝에 commit */
export function beginImageDelete(
  session: Session | undefined,
  opts: DeleteUndoOptions = {},
): ImageDeleteRecorder {
  const service = opts.service ?? undoService;
  const parts: ImagePart[] = [];
  let committed = false;
  return {
    delete: async (scene, paths, dopts) => {
      const ops = imageOpsOf(opts);
      if (!session) return { moved: [], failed: [...paths] };
      const recordable = service.canRecord(session) && sceneInSession(session, scene);
      const order = [...scene.imageMap];
      const mains = [...scene.mains];
      const rankBefore = cloneRanking(scene);
      const res = await ops.deleteImageFiles(session, scene, paths, { notify: dopts?.notify });
      if (recordable && res.moved.length > 0) {
        const files = res.moved.map(baseName);
        const existing = parts.find((p) => p.ref.current === scene);
        if (existing) {
          // 같은 씬을 한 동작에서 두 번 지운 경우 — 처음 보관한 직전 상태를 기준으로 파일만 더한다
          existing.files.push(...files);
          existing.rankAfter = cloneRanking(scene);
        } else {
          parts.push({
            ref: undoRef(scene),
            files,
            orderBefore: order,
            mainsBefore: mains,
            rankBefore,
            rankAfter: cloneRanking(scene),
          });
        }
      }
      return res;
    },
    commit: () => {
      if (committed) return false;
      committed = true;
      if (!session || parts.length === 0 || !service.canRecord(session)) return false;
      flushSceneFieldEdit();
      const count = parts.reduce((n, p) => n + p.files.length, 0);
      const label = UNDO_TEXT.imageDelete(
        count,
        parts.map((p) => p.ref.current.name),
      );
      return !!service.record(session, imageFilesEntry(session, parts, label, true, () => imageOpsOf(opts)));
    },
  };
}

/**
 * 한 씬 이미지 삭제 — `deleteImageFiles` 와 같은 모양(반환 = 옮기지 못한 수, 실패 알림 포함)에 되돌리기 기록을 더한 것.
 * 확인 창 뒤(「다시 묻지 않음」이면 바로) 부른다.
 */
export async function deleteImageFilesRecorded(
  session: Session,
  paths: string[],
  scene: GenericScene,
  opts: { notify?: boolean } & DeleteUndoOptions = {},
): Promise<number> {
  const rec = beginImageDelete(session, opts);
  try {
    const res = await rec.delete(scene, paths, { notify: opts.notify });
    return res.failed.length;
  } finally {
    rec.commit();
  }
}

/**
 * 이미지 휴지통 「복원」(결과 화면 휴지통 탭·검수 휴지통) — restoreImages 그대로(목록 재로딩은 호출부 몫, 기존 동작).
 * 복원된 것이 있으면 기록(되돌림 = 다시 휴지통으로, 다시 실행 = 다시 꺼냄).
 */
export async function restoreTrashImagesRecorded(
  session: Session,
  scene: GenericScene,
  filenames: string[],
  opts: DeleteUndoOptions = {},
): Promise<ImageTrashRestoreResult> {
  const service = opts.service ?? undoService;
  const ops = imageOpsOf(opts);
  const r = await ops.restoreImages(session, scene, filenames);
  if (r.restored.length > 0 && service.canRecord(session) && sceneInSession(session, scene)) {
    flushSceneFieldEdit();
    service.record(
      session,
      imageFilesEntry(
        session,
        [emptyPart(scene, [...r.restored])],
        UNDO_TEXT.imageTrashRestore(r.restored.length, scene.name),
        false,
        () => imageOpsOf(opts),
      ),
    );
  }
  return r;
}

export type ImageCopyKind = 'duplicate' | 'copy' | 'paste';

/**
 * 이미지 복제(같은 씬)·다른 씬으로 복사·붙여넣기 — copyImageFilesInto 로 복사(새 이름은 겹치지 않게, 원본 형식 유지)하고
 * 만든 파일이 있으면 기록(되돌림 = 만든 파일만 휴지통으로, 다시 실행 = 휴지통에서 꺼냄). 대상 씬 = target.
 */
export async function copyImagesRecorded(
  session: Session,
  target: GenericScene,
  srcPaths: readonly string[],
  kind: ImageCopyKind,
  opts: DeleteUndoOptions = {},
): Promise<{ created: string[]; failed: string[] }> {
  const service = opts.service ?? undoService;
  const ops = imageOpsOf(opts);
  const r = await ops.copyImageFiles(session, target, srcPaths);
  if (r.created.length > 0 && service.canRecord(session) && sceneInSession(session, target)) {
    flushSceneFieldEdit();
    const n = r.created.length;
    const label =
      kind === 'duplicate'
        ? UNDO_TEXT.imageDuplicate(n, target.name)
        : kind === 'copy'
          ? UNDO_TEXT.imageCopyTo(n, target.name)
          : UNDO_TEXT.imagePaste(n, target.name);
    service.record(
      session,
      imageFilesEntry(session, [emptyPart(target, [...r.created])], label, false, () => imageOpsOf(opts)),
    );
  }
  return r;
}
