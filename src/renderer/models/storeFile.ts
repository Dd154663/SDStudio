// 글로벌 저장소 파일(데이터 루트 직하 JSON 한 개 — 글로벌 프리셋·글로벌 캐릭터 프리셋·프로젝트 템플릿·작가
// 라이브러리·전역 조각 등)의 로드 판정·저장·사본 회전 단일 출처(2026-11-17 묶음 1, 플랜
// guides/plans/2026-11-17-global-store-safety.md).
//
// 지키는 것: 저장소가 「스스로」 비워지지 않는다.
//  - 「없음」은 확실할 때만(existFile=false 이고 오류에 ENOENT 밖의 오류 코드가 없을 때). 읽기 실패는 짧게 재시도하고,
//    그래도 실패면 io-failed — 저장 전면 차단(빈 메모리 목록이 디스크를 덮지 않게). .bak 으로 자동 대체하지 않는다
//    (본 파일이 더 최신일 수 있다).
//  - 손상(파싱 실패·구조 불일치)은 본 파일을 `<파일>.corrupt-<시각>` 으로 보존한 뒤 .tmp → .bak1~3 → .bak 순으로 유효한
//    사본을 찾아 되살린다. 보존조차 못 하면 io-failed(덮어쓰기 금지).
//  - 본 파일이 없는데 유효한 .tmp 가 있으면(Android 저장 중 종료 — renameFile 이 대상 삭제 후 이름 변경) .tmp 로 되살린다.
//    Android 의 「없음」 판정은 약하므로(existFile 이 어떤 stat 실패에도 false) 사본으로 갈 때만 짧게 기다려 본 파일을 다시 보고,
//    되돌려 쓰기 직전에 본 파일 존재를 한 번 더 확인한다 — 보이거나 확인이 실패하면 쓰지 않는다(Android 보강 A).
//  - 세션(창)의 첫 저장 직전에 부팅 때 정상으로 읽은 본 파일 내용을 .bak1 로 남기고 .bak1→.bak2→.bak3 으로 민다(최대 3개,
//    삭제 없이 이름 변경·덮어쓰기만 — dataPathGuard 대상인 디렉터리 삭제와 무관). 읽은 내용이 항목 0개면 회전하지 않는다.
//  - 종료 저장(flush)은 바뀐 것(dirty·대기 중 저장)이 있을 때만.
// 파일 형식은 바꾸지 않는다(직렬화는 각 서비스가 종전 그대로 한다).
//
// backend 는 인자로 주입한다(테스트 = 메모리 목, 실제 = models/index 의 backend). 이 모듈은 UI·서비스를 import 하지 않는다 —
// 사용자 안내는 알림 허브(subscribeGlobalStoreNotices)로 내보내고 App.tsx 가 창/토스트로 띄운다.

export interface StoreFileBackend {
  readFile(path: string): Promise<string>;
  renameFile(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  existFile(path: string): Promise<boolean>;
}

export interface StoreFileDeps {
  /** 호출 시점의 backend(모듈 순환 import 를 피하려고 함수로 받는다) */
  backend: () => StoreFileBackend;
  /** 반복 저장 파일 쓰기 — 실제는 persistService.write(같은 경로 직렬화·병합 큐) */
  write: (path: string, data: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** 되살린 사본 종류 — 확인 순서 그대로 */
export type StoreRecoverySource = 'tmp' | 'bak1' | 'bak2' | 'bak3' | 'bak';
export const STORE_RECOVERY_ORDER: StoreRecoverySource[] = ['tmp', 'bak1', 'bak2', 'bak3', 'bak'];
/** 사본 회전 개수(.bak1~.bak3) */
export const STORE_BACKUP_COPIES = 3;
/** 읽기 재시도 간격(ms) — 시도 = 1 + 길이. 합계는 부팅이 눈에 띄게 늦어지지 않게 1초 안쪽 */
export const STORE_READ_RETRY_DELAYS_MS = [150, 400];
/** 본 파일 「없음」+ 유효한 사본이 있을 때, 사본으로 되살리기 전에 본 파일을 다시 보기까지 기다리는 시간(ms) — Android 보강 A */
export const STORE_MISSING_RECHECK_DELAY_MS = 300;
/** 저장 차단 토스트 최소 간격(ms) — 같은 저장소에서 연달아 거부돼도 한 번만 */
const BLOCKED_NOTICE_INTERVAL_MS = 3000;

/**
 * 여러 창 동기화 알림 키(backend.notifyGlobalStoreChanged / onGlobalStoreChanged 의 key). 저장 성공 뒤 보내고,
 * 받는 창은 bootstrap 수신부에서 그 저장소의 reloadExternal 을 부른다. 'global-character-presets' 는 종전 값 그대로.
 */
export const GLOBAL_STORE_SYNC_KEYS = {
  globalPresets: 'global-presets',
  globalCharacterPresets: 'global-character-presets',
  projectTemplates: 'project-templates',
  /** 씬 템플릿 지정 목록 templates.json(TemplateService, 2026-11-18 T4) */
  sceneTemplates: 'scene-templates',
} as const;

export function storeSidePath(file: string, source: StoreRecoverySource): string {
  return source === 'tmp' ? `${file}.tmp` : `${file}.${source}`;
}
export function storeBackupPath(file: string, n: number): string {
  return `${file}.bak${n}`;
}

/** parse 가 null 을 주거나 throw 하면 손상 */
export interface StoreFileJudgeSpec<T> {
  file: string;
  parse: (raw: string) => T | null;
}

export type StoreLoadResult<T> =
  | { kind: 'ok'; data: T; raw: string }
  | { kind: 'missing' }
  | {
      kind: 'recovered';
      data: T;
      raw: string;
      from: StoreRecoverySource;
      fromFile: string;
      /** 본 파일이 손상이었으면 보존한 이름(본 파일이 없었으면 undefined) */
      corruptName?: string;
    }
  | { kind: 'corrupt-empty'; corruptName: string }
  | { kind: 'io-failed'; error: unknown };

// ---------- 오류 판별 ----------

/**
 * 오류에서 errno 코드(EBUSY·EACCES…)를 꺼낸다. Electron IPC 는 Node 문구 「… Error: ENOENT: no such file …, open '<경로>'」를
 * 그대로 넘긴다 — 코드 바로 뒤의 콜론으로만 알아본다(경로 속 대문자 폴더 이름 「EDWARD」 등을 코드로 오인하지 않게).
 */
function errnoCodes(e: unknown): string[] {
  const codes: string[] = [];
  const code = (e as any)?.code;
  if (typeof code === 'string' && /^E[A-Z0-9]{2,}$/.test(code)) codes.push(code);
  const msg = String((e as any)?.message ?? e ?? '');
  for (const m of msg.matchAll(/(?:^|[\s(])(E[A-Z0-9]{2,}):/g)) codes.push(m[1]);
  return codes;
}

/** ENOENT 밖의 errno 코드가 실려 있으면 「없음」이 아니라 읽기 오류로 본다(잠김·권한 등) */
function hasNonMissingErrno(e: unknown): boolean {
  return errnoCodes(e).some((c) => c !== 'ENOENT');
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function tryParse<T>(parse: (raw: string) => T | null, raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try {
    return parse(raw);
  } catch {
    return null;
  }
}

type MainRead =
  | { status: 'read'; raw: string }
  | { status: 'missing' }
  | { status: 'failed'; error: unknown };

async function readMain(file: string, deps: StoreFileDeps): Promise<MainRead> {
  const backend = deps.backend();
  const sleep = deps.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt <= STORE_READ_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(STORE_READ_RETRY_DELAYS_MS[attempt - 1]);
    try {
      const raw = await backend.readFile(file);
      if (typeof raw === 'string') return { status: 'read', raw };
      lastError = new Error('읽은 내용이 문자열이 아닙니다');
    } catch (e) {
      lastError = e;
    }
    // 「없음」은 확실할 때만 — existFile 이 false 를 돌려주고 오류가 잠김·권한 같은 다른 오류가 아닐 때.
    // existFile 자체가 실패하면 판단 불가 → 재시도 → 끝내 io-failed.
    if (!hasNonMissingErrno(lastError)) {
      let exists: boolean | undefined;
      try {
        exists = await backend.existFile(file);
      } catch {
        exists = undefined;
      }
      if (exists === false) return { status: 'missing' };
    }
  }
  return { status: 'failed', error: lastError };
}

async function findValidCopy<T>(
  spec: StoreFileJudgeSpec<T>,
  deps: StoreFileDeps,
): Promise<{ data: T; raw: string; from: StoreRecoverySource; fromFile: string } | null> {
  const backend = deps.backend();
  for (const from of STORE_RECOVERY_ORDER) {
    const fromFile = storeSidePath(spec.file, from);
    let raw: string;
    try {
      raw = await backend.readFile(fromFile);
    } catch {
      continue;
    }
    const data = tryParse(spec.parse, raw);
    if (data !== null && data !== undefined) return { data, raw, from, fromFile };
  }
  return null;
}

/** 손상된 본 파일을 `.corrupt-<시각>` 으로 보존(이름 변경 → 실패하면 복사). 둘 다 실패면 null */
async function preserveCorrupt(file: string, deps: StoreFileDeps): Promise<string | null> {
  const backend = deps.backend();
  const corruptName = `${file}.corrupt-${(deps.now ?? Date.now)()}`;
  try {
    await backend.renameFile(file, corruptName);
    return corruptName;
  } catch {
    /* 이름 변경 실패 — 복사로 보존 시도 */
  }
  try {
    await backend.copyFile(file, corruptName);
    return corruptName;
  } catch {
    return null;
  }
}

/**
 * 로드 판정(상태 없음). 손상이면 본 파일을 보존하는 부수 효과만 있고, 복구한 내용을 본 파일에 쓰지는 않는다
 * (그건 StoreFile.load 의 몫 — 세션 상태와 함께 다룬다).
 */
export async function judgeStoreFile<T>(
  spec: StoreFileJudgeSpec<T>,
  deps: StoreFileDeps,
): Promise<StoreLoadResult<T>> {
  let main = await readMain(spec.file, deps);
  if (main.status === 'failed') return { kind: 'io-failed', error: main.error };
  if (main.status === 'missing') {
    const copy = await findValidCopy(spec, deps);
    if (!copy) return { kind: 'missing' }; // 신규 — 사본이 없으면 기다리지 않는다
    // 사본으로 되살리기 직전 재확인(Android 보강 A) — Android 의 existFile 은 stat 이 어떤 이유로 실패해도 false 를 주고
    // 오류에 errno 도 없어 「없음」 판정이 약하다. 오래된 사본이 최신 본 파일을 덮지 않게 짧게 기다린 뒤 한 번 더 본다.
    await (deps.sleep ?? defaultSleep)(STORE_MISSING_RECHECK_DELAY_MS);
    main = await readMain(spec.file, deps);
    if (main.status === 'failed') return { kind: 'io-failed', error: main.error };
    if (main.status === 'missing') return { kind: 'recovered', ...copy };
    // 다시 읽혔다 — 아래 정상(ok)·손상 경로로
  }
  const data = tryParse(spec.parse, main.raw);
  if (data !== null && data !== undefined) return { kind: 'ok', data, raw: main.raw };
  // 손상 — 먼저 보존(못 하면 덮어쓰지 않도록 io-failed)
  const corruptName = await preserveCorrupt(spec.file, deps);
  if (!corruptName) {
    return { kind: 'io-failed', error: new Error('손상된 파일을 보존하지 못했습니다') };
  }
  const copy = await findValidCopy(spec, deps);
  return copy ? { kind: 'recovered', ...copy, corruptName } : { kind: 'corrupt-empty', corruptName };
}

// ---------- 알림 허브 ----------

export type GlobalStoreNotice =
  | { type: 'load-failed'; label: string; file: string }
  | { type: 'recovered'; label: string; file: string; fromFile: string; corruptName?: string }
  | { type: 'corrupt-empty'; label: string; file: string; corruptName: string }
  | { type: 'write-blocked'; label: string; file: string }
  | { type: 'write-conflict'; label: string; file: string };

/** 사용자 안내 문구 단일 출처 */
export const GLOBAL_STORE_TEXT = {
  loadFailed: (label: string) =>
    `${label} 파일을 읽지 못했습니다.\n기존 데이터를 지키기 위해 지금은 저장하거나 바꿀 수 없습니다.\n\n앱을 다시 시작해 주세요. 계속되면 파일이 다른 프로그램에 잠겨 있지 않은지, 저장 경로에 접근할 수 있는지 확인해 주세요.`,
  writeBlocked: (label: string) =>
    `${label} 파일을 읽지 못해 지금은 바꿀 수 없습니다. 앱을 다시 시작해 주세요.`,
  writeConflict: (label: string) =>
    `${label} 파일이 이 창이 시작된 뒤에 새로 생겼습니다(다른 창 등).\n덮어쓰지 않도록 지금은 저장하지 않습니다.\n\n앱을 다시 시작해 주세요.`,
  recovered: (label: string, fromFile: string, corruptName?: string) =>
    `${label} 파일이 ${corruptName ? '손상되어' : '없어서'} 직전 사본(${fromFile})에서 되살렸습니다.\n최근 변경 일부가 빠졌을 수 있습니다.` +
    (corruptName ? `\n\n손상된 파일은 ${corruptName} 로 보관했습니다.` : ''),
  corruptEmpty: (label: string, corruptName: string) =>
    `${label} 파일이 손상되었고 되살릴 사본이 없어 빈 목록으로 시작합니다.\n\n손상된 파일은 ${corruptName} 로 보관했습니다.`,
  /** 관리 창 본문 — 읽기 실패·쓰기 충돌로 막혀 목록을 믿을 수 없을 때(「없습니다」 대신) */
  listUnavailable: (label: string) =>
    `${label} 파일을 읽지 못해 목록을 표시할 수 없습니다.\n기존 데이터를 지키기 위해 지금은 만들거나 바꿀 수 없습니다.\n\n[다시 읽기]로 다시 시도하거나 앱을 다시 시작해 주세요.`,
  reloadAction: '다시 읽기',
} as const;

/** 알림 → 표시 문구·방식(창 = 확인 창 1회, 토스트 = 조작 거부 안내) */
export function globalStoreNoticeView(n: GlobalStoreNotice): { text: string; as: 'dialog' | 'toast' } {
  switch (n.type) {
    case 'load-failed':
      return { text: GLOBAL_STORE_TEXT.loadFailed(n.label), as: 'dialog' };
    case 'recovered':
      return { text: GLOBAL_STORE_TEXT.recovered(n.label, n.fromFile, n.corruptName), as: 'dialog' };
    case 'corrupt-empty':
      return { text: GLOBAL_STORE_TEXT.corruptEmpty(n.label, n.corruptName), as: 'dialog' };
    case 'write-conflict':
      return { text: GLOBAL_STORE_TEXT.writeConflict(n.label), as: 'dialog' };
    case 'write-blocked':
      return { text: GLOBAL_STORE_TEXT.writeBlocked(n.label), as: 'toast' };
  }
}

type NoticeListener = (n: GlobalStoreNotice) => void;
const noticeListeners = new Set<NoticeListener>();
// 구독자가 생기기 전(부팅 로드가 App 마운트보다 빠를 때)의 알림은 모아 두었다가 첫 구독 때 넘긴다
const pendingNotices: GlobalStoreNotice[] = [];

export function emitGlobalStoreNotice(n: GlobalStoreNotice): void {
  if (noticeListeners.size === 0) {
    pendingNotices.push(n);
    return;
  }
  for (const fn of Array.from(noticeListeners)) {
    try {
      fn(n);
    } catch (e) {
      console.error('글로벌 저장소 알림 표시 실패:', e);
    }
  }
}

export function subscribeGlobalStoreNotices(fn: NoticeListener): () => void {
  noticeListeners.add(fn);
  const queued = pendingNotices.splice(0, pendingNotices.length);
  for (const n of queued) {
    try {
      fn(n);
    } catch (e) {
      console.error('글로벌 저장소 알림 표시 실패:', e);
    }
  }
  return () => {
    noticeListeners.delete(fn);
  };
}

/** 저장 차단 상태에서 변경 조작을 거부할 때 던진다(message = 사용자 안내 문구) */
export class GlobalStoreBlockedError extends Error {
  constructor(label: string) {
    super(GLOBAL_STORE_TEXT.writeBlocked(label));
    this.name = 'GlobalStoreBlockedError';
  }
}

// ---------- 세션 상태를 가진 저장소 파일 ----------

export interface StoreFileSpec<T> extends StoreFileJudgeSpec<T> {
  /** 사용자 안내용 이름(「글로벌 프리셋」 등) */
  label: string;
  /** 회전 여부 판단용 항목 수 — 0 이면 그 내용으로 .bak1 을 만들지 않는다 */
  countItems: (data: T) => number;
  /** 저장 시점의 메모리 상태 → 파일 내용(종전 형식 그대로) */
  serialize: () => string;
  /** 디바운스 저장 지연(ms) */
  saveDelayMs: number;
  /** 저장 성공 뒤 1회(예: 다른 창 알림) */
  afterWrite?: () => void;
}

/** load 결과 + keepMemory(true = 재로드 실패·없음 — 이미 메모리에 있는 정상 목록을 버리지 말 것) */
export type StoreLoadOutcome<T> = StoreLoadResult<T> & { keepMemory: boolean };

/**
 * 다른 창 저장 알림으로 다시 읽을 때 서비스가 메모리에 반영하는 방법(둘 다 동기 — 저장 줄(chain) 안에서 불린다).
 * raw = 방금 읽은 본 파일 원문(글로벌 프리셋 v1 통합 이관 판단·백업용).
 */
export interface StoreExternalHandlers<T> {
  /** 이 창에 저장 안 된 변경이 없다 — 디스크 내용으로 교체 */
  replace(remote: T, raw: string): void;
  /** 저장 안 된 변경이 있다 — base(공통 조상, null = 빈 목록)·remote 로 항목 단위 병합해 메모리에 반영. 저장 예약은 StoreFile 이 한다 */
  merge(remote: T, base: T | null, raw: string): void;
}

/**
 * skipped = 아직 읽지 않았거나 읽기 실패로 막힌 상태(종전 재시도 경로에 맡김) · unchanged = 기준과 같은 내용 ·
 * replaced/merged = 반영함 · kept = 다시 읽기 실패·본 파일 없음·손상 — 메모리 유지
 */
export type StoreExternalReloadResult = 'skipped' | 'unchanged' | 'replaced' | 'merged' | 'kept';

type SessionStatus = 'unloaded' | 'ok' | 'missing' | 'blocked';

export class StoreFile<T> {
  private status: SessionStatus = 'unloaded';
  /** 이 세션에서 한 번이라도 판정이 성공(ok·missing·recovered·corrupt-empty)했는가 — 재로드 실패 시 메모리 유지 근거 */
  private hadGoodLoad = false;
  /** 첫 저장 직전에 .bak1 로 남길 내용(부팅 때 정상으로 읽은 본 파일) */
  private rotateRaw: string | null = null;
  private rotated = false;
  /**
   * 여러 창 병합의 기준(base) — 이 창이 본 파일에서 마지막으로 읽었거나 본 파일에 쓴 원문. null = 빈 목록(신규·손상 빈 시작).
   * 평소엔 문자열 하나만 들고, 파싱은 병합이 필요할 때만 한다.
   */
  private baseRaw: string | null = null;
  private changeSeq = 0;
  private savedSeq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // 로드·저장을 한 줄로 세운다(저장 중 재로드, 연달은 저장의 tmp→rename 끼어들기 방지)
  private chain: Promise<unknown> = Promise.resolve();
  private lastBlockedNoticeAt = -Infinity;

  constructor(
    private readonly spec: StoreFileSpec<T>,
    private readonly deps: StoreFileDeps,
  ) {}

  /** 읽기 실패로 저장이 막힌 상태(변경 조작 거부 대상) */
  get loadFailed(): boolean {
    return this.status === 'blocked';
  }

  /** 저장되지 않은 변경이 있는가 */
  get dirty(): boolean {
    return this.changeSeq !== this.savedSeq;
  }

  private enqueue<R>(job: () => Promise<R>): Promise<R> {
    const run = this.chain.then(job, job);
    this.chain = run.catch(() => {});
    return run;
  }

  load(): Promise<StoreLoadOutcome<T>> {
    return this.enqueue(() => this.doLoad());
  }

  private async doLoad(): Promise<StoreLoadOutcome<T>> {
    const wasGood = this.hadGoodLoad;
    const res = await judgeStoreFile(this.spec, this.deps);
    const { label, file } = this.spec;
    switch (res.kind) {
      case 'io-failed': {
        if (wasGood) {
          // 재로드 실패 — 메모리의 정상 목록을 유지하고 저장도 막지 않는다
          console.error(`${label} 다시 읽기 실패(기존 목록 유지):`, res.error);
          return { ...res, keepMemory: true };
        }
        const first = this.status !== 'blocked';
        this.status = 'blocked';
        console.error(`${label} 읽기 실패 — 저장 차단:`, res.error);
        if (first) emitGlobalStoreNotice({ type: 'load-failed', label, file });
        return { ...res, keepMemory: false };
      }
      case 'missing': {
        if (wasGood) return { ...res, keepMemory: true };
        this.status = 'missing';
        this.hadGoodLoad = true;
        this.rotateRaw = null;
        this.baseRaw = null;
        return { ...res, keepMemory: false };
      }
      case 'ok': {
        this.status = 'ok';
        this.hadGoodLoad = true;
        this.rotateRaw = this.spec.countItems(res.data) > 0 ? res.raw : null;
        this.baseRaw = res.raw;
        return { ...res, keepMemory: false };
      }
      case 'recovered': {
        // 본 파일이 「없음」이었던 쪽(손상본 보존이 아닌 쪽)은 되돌려 쓰기 직전에 존재를 한 번 더 확인한다(Android 보강 A).
        // 있거나 확인 자체가 실패하면 쓰지 않는다 — 오판이면 사본이 최신 본 파일을 덮게 된다.
        if (!res.corruptName) {
          let exists: boolean;
          try {
            exists = await this.deps.backend().existFile(file);
          } catch {
            exists = true;
          }
          if (exists) {
            const error = new Error('사본으로 되살리기 직전에 본 파일이 다시 확인되어 쓰지 않았습니다');
            if (wasGood) {
              console.error(`${label} 다시 읽기 판정 불확실(기존 목록 유지):`, error);
              return { kind: 'io-failed', error, keepMemory: true };
            }
            const first = this.status !== 'blocked';
            this.status = 'blocked';
            console.error(`${label} 읽기 판정 불확실 — 저장 차단:`, error);
            if (first) emitGlobalStoreNotice({ type: 'load-failed', label, file });
            return { kind: 'io-failed', error, keepMemory: false };
          }
        }
        // 되살린 내용을 본 파일에 바로 되돌려 둔다(Android 는 종료 저장이 없어 다음 부팅까지 본 파일이 빈다).
        // 본 파일은 손상본이 보존됐거나 원래 없었으므로 이 쓰기로 잃는 것이 없다.
        if (!(await this.writeAtomic(res.raw))) {
          console.error(`${label} 복구 내용을 본 파일에 쓰지 못했습니다(메모리는 복구됨)`);
          this.changeSeq++; // 다음 저장·종료 저장이 다시 쓰게
        }
        this.status = 'ok';
        this.hadGoodLoad = true;
        this.baseRaw = res.raw;
        // .bakN 에서 되살렸으면 그 사본이 이미 남아 있으므로 회전하지 않는다(같은 내용으로 오래된 사본을 밀어내지 않게)
        this.rotateRaw =
          (res.from === 'tmp' || res.from === 'bak') && this.spec.countItems(res.data) > 0
            ? res.raw
            : null;
        emitGlobalStoreNotice({
          type: 'recovered',
          label,
          file,
          fromFile: res.fromFile,
          corruptName: res.corruptName,
        });
        return { ...res, keepMemory: false };
      }
      case 'corrupt-empty': {
        emitGlobalStoreNotice({ type: 'corrupt-empty', label, file, corruptName: res.corruptName });
        if (wasGood) {
          // 재로드 중 손상 발견 — 메모리의 정상 목록을 버리지 않고, 다음 저장이 본 파일을 다시 쓰게 한다
          this.changeSeq++;
          return { ...res, keepMemory: true };
        }
        this.status = 'ok';
        this.hadGoodLoad = true;
        this.rotateRaw = null;
        this.baseRaw = null;
        return { ...res, keepMemory: false };
      }
    }
  }

  /**
   * 다른 창이 이 저장소를 저장했다는 알림으로 다시 읽는다(데스크톱 여러 창). 디스크에는 쓰지 않는다 — 병합했을 때만 저장을
   * 예약해 병합 결과가 나가게 한다(알림 왕복 방지: 교체만 한 창은 쓰지 않으므로 다시 알리지 않는다).
   *  - 아직 읽지 않았거나(unloaded) 읽기 실패로 막혔으면(blocked) 아무것도 하지 않는다 — 종전 재시도 경로에 맡긴다.
   *  - 다시 읽기 실패·본 파일 없음·사본 복구 상황이면 메모리를 그대로 둔다(쓰지 않음).
   *  - 본 파일이 손상이면(판정이 손상본을 보존해 둠) 메모리를 그대로 두고 저장을 예약해 메모리 내용으로 다시 쓰게 한다.
   *  - 정상으로 읽히면: 기준과 같으면 무동작, 저장 안 된 변경이 없으면 교체, 있으면 병합 + 저장 예약.
   * 신규(missing) 상태였던 창도 여기서 파일을 읽으면 정상 상태가 되어, 다음 저장이 「쓰기 충돌 차단」에 걸리지 않는다.
   */
  reloadExternal(handlers: StoreExternalHandlers<T>): Promise<StoreExternalReloadResult> {
    return this.enqueue(() => this.doReloadExternal(handlers));
  }

  private async doReloadExternal(h: StoreExternalHandlers<T>): Promise<StoreExternalReloadResult> {
    if (this.status === 'unloaded' || this.status === 'blocked') return 'skipped';
    const { label } = this.spec;
    const res = await judgeStoreFile(this.spec, this.deps);
    if (res.kind !== 'ok') {
      if (res.kind === 'corrupt-empty' || (res.kind === 'recovered' && res.corruptName)) {
        console.error(`${label} 다른 창 저장 뒤 다시 읽기에서 손상 발견(손상본 보존, 이 창 목록으로 다시 씀)`);
        this.schedule();
      } else if (res.kind === 'io-failed') {
        console.error(`${label} 다른 창 저장 뒤 다시 읽기 실패(기존 목록 유지):`, res.error);
      }
      return 'kept';
    }
    // 판정의 await 뒤에 확인한다 — 아래 반영까지 동기라 그 사이에 편집이 끼어들지 않는다
    const pending = this.dirty || this.timer !== null;
    if (this.status === 'ok' && res.raw === this.baseRaw) return 'unchanged';
    // 아직 첫 저장 전이면, 그 저장이 덮을 내용(방금 읽은 최신본)을 .bak1 후보로
    if (!this.rotated && this.spec.countItems(res.data) > 0) this.rotateRaw = res.raw;
    if (!pending) {
      h.replace(res.data, res.raw);
      this.baseRaw = res.raw;
      this.status = 'ok';
      return 'replaced';
    }
    const base = this.baseRaw === null ? null : tryParse(this.spec.parse, this.baseRaw);
    h.merge(res.data, base ?? null, res.raw);
    this.baseRaw = res.raw;
    this.status = 'ok';
    this.schedule(); // 병합 결과를 저장(저장소를 바꾸는 경로는 반드시 dirty 를 세운다)
    return 'merged';
  }

  /** 변경이 생겼음을 표시(디바운스 없이) */
  markDirty(): void {
    this.changeSeq++;
  }

  /** 변경 표시 + 디바운스 저장 예약. 차단 상태면 쓰지 않고 안내만 */
  schedule(): void {
    this.changeSeq++;
    if (this.status === 'blocked') {
      this.noticeBlocked();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveNow();
    }, this.spec.saveDelayMs);
  }

  /** 대기 중인 디바운스 저장을 취소(호출부가 곧바로 직접 저장할 때) */
  cancelScheduled(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 지금 저장. 차단·실패면 false(던지지 않음) */
  saveNow(): Promise<boolean> {
    return this.enqueue(() => this.doWrite(false));
  }

  /** 지금 저장. 차단이면 GlobalStoreBlockedError, 쓰기 실패면 그 오류를 던진다 */
  async saveNowOrThrow(): Promise<void> {
    await this.enqueue(() => this.doWrite(true));
  }

  /** 종료 저장 — 대기 중 저장이 있거나 dirty 일 때만 쓴다 */
  async flush(): Promise<boolean> {
    const pending = this.timer !== null;
    this.cancelScheduled();
    if (!pending && !this.dirty) {
      await this.chain;
      return true;
    }
    return this.saveNow();
  }

  /** 변경 조작 진입부 가드(비동기 메서드) — 차단 상태면 안내 후 throw */
  assertWritable(): void {
    if (this.status !== 'blocked') return;
    this.noticeBlocked();
    throw new GlobalStoreBlockedError(this.spec.label);
  }

  /**
   * 되돌리기 어려운 작업(프로젝트 만들기 등) 직전의 쓰기 가능 확인 — 아무것도 쓰지 않는다(저장 줄 안에서 판단).
   * 차단 상태면 안내(토스트) 후 false. 첫 로드가 「없음」이었는데 지금 본 파일이 있으면(또는 확인 자체가 실패하면)
   * 저장 때와 같은 쓰기 충돌 차단으로 막고 안내한 뒤 false — 다음 저장이 본 파일을 덮지 않게 미리 막는다.
   * 지금은 씬 템플릿 지정 목록(TemplateService)만 쓴다. 기존 저장소 동작에는 영향이 없다(새 메서드).
   */
  confirmWritable(): Promise<boolean> {
    return this.enqueue(async () => {
      if (this.status === 'blocked') {
        this.noticeBlocked();
        return false;
      }
      if (this.status === 'missing') {
        const { label, file } = this.spec;
        let exists = true;
        try {
          exists = await this.deps.backend().existFile(file);
        } catch {
          exists = true;
        }
        if (exists) {
          this.status = 'blocked';
          emitGlobalStoreNotice({ type: 'write-conflict', label, file });
          return false;
        }
      }
      return true;
    });
  }

  /** 변경 조작 진입부 가드(동기 메서드) — 차단 상태면 안내 후 false */
  canWrite(): boolean {
    if (this.status !== 'blocked') return true;
    this.noticeBlocked();
    return false;
  }

  private noticeBlocked(): void {
    const now = (this.deps.now ?? Date.now)();
    if (now - this.lastBlockedNoticeAt < BLOCKED_NOTICE_INTERVAL_MS) return;
    this.lastBlockedNoticeAt = now;
    emitGlobalStoreNotice({ type: 'write-blocked', label: this.spec.label, file: this.spec.file });
  }

  private async doWrite(throwOnFail: boolean): Promise<boolean> {
    const { label, file } = this.spec;
    if (this.status === 'blocked') {
      if (throwOnFail) {
        this.noticeBlocked();
        throw new GlobalStoreBlockedError(label);
      }
      return false;
    }
    if (this.status === 'missing') {
      // 부팅 때 「없음」이었는데 지금은 있다(다른 창이 만들었거나 판정이 틀림) — 덮어쓰지 않는다
      let exists = true;
      try {
        exists = await this.deps.backend().existFile(file);
      } catch {
        exists = true;
      }
      if (exists) {
        this.status = 'blocked';
        emitGlobalStoreNotice({ type: 'write-conflict', label, file });
        if (throwOnFail) throw new GlobalStoreBlockedError(label);
        return false;
      }
    }
    if (!this.rotated) {
      this.rotated = true;
      await this.rotate();
    }
    const seq = this.changeSeq;
    const data = this.spec.serialize();
    const err = await this.writeAtomicError(data);
    if (err !== null) {
      console.error(`${label} 저장 실패:`, err);
      if (throwOnFail) throw err;
      return false;
    }
    if (seq > this.savedSeq) this.savedSeq = seq;
    this.baseRaw = data;
    if (this.status === 'missing') this.status = 'ok';
    try {
      this.spec.afterWrite?.();
    } catch (e) {
      console.error(`${label} 저장 후 처리 실패:`, e);
    }
    return true;
  }

  /** 세션 첫 저장 직전 1회 — 읽어 둔 정상본을 .bak1 로, 기존 .bak1→.bak2→.bak3(가장 오래된 것이 밀려난다) */
  private async rotate(): Promise<void> {
    const raw = this.rotateRaw;
    if (raw === null) return;
    const backend = this.deps.backend();
    const { file } = this.spec;
    for (let n = STORE_BACKUP_COPIES - 1; n >= 1; n--) {
      try {
        if (await backend.existFile(storeBackupPath(file, n))) {
          await backend.renameFile(storeBackupPath(file, n), storeBackupPath(file, n + 1));
        }
      } catch (e) {
        console.warn(`${this.spec.label} 사본 회전 실패(.bak${n}):`, e);
      }
    }
    try {
      await this.deps.write(storeBackupPath(file, 1), raw);
    } catch (e) {
      console.warn(`${this.spec.label} 사본(.bak1) 쓰기 실패:`, e);
    }
  }

  private async writeAtomic(data: string): Promise<boolean> {
    return (await this.writeAtomicError(data)) === null;
  }

  /** tmp 쓰기 → rename, 실패하면 직접 쓰기(종전 방식). 성공 = null, 실패 = 마지막 오류 */
  private async writeAtomicError(data: string): Promise<unknown | null> {
    const { file } = this.spec;
    const tmp = storeSidePath(file, 'tmp');
    try {
      await this.deps.write(tmp, data);
      await this.deps.backend().renameFile(tmp, file);
      return null;
    } catch {
      try {
        await this.deps.write(file, data);
        return null;
      } catch (e2) {
        return e2 ?? new Error('저장 실패');
      }
    }
  }
}
