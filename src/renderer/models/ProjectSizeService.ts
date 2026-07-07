import { observable, makeObservable, runInAction } from 'mobx';
import { persistService } from './PersistenceService';
import { backend, sessionService } from '.';

export interface ProjectSizeEntry {
  bytes: number;
  at: number; // 계산 시각 (epoch ms)
}

const SIDECAR_PATH = 'project_sizes.json';

// 프로젝트 데이터가 저장되는 루트 디렉터리들
// (SessionService.buildSessionDeepEntries 가 백업에 포함하는 집합과 동일)
const IMAGE_DIR_PREFIXES = [
  'outs/',
  'inpaints/',
  'inpaint_orgs/',
  'inpaint_masks/',
  'vibes/',
  'references/',
];

/**
 * 프로젝트별 차지 용량 수동 계산 서비스
 *
 * - 자동 계산하지 않음(부하 방지). 설정 화면에서 사용자가 수동으로 트리거.
 * - 결과는 사이드카 project_sizes.json 에 저장되어 재시작 후에도 유지.
 * - 계산은 listFiles(파일+디렉토리) − listFilesWithStats(파일만) = 하위 폴더
 *   패턴(기존 폴더 탐지 방식)으로 디렉터리를 재귀 순회하며 파일 크기를 합산.
 */
export class ProjectSizeService {
  @observable accessor entries: Record<string, ProjectSizeEntry> = {};
  @observable accessor calculating: string[] = [];
  @observable accessor bulkProgress: { done: number; total: number } | undefined =
    undefined;

  private loaded = false;
  private bulkCancelled = false;

  constructor() {
    makeObservable(this);
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await backend.readFile(SIDECAR_PATH));
      if (raw && raw.entries) {
        runInAction(() => {
          this.entries = raw.entries;
        });
      }
    } catch (e) {
      // 파일 없음/파손 → 빈 캐시로 시작 (다시 계산하면 복구됨)
    }
    // 삭제·이름 변경된 프로젝트의 캐시 제거
    try {
      const names = new Set(sessionService.list());
      runInAction(() => {
        for (const k of Object.keys(this.entries)) {
          if (!names.has(k)) delete this.entries[k];
        }
      });
    } catch (e) {}
  }

  // 프로젝트 이름변경 시 용량 캐시 키 이관. 캐시는 재계산 가능하므로 실패해도
  // 무해하지만, 이관하지 않으면 재시작 전까지 옛 이름의 유령 항목이 남고
  // 새 이름은 "미계산"으로 표시된다. (ensureLoaded 의 prune 은 최초 로드
  // 1회뿐이라 로드 후 rename 은 스스로 정리되지 않음)
  async renameProject(oldName: string, newName: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.entries[oldName]) return;
    runInAction(() => {
      this.entries[newName] = this.entries[oldName];
      delete this.entries[oldName];
    });
    await this.save();
  }

  private async save(): Promise<void> {
    try {
      await persistService.write(
        SIDECAR_PATH,
        JSON.stringify({ version: 1, entries: this.entries }),
      );
    } catch (e) {
      console.error('프로젝트 용량 캐시 저장 실패:', e);
    }
  }

  private async dirSize(path: string): Promise<number> {
    let names: string[] = [];
    try {
      names = await backend.listFiles(path);
    } catch {
      return 0; // 디렉터리 없음
    }
    let stats: { name: string; size: number }[] = [];
    try {
      stats = await backend.listFilesWithStats(path);
    } catch {}
    let total = 0;
    const fileNames = new Set<string>();
    for (const s of stats) {
      fileNames.add(s.name);
      total += s.size || 0;
    }
    for (const n of names) {
      if (!fileNames.has(n)) {
        total += await this.dirSize(path + '/' + n);
      }
    }
    return total;
  }

  private async projectJsonSize(name: string): Promise<number> {
    try {
      const jsonPath = sessionService.getPath(name);
      const idx = jsonPath.lastIndexOf('/');
      const dir = jsonPath.substring(0, idx);
      const file = jsonPath.substring(idx + 1);
      const stats = await backend.listFilesWithStats(dir);
      return stats.find((s: any) => s.name === file)?.size ?? 0;
    } catch {
      return 0;
    }
  }

  async calculate(name: string): Promise<void> {
    if (this.calculating.includes(name)) return;
    runInAction(() => {
      this.calculating.push(name);
    });
    try {
      await this.ensureLoaded();
      const dirSums = await Promise.all(
        IMAGE_DIR_PREFIXES.map((p) => this.dirSize(p + name)),
      );
      const jsonSize = await this.projectJsonSize(name);
      const bytes = dirSums.reduce((a, b) => a + b, 0) + jsonSize;
      runInAction(() => {
        this.entries[name] = { bytes, at: Date.now() };
      });
      await this.save();
    } finally {
      runInAction(() => {
        this.calculating = this.calculating.filter((n) => n !== name);
      });
    }
  }

  async calculateAll(names: string[]): Promise<void> {
    if (this.bulkProgress) return;
    this.bulkCancelled = false;
    runInAction(() => {
      this.bulkProgress = { done: 0, total: names.length };
    });
    try {
      for (let i = 0; i < names.length; i++) {
        if (this.bulkCancelled) break;
        try {
          await this.calculate(names[i]);
        } catch (e) {
          console.error('프로젝트 용량 계산 실패:', names[i], e);
        }
        runInAction(() => {
          this.bulkProgress = { done: i + 1, total: names.length };
        });
      }
    } finally {
      runInAction(() => {
        this.bulkProgress = undefined;
      });
    }
  }

  cancelBulk(): void {
    this.bulkCancelled = true;
  }

  // 전체 백업(이미지 포함) 예상 용량(바이트). 백업 시작 전 경고용.
  // 모든 프로젝트의 이미지/데이터 디렉터리 + project.json + 글로벌 이미지
  // 디렉터리를 재귀 합산한다. (dirSize 재사용 — '저장 공간 관리'와 동일 로직)
  async estimateFullBackupBytes(names: string[]): Promise<number> {
    let total = 0;
    for (const name of names) {
      for (const p of IMAGE_DIR_PREFIXES) {
        total += await this.dirSize(p + name);
      }
      total += await this.projectJsonSize(name);
    }
    for (const g of ['global_vibes', 'global_char_images']) {
      total += await this.dirSize(g);
    }
    return total;
  }
}
