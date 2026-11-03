// 변형 씬(I2I·인페인트) 편집 창 필드·일괄 작업의 되돌리기 계측(2026-11-02 U5, SPEC_GUIDE 「되돌리기 계약」,
// jest undoVariantPiece.test.ts).
//
// · 기록은 호출부(InPaintEditor·PreSetEditor 이미지 칸·i2iBatchFlow·variantBatchFlow)의 사용자 동작 지점에서만 이 모듈의
//   헬퍼로 한다. 편집 창의 이미지 크기 변경 때 Focused 사각형 맞춤(마운트·이미지 로드 보정)·조합 탭을 열 때 첫 조각 보장·
//   미러 캔버스 갱신은 헬퍼를 거치지 않는다(기록 금지).
// · 씬은 손잡이(undoRef)로, 프리셋은 실행 시점에 「그 씬의 지금 프리셋」으로 따라간다(씬 내용 복제 되돌림이 프리셋 객체를
//   새로 만들어도 이어진다). 세션에 등록되지 않은 변형 씬(초안)은 대입만 하고 기록하지 않는다.
// · 조합(slots) 편집은 같은 SlotEditor 라 sceneFieldUndo(U2b)가 이미 기록한다 — 여기서는 중간 프롬프트처럼 slots 와 프리셋 칸을
//   함께 바꾸는 동작만 slots 를 담는다(중복 기록 없음).
// · 파일을 덮어쓰는 동작(마스크 저장·결과 이미지를 원본으로·해당 이미지로 인페인트·미러 이미지 업로드·외부 편집기)은 기록하지
//   않는다(보류 D20). 이미지 칸 업로드는 **비어 있던 칸에 새 파일 경로를 넣은 경우**만 기록한다 — 되돌림 = 경로를 비움, 새 파일은
//   남김. 이미 있던 이미지를 바꾸는 업로드는 기존대로 제자리 덮어쓰기라 기록하지 않는다.
// · 이미지 필드(imageMap·mains·game·round)는 다루지 않는다(SceneFieldKey 에 없음). 이 모듈은 잠금을 쓰지 않는다(MobX 대입만).
import { runInAction } from 'mobx';
import { editTargetId, flushSceneFieldEdit, restoreSceneFieldValue, touchUndoEdit } from './sceneFieldUndo';
import type { FocusLeaveWatcher, SceneFieldKey } from './sceneFieldUndo';
import { sceneInSession } from './sceneStructureUndo';
import type { GenericScene, InpaintScene, Session } from './types';
import {
  undoDeepClone,
  undoRef,
  undoService,
  UNDO_TEXT,
  UndoPending,
  UndoService,
  UndoSnapshotAdapter,
} from './undoService';

/** 해상도 3필드(씬) */
export const VARIANT_RESOLUTION_KEYS: readonly SceneFieldKey[] = ['resolution', 'resolutionWidth', 'resolutionHeight'];
/** Focused 사각형 4필드(프리셋) */
export const VARIANT_FOCUS_RECT_KEYS: readonly string[] = ['focusX', 'focusY', 'focusW', 'focusH'];
/** Focused 켜짐·사각형(프리셋) — 일괄 첨부·마스크 일괄 적용이 함께 바꾼다 */
export const VARIANT_FOCUS_KEYS: readonly string[] = ['focusEnabled', ...VARIANT_FOCUS_RECT_KEYS];
/** 「일괄 이미지 첨부」가 바꾸는 필드(i2iBatchFlow.attachImageToScenes) */
export const IMAGE_ATTACH_KEYS: VariantFieldKeys = {
  scene: VARIANT_RESOLUTION_KEYS,
  preset: ['image', 'strength', 'noise', 'mask', ...VARIANT_FOCUS_KEYS],
};
/** 「인페인트 마스크 일괄 적용」(variantBatchFlow.applyMaskToScenes) */
export const MASK_APPLY_KEYS: VariantFieldKeys = { preset: ['mask', ...VARIANT_FOCUS_KEYS] };
/** 「강도·노이즈 일괄 변경」(variantBatchFlow.openStrengthBatchFlow) */
export const STRENGTH_BATCH_KEYS: VariantFieldKeys = { preset: ['strength', 'noise'] };

/** 담을 필드 — scene = 씬 필드(SceneFieldKey), preset = 그 씬 프리셋의 키 */
export interface VariantFieldKeys {
  scene?: readonly SceneFieldKey[];
  preset?: readonly string[];
}

export interface VariantUndoOptions {
  service?: UndoService;
}

const NOOP: UndoPending = { commit: () => false, cancel: () => {} };

/** 이 프리셋 객체를 쓰는 **등록된** 변형 씬(없으면 undefined — 초안·그림체·글로벌 사본) */
export function variantSceneOfPreset(session: Session | undefined, preset: unknown): InpaintScene | undefined {
  if (!session || !preset || typeof preset !== 'object') return undefined;
  for (const scene of session.inpaints.values()) {
    if (scene && scene.preset === preset) return scene;
  }
  return undefined;
}

function recordable(
  service: UndoService,
  session: Session | undefined,
  scene: GenericScene | undefined,
): session is Session {
  return (
    !!session &&
    !!scene &&
    scene.type === 'inpaint' &&
    service.canRecord(session) &&
    sceneInSession(session, scene) &&
    !!(scene as InpaintScene).preset
  );
}

/**
 * 씬 필드 + 그 씬 프리셋 키 묶음 상태 짝 — 통째 복원이라 겹침 확인(D16)을 켠다. slots 는 같은 id 조각 객체를 재사용해
 * 되살리고(restoreSceneFieldValue), 프리셋 키는 사본 값을 대입한다(없던 키는 만들지 않음).
 */
export function variantFieldsAdapter(
  session: Session,
  scene: InpaintScene,
  keys: VariantFieldKeys,
): UndoSnapshotAdapter<[unknown[], unknown[]]> {
  const ref = undoRef(scene);
  const sceneKeys = keys.scene ?? [];
  const presetKeys = keys.preset ?? [];
  const sceneRec = () => ref.current as unknown as Record<string, unknown>;
  const preset = () => ref.current.preset as Record<string, unknown> | undefined;
  return {
    detectConflict: true,
    verify: () =>
      sceneInSession(session, ref.current) && ref.current.preset ? true : UNDO_TEXT.sceneGone(ref.current.name),
    snapshot: () => {
      const p = preset();
      return [
        sceneKeys.map((k) => undoDeepClone(sceneRec()[k])),
        presetKeys.map((k) => (p ? undoDeepClone(p[k]) : undefined)),
      ];
    },
    restore: ([s, p]) =>
      runInAction(() => {
        const target = sceneRec();
        sceneKeys.forEach((k, i) => {
          target[k] = restoreSceneFieldValue(k, undoDeepClone(s[i]), target[k]);
        });
        const pr = preset();
        if (!pr) return;
        presetKeys.forEach((k, i) => {
          const v = undoDeepClone(p[i]);
          if (v === undefined && !(k in pr)) return;
          pr[k] = v;
        });
      }),
  };
}

/** mutate 를 감싸 한 번의 동작 = 1항목(바뀌지 않았으면 기록 없음). 기록 대상이 아니면 mutate 만 */
export function editVariantFields<R>(
  session: Session | undefined,
  scene: InpaintScene,
  keys: VariantFieldKeys,
  label: string,
  mutate: () => R,
  opts: VariantUndoOptions = {},
): R {
  const service = opts.service ?? undoService;
  if (!recordable(service, session, scene)) return mutate();
  flushSceneFieldEdit();
  const pending = service.track(session, label, variantFieldsAdapter(session, scene, keys));
  try {
    return mutate();
  } finally {
    pending.commit();
  }
}

/**
 * 시작에 보관하고 commit 때 바뀌었으면 1항목 — 여러 대상을 한 흐름에서 바꾸는 묶음(찾기/바꾸기 「모두 변환」 2차 P3)이
 * 바깥 beginGroup 안에서 쓴다. 기록 대상이 아니면(초안·미러·실행 중) 빈 손잡이.
 */
export function captureVariantFields(
  session: Session | undefined,
  scene: InpaintScene,
  keys: VariantFieldKeys,
  label: string,
  opts: VariantUndoOptions = {},
): UndoPending {
  const service = opts.service ?? undoService;
  if (!recordable(service, session, scene)) return NOOP;
  flushSceneFieldEdit();
  return service.track(session, label, variantFieldsAdapter(session, scene, keys));
}

// ── 슬라이더(누름~뗌 1항목) ─────────────────────────────────────────────────

interface OpenSlide {
  session: Session;
  service: UndoService;
  pending: UndoPending;
  key: string;
}

let openSlide: OpenSlide | undefined;

const fieldKey = (scene: InpaintScene, key: string) => `v|${editTargetId(undoRef(scene))}|${key}`;

function slideCovers(session: Session, service: UndoService, scene: InpaintScene, key: string): boolean {
  const s = openSlide;
  if (!s || s.session !== session || s.service !== service) return false;
  if (!service.isPendingOpen(session, s.pending)) {
    openSlide = undefined;
    return false;
  }
  return s.key === fieldKey(scene, key);
}

/**
 * 프리셋 키 하나 — 같은 씬·키를 1초 안에 또 바꾸면 합친다(D12, 토글·키보드 슬라이더). 열린 슬라이드가 그 칸이면 대입만.
 * 대입은 항상 한다(기록 대상이 아니어도).
 */
export function setVariantPresetField(
  session: Session | undefined,
  scene: InpaintScene,
  key: string,
  value: unknown,
  label: string,
  opts: VariantUndoOptions & { merge?: boolean } = {},
): void {
  const service = opts.service ?? undoService;
  const apply = () =>
    runInAction(() => {
      if (scene.preset) scene.preset[key] = value;
    });
  if (
    !scene.preset ||
    Object.is(scene.preset[key], value) ||
    !recordable(service, session, scene) ||
    slideCovers(session, service, scene, key)
  ) {
    apply();
    return;
  }
  flushSceneFieldEdit();
  const pending = service.track(
    session,
    label,
    variantFieldsAdapter(session, scene, { preset: [key] }),
    opts.merge === false ? undefined : { key: fieldKey(scene, key) },
  );
  try {
    apply();
  } finally {
    pending.commit();
  }
}

/**
 * 슬라이더를 누를 때(pointerdown) — 손 뗄 때 commit(presetUndo.commitOnPointerRelease). 열려 있는 동안 같은 칸의
 * setVariantPresetField 는 대입만 한다. 기록 대상이 아니면 아무것도 하지 않는다.
 */
export function beginVariantSlide(
  session: Session | undefined,
  scene: InpaintScene,
  key: string,
  label: string,
  opts: VariantUndoOptions = {},
): UndoPending {
  const service = opts.service ?? undoService;
  if (!recordable(service, session, scene)) return NOOP;
  flushSceneFieldEdit();
  if (openSlide) openSlide.pending.commit();
  const inner = service.drag(session, label, variantFieldsAdapter(session, scene, { preset: [key] }));
  const slide: OpenSlide = { session, service, pending: inner, key: fieldKey(scene, key) };
  openSlide = slide;
  const settle = () => {
    if (openSlide === slide) openSlide = undefined;
  };
  return {
    commit: () => {
      settle();
      return inner.commit();
    },
    cancel: () => {
      settle();
      inner.cancel();
    },
  };
}

/**
 * 글자 입력(중간 프롬프트 등) — 변경 **직전**에 부른다(값이 실제로 바뀔 때만). 입력 칸을 떠날 때 1항목(D13 —
 * sceneFieldUndo.touchUndoEdit 편집 세션 공유, 한 번에 하나만 열림).
 */
export function touchVariantEdit(
  session: Session | undefined,
  scene: InpaintScene,
  keys: VariantFieldKeys,
  label: string,
  opts: VariantUndoOptions & { watch?: FocusLeaveWatcher } = {},
): void {
  const service = opts.service ?? undoService;
  if (!recordable(service, session, scene)) return;
  const key = `v|${editTargetId(undoRef(scene))}|${(keys.scene ?? []).join(',')}|${(keys.preset ?? []).join(',')}|${label}`;
  touchUndoEdit(session, key, label, () => variantFieldsAdapter(session, scene, keys), {
    service,
    watch: opts.watch,
  });
}

/**
 * 여러 변형 씬을 한 번에 바꾸는 일괄 작업 = 1항목(D14 — 실제로 바뀐 씬만 하위 항목, 되돌림 역순). 라벨은 바뀐 씬 수로
 * 끝나고 정한다. mutate 는 동기(흐름 모듈이 파일 저장을 마친 뒤의 runInAction 한 번).
 */
export function editVariantScenesFields<R>(
  session: Session | undefined,
  scenes: readonly InpaintScene[],
  keys: VariantFieldKeys,
  label: (changed: number) => string,
  mutate: () => R,
  opts: VariantUndoOptions = {},
): R {
  const service = opts.service ?? undoService;
  if (!session || !service.canRecord(session)) return mutate();
  flushSceneFieldEdit();
  const group = service.beginGroup(session, label(0));
  const pendings = Array.from(new Set(scenes))
    .filter((s) => recordable(service, session, s))
    .map((s) => service.track(session, label(1), variantFieldsAdapter(session, s, keys)));
  try {
    return mutate();
  } finally {
    const changed = pendings.map((p) => p.commit()).filter(Boolean).length;
    group.setLabel(label(changed));
    group.commit();
  }
}

/**
 * 편집 창 이미지 칸 업로드(변형 씬) — 기존 동작 그대로: 칸이 **비어 있으면** 새 파일에 저장하고 경로를 넣고,
 * **이미 있으면 같은 파일을 제자리에서 덮어쓴다**(경로 불변). 그 뒤 after(해상도 맞춤 등).
 * 되돌리기 기록은 **비어 있던 칸에 경로를 넣은 경우만**(등록된 씬) — 경로 설정 + 해상도 맞춤 1항목, 되돌림 = 경로를 비우고
 * 해상도 복원(새 파일은 남김), 다시 실행 = 경로 재설정. 덮어쓰기 업로드는 파일 덮어쓰기라 기록하지 않는다(보류 D20).
 * 저장이 실패하면 바뀐 것이 없어 기록도 없다. 파일 쓰기는 호출부가 넘긴 함수로만 한다(이 모듈은 파일을 쓰지 않음).
 */
export async function uploadVariantImageRecorded(
  session: Session | undefined,
  scene: InpaintScene,
  files: {
    /** 새 파일에 저장하고 경로(파일 이름)를 돌려준다 — 칸이 비었을 때 */
    store: () => Promise<string>;
    /** 지금 경로의 파일을 제자리에서 덮어쓴다 — 칸이 이미 있을 때 */
    overwrite: (path: string) => Promise<unknown>;
  },
  after?: () => unknown,
  opts: VariantUndoOptions = {},
): Promise<void> {
  const service = opts.service ?? undoService;
  const current: string | undefined = scene.preset?.image;
  if (current) {
    await files.overwrite(current);
    await after?.();
    return;
  }
  let pending = NOOP;
  if (recordable(service, session, scene)) {
    flushSceneFieldEdit();
    pending = service.track(
      session,
      UNDO_TEXT.variantImageUpload(scene.name),
      variantFieldsAdapter(session, scene, { scene: VARIANT_RESOLUTION_KEYS, preset: ['image'] }),
    );
  }
  try {
    const path = await files.store();
    runInAction(() => {
      if (scene.preset) scene.preset.image = path;
    });
    await after?.();
  } finally {
    pending.commit();
  }
}

/** 테스트·진단용 */
export function resetVariantUndoState(): void {
  openSlide = undefined;
}
