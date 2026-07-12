// L1-1 워크플로우 UI 요소 키 계약 가드.
//
// 목적: 모든 워크플로우의 UI 최상위 스택에서
//   ① 모든 요소가 wfiElementKey 로 non-empty 키를 얻고
//   ② 스택 안에서 키가 유일한지
// 를 기계적으로 검증한다. 이는 향후 "프리셋 에디터 요소 순서 사용자 오버라이드"가
// 저장할 키의 전제(안정적·고유)를 보장한다.
//
// 무거운 초기화 우회: 워크플로우 모듈(SDWorkFlow/AugmentWorkFlow)은 핸들러에서
// 앱 서비스(models 인덱스 '.'·PromptService·TaskQueueService·ImageService·BrushTool)를
// 참조하므로, 이들을 jest.mock 팩토리로 대체해 UI 정의만 로드한다(팩토리를 주면
// 실제 모듈이 로드되지 않는다). UI 스택(def.editor)은 이 서비스들에 의존하지 않는다.

jest.mock('..', () => ({}));
jest.mock('../PromptService', () => ({
  defaultFPrompt: '',
  defaultBPrompt: '',
  defaultUC: '',
  createSDPrompts: jest.fn(),
  createSDCharacterPrompts: jest.fn(),
  toPARR: jest.fn(),
  lowerPromptNode: jest.fn(),
  expandPieces: jest.fn(),
}));
jest.mock('../ImageService', () => ({ dataUriToBase64: jest.fn() }));
jest.mock('../TaskQueueService', () => ({ queueI2IWorkflow: jest.fn() }));
jest.mock('../../componenets/BrushTool', () => ({ getImageDimensions: jest.fn() }));

import {
  WFIElement,
  WFIStack,
  wfiElementKey,
} from '../workflows/WorkFlow';
import { registerWorkFlows } from '../workflows';
import { WorkFlowService } from '../workflows/WorkFlowService';

// 등록 지점(registerWorkFlows) 기반 순회 — 새 워크플로우가 추가돼도 자동 포함된다.
const service = new WorkFlowService();
registerWorkFlows(service);

// (라벨, 최상위 스택) 목록: 각 워크플로우의 editor + innerEditor 를 모두 대상으로 한다.
const stacks: { label: string; stack: WFIStack }[] = [];
for (const wf of service.workflows.values()) {
  const { type, editor, innerEditor } = wf.def;
  if (editor) stacks.push({ label: `${type}.editor`, stack: editor as WFIStack });
  if (innerEditor)
    stacks.push({ label: `${type}.innerEditor`, stack: innerEditor as WFIStack });
}

describe('워크플로우 UI 키 계약 — 등록된 전 워크플로우', () => {
  it('최소 하나 이상의 UI 스택이 존재한다(로드/등록 sanity)', () => {
    expect(stacks.length).toBeGreaterThan(0);
  });

  it.each(stacks.map((s) => [s.label, s.stack] as const))(
    '%s: 최상위 요소가 모두 non-empty 키를 갖는다',
    (label, stack) => {
      expect(stack.type).toBe('stack');
      const inputs: WFIElement[] = stack.inputs;
      // 실패 시 어떤 인덱스/타입이 키가 없는지 드러나도록 진단 배열을 비교한다.
      const missing = inputs
        .map((el, i) => ({ i, type: el.type, key: wfiElementKey(el) }))
        .filter((e) => !(typeof e.key === 'string' && e.key.length > 0));
      expect(missing).toEqual([]);
    },
  );

  it.each(stacks.map((s) => [s.label, s.stack] as const))(
    '%s: 최상위 요소 키가 스택 안에서 유일하다',
    (label, stack) => {
      const keys = stack.inputs.map((el) => wfiElementKey(el));
      const seen = new Set<string | undefined>();
      const dups: (string | undefined)[] = [];
      for (const k of keys) {
        if (seen.has(k)) dups.push(k);
        seen.add(k);
      }
      // dups 가 비어 있어야 한다(중복 키가 있으면 label 과 함께 dups 내용이 드러남).
      expect({ label, dups }).toEqual({ label, dups: [] });
    },
  );
});

describe('wfiElementKey — 규칙 단위 검증', () => {
  it('inline 은 field 를 키로 쓴다', () => {
    const el: WFIElement = {
      type: 'inline',
      label: 'x',
      field: 'seed',
      fieldType: 'shared',
      flex: 'flex-none',
    };
    expect(wfiElementKey(el)).toBe('seed');
  });

  it('명시 id 가 field/폴백보다 우선한다', () => {
    const el: WFIElement = {
      type: 'inline',
      label: 'x',
      field: 'seed',
      fieldType: 'shared',
      flex: 'flex-none',
      id: 'explicit',
    };
    expect(wfiElementKey(el)).toBe('explicit');
  });

  it('ifIn 은 명시 id 없으면 내부 요소 키로 폴백한다', () => {
    const el: WFIElement = {
      type: 'ifIn',
      field: 'method',
      fieldType: 'shared',
      values: ['a'],
      element: {
        type: 'inline',
        label: 'x',
        field: 'frontPrompt',
        fieldType: 'preset',
        flex: 'flex-1',
      },
    };
    expect(wfiElementKey(el)).toBe('frontPrompt');
  });

  it('sceneOnly 도 내부 요소 키로 폴백한다(중첩 래퍼 재귀)', () => {
    const el: WFIElement = {
      type: 'ifIn',
      field: 'method',
      fieldType: 'shared',
      values: ['a'],
      element: {
        type: 'sceneOnly',
        element: {
          type: 'inline',
          label: 'x',
          field: 'emotion',
          fieldType: 'meta',
          flex: 'flex-none',
        },
      },
    };
    expect(wfiElementKey(el)).toBe('emotion');
  });

  it('키 없는 요소(id 없는 presetSelect)는 undefined', () => {
    expect(wfiElementKey({ type: 'presetSelect' })).toBeUndefined();
  });
});
