/**
 * 저장 경로 전역 감시(`config.refreshImage`)의 Windows 판별 로직.
 *
 * Windows 에서는 chokidar(파일마다 fs.watch) 대신 `fs.watch(APP_DIR, {recursive:true})`
 * 한 개로 감시한다. recursive 감시는 폴더에도, 새로 만든 파일에도 `change` 를 내고
 * 편집기의 교체 저장에는 `rename` 만 내므로, 알림 묶음을 경로별로 모아
 * 「기존 이미지가 바뀜」만 골라낸다(새 이미지를 바뀐 것으로 알리면 렌더러
 * `invalidateCache` 가 방금 만든 썸네일을 지운다).
 *
 * electron·chokidar·fs 에 의존하지 않는 순수 로직 — 파일 확인과 알림은 주입한다.
 */

const WATCHED_ROOTS = new Set(['outs', 'inpaints', 'workspace']);
const IMAGE_EXT = /\.(png|webp|jpe?g)$/i;

function isAbsoluteName(name: string): boolean {
  return /^[A-Za-z]:/.test(name) || name.startsWith('\\') || name.startsWith('/');
}

/**
 * recursive 감시가 준 filename(루트 기준 상대) → 감시 대상 이미지의 `a/b/c.png` 꼴 상대 경로.
 * 대상이 아니면 null.
 */
export function watchedImageRelPath(
  filename: string | null | undefined,
): string | null {
  if (typeof filename !== 'string' || filename.length === 0) return null;
  if (isAbsoluteName(filename)) return null;
  const comps = filename.split(/[\\/]/).filter((c) => c.length > 0);
  while (comps.length > 0 && comps[0] === '.') comps.shift();
  if (comps.length < 2) return null;
  if (!WATCHED_ROOTS.has(comps[0])) return null;
  const rel = comps.join('/');
  if (!IMAGE_EXT.test(comps[comps.length - 1])) return null;
  // 렌더러 invalidateCache 가 어차피 무시하는 썸네일 캐시.
  if (rel.includes('fastcache')) return null;
  return rel;
}

/** 감시 루트 자체가 사라지면 Windows 는 절대 경로 filename 의 rename 을 끝없이 낸다. */
export function isRootGoneEvent(filename: string | null | undefined): boolean {
  return typeof filename === 'string' && isAbsoluteName(filename);
}

export interface ImageChangeDetectorOptions {
  /** 실제 파일인지. 던지면 false 로 취급한다. */
  isFile: (relPath: string) => Promise<boolean>;
  /** 「바뀐 이미지」 알림. */
  emit: (relPath: string) => void;
  /** 그 경로에 알림이 이만큼 안 오면 판정(기본 300ms). */
  quietMs?: number;
  /** 「조금 전에 사라진 경로」를 기억하는 시간(기본 5000ms). */
  vanishedTtlMs?: number;
  /** 「조금 전에 사라진 경로」 최대 개수(기본 2000). */
  maxVanished?: number;
}

export interface ImageChangeDetector {
  onRawEvent(eventType: string, filename: string | null): void;
  dispose(): void;
}

interface PendingEntry {
  renames: number;
  changes: number;
  last: number;
}

export function createImageChangeDetector(
  opts: ImageChangeDetectorOptions,
): ImageChangeDetector {
  const quietMs = opts.quietMs ?? 300;
  const vanishedTtlMs = opts.vanishedTtlMs ?? 5000;
  const maxVanished = opts.maxVanished ?? 2000;

  // 마지막 알림 시각 순서를 유지한다(갱신 때 지웠다 다시 넣음) — 훑기가 앞에서부터 끊을 수 있게.
  const pending = new Map<string, PendingEntry>();
  // 넣은 시각 순서(= 오래된 것이 앞).
  const vanished = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const safeIsFile = async (rel: string): Promise<boolean> => {
    try {
      return (await opts.isFile(rel)) === true;
    } catch {
      return false;
    }
  };

  const safeEmit = (rel: string) => {
    try {
      opts.emit(rel);
    } catch {
      // 알림 실패가 감지기를 멈추지 않게 한다.
    }
  };

  const rememberVanished = (rel: string, now: number) => {
    for (const [p, t] of vanished) {
      if (now - t <= vanishedTtlMs) break;
      vanished.delete(p);
    }
    vanished.delete(rel);
    vanished.set(rel, now);
    while (vanished.size > maxVanished) {
      const oldest = vanished.keys().next().value as string;
      vanished.delete(oldest);
    }
  };

  const emitIfFile = async (rel: string) => {
    if (await safeIsFile(rel)) {
      if (!disposed) safeEmit(rel);
    }
  };

  const judge = (rel: string, e: PendingEntry, now: number): void => {
    if (e.renames === 0 || e.renames >= 2) {
      // 제자리 덮어쓰기(change 만) · 임시 파일로 교체(rename 2번 이상).
      emitIfFile(rel).catch(() => {});
      return;
    }
    // renames === 1
    const goneAt = vanished.get(rel);
    if (goneAt !== undefined) {
      vanished.delete(rel);
      if (now - goneAt <= vanishedTtlMs) {
        // 지우고 조금 뒤 같은 이름으로 다시 저장하는 편집기.
        emitIfFile(rel).catch(() => {});
        return;
      }
    }
    if (e.changes === 0) {
      // 옮겨 넣어 만들기(생성) 또는 삭제 — 파일이 없으면 삭제로 기억한다.
      safeIsFile(rel)
        .then((exists) => {
          if (!exists && !disposed) rememberVanished(rel, Date.now());
        })
        .catch(() => {});
    }
    // changes >= 1: 직접 써서 만든 새 파일 — 알리지 않는다.
  };

  const schedule = (delay: number) => {
    timer = setTimeout(sweep, Math.max(1, delay));
    const t = timer as unknown as { unref?: () => void };
    if (t && typeof t === 'object' && typeof t.unref === 'function') t.unref();
  };

  function sweep() {
    timer = null;
    if (disposed) return;
    const now = Date.now();
    for (const [rel, e] of pending) {
      if (now - e.last < quietMs) break;
      pending.delete(rel);
      try {
        judge(rel, e, now);
      } catch {
        // 판정 하나의 실패가 나머지 훑기를 막지 않게 한다.
      }
    }
    const first = pending.values().next();
    if (!first.done) {
      schedule(first.value.last + quietMs - now);
    }
  }

  return {
    onRawEvent(eventType: string, filename: string | null) {
      if (disposed) return;
      const rel = watchedImageRelPath(filename);
      if (rel === null) return;
      const now = Date.now();
      let e = pending.get(rel);
      if (e) {
        pending.delete(rel);
      } else {
        e = { renames: 0, changes: 0, last: now };
      }
      if (eventType === 'rename') e.renames++;
      else e.changes++;
      e.last = now;
      pending.set(rel, e);
      if (timer === null) schedule(quietMs);
    },
    dispose() {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
      vanished.clear();
    },
  };
}
