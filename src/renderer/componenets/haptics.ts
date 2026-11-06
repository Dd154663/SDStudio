import { isMobile } from '../models';

// 잡힘 햅틱 — navigator.vibrate 는 Android WebView 미구현이라 Capacitor Haptics
// 네이티브 경로를 쓴다 (VIBRATE 권한은 AndroidManifest 에 있음). 실패 시 무시.
// 툴바 끌기(ToolbarDnd, 재export)·되돌리기 버튼 바 꾹 누름 끌기(UndoRedoBar)가 함께 쓰는 가벼운 단일 출처
// (react-dnd 등 무거운 의존 없이 가져다 쓰도록 2026-11-04 ToolbarDnd 에서 분리).
export async function hapticTick() {
  if (!isMobile) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch {
    try {
      navigator.vibrate?.(30);
    } catch {}
  }
}
