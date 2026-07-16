import { observable, action, runInAction } from 'mobx';
import { persistService } from './PersistenceService';
import { v4 as uuidv4 } from 'uuid';
import {
  backend,
  imageService,
  workFlowService,
  sessionService,
  templateService,
  globalPresetService,
  globalCharacterPresetService,
} from '.';
import { getAppState } from './appStateRef';
import {
  Session,
  CharacterPreset,
  ICharacterPreset,
  IScene,
  IVibeItem,
  IReferenceItem,
  VibeItem,
  ReferenceItem,
} from './types';
import { dataUriToBase64 } from './ImageService';
import { imageExtFromBase64 } from './imageFormats';

const PROJECT_TEMPLATES_FILE = 'project_templates.json';
const PROJECT_TEMPLATE_IMAGES_DIR = 'project_template_images';

// 신규 프로젝트 생성 다이얼로그의 '빈 프로젝트' 값 — uuid 와 충돌 불가한 문자.
const BLANK_VALUE = '/blank';

// 수동 바이브/레퍼런스를 주입할 기본 워크플로 타입 (스타일 프리셋이 없을 때).
// blankTemplatePreset 및 빈 프로젝트 기본 프리셋과 같은 타입이어야 시작 프리셋과
// presetShareds 가 짝을 이룬다.
const DEFAULT_WORKFLOW_TYPE = 'SDImageGenEasy';

// 템플릿을 세션에 인스턴스화한 결과 — 교체 의미론(적용 기록)에 쓰인다.
export interface IInstantiateResult {
  // 시작 프리셋 지정용 스타일 프리셋 인스턴스(없으면 undefined)
  presetInstance?: any;
  // 이 적용이 세션에 만든 인스턴스들(제거 대상 추적용 — 넘버링 후 실제 이름)
  presets: { type: string; name: string }[];
  characterPresetNames: string[];
  vibePaths: string[];
  referencePaths: string[];
}

// 프로젝트 템플릿 (프로젝트 상속 v2, 2026-07-16 합의 · 워크플로우형 재설계).
//
// 템플릿 = "모든 걸 미리 세팅/수정 가능한 하나의 완전한 프리셋 워크플로우"
// (독립 전역 데이터). 세 영역으로 구성:
//  - 프롬프트(스타일 프리셋 1벌): 상위/하위/네거티브 직접 편집,
//    글로벌 프리셋 불러오기 = 이 1벌 덮어쓰기(샘플링·대표이미지 포함)
//  - 캐릭터 프리셋 목록: 수동 생성/편집, 불러오기 = 목록에 추가(선적용)
//  - 씬 구성: 씬 템플릿/프로젝트에서 불러오기 = 전체 교체(일괄 적용)
// 새 프로젝트 생성 시(선택 또는 폴더 자동 적용) 구성 전체가 프로젝트로
// 복사된다 — "불러오기"일 뿐이므로 생성 후 프로젝트에서 자유 조정(스냅샷).
//
// 이미지는 세션 디렉터리에 종속되지 않도록 전용 디렉터리(data URI 파일)에
// 보관하고, 적용 시 세션 vibes/references 로 복사한다
// (GlobalCharacterPresetService 와 동일 패턴).
export interface IProjectTemplateEntry {
  id: string; // uuid — 불변 (folderTemplates 등 외부 참조 키)
  name: string;
  createdAt: number;
  updatedAt: number;
  // 스타일 프리셋 1벌: 세션 프리셋 JSON(name/type/profile 포함), 없으면 null.
  // profile 은 PROJECT_TEMPLATE_IMAGES_DIR 내 파일명.
  preset: any | null;
  // 캐릭터 프리셋 스냅샷 목록 — 이미지 경로는 템플릿 이미지 디렉터리 파일명.
  characterPresets: ICharacterPreset[];
  // 프로젝트 공통 바이브/캐릭터 레퍼런스(수동 지정 영역, 상속 마감).
  // 캐릭터 프리셋을 거치지 않고 직접 지정 — 적용 시 세션 presetShareds 에 주입.
  // path 는 템플릿 이미지 디렉터리 파일명(캐릭터 프리셋 이미지와 동일 규칙).
  vibes: IVibeItem[];
  characterReferences: IReferenceItem[];
  // 씬 구성 스냅샷 (이미지·토너먼트 흔적 없음)
  scenes: IScene[];
  // true = 폴더 전용 로컬 템플릿 (폴더 기본 템플릿의 실체 — 전역 목록·
  // 생성 다이얼로그에서 숨김, 폴더 모달에서만 편집. 사이드카가 id 로 참조)
  folderLocal?: boolean;
}

// 프롬프트 영역을 빈 상태에서 직접 타이핑할 때 쓰는 최소 프리셋 골격.
// presetFromJSON 이 buildPreset(기본값) 위에 overlay 하므로 이 정도면 충분.
export function blankTemplatePreset(name: string): any {
  return {
    type: 'SDImageGenEasy',
    name,
    frontPrompt: '',
    backPrompt: '',
    uc: '',
  };
}

export interface IProjectTemplateStore {
  version: 1;
  templates: IProjectTemplateEntry[];
}

export class ProjectTemplateService extends EventTarget {
  @observable accessor templates: IProjectTemplateEntry[] = [];
  @observable accessor loaded: boolean = false;
  private saveTimeout: any = null;

  // ---------- lifecycle ----------
  async load() {
    try {
      const str = await backend.readFile(PROJECT_TEMPLATES_FILE);
      const json = JSON.parse(str) as IProjectTemplateStore;
      this.templates =
        json && Array.isArray(json.templates)
          ? json.templates
              .filter(
                (t) =>
                  t && typeof t.id === 'string' && typeof t.name === 'string',
              )
              .map((t: any) => ({
                ...t,
                // 구형(프리셋 목록형) 데이터 호환: 첫 항목을 1벌로 승격
                preset:
                  t.preset ??
                  (Array.isArray(t.presets) ? (t.presets[0] ?? null) : null),
                presets: undefined,
                characterPresets: Array.isArray(t.characterPresets)
                  ? t.characterPresets
                  : [],
                // 구 데이터는 두 영역이 없음 → 빈 배열(호환 안전)
                vibes: Array.isArray(t.vibes) ? t.vibes : [],
                characterReferences: Array.isArray(t.characterReferences)
                  ? t.characterReferences
                  : [],
                scenes: Array.isArray(t.scenes) ? t.scenes : [],
              }))
          : [];
    } catch (e) {
      this.templates = [];
    }
    this.loaded = true;
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  async ensureLoaded() {
    if (!this.loaded) await this.load();
  }

  async save() {
    const store: IProjectTemplateStore = {
      version: 1,
      templates: this.templates,
    };
    const data = JSON.stringify(store);
    const tmp = PROJECT_TEMPLATES_FILE + '.tmp';
    try {
      await persistService.write(tmp, data);
      await backend.renameFile(tmp, PROJECT_TEMPLATES_FILE);
    } catch (e) {
      try {
        await persistService.write(PROJECT_TEMPLATES_FILE, data);
      } catch (e2) {
        console.error('Failed to save project templates:', e2);
      }
    }
  }

  scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.save();
      this.saveTimeout = null;
    }, 2000);
  }

  async flushSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.save();
  }

  // ---------- read ----------
  list(): IProjectTemplateEntry[] {
    return this.templates.slice();
  }
  // 전역 템플릿만 (폴더 전용 로컬 템플릿 제외) — 관리 목록·선택 다이얼로그용
  listGlobal(): IProjectTemplateEntry[] {
    return this.templates.filter((t) => !t.folderLocal);
  }
  // 아무것도 세팅되지 않은 템플릿 — 폴더 모달을 빈 채로 닫으면 지정 자동 해제
  isEmptyTemplate(entry: IProjectTemplateEntry): boolean {
    return (
      !entry.preset &&
      entry.characterPresets.length === 0 &&
      (entry.vibes?.length ?? 0) === 0 &&
      (entry.characterReferences?.length ?? 0) === 0 &&
      entry.scenes.length === 0
    );
  }
  get(id: string): IProjectTemplateEntry | undefined {
    return this.templates.find((t) => t.id === id);
  }
  getByName(name: string): IProjectTemplateEntry | undefined {
    return this.templates.find((t) => t.name === name);
  }

  private resolveNameCollision(name: string): string {
    if (!this.getByName(name)) return name;
    let i = 2;
    while (this.getByName(`${name} (${i})`)) i++;
    return `${name} (${i})`;
  }

  private touch(entry: IProjectTemplateEntry) {
    entry.updatedAt = Date.now();
    this.templates = [...this.templates];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // ---------- 엔티티 CRUD ----------
  @action
  async create(
    name: string,
    opts?: { folderLocal?: boolean },
  ): Promise<IProjectTemplateEntry> {
    const entry: IProjectTemplateEntry = {
      id: uuidv4(),
      name: this.resolveNameCollision((name || '새 템플릿').trim() || '새 템플릿'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preset: null,
      characterPresets: [],
      vibes: [],
      characterReferences: [],
      scenes: [],
      ...(opts?.folderLocal ? { folderLocal: true } : {}),
    };
    this.templates = [...this.templates, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  async rename(id: string, newName: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    newName = newName.trim();
    if (!newName) throw new Error('이름을 입력해 주세요');
    if (entry.name === newName) return;
    const existing = this.getByName(newName);
    if (existing && existing.id !== id) {
      throw new Error('이미 존재하는 이름입니다');
    }
    entry.name = newName;
    this.touch(entry);
  }

  @action
  async duplicate(id: string): Promise<IProjectTemplateEntry> {
    const src = this.get(id);
    if (!src) throw new Error('템플릿을 찾을 수 없습니다');
    const clone: IProjectTemplateEntry = JSON.parse(JSON.stringify(src));
    clone.id = uuidv4();
    clone.name = this.resolveNameCollision(src.name);
    clone.createdAt = Date.now();
    clone.updatedAt = Date.now();
    // 이미지 파일도 복제 — 엔트리 간 파일 공유가 생기면 한쪽 삭제가
    // 다른 쪽 참조를 깨뜨리므로 항상 사본을 만든다.
    if (clone.preset?.profile) {
      clone.preset.profile = await this.copyImageToken(clone.preset.profile);
    }
    for (const cp of clone.characterPresets) {
      for (const v of cp.vibes || []) {
        if (v.path) v.path = await this.copyImageToken(v.path);
      }
      for (const r of cp.characterReferences || []) {
        if (r.path) r.path = await this.copyImageToken(r.path);
      }
      if (cp.representativeImage) {
        cp.representativeImage = await this.copyImageToken(
          cp.representativeImage,
        );
      }
    }
    for (const v of clone.vibes || []) {
      if (v.path) v.path = await this.copyImageToken(v.path);
    }
    for (const r of clone.characterReferences || []) {
      if (r.path) r.path = await this.copyImageToken(r.path);
    }
    this.templates = [...this.templates, clone];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return clone;
  }

  // 다른 템플릿의 구성 전체(프리셋·캐릭터·씬)로 1회성 덮어쓰기 —
  // 폴더 기본 템플릿의 "전역 템플릿 불러오기". 대상의 id·이름·folderLocal 은
  // 유지하고, 이미지는 항상 사본을 만들며(duplicate 와 같은 규칙) 대상의
  // 기존 이미지는 정리한다. 이후 소스와 무관하게 자유 조정 가능.
  @action
  async overwriteFromTemplate(targetId: string, sourceId: string): Promise<void> {
    const target = this.get(targetId);
    if (!target) throw new Error('템플릿을 찾을 수 없습니다');
    const src = this.get(sourceId);
    if (!src) throw new Error('불러올 템플릿을 찾을 수 없습니다');
    for (const token of this.collectImageTokens(target)) {
      await this.deleteImageData(token);
    }
    const copy: Pick<
      IProjectTemplateEntry,
      'preset' | 'characterPresets' | 'vibes' | 'characterReferences' | 'scenes'
    > = JSON.parse(
      JSON.stringify({
        preset: src.preset,
        characterPresets: src.characterPresets,
        vibes: src.vibes ?? [],
        characterReferences: src.characterReferences ?? [],
        scenes: src.scenes,
      }),
    );
    if (copy.preset?.profile) {
      copy.preset.profile = await this.copyImageToken(copy.preset.profile);
    }
    for (const cp of copy.characterPresets) {
      for (const v of cp.vibes || []) {
        if (v.path) v.path = await this.copyImageToken(v.path);
      }
      for (const r of cp.characterReferences || []) {
        if (r.path) r.path = await this.copyImageToken(r.path);
      }
      if (cp.representativeImage) {
        cp.representativeImage = await this.copyImageToken(
          cp.representativeImage,
        );
      }
    }
    for (const v of copy.vibes) {
      if (v.path) v.path = await this.copyImageToken(v.path);
    }
    for (const r of copy.characterReferences) {
      if (r.path) r.path = await this.copyImageToken(r.path);
    }
    target.preset = copy.preset;
    target.characterPresets = copy.characterPresets;
    target.vibes = copy.vibes;
    target.characterReferences = copy.characterReferences;
    target.scenes = copy.scenes;
    this.touch(target);
  }

  @action
  async delete(id: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) return;
    for (const token of this.collectImageTokens(entry)) {
      await this.deleteImageData(token);
    }
    this.templates = this.templates.filter((t) => t.id !== id);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    // 이 템플릿을 가리키는 폴더 자동 적용 지정 정리
    try {
      await templateService.clearFolderTemplatesByTemplateId(id);
    } catch (e) {}
    // 이 템플릿의 적용 기록(♟ 상속 링크 등) 정리
    try {
      await templateService.clearApplicationsByTemplateId(id);
    } catch (e) {}
  }

  private collectImageTokens(entry: IProjectTemplateEntry): string[] {
    const tokens: string[] = [];
    if (entry.preset?.profile) tokens.push(entry.preset.profile);
    for (const cp of entry.characterPresets) {
      for (const v of cp.vibes || []) if (v.path) tokens.push(v.path);
      for (const r of cp.characterReferences || [])
        if (r.path) tokens.push(r.path);
      if (cp.representativeImage) tokens.push(cp.representativeImage);
    }
    // 수동 바이브/레퍼런스 영역
    for (const v of entry.vibes || []) if (v.path) tokens.push(v.path);
    for (const r of entry.characterReferences || [])
      if (r.path) tokens.push(r.path);
    return tokens;
  }

  // ---------- 이미지 (data URI 파일 — 글로벌 캐릭터 프리셋과 동일 패턴) ----------
  getImagePath(filename: string): string {
    return PROJECT_TEMPLATE_IMAGES_DIR + '/' + filename.split('/').pop()!;
  }

  async fetchImageData(filename: string): Promise<string | null> {
    if (!filename) return null;
    try {
      const path = this.getImagePath(filename);
      const exists = await backend.existFile(path);
      if (!exists) return null;
      return await backend.readDataFile(path);
    } catch (e) {
      return null;
    }
  }

  private async storeImageData(dataUri: string): Promise<string> {
    const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
    return this.storeImageForEditor(base64);
  }

  // 편집기(FileUploadBase64 — raw base64)용 저장
  async storeImageForEditor(base64: string): Promise<string> {
    const filename = uuidv4() + '.' + imageExtFromBase64(base64);
    await backend.writeDataFile(
      PROJECT_TEMPLATE_IMAGES_DIR + '/' + filename,
      base64,
    );
    return filename;
  }

  private async deleteImageData(filename: string) {
    if (!filename) return;
    try {
      await backend.deleteFile(this.getImagePath(filename));
    } catch (e) {}
  }

  private async copyImageToken(token: string): Promise<string> {
    const dataUri = await this.fetchImageData(token);
    if (!dataUri) return token;
    return await this.storeImageData(dataUri);
  }

  private charPresetNameCollision(
    entry: IProjectTemplateEntry,
    name: string,
  ) {
    const used = new Set(entry.characterPresets.map((p) => p.name));
    if (!used.has(name)) return name;
    let i = 2;
    while (used.has(`${name} (${i})`)) i++;
    return `${name} (${i})`;
  }

  // ---------- 불러오기 (편의 기능 — 스냅샷 복사) ----------

  // 프리셋 불러오기 = "1회성 덮어쓰기" — 프롬프트(상위/하위/네거티브)와
  // 샘플링 등 설정 값만 덮어쓰고, 어떤 프리셋을 불러왔는지는 남기지 않는다.
  // 이름·대표이미지는 템플릿 소유 값을 유지한다 (트래킹 없음).
  @action
  private overwritePresetSettings(entry: IProjectTemplateEntry, srcJson: any) {
    const json: any = { ...srcJson };
    delete json.name;
    delete json.profile;
    const base = entry.preset ?? blankTemplatePreset(entry.name);
    entry.preset = { ...json, name: base.name, profile: base.profile };
    this.touch(entry);
  }

  // 글로벌 프리셋 → 템플릿 프롬프트 영역 1회성 덮어쓰기 (프롬프트·샘플링만)
  async importGlobalPreset(templateId: string, globalId: string) {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    const g = globalPresetService.get(globalId);
    if (!g) throw new Error('글로벌 프리셋을 찾을 수 없습니다');
    const json: any = JSON.parse(JSON.stringify(g.preset));
    json.type = g.workflowType;
    this.overwritePresetSettings(entry, json);
  }

  // 현재 프로젝트의 프리셋 → 템플릿 프롬프트 영역 1회성 덮어쓰기
  async importSessionPreset(templateId: string, preset: any) {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    this.overwritePresetSettings(entry, preset.toJSON());
  }

  // 프롬프트 영역 인라인 편집(상위/하위/네거티브 등) 반영.
  // 프리셋이 아직 없으면 빈 골격을 만들어 타이핑을 받는다 —
  // "불러오기 없이 수동 세팅"도 가능해야 한다는 스펙.
  @action
  async patchPreset(templateId: string, patch: Record<string, any>) {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    entry.preset = { ...(entry.preset ?? blankTemplatePreset(entry.name)), ...patch };
    this.touch(entry);
  }

  // 글로벌 캐릭터 프리셋 → 템플릿
  @action
  async importGlobalCharacterPreset(templateId: string, globalId: string) {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    const g = globalCharacterPresetService.get(globalId);
    if (!g) throw new Error('글로벌 캐릭터 프리셋을 찾을 수 없습니다');
    const json: ICharacterPreset = JSON.parse(JSON.stringify(g.preset));
    for (const v of json.vibes || []) {
      const d = await globalCharacterPresetService.fetchImageData(v.path);
      if (d) v.path = await this.storeImageData(d);
    }
    for (const r of json.characterReferences || []) {
      const d = await globalCharacterPresetService.fetchImageData(r.path);
      if (d) r.path = await this.storeImageData(d);
    }
    if (json.representativeImage) {
      const d = await globalCharacterPresetService.fetchImageData(
        json.representativeImage,
      );
      if (d) json.representativeImage = await this.storeImageData(d);
    }
    json.name = this.charPresetNameCollision(entry, g.name);
    entry.characterPresets = [...entry.characterPresets, json];
    this.touch(entry);
  }

  // 현재 프로젝트의 캐릭터 프리셋 → 템플릿
  @action
  async importSessionCharacterPreset(
    templateId: string,
    session: Session,
    preset: CharacterPreset,
  ) {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    const json: ICharacterPreset = preset.toJSON();
    for (const v of json.vibes || []) {
      try {
        const d = await backend.readDataFile(
          imageService.getVibeImagePath(session, v.path),
        );
        if (d) v.path = await this.storeImageData(d);
      } catch (e) {}
    }
    for (const r of json.characterReferences || []) {
      try {
        const d = await backend.readDataFile(
          imageService.getReferenceImagePath(session, r.path),
        );
        if (d) r.path = await this.storeImageData(d);
      } catch (e) {}
    }
    if (json.representativeImage) {
      try {
        const d = await backend.readDataFile(
          imageService.getVibeImagePath(session, json.representativeImage),
        );
        if (d) json.representativeImage = await this.storeImageData(d);
      } catch (e) {}
    }
    json.name = this.charPresetNameCollision(entry, json.name);
    entry.characterPresets = [...entry.characterPresets, json];
    this.touch(entry);
  }

  // 새 캐릭터 프리셋 직접 추가 / 기존 항목 편집 저장 (편집기 산출 JSON)
  @action
  async putCharacterPreset(
    templateId: string,
    json: ICharacterPreset,
    index?: number,
  ) {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    if (index === undefined) {
      json.name = this.charPresetNameCollision(entry, json.name || '이름없음');
      entry.characterPresets = [...entry.characterPresets, json];
    } else {
      const next = entry.characterPresets.slice();
      next[index] = json;
      entry.characterPresets = next;
    }
    this.touch(entry);
  }

  // 스타일 프리셋 세부 설정 저장 (PresetEditModal 어댑터용 — 이름/샘플링/대표이미지)
  @action
  async updatePreset(
    templateId: string,
    name: string,
    patch: Record<string, any>,
    newRepImageBase64: string | null,
  ) {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    const next: any = {
      ...(entry.preset ?? blankTemplatePreset(entry.name)),
      ...patch,
      name,
    };
    if (newRepImageBase64) {
      const old = next.profile;
      next.profile = await this.storeImageForEditor(newRepImageBase64);
      if (old) await this.deleteImageData(old);
    }
    entry.preset = next;
    this.touch(entry);
  }

  // 프로젝트의 씬 구성 → 템플릿 씬 영역 **전체 교체** (일괄 적용 — 스펙 확정).
  // 이미지·토너먼트 흔적은 가져오지 않는다 (씬 템플릿 임포트와 동일 규칙).
  async importScenesFromProject(
    templateId: string,
    projectName: string,
  ): Promise<number> {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    const session = await sessionService.get(projectName);
    if (!session) throw new Error('프로젝트를 불러올 수 없습니다');
    const scenes = session.getScenes('scene');
    if (scenes.length === 0) return 0;
    const next: IScene[] = [];
    for (const src of scenes) {
      const json: any = JSON.parse(JSON.stringify(src.toJSON()));
      json.imageMap = [];
      json.mains = [];
      json.game = undefined;
      json.round = undefined;
      next.push(json);
    }
    entry.scenes = next;
    this.touch(entry);
    return next.length;
  }

  // ---------- 항목 제거 ----------
  @action
  async removePreset(templateId: string) {
    const entry = this.get(templateId);
    if (!entry || !entry.preset) return;
    if (entry.preset.profile) await this.deleteImageData(entry.preset.profile);
    entry.preset = null;
    this.touch(entry);
  }

  @action
  async removeCharacterPreset(templateId: string, index: number) {
    const entry = this.get(templateId);
    if (!entry) return;
    const removed = entry.characterPresets[index];
    if (removed) {
      for (const v of removed.vibes || []) await this.deleteImageData(v.path);
      for (const r of removed.characterReferences || [])
        await this.deleteImageData(r.path);
      if (removed.representativeImage)
        await this.deleteImageData(removed.representativeImage);
    }
    entry.characterPresets = entry.characterPresets.filter(
      (_, i) => i !== index,
    );
    this.touch(entry);
  }

  @action
  async removeScene(templateId: string, index: number) {
    const entry = this.get(templateId);
    if (!entry) return;
    entry.scenes = entry.scenes.filter((_, i) => i !== index);
    this.touch(entry);
  }

  // ---------- 수동 바이브/캐릭터 레퍼런스 영역 (상속 마감) ----------
  // 업로드는 raw base64(FileUploadBase64) → 템플릿 이미지 디렉터리에 저장하고
  // 기본값 VibeItem/ReferenceItem JSON 을 만들어 목록에 추가한다.
  @action
  async addVibe(templateId: string, base64: string): Promise<void> {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    const path = await this.storeImageForEditor(base64);
    const item: IVibeItem = { path, info: 1.0, strength: 0.6 };
    entry.vibes = [...(entry.vibes || []), item];
    this.touch(entry);
  }

  // 수동 바이브/레퍼런스 항목 값 조정 (IS/RS·fidelity·referenceType 등 슬라이더)
  @action
  async updateVibe(
    templateId: string,
    index: number,
    patch: Partial<IVibeItem>,
  ): Promise<void> {
    const entry = this.get(templateId);
    if (!entry || !(entry.vibes || [])[index]) return;
    entry.vibes = entry.vibes.map((v, i) =>
      i === index ? { ...v, ...patch } : v,
    );
    this.touch(entry);
  }

  @action
  async updateCharacterReference(
    templateId: string,
    index: number,
    patch: Partial<IReferenceItem>,
  ): Promise<void> {
    const entry = this.get(templateId);
    if (!entry || !(entry.characterReferences || [])[index]) return;
    entry.characterReferences = entry.characterReferences.map((r, i) =>
      i === index ? { ...r, ...patch } : r,
    );
    this.touch(entry);
  }

  @action
  async removeVibe(templateId: string, index: number): Promise<void> {
    const entry = this.get(templateId);
    if (!entry) return;
    const removed = (entry.vibes || [])[index];
    if (removed?.path) await this.deleteImageData(removed.path);
    entry.vibes = (entry.vibes || []).filter((_, i) => i !== index);
    this.touch(entry);
  }

  @action
  async addCharacterReference(
    templateId: string,
    base64: string,
  ): Promise<void> {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    const path = await this.storeImageForEditor(base64);
    const item: IReferenceItem = {
      path,
      info: 1.0,
      strength: 0.6,
      fidelity: 1.0,
      referenceType: 'character',
      enabled: true,
    };
    entry.characterReferences = [...(entry.characterReferences || []), item];
    this.touch(entry);
  }

  @action
  async removeCharacterReference(
    templateId: string,
    index: number,
  ): Promise<void> {
    const entry = this.get(templateId);
    if (!entry) return;
    const removed = (entry.characterReferences || [])[index];
    if (removed?.path) await this.deleteImageData(removed.path);
    entry.characterReferences = (entry.characterReferences || []).filter(
      (_, i) => i !== index,
    );
    this.touch(entry);
  }

  // ---------- 템플릿 → 세션 적용 (스냅샷 인스턴스화) ----------
  //
  // 스타일 프리셋(1벌)·캐릭터 프리셋·수동 바이브/레퍼런스를 세션에 추가한다
  // (씬은 호출측 소관 — 생성 경로는 초기 json 에 포함, 재적용은 씬 불가침).
  // 이미지 파일은 템플릿 디렉터리 → 세션 vibes/references 로 복사.
  // 비어 있는 영역은 자연히 스킵된다(빈 결과 배열).
  // 반환: 만들어진 인스턴스 정보(교체 의미론의 제거 대상 추적·시작 프리셋 지정용).
  async instantiateIntoSession(
    session: Session,
    templateId: string,
  ): Promise<IInstantiateResult> {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    const result: IInstantiateResult = {
      presets: [],
      characterPresetNames: [],
      vibePaths: [],
      referencePaths: [],
    };
    if (entry.preset) {
      try {
        const clone: any = JSON.parse(JSON.stringify(entry.preset));
        if (clone.profile) {
          const dataUri = await this.fetchImageData(clone.profile);
          clone.profile = dataUri
            ? await imageService.storeVibeImage(
                session,
                dataUriToBase64(dataUri),
              )
            : undefined;
        }
        const preset = workFlowService.presetFromJSON(clone);
        if (preset) {
          session.addPreset(preset); // 이름 충돌 시 넘버링(preset.name 변경)
          result.presetInstance = preset;
          result.presets.push({ type: preset.type, name: preset.name });
        }
      } catch (e) {
        console.warn('템플릿 프리셋 적용 실패:', entry.preset?.name, e);
      }
    }
    for (const cpJson of entry.characterPresets) {
      try {
        const json: ICharacterPreset = JSON.parse(JSON.stringify(cpJson));
        for (const v of json.vibes || []) {
          const d = await this.fetchImageData(v.path);
          if (d)
            v.path = await imageService.storeVibeImage(
              session,
              dataUriToBase64(d),
            );
        }
        for (const r of json.characterReferences || []) {
          const d = await this.fetchImageData(r.path);
          if (d)
            r.path = await imageService.storeReferenceImage(
              session,
              dataUriToBase64(d),
            );
        }
        if (json.representativeImage) {
          const d = await this.fetchImageData(json.representativeImage);
          if (d)
            json.representativeImage = await imageService.storeVibeImage(
              session,
              dataUriToBase64(d),
            );
        }
        const preset = CharacterPreset.fromJSON(json);
        let nm = preset.name;
        while (session.hasCharacterPreset(nm)) nm = nm + ' (템플릿)';
        preset.name = nm;
        session.addCharacterPreset(preset);
        result.characterPresetNames.push(preset.name);
      } catch (e) {
        console.warn('템플릿 캐릭터 프리셋 적용 실패:', cpJson?.name, e);
      }
    }
    // 수동 바이브/레퍼런스 → presetShareds[type] 주입 (캐릭터 프리셋을 거치지
    // 않는 프로젝트 공통 영역). type 은 스타일 프리셋 타입, 없으면 기본 타입.
    const sharedType = entry.preset?.type ?? DEFAULT_WORKFLOW_TYPE;
    if (
      (entry.vibes?.length ?? 0) > 0 ||
      (entry.characterReferences?.length ?? 0) > 0
    ) {
      let shared = session.presetShareds.get(sharedType);
      if (!shared) {
        shared = workFlowService.buildShared(sharedType);
        session.presetShareds.set(sharedType, shared);
      }
      const newVibes: VibeItem[] = [];
      for (const vJson of entry.vibes || []) {
        try {
          const d = await this.fetchImageData(vJson.path);
          const path = d
            ? await imageService.storeVibeImage(session, dataUriToBase64(d))
            : vJson.path;
          const item = VibeItem.fromJSON({ ...vJson, path });
          newVibes.push(item);
          result.vibePaths.push(path);
        } catch (e) {
          console.warn('템플릿 바이브 적용 실패:', e);
        }
      }
      const newRefs: ReferenceItem[] = [];
      for (const rJson of entry.characterReferences || []) {
        try {
          const d = await this.fetchImageData(rJson.path);
          const path = d
            ? await imageService.storeReferenceImage(
                session,
                dataUriToBase64(d),
              )
            : rJson.path;
          const item = ReferenceItem.fromJSON({ ...rJson, path });
          newRefs.push(item);
          result.referencePaths.push(path);
        } catch (e) {
          console.warn('템플릿 캐릭터 레퍼런스 적용 실패:', e);
        }
      }
      runInAction(() => {
        if (newVibes.length > 0)
          shared.vibes = [...(shared.vibes || []), ...newVibes];
        if (newRefs.length > 0)
          shared.characterReferences = [
            ...(shared.characterReferences || []),
            ...newRefs,
          ];
      });
    }
    return result;
  }

  // 교체 의미론용 — 기록된 인스턴스만 세션에서 제거한다. 사용자가 직접 만든
  // 것은 절대 건드리지 않는다(이름/path 정확 일치 항목만). 이미지 파일 자체는
  // 지우지 않는다(안전 우선). 반환: selectedWorkflow 가 제거된 프리셋을 가리켰는지.
  removeRecordedInstances(
    session: Session,
    record: {
      presets?: { type: string; name: string }[];
      characterPresetNames?: string[];
      vibePaths?: string[];
      referencePaths?: string[];
    },
    opts: { removePresets: boolean; removeChars: boolean; removeVibes: boolean; removeRefs: boolean },
  ): { selectedRemoved: boolean } {
    let selectedRemoved = false;
    if (opts.removePresets) {
      for (const p of record.presets || []) {
        if (
          session.selectedWorkflow?.workflowType === p.type &&
          session.selectedWorkflow?.presetName === p.name
        ) {
          selectedRemoved = true;
        }
        session.removePreset(p.type, p.name);
      }
    }
    if (opts.removeChars) {
      for (const nm of record.characterPresetNames || []) {
        session.removeCharacterPreset(nm);
      }
    }
    const vibeSet = new Set(record.vibePaths || []);
    const refSet = new Set(record.referencePaths || []);
    if (
      (opts.removeVibes && vibeSet.size > 0) ||
      (opts.removeRefs && refSet.size > 0)
    ) {
      runInAction(() => {
        for (const shared of session.presetShareds.values()) {
          if (!shared) continue;
          if (opts.removeVibes && Array.isArray(shared.vibes)) {
            shared.vibes = shared.vibes.filter(
              (v: any) => !vibeSet.has(v?.path),
            );
          }
          if (opts.removeRefs && Array.isArray(shared.characterReferences)) {
            shared.characterReferences = shared.characterReferences.filter(
              (r: any) => !refSet.has(r?.path),
            );
          }
        }
      });
    }
    return { selectedRemoved };
  }

  // 신규 프로젝트 생성 시 템플릿 선택 다이얼로그 (전역 템플릿만 —
  // 폴더 전용 템플릿은 폴더 자동 적용 경로가 담당).
  // 반환: undefined = 취소 / null = 빈 프로젝트 / string = 템플릿 id.
  // 템플릿이 하나도 없으면 다이얼로그 없이 즉시 null (기존 UX 그대로).
  async pickForCreate(): Promise<string | null | undefined> {
    await this.ensureLoaded();
    const globals = this.listGlobal();
    if (globals.length === 0) return null;
    const sel = await getAppState().pushDialogAsync({
      type: 'select',
      text: '어떤 구성으로 시작할까요?',
      items: [
        { text: '빈 프로젝트', value: BLANK_VALUE },
        ...globals.map((t) => ({
          text: `템플릿: ${t.name}`,
          value: t.id,
        })),
      ],
    });
    if (!sel) return undefined;
    return sel === BLANK_VALUE ? null : sel;
  }
}
