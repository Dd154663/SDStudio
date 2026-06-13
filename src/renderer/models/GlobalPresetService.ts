import { observable, action } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { backend, imageService, workFlowService } from '.';
import { Session } from './types';
import { dataUriToBase64 } from './ImageService';
import {
  readJSONFromPNG,
  embedJSONInPNG,
  normalizePresetJson,
  createImageWithText,
} from './SessionService';

const GLOBAL_PRESETS_FILE = 'global_presets.json';
const GLOBAL_VIBES_DIR = 'global_vibes';
// v2: 이지/일반 글로벌 프리셋 통합 — 라이브러리를 하나로 보고 이름을 고유화한다.
//     (workflowType은 "출처" 정보로 남고, 적용 시 현재 모드로 자동 변환)
const GLOBAL_PRESETS_VERSION = 2;

export type GlobalPresetType = 'SDImageGenEasy' | 'SDImageGen';
export const SUPPORTED_GLOBAL_PRESET_TYPES: GlobalPresetType[] = [
  'SDImageGenEasy',
  'SDImageGen',
];

export interface IGlobalPresetEntry {
  id: string;
  name: string;
  workflowType: GlobalPresetType;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  profile?: string; // filename inside global_vibes/
  preset: any; // preset.toJSON() minus profile
}

export interface IGlobalPresetStore {
  version: number;
  presets: IGlobalPresetEntry[];
}

export class GlobalPresetService extends EventTarget {
  @observable accessor presets: IGlobalPresetEntry[] = [];
  @observable accessor loaded: boolean = false;
  private saveTimeout: any = null;

  // ---------- lifecycle ----------

  async load(): Promise<void> {
    let loadedVersion = 1;
    try {
      const str = await backend.readFile(GLOBAL_PRESETS_FILE);
      try {
        const json = JSON.parse(str) as IGlobalPresetStore;
        if (json && Array.isArray(json.presets)) {
          this.presets = json.presets.filter(
            (p) =>
              p &&
              typeof p.id === 'string' &&
              typeof p.name === 'string' &&
              SUPPORTED_GLOBAL_PRESET_TYPES.includes(p.workflowType),
          );
          loadedVersion = (json as any).version || 1;
        } else {
          this.presets = [];
        }
      } catch (parseErr) {
        // Corruption: rename and start fresh
        const corruptName = `${GLOBAL_PRESETS_FILE}.corrupt-${Date.now()}`;
        try {
          await backend.renameFile(GLOBAL_PRESETS_FILE, corruptName);
        } catch (e) {
          // ignore rename errors
        }
        this.presets = [];
        this.dispatchEvent(
          new CustomEvent('corrupted', { detail: { backupName: corruptName } }),
        );
      }
    } catch (e) {
      // File missing or read failed — start empty
      this.presets = [];
    }
    this.loaded = true;
    // v2 통합 마이그레이션: 이지/일반을 한 라이브러리로 보고 이름을 고유화한다.
    // (멱등 — 한 번 v2로 저장되면 다시 실행되지 않음)
    if (loadedVersion < GLOBAL_PRESETS_VERSION) {
      try {
        await this.migrateUnify();
      } catch (e) {
        console.error('글로벌 프리셋 통합 마이그레이션 실패:', e);
      }
    }
    this.dispatchEvent(new CustomEvent('loaded', {}));
  }

  // v2 통합 마이그레이션: 타입(이지/일반) 구분 없이 이름이 겹치면 뒤(나중에 만든)의
  // 것에 " (2)", " (3)"... 을 붙여 라이브러리 전체에서 이름을 고유하게 만든다.
  // 비파괴: 먼저 원본을 .bak 으로 백업한다.
  private async migrateUnify(): Promise<void> {
    // 원본 백업 (있을 때만)
    try {
      const cur = await backend.readFile(GLOBAL_PRESETS_FILE);
      await backend.writeFile(
        GLOBAL_PRESETS_FILE + '.bak-unify-' + Date.now(),
        cur,
      );
    } catch (e) {
      // 파일이 없었으면(신규 설치) 백업 불필요
    }
    if (this.presets.length > 0) {
      // createdAt 오름차순 — 먼저 만든 프리셋이 원래 이름을 유지
      const used = new Set<string>();
      const ordered = [...this.presets].sort(
        (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
      );
      for (const entry of ordered) {
        if (!used.has(entry.name)) {
          used.add(entry.name);
          continue;
        }
        let k = 2;
        while (used.has(`${entry.name} (${k})`)) k++;
        entry.name = `${entry.name} (${k})`;
        used.add(entry.name);
      }
      this.presets = [...this.presets];
    }
    // 버전을 v2 로 올려 저장 (빈 목록이어도 재실행 방지)
    await this.save();
  }

  // 모드 간 프리셋 변환. 두 타입의 프리셋 구조 차이는 characterPrompts 위치뿐:
  //  - SDImageGen: characterPrompts 를 프리셋 레벨에 가짐
  //  - SDImageGenEasy: 프리셋엔 없음(캐릭터는 씬/공유 레벨에서 다룸)
  // 이지→일반은 무손실(빈 배열 보강), 일반→이지는 프리셋 레벨 characterPrompts 를 버린다.
  private convertPresetJSON(
    presetJSON: any,
    from: GlobalPresetType,
    to: GlobalPresetType,
  ): any {
    if (from === to) return presetJSON;
    const out = { ...presetJSON };
    if (to === 'SDImageGenEasy') {
      delete out.characterPrompts;
    } else {
      if (!Array.isArray(out.characterPrompts)) out.characterPrompts = [];
    }
    return out;
  }

  async save(): Promise<void> {
    const store: IGlobalPresetStore = {
      version: GLOBAL_PRESETS_VERSION,
      presets: this.presets,
    };
    const data = JSON.stringify(store);
    const tmp = GLOBAL_PRESETS_FILE + '.tmp';
    try {
      await backend.writeFile(tmp, data);
      await backend.renameFile(tmp, GLOBAL_PRESETS_FILE);
    } catch (e) {
      // Fallback: direct write if atomic rename fails
      try {
        await backend.writeFile(GLOBAL_PRESETS_FILE, data);
      } catch (e2) {
        console.error('Failed to save global presets:', e2);
      }
    }
  }

  scheduleSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.save();
      this.saveTimeout = null;
    }, 2000);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.save();
  }

  // ---------- read ----------

  list(type?: GlobalPresetType): IGlobalPresetEntry[] {
    if (type) return this.presets.filter((p) => p.workflowType === type);
    return this.presets.slice();
  }

  get(id: string): IGlobalPresetEntry | undefined {
    return this.presets.find((p) => p.id === id);
  }

  getByName(
    type: GlobalPresetType,
    name: string,
  ): IGlobalPresetEntry | undefined {
    return this.presets.find(
      (p) => p.workflowType === type && p.name === name,
    );
  }

  getDefaults(type: GlobalPresetType): IGlobalPresetEntry[] {
    return this.presets.filter(
      (p) => p.workflowType === type && p.isDefault,
    );
  }

  // ---------- profile image helpers ----------

  getProfilePath(profile: string): string {
    return GLOBAL_VIBES_DIR + '/' + profile.split('/').pop()!;
  }

  async fetchProfileImage(profile: string): Promise<string | null> {
    if (!profile) return null;
    const path = this.getProfilePath(profile);
    try {
      const exists = await backend.existFile(path);
      if (!exists) return null;
      return await backend.readDataFile(path);
    } catch (e) {
      return null;
    }
  }

  private async storeProfileImage(base64: string): Promise<string> {
    const filename = uuidv4() + '.png';
    const path = GLOBAL_VIBES_DIR + '/' + filename;
    await backend.writeDataFile(path, base64);
    return filename;
  }

  private async deleteProfileImage(profile: string): Promise<void> {
    if (!profile) return;
    try {
      await backend.deleteFile(this.getProfilePath(profile));
    } catch (e) {
      // ignore — file may already be missing
    }
  }

  // ---------- write ----------

  private resolveNameCollision(
    type: GlobalPresetType,
    name: string,
  ): string {
    if (!this.getByName(type, name)) return name;
    let i = 1;
    while (this.getByName(type, `${name} (${i})`)) i++;
    return `${name} (${i})`;
  }

  @action
  async addFromSessionPreset(
    session: Session,
    preset: any,
  ): Promise<IGlobalPresetEntry> {
    if (!preset || !preset.type) {
      throw new Error('유효하지 않은 프리셋입니다');
    }
    if (!SUPPORTED_GLOBAL_PRESET_TYPES.includes(preset.type)) {
      throw new Error(
        `이 워크플로우 타입(${preset.type})은 글로벌 프리셋으로 저장할 수 없습니다`,
      );
    }

    // Detached clone via toJSON
    const json: any =
      typeof preset.toJSON === 'function'
        ? preset.toJSON()
        : JSON.parse(JSON.stringify(preset));

    // Copy profile image if present
    let newProfile: string | undefined;
    const srcProfile = json.profile || preset.profile;
    if (srcProfile) {
      try {
        const dataUri = await imageService.fetchVibeImage(session, srcProfile);
        if (dataUri) {
          const base64 = dataUriToBase64(dataUri);
          newProfile = await this.storeProfileImage(base64);
        }
      } catch (e) {
        console.warn('Failed to copy profile image to global:', e);
      }
    }

    // Strip profile from stored preset JSON so it lives only in entry.profile
    if ('profile' in json) delete json.profile;

    const resolvedName = this.resolveNameCollision(
      preset.type,
      preset.name || '이름없음',
    );

    const entry: IGlobalPresetEntry = {
      id: uuidv4(),
      name: resolvedName,
      workflowType: preset.type,
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profile: newProfile,
      preset: json,
    };

    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  /**
   * 메모리상의 preset 객체와 원본 이미지 base64를 받아 글로벌 엔트리 생성.
   * 세션에 의존하지 않으므로 ExternalImageView 등 "세션 외부"에서 구성된
   * 프리셋을 바로 글로벌에 저장할 때 사용.
   */
  @action
  async addFromPresetAndImage(
    preset: any,
    imageBase64: string | null,
    suggestedName: string,
  ): Promise<IGlobalPresetEntry> {
    if (!preset || !preset.type) {
      throw new Error('유효하지 않은 프리셋입니다');
    }
    if (!SUPPORTED_GLOBAL_PRESET_TYPES.includes(preset.type)) {
      throw new Error(
        `이 워크플로우 타입(${preset.type})은 글로벌 프리셋으로 저장할 수 없습니다`,
      );
    }

    // Detached clone via toJSON
    const json: any =
      typeof preset.toJSON === 'function'
        ? preset.toJSON()
        : JSON.parse(JSON.stringify(preset));

    // Store image as profile if provided
    let newProfile: string | undefined;
    if (imageBase64) {
      try {
        newProfile = await this.storeProfileImage(imageBase64);
      } catch (e) {
        console.warn('Failed to store profile image for global preset:', e);
      }
    }

    // Strip profile from stored preset JSON
    if ('profile' in json) delete json.profile;

    const resolvedName = this.resolveNameCollision(
      preset.type,
      (suggestedName || preset.name || '이름없음').trim() || '이름없음',
    );

    const entry: IGlobalPresetEntry = {
      id: uuidv4(),
      name: resolvedName,
      workflowType: preset.type,
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profile: newProfile,
      preset: json,
    };

    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  async importFromPng(
    base64: string,
  ): Promise<IGlobalPresetEntry | undefined> {
    let json = readJSONFromPNG(base64);
    if (!json || !json.type || !json.name) return undefined;

    json = normalizePresetJson(json);

    if (!SUPPORTED_GLOBAL_PRESET_TYPES.includes(json.type)) {
      throw new Error(
        `이 워크플로우 타입(${json.type})은 글로벌 프리셋으로 저장할 수 없습니다`,
      );
    }

    // Store the full PNG as the profile image (matches importPreset behavior)
    const newProfile = await this.storeProfileImage(base64);

    // Remove any profile path from embedded JSON; we own the image now
    if ('profile' in json) delete json.profile;

    const resolvedName = this.resolveNameCollision(
      json.type,
      json.name || '이름없음',
    );

    const entry: IGlobalPresetEntry = {
      id: uuidv4(),
      name: resolvedName,
      workflowType: json.type,
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profile: newProfile,
      preset: json,
    };

    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  async rename(id: string, newName: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    newName = newName.trim();
    if (!newName) throw new Error('이름을 입력해 주세요');
    if (entry.name === newName) return;
    const existing = this.getByName(entry.workflowType, newName);
    if (existing && existing.id !== id) {
      throw new Error('이미 존재하는 이름입니다');
    }
    entry.name = newName;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // 프리셋 내용(프롬프트·샘플링 설정 등) 부분 갱신. profile/이름은 별도 메서드 사용.
  @action
  async updatePreset(id: string, patch: Record<string, any>): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    entry.preset = { ...(entry.preset || {}), ...patch };
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  async setDefault(id: string, value: boolean): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    if (entry.isDefault === value) return;
    entry.isDefault = value;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  async delete(id: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) return;
    if (entry.profile) {
      await this.deleteProfileImage(entry.profile);
    }
    this.presets = this.presets.filter((p) => p.id !== id);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  async replaceProfileImage(id: string, base64: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    const oldProfile = entry.profile;
    const newProfile = await this.storeProfileImage(base64);
    entry.profile = newProfile;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    if (oldProfile && oldProfile !== newProfile) {
      await this.deleteProfileImage(oldProfile);
    }
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // ---------- session ↔ global ----------

  async instantiateIntoSession(
    session: Session,
    id: string,
    targetType?: GlobalPresetType,
  ): Promise<any> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');

    // 적용 타깃 모드(미지정 시 원본 타입). 다르면 프리셋 구조를 변환한다.
    const target =
      targetType && SUPPORTED_GLOBAL_PRESET_TYPES.includes(targetType)
        ? targetType
        : entry.workflowType;

    // Deep clone preset JSON + 모드 변환
    let clone = JSON.parse(JSON.stringify(entry.preset));
    clone = this.convertPresetJSON(clone, entry.workflowType, target);
    clone.type = target;
    clone.name = entry.name;

    // Copy profile image from global_vibes -> session vibes
    if (entry.profile) {
      try {
        const dataUri = await this.fetchProfileImage(entry.profile);
        if (dataUri) {
          const base64 = dataUriToBase64(dataUri);
          const sessionProfile = await imageService.storeVibeImage(
            session,
            base64,
          );
          clone.profile = sessionProfile;
        }
      } catch (e) {
        console.warn('Failed to copy global profile to session:', e);
      }
    }

    const preset = workFlowService.presetFromJSON(clone);
    if (!preset) throw new Error('프리셋 복원 실패');
    session.addPreset(preset);
    return preset;
  }

  async exportToPng(id: string, outPath: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');

    // Build the PNG to embed JSON in
    let pngBase64: string | null = null;
    if (entry.profile) {
      const dataUri = await this.fetchProfileImage(entry.profile);
      if (dataUri) {
        const raw = dataUriToBase64(dataUri);
        if (raw.startsWith('iVBOR')) {
          pngBase64 = raw;
        }
      }
    }

    if (!pngBase64) {
      // Fallback: create placeholder image
      pngBase64 = createImageWithText(832, 1216, entry.name);
    }

    // Construct JSON with type/name/profile so it can be re-imported
    const jsonForPng = {
      ...entry.preset,
      type: entry.workflowType,
      name: entry.name,
    };

    const newPng = embedJSONInPNG(pngBase64, jsonForPng);
    await backend.writeDataFile(outPath, newPng);
  }
}
