// 모바일 키보드 위 칩(MobileKeyboardChip)이 지금 떠 있는가 — 칩은 자체 React 상태로 표시를 정하므로
// 다른 화면 요소(되돌리기 버튼 바 UndoRedoBar 등)가 그 표시를 구독할 수 있게 관찰 상자 하나로 내보낸다.
// 칩만 쓴다(setKeyboardChipVisible). 읽는 쪽은 observer 안에서 keyboardChipVisible.get().
import { observable, runInAction } from 'mobx';

export const keyboardChipVisible = observable.box(false);

export function setKeyboardChipVisible(visible: boolean): void {
  if (keyboardChipVisible.get() === visible) return;
  runInAction(() => keyboardChipVisible.set(visible));
}
