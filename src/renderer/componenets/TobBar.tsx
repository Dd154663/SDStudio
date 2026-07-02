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

const TobBar = () => {
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
      <p className="ml-auto mr-3 hidden md:block titlebar-no-drag">
        {!loggedIn ? (
          <span className={`round-tag back-red`}>
            환경설정에서 로그인하세요
          </span>
        ) : (
          <>
            <span className="text-sub">Anlas: </span>{' '}
            <span className={`round-tag back-yellow`}>{credits}</span>
          </>
        )}
      </p>
      {/* PC: 환경설정 버튼 (가로 배치) - div 래퍼로 round-button display 충돌 방지 */}
      <div className="hidden md:block titlebar-no-drag">
        <button
          className="round-button back-sky"
          onClick={() => {
            setSettings(true);
          }}
        >
          환경설정
        </button>
      </div>
      {/* Mobile: 환경설정 + 크레딧 세로 배치 (가로 공간 절약) */}
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
      <div className="ml-auto block md:hidden titlebar-no-drag flex-1 min-w-0">
        <SessionSelect />
      </div>

      {/* 윈도우 컨트롤 버튼 (PC only) */}
      {!isMobile && (
        <div className="titlebar-no-drag hidden md:flex items-center ml-2 -mr-1">
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
};

export default TobBar;
