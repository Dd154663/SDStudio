// 이미지 상세 보기 「이미지 정보」 접기/펼치기(2026-11-23 사용자 결정) — 순수 함수(의존성 없음), jest imageDetailInfoOpen.test.ts.
//
// · 앱 전체 하나로 기억한다 — 다른 이미지·씬·프로젝트를 봐도, 앱을 다시 켜도 같은 상태. 기본값은 접힘.
// · PC 넓은 폭(정보 칸 | 이미지 칸)·좁은 폭 클래식(「자세한 정보 보기/숨기기」)·모바일 V2(「자세한 정보」 손잡이)가 같은 값을 쓴다.
// · 저장은 그리드 「보기 순서」(imageOrderSort.ts)와 같은 화면 보기 설정 방식 — localStorage 한 키,
//   프로젝트 데이터·config.json 아님, 환경설정 내보내기 대상 아님. 값이 없거나 읽기 실패면 접힘.
// · PC 넓은 폭에서 접히는 것은 「상세 열」뿐이다(프롬프트 열은 항상) — 아래 detailWideColumns.

import type { DetailRow, ImageDetailInfoModel } from './imageDetailInfo';

export const IMAGE_DETAIL_INFO_OPEN_STORAGE_KEY = 'sdstudio-image-detail-info-open';
export const DEFAULT_IMAGE_DETAIL_INFO_OPEN = false;

/** 저장값 → 펼침 여부('true' 만 펼침, 그 밖·없음 = 접힘) */
export function normalizeImageDetailInfoOpen(value: unknown): boolean {
  return value === 'true';
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readImageDetailInfoOpen(storage: KeyValueStorage | undefined): boolean {
  try {
    return normalizeImageDetailInfoOpen(storage?.getItem(IMAGE_DETAIL_INFO_OPEN_STORAGE_KEY));
  } catch {
    return DEFAULT_IMAGE_DETAIL_INFO_OPEN;
  }
}

export function writeImageDetailInfoOpen(storage: KeyValueStorage | undefined, open: boolean): void {
  try {
    storage?.setItem(IMAGE_DETAIL_INFO_OPEN_STORAGE_KEY, String(open));
  } catch {
    // 저장 실패는 이번 실행 동안만 유지(보기 설정이라 알리지 않음)
  }
}

// ── PC 넓은 폭 열 배치(2026-11-23 사용자 지적 「원래처럼 프롬프트 정보가 주로 나오고 이미지는 가운데에서 살짝 오른쪽, 접으면 그쪽으로 원복」) ──
// 접힘 = [프롬프트 열 | 이미지 영역], 펼침 = [프롬프트 열 | 상세 열 | 이미지 영역].
// · 프롬프트 열(요약 칩·프롬프트·네거티브·캐릭터)은 두 상태 모두 보이고 폭이 같다 — 여닫을 때 움직이지 않는다.
// · 상세 열(생성 설정·참조 이미지·파일·프롬프트 구획)은 펼침에서만. 이미지 영역은 남는 폭 전부, 이미지는 그 안 가운데.
// · 펼침에서 이미지 영역이 DETAIL_IMAGE_AREA_MIN_PX 보다 좁아지면 상세 열을 따로 두지 않고 프롬프트 열에 이어 붙인다(한 열).

/** 프롬프트 열 폭 = 본문 폭 × ratio, [min, max] 범위(종전 약 515px/1640px 은 프롬프트 아래가 많이 비었다) */
export const DETAIL_PROMPT_COLUMN = { ratio: 0.27, min: 320, max: 440 } as const;
/** 상세 열 폭 = 본문 폭 × ratio, [min, max] 범위(키–값 표 「CFG 리스케일」 같은 이름 + 값이 잘리지 않는 폭) */
export const DETAIL_SIDE_COLUMN = { ratio: 0.19, min: 260, max: 340 } as const;
/** 펼침에서 이미지 영역이 이보다 좁아지면 상세 열을 프롬프트 열에 합친다(px) */
export const DETAIL_IMAGE_AREA_MIN_PX = 360;

const columnWidth = (bodyWidth: number, c: { ratio: number; min: number; max: number }) =>
  Math.round(Math.min(c.max, Math.max(c.min, bodyWidth * c.ratio)));

export interface DetailWideColumns {
  /** 프롬프트 열 폭(px) — 두 상태에서 같다 */
  prompt: number;
  /** 상세 열 폭(px) — 접힘·합침이면 0(열 없음) */
  side: number;
  /** 펼쳤지만 본문이 좁아 상세 묶음을 프롬프트 열 안에 이어 붙이는지 */
  merged: boolean;
  /** 이미지 영역 폭(px, 남는 폭 전부 — 이 안에서 비율을 지켜 가운데에 맞춘다) */
  image: number;
}

/** PC 넓은 폭 본문 폭(px)·펼침 여부 → 열 폭. 순수 함수(jest imageDetailInfoOpen.test.ts). */
export function detailWideColumns(bodyWidth: number, infoOpen: boolean): DetailWideColumns {
  const w = Math.max(0, bodyWidth);
  const prompt = columnWidth(w, DETAIL_PROMPT_COLUMN);
  let side = infoOpen ? columnWidth(w, DETAIL_SIDE_COLUMN) : 0;
  const merged = infoOpen && w - prompt - side < DETAIL_IMAGE_AREA_MIN_PX;
  if (merged) side = 0;
  return { prompt, side, merged, image: Math.max(0, w - prompt - side) };
}

/** 프롬프트 열의 요약 칩 — 메타가 없으면 칩이 비므로 파일 묶음의 해상도(실제 픽셀)를 칩으로 올린다(접힘에서도 해상도가 보이게). */
export function detailPromptChips(info: Pick<ImageDetailInfoModel, 'chips' | 'file'>): DetailRow[] {
  if (info.chips.length) return info.chips;
  const pixel = info.file.find((r) => r.key === 'pixel');
  return pixel ? [pixel] : [];
}

export const IMAGE_DETAIL_INFO_TEXT = {
  /** PC 넓은 폭 머리 줄의 상세 열 여닫는 버튼 이름·툴팁(두 상태에서 같다 — 켜짐은 .toggle-on·aria-pressed 로 보인다) */
  wideToggle: '상세 정보',
};
