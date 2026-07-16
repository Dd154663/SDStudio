import { observable, action } from 'mobx';
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
} from './types';
import { dataUriToBase64 } from './ImageService';
import { imageExtFromBase64 } from './imageFormats';

const PROJECT_TEMPLATES_FILE = 'project_templates.json';
const PROJECT_TEMPLATE_IMAGES_DIR = 'project_template_images';

// 신규 프로젝트 생성 다이얼로그의 '빈 프로젝트' 값 — uuid 와 충돌 불가한 문자.
const BLANK_VALUE = '/blank';

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
  // 씬 구성 스냅샷 (이미지·토너먼트 흔적 없음)
  scenes: IScene[];
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
  async create(name: string): Promise<IProjectTemplateEntry> {
    const entry: IProjectTemplateEntry = {
      id: uuidv4(),
      name: this.resolveNameCollision((name || '새 템플릿').trim() || '새 템플릿'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preset: null,
      characterPresets: [],
      scenes: [],
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
    this.templates = [...this.templates, clone];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return clone;
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

  // 기존 프리셋 1벌의 대표 이미지를 정리하고 새 것으로 교체한다 (덮어쓰기 의미론).
  @action
  private async replacePreset(entry: IProjectTemplateEntry, json: any) {
    const oldProfile = entry.preset?.profile;
    entry.preset = json;
    if (oldProfile && oldProfile !== json?.profile) {
      await this.deleteImageData(oldProfile);
    }
    this.touch(entry);
  }

  // 글로벌 프리셋 → 템플릿 프롬프트 영역 덮어쓰기 (샘플링·대표이미지 포함)
  async importGlobalPreset(templateId: string, globalId: string) {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    const g = globalPresetService.get(globalId);
    if (!g) throw new Error('글로벌 프리셋을 찾을 수 없습니다');
    const json: any = JSON.parse(JSON.stringify(g.preset));
    json.type = g.workflowType;
    json.name = g.name;
    if (g.profile) {
      const dataUri = await globalPresetService.fetchProfileImage(g.profile);
      json.profile = dataUri ? await this.storeImageData(dataUri) : undefined;
    }
    await this.replacePreset(entry, json);
  }

  // 현재 프로젝트의 프리셋 → 템플릿 프롬프트 영역 덮어쓰기
  async importSessionPreset(templateId: string, session: Session, preset: any) {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    const json: any = preset.toJSON();
    if (json.profile) {
      try {
        const dataUri = await backend.readDataFile(
          imageService.getVibeImagePath(session, json.profile),
        );
        json.profile = dataUri
          ? await this.storeImageData(dataUri)
          : undefined;
      } catch (e) {
        json.profile = undefined;
      }
    }
    await this.replacePreset(entry, json);
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

  // ---------- 템플릿 → 세션 적용 (스냅샷 인스턴스화) ----------
  //
  // 스타일 프리셋(1벌)·캐릭터 프리셋을 세션에 추가한다 (씬은 호출측 소관 —
  // 생성 경로는 초기 json 에 포함, 재적용은 씬 불가침).
  // 이미지 파일은 템플릿 디렉터리 → 세션 vibes/references 로 복사.
  // 반환: 추가된 스타일 프리셋 인스턴스(시작 프리셋 지정용, 없으면 undefined).
  async instantiateIntoSession(
    session: Session,
    templateId: string,
  ): Promise<any | undefined> {
    const entry = this.get(templateId);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다');
    let addedPreset: any | undefined;
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
          session.addPreset(preset);
          addedPreset = preset;
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
      } catch (e) {
        console.warn('템플릿 캐릭터 프리셋 적용 실패:', cpJson?.name, e);
      }
    }
    return addedPreset;
  }

  // 신규 프로젝트 생성 시 템플릿 선택 다이얼로그.
  // 반환: undefined = 취소 / null = 빈 프로젝트 / string = 템플릿 id.
  // 템플릿이 하나도 없으면 다이얼로그 없이 즉시 null (기존 UX 그대로).
  async pickForCreate(): Promise<string | null | undefined> {
    await this.ensureLoaded();
    if (this.templates.length === 0) return null;
    const sel = await getAppState().pushDialogAsync({
      type: 'select',
      text: '어떤 구성으로 시작할까요?',
      items: [
        { text: '빈 프로젝트', value: BLANK_VALUE },
        ...this.templates.map((t) => ({
          text: `템플릿: ${t.name}`,
          value: t.id,
        })),
      ],
    });
    if (!sel) return undefined;
    return sel === BLANK_VALUE ? null : sel;
  }
}
