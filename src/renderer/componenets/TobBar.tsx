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
      (async () => {
        try {
          const credits = await backend.getRemainCredits();
          setCredits(credits);
        } catch (e) {}
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
      <button
        className={`titlebar-no-drag round-button back-sky`}
        onClick={() => {
          setSettings(true);
        }}
      >
        환경설정
      </button>
      <p className="md:hidden ml-2 titlebar-no-drag">
        {!loggedIn ? (
          <span className={`round-tag back-red`}>로그인 필요</span>
        ) : (
          <>
            <span className={`round-tag back-yellow mr-2`}>{credits}</span>
          </>
        )}
      </p>
      <div className="ml-auto block md:hidden titlebar-no-drag">
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
