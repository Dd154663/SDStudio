import { observable, action } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { backend } from '.';

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
    const store: IArtistLibraryStore = {
      version: 1,
      artists: this.artists,
      tagPresets: this.tagPresets,
    };
    const data = JSON.stringify(store);
    const tmp = ARTIST_LIBRARY_FILE + '.tmp';
    try {
      await backend.writeFile(tmp, data);
      await backend.renameFile(tmp, ARTIST_LIBRARY_FILE);
    } catch (e) {
      try {
        await backend.writeFile(ARTIST_LIBRARY_FILE, data);
      } catch (e2) {
        console.error('Failed to save artist library:', e2);
      }
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

  @action
  createArtist(name: string): IArtistEntry | undefined {
    name = name.trim();
    if (!name) return undefined;
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
    name = name.trim();
    if (!name || a.name === name) return;
    a.name = name;
    a.updatedAt = Date.now();
    this.artists = [...this.artists];
    this.scheduleSave();
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
    const path = ARTIST_LIBRARY_DIR + '/' + id + '/' + imageId + '.png';
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
