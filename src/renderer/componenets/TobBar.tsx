import { useContext, useEffect, useState } from 'react';
import { FloatView } from './FloatView';
import ConfigScreen from './ConfigScreen';
import SessionSelect from './SessionSelect';
import { Session } from '../models/types';
import {
  loginService,
  backend,
  taskQueueService,
  imageService,
  isMobile,
} from '../models';
import { VscChromeMinimize, VscChromeMaximize, VscChromeRestore, VscChromeClose } from 'react-icons/vsc';
import { FaCog } from 'react-icons/fa';
import { appState } from '../models/AppService';
import { resolveLayout } from '../models/layoutTemplates';
import { observer } from 'mobx-react-lite';

const TobBar = observer(() => {
  // 컴팩트 템플릿(PC)은 하단바가 없어 세션(프로젝트) 선택을 상단바로 올린다.
  // 모바일은 resolveLayout 이 항상 classic 강제 → 기존 인라인 표시(md:hidden) 동작 무변화.
  const resolved = resolveLayout(appState.uiLayoutTemplate, isMobile);
  const sessionSelectTop = resolved.sessionSelectTop;
  // 'sidebar' 템플릿이면 프로젝트 선택기는 좌측 사이드 바가 담당 → 상단바엔 미렌더.
  const projectSidebar = resolved.projectSidebar;
  const [loggedIn, setLoggedIn] = useState(false);
  const [credits, setCredits] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setLoggedIn(loginService.loggedIn);
      if (!loginService.loggedIn) {
        setCredits(0);
        return;
      }
      (async () => {
        try {
          const credits = await backend.getRemainCredits();
          setCredits(credits);
        } catch (e) {
          // 로그인 표기는 ON인데 크레딧 조회가 실패 → 토큰 만료 의심 → 재검증
          // (만료면 OFF로 전환, 네트워크 일시 오류면 상태 유지)
          loginService.refresh();
        }
      })();
    };
    onChange();
    loginService.addEventListener('change', onChange);
    taskQueueService.addEventListener('complete', onChange);
    imageService.addEventListener('encode-vibe', onChange);
    return () => {
      loginService.removeEventListener('change', onChange);
      taskQueueService.removeEventListener('complete', onChange);
      imageService.removeEventListener('encode-vibe', onChange);
    };
  }, []);

  useEffect(() => {
    if (isMobile || !window.electron) return;
    const checkMaximized = async () => {
      try {
        const max = await window.electron.ipcRenderer.invoke('window-is-maximized');
        setIsMaximized(max);
      } catch (e) {}
    };
    checkMaximized();
    const onResize = () => checkMaximized();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [settings, setSettings] = useState(false);

  // 단축키에서 환경설정 열기 이벤트 수신
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail?.action;
      if (action === 'open-config') {
        setSettings(true);
      }
    };
    window.addEventListener('shortcut-action', handler);
    return () => window.removeEventListener('shortcut-action', handler);
  }, []);

  const handleMinimize = () => {
    window.electron?.ipcRenderer.invoke('window-minimize');
  };
  const handleMaximize = () => {
    window.electron?.ipcRenderer.invoke('window-maximize').then(() => {
      window.electron?.ipcRenderer.invoke('window-is-maximized').then(setIsMaximized);
    });
  };
  const handleClose = () => {
    window.electron?.ipcRenderer.invoke('window-close');
  };

  return (
    <div className="titlebar-drag flex border-b line-color px-3 py-2 items-center select-none gap-2">
      <div className="titlebar-no-drag gap-3 hidden md:flex text-sky-500 font-bold dark:text-white">
        SDStudio
      </div>
      {/* 컴팩트(sessionSelectTop): 세션 선택이 flex-1로 가운데를 차지하므로,
          Anlas·환경설정은 order-1, 창 컨트롤은 order-2로 우측 배치를 유지한다. */}
      <p
        className={
          'ml-auto mr-3 hidden md:block titlebar-no-drag' +
          (sessionSelectTop ? ' order-1' : '')
        }
      >
        {!loggedIn ? (
          <span className={`round-tag back-red`}>
            환경설정에서 로그인하세요
          </span>
        ) : (
          <>
            <span className="text-sub">Anlas: </span>{' '}
            {/* tabular-nums: 잔량이 줄어도 자릿수 폭이 고정돼 출렁이지 않게 */}
            <span className={`round-tag back-yellow tabular-nums`}>{credits}</span>
          </>
        )}
      </p>
      {/* PC: 환경설정 버튼 (가로 배치) - div 래퍼로 round-button display 충돌 방지 */}
      <div
        className={
          'hidden md:block titlebar-no-drag' +
          (sessionSelectTop ? ' order-1' : '')
        }
      >
        <button
          className="round-button back-sky"
          onClick={() => {
            setSettings(true);
          }}
        >
          환경설정
        </button>
      </div>
      {/* Mobile: 기본 = ⚙ 아이콘+크레딧 인라인(1줄 다이어트) / 클래식 툴바 = 기존 세로 배치 */}
      {appState.uiToolbar.classic ? (
        <div className="md:hidden flex flex-col items-center gap-1 titlebar-no-drag flex-none">
          <button
            className="round-button back-sky text-sm !px-3 !py-1 !min-w-0 !min-h-0"
            onClick={() => {
              setSettings(true);
            }}
          >
            환경설정
          </button>
          {!loggedIn ? (
            <span className="round-tag back-red text-sm !px-3 !py-1">로그인필요</span>
          ) : (
            <span className="round-tag back-yellow text-sm !px-3 !py-1">{credits}</span>
          )}
        </div>
      ) : (
        <div className="md:hidden flex items-center gap-1.5 titlebar-no-drag flex-none">
          <button
            className="icon-button flex-none"
            onClick={() => {
              setSettings(true);
            }}
          >
            <FaCog size={18} />
          </button>
          {!loggedIn ? (
            <span className="round-tag back-red text-sm !px-2 !py-1">로그인필요</span>
          ) : (
            <span className="round-tag back-yellow text-sm !px-2 !py-1">{credits}</span>
          )}
        </div>
      )}
      {/* 세션(프로젝트) 선택: 'sidebar' 템플릿이 아닐 때만. 모바일은 항상 인라인(md:hidden),
          컴팩트(PC)면 PC에서도 표시(block). sidebar 템플릿은 좌측 사이드 바가 담당. */}
      {/* 통짜 no-drag 를 주지 않는다 — SessionSelect 내부의 상호작용 요소만 no-drag 라,
          채워지지 않은 여백·버튼 사이 빈 공간은 drag 로 남아 창 이동 핸들이 된다. */}
      {!projectSidebar && (
        <div
          className={
            (sessionSelectTop ? '' : 'ml-auto ') +
            'flex-1 min-w-0 ' +
            (sessionSelectTop ? 'block' : 'block md:hidden')
          }
        >
          <SessionSelect />
        </div>
      )}

      {/* 윈도우 컨트롤 버튼 (PC only) */}
      {!isMobile && (
        <div
          className={
            'titlebar-no-drag hidden md:flex items-center ml-2 -mr-1' +
            (sessionSelectTop ? ' order-2' : '')
          }
        >
          <button
            className="window-control-btn"
            onClick={handleMinimize}
          >
            <VscChromeMinimize size={16} />
          </button>
          <button
            className="window-control-btn"
            onClick={handleMaximize}
          >
            {isMaximized ? <VscChromeRestore size={16} /> : <VscChromeMaximize size={16} />}
          </button>
          <button
            className="window-control-btn window-control-close"
            onClick={handleClose}
          >
            <VscChromeClose size={16} />
          </button>
        </div>
      )}

      {settings && (
        <ConfigScreen
          onSave={() => {
            setSettings(false);
          }}
          onClose={() => {
            setSettings(false);
          }}
        />
      )}
    </div>
  );
});

export default TobBar;
