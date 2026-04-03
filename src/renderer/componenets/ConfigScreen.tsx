import React, { useEffect, useState, useCallback } from 'react';
import {
  backend,
  imageService,
  isMobile,
  localAIService,
  loginService,
  sessionService,
  taskQueueService,
} from '../models';
import { Config, ImageEditor, RemoveBgQuality } from '../../main/config';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { TaskLog } from '../models/TaskQueueService';
import {
  FaUser,
  FaImage,
  FaFolder,
  FaCog,
  FaTimes,
} from 'react-icons/fa';

interface ConfigScreenProps {
  onSave: () => void;
  onClose: () => void;
}

/* ── 탭 1: 로그인 ── */
const LoginTab = ({
  email, setEmail, password, setPassword,
  accessToken, setAccessToken,
  loggedIn, login, loginWithToken, roundTag,
}: any) => (
  <div className="space-y-5">
    <div>
      <label className="block text-sm font-semibold gray-label mb-2">NAI 로그인</label>
      <div className="flex gap-2 mb-2">
        <input className="gray-input block flex-1" type="text" placeholder="이메일"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="gray-input block flex-1" type="password" placeholder="암호"
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="flex items-center">
        <p className="flex items-center gap-1">
          <span className="text-sm gray-label">로그인 상태:</span>{' '}
          {loggedIn
            ? <span className={`${roundTag} back-green`}>Yes</span>
            : <span className={`${roundTag} back-red`}>No</span>}
        </p>
        <button className="back-sky py-1 px-3 rounded hover:brightness-95 active:brightness-90 ml-auto"
          onClick={login}>
          로그인
        </button>
      </div>
    </div>
    <hr className="border-gray-200 dark:border-slate-600" />
    <div>
      <label className="block text-sm font-semibold gray-label mb-2">
        액세스 토큰으로 로그인 (구글 연동 계정용)
      </label>
      <div className="flex gap-2 mb-2">
        <input className="gray-input block flex-1" type="password"
          placeholder="액세스 토큰을 붙여넣으세요"
          value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
      </div>
      <div className="flex items-center">
        <p className="text-xs gray-label opacity-70">NovelAI에서 발급받은 토큰을 입력하세요</p>
        <button className="back-sky py-1 px-3 rounded hover:brightness-95 active:brightness-90 ml-auto"
          onClick={loginWithToken}>
          토큰 로그인
        </button>
      </div>
    </div>
  </div>
);

/* ── 탭 2: 이미지 편집 및 배경 제거 ── */
const ImageEditTab = ({
  imageEditor, setImageEditor,
  useLocalBgRemoval, setUseLocalBgRemoval,
  ready, stage, progress, stageTexts,
  useGPU, setUseGPU, quality, setQuality,
}: any) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">선호 이미지 편집기</label>
      <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        value={imageEditor} onChange={(e) => setImageEditor(e.target.value)}>
        <option value="photoshop">포토샵</option>
        <option value="gimp">GIMP</option>
        <option value="mspaint">그림판</option>
      </select>
    </div>
    <hr className="border-gray-200 dark:border-slate-600" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgLocalBg" checked={useLocalBgRemoval}
        onChange={(e) => setUseLocalBgRemoval(e.target.checked)} />
      <label htmlFor="cfgLocalBg" className="text-sm gray-label">로컬 배경 제거 모델 사용</label>
    </div>
    {!ready && (
      <button className="w-full back-green py-2 rounded hover:brightness-95 active:brightness-90"
        onClick={() => { if (!localAIService.downloading) localAIService.download(); }}>
        {!localAIService.downloading
          ? '로컬 배경 제거 모델 설치'
          : stageTexts[stage] + ` (${(progress * 100).toFixed(2)}%)`}
      </button>
    )}
    {ready && (
      <>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="cfgGpu" checked={useGPU}
            onChange={(e) => setUseGPU(e.target.checked)} />
          <label htmlFor="cfgGpu" className="text-sm gray-label">
            배경 제거 시 GPU 사용{' '}
            <a onClick={() => backend.openWebPage('https://developer.nvidia.com/cuda-11-8-0-download-archive')}
              className="underline text-blue-500 cursor-pointer">(CUDA를 설치 해야함)</a>
          </label>
        </div>
        <div>
          <label className="block text-sm gray-label mb-1">배경 제거 퀄리티</label>
          <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            value={quality} onChange={(e) => setQuality(e.target.value)}>
            <option value="low">낮음</option>
            <option value="normal">보통</option>
            <option value="high">높음</option>
            <option value="veryhigh">매우높음</option>
            <option value="veryveryhigh">최고 (메모리 최소 8기가)</option>
          </select>
        </div>
      </>
    )}
  </div>
);

/* ── 탭 3: 이미지 및 데이터 저장경로 ── */
const StorageTab = ({
  saveLocation, selectFolder, clearImageCache,
  refreshImage, setRefreshImage,
}: any) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">현재 저장경로</label>
      <div className="text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-slate-700 rounded px-3 py-2 break-all">
        {saveLocation || '기본 위치'}
      </div>
    </div>
    <button className="w-full back-green py-2 rounded hover:brightness-95 active:brightness-90"
      onClick={selectFolder}>
      이미지 및 데이터 저장 위치 변경
    </button>
    <hr className="border-gray-200 dark:border-slate-600" />
    <button className="w-full back-red py-2 rounded hover:brightness-95 active:brightness-90"
      onClick={clearImageCache}>
      이미지 캐시 초기화
    </button>
    <hr className="border-gray-200 dark:border-slate-600" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgRefresh" checked={refreshImage}
        onChange={(e) => setRefreshImage(e.target.checked)} />
      <label htmlFor="cfgRefresh" className="text-sm gray-label">이미지 폴더 직접 편집 감지</label>
    </div>
  </div>
);

/* ── 탭 4: 기타 설정 ── */
const OtherTab = ({
  whiteMode, setWhiteMode,
  delayTime, setDelayTime,
}: any) => (
  <div className="space-y-4">
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgWhite" checked={whiteMode}
        onChange={(e) => setWhiteMode(e.target.checked)} />
      <label htmlFor="cfgWhite" className="text-sm gray-label">화이트 모드 켜기</label>
    </div>
    <hr className="border-gray-200 dark:border-slate-600" />
    <div>
      <label className="block text-sm gray-label mb-1">
        기본 지연 시간 조정 (0ms ~ 1000ms)
      </label>
      <div className="flex items-center gap-2">
        <input type="range" min={0} max={1000} step={1}
          value={delayTime} onChange={(e) => setDelayTime(parseInt(e.target.value))}
          className="flex-1" />
        <span className="text-sm gray-label w-14 text-right">{delayTime}ms</span>
      </div>
    </div>
    <hr className="border-gray-200 dark:border-slate-600" />
    <TaskLogSection />
  </div>
);

/* ── 작업 로그 ── */
const TaskLogSection = () => {
  const [showDialog, setShowDialog] = useState(false);
  const logs = taskQueueService.taskLogs;

  const formatLog = (log: TaskLog) => {
    const date = new Date(log.timestamp);
    const time = date.toLocaleTimeString('ko-KR', { hour12: false });
    const levelLabel = log.level === 'error' ? '[오류]' : log.level === 'warn' ? '[경고]' : '[정보]';
    return `${time} ${levelLabel} [${log.scene}] ${log.message}`;
  };

  const downloadLogs = () => {
    const text = logs.map(formatLog).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sdstudio-task-log-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <button className="w-full back-gray py-2 rounded hover:brightness-95 active:brightness-90 text-sm"
        onClick={() => setShowDialog(true)}>
        작업 로그 보기
      </button>
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDialog(false); }}>
          <div className="bg-white dark:bg-slate-700 rounded-lg shadow-xl w-[90vw] max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-slate-600">
              <span className="font-bold text-default">작업 로그</span>
              <button className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-lg px-2"
                onClick={() => setShowDialog(false)}>✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 text-xs font-mono">
              {logs.length === 0
                ? <p className="text-gray-400 text-center py-4">로그가 없습니다.</p>
                : [...logs].reverse().map((log, i) => (
                    <div key={i} className={'py-0.5 ' +
                      (log.level === 'error' ? 'text-red-500' : log.level === 'warn' ? 'text-yellow-500' : 'text-default')}>
                      {formatLog(log)}
                    </div>
                  ))
              }
            </div>
            <div className="flex gap-2 p-3 border-t border-gray-200 dark:border-slate-600">
              <button className="flex-1 back-sky py-2 rounded text-sm hover:brightness-95 active:brightness-90"
                onClick={downloadLogs} disabled={logs.length === 0}>다운로드</button>
              <button className="flex-1 back-gray py-2 rounded text-sm hover:brightness-95 active:brightness-90"
                onClick={() => taskQueueService.clearLogs()} disabled={logs.length === 0}>초기화</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/* ── 메인 ConfigScreen ── */
const ConfigScreen = observer(({ onSave, onClose }: ConfigScreenProps) => {
  const { curSession } = appState;
  const [activeTab, setActiveTab] = useState(0);

  // state
  const [imageEditor, setImageEditor] = useState('');
  const [useGPU, setUseGPU] = useState(false);
  const [whiteMode, setWhiteMode] = useState(false);
  const [delayTime, setDelayTime] = useState(0);
  const [useLocalBgRemoval, setUseLocalBgRemoval] = useState(false);
  const [refreshImage, setRefreshImage] = useState(false);
  const [ready, setReady] = useState(false);
  const [quality, setQuality] = useState('');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [saveLocation, setSaveLocation] = useState('');

  useEffect(() => {
    (async () => {
      const config = await backend.getConfig();
      setWhiteMode(config.whiteMode ?? false);
      setImageEditor(config.imageEditor ?? 'photoshop');
      setUseGPU(config.useCUDA ?? false);
      setQuality(config.removeBgQuality ?? 'normal');
      setRefreshImage(config.refreshImage ?? false);
      setUseLocalBgRemoval(config.useLocalBgRemoval ?? false);
      setDelayTime(config.delayTime ?? 0);
      setSaveLocation(config.saveLocation ?? '');
    })();
    const checkReady = () => setReady(localAIService.ready);
    const onProgress = (e: any) => setProgress(e.detail.percent);
    const onStage = (e: any) => setStage(e.detail.stage);
    checkReady();
    localAIService.addEventListener('updated', checkReady);
    localAIService.addEventListener('progress', onProgress);
    localAIService.addEventListener('stage', onStage);
    return () => {
      localAIService.removeEventListener('updated', checkReady);
      localAIService.removeEventListener('progress', onProgress);
      localAIService.removeEventListener('stage', onStage);
    };
  }, []);

  // Escape 키로 닫기
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [handleEscape]);

  const roundTag = 'text-white text-xs px-2 py-1 rounded-full';

  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    const onChange = () => setLoggedIn(loginService.loggedIn);
    onChange();
    loginService.addEventListener('change', onChange);
    return () => loginService.removeEventListener('change', onChange);
  }, []);

  const login = async () => {
    try {
      await loginService.login(email, password);
    } catch (err: any) {
      appState.pushMessage('로그인 실패:' + err.message);
    }
  };

  const loginWithToken = async () => {
    try {
      if (!accessToken.trim()) {
        appState.pushMessage('액세스 토큰을 입력해주세요.');
        return;
      }
      await loginService.loginWithToken(accessToken.trim());
      appState.pushMessage('토큰으로 로그인 성공!');
      setAccessToken('');
    } catch (err: any) {
      appState.pushMessage('토큰 로그인 실패:' + err.message);
    }
  };

  const clearImageCache = async () => {
    if (!curSession) return;
    appState.pushMessage('이미지 캐시 초기화 시작');
    for (const scene of Object.values(curSession.scenes)) {
      try {
        await backend.deleteDir(imageService.getImageDir(curSession, scene) + '/fastcache');
      } catch (e) {}
    }
    imageService.cache.cache.clear();
    await imageService.refreshBatch(curSession);
    appState.pushDialog({ type: 'yes-only', text: '이미지 캐시 초기화 완료' });
  };

  const selectFolder = async () => {
    const folder = await backend.selectDir();
    if (!folder) return;
    const config = await backend.getConfig();
    config.saveLocation = folder;
    await backend.setConfig(config);
    setSaveLocation(folder);
    appState.pushDialog({ type: 'yes-only', text: '저장 위치 지정 완료. 프로그램을 껐다 켜주세요' });
  };

  const stageTexts = ['모델 다운로드 중...', '모델 가중치 다운로드 중...', '모델 압축 푸는 중...'];

  const handleSave = async () => {
    const old = await backend.getConfig();
    const config: Config = {
      ...old,
      imageEditor: imageEditor as ImageEditor,
      useCUDA: useGPU,
      modelType: 'quality',
      removeBgQuality: quality as RemoveBgQuality,
      refreshImage: refreshImage,
      whiteMode: whiteMode,
      useLocalBgRemoval: useLocalBgRemoval,
      delayTime: delayTime,
    };
    await backend.setConfig(config);
    if (old.useCUDA !== useGPU) localAIService.modelChanged();
    sessionService.configChanged();
    onSave();
  };

  const tabs = [
    { label: '로그인', icon: <FaUser size={14} /> },
    ...(!isMobile ? [{ label: '이미지 편집', icon: <FaImage size={14} /> }] : []),
    { label: '저장경로', icon: <FaFolder size={14} /> },
    { label: '기타', icon: <FaCog size={14} /> },
  ];

  const getTabContent = (tabIdx: number) => {
    const idx = isMobile && tabIdx >= 1 ? tabIdx + 1 : tabIdx;
    switch (idx) {
      case 0:
        return <LoginTab {...{ email, setEmail, password, setPassword, accessToken, setAccessToken, loggedIn, login, loginWithToken, roundTag }} />;
      case 1:
        return <ImageEditTab {...{ imageEditor, setImageEditor, useLocalBgRemoval, setUseLocalBgRemoval, ready, stage, progress, stageTexts, useGPU, setUseGPU, quality, setQuality }} />;
      case 2:
        return <StorageTab {...{ saveLocation, selectFolder, clearImageCache, refreshImage, setRefreshImage }} />;
      case 3:
        return <OtherTab {...{ whiteMode, setWhiteMode, delayTime, setDelayTime }} />;
      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 2000,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <div
        className="w-[90vw] max-w-lg max-h-[85vh] bg-white dark:bg-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-slate-600"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-slate-600 flex-none">
          <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">환경설정</h1>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-500 dark:text-gray-400 transition-colors"
            onClick={onClose}
          >
            <FaTimes size={16} />
          </button>
        </div>
        {/* 탭 바 */}
        <div className="flex border-b border-gray-200 dark:border-slate-600 px-2 flex-none">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              className={
                'flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 ' +
                (activeTab === i
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')
              }
              onClick={() => setActiveTab(i)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        {/* 탭 콘텐츠 — CSS Grid로 모든 탭을 같은 셀에 겹쳐 높이 통일 */}
        <div className="flex-1 overflow-auto p-5" style={{ minHeight: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }}>
            {tabs.map((_, i) => (
              <div
                key={i}
                style={{
                  gridRow: 1,
                  gridColumn: 1,
                  visibility: activeTab === i ? 'visible' : 'hidden',
                }}
              >
                {getTabContent(i)}
              </div>
            ))}
          </div>
        </div>
        {/* 저장 버튼 */}
        <div className="flex-none p-4 border-t border-gray-200 dark:border-slate-600">
          <button className="w-full back-sky py-2.5 rounded-lg hover:brightness-95 active:brightness-90 font-medium"
            onClick={handleSave}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
});

export default ConfigScreen;
