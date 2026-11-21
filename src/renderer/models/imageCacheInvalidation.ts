// imageService 'image-cache-invalidated' 이벤트가 특정 이미지의 것인지 판정(순수).
// detail 형식(ImageService.invalidateCache / invalidateCacheBatch): { path } 또는 { path, paths }.
// 경로는 저장소 기준 상대 경로·'/' 구분이 원칙이지만, 외부 편집 감시(main 'image-changed')처럼
// OS 경로에서 만든 알림이 섞일 수 있어 구분자·'./'·앞 슬래시·유니코드 정규화(NFD→NFC)를 맞춰 비교한다.

export function normalizeImageEventPath(p: string): string {
  let s = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  while (s.startsWith('/')) s = s.slice(1);
  return s.normalize('NFC');
}

/**
 * 무효화 이벤트가 viewingPath 이미지에 해당하면 true.
 * detail 이 없거나 경로 정보가 없으면 어느 이미지 것인지 모르므로 안전하게 true(다시 읽기).
 * viewingPath 가 비어 있으면(목록이 줄어드는 사이) false.
 */
export function isImageCacheInvalidationFor(
  detail: unknown,
  viewingPath: string | undefined,
): boolean {
  if (!viewingPath) return false;
  const d = detail as { path?: unknown; paths?: unknown } | null | undefined;
  const candidates: string[] = [];
  if (d && typeof d === 'object') {
    if (typeof d.path === 'string') candidates.push(d.path);
    if (Array.isArray(d.paths)) {
      for (const p of d.paths) if (typeof p === 'string') candidates.push(p);
    }
  }
  if (candidates.length === 0) return true;
  if (candidates.includes(viewingPath)) return true;
  const target = normalizeImageEventPath(viewingPath);
  return candidates.some((p) => normalizeImageEventPath(p) === target);
}

/** detail 의 경로 목록({path}·{path, paths}). 경로 정보가 없으면 빈 배열(중복 제거). */
export function imageCacheInvalidationPaths(detail: unknown): string[] {
  const d = detail as { path?: unknown; paths?: unknown } | null | undefined;
  const out = new Set<string>();
  if (d && typeof d === 'object') {
    if (typeof d.path === 'string' && d.path) out.add(d.path);
    if (Array.isArray(d.paths)) {
      for (const p of d.paths) if (typeof p === 'string' && p) out.add(p);
    }
  }
  return Array.from(out);
}

/**
 * 이미지 그리드처럼 「경로 → 값」 등록표를 가진 쪽에서, 무효화 이벤트에 해당하는 등록 값만 고른다(2026-11-21).
 * 경로마다 그대로 찾고, 없으면 정규화한 경로로 한 번 더 찾는다(Map 조회만 — 등록표 전체를 훑지 않음).
 * detail 에 경로가 없으면 아무것도 고르지 않는다(isImageCacheInvalidationFor 와 달리 「전부 다시 읽기」로 넘기지 않음).
 */
export function pickInvalidatedEntries<T>(
  registry: ReadonlyMap<string, T>,
  detail: unknown,
): T[] {
  if (registry.size === 0) return [];
  const picked: T[] = [];
  const seen = new Set<T>();
  for (const p of imageCacheInvalidationPaths(detail)) {
    let hit = registry.get(p);
    if (hit === undefined) {
      const n = normalizeImageEventPath(p);
      if (n !== p) hit = registry.get(n);
    }
    if (hit !== undefined && !seen.has(hit)) {
      seen.add(hit);
      picked.push(hit);
    }
  }
  return picked;
}
