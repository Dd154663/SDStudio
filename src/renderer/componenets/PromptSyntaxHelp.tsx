// 프롬프트 문법 설명 — 누르면 열려 떠 있는 패널(2026-11-19 UI 정돈 시범 ①). 상위 프롬프트 라벨 옆 (?) 자리.
// 2026-11-20 그룹 1-b: 패널 그리기·열고 닫기·위치는 공용 HelpPanelButton(HelpPanel.tsx)으로 옮기고,
// 여기는 문법 데이터(models/promptSyntaxHelp.ts)와 예전 접근성 이름·표식(data-prompt-syntax-panel)을 넘기는 얇은 래퍼.
// 예시 칩은 편집 칸과 같은 .syntax-* 클래스(테마별 색 짝을 그대로 따름).
import { useMemo } from 'react';
import { HelpPanelButton } from './HelpPanel';
import { PROMPT_SYNTAX_HELP_TEXT, promptSyntaxHelpData } from '../models/promptSyntaxHelp';

export function PromptSyntaxHelpButton({
  mobile,
  size = 15,
}: {
  mobile: boolean;
  size?: number;
}) {
  const data = useMemo(() => promptSyntaxHelpData(mobile), [mobile]);
  return (
    <HelpPanelButton
      data={data}
      label={PROMPT_SYNTAX_HELP_TEXT.buttonLabel}
      size={size}
      marker="prompt-syntax-panel"
    />
  );
}

export default PromptSyntaxHelpButton;
