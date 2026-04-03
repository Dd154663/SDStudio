import { useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import Tooltip from './Tooltip';

const ResizableSplitter = observer(() => {
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
      const delta = ev.clientX - startX;
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
  }, []);

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
        {appState.leftPanelCollapsed
          ? <FaChevronRight size={10} />
          : <FaChevronLeft size={10} />
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
