/**
 * 변형 씬(I2I·인페인트) 필드·일괄 작업과 로컬 조각의 되돌리기 — 2026-11-02 U5 (SPEC_GUIDE 「되돌리기 계약」).
 *  - 변형 씬: Focused 켜기/끄기(1초 병합)·영역·맥락 슬라이더(누름~뗌 1항목), 조합 모드 끄기, 프리셋 칸(setWorkflowField 범위 확장 —
 *    등록된 변형 씬만, 1초 병합·편집 세션, 프리셋 객체가 바뀌어도 그 씬의 지금 프리셋에 씀), 중간 프롬프트 편집 세션(slots+prompt),
 *    이미지 업로드(비어 있던 칸에 경로를 넣은 경우만 — 덮어쓰기 업로드·저장 실패는 기록 없음), 크기 맞추기, 일괄 첨부·마스크·강도/노이즈(여러 씬 1항목·역순·바뀐 씬 수 라벨)
 *  - 파일 덮어쓰기 경로(마스크 저장·결과→원본·미러 업로드)는 기록 헬퍼를 부르지 않음(소스 검사)
 *  - 로컬 조각: 그룹 추가·삭제(원래 자리)·조각 추가·삭제·이름(되돌림 라벨 B → A)·내용(편집 세션)·랜덤 줄 모드·순서 드래그·
 *    JSON 불러오기·전역 → 로컬 복사(병합), 조각 객체 참조 유지, 전역 범위 미기록, 되살린 뒤 onRestored
 *  - F1: 드래그 항목에 pieceName, 이름을 못 찾으면 옮기지 않음(예전엔 마지막 조각이 옮겨짐)
 *  - D16: 기록 밖 변경과 겹치면 확인(취소 = 유지)
 */
jest.mock('..', () => ({ workFlowService: {} }));

import * as fs from 'fs';
import * as path from 'path';
import { WFWorkFlow } from '../workflows/WorkFlow';
import { SDI2IDef, SDImageGenDef, SDInpaintDef } from '../workflows/SDWorkFlow';
import { InpaintScene, Piece, PieceLibrary, PromptPiece, Session } from '../types';
import { UNDO_TEXT, UndoService } from '../undoService';
import { editSceneFields, flushSceneFieldEdit, hasOpenSceneFieldEdit } from '../sceneFieldUndo';
import type { FocusLeaveWatcher } from '../sceneFieldUndo';
import { resetPresetUndoState, setWorkflowField, workflowFieldLabel } from '../presetUndo';
import {
  beginVariantSlide,
  editVariantFields,
  editVariantScenesFields,
  IMAGE_ATTACH_KEYS,
  MASK_APPLY_KEYS,
  resetVariantUndoState,
  setVariantPresetField,
  STRENGTH_BATCH_KEYS,
  touchVariantEdit,
  uploadVariantImageRecorded,
  VARIANT_FOCUS_RECT_KEYS,
  VARIANT_RESOLUTION_KEYS,
  variantSceneOfPreset,
} from '../variantSceneUndo';
import {
  beginPieceDrag,
  configurePieceUndo,
  editPieceGroups,
  editPieceLibrary,
  localGroupNameOf,
  movePieceInLibrary,
  pieceDragItem,
  renamePieceRecorded,
  touchPieceEdit,
} from '../pieceUndo';

interface Harness {
  service: UndoService;
  toast: jest.Mock;
  confirm: jest.Mock<Promise<boolean>, [string, string]>;
  clock: { t: number };
  mirror: { on: boolean };
}

function harness(): Harness {
  const toast = jest.fn();
  const clock = { t: 1000 };
  const mirror = { on: false };
  const confirm = jest.fn<Promise<boolean>, [string, string]>(async () => true);
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: () => mirror.on,
    toast,
    now: () => clock.t,
    confirm,
  });
  return { service, toast, confirm, clock, mirror };
}

/** 편집 세션 확정 시점을 테스트가 정한다 */
function manualWatch(): { watch: FocusLeaveWatcher; leave: () => void } {
  let fn: (() => void) | undefined;
  return {
    watch: (onLeave) => {
      fn = onLeave;
      return () => {
        fn = undefined;
      };
    },
    leave: () => fn?.(),
  };
}

const inpaintWf = new WFWorkFlow(SDInpaintDef);
const i2iWf = new WFWorkFlow(SDI2IDef);
const sdWf = new WFWorkFlow(SDImageGenDef);

const piece = (prompt: string, id: string) =>
  PromptPiece.fromJSON({ prompt, characterPrompts: [], enabled: true, id });

function variant(name: string, wf = inpaintWf): InpaintScene {
  const s = new InpaintScene();
  s.name = name;
  s.workflowType = wf === inpaintWf ? 'SDInpaint' : 'SDI2I';
  s.preset = wf.buildPreset();
  s.preset.image = `${name}-img.png`;
  s.preset.mask = `${name}-mask.png`;
  s.preset.prompt = 'mid';
  s.resolution = 'portrait';
  s.slots = [[piece('mid', `${name}-1`)]];
  s.imageMap = ['old.png'];
  s.mains = ['old.png'];
  return s;
}

function makeSession(...names: string[]) {
  const session = new Session();
  session.name = 'p';
  const scenes = names.map((n) => {
    const s = variant(n);
    session.addScene(s);
    return s;
  });
  return { session, scenes };
}

afterEach(() => {
  flushSceneFieldEdit();
  resetPresetUndoState();
  resetVariantUndoState();
  configurePieceUndo({ onRestored: undefined });
});

// ── 변형 씬 ────────────────────────────────────────────────────────────────

describe('변형 씬 — Focused 값', () => {
  test('켜기/끄기는 1초 병합(되돌아오면 항목 삭제), 넘으면 따로 — 되돌림·다시 실행', async () => {
    const { service, clock } = harness();
    const { session, scenes } = makeSession('V');
    const [v] = scenes;
    setVariantPresetField(session, v, 'focusEnabled', true, UNDO_TEXT.variantFocusOn('V'), { service });
    clock.t += 300;
    setVariantPresetField(session, v, 'focusEnabled', false, UNDO_TEXT.variantFocusOff('V'), { service });
    expect(service.entries(session).past).toHaveLength(0);
    setVariantPresetField(session, v, 'focusEnabled', true, UNDO_TEXT.variantFocusOn('V'), { service });
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(v.preset.focusEnabled).toBe(false);
    await service.redo(session);
    expect(v.preset.focusEnabled).toBe(true);
  });

  test('영역 드래그 결과 = 1항목(사각형 4필드), 되돌림 = 이전 사각형', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('V');
    const [v] = scenes;
    editVariantFields(session, v, { preset: VARIANT_FOCUS_RECT_KEYS }, UNDO_TEXT.variantFocusRect('V'), () => {
      Object.assign(v.preset, { focusX: 8, focusY: 16, focusW: 512, focusH: 512 });
    }, { service });
    expect(service.entries(session).past.map((e) => e.label)).toEqual([UNDO_TEXT.variantFocusRect('V')]);
    await service.undo(session);
    expect([v.preset.focusX, v.preset.focusY, v.preset.focusW, v.preset.focusH]).toEqual([null, null, null, null]);
    await service.redo(session);
    expect(v.preset.focusW).toBe(512);
  });

  test('맥락 여백 슬라이더: 누름~뗌 1항목(열린 동안 대입만), 키보드는 1초 병합', async () => {
    const { service, clock } = harness();
    const { session, scenes } = makeSession('V');
    const [v] = scenes;
    const ctx0 = v.preset.focusContext;
    const slide = beginVariantSlide(session, v, 'focusContext', UNDO_TEXT.variantFocusContext('V'), { service });
    for (const x of [56, 64, 72]) {
      setVariantPresetField(session, v, 'focusContext', x, UNDO_TEXT.variantFocusContext('V'), { service });
      clock.t += 2000; // 오래 끌어도 하나
    }
    expect(service.entries(session).past).toHaveLength(0);
    slide.commit();
    expect(service.entries(session).past).toHaveLength(1);
    setVariantPresetField(session, v, 'focusContext', 80, 'k', { service });
    clock.t += 200;
    setVariantPresetField(session, v, 'focusContext', 88, 'k', { service });
    expect(service.entries(session).past).toHaveLength(2);
    await service.undo(session);
    expect(v.preset.focusContext).toBe(72);
    await service.undo(session);
    expect(v.preset.focusContext).toBe(ctx0);
  });
});

describe('변형 씬 — 조합 모드·프리셋 칸·중간 프롬프트', () => {
  test('조합 모드 끄기 = comboMode + 단일 프롬프트 1항목', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('V');
    const [v] = scenes;
    v.comboMode = 'snapshot';
    editVariantFields(session, v, { scene: ['comboMode'], preset: ['prompt'] }, UNDO_TEXT.variantComboOff('V'), () => {
      v.preset.prompt = 'first combo';
      v.comboMode = undefined;
    }, { service });
    await service.undo(session);
    expect(v.comboMode).toBe('snapshot');
    expect(v.preset.prompt).toBe('mid');
    await service.redo(session);
    expect(v.comboMode).toBeUndefined();
    expect(v.preset.prompt).toBe('first combo');
  });

  test('프리셋 칸(setWorkflowField): 등록된 변형 씬은 기록(1초 병합·변형 씬 라벨), 미등록 초안은 대입만', async () => {
    const { service, clock } = harness();
    const { session, scenes } = makeSession('V');
    const [v] = scenes;
    const label = workflowFieldLabel('preset', '인페인트 강도', { preset: v.preset }, session);
    expect(label).toBe(UNDO_TEXT.variantField('인페인트 강도', 'V'));
    expect(variantSceneOfPreset(session, v.preset)).toBe(v);
    const s0 = v.preset.strength;
    setWorkflowField(session, { preset: v.preset }, 'preset', 'strength', 0.5, { label, service });
    clock.t += 400;
    setWorkflowField(session, { preset: v.preset }, 'preset', 'strength', 0.4, { label, service });
    expect(service.entries(session).past).toHaveLength(1);
    const draft = variant('draft');
    setWorkflowField(session, { preset: draft.preset }, 'preset', 'strength', 0.1, { label: 'x', service });
    expect(draft.preset.strength).toBe(0.1);
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(v.preset.strength).toBe(s0);
  });

  test('글자 칸은 편집 세션 1항목, 프리셋 객체가 그사이 바뀌어도(씬 내용 복제 되돌림 등) 그 씬의 지금 프리셋에 쓴다', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('V');
    const [v] = scenes;
    const { watch, leave } = manualWatch();
    const old = v.preset;
    for (const t of ['a', 'ab', 'abc']) {
      setWorkflowField(session, { preset: v.preset }, 'preset', 'frontPrompt', t, {
        label: 'front', mode: 'edit', service, watch,
      });
    }
    leave();
    expect(service.entries(session).past).toHaveLength(1);
    // 기록 밖에서 프리셋 객체 교체(값은 같게)
    const replaced = inpaintWf.buildPreset();
    replaced.image = old.image;
    replaced.frontPrompt = old.frontPrompt;
    v.preset = replaced;
    await service.undo(session);
    expect(v.preset).toBe(replaced);
    expect(v.preset.frontPrompt).toBe('');
  });

  test('중간 프롬프트 = 프리셋 prompt + 첫 조각을 편집 세션 1항목, 조각 객체는 그대로', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('V');
    const [v] = scenes;
    const first = v.slots[0][0];
    const { watch, leave } = manualWatch();
    const type = (txt: string) => {
      touchVariantEdit(session, v, { scene: ['slots'], preset: ['prompt'] }, UNDO_TEXT.sceneMiddlePrompt('V'), {
        service, watch,
      });
      v.preset.prompt = txt;
      v.slots[0][0].prompt = txt;
    };
    type('m1');
    type('m12');
    expect(hasOpenSceneFieldEdit()).toBe(true);
    leave();
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(v.preset.prompt).toBe('mid');
    expect(v.slots[0][0].prompt).toBe('mid');
    expect(v.slots[0][0]).toBe(first);
  });
});

describe('변형 씬 — 이미지 업로드·크기 맞추기', () => {
  /** 파일 쓰기 흉내 — 무엇을 불렀는지 기록 */
  const fakeFiles = (newPath: string) => {
    const calls: string[] = [];
    return {
      calls,
      files: {
        store: async () => {
          calls.push('store');
          return newPath;
        },
        overwrite: async (p: string) => {
          calls.push(`overwrite:${p}`);
        },
      },
    };
  };
  const fitTo = (v: InpaintScene, w: number, h: number) => async () => {
    v.resolution = 'custom';
    v.resolutionWidth = w;
    v.resolutionHeight = h;
  };

  test('비어 있던 칸 = 새 파일 경로 + 해상도 맞춤 1항목, 되돌림 = 경로 비움·해상도 복원(이미지 필드는 그대로), 다시 실행 = 경로 재설정', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('V');
    const [v] = scenes;
    v.preset.image = '';
    const f = fakeFiles('new-file.png');
    await uploadVariantImageRecorded(session, v, f.files, fitTo(v, 1024, 768), { service });
    expect(f.calls).toEqual(['store']);
    expect(v.preset.image).toBe('new-file.png');
    expect(service.entries(session).past.map((e) => e.label)).toEqual([UNDO_TEXT.variantImageUpload('V')]);
    v.imageMap.push('generated.png'); // 그사이 생성
    await service.undo(session);
    expect(v.preset.image).toBe('');
    expect(v.resolution).toBe('portrait');
    expect(v.imageMap).toEqual(['old.png', 'generated.png']);
    await service.redo(session);
    expect(v.preset.image).toBe('new-file.png');
    expect(v.resolutionWidth).toBe(1024);
  });

  test('이미 이미지가 있으면 같은 파일 제자리 덮어쓰기(경로 불변)·기록 없음(파일 덮어쓰기 = 보류)', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('V');
    const [v] = scenes;
    const f = fakeFiles('unused.png');
    await uploadVariantImageRecorded(session, v, f.files, fitTo(v, 640, 640), { service });
    expect(f.calls).toEqual(['overwrite:V-img.png']);
    expect(v.preset.image).toBe('V-img.png');
    expect(v.resolutionWidth).toBe(640); // 해상도 맞춤은 그대로 일어난다
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('저장 실패면 기록 없음, 미등록 초안·미러 프로젝트는 저장·대입만', async () => {
    const { service, mirror } = harness();
    const { session, scenes } = makeSession('V');
    const [v] = scenes;
    v.preset.image = '';
    await expect(
      uploadVariantImageRecorded(
        session,
        v,
        {
          store: async () => {
            throw new Error('disk');
          },
          overwrite: async () => {},
        },
        undefined,
        { service },
      ),
    ).rejects.toThrow('disk');
    expect(v.preset.image).toBe('');
    expect(service.entries(session).past).toHaveLength(0);
    const draft = variant('draft');
    draft.preset.image = '';
    await uploadVariantImageRecorded(session, draft, fakeFiles('d.png').files, undefined, { service });
    expect(draft.preset.image).toBe('d.png');
    mirror.on = true;
    await uploadVariantImageRecorded(session, v, fakeFiles('m.png').files, undefined, { service });
    expect(v.preset.image).toBe('m.png');
    mirror.on = false;
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('이미지 크기로 맞추기 = 해상도 3필드 1항목', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('V');
    const [v] = scenes;
    editSceneFields(session, v, VARIANT_RESOLUTION_KEYS, UNDO_TEXT.variantFitResolution('V'), () => {
      v.resolution = 'custom';
      v.resolutionWidth = 832;
      v.resolutionHeight = 1216;
    }, { service });
    await service.undo(session);
    expect([v.resolution, v.resolutionWidth, v.resolutionHeight]).toEqual(['portrait', undefined, undefined]);
  });
});

describe('변형 씬 — 일괄 작업(여러 씬 1항목·역순)', () => {
  test('일괄 첨부: 바뀐 씬만 하위 항목, 라벨 = 바뀐 씬 수, 미등록 씬 제외, 되돌림·다시 실행', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A', 'B', 'C');
    const [a, b, c] = scenes;
    const i2i = variant('I', i2iWf);
    session.addScene(i2i);
    const draft = variant('draft');
    const order: string[] = [];
    editVariantScenesFields(session, [a, b, i2i, draft], IMAGE_ATTACH_KEYS, (n) => UNDO_TEXT.imageAttachBatch(n), () => {
      for (const s of [a, b, i2i, draft]) {
        s.preset.image = `${s.name}-attached.png`;
        s.preset.strength = 0.6;
        s.resolution = 'custom';
        s.resolutionWidth = 640;
        s.resolutionHeight = 640;
        order.push(s.name);
      }
      a.preset.mask = '';
      Object.assign(a.preset, { focusEnabled: false, focusX: null });
      i2i.preset.noise = 0.2;
    }, { service });
    const past = service.entries(session).past;
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe(UNDO_TEXT.imageAttachBatch(3));
    expect(c.preset.image).toBe('C-img.png'); // 대상 아님
    await service.undo(session);
    expect([a.preset.image, b.preset.image, i2i.preset.image]).toEqual(['A-img.png', 'B-img.png', 'I-img.png']);
    expect(a.preset.mask).toBe('A-mask.png');
    expect(i2i.preset.noise).toBe(0);
    expect(a.resolution).toBe('portrait');
    expect(draft.preset.image).toBe('draft-attached.png'); // 미등록 씬은 기록 밖
    expect('focusEnabled' in i2i.preset).toBe(false); // I2I 프리셋에 없던 키는 만들지 않음
    await service.redo(session);
    expect(b.preset.image).toBe('B-attached.png');
    expect(a.preset.mask).toBe('');
  });

  test('마스크 일괄 적용·강도/노이즈 일괄 — 각 1항목, 하나도 안 바뀌면 기록 없음', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A', 'B');
    const [a, b] = scenes;
    editVariantScenesFields(session, [a, b], MASK_APPLY_KEYS, (n) => UNDO_TEXT.maskApplyBatch(n), () => {
      a.preset.mask = 'A-new-mask.png';
      b.preset.mask = 'B-new-mask.png';
      Object.assign(b.preset, { focusEnabled: true, focusX: 0, focusY: 0, focusW: 256, focusH: 256 });
    }, { service });
    const s0 = a.preset.strength;
    editVariantScenesFields(session, [a, b], STRENGTH_BATCH_KEYS, (n) => UNDO_TEXT.strengthNoiseBatch(n), () => {
      a.preset.strength = 0.3;
      b.preset.strength = 0.3;
    }, { service });
    editVariantScenesFields(session, [a], STRENGTH_BATCH_KEYS, (n) => UNDO_TEXT.strengthNoiseBatch(n), () => {
      a.preset.strength = 0.3; // 같은 값
    }, { service });
    expect(service.entries(session).past.map((e) => e.label)).toEqual([
      UNDO_TEXT.maskApplyBatch(2),
      UNDO_TEXT.strengthNoiseBatch(2),
    ]);
    await service.undo(session);
    expect([a.preset.strength, b.preset.strength]).toEqual([s0, s0]);
    await service.undo(session);
    expect([a.preset.mask, b.preset.mask]).toEqual(['A-mask.png', 'B-mask.png']);
    expect(b.preset.focusEnabled).toBe(false);
    expect(b.preset.focusW).toBeNull();
  });

  test('D16 — 기록 밖에서 같은 칸이 또 바뀌면 확인(취소 = 항목 유지)', async () => {
    const { service, confirm } = harness();
    const { session, scenes } = makeSession('A', 'B');
    const [a, b] = scenes;
    editVariantScenesFields(session, [a, b], STRENGTH_BATCH_KEYS, (n) => UNDO_TEXT.strengthNoiseBatch(n), () => {
      a.preset.strength = 0.3;
      b.preset.strength = 0.3;
    }, { service });
    b.preset.strength = 0.9; // 기록 밖
    confirm.mockResolvedValueOnce(false);
    expect(await service.undo(session)).toBe(false);
    expect(service.entries(session).past).toHaveLength(1);
    expect(b.preset.strength).toBe(0.9);
    expect(await service.undo(session)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(b.preset.strength).toBe(1);
  });

  test('씬이 그사이 지워지면 그 하위 항목만 실패', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A', 'B');
    const [a, b] = scenes;
    editVariantScenesFields(session, [a, b], STRENGTH_BATCH_KEYS, (n) => UNDO_TEXT.strengthNoiseBatch(n), () => {
      a.preset.strength = 0.3;
      b.preset.strength = 0.3;
    }, { service });
    session.inpaints.delete('B'); // 기록 밖 제거(테스트 전용)
    expect(await service.undo(session)).toBe(true);
    expect(a.preset.strength).toBe(1);
  });
});

describe('파일 덮어쓰기 경로는 기록하지 않는다(소스 검사)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
  /** 선언 줄부터 짝이 맞는 중괄호 끝까지 */
  const block = (src: string, marker: string) => {
    const i = src.indexOf(marker);
    expect(i).toBeGreaterThanOrEqual(0);
    const open = src.indexOf('{', i);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
    }
    return src.slice(i);
  };
  const RECORDERS = /Variant|editSceneFields|undoService|setWorkflowField|touch\w*Edit/;

  test('마스크 저장·미러 업로드·미러 캔버스 갱신·결과 → 원본은 기록 헬퍼를 부르지 않는다', () => {
    const ipe = read('componenets/InPaintEditor.tsx');
    for (const marker of [
      'const saveMask = async',
      'const uploadMirrorImage = async',
      'const refreshMirrorCanvas = async',
      'aria-label="결과 이미지를 원본으로 적용"',
    ]) {
      expect(block(ipe, marker)).not.toMatch(RECORDERS);
    }
    // 이미지 로드 뒤 Focused 사각형 맞춤(시스템 보정)도 기록하지 않는다
    const from = ipe.indexOf('getImageDimensions(image)');
    const to = ipe.indexOf('}, [image]);', from);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    expect(ipe.slice(from, to)).not.toMatch(RECORDERS);
    // 되돌리기 모듈은 파일을 쓰지 않는다
    expect(read('models/variantSceneUndo.ts')).not.toMatch(/writeVibeImage|storeVibeImage/);
    expect(read('models/pieceUndo.ts')).not.toMatch(/writeFile|writeVibeImage/);
  });
});

// ── 로컬 조각 ──────────────────────────────────────────────────────────────

const lib = (name: string, ...pieces: [string, string][]) =>
  PieceLibrary.fromJSON({ version: 1, name, pieces: pieces.map(([n, p]) => ({ name: n, prompt: p, multi: false })) });

function pieceSession() {
  const session = new Session();
  session.name = 'p';
  session.library.set('g1', lib('g1', ['a', 'A'], ['b', 'B'], ['c', 'C']));
  session.library.set('g2', lib('g2', ['x', 'X']));
  return session;
}

const names = (l: PieceLibrary | undefined) => (l?.pieces ?? []).map((p) => p.name);

describe('로컬 조각 — 그룹', () => {
  test('그룹 추가 → 되돌림 = 그룹 없음, 다시 실행 = 같은 내용, 되살린 뒤 onRestored', async () => {
    const { service } = harness();
    const session = pieceSession();
    const onRestored = jest.fn();
    configurePieceUndo({ onRestored });
    editPieceGroups(session, session.library, ['g3'], UNDO_TEXT.pieceGroupAdd('g3'), () => {
      session.library.set('g3', lib('g3', ['n', 'N']));
    }, { service });
    await service.undo(session);
    expect(session.library.has('g3')).toBe(false);
    expect(onRestored).toHaveBeenCalledWith(session);
    await service.redo(session);
    expect(names(session.library.get('g3'))).toEqual(['n']);
  });

  test('그룹 삭제 → 되돌림 = 원래 자리·내용으로', async () => {
    const { service } = harness();
    const session = pieceSession();
    session.library.set('g3', lib('g3'));
    editPieceGroups(session, session.library, ['g1'], UNDO_TEXT.pieceGroupRemove('g1'), () => {
      session.library.delete('g1');
    }, { service });
    session.library.set('later', lib('later')); // 기록 밖에서 생긴 그룹은 뒤에 남는다
    await service.undo(session);
    expect(Array.from(session.library.keys())).toEqual(['g1', 'g2', 'g3', 'later']);
    expect(session.library.get('g1')!.pieces.map((p) => p.prompt)).toEqual(['A', 'B', 'C']);
  });

  test('JSON 불러오기·전역 → 로컬 병합 복사 = 대상 그룹 단위 1항목', async () => {
    const { service } = harness();
    const session = pieceSession();
    editPieceGroups(session, session.library, ['imp'], UNDO_TEXT.pieceGroupImport('imp'), () => {
      session.library.set('imp', lib('imp', ['i', 'I']));
    }, { service });
    const g2 = session.library.get('g2')!;
    const x = g2.pieces[0];
    editPieceGroups(session, session.library, ['g2'], UNDO_TEXT.pieceGroupFromGlobal('g2', '병합'), () => {
      g2.pieces[0] = Piece.fromJSON({ name: 'x', prompt: 'X from global' });
      g2.pieces.push(Piece.fromJSON({ name: 'y', prompt: 'Y' }));
    }, { service });
    await service.undo(session);
    expect(names(session.library.get('g2'))).toEqual(['x']);
    expect(session.library.get('g2')!.pieces[0].prompt).toBe('X');
    expect(session.library.get('g2')).toBe(g2); // 그룹 객체 유지
    await service.undo(session);
    expect(session.library.has('imp')).toBe(false);
    void x;
  });
});

describe('로컬 조각 — 조각 단위(객체 참조 유지)', () => {
  test('조각 추가·삭제·랜덤 줄 모드 — 되돌림, 건드리지 않은 조각 객체는 그대로', async () => {
    const { service } = harness();
    const session = pieceSession();
    const g1 = session.library.get('g1')!;
    const [a, b, c] = g1.pieces;
    editPieceLibrary(session, g1, (g) => UNDO_TEXT.pieceAdd(g, 'd'), () => {
      g1.pieces.push(Piece.fromJSON({ name: 'd', prompt: '', multi: false }));
    }, { service });
    editPieceLibrary(session, g1, (g) => UNDO_TEXT.pieceRemove(g, 'b'), () => {
      g1.pieces.splice(1, 1);
    }, { service });
    editPieceLibrary(session, g1, (g) => UNDO_TEXT.pieceMulti(g, 'a'), () => {
      a.multi = true;
    }, { service });
    expect(service.entries(session).past.map((e) => e.label)).toEqual([
      UNDO_TEXT.pieceAdd('g1', 'd'),
      UNDO_TEXT.pieceRemove('g1', 'b'),
      UNDO_TEXT.pieceMulti('g1', 'a'),
    ]);
    await service.undo(session);
    expect(a.multi).toBe(false);
    await service.undo(session);
    expect(names(g1)).toEqual(['a', 'b', 'c', 'd']);
    expect(g1.pieces[0]).toBe(a);
    expect(g1.pieces[2]).toBe(c);
    expect(g1.pieces[1]).not.toBe(b); // 지운 조각은 사본에서 되살린다(값은 같음)
    expect(g1.pieces[1].prompt).toBe('B');
    await service.undo(session);
    expect(names(g1)).toEqual(['a', 'b', 'c']);
  });

  test('이름 변경: 되돌림 라벨 B → A, 같은 조각 객체에 이름을 되돌린다', async () => {
    const { service, toast } = harness();
    const session = pieceSession();
    const g1 = session.library.get('g1')!;
    const b = g1.pieces[1];
    renamePieceRecorded(session, g1, b, 'bee', { service });
    expect(b.name).toBe('bee');
    expect(service.peekLabel(session, 'undo')).toBe(UNDO_TEXT.pieceRename('g1', 'bee', 'b'));
    await service.undo(session);
    expect(g1.pieces[1]).toBe(b);
    expect(b.name).toBe('b');
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undone(UNDO_TEXT.pieceRename('g1', 'bee', 'b')), 'info');
    await service.redo(session);
    expect(b.name).toBe('bee');
  });

  test('내용 글자 = 편집 세션 1항목, 열린 칸의 조각 객체는 그대로', async () => {
    const { service } = harness();
    const session = pieceSession();
    const g1 = session.library.get('g1')!;
    const a = g1.pieces[0];
    const { watch, leave } = manualWatch();
    for (const t of ['A1', 'A12', 'A123']) {
      touchPieceEdit(session, g1, a, { service, watch });
      a.prompt = t;
    }
    leave();
    expect(service.entries(session).past.map((e) => e.label)).toEqual([UNDO_TEXT.piecePrompt('g1', 'a')]);
    await service.undo(session);
    expect(g1.pieces[0]).toBe(a);
    expect(a.prompt).toBe('A');
  });

  test('순서 드래그 = 끌기 시작~끝 1항목(hover 마다 여러 번 옮겨도), 변화 없으면 기록 없음', async () => {
    const { service } = harness();
    const session = pieceSession();
    const g1 = session.library.get('g1')!;
    const objs = [...g1.pieces];
    const drag = beginPieceDrag(session, g1, { service });
    movePieceInLibrary(g1, 'a', 'b');
    movePieceInLibrary(g1, 'a', 'c');
    expect(names(g1)).toEqual(['b', 'c', 'a']);
    drag.commit();
    expect(service.entries(session).past.map((e) => e.label)).toEqual([UNDO_TEXT.pieceMove('g1')]);
    const still = beginPieceDrag(session, g1, { service });
    expect(still.commit()).toBe(false);
    await service.undo(session);
    expect(names(g1)).toEqual(['a', 'b', 'c']);
    expect(g1.pieces).toEqual(objs);
    g1.pieces.forEach((p, i) => expect(p).toBe(objs[i]));
  });

  test('D16 — 기록 밖에서 같은 그룹이 바뀌면 확인, 취소 = 유지', async () => {
    const { service, confirm } = harness();
    const session = pieceSession();
    const g1 = session.library.get('g1')!;
    editPieceLibrary(session, g1, (g) => UNDO_TEXT.pieceAdd(g, 'd'), () => {
      g1.pieces.push(Piece.fromJSON({ name: 'd', prompt: '' }));
    }, { service });
    g1.pieces[0].prompt = 'outside';
    confirm.mockResolvedValueOnce(false);
    expect(await service.undo(session)).toBe(false);
    expect(names(g1)).toEqual(['a', 'b', 'c', 'd']);
    // 다른 그룹이 기록 밖에서 바뀐 것은 겹침이 아니다
    confirm.mockClear();
    g1.pieces[0].prompt = 'A';
    session.library.get('g2')!.pieces[0].prompt = 'other group';
    expect(await service.undo(session)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('범위 밖 Map 은 기록하지 않는다(전역 조각 기록은 2차 묶음 5 — undoBundle5.test.ts)', () => {
  test('대상이 session.library·배선된 전역 Map 이 아니면 실행만', () => {
    const { service } = harness();
    const session = pieceSession();
    const globalMap = new Map<string, PieceLibrary>([['gg', lib('gg', ['p', 'P'], ['q', 'Q'])]]);
    const gg = globalMap.get('gg')!;
    expect(localGroupNameOf(session, gg)).toBeUndefined();
    editPieceGroups(session, globalMap, ['new'], 'x', () => globalMap.set('new', lib('new')), { service });
    editPieceLibrary(session, gg, (g) => g, () => gg.pieces.push(Piece.fromJSON({ name: 'r', prompt: '' })), {
      service,
    });
    renamePieceRecorded(session, gg, gg.pieces[0], 'pp', { service });
    touchPieceEdit(session, gg, gg.pieces[1], { service });
    expect(beginPieceDrag(session, gg, { service }).commit()).toBe(false);
    expect(globalMap.has('new')).toBe(true);
    expect(names(gg)).toEqual(['pp', 'q', 'r']);
    expect(hasOpenSceneFieldEdit()).toBe(false);
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('미러(읽기 전용) 프로젝트도 기록하지 않는다', () => {
    const { service, mirror } = harness();
    const session = pieceSession();
    mirror.on = true;
    editPieceGroups(session, session.library, ['g9'], 'x', () => session.library.set('g9', lib('g9')), {
      service,
    });
    expect(session.library.has('g9')).toBe(true);
    expect(service.entries(session).past).toHaveLength(0);
  });
});

describe('F1 — 조각 드래그(되돌리기와 별개 결함)', () => {
  test('드래그 항목에 옮길 조각 이름(pieceName)이 들어간다', () => {
    const g = lib('g', ['a', 'A']);
    const item = pieceDragItem(g.pieces[0], g, 'g', 120);
    expect(item.pieceName).toBe('a');
    expect(item.piece).toBe(g.pieces[0]);
  });

  test('이름을 못 찾으면(예전 pieceName 누락 = undefined) 아무것도 옮기지 않는다 — 마지막 조각이 옮겨지던 결함', () => {
    const g = lib('g', ['a', 'A'], ['b', 'B'], ['c', 'C']);
    expect(movePieceInLibrary(g, undefined, 'a')).toBe(false);
    expect(movePieceInLibrary(g, 'zzz', 'a')).toBe(false);
    expect(movePieceInLibrary(g, 'a', 'a')).toBe(false);
    expect(names(g)).toEqual(['a', 'b', 'c']);
    expect(movePieceInLibrary(g, 'c', 'a')).toBe(true);
    expect(names(g)).toEqual(['c', 'a', 'b']);
  });

  test('PieceCell 이 드래그 항목을 pieceDragItem 으로 만들고 hover 가 pieceName 을 넘긴다(소스 검사)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'componenets', 'PieceEditor.tsx'), 'utf8');
    expect(src).toMatch(/pieceDragItem\(piece, curPieceLibrary, name, curWidth\)/);
    expect(src).toMatch(/movePiece!\(draggedItem\.pieceName, piece\.name\)/);
    expect(src).toMatch(/movePieceInLibrary\(curPieceLibrary, from, to\)/);
  });
});

void sdWf;
