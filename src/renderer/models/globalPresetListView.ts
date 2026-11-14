// 글로벌 프리셋 목록 보기(검색·정렬) — 단일 출처(2026-11-14 M3).
// 글로벌 프리셋 탭 본문과 공용 글로벌 프리셋 고르기 창(GlobalPresetPicker)이 같은 규칙으로 거르고 줄 세운다.
//
// 순수 모듈(React·서비스 import 없음) — 단위 테스트가 그대로 부른다.
// 이름 일치·이름순 비교는 공용 models/listSearch.ts(2026-11-14 M4)를 쓴다.

import { compareNames, matchesQuery } from './listSearch';

export type GlobalPresetSortBy = 'recent' | 'name' | 'default';

/**
 * 이름 검색(앞뒤 공백 제거·대소문자 무시 부분 일치) 후 정렬한 새 배열을 돌려준다(원본 불변).
 * - recent: 수정 시각 최신순
 * - name: 이름순(숫자 자연 정렬·대소문자/악센트 무시)
 * - default: 기본 지정 먼저, 그 안에서 수정 시각 최신순
 */
export function filterSortGlobalPresets<
  T extends { name: string; isDefault?: boolean; updatedAt?: number },
>(list: readonly T[], query: string, sortBy: GlobalPresetSortBy): T[] {
  const visible = list.filter((p) => matchesQuery(p.name, query));
  return visible.sort((a, b) => {
    if (sortBy === 'name') return compareNames(a.name, b.name);
    if (sortBy === 'default')
      return (
        (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) ||
        (b.updatedAt || 0) - (a.updatedAt || 0)
      );
    return (b.updatedAt || 0) - (a.updatedAt || 0); // recent
  });
}
