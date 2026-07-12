import { observer } from 'mobx-react-lite';
import { FaFolderOpen } from 'react-icons/fa';
import { appState } from '../models/AppService';
import SessionSelect from './SessionSelect';
import Tooltip from './Tooltip';
import type { PanelSide } from '../models/layoutTemplates';

// 프로젝트 진입 사이드 바 (PC 전용, 두꺼운 세로 바).
// - 상단 "프로젝트" 존을 누르면 프로젝트 오버레이 드로어를 연다(기존 버튼 진입 대체).
// - 아래에 프로젝트 액션(신규 추가·캐릭터 프리셋·휴지통·탐색)을 세로로 배치
//   (SessionSelect 의 sidebar variant 로 로직·모달 재사용 — 초기 버전).
// projectSide(left/right)에 따라 중앙을 향하는 쪽에 구분선을 둔다.
const ProjectSideBar = observer(({ side }: { side: PanelSide }) => {
  const borderSide = side === 'left' ? 'border-r' : 'border-l';
  return (
    <div
      className={
        // zone-card/zone-gap-*: 구역 카드화 마감(App.css) — 중앙을 향하는 쪽에 카드 간격.
        // 클래식이면 기존 보더 구분 그대로.
        'zone-card ' +
        (side === 'left' ? 'zone-gap-r ' : 'zone-gap-l ') +
        'flex-none w-12 h-full flex flex-col items-center bg-[var(--c-surface-2)] line-color ' +
        borderSide
      }
    >
      {/* 드로어 열기 존 */}
      <Tooltip content="프로젝트 목록 열기">
        <button
          className="w-full flex flex-col items-center gap-1 py-3 border-b line-color text-body hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          onClick={() => {
            appState.projectDrawerOpen = true;
          }}
        >
          <FaFolderOpen size={18} className="text-sky-500 dark:text-sky-300" />
          <span className="text-[10px] leading-tight">프로젝트</span>
        </button>
      </Tooltip>
      {/* 프로젝트 액션 (세로 스택) */}
      <div className="pt-2 flex-1 w-full overflow-y-auto flex flex-col items-center">
        <SessionSelect variant="sidebar" />
      </div>
    </div>
  );
});

export default ProjectSideBar;
