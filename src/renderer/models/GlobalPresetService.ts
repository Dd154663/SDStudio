import { observable, action } from 'mobx';
import { persistService } from './PersistenceService';
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
import { extractPromptDataFromBase64 } from './util';

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
      await persistService.write(
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
      await persistService.write(tmp, data);
      await backend.renameFile(tmp, GLOBAL_PRESETS_FILE);
    } catch (e) {
      // Fallback: direct write if atomic rename fails
      try {
        await persistService.write(GLOBAL_PRESETS_FILE, data);
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
    // 캐릭터 프롬프트는 글로벌 프리셋 저장 대상이 아니다(관리 UI 없음) — 제외
    if ('characterPrompts' in json) delete json.characterPrompts;

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
    // 캐릭터 프롬프트는 글로벌 프리셋 저장 대상이 아니다(관리 UI 없음) — 제외
    if ('characterPrompts' in json) delete json.characterPrompts;

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
    // 캐릭터 프롬프트는 글로벌 프리셋 저장 대상이 아니다(관리 UI 없음) — 제외
    if ('characterPrompts' in json) delete json.characterPrompts;

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

  /**
   * PNG을 글로벌 프리셋으로 가져온다.
   *  1) 정식 글로벌 프리셋 내보내기 이미지면 그대로 저장 (importFromPng)
   *  2) 아니면 NAI 생성 메타데이터(프롬프트)가 있는 경우, 프롬프트를 추출해
   *     그림체(SDImageGen) 프리셋으로 구성 후 저장 — "이미지 프롬프트 추출" 재활용
   * 둘 다 해당되지 않으면 undefined.
   */
  @action
  async importFromImage(
    base64: string,
  ): Promise<IGlobalPresetEntry | undefined> {
    // 1) 정식 글로벌 프리셋 내보내기 이미지
    try {
      const entry = await this.importFromPng(base64);
      if (entry) return entry;
    } catch (e) {
      // importFromPng은 글로벌 외 프리셋 타입 메타에 대해 throw할 수 있음
      // → 아래 메타데이터 추출 폴백으로 계속 진행
    }

    // 2) NAI 생성 메타데이터에서 프롬프트 추출
    const job = await extractPromptDataFromBase64(base64);
    if (!job || !job.prompt) return undefined;

    const preset: any = workFlowService.buildPreset('SDImageGen');
    preset.name = 'external image';
    preset.frontPrompt = job.prompt ?? '';
    preset.backPrompt = '';
    preset.uc = job.uc ?? '';
    if ((job.characterPrompts?.length ?? 0) > 0) {
      preset.characterPrompts = job.characterPrompts;
    }
    preset.sampling = job.sampling ?? preset.sampling;
    preset.steps = job.steps ?? preset.steps;
    preset.noiseSchedule = job.noiseSchedule ?? preset.noiseSchedule;
    preset.promptGuidance = job.promptGuidance ?? preset.promptGuidance;
    preset.cfgRescale = job.cfgRescale ?? preset.cfgRescale;
    preset.useCoords = job.useCoords ?? preset.useCoords;
    preset.varietyPlus = job.varietyPlus ?? preset.varietyPlus;
    preset.deliberateEulerAncestralBug =
      job.deliberateEulerAncestralBug ?? preset.deliberateEulerAncestralBug;
    preset.legacyPromptConditioning =
      job.legacyPromptConditioning ?? preset.legacyPromptConditioning;

    return await this.addFromPresetAndImage(preset, base64, preset.name);
  }

  // 이미지 1장을 받아 메타데이터에서 프롬프트/세팅을 추출하고, 지정 이름으로 글로벌 프리셋 저장.
  // (메타데이터가 없어도 이미지를 대표로 한 빈 프리셋으로 저장)
  @action
  async addImageAsPreset(
    base64: string,
    name: string,
  ): Promise<IGlobalPresetEntry> {
    const job = await extractPromptDataFromBase64(base64);
    const preset: any = workFlowService.buildPreset('SDImageGen');
    preset.name = name;
    preset.frontPrompt = job?.prompt ?? '';
    preset.backPrompt = '';
    preset.uc = job?.uc ?? '';
    if ((job?.characterPrompts?.length ?? 0) > 0) {
      preset.characterPrompts = job!.characterPrompts;
    }
    if (job) {
      preset.sampling = job.sampling ?? preset.sampling;
      preset.steps = job.steps ?? preset.steps;
      preset.noiseSchedule = job.noiseSchedule ?? preset.noiseSchedule;
      preset.promptGuidance = job.promptGuidance ?? preset.promptGuidance;
      preset.cfgRescale = job.cfgRescale ?? preset.cfgRescale;
      preset.useCoords = job.useCoords ?? preset.useCoords;
      preset.varietyPlus = job.varietyPlus ?? preset.varietyPlus;
      preset.deliberateEulerAncestralBug =
        job.deliberateEulerAncestralBug ?? preset.deliberateEulerAncestralBug;
      preset.legacyPromptConditioning =
        job.legacyPromptConditioning ?? preset.legacyPromptConditioning;
    }
    return await this.addFromPresetAndImage(preset, base64, name);
  }

  // ---------- 백업 / 복원 ----------

  // 백업 tar에 담을 엔트리(글로벌 프리셋 JSON + 프로필 이미지) 목록.
  async buildBackupEntries(): Promise<{ path: string; name: string }[]> {
    const entries: { path: string; name: string }[] = [
      { path: GLOBAL_PRESETS_FILE, name: 'global_presets.json' },
    ];
    for (const e of this.presets) {
      if (!e.profile) continue;
      const p = this.getProfilePath(e.profile);
      try {
        if (await backend.existFile(p)) {
          entries.push({
            path: p,
            name: 'global_vibes/' + e.profile.split('/').pop(),
          });
        }
      } catch (err) {}
    }
    return entries;
  }

  // 압축 해제된 백업 폴더에서 프리셋을 병합 복원. 이름 충돌은 policy에 따라 처리.
  @action
  async restoreFromBackupDir(
    root: string,
    policy: 'rename' | 'skip' | 'overwrite',
  ): Promise<{ added: number; skipped: number; overwritten: number }> {
    let store: any;
    try {
      store = JSON.parse(await backend.readFile(root + '/global_presets.json'));
    } catch (e) {
      throw new Error('백업에 글로벌 프리셋 데이터가 없습니다');
    }
    const list = Array.isArray(store?.presets) ? store.presets : [];
    let added = 0;
    let skipped = 0;
    let overwritten = 0;
    for (const src of list) {
      if (!src || !src.name || !src.workflowType) continue;
      let name = src.name as string;
      const existing = this.presets.find((p) => p.name === name);
      if (existing) {
        if (policy === 'skip') {
          skipped++;
          continue;
        }
        if (policy === 'overwrite') {
          await this.delete(existing.id); // 엔트리 + 프로필 이미지 제거
          overwritten++;
        } else {
          let i = 2;
          while (this.presets.some((p) => p.name === name)) {
            name = `${src.name} (${i})`;
            i++;
          }
        }
      }
      // 프로필 이미지 복사 (새 파일명으로 — 기존과 충돌 없음)
      let newProfile: string | undefined;
      if (src.profile) {
        const srcPath =
          root + '/global_vibes/' + String(src.profile).split('/').pop();
        try {
          if (await backend.existFile(srcPath)) {
            const filename = uuidv4() + '.png';
            await backend.copyFile(srcPath, GLOBAL_VIBES_DIR + '/' + filename);
            newProfile = filename;
          }
        } catch (e) {}
      }
      const json = src.preset ?? {};
      if (json && 'profile' in json) delete json.profile;
      const entry: IGlobalPresetEntry = {
        id: uuidv4(),
        name,
        workflowType: src.workflowType,
        isDefault: false, // 복원 항목은 기본 지정 해제 (기본 중복 방지)
        createdAt: src.createdAt || Date.now(),
        updatedAt: Date.now(),
        profile: newProfile,
        preset: json,
      };
      this.presets = [...this.presets, entry];
      added++;
    }
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return { added, skipped, overwritten };
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

    // 글로벌 프리셋은 그림체 설정(상위/하위/네거티브/샘플링)만 나른다.
    // 구버전 엔트리에 캐릭터 프롬프트가 묻어 있어도 버리고, 적용 후에도
    // 현재 보고 있던 프리셋의 캐릭터 프롬프트를 그대로 이어받는다(소실 방지).
    delete clone.characterPrompts;
    const cur = session.selectedWorkflow;
    const curPreset =
      cur && cur.workflowType === target && cur.presetName
        ? session.getPreset(target, cur.presetName)
        : undefined;
    if (curPreset?.characterPrompts?.length) {
      clone.characterPrompts = JSON.parse(
        JSON.stringify(curPreset.characterPrompts),
      );
    }

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
