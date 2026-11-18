// 템플릿 재적용 되돌리기(2026-11-18 프리셋 유실 조사 경로 10·11 — templateReapplyUndo.ts) + 확인 창 미리보기(templateReapplyPreview.ts).
//  · 재적용(교체) → 되돌림 = 그림체 프리셋(사용자가 고친 내용 포함 같은 객체)·캐릭터 프리셋·공용 바이브/레퍼런스·선택·적용 기록이
//    재적용 전과 같음 → 다시 실행 = 재적용 결과와 같음
//  · 적용 기록이 그사이 바뀌면 항목 전체를 버림 · 적용 기록을 되돌릴 수 없으면(막힘) 프로젝트 쪽도 건드리지 않음
//  · 미리보기: 교체될 이름(많으면 「외 N개」)·처음 적용·보호 영역·되돌리기 가능 여부 문구, 전파 확인 문구
// 재적용 동작은 실제 ProjectTemplateService.removeRecordedInstances(교체 의미론) + 인스턴스 추가로 흉내 낸다.
jest.mock('..', () => ({
  backend: {},
  imageService: {},
  workFlowService: {},
  sessionService: {},
  templateService: {},
  globalPresetService: {},
  globalCharacterPresetService: {},
}));
jest.mock('../PersistenceService', () => ({ persistService: { write: jest.fn() } }));
jest.mock('../appStateRef', () => ({ getAppState: () => ({ pushMessage: jest.fn() }) }));

import { WFWorkFlow } from '../workflows/WorkFlow';
import { SDImageGenDef } from '../workflows/SDWorkFlow';
import { CharacterPreset, Session, VibeItem } from '../types';
import { UNDO_TEXT, UndoService } from '../undoService';
import { ProjectTemplateService } from '../ProjectTemplateService';
import { beginTemplateReapplyRecord } from '../templateReapplyUndo';
import { resetPresetUndoState } from '../presetUndo';
import {
  namesLine,
  planReapplyPreview,
  REAPPLY_TEXT,
  reapplyPreviewLines,
} from '../templateReapplyPreview';

const wf = new WFWorkFlow(SDImageGenDef);
const T = 'SDImageGen';

interface Rec {
  inherited: boolean;
  presets: { type: string; name: string }[];
  characterPresetNames: string[];
  vibePaths: string[];
  referencePaths: string[];
}

function harness() {
  const toast = jest.fn();
  const confirm = jest.fn(async () => true);
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: () => false,
    toast,
    now: () => 1000,
    confirm,
  });
  const session = new Session();
  session.name = 'P';
  const tplPreset = wf.buildPreset();
  tplPreset.name = '템플릿 그림체';
  tplPreset.frontPrompt = '원래 템플릿';
  const mine = wf.buildPreset();
  mine.name = '내 그림체';
  session.presets.set(T, [mine, tplPreset]);
  const shared = wf.buildShared();
  shared.vibes = [VibeItem.fromJSON({ path: 'tv-old', info: 1, strength: 0.6 } as any), VibeItem.fromJSON({ path: 'user-v', info: 1, strength: 0.6 } as any)];
  session.presetShareds.set(T, shared);
  const tplChar = CharacterPreset.fromJSON({ name: '템플릿 캐릭', characterPrompt: '옛 캐릭' } as any);
  const myChar = CharacterPreset.fromJSON({ name: '내 캐릭', characterPrompt: '내 것' } as any);
  session.characterPresets.set(tplChar.name, tplChar);
  session.characterPresets.set(myChar.name, myChar);
  session.selectedWorkflow = { workflowType: T, presetName: '템플릿 그림체' };
  // 사이드카 적용 기록(가짜 저장소)
  const store: { rec: Rec | undefined; blocked: boolean } = {
    rec: {
      inherited: false,
      presets: [{ type: T, name: '템플릿 그림체' }],
      characterPresetNames: ['템플릿 캐릭'],
      vibePaths: ['tv-old'],
      referencePaths: [],
    },
    blocked: false,
  };
  const app = {
    get: () => store.rec,
    restore: async (r: Rec | undefined) => {
      if (store.blocked) return false;
      store.rec = r ? JSON.parse(JSON.stringify(r)) : undefined;
      return true;
    },
  };
  const pts = new ProjectTemplateService();
  /** applyProjectTemplateToSession 과 같은 교체: 기록분 제거 → 새 인스턴스 추가 → 선택 → 기록 갱신 */
  const reapply = () => {
    const prev = store.rec!;
    const { selectedRemoved } = pts.removeRecordedInstances(session, prev, {
      removePresets: true,
      removeChars: true,
      removeVibes: true,
      removeRefs: false,
    });
    const p = wf.buildPreset();
    p.name = '템플릿 그림체';
    p.frontPrompt = '새 템플릿';
    session.addPreset(p);
    const c = CharacterPreset.fromJSON({ name: '템플릿 캐릭', characterPrompt: '새 캐릭' } as any);
    session.addCharacterPreset(c);
    shared.vibes = [...shared.vibes, VibeItem.fromJSON({ path: 'tv-new', info: 1, strength: 0.6 } as any)];
    if (selectedRemoved) session.selectedWorkflow = { workflowType: T, presetName: p.name };
    store.rec = { ...prev, presets: [{ type: T, name: p.name }], vibePaths: ['tv-new'] };
  };
  const state = () => ({
    presets: session.presets.get(T)!.map((x: any) => [x.name, x.frontPrompt]),
    chars: [...session.characterPresets.values()].map((c) => [c.name, c.characterPrompt]),
    vibes: (session.presetShareds.get(T)!.vibes ?? []).map((v: any) => v.path),
    sel: { ...session.selectedWorkflow },
    rec: JSON.parse(JSON.stringify(store.rec ?? null)),
  });
  return { service, toast, confirm, session, store, app, reapply, state, tplPreset, mine };
}

beforeEach(() => resetPresetUndoState());

describe('템플릿 재적용 되돌리기', () => {
  test('재적용 → 되돌림 = 재적용 전(사용자가 고친 내용 포함) → 다시 실행 = 재적용 결과', async () => {
    const h = harness();
    // 사용자가 템플릿이 넣은 그림체를 고친 상태 — 재적용이 이것을 지운다
    h.tplPreset.frontPrompt = '사용자가 고친 프롬프트';
    const before = h.state();
    const rec = beginTemplateReapplyRecord(h.session, UNDO_TEXT.templateReapply('T'), h.app, { service: h.service });
    h.reapply();
    expect(rec.commit()).toBe(true);
    const after = h.state();
    expect(after.presets.map((p) => p[0])).toEqual(['내 그림체', '템플릿 그림체']);
    expect(after.presets.map((p) => p[1])).toContain('새 템플릿');
    expect(after.chars).toContainEqual(['템플릿 캐릭', '새 캐릭']);
    expect(after.vibes).toEqual(['user-v', 'tv-new']);
    expect(after.presets.map((p) => p[1])).not.toContain('사용자가 고친 프롬프트');
    expect(h.service.entries(h.session).past.map((e) => e.label)).toEqual([UNDO_TEXT.templateReapply('T')]);

    await h.service.undo(h.session);
    expect(h.state()).toEqual(before);
    // 같은 객체가 원래 자리로(손잡이·열린 편집기 유지)
    expect(h.session.presets.get(T)![1]).toBe(h.tplPreset);

    await h.service.redo(h.session);
    expect(h.state()).toEqual(after);
  });

  test('적용 기록이 그사이 바뀌면(다른 창 등) 항목 전체를 버린다', async () => {
    const h = harness();
    const rec = beginTemplateReapplyRecord(h.session, 'L', h.app, { service: h.service });
    h.reapply();
    rec.commit();
    const after = h.state();
    h.store.rec = { ...h.store.rec!, inherited: true };
    expect(await h.service.undo(h.session)).toBe(false);
    expect(h.toast.mock.calls.at(-1)?.[0]).toContain(UNDO_TEXT.templateApplicationChanged);
    expect({ ...h.state(), rec: after.rec }).toEqual(after); // 프로젝트 쪽 그대로
    expect(h.service.entries(h.session).past).toHaveLength(0);
  });

  test('적용 기록을 되돌릴 수 없으면(막힘) 프로젝트 쪽도 건드리지 않는다', async () => {
    const h = harness();
    const rec = beginTemplateReapplyRecord(h.session, 'L', h.app, { service: h.service });
    h.reapply();
    rec.commit();
    const after = h.state();
    h.store.blocked = true;
    expect(await h.service.undo(h.session)).toBe(false);
    expect(h.toast.mock.calls.at(-1)?.[0]).toContain(UNDO_TEXT.templateApplicationBlocked);
    expect(h.state()).toEqual(after);
  });

  test('처음 적용(기록 없음)을 되돌리면 적용 기록도 지워진다', async () => {
    const h = harness();
    h.store.rec = undefined;
    const before = h.state();
    const rec = beginTemplateReapplyRecord(h.session, 'L', h.app, { service: h.service });
    const p = wf.buildPreset();
    p.name = '새것';
    h.session.addPreset(p);
    h.store.rec = { inherited: false, presets: [{ type: T, name: '새것' }], characterPresetNames: [], vibePaths: [], referencePaths: [] };
    rec.commit();
    await h.service.undo(h.session);
    expect(h.state()).toEqual(before);
    expect(h.store.rec).toBeUndefined();
  });

  test('바뀐 것이 없으면 기록하지 않는다', () => {
    const h = harness();
    const rec = beginTemplateReapplyRecord(h.session, 'L', h.app, { service: h.service });
    expect(rec.commit()).toBe(false);
  });
});

describe('재적용 확인 창 미리보기', () => {
  const tpl = { preset: { type: T }, characterPresets: [{}], vibes: [{}], characterReferences: [] };
  const record = {
    presets: [{ type: T, name: 'A' }],
    characterPresetNames: ['c1', 'c2', 'c3', 'c4', 'c5'],
    vibePaths: ['v1', 'v2'],
    referencePaths: ['r1'],
  };

  test('교체될 이름 — 많으면 「외 N개」, 열린 프로젝트면 지금 있는 것만', () => {
    const p = planReapplyPreview(tpl, record, {
      hasPreset: () => true,
      hasCharacterPreset: (n) => n !== 'c5',
      sharedPaths: () => ({ vibes: new Set(['v1']), references: new Set(['r1']) }),
    });
    expect(p).toMatchObject({ first: false, presets: ['A'], characterPresets: ['c1', 'c2', 'c3', 'c4'], vibes: 1, references: 0 });
    expect(namesLine(p.characterPresets)).toBe('「c1」 「c2」 「c3」 외 1개');
    const lines = reapplyPreviewLines(p, 'undoable');
    expect(lines[0]).toBe(REAPPLY_TEXT.replaceHead);
    expect(lines).toContain(`· ${REAPPLY_TEXT.presets(['A'])}`);
    expect(lines).toContain(`· ${REAPPLY_TEXT.characterPresets(['c1', 'c2', 'c3', 'c4'])}`);
    expect(lines).toContain('· 공용 바이브 1개');
    expect(lines).toContain(REAPPLY_TEXT.sameNameWarning);
    expect(lines.at(-1)).toBe(REAPPLY_TEXT.undoable);
  });

  test('열리지 않은 프로젝트 = 적용 기록 그대로·「남아 있으면」 머리·되돌릴 수 없음', () => {
    const lines = reapplyPreviewLines(planReapplyPreview(tpl, record), 'other');
    expect(lines[0]).toBe(REAPPLY_TEXT.replaceHeadRecorded);
    expect(lines.at(-1)).toBe(REAPPLY_TEXT.notUndoableOther);
    expect(reapplyPreviewLines(planReapplyPreview(tpl, record), 'mirror').at(-1)).toBe(REAPPLY_TEXT.notUndoableMirror);
  });

  test('처음 적용·보호 영역·빈 영역 스킵', () => {
    expect(reapplyPreviewLines(planReapplyPreview(tpl, undefined), 'undoable')).toEqual([REAPPLY_TEXT.first, REAPPLY_TEXT.undoable]);
    const prot = planReapplyPreview(tpl, { ...record, protectAreas: ['characterPresets'] });
    expect(prot.characterPresets).toEqual([]);
    expect(reapplyPreviewLines(prot, 'undoable')).toContain(REAPPLY_TEXT.charactersProtected);
    // 템플릿에 프리셋이 없으면 프리셋 영역은 건너뛴다(교체 안 함)
    expect(planReapplyPreview({ ...tpl, preset: null }, record).presets).toEqual([]);
  });

  test('전파 확인 문구 — 대상 수·교체·되돌릴 수 없음', () => {
    const t = REAPPLY_TEXT.propagateConfirm(3);
    expect(t).toContain('자식 프로젝트 3개');
    expect(t).toContain('지워지고 새 구성으로 다시 만들어집니다');
    expect(t).toContain('되돌릴 수 없습니다');
  });
});
