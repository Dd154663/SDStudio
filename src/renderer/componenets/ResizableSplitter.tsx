import { useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import Tooltip from './Tooltip';

// reversed: 프리셋 패널이 오른쪽 슬롯(presetSide='right')일 때 true —
// 스플리터가 패널의 왼쪽에 놓이므로 드래그 델타·접기 화살표 방향을 반전한다.
const ResizableSplitter = observer(({ reversed }: { reversed?: boolean }) => {
  const isDragging = useRef(false);
  const splitterRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (appState.leftPanelCollapsed) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;

    const startX = e.clientX;
    const startWidth = appState.leftPanelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = (ev.clientX - startX) * (reversed ? -1 : 1);
      const maxWidth = Math.floor(window.innerWidth * 0.6);
      const newWidth = Math.max(250, Math.min(maxWidth, startWidth + delta));
      appState.setLeftPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [reversed]);

  const toggleCollapse = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    appState.toggleLeftPanel();
  }, []);

  return (
    <div
      ref={splitterRef}
      className={
        'flex-none flex flex-col items-center group ' +
        (appState.leftPanelCollapsed
          ? 'w-5 cursor-pointer'
          : 'w-1.5 cursor-col-resize')
      }
      onMouseDown={appState.leftPanelCollapsed ? undefined : onMouseDown}
      onDoubleClick={appState.leftPanelCollapsed ? toggleCollapse : undefined}
    >
      {/* 접기/펼치기 버튼 */}
      <Tooltip content={appState.leftPanelCollapsed ? '패널 펼치기' : '패널 접기'}>
      <button
        className="splitter-toggle-btn"
        onClick={toggleCollapse}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 화살표 = 패널이 이동할 방향: 펼치기(collapsed)는 패널 쪽으로,
            접기는 패널 반대쪽으로. reversed(프리셋 우측)면 좌우 반전 */}
        {appState.leftPanelCollapsed
          ? (reversed ? <FaChevronLeft size={10} /> : <FaChevronRight size={10} />)
          : (reversed ? <FaChevronRight size={10} /> : <FaChevronLeft size={10} />)
        }
      </button>
      </Tooltip>
      {/* 드래그 핸들 바 */}
      <div className={
        'flex-1 rounded-full transition-colors ' +
        (appState.leftPanelCollapsed
          ? 'w-0.5 bg-gray-300 dark:bg-slate-600'
          : 'w-full bg-gray-300 dark:bg-slate-600 group-hover:bg-sky-400 dark:group-hover:bg-sky-500')
      } />
    </div>
  );
});

export default ResizableSplitter;
