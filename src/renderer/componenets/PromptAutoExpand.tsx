import { createContext } from 'react';

/**
 * 모바일 프롬프트 편집기의 「탭=확장 창」(클래식 동작, 2026-09-27 복원).
 *  · 기본 true: 모바일에서 편집기에 포커스가 들어오면 확장 창(fullScreen)을 연다 — 축소안(2026-09-22) 이전의 클래식 동작.
 *    창 밖 click 감시는 되살리지 않는다(닫기는 X·배경 탭·뒤로 가기). X 는 포커스를 유지하므로 같은 칸을 다시 탭해도
 *    focus 이벤트가 없어 열리지 않는다 — 확대 버튼으로 연다.
 *  · false 로 감싸는 곳 = 자체 집중 모드가 있는 곳: V2 하단 시트(MobilePromptSheet), 클래식 프롬프트 창의
 *    집중 모드(PromptFocusShell, V2 「인라인 편집기」 부위), 씬 편집 창(SceneEditor 키보드 집중 모드).
 *  · PC 는 원래 포커스 확대가 없어 값과 무관.
 */
export const PromptAutoExpandContext = createContext<boolean>(true);
