import { backend } from '.';
import { persistService } from './PersistenceService';
import { sleep } from './util';
import { reaction } from 'mobx';

export interface Serealizable {
  fromJSON(json: any): any;
  toJSON(): any;
}

// ── 리소스 수명주기 상태 ──
// loading: 디스크에서 읽는 중 (load 프로미스 공유 — 동시 get() 디듀프)
// ready  : 메모리에 로드됨, 저장 가능
// busy   : 파일 경로가 바뀌는 작업(이름변경/이동/삭제) 진행 중 — 저장 금지
type ResourceState = 'loading' | 'ready' | 'busy';

interface ResourceEntry<T> {
  state: ResourceState;
  instance?: T; // ready/busy 에서 존재. busy 는 미로드 이름의 락일 수도 있어 없을 수 있음
  load?: Promise<T | undefined>; // loading 일 때의 공유 로드 프로미스
  dirty: boolean; // 저장 필요 여부
  // 변경 세대 카운터 — markDirty 마다 증가. flush 가 "쓰기 시작 시점의 세대"와
  // 비교해, 쓰기 도중 들어온 편집의 dirty 를 실수로 지우지 않게 한다.
  seq: number;
  dispose?: () => void; // 변경 감지 reaction 해제자
}

export abstract class ResourceSyncService<
  T extends Serealizable,
> extends EventTarget {
  // 리소스 수명주기의 단일 소스 — 이름당 레코드 하나.
  // (기존에 resources/dirty/disposes/_inFlight/#loading 다섯 곳에 흩어져 있던
  //  상태를 통합. "이 조합에서 안전한가" 를 매번 추론하던 문제를 상태 전이로 대체)
  protected entries: Map<string, ResourceEntry<T>> = new Map();
  resourceList: string[];
  folderList: string[];
  folderMap: { [name: string]: string | null };
  resourceDir: string;
  updateInterval: number;
  running: boolean;
  dummy: T | undefined;
  #visibilityWired = false;
  // 역직렬화 템플릿(dummy) 준비 프로미스. get()/createFrom() 이 이를 기다려
  // "생성자 직후 아직 dummy 가 없는" 부팅 직후 창에서의 실패(클릭 무반응)를 막는다.
  #dummyPromise: Promise<T> | null = null;
  constructor(resourceDir: string, interval: number) {
    super();
    this.resourceDir = resourceDir;
    this.resourceList = [];
    this.folderList = [];
    this.folderMap = {};
    this.updateInterval = interval;
    this.running = true;
    // 생성자에서는 IO/비동기 작업을 시작하지 않는다 — 준비는 init()(부트스트랩)에서.
  }

  // ── 상태 조회 API (외부/하위 클래스용) ──

  // 메모리에 로드된 인스턴스 (없으면 undefined — 로드는 하지 않음)
  getLoaded(name: string): T | undefined {
    return this.entries.get(name)?.instance;
  }

  isLoaded(name: string): boolean {
    return !!this.entries.get(name)?.instance;
  }

  loadedNames(): string[] {
    const names: string[] = [];
    for (const [n, e] of this.entries) if (e.instance) names.push(n);
    return names;
  }

  dirtyNames(): string[] {
    const names: string[] = [];
    for (const [n, e] of this.entries) if (e.dirty && e.instance) names.push(n);
    return names;
  }

  // 메모리 캐시 파기(디스크 무접촉) — 저장하지 않은 로컬 변이를 버리고, 다음 접근이
  // 디스크 최신본을 읽게 한다(읽기 전용 미러 진입/종료가 사용). busy(경로 변경 중)
  // 엔트리는 건드리지 않는다(경로 작업 무결성 우선 — 실패해도 다음 기회에 재로드).
  // 진행 중 flush 와의 경합은 안전: writeResource 는 쓰기 직전 entries 를 재확인해
  // 엔트리가 사라졌으면 쓰지 않는다.
  evict(name: string) {
    const e = this.entries.get(name);
    if (!e || e.state !== 'ready') return;
    e.dispose?.();
    this.entries.delete(name);
  }

  // 저장 필요 표시 — 외부(씬 큐 등)에서 세션을 직접 변경했을 때 호출한다.
  markDirty(name: string) {
    const e = this.entries.get(name);
    if (!e || !e.instance) return;
    e.dirty = true;
    e.seq++;
    this.dispatchEvent(
      new CustomEvent<{ name: string }>('updated', { detail: { name } }),
    );
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
    if (this.isLoaded(name)) {
      throw new Error('Resource already exists');
    }
    const created = await this.createDefault(name);
    if (this.isLoaded(name)) {
      // createDefault(프리셋 시딩 등) 대기 중 다른 경로가 같은 이름을 등록한 경우
      throw new Error('Resource already exists');
    }
    await this.attach(name, created);
    this.markDirty(name);
    await this.update();
  }

  list() {
    return this.resourceList;
  }

  // 인스턴스를 엔트리에 결합: 변경 감지 reaction 설치 + getHook.
  // (엔트리가 loading/busy 자리표시자였다면 그대로 인스턴스를 채운다)
  private async attach(name: string, instance: T) {
    let e = this.entries.get(name);
    if (!e) {
      e = { state: 'ready', dirty: false, seq: 0 };
      this.entries.set(name, e);
    }
    e.instance = instance;
    if (e.state === 'loading') e.state = 'ready';
    e.dispose = this.watch(name, instance);
    await this.getHook(instance, name);
    // 결합 완료 훅 — 기본 no-op. 신 배치(workspace) 활성 시 SessionService 가
    // 이 지점에서 물리 폴더 등록(id 발급·meta.json 기록)을 보장한다. 첫 디스크
    // 쓰기(markDirty→update→writeResource)보다 반드시 앞서 실행되어야 한다.
    await this.onAttached(name, instance);
  }

  // 결합 직후 훅(오버라이드용). 기본은 아무 것도 하지 않는다 — 비활성/타 서비스는
  // 기존 동작이 1바이트도 바뀌지 않는다.
  protected async onAttached(_name: string, _instance: T): Promise<void> {}

  // 리소스 변경 감지 → dirty 마킹 reaction 설치 (이름 기준 — rename 시 재설치 필요)
  // protected: SessionService 의 신 배치 이름변경이 reaction 을 재설치한다.
  protected watch(name: string, instance: T): () => void {
    return reaction(
      () => instance.toJSON(),
      () => {
        this.markDirty(name);
      },
      {
        delay: this.updateInterval,
      },
    );
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

  // 소프트 삭제 대상 경로(<본체>.json → <본체>.deleted). 신 배치는 파일명이
  // 'project.json' 이라 확장자 치환이 아닌 '.deleted' 접미가 필요하므로
  // SessionService 가 오버라이드한다. 기본(구 배치)은 기존 동작 그대로.
  protected deletedPathOf(src: string): string {
    return src.replace(/\.json$/, '.deleted');
  }

  listFolders(): string[] {
    return this.folderList.slice();
  }

  async delete(name: string) {
    const e = this.entries.get(name);
    if (!e?.instance) return;
    const src = this.getPath(name);
    await this.withLock([name], async () => {
      // busy 전환 전에 이미 큐에 들어간 이 파일의 쓰기를 먼저 소진
      // (rename 뒤에 잔여 쓰기가 파일을 되살리는 것을 방지)
      await persistService.flushPath(src).catch(() => {});
      // 파일 이동이 성공한 경우에만 메모리에서 제거 (실패 시 상태 불일치 방지)
      await backend.renameFile(src, this.deletedPathOf(src));
      e.dispose?.();
      this.entries.delete(name);
      delete this.folderMap[name];
    });
    await this.update();
  }

  async rename(oldName: string, newName: string) {
    const e = this.entries.get(oldName);
    if (!e?.instance) throw new Error('Resource not found');
    if (this.entries.get(newName)?.instance)
      throw new Error('Resource already exists');
    const srcPath = this.getPath(oldName);
    // 이름이 바뀌어도 같은 폴더에 유지이므로 dest는 oldName을 newName으로만 교체
    const suffix = `/${oldName}.json`;
    const destPath = srcPath.endsWith(suffix)
      ? srcPath.slice(0, -suffix.length) + `/${newName}.json`
      : srcPath;

    await this.withLock([oldName, newName], async () => {
      // busy 전환 전에 이미 큐에 들어간 옛 경로 쓰기를 먼저 소진
      await persistService.flushPath(srcPath).catch(() => {});
      await backend.renameFile(srcPath, destPath);
      // 파일 이동 성공 후에만 메모리 이동 — 락 안이라 그 사이 flush 가 끼지 않는다
      this.entries.delete(oldName);
      this.entries.set(newName, e);
      // 변경 감지 reaction 은 이름을 캡처하므로 새 이름으로 재설치
      // (종전에는 옛 이름으로 dirty 가 찍혀 rename 후 자동 저장이 되지 않았다)
      e.dispose?.();
      e.dispose = this.watch(newName, e.instance!);
      if (oldName in this.folderMap) {
        this.folderMap[newName] = this.folderMap[oldName];
        delete this.folderMap[oldName];
      }
    });
    await this.update();
  }

  getFast(name: string) {
    const rc = this.entries.get(name)?.instance;
    if (!rc) {
      void this.get(name);
    }
    return rc;
  }

  async get(name: string): Promise<T | undefined> {
    const existing = this.entries.get(name);
    if (existing?.instance) return existing.instance;
    // 동시 호출 디듀프: 이미 로딩 중이면 그 결과를 공유한다.
    // (둘 다 파일을 읽어 인스턴스를 2개 만들면, UI 가 붙잡은 쪽과 저장되는 쪽이
    // 갈라져 편집이 유실되고 mobx reaction 도 누수된다)
    if (existing?.load) return existing.load;
    const load = (async (): Promise<T | undefined> => {
      try {
        let obj = await this.readResourceJSON(name);
        obj = await this.migrate(obj);
        obj = await this.fillEmptyPresetVars(obj);
        const dummy = await this.ensureDummy();
        // 로딩 중 add()/createFrom() 으로 이미 등록됐다면 그쪽 인스턴스를 존중
        const cur = this.entries.get(name);
        if (cur?.instance) return cur.instance;
        const instance = dummy.fromJSON(obj);
        await this.attach(name, instance);
        this.dispatchEvent(
          new CustomEvent<{ name: string }>('fetched', { detail: { name } }),
        );
        return instance;
      } catch (e: any) {
        console.error('get library error:', e);
        return undefined;
      } finally {
        const cur = this.entries.get(name);
        if (cur) {
          cur.load = undefined;
          // 로드 실패로 인스턴스가 없으면 자리표시자 정리 (busy 락은 보존)
          if (!cur.instance && cur.state === 'loading') this.entries.delete(name);
        }
      }
    })();
    let e = this.entries.get(name);
    if (!e) {
      e = { state: 'loading', dirty: false, seq: 0 };
      this.entries.set(name, e);
    }
    e.load = load;
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

  // 이름별 락 체인 — 같은 이름의 withLock 을 도착 순서대로 직렬화한다.
  // (없으면 동시 진입 시 먼저 끝난 쪽이 busy 를 풀어, 아직 진행 중인 두 번째
  //  작업 도중에 flush 가 끼어드는 구멍이 생긴다)
  #lockChains: Map<string, Promise<void>> = new Map();

  // 주어진 이름들을 작업 동안 busy 상태로 전환해 주기 flush 와의 경쟁(경로가 바뀌는
  // 중에 잘못된 위치로 중복 저장되는 문제)을 차단한다.
  // 미로드 이름(폴더 이동 등으로 파일만 있는 프로젝트)도 잠글 수 있다 — 자리표시자
  // 엔트리를 만들고 작업이 끝나면 정리한다.
  async withLock<R>(names: string[], fn: () => Promise<R>): Promise<R> {
    // 상호배제: 같은 이름의 앞선 락이 모두 끝난 뒤에 진입한다.
    // (앞선 락 조회와 체인 등록 사이에 await 가 없어 원자적 — 교착 불가)
    const prevs = names
      .map((n) => this.#lockChains.get(n))
      .filter(Boolean) as Promise<void>[];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    for (const n of names) this.#lockChains.set(n, gate);
    try {
      await Promise.all(prevs);

      // 로딩 중인 이름은 로드가 끝난 뒤에 잠근다
      // (로드 완료 코드가 busy 상태를 ready 로 덮어써 락이 풀리는 것을 방지)
      for (const n of names) {
        const e = this.entries.get(n);
        if (e?.load) await e.load.catch(() => {});
      }
      const created: string[] = [];
      for (const n of names) {
        let e = this.entries.get(n);
        if (!e) {
          e = { state: 'busy', dirty: false, seq: 0 };
          this.entries.set(n, e);
          created.push(n);
        } else {
          e.state = 'busy';
        }
      }
      try {
        return await fn();
      } finally {
        for (const n of names) {
          const e = this.entries.get(n);
          if (!e) continue; // 작업 중 엔트리가 제거됨 (delete 등)
          if (!e.instance && created.includes(n)) this.entries.delete(n);
          else e.state = 'ready';
        }
      }
    } finally {
      release();
      for (const n of names) {
        if (this.#lockChains.get(n) === gate) this.#lockChains.delete(n);
      }
    }
  }

  // 모든 리소스 저장이 거쳐 가는 단일 지점. 직렬화 → 손실 방지 가드 → 쓰기.
  // 하위 클래스는 guardResourceWrite 를 오버라이드해 위험한 쓰기를 막을 수 있다.
  // 반환: 'done' = 처리 완료(저장됨 또는 재시도 무의미) → dirty 해제,
  //       'retry' = 일시적 사유로 건너뜀(저장소 불안정 등) → dirty 유지하고 다음에 재시도.
  protected async writeResource(name: string): Promise<'done' | 'retry'> {
    const rc = this.entries.get(name)?.instance;
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
    // 가드 대기(디렉터리 조회 — 길 수 있음) 동안 삭제/이름변경이 완료됐을 수 있다.
    // 쓰기 직전에 상태를 재확인하지 않으면 옛/루트 경로로 계산된 getPath 에 써서
    // "삭제한 프로젝트 부활 / 이름변경 시 옛 이름 중복 파일" 이 생긴다.
    const cur = this.entries.get(name);
    if (!cur || cur.instance !== rc) return 'done'; // 삭제/이름변경됨 — 쓰지 않음
    if (cur.state !== 'ready') return 'retry'; // 경로 변경 진행 중 — 다음에 재시도
    // 쓰기 파이프라인 경유 — 같은 파일에 대한 동시 저장(주기/가시성/종료 flush)이
    // 순서 보장 + 최신본 병합으로 처리된다.
    // (이 재확인과 write 의 큐 등록 사이엔 await 가 없어, 이후 시작되는 경로 변경은
    //  rename 직전의 persistService.flushPath 가 이 쓰기를 먼저 소진한다)
    await persistService.write(this.getPath(name), payload);
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

  // dirty 리소스를 디스크에 저장한다(목록 재스캔 없음). busy(경로 변경 중)는 건너뛴다.
  protected async flush() {
    const targets: { name: string; seq: number }[] = [];
    for (const [n, e] of this.entries) {
      if (e.dirty && e.instance && e.state === 'ready')
        targets.push({ name: n, seq: e.seq });
    }
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map((t) => this.writeResource(t.name)),
    );
    // 'retry'(저장소 불안정 등으로 건너뜀)는 dirty 유지 → 접근 회복 시 자동 재시도.
    // 그 외(저장 완료)는 dirty 해제 — 단, 쓰기 도중 새 편집이 들어왔으면(세대 증가)
    // dirty 를 유지해 그 편집이 다음 flush 에서 반드시 저장되게 한다.
    targets.forEach((t, i) => {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value === 'retry') return;
      const e = this.entries.get(t.name);
      if (e && e.seq === t.seq) e.dirty = false;
    });
  }

  // 강제 종료 위험 시점(모바일 백그라운드 진입 등)에 호출한다.
  // 주기 flush 는 dirty + 디바운스(updateInterval) 에 의존하므로, "직전 편집"이 아직
  // dirty 로 잡히기 전이라면 저장되지 않는다. 백그라운드에서 OS 에 강제 종료되면 그
  // 편집(예: 방금 만든 씬)이 통째로 유실된다. 이를 막기 위해 dirty/디바운스 상태와
  // 무관하게 메모리에 로드된 모든 리소스의 현재 상태를 즉시 저장한다.
  // (경로 변경 경쟁을 피하려고 in-flight 인 이름만 제외)
  async flushAllNow() {
    const targets: { name: string; seq: number }[] = [];
    for (const [n, e] of this.entries) {
      if (e.instance && e.state === 'ready')
        targets.push({ name: n, seq: e.seq });
    }
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map((t) => this.writeResource(t.name)),
    );
    targets.forEach((t, i) => {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value === 'retry') return;
      const e = this.entries.get(t.name);
      if (e && e.seq === t.seq) e.dirty = false;
    });
  }

  // flush + 목록 재스캔. 추가/삭제/이름변경/이동 등 목록이 바뀌는 작업이 호출한다.
  async update() {
    await this.flush();
    this.resourceList = await this.getList();
    this.dispatchEvent(new CustomEvent('listupdated', {}));
  }

  private hasPendingWrites(): boolean {
    for (const e of this.entries.values()) {
      if (e.dirty && e.instance && e.state === 'ready') return true;
    }
    return false;
  }

  private isHidden(): boolean {
    return typeof document !== 'undefined' && document.hidden === true;
  }

  async saveAll() {
    // busy(경로 변경 중)는 제외 — 옛 경로로 중복 저장되는 것을 막는다
    const names: string[] = [];
    for (const [n, e] of this.entries) {
      if (e.instance && e.state === 'ready') names.push(n);
    }
    await Promise.allSettled(names.map((name) => this.writeResource(name)));
  }

  async createFrom(name: string, value: any) {
    if (this.isLoaded(name)) {
      throw new Error('Resource already exists');
    }
    value = await this.migrate(value);
    const dummy = await this.ensureDummy();
    if (this.isLoaded(name)) {
      // migrate/dummy 대기 중 다른 경로가 같은 이름을 등록한 경우
      throw new Error('Resource already exists');
    }
    await this.attach(name, dummy.fromJSON(value));
    this.markDirty(name);
    await this.update();
  }

  // 초기 스캔 실패 여부 — runLoop 가 첫 틱에 바로 재스캔하도록 신호를 남긴다.
  #initialScanFailed = false;

  // ── 부팅 1회 초기화 (부트스트랩이 완료를 기다리는 구간) ──
  // 디렉터리 보장 + 역직렬화 템플릿 준비 + 초기 스캔 + 가시성 저장 훅.
  // 자동 저장 루프는 runLoop() 로 분리 — 부트스트랩이 init 완료 후 비차단으로 시작한다.
  async init() {
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

    // 역직렬화 템플릿 워밍업 (실패 시 get()/createFrom() 에서 재시도)
    await this.ensureDummy().catch(() => {});

    // 최초 1회 전체 스캔으로 목록을 로드한다.
    // 실패해도 부팅은 계속되어야 한다 — 여기서 죽으면 주기 자동 저장과
    // visibilitychange 강제 저장 훅이 아예 설치되지 않아 이후 편집이 통째로
    // 유실된다(특히 모바일 강제 종료 시). 스캔은 runLoop 가 재시도한다.
    try {
      await this.update();
    } catch (e) {
      this.#initialScanFailed = true;
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
  }

  // ── 주기 자동 저장 루프 (반환하지 않음 — 비차단으로 시작할 것) ──
  async runLoop() {
    // 초기 스캔이 실패했으면 첫 틱에서 바로 재스캔하도록 카운터를 당겨 둔다.
    let idleTicks = this.#initialScanFailed ? 3 : 0;
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

  // 호환용: init + 자동 저장 루프를 순서대로 실행 (단독 사용/테스트 시)
  async run() {
    await this.init();
    await this.runLoop();
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
    const { names, folderMap, folderList } = await this.scanResources();
    this.folderList = folderList;
    this.folderMap = folderMap;
    return names;
  }

  // 목록 스캔의 오버라이드 지점. 기본(구 배치)은 resourceDir 재귀 스캔 그대로 —
  // 비활성/타 서비스는 결과가 1바이트도 바뀌지 않는다. 신 배치(workspace) 활성
  // 시 SessionService 가 workspace/ 1단 + meta.json 스캔으로 대체한다. 스펙 §2.
  protected async scanResources(): Promise<{
    names: string[];
    folderMap: { [name: string]: string | null };
    folderList: string[];
  }> {
    const newMap: { [name: string]: string | null } = {};
    const names: string[] = [];
    const folderList: string[] = [];
    await this.getListDir(this.resourceDir, '', newMap, names, folderList);
    return { names, folderMap: newMap, folderList };
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
