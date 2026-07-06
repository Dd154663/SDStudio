import React, {
  createContext,
  useContext,
  useState,
  memo,
  useEffect,
  ReactNode,
  useRef,
} from 'react';
import { FaTimes } from 'react-icons/fa';
import { appState } from '../models/AppService';
import { backStackService, BackStackHandle } from '../models/BackStackService';

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

export const FloatViewProvider: React.FC<FloatViewProviderProps> = ({
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

  return (
    <FloatViewContext.Provider value={{ registerView, unregisterView }}>
      {children}
      {!!views.length && (
        <div
          className={
            'top-0 absolute w-full z-[var(--z-float-view)] float-view ' +
            (views[0].showToolbar ? 'show-toolbar' : 'h-full')
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
      )}
    </FloatViewContext.Provider>
  );
};

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
