// 찾기/바꾸기 「모두 변환」의 되돌리기 계측(2026-11-03 2차 P3, SPEC_GUIDE 「되돌리기 계약」, jest undoFindReplace.test.ts).
//
// · 한 번의 「모두 변환」 = 되돌리기 1항목(묶음 — 되돌림 역순·다시 실행 정순). 프로젝트 범위만 담는다(사용자 결정 D4):
//   씬 조합 slots·씬 캐릭터(sceneCharacterPrompts·sceneCharacterUC)·변형 씬(slots + 프리셋 prompt·frontPrompt·backPrompt)·
//   로컬 캐릭터 프리셋은 기존 헬퍼(captureSceneFields·captureVariantFields·beginCharacterPresetRecord)로, 씬 이름 변환은
//   recordSceneRename 짝으로. **실제로 바뀐 대상만** 하위 항목이 된다(헬퍼가 변화 없으면 버림).
// · 글로벌 프리셋(글로벌 그림체·글로벌 캐릭터 프리셋 — 프로젝트 밖 별도 스토어)과 프로젝트 이름은 기록하지 않는다.
//   실제로 바뀌었으면 결과에 그 범위를 돌려주고, 호출부가 「… 변경은 되돌리기 대상이 아닙니다」를 안내한다.
// · 순서: 내용 변환(동기) → 씬 이름(비동기 순차) → 묶음 확정 → 프로젝트 이름(묶음 밖). 프로젝트 이름 변경은 세션 인스턴스를
//   그대로 둔다(SessionService.renameProject — 구·신 배치 모두 entries 의 instance 를 새 이름으로 옮김)라 스택은 유지되지만,
//   묶음이 이름 변경을 가로질러 열려 있지 않도록 그 전에 닫는다.
// · 이 모듈은 잠금을 쓰지 않는다 — 대입은 결과 항목의 setText(기존 동작 그대로), 이름 변경은 renameScene(각자 잠금)이 한다.
import { captureSceneFields, flushSceneFieldEdit } from './sceneFieldUndo';
import type { SceneFieldKey } from './sceneFieldUndo';
import { beginCharacterPresetRecord } from './presetUndo';
import { recordSceneRename } from './sceneStructureUndo';
import type { SceneStructureOps } from './sceneStructureUndo';
import { captureVariantFields } from './variantSceneUndo';
import type { VariantFieldKeys } from './variantSceneUndo';
import type { GenericScene, InpaintScene, Session } from './types';
import { undoService, UNDO_TEXT, UndoPending, UndoService } from './undoService';

/** 결과 항목이 쓰는 대상의 종류 — UI 표시와 무관한 기록 분기용 */
export type FindReplaceTargetKind =
  | 'sceneSlots' // 이미지생성 씬 조합 조각(prompt·characterPrompts)
  | 'sceneCharacter' // 이미지생성 씬의 씬 캐릭터 프롬프트·UC
  | 'variant' // 변형 씬(조합 slots·프리셋 prompt/frontPrompt/backPrompt)
  | 'characterPreset' // 프로젝트(로컬) 캐릭터 프리셋
  | 'global' // 글로벌 그림체·글로벌 캐릭터 프리셋 — 기록 안 함
  | 'sceneName' // 씬 이름(실제 이름 변경)
  | 'projectName'; // 프로젝트 이름(실제 이름 변경) — 기록 안 함

export interface FindReplaceTarget {
  kind: FindReplaceTargetKind;
  /** sceneSlots·sceneCharacter·variant·sceneName 의 씬 객체 */
  scene?: GenericScene;
}

/** 검색 결과 한 건(FindReplaceDialog.collectResults). setText 가 false 면 「건너뜀」(이름 충돌·차단 등) */
export interface FindReplaceItem {
  location: string;
  getText: () => string;
  setText: (v: string) => void | boolean | Promise<void | boolean>;
  target: FindReplaceTarget;
}

/** 범위별로 담는 씬 필드(이미지 필드 없음) */
export const FIND_REPLACE_SCENE_KEYS: Readonly<Record<'sceneSlots' | 'sceneCharacter', readonly SceneFieldKey[]>> = {
  sceneSlots: ['slots'],
  sceneCharacter: ['sceneCharacterPrompts', 'sceneCharacterUC'],
};

/** 변형 씬 결과가 쓰는 필드(FindReplaceDialog.collectVariantResults) */
export const FIND_REPLACE_VARIANT_KEYS: VariantFieldKeys = {
  scene: ['slots'],
  preset: ['prompt', 'frontPrompt', 'backPrompt'],
};

/** 되돌리기에 담지 않는 범위의 이름(안내·확인 창 문구) */
export const FIND_REPLACE_UNRECORDED_LABEL: Readonly<Record<'global' | 'projectName', string>> = {
  global: '글로벌 프리셋',
  projectName: '프로젝트 이름',
};

const UNRECORDED_ORDER = ['global', 'projectName'] as const;

/** 결과 목록에 들어 있는 기록 밖 범위 이름(확인 창용 — 바뀔 수 있는 범위) */
export function unrecordedScopesOf(items: readonly FindReplaceItem[]): string[] {
  const kinds = new Set(items.map((i) => i.target.kind));
  return UNRECORDED_ORDER.filter((k) => kinds.has(k)).map((k) => FIND_REPLACE_UNRECORDED_LABEL[k]);
}

export interface FindReplaceOutcome {
  replaced: number;
  skipped: number;
  /** 실제로 바뀌었지만 되돌리기에 담지 않은 범위 이름(없으면 빈 배열) — 안내 UNDO_TEXT.findReplaceNotUndone */
  notUndone: string[];
  /** 되돌리기 항목이 생겼는가 */
  recorded: boolean;
}

export interface FindReplaceUndoOptions {
  service?: UndoService;
  /** 씬 이름 되돌림이 부를 서비스(테스트용 — 기본은 models/index.ts 가 넣은 것) */
  structureOps?: SceneStructureOps;
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && typeof (v as { then?: unknown }).then === 'function';
}

type ApplyResult = 'same' | 'ok' | 'skip';

/** 한 건 변환 — 기존 doReplaceAll 의 판정 그대로(같으면 건너뜀·false 면 건너뜀·예외면 건너뜀). 동기 setText 는 기다리지 않는다 */
function applyItem(
  item: FindReplaceItem,
  search: string,
  replace: string,
): ApplyResult | Promise<ApplyResult> {
  const cur = item.getText();
  const next = cur.replaceAll(search, replace);
  if (cur === next) return 'same';
  const fail = (e: unknown): ApplyResult => {
    console.error('변환 실패:', item.location, e);
    return 'skip';
  };
  try {
    const r = item.setText(next);
    if (isThenable(r)) {
      return Promise.resolve(r).then((ok) => (ok === false ? 'skip' : 'ok'), fail);
    }
    return r === false ? 'skip' : 'ok';
  } catch (e) {
    return fail(e);
  }
}

/**
 * 「모두 변환」 — 결과를 차례로 바꾸고 프로젝트 범위의 변경을 되돌리기 1항목으로 담는다. 화면 갱신(재검색·결과 문구)은 호출부.
 * 결과 순서는 collectResults 의 순서(내용 → 씬 이름 → 프로젝트 이름)를 지키되, 이 함수도 같은 순서로 나눠 처리한다.
 */
export async function replaceAllRecorded(
  session: Session | undefined,
  items: readonly FindReplaceItem[],
  search: string,
  replace: string,
  opts: FindReplaceUndoOptions = {},
): Promise<FindReplaceOutcome> {
  const service = opts.service ?? undoService;
  const content = items.filter((i) => i.target.kind !== 'sceneName' && i.target.kind !== 'projectName');
  const sceneNames = items.filter((i) => i.target.kind === 'sceneName');
  const projectNames = items.filter((i) => i.target.kind === 'projectName');
  let replaced = 0;
  let skipped = 0;
  let recordedChanges = 0;
  const changed = new Set<'global' | 'projectName'>();
  const tally = (r: ApplyResult, item: FindReplaceItem) => {
    if (r === 'skip') skipped++;
    if (r !== 'ok') return;
    replaced++;
    const k = item.target.kind;
    if (k === 'global' || k === 'projectName') changed.add(k);
    else recordedChanges++;
  };

  const label = (n: number) => UNDO_TEXT.findReplaceAll(search, replace, n);
  const recording = !!session && service.canRecord(session);
  // 열린 편집 세션(프롬프트 입력 중)은 먼저 확정 — 기록 순서 = 동작 순서
  if (recording) flushSceneFieldEdit();
  const group = service.beginGroup(session, label(0));
  let recorded = false;
  try {
    // ── 1) 내용(동기) — 바뀔 수 있는 대상을 먼저 보관하고, 다 바꾼 뒤 확정(바뀐 대상만 하위 항목) ──
    const pendings: UndoPending[] = [];
    let characterRec: { commit(): boolean } | undefined;
    if (recording) {
      const sceneKeys = new Map<GenericScene, Set<SceneFieldKey>>();
      const variants = new Set<InpaintScene>();
      let characterPreset = false;
      for (const item of content) {
        const { kind, scene } = item.target;
        if ((kind === 'sceneSlots' || kind === 'sceneCharacter') && scene) {
          const set = sceneKeys.get(scene) ?? new Set<SceneFieldKey>();
          FIND_REPLACE_SCENE_KEYS[kind].forEach((k) => set.add(k));
          sceneKeys.set(scene, set);
        } else if (kind === 'variant' && scene && scene.type === 'inpaint') {
          variants.add(scene as InpaintScene);
        } else if (kind === 'characterPreset') {
          characterPreset = true;
        }
      }
      for (const [scene, keys] of sceneKeys) {
        pendings.push(captureSceneFields(session, scene, [...keys], label(1), { service }));
      }
      for (const scene of variants) {
        pendings.push(captureVariantFields(session, scene, FIND_REPLACE_VARIANT_KEYS, label(1), { service }));
      }
      if (characterPreset) characterRec = beginCharacterPresetRecord(session, label(1), { service });
    }
    try {
      for (const item of content) {
        const r = applyItem(item, search, replace);
        tally(isThenable(r) ? await r : r, item);
      }
    } finally {
      pendings.forEach((p) => p.commit());
      characterRec?.commit();
    }

    // ── 2) 씬 이름(비동기 순차) — 실제로 바뀐 것만 recordSceneRename 짝(묶음 안이라 되돌림은 역순) ──
    for (const item of sceneNames) {
      const scene = item.target.scene;
      const oldName = scene?.name;
      const r = await applyItem(item, search, replace);
      tally(r, item);
      if (r === 'ok' && scene && oldName !== undefined) {
        recordSceneRename(session, scene, oldName, { service, ops: opts.structureOps });
      }
    }
  } finally {
    group.setLabel(label(recordedChanges));
    recorded = group.commit();
  }

  // ── 3) 프로젝트 이름 — 묶음 밖, 기록하지 않음(D4) ──
  for (const item of projectNames) {
    tally(await applyItem(item, search, replace), item);
  }

  return {
    replaced,
    skipped,
    notUndone: UNRECORDED_ORDER.filter((k) => changed.has(k)).map((k) => FIND_REPLACE_UNRECORDED_LABEL[k]),
    recorded,
  };
}
