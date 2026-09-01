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
  opusUsageService,
  sessionService,
} from '../models';
import { VscChromeMinimize, VscChromeMaximize, VscChromeRestore, VscChromeClose } from 'react-icons/vsc';
import { FaCog, FaCoins } from 'react-icons/fa';
import { appState } from '../models/AppService';
import { resolveLayout } from '../models/layoutTemplates';
import { observer } from 'mobx-react-lite';
import OpusUsageBadge from './OpusUsageBadge';
import { normalizeTokenRotateWarning } from '../models/tokenAutoRotation';

const TobBar = observer(() => {
  // 컴팩트 템플릿(PC)은 하단바가 없어 세션(프로젝트) 선택을 상단바로 올린다.
  // 모바일은 resolveLayout 이 항상 classic 강제 → 기존 인라인 표시(md:hidden) 동작 무변화.
  const resolved = resolveLayout(appState.uiLayoutTemplate, isMobile);
  const sessionSelectTop = resolved.sessionSelectTop;
  // 'sidebar' 템플릿이면 프로젝트 선택기는 좌측 사이드 바가 담당 → 상단바엔 미렌더.
  // 'modern' 템플릿(projectStrip)은 프로젝트 툴바 완전 제거 — 좌측 스트립+드로어가 담당.
  const projectSidebar = resolved.projectSidebar || resolved.projectStrip;
  const [loggedIn, setLoggedIn] = useState(false);
  const [credits, setCredits] = useState(0);
  const [warningPercent, setWarningPercent] = useState(10);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      backend.getConfig().then((config) => {
        if (!cancelled) setWarningPercent(normalizeTokenRotateWarning(config.multiTokenRotateWarningPercent));
      }).catch(() => {});
    };
    load();
    sessionService.addEventListener('config-changed', load);
    return () => { cancelled = true; sessionService.removeEventListener('config-changed', load); };
  }, []);

  useEffect(() => {
    let accountRevision = 0;
    const onChange = () => {
      const revision = accountRevision;
      setLoggedIn(loginService.loggedIn);
      if (!loginService.loggedIn) {
        setCredits(0);
        opusUsageService.clear();
        return;
      }
      (async () => {
        try {
          const credits = await backend.getRemainCredits();
          if (revision !== accountRevision) return;
          setCredits(credits);
          opusUsageService.refresh().catch(() => {});
        } catch (e) {
          // 로그인 표기는 ON인데 크레딧 조회가 실패 → 토큰 만료 의심 → 재검증
          // (만료면 OFF로 전환, 네트워크 일시 오류면 상태 유지)
          if (revision === accountRevision) loginService.refresh();
        }
      })();
    };
    const onLoginChange = () => {
      accountRevision++;
      opusUsageService.invalidateAccount();
      onChange();
    };
    onChange();
    loginService.addEventListener('change', onLoginChange);
    taskQueueService.addEventListener('complete', onChange);
    imageService.addEventListener('encode-vibe', onChange);
    return () => {
      accountRevision++;
      loginService.removeEventListener('change', onLoginChange);
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
    // zone-bar: 구역 카드화 마감 — PC 새 마감에선 캔버스 프레임에 통합(App.css)
    <div className="zone-bar titlebar-drag flex border-b line-color px-3 py-2 items-center select-none gap-2">
      {/* 좁은 창(768~1024) 다이어트: 장식성 요소는 lg(1024) 미만에서 숨긴다 —
          두 창 나란히(960px) 배치 시 공간 확보. md 미만(모바일) 동작은 무변화. */}
      <div className="titlebar-no-drag gap-3 hidden lg:flex text-sky-500 font-bold dark:text-white">
        SDStudio
      </div>
      {/* 컴팩트(sessionSelectTop): 세션 선택이 flex-1로 가운데를 차지하므로,
          Anlas·환경설정은 order-1, 창 컨트롤은 order-2로 우측 배치를 유지한다. */}
      <div
        className={
          'ml-auto hidden md:flex items-center gap-2 flex-none titlebar-no-drag' +
          (sessionSelectTop ? ' order-1' : '')
        }
      >
        <div className="flex items-center gap-2" role="group" aria-label="계정 상태 및 환경설정">
        {!loggedIn ? (
          <span className="account-status-control back-red text-sm">
            {/* 좁은 창(<lg)에서는 모바일과 같은 축약 문구 */}
            <span className="lg:hidden">로그인필요</span>
            <span className="hidden lg:inline">환경설정에서 로그인하세요</span>
          </span>
        ) : (
          <>
            {/* tabular-nums: 잔량이 줄어도 자릿수 폭이 고정돼 출렁이지 않게 */}
            <span className="account-status-control back-yellow tabular-nums text-sm gap-1.5" aria-label={`Anlas ${credits}`}>
              <FaCoins size={15} aria-hidden="true" />
              <span>{credits}</span>
            </span>
            <OpusUsageBadge warningPercent={warningPercent} />
          </>
        )}
        <button
          className="btn account-status-control back-sky text-sm"
          aria-label="환경설정"
          onClick={() => {
            setSettings(true);
          }}
        >
          {/* 좁은 창(<lg)에서는 톱니 아이콘으로 축약 */}
          <FaCog size={16} className="lg:hidden" />
          <span className="hidden lg:inline">환경설정</span>
        </button>
        </div>
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
            <OpusUsageBadge credits={credits} warningPercent={warningPercent} />
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
            <OpusUsageBadge credits={credits} warningPercent={warningPercent} />
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
