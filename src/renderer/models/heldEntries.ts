// 「형식은 정상인데 이 버전이 종류를 모르는」 목록 항목을 읽을 때 따로 보존했다가 저장 때 원래 자리에 되돌려 쓰는 공용 규칙
// (2026-11-18 프리셋 유실 조사 경로 14 — 새 버전에서 만든 종류의 프리셋을 구버전이 열었다 닫으면 영구 소실되던 결함).
//
// 규칙:
//  · 보존분은 원본 JSON 사본이다 — 화면에 보이지 않고 편집 대상도 아니다. 파일 형식은 바꾸지 않는다(새 필드 없음).
//  · index = 원래 목록(손상으로 버린 항목 제외)에서의 자리. 저장 때 아는 항목 목록에 index 오름차순으로 min(index, 길이) 자리에
//    끼워 넣는다 → 아는 항목이 그대로면 원본 순서와 똑같고, 아는 항목이 늘거나 줄어도 보존분은 하나도 빠지지 않는다.
//  · 끼워 넣을 때마다 깊은 사본을 낸다 — 저장 결과를 고쳐 쓰는 호출부(얕은 내보내기의 profile base64 치환 등)가
//    보존분 원본을 바꾸지 못하게.

export interface HeldEntry {
  /** 원래 목록에서의 자리(0부터) */
  index: number;
  /** 원본 JSON(깊은 사본) */
  value: any;
}

const deepCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** 원래 자리 정보를 붙여 보존분을 만든다(깊은 사본) */
export function holdEntry(index: number, value: unknown): HeldEntry {
  return { index, value: deepCopy(value) };
}

/** 아는 항목 목록(이미 직렬화된 값) 사이에 보존분을 원래 자리로 끼워 새 배열을 돌려준다. known 은 바꾸지 않는다. */
export function weaveHeld<T>(known: readonly T[], held: readonly HeldEntry[] | undefined): T[] {
  const out: T[] = [...known];
  if (!held || held.length === 0) return out;
  const ordered = [...held].sort((a, b) => a.index - b.index);
  for (const h of ordered) {
    const at = Math.max(0, Math.min(h.index, out.length));
    out.splice(at, 0, deepCopy(h.value) as T);
  }
  return out;
}
