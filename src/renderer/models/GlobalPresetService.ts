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
import { holdEntry, weaveHeld } from './heldEntries';
import type { HeldEntry } from './heldEntries';
import {
  dropListedFromTrash,
  isTrashExpired,
  makeTrashItem,
  mergeTrash,
  splitTrashField,
  unreferencedTokens,
} from './globalLibraryTrash';
import type {
  GlobalTrashItem,
  GlobalTrashPurgeResult,
  GlobalTrashRestoreOutcome,
} from './globalLibraryTrash';

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

export type IGlobalPresetTrashItem = GlobalTrashItem<IGlobalPresetEntry>;

export interface IGlobalPresetStore {
  version: number;
  presets: IGlobalPresetEntry[];
  // 휴지통(2026-11-24, 선택 필드 — globalLibraryTrash.ts). 비어 있으면 쓰지 않는다. 버전은 그대로.
  trash?: IGlobalPresetTrashItem[];
}

export class GlobalPresetService extends EventTarget {
  @observable accessor presets: IGlobalPresetEntry[] = [];
  /** 휴지통(같은 저장소 파일의 trash 필드) — 목록에서 지운 항목 원본 + 삭제 시각 */
  @observable accessor trash: IGlobalPresetTrashItem[] = [];
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
      // 휴지통 항목도 센다 — 휴지통만 남은 파일도 첫 저장 전에 .bak1 로 남긴다
      countItems: (s) => s.presets.length + (Array.isArray(s.trash) ? s.trash.length : 0),
      serialize: () => {
        const store: IGlobalPresetStore = {
          version: GLOBAL_PRESETS_VERSION,
          // 지원하지 않는 종류의 항목(heldEntries)을 원래 자리로 되돌려 쓴다(2026-11-18 경로 14)
          presets: weaveHeld(this.presets, this.heldEntries),
        };
        // 휴지통은 비어 있으면 쓰지 않는다(지금까지의 파일 형식과 같게). 보존분(모르는 종류)도 원래 자리로
        const trash = weaveHeld(this.trash, this.trashHeld);
        if (trash.length > 0) store.trash = trash;
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

  // 형식은 정상(id·name 문자열)인데 이 버전이 지원하지 않는 종류의 항목(2026-11-18 경로 14) — 화면 목록(presets)에는
  // 넣지 않고 원본 그대로 보존했다가 저장 때 원래 자리로 되돌려 쓴다. 이 창은 보존분을 바꾸지 않으므로 다른 창 교체·병합 때는
  // 언제나 파일(remote) 쪽 보존분이 정답이다. 관찰 대상 아님.
  private heldEntries: HeldEntry[] = [];
  // 휴지통의 보존분(이 버전이 모르는 종류의 항목) — heldEntries 와 같은 규칙(파일 쪽이 정답, 이 창은 바꾸지 않음)
  private trashHeld: HeldEntry[] = [];
  // 이 세션에서 본 파일을 정상(ok)으로 읽었는가 — 만료 정리는 이때만(사본 복구·읽기 실패·없음이면 하지 않음)
  private trashReadOk = false;

  /** 파일의 trash 필드 → 화면 휴지통 + 보존분(손상 칸은 버림, 모르는 종류는 보존) */
  static splitTrash(data: IGlobalPresetStore | null): {
    items: IGlobalPresetTrashItem[];
    held: HeldEntry[];
  } {
    return splitTrashField<IGlobalPresetEntry>(
      data ? (data as any).trash : undefined,
      (e) => !!e && typeof e.id === 'string' && typeof e.name === 'string',
      Date.now(),
      (e) => SUPPORTED_GLOBAL_PRESET_TYPES.includes(e.workflowType),
    );
  }

  /** 파일 내용의 휴지통·휴지통 보존분으로 바꾼다(load·교체 공용). 목록과 겹치는 id 는 목록 우선 */
  private adoptTrash(data: IGlobalPresetStore | null): void {
    const t = GlobalPresetService.splitTrash(data);
    this.trash = dropListedFromTrash(t.items, this.listedIds());
    this.trashHeld = t.held;
  }

  /** 목록(보존분 포함)에 있는 id — 휴지통과 겹치면 목록 우선 */
  private listedIds(): string[] {
    const ids = this.presets.map((p) => p.id);
    for (const h of this.heldEntries) if (typeof h.value?.id === 'string') ids.push(h.value.id);
    return ids;
  }

  /** 파일 내용 → 화면 목록 + 보존분(load·다른 창 재로드·병합 기준이 같은 규칙을 쓴다). 손상 항목은 종전대로 버린다 */
  static splitEntries(data: IGlobalPresetStore | null): {
    visible: IGlobalPresetEntry[];
    held: HeldEntry[];
  } {
    const visible: IGlobalPresetEntry[] = [];
    const held: HeldEntry[] = [];
    if (!data || !Array.isArray(data.presets)) return { visible, held };
    let index = 0; // 손상으로 버린 항목을 뺀 자리
    for (const p of data.presets) {
      if (!(p && typeof p.id === 'string' && typeof p.name === 'string')) continue;
      if (SUPPORTED_GLOBAL_PRESET_TYPES.includes(p.workflowType)) visible.push(p);
      else held.push(holdEntry(index, p));
      index++;
    }
    return { visible, held };
  }

  private static normalizeEntries(data: IGlobalPresetStore | null): IGlobalPresetEntry[] {
    return GlobalPresetService.splitEntries(data).visible;
  }

  /** 파일 내용의 보존분으로 바꾼다(load·교체·병합 공용) */
  private adoptHeld(data: IGlobalPresetStore | null): void {
    this.heldEntries = GlobalPresetService.splitEntries(data).held;
  }

  async load(): Promise<void> {
    const res = await this.store.load();
    if (res.keepMemory) return; // 재로드 실패 — 이미 가진 목록 유지
    if (res.kind === 'io-failed') {
      // 읽기 실패 — 빈 목록으로 보이되 저장·변경은 막힌다. loaded=false 로 두어 다음 진입(피커·템플릿 관리 등)이 다시 읽게 한다.
      this.presets = [];
      this.heldEntries = [];
      this.trash = [];
      this.trashHeld = [];
      this.trashReadOk = false;
      this.loaded = false;
      this.dispatchEvent(new CustomEvent('loaded', {}));
      return;
    }
    let loadedVersion = GLOBAL_PRESETS_VERSION;
    let sourceRaw: string | null = null;
    if (res.kind === 'ok' || res.kind === 'recovered') {
      this.presets = GlobalPresetService.normalizeEntries(res.data);
      this.adoptHeld(res.data);
      this.adoptTrash(res.data);
      loadedVersion = (res.data as any).version || 1;
      sourceRaw = res.raw;
    } else {
      // missing(신규) · corrupt-empty(손상본 보존됨) — 옮길 v1 데이터가 없으므로 통합 이관·저장을 하지 않는다
      this.presets = [];
      this.heldEntries = [];
      this.trash = [];
      this.trashHeld = [];
    }
    this.trashReadOk = res.kind === 'ok';
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
        this.adoptHeld(remote);
        this.adoptTrash(remote);
        this.trashReadOk = true;
        if (((remote as any).version || 1) < GLOBAL_PRESETS_VERSION) migrateRaw = raw;
      },
      merge: (remote, base, raw) => {
        this.presets = mergeById(
          GlobalPresetService.normalizeEntries(base),
          this.presets,
          GlobalPresetService.normalizeEntries(remote),
        );
        // 보존분은 이 창이 바꾸지 않는다 — 파일(remote) 쪽이 정답
        this.adoptHeld(remote);
        // 휴지통도 항목(id) 단위 3방향 병합 → 목록과 겹치는 id 는 휴지통 쪽을 버린다(목록 우선 — 되살아난 것을 다시 지우지 않게)
        const remoteTrash = GlobalPresetService.splitTrash(remote);
        this.trash = dropListedFromTrash(
          mergeTrash(GlobalPresetService.splitTrash(base).items, this.trash, remoteTrash.items),
          this.listedIds(),
        );
        this.trashHeld = remoteTrash.held;
        this.trashReadOk = true;
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
  // 항목 단위 백업은 목록만 담는다(휴지통 제외, 2026-11-24): 휴지통이 비어 있으면 종전대로 본 파일 그대로, 있으면
  // 휴지통 필드를 뺀 같은 형식의 임시 파일(tmp/ — 매니페스트와 같은 1회성 쓰기)을 담는다. 이미지도 목록 항목 것만.
  async buildBackupEntries(): Promise<{ path: string; name: string }[]> {
    let storePath = GLOBAL_PRESETS_FILE;
    if (this.trash.length > 0 || this.trashHeld.length > 0) {
      const listOnly: IGlobalPresetStore = {
        version: GLOBAL_PRESETS_VERSION,
        presets: weaveHeld(this.presets, this.heldEntries),
      };
      storePath = 'tmp/' + uuidv4() + '.json';
      await backend.writeFile(storePath, JSON.stringify(listOnly));
    }
    const entries: { path: string; name: string }[] = [
      { path: storePath, name: 'global_presets.json' },
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
          // 기존 항목은 휴지통으로(2026-11-24 — 종전 = 항목 + 대표 이미지 영구 삭제). 휴지통에서 되살릴 수 있다
          await this.delete(existing.id);
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

  // ---------- 휴지통(2026-11-24, globalLibraryTrash.ts) ----------

  /** 목록·휴지통·두 보존분이 가리키는 대표 이미지 파일 토큰 — 영구 삭제가 이 밖의 파일만 지운다 */
  private referencedProfiles(): string[] {
    const out: string[] = [];
    const add = (p: unknown) => {
      if (typeof p === 'string' && p) out.push(p);
    };
    for (const p of this.presets) add(p.profile);
    for (const t of this.trash) add(t.entry?.profile);
    for (const h of this.heldEntries) add(h.value?.profile);
    for (const h of this.trashHeld) add(h.value?.entry?.profile);
    return out;
  }

  getTrashItem(id: string): IGlobalPresetTrashItem | undefined {
    return this.trash.find((t) => t.entry.id === id);
  }

  /**
   * 삭제 = 휴지통으로 이동(2026-11-24). 항목 원본을 같은 파일의 휴지통 목록으로 옮긴다 — 목록에서 빼기와 휴지통에 넣기는
   * 한 번의 저장으로 나간다(scheduleSave 하나). 대표 이미지 파일은 지우지 않는다(영구 삭제·만료 때만).
   */
  @action
  async delete(id: string): Promise<void> {
    this.store.assertWritable();
    const entry = this.get(id);
    if (!entry) return;
    const item = makeTrashItem(entry, Date.now());
    this.presets = this.presets.filter((p) => p.id !== id);
    // 같은 id 가 휴지통에 남아 있으면(드묾) 새로 넣는 쪽만 남긴다
    this.trash = [...this.trash.filter((t) => t.entry.id !== id), item];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  /**
   * 휴지통 → 목록. at = 넣을 자리(없으면 끝 — 되돌리기는 원래 자리). 같은 종류 안에서 이름이 겹치면 「X (2)」.
   * 대표 이미지 파일이 없으면(다른 경로로 지워짐) 항목은 복원하되 이미지 없음 상태로 두고 missingImages 로 알린다.
   * 같은 id 가 목록에 있으면 아무것도 하지 않는다(id-taken). 휴지통에 없으면 not-in-trash.
   */
  @action
  async restoreFromTrash(id: string, at?: number): Promise<GlobalTrashRestoreOutcome<IGlobalPresetEntry>> {
    this.store.assertWritable();
    if (this.get(id)) return { kind: 'id-taken' };
    const first = this.getTrashItem(id);
    if (!first) return { kind: 'not-in-trash' };
    let missingImages = 0;
    if (first.entry.profile) {
      let exists = false;
      try {
        exists = await backend.existFile(this.getProfilePath(first.entry.profile));
      } catch (e) {
        exists = false;
      }
      if (!exists) missingImages = 1;
    }
    // await 사이 다른 창 재로드·막힘이 있었으면 지금 상태로 다시 판단한다
    this.store.assertWritable();
    if (this.get(id)) return { kind: 'id-taken' };
    const item = this.getTrashItem(id);
    if (!item) return { kind: 'not-in-trash' };
    const restored: IGlobalPresetEntry = JSON.parse(JSON.stringify(item.entry));
    const original = restored.name;
    restored.name = this.resolveNameCollision(restored.workflowType, restored.name);
    const arr = [...this.presets];
    arr.splice(at === undefined ? arr.length : Math.max(0, Math.min(at, arr.length)), 0, restored);
    this.presets = arr;
    this.trash = this.trash.filter((t) => t !== item);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return {
      kind: 'restored',
      entry: restored,
      ...(restored.name !== original ? { renamedFrom: original } : {}),
      missingImages,
    };
  }

  /** 휴지통에서 골라 영구 삭제(ids) */
  async purgeFromTrash(ids: Iterable<string>): Promise<GlobalTrashPurgeResult> {
    const set = new Set(ids);
    return this.dropTrashItems((t) => set.has(t.entry.id));
  }

  /** 휴지통 비우기 */
  async emptyTrash(): Promise<GlobalTrashPurgeResult> {
    return this.dropTrashItems(() => true);
  }

  /**
   * 보관 기한(30일)이 지난 휴지통 항목을 조용히 영구 삭제. 이 세션에서 본 파일을 정상으로 읽었을 때만 —
   * 읽기 실패·저장 차단·사본 복구·아직 안 읽음이면 아무것도 지우지 않는다(0).
   */
  async purgeExpiredTrash(now: number = Date.now()): Promise<number> {
    if (!this.loaded || this.store.loadFailed || !this.trashReadOk) return 0;
    if (!this.trash.some((t) => isTrashExpired(t, now))) return 0;
    const r = await this.dropTrashItems((t) => isTrashExpired(t, now));
    return r.removed;
  }

  /**
   * 휴지통에서 빼고 → 지금 저장(dirty 를 세운 뒤 저장 줄에서) → 저장이 끝났을 때만, 뺀 항목의 이미지 중 목록·휴지통·보존분
   * 어디에서도 참조하지 않는 파일을 지운다(다른 항목이 같은 파일을 쓰면 남김 — 덜 지우는 쪽). 저장 실패면 파일은 그대로.
   */
  private async dropTrashItems(pick: (t: IGlobalPresetTrashItem) => boolean): Promise<GlobalTrashPurgeResult> {
    this.store.assertWritable();
    const removed = this.trash.filter(pick);
    if (removed.length === 0) return { removed: 0, filesDeleted: 0, saved: true };
    const gone = new Set(removed);
    this.trash = this.trash.filter((t) => !gone.has(t));
    this.store.markDirty();
    this.dispatchEvent(new CustomEvent('changed', {}));
    const saved = await this.store.saveNow();
    if (!saved) return { removed: removed.length, filesDeleted: 0, saved: false };
    // 저장 뒤의 지금 상태로 참조를 센다(그사이 다른 창이 같은 파일을 쓰는 항목을 들여왔어도 남게)
    const candidates = removed.map((t) => t.entry.profile).filter((p): p is string => !!p);
    let filesDeleted = 0;
    for (const token of unreferencedTokens(candidates, this.referencedProfiles())) {
      await this.deleteProfileImage(token);
      filesDeleted++;
    }
    return { removed: removed.length, filesDeleted, saved: true };
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

  /** 한 장 내보내기 = PNG 만들기(buildExportPng) + 파일로 쓰기. 여러 장 내보내기(globalPresetPngExport)도 같은 PNG 를 쓴다. */
  async exportToPng(id: string, outPath: string): Promise<void> {
    const newPng = await this.buildExportPng(id);
    await backend.writeDataFile(outPath, newPng);
  }

  /**
   * 내보내기 PNG(base64) 만들기 — 대표 이미지(없거나 PNG 가 아니면 이름 글자 그림) + 장식 + 프리셋 JSON 삽입.
   * 저장소의 내용·순서·저장 표시는 바꾸지 않는다(읽기만).
   */
  async buildExportPng(id: string): Promise<string> {
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
    return embedJSONInPNG(decoratedPng, jsonForPng);
  }
}
