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
  // 역직렬화 템플릿(dummy) 준비 프로미스. get()/createFrom() 이 이를 기다려
  // "생성자 직후 아직 dummy 가 없는" 부팅 직후 창에서의 실패(클릭 무반응)를 막는다.
  #dummyPromise: Promise<T> | null = null;
  // 이름별 로딩 중 프로미스. 같은 리소스를 동시에 get() 하면 한 번만 읽고
  // 인스턴스도 하나만 만든다(중복 인스턴스로 인한 편집 유실/reaction 누수 방지).
  #loading: Map<string, Promise<T | undefined>> = new Map();
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
    // 미리 준비를 시작하되, 실패해도 unhandled rejection 이 되지 않게 한다
    // (실패 시 ensureDummy 가 다음 호출에서 재시도).
    this.ensureDummy().catch(() => {});
  }

  // dummy 템플릿을 보장한다. 준비 전이면 기다리고, 이전 시도가 실패했으면 재시도.
  protected ensureDummy(): Promise<T> {
    if (this.dummy) return Promise.resolve(this.dummy);
    if (!this.#dummyPromise) {
      this.#dummyPromise = Promise.resolve(this.createDefault('dummy')).then(
        (d) => {
          this.dummy = d;
          return d;
        },
        (e) => {
          this.#dummyPromise = null; // 다음 호출에서 재시도
          throw e;
        },
      );
    }
    return this.#dummyPromise;
  }

  abstract createDefault(name: string): T | Promise<T>;
  abstract getHook(rc: T, name: string): Promise<void>;
  abstract migrate(rc: any): any | Promise<any>;

  async add(name: string) {
    if (name in this.resources) {
      throw new Error('Resource already exists');
    }
    const created = await this.createDefault(name);
    if (name in this.resources) {
      // createDefault(프리셋 시딩 등) 대기 중 다른 경로가 같은 이름을 등록한 경우
      throw new Error('Resource already exists');
    }
    this.resources[name] = created;
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
    const srcPath = this.getPath(oldName);
    // 이름이 바뀌어도 같은 폴더에 유지이므로 dest는 oldName을 newName으로만 교체
    const suffix = `/${oldName}.json`;
    const destPath = srcPath.endsWith(suffix)
      ? srcPath.slice(0, -suffix.length) + `/${newName}.json`
      : srcPath;
    
    this.resources[newName] = this.resources[oldName];
    delete this.resources[oldName];
    this.disposes[newName] = this.disposes[oldName];
    delete this.disposes[oldName];
    if (oldName in this.dirty) {
      this.dirty[newName] = this.dirty[oldName];
      delete this.dirty[oldName];
    }
    await this.guardInFlight([oldName, newName], async () => {
      await backend.renameFile(srcPath, destPath);
    });
    // 성공 후에만 folderMap 업데이트
    if (oldName in this.folderMap) {
      this.folderMap[newName] = this.folderMap[oldName];
      delete this.folderMap[oldName];
    }
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
    if (name in this.resources) {
      return this.resources[name];
    }
    // 동시 호출 디듀프: 이미 로딩 중이면 그 결과를 공유한다.
    // (둘 다 파일을 읽어 인스턴스를 2개 만들면, UI 가 붙잡은 쪽과 저장되는 쪽이
    // 갈라져 편집이 유실되고 mobx reaction 도 누수된다)
    const pending = this.#loading.get(name);
    if (pending) return pending;
    const load = (async (): Promise<T | undefined> => {
      try {
        let obj = await this.readResourceJSON(name);
        obj = await this.migrate(obj);
        obj = await this.fillEmptyPresetVars(obj);
        const dummy = await this.ensureDummy();
        // 로딩 중 add()/createFrom() 으로 이미 등록됐다면 그쪽 인스턴스를 존중
        if (!(name in this.resources)) {
          this.resources[name] = dummy.fromJSON(obj);
          await this.onAdded(name);
          this.dispatchEvent(
            new CustomEvent<{ name: string }>('fetched', { detail: { name } }),
          );
        }
        return this.resources[name];
      } catch (e: any) {
        console.error('get library error:', e);
        return undefined;
      } finally {
        this.#loading.delete(name);
      }
    })();
    this.#loading.set(name, load);
    return load;
  }

  // 메인 파일을 읽어 파싱한다. 메인이 손상/누락이면 .bak 백업에서 복구를 시도한다.
  // (.bak 은 손실 방지 가드가 위험한 쓰기를 막을 때 보존해 둔 직전 정상본)
  private async readResourceJSON(name: string): Promise<any> {
    const readAndParse = async (path: string) => {
      let str: string;
      try {
        str = await backend.readFile(path);
      } catch (readErr) {
        // folderMap이 아직 최신이 아닐 수 있음 → 목록 재스캔 후 재시도
        this.resourceList = await this.getList();
        str = await backend.readFile(this.getPath(name));
      }
      return JSON.parse(str);
    };
    try {
      return await readAndParse(this.getPath(name));
    } catch (mainErr) {
      // 메인 파일 손상/누락 → .bak 복구 시도
      try {
        const bak = await backend.readFile(this.getPath(name) + '.bak');
        const obj = JSON.parse(bak);
        console.warn(`[복구] "${name}" 메인 파일 로드 실패 → .bak 에서 복구`);
        return obj;
      } catch (bakErr) {
        throw mainErr;
      }
    }
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

  // 모든 리소스 저장이 거쳐 가는 단일 지점. 직렬화 → 손실 방지 가드 → 쓰기.
  // 하위 클래스는 guardResourceWrite 를 오버라이드해 위험한 쓰기를 막을 수 있다.
  // 반환: 'done' = 처리 완료(저장됨 또는 재시도 무의미) → dirty 해제,
  //       'retry' = 일시적 사유로 건너뜀(저장소 불안정 등) → dirty 유지하고 다음에 재시도.
  protected async writeResource(name: string): Promise<'done' | 'retry'> {
    const rc = this.resources[name];
    if (!rc) return 'done';
    let payload: string;
    try {
      // 직렬화 오류(손상된 리소스 등)가 다른 리소스 저장을 막지 않도록 분리
      payload = JSON.stringify(rc.toJSON());
    } catch (e) {
      console.error('writeResource 직렬화 실패:', name, e);
      return 'done'; // 재시도해도 동일 → dirty 해제(무한 재시도 방지)
    }
    let decision: 'ok' | 'skip' | 'skip-keep' = 'ok';
    try {
      decision = await this.guardResourceWrite(name, payload);
    } catch (e) {
      // 가드 자체의 오류는 정상 저장을 막지 않는다
      decision = 'ok';
    }
    // 'skip'      = 구조적 사유로 차단(드롭) → dirty 해제, 재시도 안 함(스핀 방지)
    // 'skip-keep' = 일시적 사유로 보류(저장소 불안정) → dirty 유지, 회복 시 재시도
    if (decision === 'skip') return 'done';
    if (decision === 'skip-keep') return 'retry';
    await backend.writeFile(this.getPath(name), payload);
    return 'done';
  }

  // 손실 방지 훅. 기본은 항상 허용. SessionService 가 오버라이드해
  // outs/inpaints 폴더(실제 씬 흔적)와 대조하여 위험한 쓰기를 막을 수 있다.
  protected async guardResourceWrite(
    _name: string,
    _payload: string,
  ): Promise<'ok' | 'skip' | 'skip-keep'> {
    return 'ok';
  }

  // dirty 리소스를 디스크에 저장한다(목록 재스캔 없음). in-flight 이름은 건너뛴다.
  protected async flush() {
    const names = Object.keys(this.dirty).filter(
      (name) => name in this.resources && !this._inFlight.has(name),
    );
    if (names.length === 0) return;
    const results = await Promise.allSettled(
      names.map((name) => this.writeResource(name)),
    );
    // 'retry'(저장소 불안정 등으로 건너뜀)는 dirty 유지 → 접근 회복 시 자동 재시도.
    // 그 외(저장 완료/in-flight 미포함)는 dirty 해제.
    names.forEach((name, i) => {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value === 'retry') return;
      delete this.dirty[name];
    });
  }

  // 강제 종료 위험 시점(모바일 백그라운드 진입 등)에 호출한다.
  // 주기 flush 는 dirty + 디바운스(updateInterval) 에 의존하므로, "직전 편집"이 아직
  // dirty 로 잡히기 전이라면 저장되지 않는다. 백그라운드에서 OS 에 강제 종료되면 그
  // 편집(예: 방금 만든 씬)이 통째로 유실된다. 이를 막기 위해 dirty/디바운스 상태와
  // 무관하게 메모리에 로드된 모든 리소스의 현재 상태를 즉시 저장한다.
  // (경로 변경 경쟁을 피하려고 in-flight 인 이름만 제외)
  async flushAllNow() {
    const names = Object.keys(this.resources).filter(
      (name) => !this._inFlight.has(name),
    );
    if (names.length === 0) return;
    const results = await Promise.allSettled(
      names.map((name) => this.writeResource(name)),
    );
    names.forEach((name, i) => {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value === 'retry') return;
      delete this.dirty[name];
    });
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
    await Promise.allSettled(
      Object.keys(this.resources).map((name) => this.writeResource(name)),
    );
  }

  async createFrom(name: string, value: any) {
    if (name in this.resources) {
      throw new Error('Resource already exists');
    }
    value = await this.migrate(value);
    const dummy = await this.ensureDummy();
    if (name in this.resources) {
      // migrate/dummy 대기 중 다른 경로가 같은 이름을 등록한 경우
      throw new Error('Resource already exists');
    }
    this.resources[name] = dummy.fromJSON(value);
    await this.onAdded(name);
    this.#markUpdated(name);
    await this.update();
  }

  async run() {
    // 리소스 디렉터리 보장(.keep 파일): 신규 설치 등으로 projects/ 가 없으면
    //  - PC: 첫 프로젝트 저장이 손실 방지 가드의 "디스크 목록 0개 = 저장소 불안정"
    //    판정에 걸려 보류되는데, 그 디렉터리를 만들 유일한 쓰기가 바로 그 보류된
    //    쓰기라 영영 저장되지 않는 교착이 된다.
    //  - 모바일: 없는 디렉터리의 목록 조회가 예외를 던져 아래 초기 스캔이 실패한다.
    // .keep 하나를 두면 디렉터리가 항상 존재하고 목록도 항상 1개 이상이라 두 문제가
    // 모두 사라진다. (점으로 시작하는 파일이라 목록 스캔/가드에서 무시됨)
    try {
      if (!(await backend.existFile(this.resourceDir + '/.keep'))) {
        await backend.writeFile(this.resourceDir + '/.keep', '');
      }
    } catch (e) {
      console.error('리소스 디렉터리 준비 실패:', e);
    }

    // 최초 1회 전체 스캔으로 목록을 로드한다.
    // 실패해도 루프는 반드시 시작해야 한다 — 여기서 죽으면 주기 자동 저장과
    // visibilitychange 강제 저장 훅이 아예 설치되지 않아 이후 편집이 통째로
    // 유실된다(특히 모바일 강제 종료 시). 스캔은 아래 루프가 재시도한다.
    let initialScanFailed = false;
    try {
      await this.update();
    } catch (e) {
      initialScanFailed = true;
      console.error('초기 리소스 목록 스캔 실패(주기 루프에서 재시도):', e);
    }

    // 가시성 변화 대응: 백그라운드 진입 시 즉시 저장(편집 유실 방지),
    // 복귀 시 재스캔. (모바일에서 백그라운드 중 강제 종료되어도 직전 편집을 보존)
    if (typeof document !== 'undefined' && !this.#visibilityWired) {
      this.#visibilityWired = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          // 백그라운드 진입 = 언제든 강제 종료될 수 있는 시점.
          // 디바운스로 아직 dirty 가 안 된 직전 편집까지 포함해 전체를 강제 저장한다.
          this.flushAllNow().catch(() => {});
        } else {
          this.update().catch(() => {});
        }
      });
    }

    // 초기 스캔이 실패했으면 첫 틱에서 바로 재스캔하도록 카운터를 당겨 둔다.
    let idleTicks = initialScanFailed ? 3 : 0;
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

  private async getListDir(
    dirPath: string,
    basePath: string,
    newMap: { [name: string]: string | null },
    names: string[],
    folderAcc: string[],
  ): Promise<void> {
    const entries = await backend.listFiles(dirPath);
    const stats = await backend.listFilesWithStats(dirPath);
    const fileSet = new Set(stats.map((s: any) => s.name));
    const subdirs = entries.filter(
      (e: string) => !fileSet.has(e) && !e.startsWith('.'),
    );

    for (const fname of fileSet) {
      if (!fname.endsWith('.json')) continue;
      const name = fname.substring(0, fname.length - 5);
      if (name in newMap) continue;
      newMap[name] = basePath || null;
      names.push(name);
    }

    for (const sub of subdirs) {
      const childPath = basePath ? basePath + '/' + sub : sub;
      folderAcc.push(childPath);
      try {
        await this.getListDir(dirPath + '/' + sub, childPath, newMap, names, folderAcc);
      } catch (e) {
        // inaccessible subdir — skip but still list as folder
      }
    }
  }

  private async getList() {
    const newMap: { [name: string]: string | null } = {};
    const names: string[] = [];
    const folderList: string[] = [];

    await this.getListDir(this.resourceDir, '', newMap, names, folderList);

    this.folderList = folderList;
    this.folderMap = newMap;
    return names;
  }

  private async fillEmptyPresetVars(obj: any) {
    let updated = false;

    if (obj.presets && typeof obj.presets === 'object') {
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
    }
    if (obj.presetShareds && typeof obj.presetShareds === 'object') {
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
    }

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
