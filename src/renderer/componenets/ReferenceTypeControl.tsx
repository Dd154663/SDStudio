import * as React from 'react';
import { effectiveSameOutfit, ReferenceType } from '../backends/genVendors/naiReference';
import {
  REFERENCE_EDITOR_TEXT,
  ReferenceEditorSpec,
  referenceTypeLabel,
  referenceTypeOptions,
  showSameOutfitToggle,
} from '../models/referenceEditorSpec';

/**
 * 캐릭터 레퍼런스 「유형」 선택 + 「같은 의상 선호」(2026-11-25) — 편집기 세 곳의 항목과 새 레퍼런스 기본값 구역 공용.
 * - 유형 = 공용 드롭다운 `.app-select`(+ 높이를 정한 줄이라 `.app-select-tight`). 좁은 컨트롤 열에도 들어가게 한 칸.
 * - 「같은 의상 선호」는 의상을 받는 모델이면 자리를 늘 잡아 두고, 캐릭터·캐릭터+스타일이 아닐 때는 자리만 남긴 채
 *   숨긴다(invisible·aria-hidden·포커스 불가) — 유형을 바꿔도 항목 높이가 달라지지 않게. 의상 미지원 모델은 자리 없음.
 * - 값 변경 경로·되돌리기는 호출부가 정한다(이 부품은 콜백만 부른다).
 */
export interface ReferenceTypeControlProps {
  type: string | undefined;
  preferSameOutfit?: boolean;
  spec: Pick<ReferenceEditorSpec, 'outfit'>;
  onTypeChange: (type: ReferenceType) => void;
  onSameOutfitChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** 유형만(기본값 구역) — 「같은 의상 선호」 자리를 만들지 않는다. */
  typeOnly?: boolean;
  /** 「유형:」 라벨 칸 클래스(기본값 구역은 옆 줄 라벨 폭에 맞춘다). */
  labelClassName?: string;
  className?: string;
}

export function ReferenceTypeControl({
  type,
  preferSameOutfit,
  spec,
  onTypeChange,
  onSameOutfitChange,
  disabled,
  typeOnly,
  labelClassName = 'gray-label flex-none',
  className = '',
}: ReferenceTypeControlProps) {
  const current = type || 'character';
  const options = referenceTypeOptions(spec, current);
  const withOutfitSlot = !typeOnly && spec.outfit;
  const outfitVisible = withOutfitSlot && showSameOutfitToggle(spec, current);
  return (
    <div
      className={`flex items-center gap-x-3 gap-y-1 flex-wrap min-w-0 ${className}`}
      data-reference-type-control=""
    >
      <label className="flex items-center gap-1.5 min-w-0 max-w-full">
        <span className={labelClassName}>유형:</span>
        <select
          className="app-select app-select-tight h-8 text-sm min-w-0 max-w-full"
          aria-label="레퍼런스 유형"
          value={current}
          disabled={disabled}
          onChange={(e) => onTypeChange(e.target.value as ReferenceType)}
        >
          {options.map((t) => (
            <option key={t} value={t}>
              {referenceTypeLabel(t)}
            </option>
          ))}
        </select>
      </label>
      {withOutfitSlot && (
        <label
          className={
            'flex items-center gap-1 flex-none ' +
            (outfitVisible ? 'cursor-pointer' : 'invisible pointer-events-none')
          }
          aria-hidden={outfitVisible ? undefined : true}
          data-same-outfit-slot={outfitVisible ? 'shown' : 'hidden'}
        >
          <input
            type="checkbox"
            className="setting-check setting-check-sm"
            checked={outfitVisible ? !!effectiveSameOutfit(current, preferSameOutfit) : false}
            tabIndex={outfitVisible ? undefined : -1}
            disabled={disabled || !outfitVisible}
            onChange={(e) => {
              if (!outfitVisible) return;
              onSameOutfitChange?.(e.target.checked);
            }}
          />
          <span className="gray-label">{REFERENCE_EDITOR_TEXT.sameOutfit}</span>
        </label>
      )}
    </div>
  );
}
