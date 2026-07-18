import { FaQuestionCircle } from 'react-icons/fa';
import Tooltip from './Tooltip';

// (?) 도움말 아이콘 (2026-07-18) — 조합 에디터(SceneEditor)에서 쓰던
// Tooltip + FaQuestionCircle 패턴의 공용화. 한눈에 사용법을 알기 힘든 영역의
// 헤더/라벨 옆에 심는다. Tooltip 이 멀티라인(\n)과 모바일 터치를 처리한다.
const HelpIcon = ({ content, size = 15 }: { content: string; size?: number }) => (
  <Tooltip content={content}>
    <span
      className="text-yellow-500 dark:text-yellow-400 cursor-help inline-flex items-center align-middle"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <FaQuestionCircle size={size} />
    </span>
  </Tooltip>
);

export default HelpIcon;
