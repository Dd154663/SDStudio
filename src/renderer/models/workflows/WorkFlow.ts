import { action, observable, makeAutoObservable } from 'mobx';
import {
  CharacterPrompt,
  GenericScene,
  ModelBackend,
  PromptNode,
  ReferenceItem,
  SDAbstractJob,
  Session,
  VibeItem,
} from '../types';

export type WFBackendType = 'image' | 'none';

export interface WorkFlowDef {
  type: string;
  title: string;
  presetVars: WFVar[];
  sharedVars: WFVar[];
  metaVars: WFVar[];
  backendType: WFBackendType;
  editor: WFIElement;
  emoji?: string;
  innerEditor?: WFIElement;
  hasMask?: boolean;
  i2i: boolean;
  handler: WFHandler;
  createPrompt?: WFCreatePrompt;
  createCharacterPrompts?: WFCreateCharacterPrompts;
  createPreset?: WFCreatePreset;
}

export type WFHandler = (
  session: Session,
  scene: GenericScene,
  prompt: PromptNode,
  characterPrompts: PromptNode[],
  preset: any,
  shared: any,
  samples: number,
  meta?: any,
  onComplete?: (img: string) => void,
  nodelay?: boolean,
) => void | Promise<void>;

export type WFCreatePrompt = (
  session: Session,
  scene: GenericScene,
  preset: any,
  shared: any,
) => PromptNode[] | Promise<PromptNode[]>;

export type WFCreateCharacterPrompts = (
  session: Session,
  scene: GenericScene,
  preset: any,
  shared: any,
) => PromptNode[][] | Promise<PromptNode[][]>;

export type WFCreatePreset = (
  job: SDAbstractJob<string>,
  image?: string,
  mask?: string,
) => any;

export interface WFAbstractVar {
  name: string;
}

export interface WFStringVar extends WFAbstractVar {
  type: 'string';
  default: string;
}

export interface WFBackendVar extends WFAbstractVar {
  type: 'backend';
  default: ModelBackend;
}

export interface WFIntVar extends WFAbstractVar {
  type: 'int';
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface WFNullIntVar extends WFAbstractVar {
  type: 'nullInt';
}

export interface WFVibeSetVar extends WFAbstractVar {
  type: 'vibeSet';
}

export interface WFSamplingVar extends WFAbstractVar {
  type: 'sampling';
  default: string;
}

export interface WFNoiseScheduleVar extends WFAbstractVar {
  type: 'noiseSchedule';
  default: string;
}

export interface WFBoolVar extends WFAbstractVar {
  type: 'bool';
  default: boolean;
}

export interface WFPromptVar extends WFAbstractVar {
  type: 'prompt';
  default: string;
}

export interface WFImageVar extends WFAbstractVar {
  type: 'image';
}

export interface WFMaskVar extends WFAbstractVar {
  type: 'mask';
  imageRef: string;
}

export interface WFSelectItem {
  label: string;
  value: string;
}

export interface WFSelectVar extends WFAbstractVar {
  type: 'select';
  options: WFSelectItem[];
  default: string;
}

export interface WFCharacterPromptsVar extends WFAbstractVar {
  type: 'characterPrompts';
  default: CharacterPrompt[];
}

export interface WFCharacterReferenceVar extends WFAbstractVar {
  type: 'characterReferences';
}

export type WFVar =
  | WFIntVar
  | WFVibeSetVar
  | WFSamplingVar
  | WFNoiseScheduleVar
  | WFBoolVar
  | WFPromptVar
  | WFImageVar
  | WFMaskVar
  | WFBackendVar
  | WFNullIntVar
  | WFStringVar
  | WFSelectVar
  | WFCharacterPromptsVar
  | WFCharacterReferenceVar;

export type WFFieldType = 'preset' | 'shared' | 'meta';

export type WFIFlex = 'flex-1' | 'flex-2' | 'flex-none';

export interface WFIAbstract {
  // L1-1: 워크플로우 UI 요소의 안정적 고유 키(향후 "프리셋 에디터 요소 순서
  // 사용자 오버라이드" 기능의 저장 키). inline 요소는 field 가 자연 키라 보통
  // 미지정이고, 키가 없는 요소(presetSelect/group/middlePlaceholder/push/...)에만
  // 명시한다. 해석은 wfiElementKey 참조. UI 정의 전용 — 데이터 저장 포맷에는 없다.
  id?: string;
}

export interface WFIPresetSelect extends WFIAbstract {
  type: 'presetSelect';
}

export interface WFIProfilePresetSelect extends WFIAbstract {
  type: 'profilePresetSelect';
}

export interface WFIStack extends WFIAbstract {
  type: 'stack';
  inputs: WFIElement[];
}

export interface WFIInlineInput extends WFIAbstract {
  type: 'inline';
  label: string;
  field: string;
  fieldType: WFFieldType;
  flex: WFIFlex;
  menuPlacement?: 'top' | 'bottom';
}

export interface WFIGroup extends WFIAbstract {
  type: 'group';
  label: string;
  inputs: WFIElement[];
}

export interface WFIIfIn extends WFIAbstract {
  type: 'ifIn';
  field: string;
  fieldType: WFFieldType;
  values: string[];
  element: WFIElement;
}

export interface WFISceneOnly extends WFIAbstract {
  type: 'sceneOnly';
  element: WFIElement;
}

export interface WFIMiddlePlaceholderInput extends WFIAbstract {
  type: 'middlePlaceholder';
  label: string;
}

// 추가 프롬프트 (2026-07-18) — 상위/중위 사이의 스크래치 프롬프트.
// 프리셋/공유 변수가 아니라 Session.extraPrompt(프로젝트 귀속, 프리셋 구조 비저장)에
// 바인딩되는 특수 요소라 middlePlaceholder 처럼 전용 타입으로 둔다.
export interface WFIExtraPromptInput extends WFIAbstract {
  type: 'extraPrompt';
  label: string;
}

export interface WFIShowImage extends WFIAbstract {
  type: 'showImage';
  field: string;
  fieldType: WFFieldType;
}

export interface WFIPush extends WFIAbstract {
  type: 'push';
  direction: 'top' | 'bottom' | 'left' | 'right';
}

export type WFIElement =
  | WFIProfilePresetSelect
  | WFIPresetSelect
  | WFIStack
  | WFIInlineInput
  | WFIGroup
  | WFIMiddlePlaceholderInput
  | WFIExtraPromptInput
  | WFIPush
  | WFIIfIn
  | WFISceneOnly
  | WFIShowImage;

function createDefaultValue(varObj: WFVar) {
  switch (varObj.type) {
    case 'int':
      return (varObj as WFIntVar).default;
    case 'vibeSet':
      return [];
    case 'sampling':
      return (varObj as WFSamplingVar).default;
    case 'noiseSchedule':
      return (varObj as WFNoiseScheduleVar).default;
    case 'bool':
      return (varObj as WFBoolVar).default;
    case 'prompt':
      return (varObj as WFPromptVar).default;
    case 'image':
      return '';
    case 'mask':
      return '';
    case 'backend':
      return (varObj as WFBackendVar).default;
    case 'nullInt':
      return null;
    case 'string':
      return (varObj as WFStringVar).default;
    case 'select':
      return (varObj as WFSelectVar).default;
    case 'characterPrompts':
      return (varObj as WFCharacterPromptsVar).default;
    case 'characterReferences':
      return [];
    default:
      throw new Error('Unknown type');
  }
}

function createMobxObject(vars: WFVar[]) {
  const obj: any = {};
  vars.forEach((varObj) => {
    obj[varObj.name] = createDefaultValue(varObj);
  });
  return makeAutoObservable(obj);
}

function materializeWFObj(type: string, vars: WFVar[]) {
  const obj = createMobxObject(vars);
  obj['type'] = type;
  const params: { [key: string]: WFVar } = {};
  for (const varObj of vars) {
    params[varObj.name] = varObj;
  }

  obj.fromJSON = (json: any) => {
    Object.keys(params).forEach((key) => {
      if (params[key].type === 'vibeSet') {
        obj[key] = (json[key] || [])
          .filter((x: any) => x && x.path)
          .map((x: any) => VibeItem.fromJSON(x));
      } else if (params[key].type === 'characterReferences') {
        obj[key] = (json[key] || [])
          .filter((x: any) => x && x.path)
          .map((x: any) => ReferenceItem.fromJSON(x));
      } else if (params[key].type === 'characterPrompts') {
        obj[key] = json[key] || [];
      } else {
        obj[key] = json[key];
      }
    });
  };

  obj.toJSON = () => {
    const json: any = {};
    json['type'] = type;
    Object.keys(params).forEach((key) => {
      if (params[key].type === 'vibeSet') {
        json[key] = obj[key].map((x: VibeItem) => x.toJSON());
      } else if (params[key].type === 'characterReferences') {
        json[key] = obj[key].map((x: ReferenceItem) => x.toJSON());
      } else {
        json[key] = obj[key];
      }
    });
    return json;
  };

  return obj;
}

export class WFVarBuilder {
  private vars: WFVar[] = [];

  clone() {
    const newBuilder = new WFVarBuilder();
    newBuilder.vars = this.vars.slice();
    return newBuilder;
  }

  addIntVar(
    name: string,
    min: number,
    max: number,
    step: number,
    defaultValue: number,
  ): this {
    this.vars.push({
      type: 'int',
      name,
      min,
      max,
      step,
      default: defaultValue,
    });
    return this;
  }

  addNullIntVar(name: string): this {
    this.vars.push({
      type: 'nullInt',
      name,
    });
    return this;
  }

  addVibeSetVar(name: string): this {
    this.vars.push({
      type: 'vibeSet',
      name,
    });
    return this;
  }

  addSamplingVar(name: string, defaultValue: string): this {
    this.vars.push({
      type: 'sampling',
      name,
      default: defaultValue,
    });
    return this;
  }

  addNoiseScheduleVar(name: string, defaultValue: string): this {
    this.vars.push({
      type: 'noiseSchedule',
      name,
      default: defaultValue,
    });
    return this;
  }

  addBoolVar(name: string, defaultValue: boolean): this {
    this.vars.push({
      type: 'bool',
      name,
      default: defaultValue,
    });
    return this;
  }

  addPromptVar(name: string, defaultValue: string): this {
    this.vars.push({
      type: 'prompt',
      name,
      default: defaultValue,
    });
    return this;
  }

  addImageVar(name: string): this {
    this.vars.push({
      type: 'image',
      name,
    });
    return this;
  }

  addMaskVar(name: string, imageRef: string): this {
    this.vars.push({
      type: 'mask',
      name,
      imageRef,
    });
    return this;
  }

  addBackendVar(name: string, defaultValue: ModelBackend): this {
    this.vars.push({
      type: 'backend',
      name,
      default: defaultValue,
    });
    return this;
  }

  addStringVar(name: string, defaultValue: string): this {
    this.vars.push({
      type: 'string',
      name,
      default: defaultValue,
    });
    return this;
  }

  addSelectVar(
    name: string,
    options: WFSelectItem[],
    defaultValue: string,
  ): this {
    this.vars.push({
      type: 'select',
      name,
      options,
      default: defaultValue,
    });
    return this;
  }

  addCharacterPromptsVar(name: string, defaultValue: CharacterPrompt[]): this {
    this.vars.push({
      type: 'characterPrompts',
      name,
      default: defaultValue,
    });
    return this;
  }
  
  addCharacterReferenceVar(name: string): this {
    this.vars.push({
      type: 'characterReferences',
      name,
    });
    return this;
  }

  build(): WFVar[] {
    return this.vars;
  }
}

export class WFWorkFlow {
  def: WorkFlowDef;
  constructor(def: WorkFlowDef) {
    this.def = def;
  }

  getType() {
    return this.def.type;
  }

  getTitle() {
    return this.def.title;
  }

  buildShared() {
    return materializeWFObj(this.def.type, this.def.sharedVars);
  }

  buildMeta() {
    return materializeWFObj(this.def.type, this.def.metaVars);
  }

  buildPreset() {
    let newVars = this.def.presetVars.concat([
      { type: 'string', name: 'name', default: '' },
      { type: 'string', name: 'profile', default: '' },
    ]);
    if (this.def.backendType === 'none') {
      return materializeWFObj(this.def.type, newVars);
    } else {
      newVars = newVars.concat([
        { type: 'backend', name: 'backend', default: { type: 'NAI' } },
      ]);
      return materializeWFObj(this.def.type, newVars);
    }
  }

  presetFromJSON(json: any) {
    const preset = this.buildPreset();
    preset.fromJSON(json);
    return preset;
  }

  sharedFromJSON(json: any) {
    const shared = this.buildShared();
    shared.fromJSON(json);
    return shared;
  }

  metaFromJSON(json: any) {
    const meta = this.buildMeta();
    meta.fromJSON(json);
    return meta;
  }
}

export function wfiPresetSelect(id?: string): WFIPresetSelect {
  return { type: 'presetSelect', id };
}

export function wfiProfilePresetSelect(id?: string): WFIProfilePresetSelect {
  return { type: 'profilePresetSelect', id };
}

export function wfiStack(inputs: WFIElement[], id?: string): WFIStack {
  return { type: 'stack', inputs, id };
}

export function wfiInlineInput(
  label: string,
  field: string,
  fieldType: WFFieldType,
  flex: WFIFlex,
  menuPlacment?: 'top' | 'bottom',
): WFIInlineInput {
  return {
    type: 'inline',
    label,
    field,
    fieldType,
    flex,
    menuPlacement: menuPlacment,
  };
}

export function wfiGroup(
  label: string,
  inputs: WFIElement[],
  id?: string,
): WFIGroup {
  return { type: 'group', label, inputs, id };
}

export function wfiMiddlePlaceholderInput(
  label: string,
  id?: string,
): WFIMiddlePlaceholderInput {
  return { type: 'middlePlaceholder', label, id };
}

export function wfiExtraPromptInput(
  label: string,
  id?: string,
): WFIExtraPromptInput {
  return { type: 'extraPrompt', label, id };
}

export function wfiPush(
  direction: 'top' | 'bottom' | 'left' | 'right',
  id?: string,
): WFIPush {
  return { type: 'push', direction, id };
}

export function wfiIfIn(
  field: string,
  fieldType: WFFieldType,
  values: string[],
  element: WFIElement,
  id?: string,
): WFIIfIn {
  return { type: 'ifIn', field, fieldType, values, element, id };
}

export function wfiSceneOnly(element: WFIElement, id?: string): WFISceneOnly {
  return { type: 'sceneOnly', element, id };
}

export function wfiShowImage(
  field: string,
  fieldType: WFFieldType,
  id?: string,
): WFIShowImage {
  return { type: 'showImage', field, fieldType, id };
}

/**
 * wfiElementKey — 워크플로우 UI 요소의 안정적 고유 키 해석 (L1-1)
 *
 * 향후 "프리셋 에디터 요소 순서 사용자 오버라이드" 기능이 사용자 config 에 저장할
 * 키를 결정한다. 규칙(우선순위):
 *   ① 명시 `id` 가 있으면 그것을 쓴다.
 *   ② inline 요소는 데이터 필드명(`field`)이 자연 키다(이미 배포 후 불변 계약).
 *   ③ ifIn / sceneOnly 래퍼는 명시 id 가 없으면 내부 요소의 키로 폴백한다(재귀).
 *   ④ 그 외 키를 구할 수 없으면 undefined.
 *
 * ⚠ 배포 후 id 불변 계약: 여기서 반환하는 키는 사용자 config(순서 오버라이드)에
 *   저장된다. 요소의 id/field 는 배포 후 변경 금지 — 바꾸면 저장된 순서 설정이
 *   레지스트리에서 사라져 조용히 무시된다(uiToolbar 버튼 id 와 동일한 계약).
 *   이 키는 UI 정의 전용이며 프리셋/세션 JSON(데이터 저장 포맷)에는 절대 넣지 않는다.
 */
export function wfiElementKey(el: WFIElement): string | undefined {
  if (el.id) return el.id;
  if (el.type === 'inline') return (el as WFIInlineInput).field;
  if (el.type === 'ifIn') return wfiElementKey((el as WFIIfIn).element);
  if (el.type === 'sceneOnly') return wfiElementKey((el as WFISceneOnly).element);
  return undefined;
}

export class WFDefBuilder {
  private workflowDef: WorkFlowDef;

  constructor(type: string) {
    this.workflowDef = {
      type,
      presetVars: [],
      sharedVars: [],
      metaVars: [],
      backendType: 'none',
      editor: null as any,
      innerEditor: null as any,
      i2i: false,
      title: '',
      handler: () => {},
    };
  }

  setTitle(title: string): this {
    this.workflowDef.title = title;
    return this;
  }

  setPresetVars(presetVars: WFVar[]): this {
    this.workflowDef.presetVars = presetVars;
    return this;
  }

  setSharedVars(sharedVars: WFVar[]): this {
    this.workflowDef.sharedVars = sharedVars;
    return this;
  }

  setMetaVars(metaVars: WFVar[]): this {
    this.workflowDef.metaVars = metaVars;
    return this;
  }

  setBackendType(backendType: WFBackendType): this {
    this.workflowDef.backendType = backendType;
    return this;
  }

  setEditor(editor: WFIElement): this {
    this.workflowDef.editor = editor;
    return this;
  }

  setInnerEditor(innerEditor: WFIElement): this {
    this.workflowDef.innerEditor = innerEditor;
    return this;
  }

  setI2I(i2i: boolean): this {
    this.workflowDef.i2i = i2i;
    return this;
  }

  setHandler(handler: WFHandler): this {
    this.workflowDef.handler = handler;
    return this;
  }

  setCreatePrompt(createPrompt: WFCreatePrompt): this {
    this.workflowDef.createPrompt = createPrompt;
    return this;
  }

  setCreateCharacterPrompts(
    createCharacterPrompts: WFCreateCharacterPrompts,
  ): this {
    this.workflowDef.createCharacterPrompts = createCharacterPrompts;
    return this;
  }

  setCreatePreset(createPreset: WFCreatePreset): this {
    this.workflowDef.createPreset = createPreset;
    return this;
  }

  setHasMask(hasMask: boolean): this {
    this.workflowDef.hasMask = hasMask;
    return this;
  }

  setEmoji(emoji: string): this {
    this.workflowDef.emoji = emoji;
    return this;
  }

  build(): WorkFlowDef {
    return this.workflowDef;
  }
}
