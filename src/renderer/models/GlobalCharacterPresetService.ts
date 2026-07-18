import { observable, action } from 'mobx';
import { persistService } from './PersistenceService';
import { v4 as uuidv4 } from 'uuid';
import { backend, imageService } from '.';
import { Session, CharacterPreset, ICharacterPreset } from './types';
import { dataUriToBase64 } from './ImageService';

const GLOBAL_CHAR_PRESETS_FILE = 'global_character_presets.json';
const GLOBAL_CHAR_IMAGES_DIR = 'global_char_images';

export interface IGlobalCharacterPresetEntry {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // 이미지 경로(vibes/characterReferences/representativeImage)는 글로벌 파일명을 가리킨다.
  preset: ICharacterPreset;
  // 1단계 평면 폴더(중첩 없음, 배치 생성 P0 — 2026-07-16 합의).
  // 빈 문자열/미지정 = 루트(미분류). 폴더 목록의 진실 원천은 스토어의
  // folders 레지스트리(아래) — 엔트리의 이 필드는 소속 지정이다.
  folder?: string;
}

export interface IGlobalCharacterPresetStore {
  version: 1;
  presets: IGlobalCharacterPresetEntry[];
  // 폴더 레지스트리(1단계 평면, 배열 순서 = 표시 순서) — 빈 폴더 허용
  // ("폴더 먼저 만들고 옮기는" 워크플로). 필드 추가 = 구버전 호환 무해.
  // 구 데이터(파생 방식)는 listFolders 가 엔트리에서 자동 복구 병합한다.
  folders?: string[];
}

// 글로벌(프로젝트 공통) 캐릭터 프리셋.
// 캐릭터 프리셋 이미지는 세션 디렉터리에 종속되므로, 글로벌은 전용 디렉터리에
// 이미지를 따로 보관하고(data URI 파일), 불러올 때 세션으로 복사한다.
export class GlobalCharacterPresetService extends EventTarget {
  @observable accessor presets: IGlobalCharacterPresetEntry[] = [];
  // 폴더 레지스트리 — 순서가 곧 표시 순서. listFolders 로만 읽을 것
  // (파생 폴더 자동 복구 병합 포함).
  @observable accessor folders: string[] = [];
  @observable accessor loaded: boolean = false;
  private saveTimeout: any = null;

  // ---------- lifecycle ----------
  async load() {
    try {
      const str = await backend.readFile(GLOBAL_CHAR_PRESETS_FILE);
      const json = JSON.parse(str) as IGlobalCharacterPresetStore;
      this.presets =
        json && Array.isArray(json.presets)
          ? json.presets
              .filter(
                (p) =>
                  p &&
                  typeof p.id === 'string' &&
                  typeof p.name === 'string' &&
                  p.preset,
              )
              // folder 문자열 방어 — 비문자열/빈 값은 루트로 정규화
              .map((p) => ({
                ...p,
                folder:
                  typeof p.folder === 'string' && p.folder.trim()
                    ? p.folder
                    : undefined,
              }))
          : [];
      // 폴더 레지스트리 로드 방어 — 문자열만·trim·중복 제거
      const rawFolders = Array.isArray((json as any)?.folders)
        ? ((json as any).folders as unknown[])
        : [];
      const folders: string[] = [];
      for (const f of rawFolders) {
        if (typeof f !== 'string') continue;
        const t = f.trim();
        if (t && !folders.includes(t)) folders.push(t);
      }
      this.folders = folders;
    } catch (e) {
      this.presets = [];
      this.folders = [];
    }
    this.loaded = true;
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  async save() {
    const store: IGlobalCharacterPresetStore = {
      version: 1,
      presets: this.presets,
      folders: this.folders,
    };
    const data = JSON.stringify(store);
    const tmp = GLOBAL_CHAR_PRESETS_FILE + '.tmp';
    try {
      await persistService.write(tmp, data);
      await backend.renameFile(tmp, GLOBAL_CHAR_PRESETS_FILE);
    } catch (e) {
      try {
        await persistService.write(GLOBAL_CHAR_PRESETS_FILE, data);
      } catch (e2) {
        console.error('Failed to save global character presets:', e2);
        return;
      }
    }
    // 전역 저장소 동기화(W6 P2): 다른 창들이 디스크에서 재로드하도록 알림
    backend.notifyGlobalStoreChanged('global-character-presets').catch(() => {});
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
  list(): IGlobalCharacterPresetEntry[] {
    return this.presets.slice();
  }
  get(id: string): IGlobalCharacterPresetEntry | undefined {
    return this.presets.find((p) => p.id === id);
  }
  getByName(name: string): IGlobalCharacterPresetEntry | undefined {
    return this.presets.find((p) => p.name === name);
  }

  // ---------- 폴더 (1단계 평면, 영속 레지스트리 — 2026-07-16 UX 개편) ----------
  // 폴더는 folders 레지스트리가 진실 원천(빈 폴더 허용 — 폴더 먼저 만들고
  // 옮기는 워크플로). 레지스트리에 없는데 엔트리에만 존재하는 파생 폴더
  // (수동 편집/구 데이터)는 목록 뒤에 정렬 병합해 자동 복구한다.
  listFolders(): string[] {
    const derived = new Set<string>();
    for (const p of this.presets) if (p.folder) derived.add(p.folder);
    for (const f of this.folders) derived.delete(f);
    const extras = Array.from(derived).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );
    return [...this.folders, ...extras];
  }

  // 새 폴더 등록 (빈 폴더 허용) — trim·중복 거부. 반환 = 정규화된 이름.
  @action
  async createFolder(name: string): Promise<string> {
    name = (name ?? '').trim();
    if (!name) throw new Error('폴더 이름을 입력해 주세요');
    if (this.listFolders().includes(name)) {
      throw new Error('이미 존재하는 폴더입니다');
    }
    this.folders = [...this.folders, name];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return name;
  }

  // 폴더 삭제 — 소속 엔트리는 미분류로 이동, 레지스트리에서 제거.
  @action
  async deleteFolder(name: string): Promise<void> {
    let entryChanged = false;
    this.presets = this.presets.map((p) => {
      if (p.folder !== name) return p;
      entryChanged = true;
      return { ...p, folder: undefined, updatedAt: Date.now() };
    });
    const registryChanged = this.folders.includes(name);
    if (!entryChanged && !registryChanged) return;
    this.folders = this.folders.filter((f) => f !== name);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // 폴더 지정/해제 — null/빈 값은 루트(undefined)로 정규화.
  // 새 폴더 이름이 오면 레지스트리에 자동 등록한다.
  @action
  async setFolder(id: string, folder: string | null): Promise<void> {
    const entry = this.get(id);
    if (!entry) return;
    const f = (folder ?? '').trim();
    const next = f ? f : undefined;
    if (entry.folder === next) return;
    entry.folder = next;
    entry.updatedAt = Date.now();
    if (next && !this.folders.includes(next)) {
      this.folders = [...this.folders, next];
    }
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // 폴더 이름 변경 — 레지스트리 이관 + 해당 폴더의 엔트리 일괄 이관.
  @action
  async renameFolder(oldName: string, newName: string): Promise<void> {
    newName = newName.trim();
    if (!newName) throw new Error('폴더 이름을 입력해 주세요');
    if (oldName === newName) return;
    if (this.listFolders().includes(newName)) {
      throw new Error('이미 존재하는 폴더입니다');
    }
    // 레지스트리 이관 — 파생 전용(미등록) 폴더였다면 새 이름으로 등록해 복구
    this.folders = this.folders.includes(oldName)
      ? this.folders.map((f) => (f === oldName ? newName : f))
      : [...this.folders, newName];
    this.presets = this.presets.map((p) =>
      p.folder === oldName
        ? { ...p, folder: newName, updatedAt: Date.now() }
        : p,
    );
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // ---------- image helpers (data URI 파일) ----------
  getImagePath(filename: string): string {
    return GLOBAL_CHAR_IMAGES_DIR + '/' + filename.split('/').pop()!;
  }

  // 카드 표시용 등: data URI 그대로 반환 (img src로 바로 사용 가능)
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
    // read-data-file은 data URI를 주지만 write-data-file은 raw base64를 기대한다.
    const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
    const filename = uuidv4() + '.png';
    await backend.writeDataFile(GLOBAL_CHAR_IMAGES_DIR + '/' + filename, base64);
    return filename;
  }

  private async deleteImageData(filename: string) {
    if (!filename) return;
    try {
      await backend.deleteFile(this.getImagePath(filename));
    } catch (e) {}
  }

  // 이름 충돌 시 `_n` 접미사 부여 — 일괄 생성(batchCreatePlan)과 같은 관례
  private resolveNameCollision(name: string): string {
    if (!this.getByName(name)) return name;
    let i = 1;
    while (this.getByName(`${name}_${i}`)) i++;
    return `${name}_${i}`;
  }

  // ---------- 로컬 → 글로벌 ----------
  @action
  async addFromSessionPreset(
    session: Session,
    preset: CharacterPreset,
  ): Promise<IGlobalCharacterPresetEntry> {
    const json: ICharacterPreset = preset.toJSON();

    for (const vibe of json.vibes || []) {
      try {
        const data = await backend.readDataFile(
          imageService.getVibeImagePath(session, vibe.path),
        );
        if (data) vibe.path = await this.storeImageData(data);
      } catch (e) {}
    }
    for (const ref of json.characterReferences || []) {
      try {
        const data = await backend.readDataFile(
          imageService.getReferenceImagePath(session, ref.path),
        );
        if (data) ref.path = await this.storeImageData(data);
      } catch (e) {}
    }
    if (json.representativeImage) {
      try {
        const data = await backend.readDataFile(
          imageService.getVibeImagePath(session, json.representativeImage),
        );
        if (data) json.representativeImage = await this.storeImageData(data);
      } catch (e) {}
    }

    const name = this.resolveNameCollision(
      (json.name || '이름없음').trim() || '이름없음',
    );
    json.name = name;
    // 로컬 사본에 붙은 글로벌 유래 링크는 새 글로벌 엔트리와 무관 — 제거
    delete json.fromGlobalId;
    delete json.fromGlobalRev;
    const entry: IGlobalCharacterPresetEntry = {
      id: uuidv4(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preset: json,
    };
    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  // ---------- 글로벌 → 로컬 ----------
  // 멱등(증식 방지, 2026-07-17): 같은 글로벌에서 불러온 로컬 사본(fromGlobalId
  // 링크, 구버전 사본은 동명 무링크 로컬을 입양)이 이미 있으면 — 글로벌이 그대로면
  // 그 사본을 그대로 재사용(이미지 재복사 없음), 글로벌이 바뀌었으면 그 사본을
  // 자리에서 갱신한다. 반복 적용/해제로 "이름 (글로벌)…" 사본이 늘어나지 않는다.
  async instantiateIntoSession(
    session: Session,
    id: string,
  ): Promise<CharacterPreset> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    const existing =
      session.getCharacterPresets().find((p) => p.fromGlobalId === id) ||
      // 이 수정 이전에 만들어진 사본 입양: 글로벌과 같은 이름의 무링크 로컬
      session
        .getCharacterPresets()
        .find((p) => !p.fromGlobalId && p.name === entry.name);
    if (existing && existing.fromGlobalRev === entry.updatedAt) {
      return existing;
    }
    const json: ICharacterPreset = JSON.parse(JSON.stringify(entry.preset));

    for (const vibe of json.vibes || []) {
      try {
        const dataUri = await this.fetchImageData(vibe.path);
        if (dataUri) {
          vibe.path = await imageService.storeVibeImage(
            session,
            dataUriToBase64(dataUri),
          );
        }
      } catch (e) {}
    }
    for (const ref of json.characterReferences || []) {
      try {
        const dataUri = await this.fetchImageData(ref.path);
        if (dataUri) {
          ref.path = await imageService.storeReferenceImage(
            session,
            dataUriToBase64(dataUri),
          );
        }
      } catch (e) {}
    }
    if (json.representativeImage) {
      try {
        const dataUri = await this.fetchImageData(json.representativeImage);
        if (dataUri) {
          json.representativeImage = await imageService.storeVibeImage(
            session,
            dataUriToBase64(dataUri),
          );
        }
      } catch (e) {}
    }

    const preset = CharacterPreset.fromJSON(json);
    preset.fromGlobalId = id;
    preset.fromGlobalRev = entry.updatedAt;
    if (existing) {
      // 기존 사본을 자리에서 갱신 — 이름은 글로벌을 따라가되, 링크된 자기 자신이
      // 아닌 다른 로컬과 충돌하면 접미. 이름이 유지되면 fromPreset 적용 태그도
      // 그대로 이어진다.
      let nm = preset.name;
      while (
        session.hasCharacterPreset(nm) &&
        session.getCharacterPreset(nm) !== existing
      )
        nm = nm + ' (글로벌)';
      preset.name = nm;
      session.updateCharacterPreset(existing.name, preset);
    } else {
      // 최초 불러오기 — 로컬 이름 충돌 방지
      let nm = preset.name;
      while (session.hasCharacterPreset(nm)) nm = nm + ' (글로벌)';
      preset.name = nm;
      session.addCharacterPreset(preset);
    }
    return preset;
  }

  // ---------- 파일 내보내기/불러오기 (PC↔모바일 크로스 작업 이동, 2026-07-18) ----------
  // 파일 형식 = 로컬 캐릭터 프리셋 내보내기(CharacterPresetEditor 의
  // ExportedPresetData version 1)와 동일: 프리셋 JSON + vibeImages/referenceImages/
  // representativeImageData 로 이미지 데이터 인라인. filename 은 프리셋 json 의
  // path 토큰과 일치시키므로 **로컬↔글로벌 교차 불러오기**가 가능하다.
  // globalFolder 는 글로벌 전용 추가 필드 — 로컬 불러오기는 모른 채 무시(무해).
  async exportToFileData(): Promise<any> {
    const out: any = { version: 1, presets: [] };
    for (const entry of this.presets) {
      const json: any = JSON.parse(JSON.stringify(entry.preset));
      json.vibeImages = [];
      for (const vibe of json.vibes || []) {
        if (!vibe.path) continue;
        const data = await this.fetchImageData(vibe.path);
        if (data) json.vibeImages.push({ filename: vibe.path, data });
      }
      json.referenceImages = [];
      for (const ref of json.characterReferences || []) {
        if (!ref.path) continue;
        const data = await this.fetchImageData(ref.path);
        if (data) json.referenceImages.push({ filename: ref.path, data });
      }
      if (json.representativeImage) {
        const data = await this.fetchImageData(json.representativeImage);
        if (data) json.representativeImageData = data;
      }
      if (entry.folder) json.globalFolder = entry.folder;
      out.presets.push(json);
    }
    return out;
  }

  // 파일 데이터 → 글로벌 엔트리 등록. 이미지는 새 글로벌 파일명(uuid)으로 저장 후
  // path 재지정(기존 글로벌 이미지와 충돌 없음). 이름 충돌은 `_n` 접미.
  // 반환 = 불러온 개수. 형식 오류는 throw (호출 UI 가 메시지 처리).
  @action
  async importFromFileData(data: any): Promise<number> {
    if (!data || !Array.isArray(data.presets)) {
      throw new Error('올바른 캐릭터 프리셋 파일이 아닙니다');
    }
    let imported = 0;
    for (const raw of data.presets) {
      if (!raw || typeof raw !== 'object') continue;
      try {
        const json: any = JSON.parse(JSON.stringify(raw));
        const folder =
          typeof json.globalFolder === 'string' && json.globalFolder.trim()
            ? json.globalFolder.trim()
            : undefined;
        // 이미지 복원: 원본 filename → 새 글로벌 파일명 매핑 후 path 재지정
        const map = new Map<string, string>();
        for (const img of json.vibeImages || []) {
          if (!img?.filename || typeof img.data !== 'string') continue;
          try {
            map.set(
              String(img.filename).split('/').pop()!,
              await this.storeImageData(img.data),
            );
          } catch (e) {}
        }
        for (const img of json.referenceImages || []) {
          if (!img?.filename || typeof img.data !== 'string') continue;
          try {
            map.set(
              String(img.filename).split('/').pop()!,
              await this.storeImageData(img.data),
            );
          } catch (e) {}
        }
        for (const vibe of json.vibes || []) {
          vibe.path = map.get(String(vibe.path || '').split('/').pop()!) ?? '';
        }
        for (const ref of json.characterReferences || []) {
          ref.path = map.get(String(ref.path || '').split('/').pop()!) ?? '';
        }
        if (json.representativeImageData && json.representativeImage) {
          try {
            json.representativeImage = await this.storeImageData(
              json.representativeImageData,
            );
          } catch (e) {
            json.representativeImage = '';
          }
        } else {
          json.representativeImage = '';
        }
        delete json.vibeImages;
        delete json.referenceImages;
        delete json.representativeImageData;
        delete json.globalFolder;
        // 스키마 정규화(미지 필드 제거) + 글로벌 유래 링크 제거
        const clean: any = CharacterPreset.fromJSON(
          json as ICharacterPreset,
        ).toJSON();
        delete clean.fromGlobalId;
        delete clean.fromGlobalRev;
        const name = this.resolveNameCollision(
          (clean.name || '이름없음').trim() || '이름없음',
        );
        clean.name = name;
        const entry: IGlobalCharacterPresetEntry = {
          id: uuidv4(),
          name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          preset: clean as ICharacterPreset,
          ...(folder ? { folder } : {}),
        };
        if (folder && !this.folders.includes(folder)) {
          this.folders = [...this.folders, folder];
        }
        this.presets = [...this.presets, entry];
        imported++;
      } catch (e) {
        // 항목 단위 파손은 건너뛰고 나머지는 계속 불러온다
        console.error('글로벌 프리셋 항목 불러오기 실패:', e);
      }
    }
    if (imported > 0) {
      this.scheduleSave();
      this.dispatchEvent(new CustomEvent('changed', {}));
    }
    return imported;
  }

  // ---------- 편집기용 이미지 저장 (FileUploadBase64는 raw base64 제공) ----------
  async storeVibeForEditor(base64: string): Promise<string> {
    const filename = uuidv4() + '.png';
    await backend.writeDataFile(GLOBAL_CHAR_IMAGES_DIR + '/' + filename, base64);
    return filename;
  }

  async storeReferenceForEditor(base64: string): Promise<string> {
    // 글로벌 보관은 원본 유지; 실제 정규화/리사이즈는 프로젝트로 불러올 때 수행
    const filename = uuidv4() + '.png';
    await backend.writeDataFile(GLOBAL_CHAR_IMAGES_DIR + '/' + filename, base64);
    return filename;
  }

  private async copyImageToken(token: string): Promise<string> {
    const dataUri = await this.fetchImageData(token);
    if (!dataUri) return token;
    return await this.storeImageData(dataUri);
  }

  private collectImageTokens(preset: ICharacterPreset): string[] {
    const t: string[] = [];
    for (const v of preset.vibes || []) if (v.path) t.push(v.path);
    for (const r of preset.characterReferences || [])
      if (r.path) t.push(r.path);
    if (preset.representativeImage) t.push(preset.representativeImage);
    return t;
  }

  // ---------- 글로벌 직접 신규/수정/복제/정렬 ----------
  // 글로벌 모드 편집기에서 만든 프리셋(이미지 토큰이 이미 글로벌 디렉터리를 가리킴)을 등록
  @action
  async addPresetObject(
    preset: CharacterPreset,
  ): Promise<IGlobalCharacterPresetEntry> {
    const json: ICharacterPreset = preset.toJSON();
    const name = this.resolveNameCollision(
      (json.name || '이름없음').trim() || '이름없음',
    );
    json.name = name;
    // 글로벌 유래 링크는 새 글로벌 엔트리와 무관 — 제거
    delete json.fromGlobalId;
    delete json.fromGlobalRev;
    const entry: IGlobalCharacterPresetEntry = {
      id: uuidv4(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preset: json,
    };
    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  async updateEntry(id: string, preset: CharacterPreset): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    const oldTokens = new Set(this.collectImageTokens(entry.preset));
    const json: ICharacterPreset = preset.toJSON();
    let nm = (json.name || '이름없음').trim() || '이름없음';
    const other = this.getByName(nm);
    if (other && other.id !== id) nm = this.resolveNameCollision(nm);
    json.name = nm;
    const newTokens = new Set(this.collectImageTokens(json));
    entry.name = nm;
    entry.preset = json;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    // 더 이상 참조되지 않는 글로벌 이미지 정리
    for (const t of oldTokens) if (!newTokens.has(t)) await this.deleteImageData(t);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  async duplicateEntry(id: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) return;
    const json: ICharacterPreset = JSON.parse(JSON.stringify(entry.preset));
    for (const v of json.vibes || [])
      if (v.path) v.path = await this.copyImageToken(v.path);
    for (const r of json.characterReferences || [])
      if (r.path) r.path = await this.copyImageToken(r.path);
    if (json.representativeImage)
      json.representativeImage = await this.copyImageToken(
        json.representativeImage,
      );
    const name = this.resolveNameCollision((entry.name || '이름없음') + ' 복사본');
    json.name = name;
    const newEntry: IGlobalCharacterPresetEntry = {
      id: uuidv4(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preset: json,
    };
    const idx = this.presets.findIndex((p) => p.id === id);
    const arr = [...this.presets];
    arr.splice(idx < 0 ? arr.length : idx + 1, 0, newEntry);
    this.presets = arr;
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  reorder(from: number, to: number) {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= this.presets.length ||
      to >= this.presets.length
    )
      return;
    const arr = [...this.presets];
    const [m] = arr.splice(from, 1);
    arr.splice(to, 0, m);
    this.presets = arr;
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // ---------- write ----------
  @action
  async rename(id: string, newName: string) {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    newName = newName.trim();
    if (!newName) throw new Error('이름을 입력해 주세요');
    if (entry.name === newName) return;
    if (this.getByName(newName)) throw new Error('이미 존재하는 이름입니다');
    entry.name = newName;
    entry.preset.name = newName;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  async delete(id: string) {
    const entry = this.get(id);
    if (!entry) return;
    const imgs: string[] = [];
    for (const v of entry.preset.vibes || []) imgs.push(v.path);
    for (const r of entry.preset.characterReferences || []) imgs.push(r.path);
    if (entry.preset.representativeImage)
      imgs.push(entry.preset.representativeImage);
    for (const f of imgs) await this.deleteImageData(f);
    this.presets = this.presets.filter((p) => p.id !== id);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }
}
