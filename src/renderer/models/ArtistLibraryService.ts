import { observable, action } from 'mobx';
import { persistService } from './PersistenceService';
import { v4 as uuidv4 } from 'uuid';
import { backend } from '.';
import { imageExtFromBase64 } from './imageFormats';

// 작가 라이브러리 전역 데이터.
// 프로젝트(세션)와 무관하게 앱 루트의 artist_library.json + artist_library/ 폴더에 저장.
// 프로젝트/씬 타입을 건드리지 않으므로 구버전 앱과의 데이터 호환성에 영향 없음.
const ARTIST_LIBRARY_FILE = 'artist_library.json';
export const ARTIST_LIBRARY_DIR = 'artist_library';

export interface IArtistImage {
  id: string;
  path: string; // artist_library/<artistId>/<imageId>.png
}

export interface IArtistEntry {
  id: string;
  name: string;
  images: IArtistImage[]; // [0] = 대표 썸네일
  tags: string[]; // 자유 태그 (예: "#러프")
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

interface IArtistLibraryStore {
  version: 1;
  artists: IArtistEntry[];
  tagPresets: string[]; // 클릭 추가용 태그 프리셋 팔레트
}

export class ArtistLibraryService extends EventTarget {
  @observable accessor artists: IArtistEntry[] = [];
  @observable accessor tagPresets: string[] = [];
  @observable accessor loaded: boolean = false;
  private saveTimeout: any = null;

  // ---------- lifecycle ----------

  async load(): Promise<void> {
    try {
      const str = await backend.readFile(ARTIST_LIBRARY_FILE);
      try {
        const json = JSON.parse(str) as IArtistLibraryStore;
        this.artists = Array.isArray(json?.artists)
          ? json.artists.filter(
              (a) =>
                a &&
                typeof a.id === 'string' &&
                typeof a.name === 'string' &&
                Array.isArray(a.images) &&
                Array.isArray(a.tags),
            )
          : [];
        this.tagPresets = Array.isArray(json?.tagPresets)
          ? json.tagPresets.filter((t) => typeof t === 'string')
          : [];
      } catch (parseErr) {
        const corruptName = `${ARTIST_LIBRARY_FILE}.corrupt-${Date.now()}`;
        try {
          await backend.renameFile(ARTIST_LIBRARY_FILE, corruptName);
        } catch (e) {}
        this.artists = [];
        this.tagPresets = [];
      }
    } catch (e) {
      // 파일 없음 — 빈 상태로 시작
      this.artists = [];
      this.tagPresets = [];
    }
    this.loaded = true;
    this.dispatchEvent(new CustomEvent('loaded', {}));
  }

  async save(): Promise<void> {
    try {
      await this.writeStoreOrThrow();
    } catch (e) {
      console.error('Failed to save artist library:', e);
    }
  }

  private async writeStoreOrThrow(): Promise<void> {
    const store: IArtistLibraryStore = {
      version: 1,
      artists: this.artists,
      tagPresets: this.tagPresets,
    };
    const data = JSON.stringify(store);
    const tmp = ARTIST_LIBRARY_FILE + '.tmp';
    try {
      await persistService.write(tmp, data);
      await backend.renameFile(tmp, ARTIST_LIBRARY_FILE);
    } catch (e) {
      await persistService.write(ARTIST_LIBRARY_FILE, data);
    }
  }

  scheduleSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.save();
      this.saveTimeout = null;
    }, 1500);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.save();
  }

  // ---------- artists ----------

  getArtist(id: string): IArtistEntry | undefined {
    return this.artists.find((a) => a.id === id);
  }

  private normalizeArtistName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }

  private artistNameKey(name: string): string {
    return this.normalizeArtistName(name).toLowerCase();
  }

  findArtistByName(
    name: string,
    excludeId?: string,
  ): IArtistEntry | undefined {
    const key = this.artistNameKey(name);
    if (!key) return undefined;
    return this.artists
      .filter(
        (a) => a.id !== excludeId && this.artistNameKey(a.name) === key,
      )
      .sort((a, b) => a.createdAt - b.createdAt)[0];
  }

  getDuplicateArtistGroups(): IArtistEntry[][] {
    const groups = new Map<string, IArtistEntry[]>();
    for (const artist of this.artists) {
      const key = this.artistNameKey(artist.name);
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(artist);
      groups.set(key, group);
    }
    return Array.from(groups.values()).filter((group) => group.length > 1);
  }

  @action
  createArtist(name: string): IArtistEntry | undefined {
    name = this.normalizeArtistName(name);
    if (!name) return undefined;
    const existing = this.findArtistByName(name);
    if (existing) return existing;
    const entry: IArtistEntry = {
      id: uuidv4(),
      name,
      images: [],
      tags: [],
      favorite: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.artists = [...this.artists, entry];
    this.scheduleSave();
    return entry;
  }

  @action
  renameArtist(id: string, name: string): void {
    const a = this.getArtist(id);
    if (!a) return;
    name = this.normalizeArtistName(name);
    if (!name || a.name === name) return;
    if (this.findArtistByName(name, id)) return;
    a.name = name;
    a.updatedAt = Date.now();
    this.artists = [...this.artists];
    this.scheduleSave();
  }

  // 기존 동명 카드를 사용자가 명시적으로 요청했을 때만 일괄 병합한다.
  // 파일은 대상 폴더로 전부 복사하고 JSON 저장까지 성공한 뒤 원본 폴더를 지운다.
  @action
  async mergeDuplicateArtists(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ groups: number; mergedArtists: number; copiedImages: number }> {
    const groups = this.getDuplicateArtistGroups();
    if (groups.length === 0) {
      return { groups: 0, mergedArtists: 0, copiedImages: 0 };
    }

    const originalArtists = this.artists;
    let nextArtists = [...this.artists];
    const copiedPaths: string[] = [];
    const sourceDirs: string[] = [];
    let mergedArtists = 0;

    try {
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = [...groups[groupIndex]].sort(
          (a, b) =>
            (a.createdAt ?? Number.MAX_SAFE_INTEGER) -
            (b.createdAt ?? Number.MAX_SAFE_INTEGER),
        );
        const target = group[0];
        const sources = group.slice(1);
        const copiedImages: IArtistImage[] = [];

        for (const source of sources) {
          for (const image of source.images) {
            const imageId = uuidv4();
            const ext = image.path.split('.').pop() || 'png';
            const dest = `${ARTIST_LIBRARY_DIR}/${target.id}/${imageId}.${ext}`;
            await backend.copyFile(image.path, dest);
            copiedPaths.push(dest);
            copiedImages.push({ id: imageId, path: dest });
          }
          sourceDirs.push(`${ARTIST_LIBRARY_DIR}/${source.id}`);
        }

        const merged: IArtistEntry = {
          ...target,
          images: [...target.images, ...copiedImages],
          tags: Array.from(new Set(group.flatMap((a) => a.tags))),
          favorite: group.some((a) => a.favorite),
          createdAt: Math.min(
            ...group.map((a) => a.createdAt ?? Date.now()),
          ),
          updatedAt: Date.now(),
        };
        const sourceIds = new Set(sources.map((a) => a.id));
        nextArtists = nextArtists
          .filter((a) => !sourceIds.has(a.id))
          .map((a) => (a.id === target.id ? merged : a));
        mergedArtists += sources.length;
        onProgress?.(groupIndex + 1, groups.length);
      }

      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
      }
      this.artists = nextArtists;
      await this.writeStoreOrThrow();
    } catch (e) {
      this.artists = originalArtists;
      for (const path of copiedPaths) {
        try {
          await backend.deleteFile(path);
        } catch (cleanupError) {}
      }
      throw e;
    }

    for (const dir of sourceDirs) {
      try {
        await backend.deleteDir(dir);
      } catch (e) {}
    }

    return {
      groups: groups.length,
      mergedArtists,
      copiedImages: copiedPaths.length,
    };
  }

  @action
  async deleteArtist(id: string): Promise<void> {
    const a = this.getArtist(id);
    if (!a) return;
    this.artists = this.artists.filter((x) => x.id !== id);
    this.scheduleSave();
    try {
      await backend.deleteDir(ARTIST_LIBRARY_DIR + '/' + id);
    } catch (e) {}
  }

  @action
  toggleFavorite(id: string): void {
    const a = this.getArtist(id);
    if (!a) return;
    a.favorite = !a.favorite;
    a.updatedAt = Date.now();
    this.artists = [...this.artists];
    this.scheduleSave();
  }

  // ---------- images ----------

  // base64(원본 PNG 바이트) 첨부. 메타데이터 보존을 위해 그대로 저장.
  @action
  async addImage(id: string, base64: string): Promise<void> {
    const a = this.getArtist(id);
    if (!a) return;
    const imageId = uuidv4();
    const ext = imageExtFromBase64(base64);
    const path = ARTIST_LIBRARY_DIR + '/' + id + '/' + imageId + '.' + ext;
    try {
      await backend.writeDataFile(path, base64);
    } catch (e) {
      console.error('Failed to store artist image:', e);
      return;
    }
    a.images = [...a.images, { id: imageId, path }];
    a.updatedAt = Date.now();
    this.artists = [...this.artists];
    this.scheduleSave();
  }

  @action
  async removeImage(id: string, imageId: string): Promise<void> {
    const a = this.getArtist(id);
    if (!a) return;
    const img = a.images.find((i) => i.id === imageId);
    a.images = a.images.filter((i) => i.id !== imageId);
    a.updatedAt = Date.now();
    this.artists = [...this.artists];
    this.scheduleSave();
    if (img) {
      try {
        await backend.deleteFile(img.path);
      } catch (e) {}
    }
  }

  // 대표 썸네일 지정 — 해당 이미지를 맨 앞으로.
  @action
  setThumbnail(id: string, imageId: string): void {
    const a = this.getArtist(id);
    if (!a) return;
    const idx = a.images.findIndex((i) => i.id === imageId);
    if (idx <= 0) return;
    const img = a.images[idx];
    a.images = [img, ...a.images.filter((i) => i.id !== imageId)];
    a.updatedAt = Date.now();
    this.artists = [...this.artists];
    this.scheduleSave();
  }

  // ---------- tags ----------

  // 태그 정규화: 공백 제거, 앞에 # 보장.
  private normalizeTag(tag: string): string {
    tag = tag.trim().replace(/\s+/g, '');
    if (!tag) return '';
    return tag.startsWith('#') ? tag : '#' + tag;
  }

  @action
  addTag(id: string, tag: string): void {
    const a = this.getArtist(id);
    if (!a) return;
    const t = this.normalizeTag(tag);
    if (!t || a.tags.includes(t)) return;
    a.tags = [...a.tags, t];
    a.updatedAt = Date.now();
    this.artists = [...this.artists];
    this.scheduleSave();
  }

  @action
  removeTag(id: string, tag: string): void {
    const a = this.getArtist(id);
    if (!a) return;
    a.tags = a.tags.filter((t) => t !== tag);
    a.updatedAt = Date.now();
    this.artists = [...this.artists];
    this.scheduleSave();
  }

  // ---------- tag presets ----------

  @action
  addTagPreset(tag: string): void {
    const t = this.normalizeTag(tag);
    if (!t || this.tagPresets.includes(t)) return;
    this.tagPresets = [...this.tagPresets, t];
    this.scheduleSave();
  }

  @action
  removeTagPreset(tag: string): void {
    this.tagPresets = this.tagPresets.filter((t) => t !== tag);
    this.scheduleSave();
  }

  // ---------- 백업 / 복원 ----------

  // 백업 tar에 담을 엔트리(라이브러리 JSON + 모든 작가 이미지) 목록.
  async buildBackupEntries(): Promise<{ path: string; name: string }[]> {
    const entries: { path: string; name: string }[] = [
      { path: ARTIST_LIBRARY_FILE, name: 'artist_library.json' },
    ];
    for (const a of this.artists) {
      for (const img of a.images) {
        try {
          if (await backend.existFile(img.path)) {
            // img.path = 'artist_library/<id>/<imgId>.png' — 그대로 보존
            entries.push({ path: img.path, name: img.path });
          }
        } catch (e) {}
      }
    }
    return entries;
  }

  // 압축 해제된 백업 폴더에서 작가를 병합 복원. 이름 충돌은 policy에 따라 처리.
  @action
  async restoreFromBackupDir(
    root: string,
    policy: 'rename' | 'skip' | 'overwrite',
  ): Promise<{ added: number; skipped: number; overwritten: number }> {
    let store: any;
    try {
      store = JSON.parse(await backend.readFile(root + '/artist_library.json'));
    } catch (e) {
      throw new Error('백업에 작가 라이브러리 데이터가 없습니다');
    }
    // 태그 프리셋은 union 병합
    if (Array.isArray(store?.tagPresets)) {
      for (const t of store.tagPresets) {
        if (typeof t === 'string' && !this.tagPresets.includes(t)) {
          this.tagPresets = [...this.tagPresets, t];
        }
      }
    }
    const list = Array.isArray(store?.artists) ? store.artists : [];
    let added = 0;
    let skipped = 0;
    let overwritten = 0;
    for (const src of list) {
      if (!src || !src.name) continue;
      let name = src.name as string;
      const existing = this.artists.find((a) => a.name === name);
      if (existing) {
        if (policy === 'skip') {
          skipped++;
          continue;
        }
        if (policy === 'overwrite') {
          await this.deleteArtist(existing.id); // 엔트리 + 이미지 폴더 제거
          overwritten++;
        } else {
          let i = 2;
          while (this.artists.some((a) => a.name === name)) {
            name = `${src.name} (${i})`;
            i++;
          }
        }
      }
      // 이미지는 새 id 폴더로 복사
      const newId = uuidv4();
      const newImages: IArtistImage[] = [];
      const srcImages = Array.isArray(src.images) ? src.images : [];
      for (const img of srcImages) {
        if (!img || !img.path) continue;
        const srcPath = root + '/' + img.path;
        try {
          if (await backend.existFile(srcPath)) {
            const imgId = uuidv4();
            // 원본 확장자 보존(.png/.webp 등) — 고정 .png 로 복사하면 MIME 어긋남
            const srcExt = img.path.split('.').pop() || 'png';
            const dest =
              ARTIST_LIBRARY_DIR + '/' + newId + '/' + imgId + '.' + srcExt;
            await backend.copyFile(srcPath, dest);
            newImages.push({ id: imgId, path: dest });
          }
        } catch (e) {}
      }
      const entry: IArtistEntry = {
        id: newId,
        name,
        images: newImages,
        tags: Array.isArray(src.tags)
          ? src.tags.filter((t: any) => typeof t === 'string')
          : [],
        favorite: !!src.favorite,
        createdAt: src.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      this.artists = [...this.artists, entry];
      added++;
    }
    this.scheduleSave();
    return { added, skipped, overwritten };
  }

  // ---------- search ----------

  // 이름 또는 태그에 질의가 포함되는 작가만 반환.
  search(query: string): IArtistEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.artists;
    return this.artists.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
}
