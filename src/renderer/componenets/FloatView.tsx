import React, {
  createContext,
  useContext,
  useState,
  memo,
  useEffect,
  ReactNode,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { FaTimes } from 'react-icons/fa';
import { isMobile } from '../models';
import { appState } from '../models/AppService';
import { backStackService, BackStackHandle } from '../models/BackStackService';

// 창 배치 'cover'(기본)일 때 오버레이를 포털로 옮겨 붙일 앵커의 DOM id.
// App.tsx 도크 행의 "넓은 앵커"(프로젝트/프리셋/중앙을 감싸는 래퍼)가 이 id 를
// 갖는다 — 도크 DOM 은 옮기지 않고(재마운트 방지 계약) 오버레이만 앵커를 바꿔
// 좌우 패널 위까지 넓게 덮는다. 히스토리 도크는 앵커 밖이라 뷰어 옆에 남는다.
export const FLOAT_VIEW_WIDE_ANCHOR_ID = 'float-view-wide-anchor';

interface FloatView {
  id: number;
  component: ReactNode;
  priority: number;
  showToolbar?: boolean;
  onEscape?: () => void;
}

interface FloatViewContextProps {
  registerView: (view: FloatView) => void;
  unregisterView: (id: number) => void;
}

const FloatViewContext = createContext<FloatViewContextProps | undefined>(
  undefined,
);

export const useFloatView = (): FloatViewContextProps => {
  const context = useContext(FloatViewContext);
  if (!context) {
    throw new Error('useFloatView must be used within a FloatViewProvider');
  }
  return context;
};

interface FloatViewProviderProps {
  children: ReactNode;
}

export const FloatViewProvider: React.FC<FloatViewProviderProps> = observer(({
  children,
}) => {
  const [views, setViews] = useState<FloatView[]>([]);
  // 뷰별 백스택 핸들 보관 (id → handle). 안드로이드 뒤로가기가 중앙 백스택을
  // 통해 최상단 뷰부터 닫도록 각 뷰를 push 하고, 닫힐 때 remove 한다.
  const backHandles = useRef<Map<number, BackStackHandle>>(new Map());

  const registerView = (view: FloatView) => {
    setViews((prevViews) => [...prevViews, view].sort((a, b) => b.id - a.id));
    appState.incrementFloatView();
    backHandles.current.set(
      view.id,
      backStackService.push(() => view.onEscape?.()),
    );
  };

  const unregisterView = (id: number) => {
    setViews((prevViews) => prevViews.filter((view) => view.id !== id));
    appState.decrementFloatView();
    const handle = backHandles.current.get(id);
    if (handle) {
      handle.remove();
      backHandles.current.delete(id);
    }
  };

  const closeTopView = () => {
    const topView = views[0];
    if (topView && topView.onEscape) {
      topView.onEscape();
    }
  };

  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && views.length > 0) {
      closeTopView();
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [views]);

  // 안드로이드 뒤로가기 리스너를 부팅 직후 한 번 등록해 둔다. 오버레이가
  // 하나도 없을 때 뒤로가기를 눌러도 앱이 종료되지 않고 최소화되도록.
  useEffect(() => {
    backStackService.init();
  }, []);

  // showToolbar(하단 바 높이만큼 비워두기)는 하단 바가 이 오버레이가 덮는 영역 안에
  // 있는 모바일에서만 유효하다. PC 는 하단 바가 중앙 블록/도크 행 밖(전폭)이라 항상
  // 접근 가능 — 높이를 줄이면 그만큼 빈 띠만 생기므로 전체 높이를 쓴다.
  const overlay = !!views.length && (
    <div
      className={
        'top-0 left-0 absolute w-full z-[var(--z-float-view)] float-view ' +
        (views[0].showToolbar && isMobile ? 'show-toolbar' : 'h-full')
      }
    >
      {views.map((view) => (
        <div
          key={view.id}
          className="bg-[var(--c-surface)] h-full w-full"
          style={{ position: 'absolute', zIndex: view.id }}
        >
          <div className="flex flex-col h-full w-full">
            <div className="flex-none border-b line-color">
              <button
                className="text-default button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeTopView();
                }}
              >
                <FaTimes size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">{view.component}</div>
          </div>
        </div>
      ))}
    </div>
  );

  // 창 배치(환경설정 → 레이아웃): 'cover'(기본)=넓은 앵커에 포털로 붙어 프로젝트/
  // 프리셋 패널 위로 넓게 펼침(히스토리 도크는 앵커 밖이라 옆에 남음, v4.14.0 동작) /
  // 'center'=기존처럼 중앙 콘텐츠 블록만 덮음(좌우 패널 병행 열람).
  // 모바일은 도크가 없어 항상 center 경로. 앵커 미존재 시 center 로 안전 폴백.
  const wideAnchor =
    !isMobile && appState.uiFloatViewMode !== 'center' && overlay
      ? document.getElementById(FLOAT_VIEW_WIDE_ANCHOR_ID)
      : null;

  return (
    <FloatViewContext.Provider value={{ registerView, unregisterView }}>
      {children}
      {wideAnchor ? createPortal(overlay, wideAnchor) : overlay}
    </FloatViewContext.Provider>
  );
});

interface FloatViewProps {
  children: ReactNode;
  priority: number;
  showToolbar?: boolean;
  onEscape?: () => void;
}

let viewId = 0;

export const FloatView: React.FC<FloatViewProps> = memo(
  ({ children, priority, showToolbar, onEscape }) => {
    const { registerView, unregisterView } = useFloatView();
    const id = useRef(++viewId);

    useEffect(() => {
      const view = {
        id: id.current,
        component: children,
        priority,
        onEscape,
        showToolbar,
      };
      registerView(view);
      return () => unregisterView(id.current);
    }, []);

    return null;
  },
);
