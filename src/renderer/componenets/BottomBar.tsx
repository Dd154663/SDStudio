import { observer } from 'mobx-react-lite';
import { StackFixed } from './LayoutComponents';
import SessionSelect from './SessionSelect';
import TaskQueueControl from './TaskQueueControl';
import { isV2, V2_QUICK_BAR_SLOT_ID } from '../models/mobileV2';
import { GenControlHandle } from './GenControlWidget';
import { appState } from '../models/AppService';
import { isMobile } from '../models';
import { BottomBarPlacement } from '../models/layoutTemplates';

// 메인 화면 하단 바: 세션 선택(PC 전용) + 실행/중지 컨트롤.
// 레이아웃 템플릿(배치 변경) 대비로 App.tsx 인라인에서 분리 — 기본(bottom) 모양·클래스는 기존과 동일.
// 컴팩트 템플릿(bottomBar:'none')에서는 App.tsx 가 이 컴포넌트를 아예 렌더하지 않는다.
// appState.genWidget.detached 를 구독하므로 observer 로 감싼다.
const BottomBar = observer(
  ({
    placement,
    genControl,
    projectSidebar,
  }: {
    placement?: BottomBarPlacement;
    genControl?: 'docked' | 'floating';
    // 'sidebar' 템플릿이면 프로젝트 툴바(SessionSelect)는 좌측 사이드 바가 담당 → 하단바엔 미렌더.
    projectSidebar?: boolean;
  }) => {
  // 분리 상태(PC 전용)이거나 슬롯이 floating 이면 하단바 쪽 컨트롤을 렌더하지 않는다.
  // — 플로팅 위젯이 대신 표시. floating 슬롯인데 detached=false 인 상태에서
  //   하단바 컨트롤과 플로팅 위젯이 중복 렌더되는 것을 막는다.
  // 자체 실행 컨트롤을 가진 오버레이(인페인트 편집기 등)가 떠 있으면 마찬가지로
  // 숨긴다 — PC 하단바는 FloatView 에 덮이지 않아 실행 버튼이 2개 노출되기 때문.
  const genDetached =
    !isMobile &&
    (appState.genWidget.detached === true ||
      genControl === 'floating' ||
      appState.genControlOverlayCount > 0);

  const v2 = isV2();

  // 기본(bottom): 기존 하단 가로바. data-gen-dock = 플로팅 위젯 재부착 히트 영역.
  const bar = (
    <StackFixed>
      {/* zone-bar: 구역 카드화 마감 — PC 새 마감에선 캔버스 프레임에 통합(App.css) */}
      <div
        data-gen-dock
        className="zone-bar px-3 pt-2 border-t flex gap-3 items-center line-color"
        style={{
          // 제스처바가 있는 기기에서 실행/중지 버튼이 바에 가리지 않도록
          // 기존 하단 여백(0.5rem)에 safe-area 를 더한다(inset 0이면 기존과 동일).
          paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))',
        }}
      >
        {!projectSidebar && (
          <div className="hidden md:block flex-1">
            <SessionSelect />
          </div>
        )}
        {/* 모바일 V2: 퀵 생성 탭이 [생성][해상도]를 포털로 넣는 자리. 그동안 큐용 컨트롤은 숨긴다(mobileV2QuickBar). */}
        {v2 && (
          <div
            id={V2_QUICK_BAR_SLOT_ID}
            className="flex-1 min-w-0 items-stretch gap-1.5"
            style={{ display: appState.mobileV2QuickBar ? 'flex' : 'none' }}
          />
        )}
        <div
          className={
            v2
              ? 'flex flex-1 min-w-0 items-center'
              : 'flex flex-none gap-4 items-center ml-auto'
          }
          style={v2 && appState.mobileV2QuickBar ? { display: 'none' } : undefined}
        >
          {/* 분리 핸들(PC 전용). 분리 상태면 컨트롤은 위젯이 대신 표시하므로 숨김. */}
          {!genDetached && (
            <div
              data-slot="gencontrol"
              className={v2 ? 'flex flex-1 min-w-0 items-center gap-2' : 'flex flex-none items-center gap-2'}
            >
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
  // 모바일 V2: 시트가 열린 채 키보드가 떠 있는 동안은 하단 바를 숨긴다(display:none — 퀵 생성 포털 자리 유지를 위해
  // 마운트는 유지). 클래식·PC 는 래퍼 없이 그대로.
  if (!v2) return bar;
  return (
    <div style={{ display: appState.mobileV2SheetKeyboard ? 'none' : 'contents' }}>{bar}</div>
  );
  },
);

export default BottomBar;
