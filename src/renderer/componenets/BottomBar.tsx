import { observer } from 'mobx-react-lite';
import { StackFixed } from './LayoutComponents';
import SessionSelect from './SessionSelect';
import TaskQueueControl from './TaskQueueControl';
import { GenControlHandle } from './GenControlWidget';
import { appState } from '../models/AppService';
import { isMobile } from '../models';
import { BottomBarPlacement } from '../models/layoutTemplates';

// 메인 화면 하단 바: 세션 선택(PC 전용) + 실행/중지 컨트롤.
// 레이아웃 템플릿(배치 변경) 대비로 App.tsx 인라인에서 분리 — 기본(bottom) 모양·클래스는 기존과 동일.
// 컴팩트 템플릿(bottomBar:'none')에서는 App.tsx 가 이 컴포넌트를 아예 렌더하지 않는다.
// appState.genWidget.detached 를 구독하므로 observer 로 감싼다.
const BottomBar = observer(({ placement }: { placement?: BottomBarPlacement }) => {
  // 분리 상태(PC 전용)면 하단바 쪽 컨트롤은 렌더하지 않는다 — 플로팅 위젯이 대신 표시.
  const genDetached = !isMobile && appState.genWidget.detached === true;

  // 기본(bottom): 기존 하단 가로바. data-gen-dock = 플로팅 위젯 재부착 히트 영역.
  return (
    <StackFixed>
      <div
        data-gen-dock
        className="px-3 pt-2 border-t flex gap-3 items-center line-color"
        style={{
          // 제스처바가 있는 기기에서 실행/중지 버튼이 바에 가리지 않도록
          // 기존 하단 여백(0.5rem)에 safe-area 를 더한다(inset 0이면 기존과 동일).
          paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))',
        }}
      >
        <div className="hidden md:block flex-1">
          <SessionSelect />
        </div>
        <div className="flex flex-none gap-4 items-center ml-auto">
          {/* 분리 핸들(PC 전용). 분리 상태면 컨트롤은 위젯이 대신 표시하므로 숨김. */}
          {!genDetached && (
            <div className="flex flex-none items-center gap-2">
              <span className="hidden md:flex">
                <GenControlHandle />
              </span>
              <TaskQueueControl />
            </div>
          )}
        </div>
      </div>
    </StackFixed>
  );
});

export default BottomBar;
