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
  version: 1;
  presets: IGlobalPresetEntry[];
}

export class GlobalPresetService extends EventTarget {
  @observable accessor presets: IGlobalPresetEntry[] = [];
  @observable accessor loaded: boolean = false;
  private saveTimeout: any = null;

  // ---------- lifecycle ----------

  async load(): Promise<void> {
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
    this.dispatchEvent(new CustomEvent('loaded', {}));
  }

  async save(): Promise<void> {
    const store: IGlobalPresetStore = {
      version: 1,
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
  ): Promise<any> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');

    // Deep clone preset JSON
    const clone = JSON.parse(JSON.stringify(entry.preset));
    clone.type = entry.workflowType;
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
