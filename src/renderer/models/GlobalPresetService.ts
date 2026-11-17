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
import { decoratePresetExportImage } from './presetExportDecoration';
import { planPromptImport } from './sdstudioPromptImport';
import { numberedName } from './nameInput';
import type { ImportableMetadata } from './types';
import { StoreFile, GLOBAL_STORE_SYNC_KEYS } from './storeFile';
import { globalStoreDeps } from './globalStoreDeps';
import { mergeById } from './storeMerge';

/**
 * 이미지 메타 → 그림체 프리셋의 상위·하위(SDStudio 구획 메타가 있으면 나눠 담고, 없으면 통합 → 상위).
 * 추가 프롬프트는 상위 끝에 합친다. 씬 구획은 프로젝트 이미지면(씬이 이미 가짐) 빼고, 외부 파일이면 하위 앞에 합친다.
 */
function globalPresetPromptsFromJob(
  job: ImportableMetadata | undefined,
  middle: 'omit' | 'fold',
): {
  frontPrompt: string;
  backPrompt: string;
} {
  const plan = planPromptImport(job?.prompt, job?.sdstudioMetadata?.promptSource, {
    targetType: 'SDImageGen',
    placeExtra: false,
    middle,
  });
  return { frontPrompt: plan.frontPrompt, backPrompt: plan.backPrompt ?? '' };
}

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

  // 로드 판정·저장·사본 회전(storeFile.ts 단일 출처, 2026-11-17 묶음 1). 형식은 종전 그대로.
  private store = new StoreFile<IGlobalPresetStore>(
    {
      file: GLOBAL_PRESETS_FILE,
      label: '글로벌 프리셋',
      parse: (raw) => {
        const json = JSON.parse(raw);
        return json && typeof json === 'object' && Array.isArray(json.presets)
          ? (json as IGlobalPresetStore)
          : null;
      },
      countItems: (s) => s.presets.length,
      serialize: () => {
        const store: IGlobalPresetStore = {
          version: GLOBAL_PRESETS_VERSION,
          presets: this.presets,
        };
        return JSON.stringify(store);
      },
      saveDelayMs: 2000,
      // 여러 창 동기화(2026-11-17 묶음 2): 다른 창이 이 저장소를 다시 읽게 알린다(bootstrap 수신부 → reloadExternal)
      afterWrite: () => {
        backend.notifyGlobalStoreChanged(GLOBAL_STORE_SYNC_KEYS.globalPresets).catch(() => {});
      },
    },
    globalStoreDeps,
  );

  /** 파일을 읽지 못해 저장·변경이 막힌 상태(앱을 다시 시작하거나 reload 성공 시 풀림) */
  get loadFailed(): boolean {
    return this.store.loadFailed;
  }

  // ---------- lifecycle ----------

  /** 파일 내용 → 메모리 목록(load·다른 창 재로드·병합 기준이 같은 규칙을 쓴다) */
  private static normalizeEntries(data: IGlobalPresetStore | null): IGlobalPresetEntry[] {
    if (!data || !Array.isArray(data.presets)) return [];
    return data.presets.filter(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        SUPPORTED_GLOBAL_PRESET_TYPES.includes(p.workflowType),
    );
  }

  async load(): Promise<void> {
    const res = await this.store.load();
    if (res.keepMemory) return; // 재로드 실패 — 이미 가진 목록 유지
    if (res.kind === 'io-failed') {
      // 읽기 실패 — 빈 목록으로 보이되 저장·변경은 막힌다. loaded=false 로 두어 다음 진입(피커·템플릿 관리 등)이 다시 읽게 한다.
      this.presets = [];
      this.loaded = false;
      this.dispatchEvent(new CustomEvent('loaded', {}));
      return;
    }
    let loadedVersion = GLOBAL_PRESETS_VERSION;
    let sourceRaw: string | null = null;
    if (res.kind === 'ok' || res.kind === 'recovered') {
      this.presets = GlobalPresetService.normalizeEntries(res.data);
      loadedVersion = (res.data as any).version || 1;
      sourceRaw = res.raw;
    } else {
      // missing(신규) · corrupt-empty(손상본 보존됨) — 옮길 v1 데이터가 없으므로 통합 이관·저장을 하지 않는다
      this.presets = [];
    }
    this.loaded = true;
    // v2 통합 마이그레이션: 이지/일반을 한 라이브러리로 보고 이름을 고유화한다.
    // (멱등 — 한 번 v2로 저장되면 다시 실행되지 않음). 실제로 v1 데이터를 읽었을 때만.
    if (sourceRaw !== null && loadedVersion < GLOBAL_PRESETS_VERSION) {
      try {
        await this.migrateUnify(sourceRaw);
      } catch (e) {
        console.error('글로벌 프리셋 통합 마이그레이션 실패:', e);
      }
    }
    this.dispatchEvent(new CustomEvent('loaded', {}));
  }

  /** 읽기 실패로 막혀 있으면 한 번 다시 읽는다(관리 화면 진입 때). 성공하면 차단이 풀린다 */
  async reloadIfFailed(): Promise<void> {
    if (this.store.loadFailed) await this.load();
  }

  /**
   * 다른 창이 저장했다는 알림으로 다시 읽는다(여러 창 동기화). 아직 읽지 않았거나 읽기 실패 상태면 무동작(종전 경로).
   * 저장 안 된 변경이 없으면 교체, 있으면 항목 단위 병합(storeMerge) — 재로드만으로는 쓰지 않는다.
   * v2 통합 이관은 종전 조건 그대로(실제로 v1 을 읽었을 때만).
   */
  async reloadExternal(): Promise<void> {
    if (!this.loaded) return;
    let migrateRaw: string | null = null;
    const r = await this.store.reloadExternal({
      replace: (remote, raw) => {
        this.presets = GlobalPresetService.normalizeEntries(remote);
        if (((remote as any).version || 1) < GLOBAL_PRESETS_VERSION) migrateRaw = raw;
      },
      merge: (remote, base, raw) => {
        this.presets = mergeById(
          GlobalPresetService.normalizeEntries(base),
          this.presets,
          GlobalPresetService.normalizeEntries(remote),
        );
        if (((remote as any).version || 1) < GLOBAL_PRESETS_VERSION) migrateRaw = raw;
      },
    });
    if (r !== 'replaced' && r !== 'merged') return;
    if (migrateRaw !== null) {
      try {
        await this.migrateUnify(migrateRaw);
      } catch (e) {
        console.error('글로벌 프리셋 통합 마이그레이션 실패:', e);
      }
    }
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // v2 통합 마이그레이션: 타입(이지/일반) 구분 없이 이름이 겹치면 뒤(나중에 만든)의
  // 것에 " (2)", " (3)"... 을 붙여 라이브러리 전체에서 이름을 고유하게 만든다.
  // 비파괴: 먼저 원본(방금 읽은 내용 그대로)을 .bak-unify-<시각> 으로 백업한다.
  private async migrateUnify(sourceRaw: string): Promise<void> {
    try {
      await persistService.write(
        GLOBAL_PRESETS_FILE + '.bak-unify-' + Date.now(),
        sourceRaw,
      );
    } catch (e) {
      console.warn('글로벌 프리셋 통합 이관 전 원본 백업 실패:', e);
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

  // 저장: tmp → rename(실패 시 직접 쓰기), 세션 첫 저장 전 .bak1~3 회전, 읽기 실패 상태면 쓰지 않음(storeFile)
  async save(): Promise<void> {
    await this.store.saveNow();
  }

  scheduleSave(): void {
    this.store.schedule();
  }

  // 종료·백업 직전 — 바뀐 것이 있을 때만 쓴다
  async flushSave(): Promise<void> {
    await this.store.flush();
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
    // 가져오기·충돌 규칙(2026-11-14 M2 K8) — 「X」→「X (2)」(종전 「X (1)」부터). 글로벌 복사·PNG/이미지 불러오기 공용
    return numberedName(name, (n) => !!this.getByName(type, n));
  }

  @action
  async addFromSessionPreset(
    session: Session,
    preset: any,
  ): Promise<IGlobalPresetEntry> {
    this.store.assertWritable();
    if (!preset || !preset.type) {
      throw new Error('유효하지 않은 프리셋입니다');
    }
    if (!SUPPORTED_GLOBAL_PRESET_TYPES.includes(preset.type)) {
      throw new Error(
        `이 워크플로우 타입(${preset.type})은 글로벌로 복사할 수 없습니다`,
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
    this.store.assertWritable();
    if (!preset || !preset.type) {
      throw new Error('유효하지 않은 프리셋입니다');
    }
    if (!SUPPORTED_GLOBAL_PRESET_TYPES.includes(preset.type)) {
      throw new Error(
        `이 워크플로우 타입(${preset.type})은 글로벌로 복사할 수 없습니다`,
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
    this.store.assertWritable();
    let json = readJSONFromPNG(base64);
    if (!json || !json.type || !json.name) return undefined;

    json = normalizePresetJson(json);

    if (!SUPPORTED_GLOBAL_PRESET_TYPES.includes(json.type)) {
      throw new Error(
        `이 워크플로우 타입(${json.type})은 글로벌 프리셋으로 불러올 수 없습니다`,
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
    this.store.assertWritable();
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
    Object.assign(preset, globalPresetPromptsFromJob(job, 'fold'));
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
    this.store.assertWritable();
    const job = await extractPromptDataFromBase64(base64);
    const preset: any = workFlowService.buildPreset('SDImageGen');
    preset.name = name;
    Object.assign(preset, globalPresetPromptsFromJob(job, 'omit'));
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
    this.store.assertWritable();
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
    this.store.assertWritable();
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
    this.store.assertWritable();
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
    this.store.assertWritable();
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
    this.store.assertWritable();
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
    this.store.assertWritable();
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    const oldProfile = entry.profile;
    const newProfile = await this.storeProfileImage(base64);
    // await 도중 다른 창 저장으로 목록이 다시 읽혔으면(reloadExternal) 지금 목록의 같은 id 항목에 반영한다 — 옛 객체에 쓰면
    // 새 대표 이미지가 조용히 사라진다. 다른 창이 지웠으면 이 창 편집을 살려 뒤에 붙인다(병합 규칙과 같음).
    const live = this.get(id);
    const target = live ?? entry;
    target.profile = newProfile;
    target.updatedAt = Date.now();
    this.presets = live ? [...this.presets] : [...this.presets, target];
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

    const decoratedPng = await decoratePresetExportImage(
      pngBase64,
      'global',
      entry.name,
    );
    const newPng = embedJSONInPNG(decoratedPng, jsonForPng);
    await backend.writeDataFile(outPath, newPng);
  }
}
