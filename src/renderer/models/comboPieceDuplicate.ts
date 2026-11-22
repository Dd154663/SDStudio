// 조합 칸 조각 「복제」(2026-11-22) — 사본 자리·내용·이름을 정하는 순수 계산.
// 적용(slot.splice)과 되돌리기 기록(editSlots)은 호출부 SceneEditor.SlotPiece 가 한다.
// 이름 = 앱의 사용자 「복제」 버튼 규칙(SPEC 「복제 이름 단일 규칙」 suggestFolderCopyName — 「X 복사본」,
// 겹치면 「X 복사본 (2)」…). 겹침 판정은 같은 씬 조합의 다른 조각 이름. 이름 없는 조각은 이름 없이.
import { suggestFolderCopyName } from './nameInput';
import type { IPromptPiece } from './types';

type PieceLike = {
  prompt: string;
  characterPrompts: string[];
  id?: string;
  enabled?: boolean;
  name?: string;
  toJSON?: () => IPromptPiece;
};

export interface SlotPieceDuplicatePlan {
  /** 사본을 넣을 열 */
  slotIndex: number;
  /** 그 열에서 사본이 들어갈 자리(원본 바로 다음) */
  insertAt: number;
  /** 사본 내용(PromptPiece.fromJSON 으로 만든다) */
  json: IPromptPiece;
}

export function planSlotPieceDuplicate(
  slots: PieceLike[][],
  piece: PieceLike,
  newId: string,
): SlotPieceDuplicatePlan | undefined {
  const slotIndex = slots.findIndex((slot) => slot.includes(piece));
  if (slotIndex < 0) return undefined;
  const index = slots[slotIndex].indexOf(piece);
  const base: IPromptPiece =
    typeof piece.toJSON === 'function'
      ? piece.toJSON()
      : {
          prompt: piece.prompt,
          characterPrompts: piece.characterPrompts,
          id: piece.id ?? '',
          enabled: piece.enabled,
          ...(piece.name ? { name: piece.name } : {}),
        };
  const json: IPromptPiece = {
    ...base,
    characterPrompts: [...(base.characterPrompts ?? [])],
    id: newId,
  };
  delete (json as { name?: string }).name;
  if (piece.name) {
    const taken = new Set(
      slots.flat().map((p) => p.name).filter((n): n is string => !!n),
    );
    json.name = suggestFolderCopyName(piece.name, (n) => taken.has(n));
  }
  return { slotIndex, insertAt: index + 1, json };
}
