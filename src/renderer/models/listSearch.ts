// 목록 이름 검색·이름순 정렬 — 단일 출처(2026-11-14 M4).
// 공용 검색 줄(componenets/ListSearchBar.tsx)을 쓰는 창(캐릭터 프리셋 관리·프롬프트조각·내보내기 프리셋 관리·
// 씬 템플릿 관리)과 글로벌 프리셋 목록 보기(globalPresetListView.ts)가 같은 규칙으로 거르고 줄 세운다.
//
// 순수 모듈(React·서비스 import 없음) — 단위 테스트가 그대로 부른다.
// 보기 전용: 저장된 순서·데이터는 바꾸지 않는다(호출부는 원본을 그대로 두고 걸러 낸 새 배열만 그린다).

/** 검색어가 있는지(앞뒤 공백만이면 없음) */
export function hasQuery(query: string): boolean {
  return query.trim().length > 0;
}

/** 이름 검색 — 앞뒤 공백 제거·대소문자 무시 부분 일치. 빈 검색어는 모두 통과 */
export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return name.toLowerCase().includes(q);
}

/** 이름순 비교 — 숫자 자연 정렬·대소문자/악센트 무시(「Tree 2」 < 「tree 10」) */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
