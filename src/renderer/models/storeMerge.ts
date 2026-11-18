// 글로벌 저장소 여러 창 동기화의 항목 단위 3방향 병합(2026-11-17 묶음 2, 플랜 guides/plans/2026-11-17-global-store-safety.md).
// 순수 함수 — UI·서비스·backend 를 import 하지 않는다.
//
// base   = 이 창이 본 파일에서 마지막으로 읽었거나 본 파일에 쓴 내용(공통 조상)
// local  = 이 창의 메모리(저장 안 된 변경 포함)
// remote = 다른 창이 방금 저장한 본 파일 내용
//
// 규칙(덜 지우는 쪽):
//  - 다른 창이 추가(base 없음·remote 있음·local 없음) → 받아들임(뒤에 붙임, remote 순서)
//  - 다른 창이 지움(base 있음·remote 없음) → local 이 base 와 같으면 지움, local 이 고쳤으면 유지
//  - 이 창이 지움(base 있음·local 없음) → 지운 채 유지(remote 가 고쳤어도)
//  - 양쪽에 있음 → local 이 base 와 같으면 remote, 다르면 local
//  - 이 창이 추가 → 유지
//  - 순서 = local 순서 유지 + 다른 창 추가분은 뒤에(단순한 쪽. 다른 창의 순서 바꾸기는 이 창이 dirty 면 반영되지 않는다)
// 항목 비교는 키 순서와 무관한 JSON 동등성(병합 시점에만 계산).

/** JSON.stringify 와 같은 값 규칙(undefined 생략 등)이되 객체 키를 정렬해 키 순서 차이를 같은 값으로 본다 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) out[key] = (v as Record<string, unknown>)[key];
      return out;
    }
    return v;
  });
}

function sameItem(a: unknown, b: unknown): boolean {
  return a === b || canonicalJson(a) === canonicalJson(b);
}

/** id 를 가진 항목 배열의 3방향 병합 */
export function mergeById<T extends { id: string }>(base: T[], local: T[], remote: T[]): T[] {
  const baseById = new Map<string, T>();
  for (const b of base) if (b && typeof b.id === 'string' && !baseById.has(b.id)) baseById.set(b.id, b);
  const remoteById = new Map<string, T>();
  for (const r of remote) if (r && typeof r.id === 'string' && !remoteById.has(r.id)) remoteById.set(r.id, r);

  const out: T[] = [];
  const taken = new Set<string>();
  for (const l of local) {
    if (!l || typeof l.id !== 'string' || taken.has(l.id)) continue;
    taken.add(l.id);
    const b = baseById.get(l.id);
    if (!b) {
      out.push(l); // 이 창이 추가(우연히 같은 id 가 remote 에 있어도 이 창 것)
      continue;
    }
    const r = remoteById.get(l.id);
    const localUnchanged = sameItem(l, b);
    if (!r) {
      if (!localUnchanged) out.push(l); // 다른 창이 지웠지만 이 창이 고쳤다 — 유지
      continue;
    }
    out.push(localUnchanged ? r : l);
  }
  for (const r of remote) {
    if (!r || typeof r.id !== 'string' || taken.has(r.id)) continue;
    taken.add(r.id);
    if (baseById.has(r.id)) continue; // 이 창이 지움 — 지운 채 유지
    out.push(r); // 다른 창이 추가
  }
  return out;
}

/**
 * 키 → 값 객체(씬 템플릿 지정 목록의 폴더 기본 템플릿·적용 기록 등)의 키 단위 3방향 병합(2026-11-18 T4).
 * 규칙은 mergeById 와 같다(키 = id, 값 비교 = canonicalJson 동등성):
 *  - 이 창이 추가(base 없음) → 이 창 값 / 다른 창이 추가(base·local 없음) → 받아들임
 *  - 다른 창이 지움(base 있음·remote 없음) → local 이 base 와 같으면 지움, 고쳤으면 유지
 *  - 이 창이 지움(base 있음·local 없음) → 지운 채 유지
 *  - 양쪽에 있음 → local 이 base 와 같으면 remote, 다르면 local
 * 키 순서 = local 순서 + 다른 창 추가분은 remote 순서로 뒤에. 입력 객체는 바꾸지 않는다.
 */
export function mergeByKey<V>(
  base: Record<string, V>,
  local: Record<string, V>,
  remote: Record<string, V>,
): Record<string, V> {
  const has = (o: Record<string, V>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const out: Record<string, V> = {};
  for (const k of Object.keys(local)) {
    const l = local[k];
    if (!has(base, k)) {
      out[k] = l; // 이 창이 추가(우연히 같은 키가 remote 에 있어도 이 창 것)
      continue;
    }
    const localUnchanged = sameItem(l, base[k]);
    if (!has(remote, k)) {
      if (!localUnchanged) out[k] = l; // 다른 창이 지웠지만 이 창이 고쳤다 — 유지
      continue;
    }
    out[k] = localUnchanged ? remote[k] : l;
  }
  for (const k of Object.keys(remote)) {
    if (has(local, k)) continue;
    if (has(base, k)) continue; // 이 창이 지움 — 지운 채 유지
    out[k] = remote[k]; // 다른 창이 추가
  }
  return out;
}

/** 문자열 집합(폴더 레지스트리·태그 프리셋 등)의 3방향 병합. 결과에 중복은 없다 */
export function mergeStringSet(base: string[], local: string[], remote: string[]): string[] {
  const baseSet = new Set(base);
  const remoteSet = new Set(remote);
  const out: string[] = [];
  const taken = new Set<string>();
  for (const s of local) {
    if (typeof s !== 'string' || taken.has(s)) continue;
    // base 에 있었는데 remote 에 없다 = 다른 창이 지움(문자열은 「고침」이 없으므로 local 은 base 와 같다)
    if (baseSet.has(s) && !remoteSet.has(s)) continue;
    taken.add(s);
    out.push(s);
  }
  for (const s of remote) {
    if (typeof s !== 'string' || taken.has(s)) continue;
    if (baseSet.has(s)) continue; // 이 창이 지움(또는 위에서 이미 처리)
    taken.add(s);
    out.push(s);
  }
  return out;
}
