import {
  AugmentMethod,
  NoiseSchedule,
  Resolution,
  Sampling,
} from '../backends/imageGen';
import {
  types,
  Instance,
  cast,
  SnapshotIn,
  SnapshotOut,
} from 'mobx-state-tree';
import { action, observable, makeObservable } from 'mobx';
import { Serealizable } from './ResourceSyncService';
import { workFlowService } from '.';
import { WFWorkFlow, WorkFlowDef } from './workflows/WorkFlow';

export type PARR = string[];

export interface IVibeItem {
  path: string;
  info: number;
  strength: number;
}

export class VibeItem implements IVibeItem {
  @observable accessor path: string = '';
  @observable accessor info: number = 0;
  @observable accessor strength: number = 0;

  static fromJSON(json: IVibeItem): VibeItem {
    const item = new VibeItem();
    Object.assign(item, json);
    return item;
  }

  toJSON(): IVibeItem {
    return {
      path: this.path,
      info: this.info,
      strength: this.strength,
    };
  }
}

export interface ModelBackend {
  type: 'NAI' | 'SD';
  model?: string;
}

export interface AbstractJob {}

export interface SDAbstractJob<T> extends AbstractJob {
  cfgRescale: number;
  steps: number;
  promptGuidance: number;
  sampling: string;
  prompt: T;
  uc: string;
  characterPrompts: CharacterPrompt<T>[];
  useCoords: boolean;
  legacyPromptConditioning: boolean;
  normalizeStrength: boolean;
  varietyPlus: boolean;
  characterReferences: IReferenceItem[];
  noiseSchedule: string;
  backend: ModelBackend;
  vibes: IVibeItem[];
  overrideResolution?: Resolution;
  seed?: number;
}

export interface SDJob extends SDAbstractJob<PromptNode> {
  type: 'sd';
}

export interface SDInpaintJob extends SDAbstractJob<PromptNode> {
  type: 'sd_inpaint';
  mask: string;
  image: string;
  strength: number;
  noise: number;
  originalImage?: boolean;
}

export interface SDI2IJob extends SDAbstractJob<PromptNode> {
  type: 'sd_i2i';
  image: string;
  strength: number;
  noise: number;
}

export interface AugmentJob extends AbstractJob {
  type: 'augment';
  image: string;
  method: AugmentMethod;
  prompt?: PromptNode;
  weaken?: number;
  emotion?: string;
  width: number;
  height: number;
  backend: ModelBackend;
}

export interface UpscaleJob extends AbstractJob {
  type: 'upscale';
  image: string;
  resolution: string;
}

export type Job = SDJob | SDInpaintJob | AugmentJob | UpscaleJob | SDI2IJob;

export interface IPiece {
  name: string;
  prompt: string;
  multi?: boolean;
}

export class Piece implements IPiece {
  @observable accessor name: string = '';
  @observable accessor prompt: string = '';
  @observable accessor multi: boolean | undefined = undefined;

  static fromJSON(json: IPiece): Piece {
    const piece = new Piece();
    Object.assign(piece, json);
    return piece;
  }

  toJSON(): IPiece {
    return {
      name: this.name,
      prompt: this.prompt,
      multi: this.multi,
    };
  }
}

export interface IPieceLibrary {
  version: number;
  name: string;
  pieces: IPiece[];
}

export class PieceLibrary implements IPieceLibrary {
  @observable accessor version: number = 1;
  @observable accessor name: string = '';
  @observable accessor pieces: Piece[] = [];

  static fromJSON(json: IPieceLibrary): PieceLibrary {
    const library = new PieceLibrary();
    library.version = json.version;
    library.name = json.name;
    library.pieces = json.pieces.map((piece) => Piece.fromJSON(piece));
    return library;
  }

  toJSON(): IPieceLibrary {
    return {
      name: this.name,
      version: this.version,
      pieces: this.pieces.map((piece) => piece.toJSON()),
    };
  }
}

export interface IPromptPiece {
  prompt: string;
  characterPrompts: string[];
  id: string;
  enabled?: boolean;
}

export class PromptPiece implements IPromptPiece {
  @observable accessor prompt: string = '';
  @observable accessor characterPrompts: string[] = [];
  @observable accessor id: string = '';
  @observable accessor enabled: boolean | undefined = undefined;

  static fromJSON(json: IPromptPiece): PromptPiece {
    const promptPiece = new PromptPiece();
    Object.assign(promptPiece, json);
    // Ensure characterPrompts is always an array
    if (!Array.isArray(promptPiece.characterPrompts)) {
      promptPiece.characterPrompts = [];
    }
    return promptPiece;
  }

  toJSON(): IPromptPiece {
    return {
      prompt: this.prompt,
      characterPrompts: [...(this.characterPrompts || [])],
      id: this.id,
      enabled: this.enabled,
    };
  }
}

export type IPromptPieceSlot = IPromptPiece[];
export type PromptPieceSlot = PromptPiece[];

export interface Player {
  rank: number;
  path: string;
}

export type Game = Player[];

export interface Round {
  players: string[];
  winMask: boolean[];
  curPlayer: number;
}

export interface IAbstractScene {
  name: string;
  resolution: string;
  resolutionWidth?: number;
  resolutionHeight?: number;
  game?: Game;
  round?: Round;
  imageMap: string[];
  mains: string[];
}

export class AbstractScene implements IAbstractScene {
  @observable accessor name: string = '';
  @observable accessor resolution: string = '';
  @observable accessor resolutionWidth: number | undefined = undefined;
  @observable accessor resolutionHeight: number | undefined = undefined;
  @observable.shallow accessor game: Game | undefined = undefined;
  @observable.ref accessor round: Round | undefined = undefined;
  @observable.shallow accessor imageMap: string[] = [];
  @observable accessor mains: string[] = [];

  static fromJSON(json: IAbstractScene): AbstractScene {
    const scene = new AbstractScene();
    scene.name = json.name;
    scene.resolution = json.resolution;
    scene.game = json.game;
    scene.round = json.round;
    scene.imageMap = json.imageMap;
    scene.mains = json.mains;
    scene.resolutionWidth = json.resolutionWidth;
    scene.resolutionHeight = json.resolutionHeight;
    return scene;
  }

  toJSON(): IAbstractScene {
    return {
      name: this.name,
      resolution: this.resolution,
      game: this.game,
      round: this.round,
      imageMap: this.imageMap,
      mains: this.mains,
      resolutionHeight: this.resolutionHeight,
      resolutionWidth: this.resolutionWidth,
    };
  }
}

export interface IScene extends IAbstractScene {
  type: 'scene';
  slots: IPromptPieceSlot[];
  meta: Record<string, any>;
  sceneCharacterPrompts?: CharacterPrompt[]; // 씬 전용 캐릭터 프롬프트
  useSceneCharacterPrompts?: boolean; // 씬 전용 캐릭터 프롬프트 사용 여부
  sceneCharacterUC?: string; // 씬 전용 캐릭터 네거티브 프롬프트
}

export class Scene extends AbstractScene implements IScene {
  @observable accessor type: 'scene' = 'scene';
  @observable accessor slots: PromptPieceSlot[] = [];
  @observable accessor meta: Map<string, any> = new Map();
  @observable accessor sceneCharacterPrompts: CharacterPrompt[] = []; // 씬 전용 캐릭터 프롬프트
  @observable accessor useSceneCharacterPrompts: boolean = false; // 씬 전용 캐릭터 프롬프트 사용 여부
  @observable accessor sceneCharacterUC: string = ''; // 씬 전용 캐릭터 네거티브 프롬프트

  static fromJSON(json: IScene): Scene {
    const scene = new Scene();
    Object.assign(scene, json);
    scene.type = 'scene';
    scene.slots = json.slots.map((slot) =>
      slot.map((piece) => PromptPiece.fromJSON(piece)),
    );
    scene.meta = new Map(Object.entries(json.meta ?? {}));
    scene.sceneCharacterPrompts = (json.sceneCharacterPrompts || []).map((cp) => ({
      ...cp,
      enabled: cp.enabled !== false,
    }));
    scene.useSceneCharacterPrompts = json.useSceneCharacterPrompts || false;
    scene.sceneCharacterUC = json.sceneCharacterUC || '';
    return scene;
  }

  toJSON(): IScene {
    return {
      ...super.toJSON(),
      type: this.type,
      slots: this.slots.map((slot) => slot.map((piece) => piece.toJSON())),
      meta: Object.fromEntries(this.meta.entries()),
      sceneCharacterPrompts: this.sceneCharacterPrompts,
      useSceneCharacterPrompts: this.useSceneCharacterPrompts,
      sceneCharacterUC: this.sceneCharacterUC,
    };
  }
}

export interface IInpaintScene extends IAbstractScene {
  type: 'inpaint';
  workflowType: string;
  preset?: any;
  sceneRef?: string;
  slots?: IPromptPieceSlot[];
  mirrorCropX?: number;
}

export class InpaintScene extends AbstractScene implements IInpaintScene {
  @observable accessor type: 'inpaint' = 'inpaint';
  @observable accessor workflowType: string = '';
  @observable accessor preset: any | undefined = undefined;
  @observable accessor sceneRef: string | undefined = undefined;
  @observable accessor slots: PromptPieceSlot[] = [];
  @observable accessor mirrorCropX: number | undefined = undefined;

  static fromJSON(json: IInpaintScene): InpaintScene | null {
    const scene = new InpaintScene();
    Object.assign(scene, json);
    scene.type = 'inpaint';
    try {
      scene.preset = json.preset && workFlowService.presetFromJSON(json.preset);
      if (json.preset && !scene.preset) return null;
    } catch (e) {
      console.warn(`Failed to deserialize inpaint scene: ${json.name}`, e);
      return null;
    }
    scene.slots = (json.slots || []).map((slot) =>
      slot.map((piece) => PromptPiece.fromJSON(piece)),
    );
    return scene;
  }

  toJSON(): IInpaintScene {
    return {
      ...super.toJSON(),
      type: this.type,
      workflowType: this.workflowType,
      preset: this.preset?.toJSON(),
      sceneRef: this.sceneRef,
      ...(this.slots.length > 0 && {
        slots: this.slots.map((slot) => slot.map((piece) => piece.toJSON())),
      }),
      ...(this.mirrorCropX != null && { mirrorCropX: this.mirrorCropX }),
    };
  }
}

export function genericSceneFromJSON(json: IGenericScene): GenericScene | null {
  if (json.type === 'scene') {
    return Scene.fromJSON(json);
  }
  return InpaintScene.fromJSON(json);
}

export type IGenericScene = IScene | IInpaintScene;
export type GenericScene = Scene | InpaintScene;

export interface SelectedWorkflow {
  workflowType: string;
  presetName?: string;
}

export interface ISession {
  version: number;
  name: string;
  selectedWorkflow?: SelectedWorkflow;
  presets: Record<string, any[]>;
  inpaints: Record<string, IInpaintScene>;
  scenes: Record<string, IScene>;
  library: Record<string, IPieceLibrary>;
  presetShareds: Record<string, any>;
  characterPresets?: Record<string, ICharacterPreset>; // 캐릭터 프리셋
  mirrorImage?: string; // 세션 레벨 미러 원본 이미지 (vibe storage 경로)
  mirrorMode?: 'blank' | 'duplicate'; // 미러 캔버스 모드 (blank=우측 빈 캔버스, duplicate=우측 이미지 복제)
}

export class Session implements Serealizable {
  @observable accessor version: number = 1;
  @observable accessor name: string = '';
  @observable accessor selectedWorkflow: SelectedWorkflow | undefined =
    undefined;
  @observable accessor presets: Map<string, any[]> = new Map();
  @observable accessor inpaints: Map<string, InpaintScene> = new Map();
  @observable accessor scenes: Map<string, Scene> = new Map();
  @observable accessor library: Map<string, PieceLibrary> = new Map();
  @observable accessor presetShareds: Map<string, any> = new Map();
  @observable accessor characterPresets: Map<string, CharacterPreset> = new Map(); // 캐릭터 프리셋
  @observable accessor mirrorImage: string | undefined = undefined;
  @observable accessor mirrorMode: 'blank' | 'duplicate' = 'blank';

  constructor() {
    makeObservable(this);
  }

  hasScene(type: 'scene' | 'inpaint', name: string): boolean {
    if (type === 'scene') {
      return this.scenes.has(name);
    }
    return this.inpaints.has(name);
  }

  @action
  addScene(scene: GenericScene): void {
    if (scene.type === 'scene') {
      this.scenes.set(scene.name, scene);
    } else {
      this.inpaints.set(scene.name, scene);
    }
  }

  getScene(type: 'scene' | 'inpaint', name: string): GenericScene | undefined {
    if (type === 'scene') {
      return this.scenes.get(name);
    }
    return this.inpaints.get(name);
  }

  @action
  removeScene(type: 'scene' | 'inpaint', name: string): void {
    if (type === 'scene') {
      this.scenes.delete(name);
    } else {
      this.inpaints.delete(name);
    }
  }

  moveScene(targetScene: GenericScene, index: number) {
    const scenes = this.getScenes(targetScene.type);
    const reorderedScenes = scenes.filter((scene) => scene !== targetScene);
    reorderedScenes.splice(index, 0, targetScene);
    const final = reorderedScenes.reduce((acc, scene) => {
      acc.set(scene.name, scene);
      return acc;
    }, new Map()) as any;
    if (targetScene.type === 'scene') {
      this.scenes = final;
    } else {
      this.inpaints = final;
    }
  }

  hasPreset(type: string, name: string): boolean {
    return (
      this.presets.get(type)?.some((preset) => preset.name === name) ?? false
    );
  }

  getPreset(type: string, name: string): any | undefined {
    return this.presets.get(type)?.find((preset) => preset.name === name);
  }

  @action
  addPreset(preset: any): void {
    const presets = this.presets.get(preset.type) || [];
    if (presets.find((p) => p.name === preset.name)) {
      let i = 1;
      while (presets.find((p) => p.name === preset.name + i.toString())) {
        i++;
      }
      preset.name = preset.name + i.toString();
    }
    presets.push(preset);
    this.presets.set(preset.type, presets);
  }

  @action
  removePreset(type: string, name: string): void {
    const presets = this.presets.get(type) || [];
    this.presets.set(
      type,
      presets.filter((preset) => preset.name !== name),
    );
  }

  getScenes(type: 'scene' | 'inpaint'): GenericScene[] {
    if (type === 'scene') {
      return Array.from(this.scenes.values());
    }
    return Array.from(this.inpaints.values());
  }

  getCommonSetup(flow: SelectedWorkflow): [string, any, any, WorkFlowDef] {
    const type = flow.workflowType;
    const preset = flow.presetName && this.getPreset(type, flow.presetName);
    const shared = this.presetShareds.get(type);
    const def = workFlowService.getDef(type);
    return [type, preset, shared, def];
  }

  // 캐릭터 프리셋 관리 메서드
  hasCharacterPreset(name: string): boolean {
    return this.characterPresets.has(name);
  }

  getCharacterPreset(name: string): CharacterPreset | undefined {
    return this.characterPresets.get(name);
  }

  getCharacterPresets(): CharacterPreset[] {
    return Array.from(this.characterPresets.values());
  }

  @action
  addCharacterPreset(preset: CharacterPreset): void {
    // 이름 중복 처리
    if (this.characterPresets.has(preset.name)) {
      let i = 1;
      while (this.characterPresets.has(preset.name + i.toString())) {
        i++;
      }
      preset.name = preset.name + i.toString();
    }
    this.characterPresets.set(preset.name, preset);
  }

  @action
  updateCharacterPreset(oldName: string, preset: CharacterPreset): void {
    if (oldName !== preset.name) {
      this.characterPresets.delete(oldName);
    }
    this.characterPresets.set(preset.name, preset);
  }

  @action
  removeCharacterPreset(name: string): void {
    this.characterPresets.delete(name);
  }

  static fromJSON(json: ISession): Session {
    const session = new Session();
    session.name = json.name;
    session.version = json.version;
    session.selectedWorkflow = json.selectedWorkflow;
    session.presets = new Map(
      Object.entries(json.presets).map(([key, value]) => [
        key,
        value.map((preset) => workFlowService.presetFromJSON(preset)).filter(Boolean),
      ]),
    );
    session.inpaints = new Map(
      Object.entries(json.inpaints)
        .map(([key, value]) => [key, InpaintScene.fromJSON(value)] as const)
        .filter(([_, scene]) => scene !== null) as [string, InpaintScene][],
    );
    session.scenes = new Map(
      Object.entries(json.scenes).map(([key, value]) => [
        key,
        Scene.fromJSON(value),
      ]),
    );
    session.library = new Map(
      Object.entries(json.library).map(([key, value]) => [
        key,
        PieceLibrary.fromJSON(value),
      ]),
    );
    session.presetShareds = new Map(
      Object.entries(json.presetShareds).map(([key, value]) => [
        key,
        workFlowService.sharedFromJSON(value),
      ]),
    );
    // 캐릭터 프리셋 로드
    session.characterPresets = new Map(
      Object.entries(json.characterPresets || {}).map(([key, value]) => [
        key,
        CharacterPreset.fromJSON(value),
      ]),
    );
    session.mirrorImage = json.mirrorImage;
    session.mirrorMode = json.mirrorMode || 'blank';
    return session;
  }

  fromJSON(json: ISession): Session {
    return Session.fromJSON(json);
  }

  toJSON(): ISession {
    return {
      name: this.name,
      version: this.version,
      selectedWorkflow: this.selectedWorkflow,
      presets: Object.fromEntries(
        Array.from(this.presets.entries()).map(([key, value]) => [
          key,
          value.map((preset) => preset.toJSON()),
        ]),
      ),
      inpaints: Object.fromEntries(
        Array.from(this.inpaints.entries()).map(([key, value]) => [
          key,
          value.toJSON(),
        ]),
      ),
      scenes: Object.fromEntries(
        Array.from(this.scenes.entries()).map(([key, value]) => [
          key,
          value.toJSON(),
        ]),
      ),
      library: Object.fromEntries(
        Array.from(this.library.entries()).map(([key, value]) => [
          key,
          value.toJSON(),
        ]),
      ),
      presetShareds: Object.fromEntries(
        Array.from(this.presetShareds.entries()).map(([key, value]) => [
          key,
          value.toJSON(),
        ]),
      ),
      // 캐릭터 프리셋 저장
      characterPresets: Object.fromEntries(
        Array.from(this.characterPresets.entries()).map(([key, value]) => [
          key,
          value.toJSON(),
        ]),
      ),
      mirrorImage: this.mirrorImage,
      mirrorMode: this.mirrorMode,
    };
  }
}

export interface PromptGroupNode {
  type: 'group';
  children: PromptNode[];
}

export interface PromptTextNode {
  type: 'text';
  text: string;
}

export interface PromptRandomNode {
  type: 'random';
  options: PromptNode[];
}

export type PromptNode = PromptGroupNode | PromptTextNode | PromptRandomNode;

export enum ContextMenuType {
  GallaryImage = 'gallary_image',
  Image = 'image',
  Scene = 'scene',
  Style = 'style',
}

export interface ImageContextAlt {
  type: 'image';
  path: string;
  scene?: GenericScene;
  starable?: boolean;
}

export interface GallaryImageContextAlt {
  type: 'gallary_image';
  path: string[];
  scene?: GenericScene;
  starable?: boolean;
}

export interface SceneContextAlt {
  type: 'scene';
  scene: GenericScene;
}

export interface StyleContextAlt {
  type: 'style';
  preset: any;
  container: any;
  session: Session;
}

export type ContextAlt = ImageContextAlt | SceneContextAlt | StyleContextAlt;

export const encodeContextAlt = (x: ContextAlt) => JSON.stringify(x)!;
export const decodeContextAlt = JSON.parse as (x: string) => ContextAlt;

export const isValidSession = (session: any) => {
  return (
    typeof session.name === 'string' &&
    typeof session.presets === 'object' &&
    typeof session.inpaints === 'object' &&
    typeof session.scenes === 'object' &&
    typeof session.library === 'object'
  );
};

export const isValidPieceLibrary = (library: any) => {
  return (
    (typeof library.name === 'string' ||
      typeof library.description === 'string') &&
    library.pieces
  );
};

export interface CharacterPrompt<T = string> {
  id: string;
  prompt: T;
  uc: string;
  position: CharacterPosition;
  enabled?: boolean;
}

export interface CharacterPosition {
  x: number;
  y: number;
}

export interface IReferenceItem {
  path: string;
  info: number;
  strength: number;
  fidelity: number;
  referenceType: 'character' | 'style' | 'character&style';
  enabled?: boolean;
}

export class ReferenceItem implements IReferenceItem {
  @observable accessor path: string = '';
  @observable accessor info: number = 1.0;
  @observable accessor strength: number = 0.6;
  @observable accessor fidelity: number = 1.0;
  @observable accessor referenceType: 'character' | 'style' | 'character&style' = 'character';
  @observable accessor enabled: boolean = true;

  static fromJSON(json: IReferenceItem): ReferenceItem {
    const item = new ReferenceItem();
    if (json) {
      item.path = json.path || '';
      item.info = json.info ?? 1.0;
      item.strength = json.strength ?? 0.6;
      item.fidelity = json.fidelity ?? 1.0;
      item.referenceType = json.referenceType || 'character';
      item.enabled = json.enabled ?? true;
    }
    return item;
  }

  toJSON(): IReferenceItem {
    return {
      path: this.path,
      info: this.info,
      strength: this.strength,
      fidelity: this.fidelity,
      referenceType: this.referenceType,
      enabled: this.enabled,
    };
  }
}

// 캐릭터 프리셋 인터페이스 - 캐릭터 프롬프트 + 배경 프롬프트 + 바이브 트랜스퍼/캐릭터 레퍼런스를 하나로 묶음
export interface ICharacterPreset {
  name: string;
  characterPrompt: string;  // 캐릭터 프롬프트
  characterUC: string;      // 캐릭터 네거티브 프롬프트
  backgroundPrompt: string; // 배경 프롬프트
  vibes: IVibeItem[];       // 바이브 트랜스퍼
  characterReferences: IReferenceItem[]; // 캐릭터 레퍼런스
  // 파일명 옵션 (옵셔널 - 하위 호환성 유지)
  filenamePrefix?: string;  // 다운로드 시 파일명 접두사
  filenameSuffix?: string;  // 다운로드 시 파일명 접미사
}

export class CharacterPreset implements ICharacterPreset {
  @observable accessor name: string = '';
  @observable accessor characterPrompt: string = '';
  @observable accessor characterUC: string = '';
  @observable accessor backgroundPrompt: string = '';
  @observable accessor vibes: VibeItem[] = [];
  @observable accessor characterReferences: ReferenceItem[] = [];
  // 파일명 옵션 (옵셔널 - 하위 호환성 유지)
  @observable accessor filenamePrefix: string = '';
  @observable accessor filenameSuffix: string = '';

  static fromJSON(json: ICharacterPreset): CharacterPreset {
    const preset = new CharacterPreset();
    preset.name = json.name;
    preset.characterPrompt = json.characterPrompt;
    preset.characterUC = json.characterUC || '';
    preset.backgroundPrompt = json.backgroundPrompt;
    preset.vibes = (json.vibes || []).map((v) => VibeItem.fromJSON(v));
    preset.characterReferences = (json.characterReferences || []).map((r) => ReferenceItem.fromJSON(r) as ReferenceItem);
    // 파일명 옵션 로드 (하위 호환성: 없으면 빈 문자열)
    preset.filenamePrefix = json.filenamePrefix || '';
    preset.filenameSuffix = json.filenameSuffix || '';
    return preset;
  }

  toJSON(): ICharacterPreset {
    return {
      name: this.name,
      characterPrompt: this.characterPrompt,
      characterUC: this.characterUC,
      backgroundPrompt: this.backgroundPrompt,
      vibes: this.vibes.map((v) => v.toJSON()),
      characterReferences: this.characterReferences.map((r) => r.toJSON()),
      // 파일명 옵션 저장 (빈 문자열이면 undefined로 저장하여 JSON 크기 최소화)
      filenamePrefix: this.filenamePrefix || undefined,
      filenameSuffix: this.filenameSuffix || undefined,
    };
  }
}