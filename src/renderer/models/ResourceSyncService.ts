import { backend } from '.';
import { sleep } from './util';
import { reaction } from 'mobx';

export interface Serealizable {
  fromJSON(json: any): any;
  toJSON(): any;
}

export abstract class ResourceSyncService<
  T extends Serealizable,
> extends EventTarget {
  resources: { [name: string]: T };
  dirty: { [name: string]: boolean };
  resourceList: string[];
  folderList: string[];
  folderMap: { [name: string]: string | null };
  disposes: { [name: string]: () => void };
  // 파일 이동/이름변경/삭제가 진행 중인 리소스 이름. 진행 중에는 주기 flush 가 해당
  // 이름을 건드리지 않아(경로가 바뀌는 중) 잘못된 위치로 중복 저장되는 경쟁을 막는다.
  _inFlight: Set<string>;
  resourceDir: string;
  updateInterval: number;
  running: boolean;
  dummy: T | undefined;
  #visibilityWired = false;
  constructor(resourceDir: string, interval: number) {
    super();
    this.resources = {};
    this.dirty = {};
    this.disposes = {};
    this._inFlight = new Set();
    this.resourceDir = resourceDir;
    this.resourceList = [];
    this.folderList = [];
    this.folderMap = {};
    this.updateInterval = interval;
    this.running = true;
    (async () => {
      this.dummy = await this.createDefault('dummy');
    })();
  }

  abstract createDefault(name: string): T | Promise<T>;
  abstract getHook(rc: T, name: string): Promise<void>;
  abstract migrate(rc: any): any | Promise<any>;

  async add(name: string) {
    if (name in this.resources) {
      throw new Error('Resource already exists');
    }
    this.resources[name] = await this.createDefault(name);
    await this.onAdded(name);
    this.#markUpdated(name);
    await this.update();
  }

  list() {
    return this.resourceList;
  }

  async onAdded(name: string) {
    const resource = this.resources[name];
    const dispose = reaction(
      () => resource.toJSON(),
      (_) => {
        this.#markUpdated(name);
      },
      {
        delay: this.updateInterval,
      },
    );
    this.disposes[name] = dispose;
    await this.getHook(this.resources[name], name);
  }

  getPath(name: string) {
    // 폴더에 속한 프로젝트는 projects/폴더/이름.json, 아니면 projects/이름.json
    const folder = this.folderMap[name];
    return folder
      ? this.resourceDir + '/' + folder + '/' + name + '.json'
      : this.resourceDir + '/' + name + '.json';
  }

  getFolderOf(name: string): string | null {
    return this.folderMap[name] ?? null;
  }

  listFolders(): string[] {
    return this.folderList.slice();
  }

  async delete(name: string) {
    if (name in this.resources) {
      const src = this.getPath(name);
      delete this.resources[name];
      this.disposes[name]();
      delete this.dirty[name];
      await this.guardInFlight([name], async () => {
        await backend.renameFile(src, src.replace(/\.json$/, '.deleted'));
        delete this.folderMap[name];
      });
      await this.update();
    }
  }

  async rename(oldName: string, newName: string) {
    if (!(oldName in this.resources)) throw new Error('Resource not found');
    if (newName in this.resources) throw new Error('Resource already exists');
    // 폴더값이 바뀌기 전에 원본 경로를 먼저 캡처한다.
    const srcPath = this.getPath(oldName);
    this.resources[newName] = this.resources[oldName];
    delete this.resources[oldName];
    this.disposes[newName] = this.disposes[oldName];
    delete this.disposes[oldName];
    if (oldName in this.dirty) {
      this.dirty[newName] = this.dirty[oldName];
      delete this.dirty[oldName];
    }
    // 이름이 바뀌어도 같은 폴더에 유지
    if (oldName in this.folderMap) {
      this.folderMap[newName] = this.folderMap[oldName];
      delete this.folderMap[oldName];
    }
    await this.guardInFlight([oldName, newName], async () => {
      await backend.renameFile(srcPath, this.getPath(newName));
    });
    await this.update();
  }

  getFast(name: string) {
    const rc = this.resources[name];
    if (!rc) {
      this.get(name);
    }
    return rc;
  }

  async get(name: string): Promise<T | undefined> {
    if (!(name in this.resources)) {
      try {
        let str: string;
        try {
          str = await backend.readFile(this.getPath(name));
        } catch (readErr) {
          // folderMap이 아직 최신이 아닐 수 있음 → 목록 재스캔 후 재시도
          this.resourceList = await this.getList();
          str = await backend.readFile(this.getPath(name));
        }
        let obj = JSON.parse(str);
        obj = await this.migrate(obj);
        obj = await this.fillEmptyPresetVars(obj);
        this.resources[name] = this.dummy!.fromJSON(obj);
        await this.onAdded(name);
        this.dispatchEvent(
          new CustomEvent<{ name: string }>('fetched', { detail: { name } }),
        );
      } catch (e: any) {
        console.error('get library error:', e);
        return undefined;
      }
    }
    return this.resources[name];
  }

  // 주어진 이름들을 작업 동안 in-flight 로 표시해 주기 flush 와의 경쟁(경로가 바뀌는
  // 중에 잘못된 위치로 중복 저장되는 문제)을 차단한다.
  protected async guardInFlight<R>(
    names: string[],
    fn: () => Promise<R>,
  ): Promise<R> {
    for (const n of names) this._inFlight.add(n);
    try {
      return await fn();
    } finally {
      for (const n of names) this._inFlight.delete(n);
    }
  }

  // dirty 리소스를 디스크에 저장한다(목록 재스캔 없음). in-flight 이름은 건너뛴다.
  protected async flush() {
    const names = Object.keys(this.dirty).filter(
      (name) => name in this.resources && !this._inFlight.has(name),
    );
    if (names.length === 0) return;
    const writes = names
      .map((name) => {
        const l = this.getFast(name);
        if (!l) return null;
        return backend.writeFile(
          this.getPath(name),
          JSON.stringify(l.toJSON()),
        );
      })
      .filter(Boolean);
    await Promise.allSettled(writes);
    // 실제로 저장한 이름만 dirty 해제 (in-flight 로 건너뛴 건 다음 기회에 저장).
    for (const name of names) delete this.dirty[name];
  }

  // flush + 목록 재스캔. 추가/삭제/이름변경/이동 등 목록이 바뀌는 작업이 호출한다.
  async update() {
    await this.flush();
    this.resourceList = await this.getList();
    this.dispatchEvent(new CustomEvent('listupdated', {}));
  }

  private hasPendingWrites(): boolean {
    return Object.keys(this.dirty).some(
      (name) => name in this.resources && !this._inFlight.has(name),
    );
  }

  private isHidden(): boolean {
    return typeof document !== 'undefined' && document.hidden === true;
  }

  async saveAll() {
    const writes = Object.keys(this.resources).map((name) => {
      const l = this.resources[name];
      return backend.writeFile(
        this.getPath(name),
        JSON.stringify(l.toJSON()),
      );
    });
    await Promise.allSettled(writes);
  }

  async createFrom(name: string, value: any) {
    if (name in this.resources) {
      throw new Error('Resource already exists');
    }
    value = await this.migrate(value);
    this.resources[name] = this.dummy!.fromJSON(value);
    await this.onAdded(name);
    this.#markUpdated(name);
    await this.update();
  }

  async run() {
    // 최초 1회 전체 스캔으로 목록을 로드한다.
    await this.update();

    // 가시성 변화 대응: 백그라운드 진입 시 즉시 저장(편집 유실 방지),
    // 복귀 시 재스캔. (모바일에서 백그라운드 중 강제 종료되어도 직전 편집을 보존)
    if (typeof document !== 'undefined' && !this.#visibilityWired) {
      this.#visibilityWired = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.flush().catch(() => {});
        } else {
          this.update().catch(() => {});
        }
      });
    }

    let idleTicks = 0;
    while (this.running) {
      await sleep(this.updateInterval);
      if (!this.running) break;
      // 백그라운드면 디스크 작업을 멈춰 배터리/IO 를 아낀다(가시성 기반).
      if (this.isHidden()) continue;
      try {
        if (this.hasPendingWrites()) {
          // 편집 자동저장은 즉시(재스캔 없이) 처리한다.
          await this.flush();
        }
        // 목록을 바꾸는 작업은 자체적으로 update() 를 호출하므로, 주기 재스캔은
        // 외부 변경 대비 안전망일 뿐 → 약 20초마다 1회만 수행(활동 기반 절감).
        if (++idleTicks >= 4) {
          idleTicks = 0;
          await this.update();
        }
      } catch (e) {}
    }
  }

  #markUpdated(name: string) {
    this.dirty[name] = true;
    this.dispatchEvent(
      new CustomEvent<{ name: string }>('updated', { detail: { name } }),
    );
  }

  private async getList() {
    // depth=1 스캔: 루트의 *.json = 미분류 프로젝트, 하위 폴더의 *.json = 폴더 소속.
    // listFiles(파일+디렉토리) - listFilesWithStats(파일만) = 폴더 목록.
    const entries = await backend.listFiles(this.resourceDir);
    const rootStats = await backend.listFilesWithStats(this.resourceDir);
    const rootFileSet = new Set(rootStats.map((s: any) => s.name));
    const dirs = entries.filter(
      (e: string) => !rootFileSet.has(e) && !e.startsWith('.'),
    );

    const newMap: { [name: string]: string | null } = {};
    const names: string[] = [];

    // 루트(미분류) 프로젝트
    for (const fname of rootFileSet) {
      if (!fname.endsWith('.json')) continue;
      const name = fname.substring(0, fname.length - 5);
      if (name in newMap) continue;
      newMap[name] = null;
      names.push(name);
    }

    // 폴더별 프로젝트
    for (const dir of dirs) {
      let stats: any[] = [];
      try {
        stats = await backend.listFilesWithStats(this.resourceDir + '/' + dir);
      } catch (e) {
        stats = [];
      }
      for (const s of stats) {
        if (!s.name.endsWith('.json')) continue;
        const name = s.name.substring(0, s.name.length - 5);
        if (name in newMap) continue; // 동명 충돌 시 루트 우선
        newMap[name] = dir;
        names.push(name);
      }
    }

    this.folderList = dirs.slice();
    this.folderMap = newMap;
    return names;
  }

  private async fillEmptyPresetVars(obj: any) {
    let updated = false;

    Object.entries(obj.presets).forEach(([key, value]: [string, any]) => {
      value = value as object[]
      switch (key) {
        case 'SDImageGen':
          for (const preset of value) {
            fillEmptyVar(preset, 'characterPrompts', []);
            fillEmptyVar(preset, 'useCoords', false);
            fillEmptyVar(preset, 'legacyPromptConditioning', false);
            fillEmptyVar(preset, 'varietyPlus', false);
            fillEmptyVar(preset, 'deliberateEulerAncestralBug', false);
          } break;
        case 'SDImageGenEasy':
          for (const preset of value) {
            fillEmptyVar(preset, 'useCoords', false);
            fillEmptyVar(preset, 'legacyPromptConditioning', false);
            fillEmptyVar(preset, 'varietyPlus', false);
            fillEmptyVar(preset, 'deliberateEulerAncestralBug', false);
          } break;
        case 'SDInpaint':
          for (const preset of value) {
            fillEmptyVar(preset, 'characterPrompts', []);
            fillEmptyVar(preset, 'useCoords', false);
            fillEmptyVar(preset, 'legacyPromptConditioning', false);
            fillEmptyVar(preset, 'varietyPlus', false);
            fillEmptyVar(preset, 'deliberateEulerAncestralBug', false);
          } break;
        case 'SDI2I':
          for (const preset of value) {
            fillEmptyVar(preset, 'characterPrompts', []);
            fillEmptyVar(preset, 'useCoords', false);
            fillEmptyVar(preset, 'legacyPromptConditioning', false);
            fillEmptyVar(preset, 'varietyPlus', false);
            fillEmptyVar(preset, 'deliberateEulerAncestralBug', false);
            fillEmptyVar(preset, 'characterReferences', []);
          } break;
      }
    });
    Object.entries(obj.presetShareds).forEach(([key, value]: [string, any]) => {
      switch (key) {
        case 'SDImageGen':
          fillEmptyVar(value, 'normalizeStrength', true);
          fillEmptyVar(value, 'characterReferences', []);
          break;
        case 'SDImageGenEasy':
          fillEmptyVar(value, 'characterPrompts', []);
          fillEmptyVar(value, 'normalizeStrength', true);
          fillEmptyVar(value, 'characterReferences', []);
          break;
        case 'SDInpaint':
      }
    });

    if (updated)
      await this.update();

    return obj;

    function fillEmptyVar(obj: any, varName: string, defaultValue: any) {
      if (!(varName in obj)) {
        obj[varName] = defaultValue;
        updated = true;
      }
    }
  }
}
