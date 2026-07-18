import React, { useEffect, useState, useCallback } from 'react';
import {
  appUpdateNoticeService,
  backend,
  imageService,
  isMobile,
  localAIService,
  loginService,
  sessionService,
  taskQueueService,
} from '../models';
import { Config, ImageEditor, RemoveBgQuality, UiThemeConfig, UiToolbarConfig } from '../../main/config';
import ToolbarLayoutEditor from './ToolbarLayoutEditor';
import { projectToolbarRegistry, sceneToolbarRegistry, portableButtonMetas } from '../models/uiLayout';
import { GLOBAL_ACTIONS, globalActionMeta, DEFAULT_QUICK_MENU } from '../models/globalActions';
import { platform } from '../models/platform';
import { buildThemeVars, isHex6 } from '../models/uiTheme';
import { themeTemplates } from '../models/themeTemplates';
import { layoutTemplates } from '../models/layoutTemplates';
import {
  assignCompanion,
  removeCompanion,
  companionOwnerOf,
  COMPANION_HOSTS,
  COMPANION_HOST_LABELS,
  MODERN_COMPANION_DEFAULTS,
} from '../models/companionSlots';
import { applyCompanionSlots } from './CompanionDnd';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { TaskLog } from '../models/TaskQueueService';
import {
  FaUser,
  FaFolder,
  FaCog,
  FaTimes,
  FaKeyboard,
  FaWrench,
  FaPalette,
  FaSlidersH,
  FaThLarge,
  FaColumns,
} from 'react-icons/fa';
import { keyboardShortcutService, KeyboardShortcutService } from '../models/KeyboardShortcutService';
import { migrationService } from '../models/MigrationService';
import type { MigrationDiagStatus } from '../models/MigrationService';
import { persistService } from '../models/PersistenceService';
import {
  scanLegacyRemnants,
  deleteLegacyRemnants,
} from '../models/legacyCleanup';
import type { LegacyScanResult } from '../models/legacyCleanup';
import ModalOverlay from './ModalOverlay';
import MobileColorPicker from './MobileColorPicker';

interface ConfigScreenProps {
  onSave: () => void;
  onClose: () => void;
}

/* ── 탭 1: 로그인 ── */
const LoginTab = ({
  accessToken, setAccessToken,
  loggedIn, loginWithToken, roundTag,
}: any) => (
  <div className="space-y-5">
    <div>
      <label className="block text-sm font-semibold gray-label mb-2">
        API 토큰으로 로그인
      </label>
      <div className="flex gap-2 mb-2">
        <input className="gray-input block flex-1" type="password"
          placeholder="API 토큰을 붙여넣으세요"
          value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
      </div>
      <div className="flex items-center">
        <p className="flex items-center gap-1">
          <span className="text-sm gray-label">로그인 상태:</span>{' '}
          {loggedIn
            ? <span className={`${roundTag} back-green`}>Yes</span>
            : <span className={`${roundTag} back-red`}>No</span>}
        </p>
        <button className="btn back-sky py-1 px-3 rounded ml-auto"
          onClick={loginWithToken}>
          토큰 로그인
        </button>
      </div>
    </div>
    <hr className="line-color" />
    {/* 토큰 발급/로그인 가이드 */}
    <div className="rounded-lg border line-color bg-gray-50 dark:bg-slate-700/40 p-4 text-sm text-body">
      <p className="font-medium mb-1">토큰 발급 방법</p>
      <ol className="list-decimal list-inside space-y-1 mb-3 leading-relaxed text-body">
        <li>
          <a
            className="text-sky-500 hover:text-sky-400 cursor-pointer underline"
            onClick={() => backend.openWebPage('https://novelai.net')}
          >
            NovelAI 공식 웹사이트
          </a>
          에 로그인
        </li>
        <li>좌측 사이드바의 톱니바퀴 아이콘 (User Settings) 클릭</li>
        <li>Account 탭으로 이동</li>
        <li>"Get Persistent API Token" 버튼 클릭</li>
        <li>프롬프트가 표시됨. 처음 생성해도 "overwrite" 메시지가 뜰 수 있으며 이는 정상</li>
        <li>복사 아이콘으로 토큰을 클립보드에 복사</li>
      </ol>
      <p className="font-medium mb-1">로그인 방법</p>
      <ol className="list-decimal list-inside space-y-1 leading-relaxed text-body">
        <li>위 "API 토큰으로 로그인" 칸에 복사한 토큰을 붙여넣고 [토큰 로그인] 클릭</li>
      </ol>
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
      <select className="mt-1 block w-full rounded-md line-color shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        value={imageEditor} onChange={(e) => setImageEditor(e.target.value)}>
        <option value="photoshop">포토샵</option>
        <option value="gimp">GIMP</option>
        <option value="mspaint">그림판</option>
      </select>
    </div>
    <hr className="line-color" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgLocalBg" checked={useLocalBgRemoval}
        onChange={(e) => setUseLocalBgRemoval(e.target.checked)} />
      <label htmlFor="cfgLocalBg" className="text-sm gray-label">로컬 배경 제거 모델 사용</label>
    </div>
    {!ready && (
      <button className="btn w-full back-green py-2 rounded"
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
          <select className="mt-1 block w-full rounded-md line-color shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
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
  defaultExportFolder, setDefaultExportFolder, selectDefaultExportFolder,
  autoConvertWebp, setAutoConvertWebp, autoWebpQuality, setAutoWebpQuality,
}: any) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">현재 저장경로</label>
      <div className="text-sm text-muted bg-gray-100 dark:bg-slate-700 rounded px-3 py-2 break-all">
        {saveLocation || '기본 위치'}
      </div>
    </div>
    <button className="btn w-full back-green py-2 rounded"
      onClick={selectFolder}>
      이미지 및 데이터 저장 위치 변경
    </button>
    <hr className="line-color" />
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">기본 내보내기 폴더</label>
      <p className="text-xs text-muted mb-2">
        내보내기 프리셋에 폴더가 지정되지 않았을 때 사용할 기본 폴더입니다.
      </p>
      <div className="text-sm text-muted bg-gray-100 dark:bg-slate-700 rounded px-3 py-2 break-all">
        {defaultExportFolder || '미설정 (프리셋별 폴더를 사용하세요)'}
      </div>
    </div>
    <div className="flex gap-2">
      <button className="btn flex-1 back-green py-2 rounded"
        onClick={selectDefaultExportFolder}>
        기본 내보내기 폴더 지정
      </button>
      {defaultExportFolder && (
        <button className="btn px-3 back-gray py-2 rounded"
          onClick={() => setDefaultExportFolder('')}>
          지우기
        </button>
      )}
    </div>
    <hr className="line-color" />
    <button className="btn w-full back-red py-2 rounded"
      onClick={clearImageCache}>
      이미지 캐시 초기화
    </button>
    <hr className="line-color" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgRefresh" checked={refreshImage}
        onChange={(e) => setRefreshImage(e.target.checked)} />
      <label htmlFor="cfgRefresh" className="text-sm gray-label">이미지 폴더 직접 편집 감지</label>
    </div>
    <hr className="line-color" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgAutoWebp" checked={autoConvertWebp}
        onChange={(e) => setAutoConvertWebp(e.target.checked)} />
      <label htmlFor="cfgAutoWebp" className="text-sm gray-label">새로 생성되는 이미지를 WebP로 자동 변환</label>
    </div>
    <p className="text-xs text-muted">
      생성 직후 PNG를 WebP로 재인코딩해 저장 용량을 줄입니다. 프롬프트
      메타데이터와 NAI 인식(스텔스 워터마크)은 유지되며, 기존 이미지에는 영향이
      없습니다. 변환에 실패하면 원본 PNG가 그대로 저장됩니다.
    </p>
    {autoConvertWebp && (
      <div className="flex items-center gap-2">
        <label htmlFor="cfgAutoWebpQ" className="text-sm gray-label">변환 품질 (1~100)</label>
        <input
          type="number"
          id="cfgAutoWebpQ"
          min={1}
          max={100}
          value={autoWebpQuality}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            setAutoWebpQuality(isNaN(v) ? 80 : Math.min(100, Math.max(1, v)));
          }}
          className="w-16 text-sm text-center border rounded px-1 py-1 back-gray"
        />
      </div>
    )}
    <hr className="line-color" />
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">이미지 복구 (실험적 기능)</label>
      <p className="text-xs text-muted mb-2">
        이미지 파일은 존재하지만 프로그램에서 보이지 않는 경우, 파일시스템을 스캔하여 누락된 씬과 이미지를 재연결합니다.
      </p>
      <button
        className="px-4 py-2 rounded-lg btn-solid-orange text-sm font-medium transition-colors"
        onClick={() => appState.recoverProjectImages()}
      >
        현재 프로젝트 이미지 복구
      </button>
    </div>
  </div>
);

/* ── 탭: 저장/이미지 (저장경로 + 이미지 편집 병합) ── */
const StorageImageTab = (props: any) => (
  <div className="space-y-4">
    <StorageTab {...props} />
    <hr className="line-color" />
    <ImageEditTab {...props} />
  </div>
);

/* ── 탭(모바일 전용): 이미지 복구 ──
   데스크탑은 '저장경로' 탭에 같은 기능이 있으나, 모바일은 그 탭을 숨기므로
   복구 기능만 떼어 별도 탭으로 제공한다. recoverProjectImages()는 백엔드 공용
   메서드(listFiles/refreshBatch)만 사용하므로 모바일에서도 그대로 동작한다. */
const RecoveryTab = () => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">
        이미지 복구 (실험적 기능)
      </label>
      <p className="text-xs text-muted mb-2">
        이미지 파일은 존재하지만 프로그램에서 보이지 않는 경우(씬에 이미지 개수만
        뜨고 썸네일이 비어 있는 등), 파일시스템을 다시 스캔하여 누락된 씬과
        이미지를 재연결합니다.
      </p>
      <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
        ⚠️ 저장소 접근이 안정된 상태에서 실행하세요. 파일을 읽지 못하는 순간에는
        복구가 동작하지 않을 수 있습니다. 이 기능은 파일을 삭제하지 않습니다.
      </p>
      <button
        className="px-4 py-2 rounded-lg btn-solid-orange text-sm font-medium transition-colors"
        onClick={() => appState.recoverProjectImages()}
      >
        현재 프로젝트 이미지 복구
      </button>
    </div>
  </div>
);

/* ── 폴더 정리 공통 컴포넌트 ── */
const FolderCleanupSection = ({ folder, label, description }: { folder: string; label: string; description?: string }) => {
  const [files, setFiles] = useState<{ name: string; size: number; mtime: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [days, setDays] = useState(7);
  const [loaded, setLoaded] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const stats = await backend.listFilesWithStats(folder);
      stats.sort((a: any, b: any) => b.mtime - a.mtime);
      setFiles(stats);
      setLoaded(true);
    } catch {
      setFiles([]);
      setLoaded(true);
    }
    setLoading(false);
  }, [folder]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const now = Date.now();
  const oldFiles = files.filter((f) => now - f.mtime > days * 24 * 60 * 60 * 1000);
  const oldSize = oldFiles.reduce((sum, f) => sum + f.size, 0);

  const deleteFiles = async (targets: { name: string }[]) => {
    setCleaning(true);
    for (const f of targets) {
      try {
        await backend.deleteFile(folder + '/' + f.name);
      } catch {}
    }
    await loadFiles();
    setCleaning(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="block text-sm gray-label font-bold">{label}</label>
        <button
          className="btn text-xs back-gray px-2 py-0.5 rounded"
          onClick={loadFiles}
          disabled={loading}
        >
          {loading ? '조회 중...' : loaded ? '새로고침' : '조회'}
        </button>
      </div>
      {description && <div className="text-xs text-faint">{description}</div>}
      {loaded && (
        <>
          <div className="text-sm gray-label">
            파일 {files.length}개 · 총 {formatSize(totalSize)}
          </div>
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  className="btn text-sm back-red px-3 py-1.5 rounded"
                  onClick={() => {
                    if (confirm(`${label}의 모든 파일(${files.length}개, ${formatSize(totalSize)})을 삭제합니다.`)) {
                      deleteFiles(files);
                    }
                  }}
                  disabled={cleaning}
                >
                  전체 삭제
                </button>
                <div className="flex items-center gap-1 flex-wrap">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={days}
                    onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 7))}
                    className="w-14 text-sm text-center border rounded px-1 py-1 back-gray"
                  />
                  <span className="text-sm gray-label whitespace-nowrap">일 이전만</span>
                  <button
                    className="btn text-sm back-orange px-3 py-1.5 rounded"
                    onClick={() => {
                      if (oldFiles.length === 0) {
                        alert(`${days}일 이전 파일이 없습니다.`);
                        return;
                      }
                      if (confirm(`${days}일 이전 파일 ${oldFiles.length}개(${formatSize(oldSize)})를 삭제합니다.`)) {
                        deleteFiles(oldFiles);
                      }
                    }}
                    disabled={cleaning || oldFiles.length === 0}
                  >
                    {oldFiles.length > 0 ? `${oldFiles.length}개 삭제` : '해당 없음'}
                  </button>
                </div>
              </div>
              {cleaning && <div className="text-sm text-sky-500">삭제 중...</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
};

/* ── 시스템 탭 하위: 구 저장소 잔재 정리 (트랙1 B4) ──
   마이그레이션 후 구 루트(outs/inpaints/… 7종)에 남은 고아 폴더·파일을 스캔해
   사용자 확인 후 정리한다. PC=OS 휴지통 이동(복구 가능), 모바일=영구 삭제.
   미이동 프로젝트 json 잔존 시 스캔이 차단 사유를 반환한다(legacyCleanup.ts). */
const LegacyCleanupSection = () => {
  const [scan, setScan] = useState<LegacyScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const doScan = async () => {
    setScanning(true);
    try {
      setScan(await scanLegacyRemnants());
    } catch (e) {
      setScan(null);
    }
    setScanning(false);
  };

  const doClean = () => {
    if (!scan || scan.blocked || scan.remnants.length === 0 || cleaning) return;
    const summary = `${scan.remnants.length}개 항목 (파일 ${scan.totalFiles}개, 총 ${formatSize(scan.totalSize)})`;
    appState.pushDialog({
      type: 'select',
      text: isMobile
        ? `구 저장소 잔재 ${summary}를 영구 삭제합니다.\n삭제 후에는 복구할 수 없습니다. 계속할까요?`
        : `구 저장소 잔재 ${summary}를 OS 휴지통으로 이동합니다.\n(필요 시 휴지통에서 복구할 수 있습니다)`,
      items: [{ text: '정리 진행', value: 'yes' }],
      callback: async (value?: string) => {
        if (value !== 'yes') return;
        setCleaning(true);
        const res = await deleteLegacyRemnants(scan.remnants, (done, total) =>
          setProgress({ done, total }),
        );
        setCleaning(false);
        setProgress(null);
        appState.pushMessage(
          res.failed.length > 0
            ? `잔재 ${res.deleted}개 정리, ${res.failed.length}개 실패`
            : `구 저장소 잔재 ${res.deleted}개를 정리했습니다.`,
        );
        await doScan();
      },
    });
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <label className="block text-sm gray-label">구 저장소 잔재 정리</label>
        <button
          className="btn text-xs back-gray px-2 py-0.5 rounded"
          onClick={doScan}
          disabled={scanning || cleaning}
        >
          {scanning ? '검사 중...' : scan ? '새로고침' : '검사'}
        </button>
      </div>
      <p className="text-xs text-faint">
        마이그레이션 후 구 저장 폴더에 남은 항목(프로젝트에 속하지 않는 고아
        폴더·파일)을 정리합니다.
      </p>
      {scan && scan.blocked && (
        <p className="text-xs text-orange-500 dark:text-orange-400">{scan.blocked}</p>
      )}
      {scan && !scan.blocked && scan.remnants.length === 0 && (
        <p className="text-xs text-faint">구 저장소에 남은 잔재가 없습니다.</p>
      )}
      {scan && !scan.blocked && scan.remnants.length > 0 && (
        <>
          <div className="text-sm gray-label">
            잔재 {scan.remnants.length}개 · 파일 {scan.totalFiles}개 · 총{' '}
            {formatSize(scan.totalSize)}
          </div>
          <div className="text-xs text-muted rounded-md bg-[var(--c-zone)] p-2 max-h-32 overflow-y-auto flex flex-col gap-0.5">
            {scan.remnants.map((r) => (
              <div key={r.path} className="break-all">
                {r.path}
                {r.isDir
                  ? r.files === 0
                    ? ' (빈 폴더)'
                    : ` (파일 ${r.files}개, ${formatSize(r.size)})`
                  : ` (${formatSize(r.size)})`}
              </div>
            ))}
          </div>
          <button
            className="btn text-sm back-red px-3 py-1.5 rounded"
            onClick={doClean}
            disabled={cleaning}
          >
            {cleaning
              ? progress
                ? `정리 중... ${progress.done}/${progress.total}`
                : '정리 중...'
              : isMobile
                ? '잔재 영구 삭제'
                : '잔재를 휴지통으로 이동'}
          </button>
        </>
      )}
    </div>
  );
};

/* ── 시스템 탭 하위: 저장소 마이그레이션 상태 (트랙1 B3) ──
   완료 시 = 진단 표시 전용(조작 없음). 미완료(구 배치) 시 = 구 구조 관리 상태임을
   명시하고 "마이그레이션 시작" 버튼 노출 — 옵트아웃 해제 후 앱 재시작으로 부팅
   게이트를 다시 태운다(완전 재시작이 가장 안전 — 사용자 결정 2026-07-11). */
const MigrationDiagSection = () => {
  const [diag, setDiag] = useState<MigrationDiagStatus | null>(null);
  useEffect(() => {
    migrationService
      .readDiagStatus()
      .then(setDiag)
      .catch(() => {});
  }, []);
  if (!diag) return null;

  const startMigration = () => {
    // 재시작은 진행 중인 작업을 중단시킨다 — 생성(진행/예약)·차단형 진행창·
    // 내보내기 진행이 하나라도 있으면 마이그레이션을 시작하지 않고 안내한다.
    const busy =
      taskQueueService.isRunning() ||
      !taskQueueService.isEmpty() ||
      !!appState.progressDialog ||
      (!!appState.exportProgress && !appState.exportProgress.completed);
    if (busy) {
      appState.pushDialog({
        type: 'yes-only',
        text:
          '진행 중이거나 예약된 작업이 있습니다.\n' +
          '이미지 생성·최적화·내보내기 등 모든 작업을 취소하거나 완료한 뒤 다시 시도해 주세요.',
      });
      return;
    }
    appState.pushDialog({
      type: 'select',
      text:
        '마이그레이션을 시작하려면 프로그램을 다시 시작해야 합니다.\n' +
        '다시 시작하면 부팅 시 마이그레이션 안내가 표시됩니다.\n\n지금 다시 시작할까요?',
      items: [{ text: '지금 다시 시작', value: 'restart' }],
      callback: async (value?: string) => {
        if (value !== 'restart') return;
        await migrationService.clearOptOut();
        // 모바일 reload 경로는 종료 시 저장 훅을 타지 않으므로 여기서 직접
        // flush 한다(데스크톱은 close 인터셉트가 한 번 더 flush — 무해).
        try {
          await sessionService.flushOnClose();
          await persistService.flushAll();
        } catch (e) {}
        await backend.restartApp();
      },
    });
  };

  return (
    <div>
      <label className="block text-sm gray-label mb-1">저장소 구조</label>
      <p className="text-sm text-body">
        {diag.layout === 'workspace'
          ? '통합 구조(workspace) 사용 중'
          : '구 구조 사용 중 — 마이그레이션 미완료. 프로젝트 데이터가 여러 폴더에 분산 저장되는 이전 방식으로 관리되고 있습니다.'}
      </p>
      {diag.marker && diag.marker.migratedAt > 0 && (
        <p className="text-xs text-faint mt-1">
          전환 완료: {new Date(diag.marker.migratedAt).toLocaleString()}
          {diag.marker.appVersion ? ` · v${diag.marker.appVersion}` : ''}
        </p>
      )}
      {diag.ledger && (
        <p className="text-xs text-faint mt-1">
          이동 기록: 프로젝트 {diag.ledger.total}개 중 완료 {diag.ledger.done}개
          {diag.ledger.failed > 0 && (
            <span className="text-red-500"> · 실패 {diag.ledger.failed}개</span>
          )}
          {diag.ledger.incomplete > 0 && (
            <span className="text-red-500">
              {' '}
              · 미완료 {diag.ledger.incomplete}개 (다음 부팅에서 재개)
            </span>
          )}
        </p>
      )}
      {diag.ledger?.backupFile && (
        <p className="text-xs text-faint mt-1">
          전환 직전 백업: exports/{diag.ledger.backupFile}
        </p>
      )}
      {diag.layout === 'legacy' && (
        <>
          {diag.optedOut && (
            <p className="text-xs text-faint mt-1">
              마이그레이션 안내를 표시하지 않도록 설정되어 있습니다. 아래
              버튼으로 다시 시작하면 안내가 다시 표시됩니다.
            </p>
          )}
          <button
            className="mt-2 px-3 py-1.5 text-sm back-sky rounded clickable"
            onClick={startMigration}
          >
            마이그레이션 시작 (프로그램 다시 시작)
          </button>
        </>
      )}
      {diag.layout === 'workspace' && <LegacyCleanupSection />}
    </div>
  );
};

/* ── 탭: 시스템 (기술·진단·정보) ── */
const SystemTab = ({
  delayTime, setDelayTime,
  storageWriteGuard, setStorageWriteGuard,
  exportConcurrency, setExportConcurrency,
  autoConvertWebp, setAutoConvertWebp, autoWebpQuality, setAutoWebpQuality,
}: any) => {
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [showRickroll, setShowRickroll] = useState(false);
  // 런타임 진단(감지 코어·실효 스레드풀) — 이미지 병렬 상한이 실제로 코어 수로
  // 잡혔는지 확인용. 데스크톱 전용(모바일은 null).
  const [runtimeDiag, setRuntimeDiag] = useState<{
    cpus: number;
    uvThreadpool: number;
  } | null>(null);
  useEffect(() => {
    if (isMobile) return;
    backend
      .getRuntimeDiag()
      .then((d) => setRuntimeDiag(d))
      .catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const { outdated, latest } = await appUpdateNoticeService.checkForUpdate();
      if (outdated) {
        appState.pushDialog({
          type: 'select',
          text: `새로운 버전(${latest})이 있습니다.\n새로 다운 받으시겠습니까?`,
          green: true,
          items: [
            { text: '다운로드 페이지 열기', value: 'open' },
            { text: '다시 알리지 않음', value: 'dismiss' },
          ],
          callback: (value?: string) => {
            if (value === 'open') {
              backend.openWebPage('https://github.com/Dd154663/SDStudio/releases');
            } else if (value === 'dismiss') {
              appUpdateNoticeService.dismissVersion(latest);
            }
          },
        });
      } else {
        appState.pushDialog({
          type: 'yes-only',
          text: `현재 최신 버전입니다. (${appUpdateNoticeService.current})`,
        });
      }
    } catch (e) {
      appState.pushDialog({
        type: 'yes-only',
        text: '업데이트 확인에 실패했습니다. 네트워크를 확인해주세요.',
      });
    }
    setCheckingUpdate(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="cfgStorageGuard" checked={storageWriteGuard}
            onChange={(e) => setStorageWriteGuard(e.target.checked)} />
          <label htmlFor="cfgStorageGuard" className="text-sm gray-label">저장소 불안정 시 자동 저장 보호 (권장)</label>
        </div>
        <p className="text-xs text-faint mt-1 ml-6">
          저장소 접근이 일시적으로 불안정할 때 자동 저장을 잠시 멈춰 데이터 손상을 막습니다. 멈춘 동안의 직전 편집은 저장이 미뤄질 수 있습니다(접근이 회복되면 자동 재개). 꺼도 손상 방지 가드는 항상 동작합니다.
        </p>
      </div>
      <hr className="line-color" />
      <div>
        <label className="block text-sm gray-label mb-1">
          기본 지연 시간 조정 (0ms ~ 1000ms)
        </label>
        <div className="flex items-center gap-2">
          <input type="range" min={0} max={1000} step={1}
            value={delayTime} onChange={(e) => setDelayTime(parseInt(e.target.value))}
            className="flex-1 min-w-0" />
          <span className="text-sm gray-label w-12 text-right flex-none">{delayTime}ms</span>
        </div>
      </div>
      <hr className="line-color" />
      <div>
        <label className="block text-sm gray-label mb-1">
          이미지 최적화 병렬 처리 수 (1 ~ {platform.maxImageConcurrency})
        </label>
        <div className="flex items-center gap-2">
          <input type="range" min={1} max={platform.maxImageConcurrency} step={1}
            value={exportConcurrency} onChange={(e) => setExportConcurrency(parseInt(e.target.value))}
            className="flex-1 min-w-0" />
          <span className="text-sm gray-label w-14 text-right flex-none">{exportConcurrency}</span>
        </div>
        <p className="text-xs text-faint mt-1">
          높을수록 내보내기가 빠르지만 CPU 사용량이 증가합니다.{isMobile ? ' 모바일은 1~2 권장.' : ''}
        </p>
        {!isMobile && runtimeDiag && (
          <p className="text-xs text-faint mt-1">
            감지된 코어: {runtimeDiag.cpus} · 동시 인코딩 상한(스레드풀):{' '}
            {runtimeDiag.uvThreadpool}
          </p>
        )}
      </div>
      {/* 자동 WebP 변환 — 데스크톱은 저장/이미지 탭에 동일 설정이 있어 모바일만 노출 */}
      {isMobile && (
        <>
          <hr className="line-color" />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="cfgAutoWebpM" checked={autoConvertWebp}
                onChange={(e) => setAutoConvertWebp(e.target.checked)} />
              <label htmlFor="cfgAutoWebpM" className="text-sm gray-label">새로 생성되는 이미지를 WebP로 자동 변환</label>
            </div>
            <p className="text-xs text-muted">
              생성 직후 PNG를 WebP로 재인코딩해 저장 용량을 줄입니다. 프롬프트
              메타데이터와 NAI 인식(스텔스 워터마크)은 유지되며, 기존 이미지에는
              영향이 없습니다. 변환에 실패하면 원본 PNG가 그대로 저장됩니다.
            </p>
            {autoConvertWebp && (
              <div className="flex items-center gap-2">
                <label htmlFor="cfgAutoWebpQM" className="text-sm gray-label">변환 품질 (1~100)</label>
                <input
                  type="number"
                  id="cfgAutoWebpQM"
                  min={1}
                  max={100}
                  value={autoWebpQuality}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setAutoWebpQuality(isNaN(v) ? 80 : Math.min(100, Math.max(1, v)));
                  }}
                  className="w-16 text-sm text-center border rounded px-1 py-1 back-gray"
                />
              </div>
            )}
          </div>
        </>
      )}
      <hr className="line-color" />
      <FolderCleanupSection folder="exports" label="exports 폴더 정리" />
      <hr className="line-color" />
      <FolderCleanupSection folder="tmp" label="tmp 폴더 정리" description="이미지 내보내기 시 생성되는 임시 파일이 저장됩니다." />
      <hr className="line-color" />
      <TaskLogSection />
      <hr className="line-color" />
      <MigrationDiagSection />
      <hr className="line-color" />
      <div className="space-y-2">
        <label className="block text-sm gray-label mb-1">업데이트</label>
        <button
          className="px-3 py-1.5 text-sm back-sky rounded clickable disabled:opacity-50"
          disabled={checkingUpdate}
          onClick={handleCheckUpdate}
        >
          {checkingUpdate ? '확인 중...' : '업데이트 확인'}
        </button>
      </div>
      <hr className="line-color" />
      <div className="space-y-2">
        <label className="block text-sm gray-label mb-1">정보</label>
        <div className="flex flex-col gap-1 text-sm">
          <a
            className="text-sky-500 hover:text-sky-400 cursor-pointer"
            onClick={() => backend.openWebPage('https://github.com/Dd154663/SDStudio')}
          >
            GitHub — Dd154663/SDStudio
          </a>
          <a
            className="text-sky-500 hover:text-sky-400 cursor-pointer"
            onClick={() => backend.openWebPage('https://github.com/sunho/SDStudio')}
          >
            원작 — sunho/SDStudio
          </a>
        </div>
        <button
          className="mt-2 px-3 py-1.5 text-sm font-bold rounded clickable text-white bg-gradient-to-r from-fuchsia-500 via-rose-500 to-orange-400 hover:brightness-110 shadow"
          onClick={() => setShowRickroll(true)}
        >
          🎁 비밀 버튼 (누르지 마시오)
        </button>
      </div>
      {showRickroll && (
        <ModalOverlay
          isOpen={true}
          onClose={() => setShowRickroll(false)}
          title="🎉 축하합니다!"
          width="max-w-2xl"
        >
          <div className="w-full aspect-video rounded-lg overflow-hidden bg-black">
            {/* file:// 출처에서는 iframe/embed 임베드가 YouTube에 막히므로(에러 150/153),
                데스크톱은 임베드가 아닌 전체 watch 페이지를 webview(최상위 네비게이션)로 띄운다.
                모바일(Capacitor)은 정상 출처라 iframe 임베드가 허용됨. */}
            {!isMobile ? (
              <webview
                src="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                // allowpopups 는 빈 문자열 attribute 여야 렌더됨(boolean true 는 React 가 무시)
                {...({ allowpopups: '' } as unknown as { allowpopups?: boolean })}
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              <iframe
                className="w-full h-full"
                src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0"
                title="rickroll"
                frameBorder={0}
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
              />
            )}
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

/* ── 탭: 개인 설정 (취향 토글) ── */
// 앱 글꼴 선택지 — id 는 config 저장 키(uiFont)라 배포 후 불변. preview 는 각
// 선택지 라벨을 해당 글꼴로 렌더해 고르기 전에 차이를 눈으로 보게 한다.
const appFonts: { id: 'pretendard' | 'system'; name: string; family: string }[] = [
  { id: 'system', name: '시스템 기본', family: "'Noto Sans KR', sans-serif" },
  {
    id: 'pretendard',
    name: 'Pretendard',
    family: "'Pretendard Variable', 'Noto Sans KR', sans-serif",
  },
];

const PersonalTab = ({
  classicSceneCard, setClassicSceneCard,
  fullWordAc, setFullWordAc,
  legacyProjectMode, setLegacyProjectMode,
  legacySceneEditor, setLegacySceneEditor,
  legacyWorkflowMode, setLegacyWorkflowMode,
  sceneToolbarLegacyText, setSceneToolbarLegacyText,
  uiFont, setUiFont,
  uiClassicFinish, setUiClassicFinish,
  allowDuplicateProjectOpen, setAllowDuplicateProjectOpen,
}: any) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm gray-label mb-1">글꼴</label>
      <div className="flex flex-wrap gap-2">
        {appFonts.map((f) => {
          const selected = (uiFont ?? 'system') === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setUiFont(f.id)}
              className={
                'px-3 py-1.5 rounded-md border text-sm clickable text-default ' +
                (selected ? 'ring-2 ring-sky-400 border-sky-400' : 'line-color')
              }
              style={{ fontFamily: f.family }}
            >
              {f.name} — 가나다 123
            </button>
          );
        })}
      </div>
      <p className="text-xs text-faint mt-1">
        앱 전체에 쓰이는 글꼴입니다. 저장하면 바로 적용됩니다.
      </p>
    </div>
    <hr className="line-color" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgClassicScene" checked={classicSceneCard}
        onChange={(e) => setClassicSceneCard(e.target.checked)} />
      <label htmlFor="cfgClassicScene" className="text-sm gray-label">클래식 씬 카드 디자인 사용</label>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgClassicFinish" checked={uiClassicFinish}
          onChange={(e) => setUiClassicFinish(e.target.checked)} />
        <label htmlFor="cfgClassicFinish" className="text-sm gray-label">클래식 마감 사용</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        켜면 테두리·구분선 등 세부 마감을 디자인 개선 이전 모양으로 되돌립니다.
      </p>
    </div>
    <hr className="line-color" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgFullWordAc" checked={fullWordAc}
        onChange={(e) => setFullWordAc(e.target.checked)} />
      <label htmlFor="cfgFullWordAc" className="text-sm gray-label">자동완성 시 콤마 사이 전체 단어 사용</label>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgLegacyProject" checked={legacyProjectMode}
          onChange={(e) => setLegacyProjectMode(e.target.checked)} />
        <label htmlFor="cfgLegacyProject" className="text-sm gray-label">레거시 프로젝트 모드</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        켜면 기존 프로젝트 선택 드롭다운을 유지합니다(드로어·드롭다운·그리드 공존). 끄면 드롭다운 대신 드로어 열기 버튼으로 표시됩니다.
      </p>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgLegacyScene" checked={legacySceneEditor}
          onChange={(e) => setLegacySceneEditor(e.target.checked)} />
        <label htmlFor="cfgLegacyScene" className="text-sm gray-label">레거시 씬 편집 모드</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        켜면 씬 에디터 첫 탭(프롬프트 에디터)을 예전 프리셋 형태의 전체 폼으로 표시합니다. 끄면 중간 프롬프트와 씬 전용 네거티브 두 입력만 노출합니다. (조합 에디터·씬 캐릭터 프롬프트·미리보기 탭은 항상 표시)
      </p>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgLegacyWorkflow" checked={legacyWorkflowMode}
          onChange={(e) => setLegacyWorkflowMode(e.target.checked)} />
        <label htmlFor="cfgLegacyWorkflow" className="text-sm gray-label">레거시 작업모드 활성화</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        켜면 이지모드·이미지 수정 작업모드와 작업모드 선택 드롭다운을 다시 표시합니다. 끄면(기본) 작업모드가 "이미지 생성" 하나로 고정되고 드롭다운이 숨겨집니다. 기존 이지모드 사전설정 데이터는 삭제되지 않습니다.
      </p>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgSceneToolbarText" checked={sceneToolbarLegacyText}
          onChange={(e) => setSceneToolbarLegacyText(e.target.checked)} />
        <label htmlFor="cfgSceneToolbarText" className="text-sm gray-label">씬 툴바 텍스트 버튼 사용 (레거시)</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        켜면 PC 씬 툴바 버튼을 예전처럼 텍스트로 표시합니다. 끄면(기본) 아이콘으로 표시되고 이름은 마우스를 올리면 뜹니다. 모바일에는 영향이 없습니다.
      </p>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgAllowDupOpen" checked={allowDuplicateProjectOpen}
          onChange={(e) => setAllowDuplicateProjectOpen(e.target.checked)} />
        <label htmlFor="cfgAllowDupOpen" className="text-sm gray-label">같은 프로젝트 중복 열기 허용 (읽기 전용 미러)</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        다른 창에서 열린 프로젝트를 읽기 전용 미러로 열 수 있습니다. 미러에서는 열람·비교·생성 예약·이미지 즐겨찾기·이미지 삭제만 가능하고 그 외 편집은 저장되지 않습니다.
      </p>
    </div>
  </div>
);

/* ── 작업 로그 ── */
const TaskLogSection = () => {
  const [showDialog, setShowDialog] = useState(false);
  const logs = taskQueueService.taskLogs;

  const formatLog = (log: TaskLog) => {
    const date = new Date(log.timestamp);
    const day =
      String(date.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(date.getDate()).padStart(2, '0');
    const time = date.toLocaleTimeString('ko-KR', { hour12: false });
    const levelLabel = log.level === 'error' ? '[오류]' : log.level === 'warn' ? '[경고]' : '[정보]';
    return `${day} ${time} ${levelLabel} [${log.scene}] ${log.message}`;
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
      <button className="btn w-full back-gray py-2 rounded text-sm"
        onClick={() => setShowDialog(true)}>
        작업 로그 보기
      </button>
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDialog(false); }}>
          <div className="bg-[var(--c-zone)] rounded-lg r-modal shadow-xl w-[90vw] max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b line-color">
              <span className="font-bold text-default">작업 로그</span>
              <button className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-lg px-2"
                onClick={() => setShowDialog(false)}>✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 text-xs font-mono">
              {logs.length === 0
                ? <p className="text-faint text-center py-4">로그가 없습니다.</p>
                : [...logs].reverse().map((log, i) => (
                    <div key={i} className={'py-0.5 ' +
                      (log.level === 'error' ? 'text-red-500' : log.level === 'warn' ? 'text-yellow-500' : 'text-default')}>
                      {formatLog(log)}
                    </div>
                  ))
              }
            </div>
            <div className="flex gap-2 p-3 border-t line-color">
              <button className="btn flex-1 back-sky py-2 rounded text-sm"
                onClick={downloadLogs} disabled={logs.length === 0}>다운로드</button>
              <button className="btn flex-1 back-gray py-2 rounded text-sm"
                onClick={() => taskQueueService.clearLogs()} disabled={logs.length === 0}>초기화</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/* ── 탭: 키 바인딩 (PC only) ── */
const KeyBindingsTab = () => {
  const [bindings, setBindings] = useState(keyboardShortcutService?.getAllActions() ?? []);
  const [recordingAction, setRecordingAction] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const refreshBindings = () => {
    setBindings(keyboardShortcutService?.getAllActions() ?? []);
  };

  useEffect(() => {
    if (!recordingAction) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const normalized = KeyboardShortcutService.normalizeKey(e);
      if (!normalized) return; // 수정자만 누른 경우

      // Escape로 취소
      if (e.key === 'Escape') {
        setRecordingAction(null);
        setConflict(null);
        return;
      }

      // 충돌 확인
      const conflictLabel = keyboardShortcutService.findConflict(normalized, recordingAction);
      if (conflictLabel) {
        setConflict(`"${conflictLabel}" 단축키와 충돌합니다`);
        return;
      }

      keyboardShortcutService.setBinding(recordingAction, normalized);
      setRecordingAction(null);
      setConflict(null);
      refreshBindings();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recordingAction]);

  // 동작 위치(= 충돌 scope)별로 그룹핑
  const groups: {
    title: string;
    hint: string;
    items: typeof bindings;
  }[] = [
    {
      title: '전역 (메인 화면)',
      hint: '씬 리스트가 보이는 메인 화면에서 동작',
      items: bindings.filter(
        (b) => b.category === 'global' || b.category === 'scene',
      ),
    },
    {
      title: '이미지 그리드',
      hint: '씬에 진입해 이미지 목록을 볼 때 동작',
      items: bindings.filter((b) => b.category === 'image-grid'),
    },
    {
      title: '이미지 상세 창',
      hint: '이미지를 클릭해 상세 창이 열린 상태에서 동작',
      items: bindings.filter((b) => b.category === 'viewer'),
    },
  ];

  const renderBindingRow = (action: (typeof bindings)[number]) => (
    <div
      key={action.id}
      className="flex items-center gap-2 py-1.5 border-b line-color"
    >
      <span className="flex-1 text-sm text-body min-w-0 truncate">
        {action.label}
      </span>
      <span
        className="text-sm font-mono bg-[var(--c-input-bg)] text-body px-2 py-0.5 rounded text-center flex-shrink-0"
        style={{ minWidth: '70px' }}
      >
        {recordingAction === action.id
          ? '입력 대기...'
          : KeyboardShortcutService.keyDisplayName(action.currentKey)}
      </span>
      <button
        className={`text-xs px-2 py-1 rounded transition-colors flex-shrink-0 ${
          recordingAction === action.id ? 'back-red text-white' : 'back-sky'
        }`}
        onClick={() => {
          setConflict(null);
          setRecordingAction(recordingAction === action.id ? null : action.id);
        }}
      >
        {recordingAction === action.id ? '취소' : '변경'}
      </button>
      <button
        className="text-xs px-1.5 py-1 rounded back-gray flex-shrink-0"
        title="기본값으로 초기화"
        onClick={() => {
          keyboardShortcutService.resetBinding(action.id);
          setConflict(null);
          refreshBindings();
        }}
      >
        ↺
      </button>
    </div>
  );

  return (
    <div className="flex flex-col" style={{ maxHeight: '50vh' }}>
      <div className="text-sm text-muted mb-2 flex-none">
        "변경" 클릭 후 키 조합 입력. Esc로 취소. 그룹 내부에서만 키 충돌
        검사됩니다 (다른 그룹은 동작 상황이 달라 같은 키를 써도 OK).
      </div>
      {conflict && (
        <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded mb-2 flex-none">
          {conflict}
        </div>
      )}
      <div
        className="overflow-y-auto flex-1 space-y-1"
        style={{ minHeight: 0 }}
      >
        {groups.map((group, idx) =>
          group.items.length === 0 ? null : (
            <div key={group.title} className={idx > 0 ? 'mt-4' : ''}>
              <div className="sticky top-0 bg-[var(--c-surface-2)] py-1.5 px-1 border-b-2 border-sky-400 dark:border-sky-500 z-10">
                <div className="text-sm font-semibold text-default">
                  {group.title}
                </div>
                <div className="text-xs text-muted">
                  {group.hint}
                </div>
              </div>
              <div>{group.items.map(renderBindingRow)}</div>
            </div>
          ),
        )}
      </div>
      <div className="pt-2 flex-none">
        <button
          className="text-sm px-3 py-1.5 rounded back-gray"
          onClick={() => {
            keyboardShortcutService.resetToDefaults();
            setConflict(null);
            refreshBindings();
          }}
        >
          전체 초기화
        </button>
      </div>
    </div>
  );
};

/* ── 메인 ConfigScreen ── */
// 색 한 칸 선택 UI: 데스크톱=네이티브 색 피커, 모바일=MobileColorPicker(상위에서 띄움).
const ColorField = ({
  label,
  value,
  def,
  onChange,
  onMobilePick,
}: {
  label: string;
  value?: string;
  def: string; // 미설정 시 스와치에 보일 기본색(피커 시작점)
  onChange: (hex: string | undefined) => void;
  onMobilePick: (initial: string, onChange: (hex: string) => void) => void;
}) => {
  const isSet = isHex6(value);
  const shown = isSet ? (value as string) : def;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm gray-label flex-1">{label}</span>
      {isSet && <span className="text-xs text-faint">{value}</span>}
      {!isMobile ? (
        <label
          className="relative w-7 h-7 rounded-full flex-none cursor-pointer overflow-hidden border line-color"
          style={{ backgroundColor: shown }}
        >
          <input
            type="color"
            defaultValue={shown}
            onInput={(e) => onChange(e.currentTarget.value)}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>
      ) : (
        <button
          className="w-7 h-7 rounded-full flex-none border line-color"
          style={{ backgroundColor: shown }}
          onClick={() => onMobilePick(shown, onChange)}
        />
      )}
      {isSet && (
        <button
          className="round-button back-gray btn-sm flex-none"
          onClick={() => onChange(undefined)}
        >
          초기화
        </button>
      )}
    </div>
  );
};

// 테마 템플릿의 라이트/다크 변형 1개 = 클릭 칩. 칩 자체를 변형의 배경색으로 칠하고
// 대표색 점(패널/강조/일반/위험)을 함께 보여, 적용 전에 색감을 예상할 수 있게 한다.
const TemplateVariantChip = ({
  variant,
  label,
  onApply,
}: {
  variant: UiThemeConfig;
  label: string;
  onApply: () => void;
}) => (
  <button
    className="flex items-center justify-center gap-1.5 flex-1 rounded-full border line-color px-2.5 py-1.5 clickable"
    style={{ backgroundColor: variant.surface }}
    onClick={onApply}
  >
    <span
      className="text-xs font-medium"
      style={{ color: variant.textPattern === 'light' ? '#000000' : '#ffffff' }}
    >
      {label}
    </span>
    <span className="flex gap-1">
      {[variant.surface2, variant.accent, variant.neutral, variant.danger].map(
        (c, i) => (
          <span
            key={i}
            className="w-3 h-3 rounded-full flex-none"
            style={{
              backgroundColor: c,
              boxShadow: 'inset 0 0 0 1px rgba(128,128,128,.4)',
            }}
          />
        ),
      )}
    </span>
  </button>
);

// 내 프리셋 칩(릴리스 준비 ③) — 저장된 스냅샷의 배경/대표색으로 칠해 색감을 예상.
// 클릭 = 복원 적용, ✕ = 삭제. 라벨 색은 textPattern, 미설정 시 기본 모드로 추정.
const MyThemePresetChip = ({
  preset,
  onApply,
  onDelete,
}: {
  preset: { name: string; whiteMode: boolean; trueDark?: boolean; theme: UiThemeConfig };
  onApply: () => void;
  onDelete: () => void;
}) => {
  const labelColor = preset.theme.textPattern
    ? preset.theme.textPattern === 'light'
      ? '#000000'
      : '#ffffff'
    : preset.whiteMode
      ? '#000000'
      : '#ffffff';
  return (
    <div
      className="flex items-center gap-1 rounded-full border line-color pl-2.5 pr-1.5 py-1"
      style={{ backgroundColor: preset.theme.surface }}
    >
      <button className="flex items-center gap-1.5 clickable min-w-0" onClick={onApply}>
        <span
          className="text-xs font-medium truncate max-w-[9rem]"
          style={{ color: labelColor }}
        >
          {preset.name}
        </span>
        <span className="flex gap-1 flex-none">
          {[
            preset.theme.surface2,
            preset.theme.accent,
            preset.theme.neutral,
            preset.theme.danger,
          ].map((c, i) => (
            <span
              key={i}
              className="w-3 h-3 rounded-full flex-none"
              style={{
                backgroundColor: c,
                boxShadow: 'inset 0 0 0 1px rgba(128,128,128,.4)',
              }}
            />
          ))}
        </span>
      </button>
      <button
        className="clickable text-xs px-1 flex-none"
        style={{ color: labelColor }}
        onClick={onDelete}
        title="프리셋 삭제"
      >
        ✕
      </button>
    </div>
  );
};

const CustomizationTab = ({
  uiTheme,
  setUiTheme,
  whiteMode, setWhiteMode,
  trueDark, setTrueDark,
  uiThemePresets, setUiThemePresets,
}: any) => {
  const [mobilePicker, setMobilePicker] = useState<{
    initial: string;
    onChange: (hex: string) => void;
  } | null>(null);

  const patch = (p: Partial<UiThemeConfig>) =>
    setUiTheme((prev: UiThemeConfig) => ({ ...prev, ...p }));
  const patchBtn = (p: Partial<NonNullable<UiThemeConfig['buttons']>>) =>
    setUiTheme((prev: UiThemeConfig) => ({ ...prev, buttons: { ...prev.buttons, ...p } }));
  const onMobilePick = (initial: string, onChange: (hex: string) => void) =>
    setMobilePicker({ initial, onChange });

  // 저장 전 실시간 미리보기용 CSS 변수(실제 적용과 동일한 파생 함수).
  const previewVars = buildThemeVars(uiTheme, whiteMode);
  const unify = !!uiTheme.unifyButtons;

  // 템플릿 적용: 색 설정을 통째로 교체하고, 미설정 토큰의 폴백이 어긋나지 않도록
  // 기본 테마(라이트=화이트/다크=다크)도 변형에 맞춘다. 저장 전이라 되돌리기 자유.
  // 버튼 통합 토글은 사용자 선택을 유지한다 — 템플릿은 역할 3색만 채워 두므로
  // 나중에 토글을 켜도 테마에 맞는 버튼 색이 적용된다.
  const applyTemplate = (v: UiThemeConfig, mode: 'light' | 'dark') => {
    setUiTheme((prev: UiThemeConfig) => ({
      ...v,
      unifyButtons: prev.unifyButtons,
    }));
    setWhiteMode(mode === 'light');
    setTrueDark(false);
  };

  // 내 프리셋(릴리스 준비 ③): 현재 색 구성+기본 모드 스냅샷을 이름 붙여 저장.
  // 같은 이름 = 덮어쓰기 확인. 적용은 스냅샷 그대로 복원(저장 전이라 되돌리기 자유).
  const presets: NonNullable<Config['uiThemePresets']> = uiThemePresets ?? [];
  const saveCurrentAsPreset = async () => {
    const name = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: '프리셋 이름을 입력하세요',
    });
    if (!name) return;
    const snapshot = {
      name,
      whiteMode,
      trueDark: trueDark || undefined,
      theme: JSON.parse(JSON.stringify(uiTheme)) as UiThemeConfig,
    };
    if (presets.some((p: { name: string }) => p.name === name)) {
      appState.pushDialog({
        type: 'confirm',
        text: `"${name}" 프리셋이 이미 있습니다. 덮어쓸까요?`,
        callback: () => {
          setUiThemePresets(
            presets.map((p: { name: string }) => (p.name === name ? snapshot : p)),
          );
        },
      });
      return;
    }
    setUiThemePresets([...presets, snapshot]);
  };
  const applyPreset = (p: (typeof presets)[number]) => {
    setUiTheme(JSON.parse(JSON.stringify(p.theme)));
    setWhiteMode(p.whiteMode);
    setTrueDark(p.trueDark ?? false);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm gray-label">
        UI 색을 직접 지정합니다. 지정하지 않은 항목은 기본 테마(다크/라이트)를 따릅니다.
        아래 미리보기로 즉시 확인하고, <b>저장</b>하면 앱 전체에 적용됩니다.
      </div>

      {/* ── 기본 테마 (base 모드) ── */}
      <div>
        <label className="block text-sm gray-label mb-2">기본 테마</label>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="themeMode" checked={!whiteMode && !trueDark}
              onChange={() => { setWhiteMode(false); setTrueDark(false); }} />
            <span className="text-sm gray-label">다크 모드</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="themeMode" checked={trueDark && !whiteMode}
              onChange={() => { setWhiteMode(false); setTrueDark(true); }} />
            <span className="text-sm gray-label">트루 다크 모드</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="themeMode" checked={whiteMode}
              onChange={() => { setWhiteMode(true); setTrueDark(false); }} />
            <span className="text-sm gray-label">화이트 모드</span>
          </label>
        </div>
      </div>
      <hr className="line-color" />

      {/* ── 테마 템플릿 ── */}
      <div>
        <label className="block text-sm gray-label mb-1">테마 템플릿</label>
        <p className="text-xs text-muted mb-2">
          누르면 아래 색 설정 전체가 템플릿 값으로 바뀝니다(기존 커스텀 색은 덮어씀).
          미리보기로 확인 후 <b>저장</b>해야 적용됩니다.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {themeTemplates.map((tpl) => (
            <div key={tpl.name} className="rounded-md r-card border line-color p-2">
              <div className="text-sm text-default mb-1.5">
                {tpl.emoji} {tpl.name}
              </div>
              <div className="flex gap-2">
                {tpl.light && (
                  <TemplateVariantChip
                    variant={tpl.light}
                    label="라이트"
                    onApply={() => applyTemplate(tpl.light!, 'light')}
                  />
                )}
                {tpl.dark && (
                  <TemplateVariantChip
                    variant={tpl.dark}
                    label="다크"
                    onApply={() => applyTemplate(tpl.dark!, 'dark')}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <hr className="line-color" />

      {/* ── 내 프리셋 (릴리스 준비 ③) ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm gray-label">내 프리셋</label>
          <button
            className="round-button back-sky btn-sm flex-none"
            onClick={saveCurrentAsPreset}
          >
            현재 구성 저장
          </button>
        </div>
        <p className="text-xs text-muted mb-2">
          현재 색 구성과 기본 테마(다크/화이트)를 스냅샷으로 저장합니다. 칩을
          누르면 저장 당시 모습 그대로 복원되고, <b>저장</b>해야 앱에 적용됩니다.
        </p>
        {presets.length === 0 ? (
          <div className="text-xs text-faint">
            저장된 프리셋이 없습니다 — 색을 꾸민 뒤 "현재 구성 저장"을 누르세요.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {presets.map((p: (typeof presets)[number]) => (
              <MyThemePresetChip
                key={p.name}
                preset={p}
                onApply={() => applyPreset(p)}
                onDelete={() => {
                  appState.pushDialog({
                    type: 'confirm',
                    text: `"${p.name}" 프리셋을 삭제하시겠습니까?`,
                    callback: () => {
                      setUiThemePresets(
                        presets.filter(
                          (x: { name: string }) => x.name !== p.name,
                        ),
                      );
                    },
                  });
                }}
              />
            ))}
          </div>
        )}
      </div>
      <hr className="line-color" />

      {/* ── 실시간 미리보기 ── */}
      <div>
        <label className="block text-sm gray-label mb-2">미리보기</label>
        <div
          className="rounded-lg border line-color p-4 space-y-3"
          style={
            { ...previewVars, backgroundColor: 'var(--c-surface)' } as React.CSSProperties
          }
        >
          <div className="text-default text-sm font-semibold">제목 텍스트</div>
          <div className="text-sub text-xs">부가 설명 텍스트입니다.</div>
          <input
            className="gray-input w-full rounded px-2 py-1.5 text-sm"
            placeholder="테스트 입력창"
            readOnly
          />
          <div
            className="rounded-md r-card border line-color p-2"
            style={{ backgroundColor: 'var(--c-surface-2)' }}
          >
            <span className="gray-label text-xs">패널 / 카드 샘플</span>
          </div>
          <div
            className="rounded-md p-2"
            style={{ backgroundColor: 'var(--c-zone)' }}
          >
            <div
              className="rounded p-1.5"
              style={{
                borderLeft: '3px solid #facc15',
                backgroundColor: '#facc1512',
              }}
            >
              <span className="text-body text-xs">구분 구역(드로어) + 폴더 샘플</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {unify ? (
              <>
                <button className="round-button back-sky btn-sm">강조</button>
                <button className="round-button back-gray btn-sm">일반</button>
                <button className="round-button back-red btn-sm">삭제</button>
              </>
            ) : (
              <>
                <button className="round-button back-green btn-sm">추가</button>
                <button className="round-button back-sky btn-sm">강조</button>
                <button className="round-button back-orange btn-sm">편집</button>
                <button className="round-button back-gray btn-sm">일반</button>
                <button className="round-button back-red btn-sm">삭제</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── 테마(배경/입력/텍스트) ── */}
      <div className="space-y-3">
        <div className="text-sm font-semibold gray-label">테마</div>
        <ColorField
          label="배경색"
          value={uiTheme.surface}
          def="#ffffff"
          onChange={(v) => patch({ surface: v })}
          onMobilePick={onMobilePick}
        />
        <ColorField
          label="패널/카드 배경"
          value={uiTheme.surface2}
          def="#ffffff"
          onChange={(v) => patch({ surface2: v })}
          onMobilePick={onMobilePick}
        />
        <ColorField
          label="입력창 배경"
          value={uiTheme.inputBg}
          def="#e5e7eb"
          onChange={(v) => patch({ inputBg: v })}
          onMobilePick={onMobilePick}
        />
        <div>
          <ColorField
            label="구분 구역 배경 (드로어 등)"
            value={uiTheme.zoneBg}
            def="#eceff4"
            onChange={(v) => patch({ zoneBg: v })}
            onMobilePick={onMobilePick}
          />
          <p className="text-xs text-muted mt-1">
            프로젝트 드로어처럼 색 강조(폴더 등)가 올라가는 바탕. 미설정 시 배경 색조를
            따르지 않고 기본 테마로 고정돼, 폴더 색과 텍스트가 항상 잘 보입니다.
          </p>
        </div>
        <div>
          <ColorField
            label="테두리/구분선 색"
            value={uiTheme.lineColor}
            def="#cbd5e1"
            onChange={(v) => patch({ lineColor: v })}
            onMobilePick={onMobilePick}
          />
          <p className="text-xs text-muted mt-1">
            입력창·패널·목록 사이의 얇은 선. 미설정 시 텍스트 패턴과 배경색에 맞춰
            자동으로 옅게 파생됩니다.
          </p>
        </div>
        <div>
          <label className="block text-sm gray-label mb-2">텍스트 패턴</label>
          <div className="flex flex-wrap gap-2">
            <button
              className={`round-button btn-sm ${uiTheme.textPattern === 'light' ? 'back-sky' : 'back-gray'}`}
              onClick={() => patch({ textPattern: 'light' })}
            >
              밝은 배경용 (검은 텍스트)
            </button>
            <button
              className={`round-button btn-sm ${uiTheme.textPattern === 'dark' ? 'back-sky' : 'back-gray'}`}
              onClick={() => patch({ textPattern: 'dark' })}
            >
              어두운 배경용 (흰 텍스트)
            </button>
            {uiTheme.textPattern && (
              <button
                className="round-button back-gray btn-sm"
                onClick={() => patch({ textPattern: undefined })}
              >
                초기화
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── 버튼 색 ── */}
      <div className="space-y-3">
        <div className="text-sm font-semibold gray-label">버튼 색</div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={unify}
            onChange={(e) => patch({ unifyButtons: e.target.checked })}
          />
          <span className="text-sm gray-label">
            버튼 색 통합 — 강조 / 일반 / 위험 3색으로 단순화
          </span>
        </label>
        <div className="text-xs text-faint">
          {unify
            ? '여러 색으로 흩어진 버튼을 3가지 역할 색으로 합칩니다. (삭제는 위험색 유지)'
            : '색별로 따로 지정합니다. 미설정 시 기본 테마 색을 씁니다.'}
        </div>

        {unify ? (
          <div className="flex flex-col gap-2">
            <ColorField
              label="강조색 (추가·주요·편집 버튼)"
              value={uiTheme.accent}
              def="#0ea5e9"
              onChange={(v) => patch({ accent: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="일반색 (보조 버튼)"
              value={uiTheme.neutral}
              def="#6b7280"
              onChange={(v) => patch({ neutral: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="위험색 (삭제 버튼)"
              value={uiTheme.danger}
              def="#ef4444"
              onChange={(v) => patch({ danger: v })}
              onMobilePick={onMobilePick}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <ColorField
              label="추가 버튼 (초록)"
              value={uiTheme.buttons?.green}
              def="#22c55e"
              onChange={(v) => patchBtn({ green: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="강조 버튼 (하늘)"
              value={uiTheme.buttons?.sky}
              def="#0ea5e9"
              onChange={(v) => patchBtn({ sky: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="편집 버튼 (주황)"
              value={uiTheme.buttons?.orange}
              def="#f97316"
              onChange={(v) => patchBtn({ orange: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="일반 버튼 (회색)"
              value={uiTheme.buttons?.gray}
              def="#6b7280"
              onChange={(v) => patchBtn({ gray: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="삭제 버튼 (빨강)"
              value={uiTheme.buttons?.red}
              def="#ef4444"
              onChange={(v) => patchBtn({ red: v })}
              onMobilePick={onMobilePick}
            />
          </div>
        )}
      </div>

      {isMobile && mobilePicker && (
        <MobileColorPicker
          initial={mobilePicker.initial}
          onChange={mobilePicker.onChange}
          onClose={() => setMobilePicker(null)}
        />
      )}

      <div className="pt-2 border-t line-color">
        <button
          className="round-button back-red btn-sm"
          onClick={() => setUiTheme({})}
        >
          전체 초기화
        </button>
      </div>
    </div>
  );
};

/* ── 탭: 툴바 버튼 구성 (테마 탭에서 분리 — 두 기능이 한 탭에 있으면 스크롤이 과도) ── */
/* ── 퀵 메뉴 구성 (트랙2 ① P3) ── */
// config.quickMenu 편집기. undefined = 추천 기본(DEFAULT_QUICK_MENU) 사용 상태.
// 표시명은 uiLayout 레지스트리 단일 출처(globalActionMeta), 모바일은 pcOnly 후보 제외.
const QuickMenuEditor = ({
  value,
  onChange,
  showButton,
  setShowButton,
}: {
  value: string[] | undefined;
  onChange: (v: string[] | undefined) => void;
  showButton: boolean;
  setShowButton: (v: boolean) => void;
}) => {
  const list = value ?? DEFAULT_QUICK_MENU;
  const included = new Set(list);
  const candidates = GLOBAL_ACTIONS.filter((a) => {
    const m = globalActionMeta(a.id);
    return !!m && !(isMobile && m.pcOnly);
  });
  const nameOf = (id: string) => globalActionMeta(id)?.name ?? id;
  const move = (id: string, dir: -1 | 1) => {
    const idx = list.indexOf(id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= list.length) return;
    const next = [...list];
    next.splice(idx, 1);
    next.splice(to, 0, id);
    onChange(next);
  };
  return (
    <div>
      <div className="text-sm font-semibold gray-label mb-1">퀵 메뉴 구성</div>
      <p className="text-xs text-faint mb-2">
        우하단 ⚡ 버튼{isMobile ? '' : ' 또는 단축키(기본 Ctrl+K)'}로 여는 퀵
        메뉴에 담을 기능을 고릅니다. 위에서부터 나열 순서대로 표시됩니다.
      </p>
      {/* ⚡ 플로팅 버튼 옵트인 (2026-07-18 피드백 — 기본 숨김) */}
      <div className="flex items-center gap-2 mb-1">
        <input
          type="checkbox"
          id="cfgQuickMenuButton"
          checked={showButton}
          onChange={(e) => setShowButton(e.target.checked)}
        />
        <label htmlFor="cfgQuickMenuButton" className="text-sm gray-label">
          ⚡ 플로팅 버튼 표시
        </label>
      </div>
      <p className="text-xs text-faint mb-2 ml-6">
        끄면(기본) 화면의 퀵 메뉴 버튼이 숨겨집니다.
        {isMobile
          ? ' 모바일에서는 버튼이 유일한 진입점이므로 사용하려면 켜세요.'
          : ' 버튼 없이도 단축키(기본 Ctrl+K)로 계속 열 수 있습니다.'}
      </p>
      <div className="rounded-md border line-color divide-y divide-[var(--c-line)] mb-2">
        {list.filter((id) => candidates.some((a) => a.id === id)).length === 0 && (
          <div className="text-xs text-muted p-2">비어 있음 — 아래에서 추가하세요</div>
        )}
        {list.map((id) =>
          candidates.some((a) => a.id === id) ? (
            <div key={id} className="flex items-center gap-1 px-2 py-1">
              <span className="flex-1 text-sm text-default truncate">{nameOf(id)}</span>
              <button className="btn-ghost rounded px-1.5 py-0.5 text-xs" onClick={() => move(id, -1)}>▲</button>
              <button className="btn-ghost rounded px-1.5 py-0.5 text-xs" onClick={() => move(id, 1)}>▼</button>
              <button
                className="btn-ghost rounded px-1.5 py-0.5 text-xs"
                onClick={() => onChange(list.filter((x) => x !== id))}
              >
                ✕
              </button>
            </div>
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {candidates
          .filter((a) => !included.has(a.id))
          .map((a) => (
            <button
              key={a.id}
              className="btn rounded-full border line-color px-2.5 py-1 text-xs text-default bg-[var(--c-input-bg)]"
              onClick={() => onChange([...list, a.id])}
            >
              + {nameOf(a.id)}
            </button>
          ))}
      </div>
      <button
        className="btn-link text-xs"
        onClick={() => onChange(undefined)}
        disabled={value === undefined}
      >
        추천 기본값으로 되돌리기
      </button>
    </div>
  );
};

const ToolbarTab = ({ uiToolbar, setUiToolbar, quickMenu, setQuickMenu, quickMenuButton, setQuickMenuButton }: any) => (
  <div className="space-y-5">
    <ToolbarLayoutEditor
      value={uiToolbar}
      onChange={setUiToolbar}
      groups={[
        { title: '씬 툴바', area: 'scene', registry: sceneToolbarRegistry },
        { title: '프로젝트 바', area: 'project', registry: projectToolbarRegistry },
      ]}
      mobileMode={isMobile}
    />
    <hr className="line-color" />
    <QuickMenuEditor value={quickMenu} onChange={setQuickMenu} showButton={quickMenuButton} setShowButton={setQuickMenuButton} />
  </div>
);

/* ── 탭: 레이아웃 ── */
// 각 템플릿의 미니 와이어프레임 도안(라이브 프리뷰가 아닌 순수 CSS 사각형 배치 도안).
// 색은 테마 토큰만 사용하고, 하단바 위치만 상태 강조색(sky)으로 표현한다.
const LayoutWireframe = ({
  variant,
}: {
  variant: 'classic' | 'compact' | 'sidebar' | 'modern';
}) => {
  if (variant === 'modern') {
    // 모던: 좌측 아주 얇은 스트립(강조) + 프리셋 + 본문, 하단바 없음 + 플로팅 위젯.
    return (
      <div className="w-28 h-16 relative">
        <div className="h-full rounded-sm border line-color flex gap-0.5 p-0.5">
          <div className="w-1 rounded-sm bg-sky-500" />
          <div className="w-1/4 rounded-sm bg-[var(--c-zone)]" />
          <div className="flex-1 rounded-sm bg-[var(--c-zone)]" />
        </div>
        <div className="absolute bottom-1 right-1 w-5 h-2.5 rounded-sm bg-sky-500 shadow-sm" />
      </div>
    );
  }
  if (variant === 'sidebar') {
    // 사이드바: 좌측 두꺼운 프로젝트 바(강조색) + 프리셋 + 본문 + 아래 얇은 바.
    return (
      <div className="w-28 h-16 flex flex-col gap-1">
        <div className="flex-1 rounded-sm border line-color flex gap-0.5 p-0.5">
          <div className="w-2 rounded-sm bg-sky-500" />
          <div className="w-1/4 rounded-sm bg-[var(--c-zone)]" />
          <div className="flex-1 rounded-sm bg-[var(--c-zone)]" />
        </div>
        <div className="h-2 rounded-sm bg-[var(--c-zone)] flex-none" />
      </div>
    );
  }
  if (variant === 'compact') {
    // 컴팩트: 하단바 없이 콘텐츠가 세로로 꽉 참(패널+본문 분할) + 우하단 작은 플로팅 위젯 도안.
    return (
      <div className="w-28 h-16 relative">
        <div className="h-full rounded-sm border line-color flex gap-0.5 p-0.5">
          <div className="w-1/4 rounded-sm bg-[var(--c-zone)]" />
          <div className="flex-1 rounded-sm bg-[var(--c-zone)]" />
        </div>
        {/* 떠 있는 생성 컨트롤 위젯(우하단 작은 사각형) */}
        <div className="absolute bottom-1 right-1 w-5 h-2.5 rounded-sm bg-sky-500 shadow-sm" />
      </div>
    );
  }
  // classic: 위 큰 콘텐츠(좌측 좁은 패널 + 우측 넓은 본문) + 아래 가로 얇은 바
  return (
    <div className="w-28 h-16 flex flex-col gap-1">
      <div className="flex-1 rounded-sm border line-color flex gap-0.5 p-0.5">
        <div className="w-1/4 rounded-sm bg-[var(--c-zone)]" />
        <div className="flex-1 rounded-sm bg-[var(--c-zone)]" />
      </div>
      <div className="h-2 rounded-sm bg-sky-500 flex-none" />
    </div>
  );
};

// 직접 편집(EditModeShell)으로 바뀐 레이아웃 배치를 템플릿 기본값으로 되돌린다.
// 대상: 패널 좌/우(history·preset·project) + 생성 컨트롤 슬롯(uiLayoutSlots) + 분리형
// 위젯 위치(genWidget) + 동반 슬롯(uiCompanionSlots — ② A 실기 피드백 3). 동반 슬롯의
// "기본값"은 템플릿 의존: 모던이면 모던 기본 배치, 그 외에는 배정 없음(전부 툴바 복귀).
// 모던 해제 후 흩어진 버튼을 일괄 복귀시키는 유일한 수단이라 여기 포함한다.
// 선택한 템플릿(uiLayoutTemplate)은 사용자가 명시적으로 고른 값이라 건드리지 않는다.
// 이 필드들은 ConfigScreen 저장 흐름 밖(편집 모드/드래그가 즉시 반영)이라 여기서도
// 즉시 반영한다(applyLayoutSlots·applyGenWidget·applyCompanionSlots 패턴과 동일).
async function resetLayoutArrangement() {
  appState.uiLayoutSlots = {};
  appState.genWidget = {};
  const companionDefaults: Record<string, string[]> =
    appState.uiLayoutTemplate === 'modern'
      ? JSON.parse(JSON.stringify(MODERN_COMPANION_DEFAULTS))
      : {};
  appState.uiCompanionSlots = companionDefaults;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({
      ...config,
      uiLayoutSlots: {},
      genWidget: {},
      uiCompanionSlots: companionDefaults,
    });
  } catch (e) {
    console.error('레이아웃 배치 초기화 저장 실패:', e);
  }
}

// 동반 슬롯(L3-3 → E3) — 프리셋 에디터 "호스트 행" 옆 전역 버튼 배치의 편집 배선.
// E2 에서 계약이 "호스트 목록 + portable 전체 풀 + 유일성"으로 확대됐고, E3 에서 이 화면의
// 편집 UI 를 단일 토글 → 버튼별 위치 선택(CompanionButtonsSection)으로 일반화한다. 쓰기는
// 단일 출처 헬퍼(assign/removeCompanion)를 경유하며, 표시명은 uiLayout·companionSlots 의
// 레지스트리/라벨을 조회한다(여기서 중복 정의하지 않음).

// 영속 헬퍼 applyCompanionSlots 는 E4 에서 CompanionDnd 로 이관(드래그·드롭다운 공유
// 단일 출처). 여기서는 그걸 import 해 쓴다 — 동작·저장 패턴 동일(새 객체 할당 + 병합 저장).

// 동반 버튼 편집(E3) — portable 버튼 8종 각각에 "위치"를 고른다. 이동 의미론상 한 버튼은
// 최대 한 곳이라 select 단일 선택이 자연스럽다: '기본 (툴바)' = 슬롯 배정 없음(removeCompanion),
// 그 외 = 해당 호스트 행에 배정(assignCompanion). observer 라 appState.uiCompanionSlots 변경
// 시 이 목록도 즉시 갱신되고, applyCompanionSlots 가 열려 있는 프리셋 에디터에도 함께 반영한다.
// 슬롯 내 순서(같은 호스트 여러 버튼)는 배정 순 — 순서 조정은 E4 드래그 소관이라 여기선 없다.
const CompanionButtonsSection = observer(() => (
  <div className="pt-3 border-t line-color">
    <label className="block text-sm gray-label mb-1">동반 버튼</label>
    <p className="text-xs text-muted mb-2">
      행에 배치한 버튼은 툴바에서 그 위치로 이동합니다. 저장 없이 바로 적용됩니다.
    </p>
    <div className="space-y-2">
      {portableButtonMetas().map(({ id, name }) => {
        const owner = companionOwnerOf(id, appState.uiCompanionSlots) ?? '';
        return (
          <div key={id} className="flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate text-sm text-default">{name}</span>
            <select
              className="flex-none w-36 rounded-md line-color shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
              value={owner}
              onChange={(e) => {
                const host = e.target.value;
                const next = host
                  ? assignCompanion(appState.uiCompanionSlots, host, id)
                  : removeCompanion(appState.uiCompanionSlots, id);
                applyCompanionSlots(next);
              }}
            >
              <option value="">기본 (툴바)</option>
              {COMPANION_HOSTS.map((h) => (
                <option key={h} value={h}>
                  {COMPANION_HOST_LABELS[h] ?? h}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  </div>
));

// 창 배치(FloatView 노출 범위) 도안 — sky 사각형이 뷰어가 덮는 영역.
const FloatScopeWireframe = ({ variant }: { variant: 'cover' | 'center' }) => (
  <div className="w-28 h-16 flex flex-col gap-1">
    <div className="flex-1 rounded-sm border line-color flex gap-0.5 p-0.5">
      {variant === 'center' ? (
        <>
          <div className="w-1/4 rounded-sm bg-[var(--c-zone)]" />
          <div className="flex-1 rounded-sm bg-sky-500" />
          <div className="w-1/5 rounded-sm bg-[var(--c-zone)]" />
        </>
      ) : (
        <>
          <div className="flex-1 rounded-sm bg-sky-500" />
          <div className="w-1/5 rounded-sm bg-[var(--c-zone)]" />
        </>
      )}
    </div>
    <div className="h-2 rounded-sm bg-[var(--c-zone)] flex-none" />
  </div>
);

// 창 배치 선택지 — id 는 config 저장 키(uiFloatViewMode)라 배포 후 불변.
const floatViewModes: {
  id: 'cover' | 'center';
  name: string;
  description: string;
}[] = [
  {
    id: 'cover',
    name: '넓게 펼침',
    description:
      '이미지 뷰어 등 큰 화면이 좌우 패널 위까지 넓게 열립니다. 히스토리 패널은 유지됩니다.',
  },
  {
    id: 'center',
    name: '중앙 영역만',
    description:
      '큰 화면이 중앙 영역 안에만 열려, 좌우 패널(프롬프트 등)을 같이 보며 작업할 수 있습니다.',
  },
];

const LayoutTab = ({ uiLayoutTemplate, setUiLayoutTemplate, setModernExitReset, uiPresetIconRow, setUiPresetIconRow, uiToolbar, setUiToolbar, quickMenu, setQuickMenu, quickMenuButton, setQuickMenuButton, uiFloatViewMode, setUiFloatViewMode, mobileMode, onClose }: any) => (
  <div className="space-y-5">
    <div>
      <label className="block text-sm gray-label mb-1">화면 배치</label>
      <p className="text-xs text-muted">
        작업 화면의 하단 바 위치를 바꿉니다. 누르고 <b>저장</b>하면 적용됩니다.
      </p>
    </div>

    {/* 편집 모드 진입점(PC 전용) — 실제 화면 위에서 버튼·패널 배치를 드래그로 조정.
        모바일은 클래식 강제라 비활성 + "PC 전용" 표시(위 템플릿 칩과 동일 패턴). */}
    <div>
      <button
        type="button"
        disabled={mobileMode}
        onClick={() => {
          if (mobileMode) return;
          appState.editMode = true;
          // 기존 닫기 경로(onClose)를 그대로 태운다.
          onClose();
        }}
        className={
          'flex w-full items-center gap-3 rounded-md r-card border p-2.5 text-left clickable line-color ' +
          (mobileMode ? 'opacity-50 cursor-not-allowed ' : '')
        }
      >
        <FaSlidersH size={16} className="flex-none text-muted" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-default">화면에서 직접 편집</span>
            {mobileMode && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--c-zone)] text-muted flex-none">
                PC 전용
              </span>
            )}
          </div>
          <div className="text-xs text-muted mt-0.5">
            실제 화면에서 버튼·패널 배치를 드래그로 조정합니다
          </div>
        </div>
      </button>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {layoutTemplates.map((t) => {
        const selected = uiLayoutTemplate === t.id;
        // 모바일에서 미허용 템플릿은 resolveLayout 이 어차피 classic 으로 강제하므로
        // UI 는 안내용으로만 비활성 처리한다.
        const disabled = mobileMode && !t.mobileAllowed;
        return (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              // 모던 사이드바 = 저장 시 버튼 배치를 초기화하고 모던 기본 배치를 강제
              // 적용하므로(② A 결정 2), 선택 시점에 미리 경고·동의를 받는다.
              if (t.id === 'modern' && uiLayoutTemplate !== 'modern') {
                appState.pushDialog({
                  type: 'confirm',
                  text: '모던 사이드바를 적용하면 저장 시 프로젝트 툴바가 사라지고, 버튼 배치(툴바·동반 슬롯)가 초기화된 뒤 모던 기본 배치가 적용됩니다. 계속할까요?',
                  callback: () => {
                    setModernExitReset(false);
                    setUiLayoutTemplate('modern');
                  },
                });
                return;
              }
              // 모던 → 다른 템플릿(② A 2차 피드백 후속 1): 흩어진 버튼·레이아웃 배치를
              // 초기화할지 묻는다. 아니요(취소) = 전환만 하고 현재 배치 유지.
              if (uiLayoutTemplate === 'modern' && t.id !== 'modern') {
                setUiLayoutTemplate(t.id);
                appState.pushDialog({
                  type: 'confirm',
                  text: '모던 사이드바를 해제합니다. 저장 시 버튼과 레이아웃 배치를 기본값으로 초기화할까요? (취소 = 현재 배치 유지)',
                  callback: () => setModernExitReset(true),
                });
                return;
              }
              setUiLayoutTemplate(t.id);
            }}
            className={
              'flex items-center gap-3 rounded-md border p-2.5 text-left clickable ' +
              (selected ? 'ring-2 ring-sky-400 border-sky-400 ' : 'line-color ') +
              (disabled ? 'opacity-50 cursor-not-allowed ' : '')
            }
          >
            <LayoutWireframe
              variant={t.id as 'classic' | 'compact' | 'sidebar' | 'modern'}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-default">{t.name}</span>
                {!t.mobileAllowed && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--c-zone)] text-muted flex-none">
                    PC 전용
                  </span>
                )}
              </div>
              <div className="text-xs text-muted mt-0.5">{t.description}</div>
            </div>
          </button>
        );
      })}
    </div>

    {mobileMode && (
      <p className="text-xs text-muted">
        모바일에서는 클래식 배치가 사용됩니다.
      </p>
    )}

    {/* 프리셋 패널 버튼 하단 아이콘 행(릴리스 준비 ② B) — 템플릿과 독립인 선택
        옵션(PC·모바일 공용, 저장 시 적용). */}
    <div className="pt-3 border-t line-color">
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgPresetIconRow" checked={uiPresetIconRow}
          onChange={(e: any) => setUiPresetIconRow(e.target.checked)} />
        <label htmlFor="cfgPresetIconRow" className="text-sm gray-label">프리셋 패널 버튼을 하단 아이콘 행으로 정리</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        캐릭터 프롬프트·샘플링/모델·바이브·캐릭터 레퍼런스 버튼을 패널 최하단의
        아이콘 한 줄로 모아 프롬프트 공간을 넓힙니다.
      </p>
    </div>

    {/* 창 배치 — FloatView(이미지 뷰어 등 큰 화면)가 덮는 영역. PC 전용
        (모바일은 좌우 패널이 없어 항상 중앙 영역과 동일). 저장 시 적용. */}
    <div className="pt-3 border-t line-color">
      <label className="block text-sm gray-label mb-1">창 배치</label>
      <p className="text-xs text-muted mb-2">
        씬 이미지 목록·뷰어처럼 화면을 덮는 창이 차지할 영역을 정합니다.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {floatViewModes.map((m) => {
          const selected = (uiFloatViewMode ?? 'cover') === m.id;
          return (
            <button
              key={m.id}
              type="button"
              disabled={mobileMode}
              onClick={() => { if (!mobileMode) setUiFloatViewMode(m.id); }}
              className={
                'flex items-center gap-3 rounded-md border p-2.5 text-left clickable ' +
                (selected ? 'ring-2 ring-sky-400 border-sky-400 ' : 'line-color ') +
                (mobileMode ? 'opacity-50 cursor-not-allowed ' : '')
              }
            >
              <FloatScopeWireframe variant={m.id} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-default">{m.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--c-zone)] text-muted flex-none">
                    PC 전용
                  </span>
                </div>
                <div className="text-xs text-muted mt-0.5">{m.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>

    {/* 직접 편집으로 옮긴 패널·생성 컨트롤 배치를 되돌리는 초기화(즉시 반영, 저장 불필요).
        슬롯/위젯 위치는 저장 흐름 밖이라 여기서 바로 config 에 쓴다. */}
    <div className="pt-3 border-t line-color">
      <button
        type="button"
        className="round-button back-gray btn-sm"
        onClick={() => {
          appState.pushDialog({
            type: 'confirm',
            text: '화면에서 직접 편집으로 옮긴 패널 좌/우 배치·생성 컨트롤 위치·동반 버튼 배치를 현재 템플릿의 기본값으로 되돌립니다. (선택한 템플릿은 유지됩니다.) 계속할까요?',
            callback: async () => {
              await resetLayoutArrangement();
              appState.pushMessage('레이아웃 배치를 초기화했습니다');
            },
          });
        }}
      >
        레이아웃 배치 초기화
      </button>
      <p className="text-xs text-muted mt-1">
        화면에서 직접 편집으로 옮긴 패널·생성 컨트롤 배치를 되돌립니다. 저장 없이
        즉시 적용됩니다.
      </p>
    </div>

    {/* 툴바 전역 조작(② A 2차 피드백 후속 2 — 툴바 탭 흡수, PC 전용): 버튼별 배치
        select·동반 버튼 select 는 편집 모드 드래그(고정/⋯메뉴/숨김/동반 배정)가 전부
        대체해 제거. 남는 전역 조작 3종(클래식 토글·버튼 배치 초기화·퀵 메뉴 구성)만
        이관. 모바일은 편집 모드가 없어 기존 툴바 탭이 유지된다. */}
    {!mobileMode && (
      <div className="pt-3 border-t line-color space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="cfgClassicToolbar"
              checked={!!uiToolbar.classic}
              onChange={(e: any) =>
                setUiToolbar({ ...uiToolbar, classic: e.target.checked || undefined })
              }
            />
            <label htmlFor="cfgClassicToolbar" className="text-sm gray-label">
              클래식 툴바 사용 (이전 배치로 되돌리기)
            </label>
          </div>
          <p className="text-xs text-faint mt-1 ml-6">
            켜면 모든 버튼을 예전처럼 툴바에 나란히 표시합니다(⋯ 메뉴·개별 배치
            무시). 저장 시 반영됩니다.
          </p>
        </div>
        <div>
          <button
            type="button"
            className="round-button back-gray btn-sm"
            onClick={() => setUiToolbar({ classic: uiToolbar.classic })}
          >
            버튼 배치 초기화
          </button>
          <p className="text-xs text-muted mt-1">
            화면에서 직접 편집으로 옮긴 버튼 배치(고정/⋯메뉴/숨김·순서)를 모두 기본
            배치로 되돌립니다. (저장 시 반영)
          </p>
        </div>
        <QuickMenuEditor value={quickMenu} onChange={setQuickMenu} showButton={quickMenuButton} setShowButton={setQuickMenuButton} />
      </div>
    )}

    {/* 동반 버튼(E3) — portable 버튼을 프리셋 에디터 특정 행 옆으로 옮기는 위치 선택.
        모바일 전용(② A 2차 피드백 후속 2): PC 는 편집 모드 드래그(E4)가 대체. 모바일은
        편집 모드가 없어 이 select 가 유일한 배정 수단이라 유지한다. */}
    {mobileMode && <CompanionButtonsSection />}
  </div>
);

const ConfigScreen = observer(({ onSave, onClose }: ConfigScreenProps) => {
  const { curSession } = appState;
  const [activeTab, setActiveTab] = useState(0);

  // state
  const [imageEditor, setImageEditor] = useState('');
  const [useGPU, setUseGPU] = useState(false);
  const [whiteMode, setWhiteMode] = useState(false);
  const [delayTime, setDelayTime] = useState(0);
  const [classicSceneCard, setClassicSceneCard] = useState(false);
  const [legacyProjectMode, setLegacyProjectMode] = useState(false);
  const [legacySceneEditor, setLegacySceneEditor] = useState(false);
  const [legacyWorkflowMode, setLegacyWorkflowMode] = useState(false);
  const [sceneToolbarLegacyText, setSceneToolbarLegacyText] = useState(false);
  const [storageWriteGuard, setStorageWriteGuard] = useState(true);
  const [fullWordAc, setFullWordAc] = useState(appState.fullWordAutoComplete);
  const [trueDark, setTrueDark] = useState(false);
  const [exportConcurrency, setExportConcurrency] = useState(isMobile ? 2 : 4);
  const [useLocalBgRemoval, setUseLocalBgRemoval] = useState(false);
  const [refreshImage, setRefreshImage] = useState(false);
  const [autoConvertWebp, setAutoConvertWebp] = useState(false);
  const [autoWebpQuality, setAutoWebpQuality] = useState(80);
  const [ready, setReady] = useState(false);
  const [quality, setQuality] = useState('');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState(0);
  const [accessToken, setAccessToken] = useState('');
  const [saveLocation, setSaveLocation] = useState('');
  const [defaultExportFolder, setDefaultExportFolder] = useState('');
  const [uiTheme, setUiTheme] = useState<UiThemeConfig>({});
  const [uiThemePresets, setUiThemePresets] = useState<
    NonNullable<Config['uiThemePresets']>
  >([]);
  const [uiToolbar, setUiToolbar] = useState<UiToolbarConfig>({});
  const [quickMenuCfg, setQuickMenuCfg] = useState<string[] | undefined>(undefined);
  const [quickMenuButton, setQuickMenuButton] = useState(false);
  const [uiLayoutTemplate, setUiLayoutTemplate] = useState('classic');
  const [uiPresetIconRow, setUiPresetIconRow] = useState(false);
  // 모던 해제 확인(② A 2차 피드백 후속 1): 모던 → 다른 템플릿 전환 시 "배치 초기화"에
  // 동의했는지. true 면 저장 시 버튼(툴바·동반)·레이아웃 배치를 기본값으로 되돌린다.
  const [modernExitReset, setModernExitReset] = useState(false);
  const [uiFloatViewMode, setUiFloatViewMode] = useState<'cover' | 'center'>('cover');
  const [uiFont, setUiFont] = useState<'pretendard' | 'system'>('system');
  const [uiClassicFinish, setUiClassicFinish] = useState(false);
  const [allowDuplicateProjectOpen, setAllowDuplicateProjectOpen] = useState(false);
  // 미저장 변경 감지 기준 — 로드/저장 시점의 config 스냅샷 (#17)
  const [savedCfg, setSavedCfg] = useState<Config | null>(null);
  const mobileMode = isMobile;

  useEffect(() => {
    (async () => {
      const config = await backend.getConfig();
      setWhiteMode(config.whiteMode ?? false);
      setImageEditor(config.imageEditor ?? 'photoshop');
      setUseGPU(config.useCUDA ?? false);
      setQuality(config.removeBgQuality ?? 'normal');
      setRefreshImage(config.refreshImage ?? false);
      setAutoConvertWebp(config.autoConvertWebp ?? false);
      setAutoWebpQuality(config.autoConvertWebpQuality ?? 80);
      setUseLocalBgRemoval(config.useLocalBgRemoval ?? false);
      setDelayTime(config.delayTime ?? 0);
      setClassicSceneCard(config.classicSceneCard ?? false);
      setLegacyProjectMode(config.legacyProjectMode ?? false);
      setLegacySceneEditor(config.legacySceneEditor ?? false);
      setLegacyWorkflowMode(config.legacyWorkflowMode ?? false);
      setSceneToolbarLegacyText(config.sceneToolbarLegacyText ?? false);
      setStorageWriteGuard(config.storageWriteGuard ?? true);
      setTrueDark(config.trueDark ?? false);
      setExportConcurrency(config.exportConcurrency ?? (isMobile ? 2 : 4));
      setSaveLocation(config.saveLocation ?? '');
      setDefaultExportFolder(config.defaultExportFolder ?? '');
      setUiTheme(config.uiTheme ?? {});
      setUiThemePresets(config.uiThemePresets ?? []);
      setUiToolbar(config.uiToolbar ?? {});
      setQuickMenuCfg(config.quickMenu);
      setQuickMenuButton(config.quickMenuButton ?? false);
      setUiLayoutTemplate(config.uiLayoutTemplate ?? 'classic');
      setUiPresetIconRow(config.uiPresetIconRow ?? false);
      setUiFloatViewMode(config.uiFloatViewMode ?? 'cover');
      setUiFont(config.uiFont ?? 'system');
      setUiClassicFinish(config.uiClassicFinish ?? false);
      setAllowDuplicateProjectOpen(config.allowDuplicateProjectOpen ?? false);
      setSavedCfg(config);
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

  // 단축키 시스템에 ConfigScreen 열림 상태 전달
  useEffect(() => {
    appState.configScreenOpen = true;
    return () => { appState.configScreenOpen = false; };
  }, []);

  const roundTag = 'text-white text-xs px-2 py-1 rounded-full';

  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    const onChange = () => setLoggedIn(loginService.loggedIn);
    onChange();
    loginService.addEventListener('change', onChange);
    return () => loginService.removeEventListener('change', onChange);
  }, []);

  const loginWithToken = async () => {
    try {
      if (!accessToken.trim()) {
        appState.pushMessage('API 토큰을 입력해주세요.');
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
    // 저장하기 전에 실제 쓰기 가능 여부를 검증한다. 권한 없는 드라이브를 저장 경로로
    // 지정하면 다음 부팅에서 그 경로에 쓰기가 막혀(부팅 폴백이 없던 구버전은) 앱이
    // 무반응 상태로 벽돌이 되므로, 애초에 못 고르게 막는다.
    const check = await backend.checkWritable(folder);
    if (!check.ok) {
      appState.pushDialog({
        type: 'yes-only',
        text:
          `이 폴더에는 쓰기 권한이 없어 저장 위치로 사용할 수 없습니다.\n(${check.code})\n\n` +
          `다른 위치를 선택하거나, 해당 드라이브의 쓰기 권한을 먼저 확인해 주세요.`,
      });
      return;
    }
    const config = await backend.getConfig();
    config.saveLocation = folder;
    await backend.setConfig(config);
    setSaveLocation(folder);
    appState.pushDialog({ type: 'yes-only', text: '저장 위치 지정 완료. 프로그램을 껐다 켜주세요' });
  };

  const selectDefaultExportFolder = async () => {
    const folder = await backend.selectDir();
    if (!folder) return;
    setDefaultExportFolder(folder);
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
      autoConvertWebp: autoConvertWebp,
      autoConvertWebpQuality: autoWebpQuality,
      whiteMode: whiteMode,
      useLocalBgRemoval: useLocalBgRemoval,
      delayTime: delayTime,
      classicSceneCard: classicSceneCard,
      legacyProjectMode: legacyProjectMode,
      legacySceneEditor: legacySceneEditor,
      legacyWorkflowMode: legacyWorkflowMode,
      sceneToolbarLegacyText: sceneToolbarLegacyText,
      storageWriteGuard: storageWriteGuard,
      exportConcurrency: exportConcurrency,
      defaultExportFolder: defaultExportFolder || undefined,
      trueDark: trueDark,
      uiTheme: uiTheme,
      uiThemePresets: uiThemePresets.length > 0 ? uiThemePresets : undefined,
      uiToolbar: uiToolbar,
      quickMenu: quickMenuCfg,
      quickMenuButton: quickMenuButton,
      uiLayoutTemplate: uiLayoutTemplate,
      uiPresetIconRow: uiPresetIconRow,
      uiFloatViewMode: uiFloatViewMode,
      uiFont: uiFont,
      uiClassicFinish: uiClassicFinish,
      allowDuplicateProjectOpen: allowDuplicateProjectOpen,
    };
    // 모던 사이드바 "최초 전환" 시(② A 결정 2): 버튼 배치(툴바·동반 슬롯)를 초기화하고
    // 모던 기본 배치+하단 아이콘 행을 강제 적용한다. 이후 재커스텀 자유, 해제(다른
    // 템플릿 복귀) 시엔 배치를 손대지 않는다(초기화 유지 — 이전 커스텀 복원 없음).
    const modernApplied =
      uiLayoutTemplate === 'modern' && old.uiLayoutTemplate !== 'modern';
    if (modernApplied) {
      config.uiToolbar = {};
      config.uiCompanionSlots = JSON.parse(
        JSON.stringify(MODERN_COMPANION_DEFAULTS),
      );
      config.uiPresetIconRow = true;
    }
    // 모던 해제 + 초기화 동의(② A 2차 피드백 후속 1): 버튼(툴바 개별 배치·동반 슬롯)·
    // 레이아웃(패널 좌/우·생성 위젯)·하단 아이콘 행을 기본값으로. 클래식 툴바 토글은
    // 배치가 아닌 모드라 유지한다.
    const modernExited =
      modernExitReset &&
      uiLayoutTemplate !== 'modern' &&
      old.uiLayoutTemplate === 'modern';
    if (modernExited) {
      config.uiToolbar = { classic: uiToolbar.classic };
      config.uiCompanionSlots = {};
      config.uiLayoutSlots = {};
      config.genWidget = {};
      config.uiPresetIconRow = false;
    }
    await backend.setConfig(config);
    setSavedCfg(config);
    if (old.useCUDA !== useGPU) localAIService.modelChanged();
    appState.classicSceneCard = classicSceneCard;
    appState.legacyProjectMode = legacyProjectMode;
    appState.legacySceneEditor = legacySceneEditor;
    appState.legacyWorkflowMode = legacyWorkflowMode;
    appState.sceneToolbarLegacyText = sceneToolbarLegacyText;
    appState.uiToolbar = uiToolbar;
    appState.quickMenu = quickMenuCfg;
    appState.quickMenuButton = quickMenuButton;
    appState.uiLayoutTemplate = uiLayoutTemplate;
    appState.uiPresetIconRow = uiPresetIconRow;
    appState.uiFloatViewMode = uiFloatViewMode;
    appState.uiFont = uiFont;
    appState.uiClassicFinish = uiClassicFinish;
    appState.allowDuplicateProjectOpen = allowDuplicateProjectOpen;
    appState.storageWriteGuard = storageWriteGuard;
    appState.fullWordAutoComplete = fullWordAc;
    // 모던 전환 강제 배치의 미러·로컬 상태 반영(위의 일괄 미러가 옛 상태 값을 덮으므로
    // 마지막에 덮어써야 한다 — dirty 재계산도 이 로컬 상태와 savedCfg 로 일치).
    if (modernApplied) {
      appState.uiToolbar = {};
      appState.uiCompanionSlots = JSON.parse(
        JSON.stringify(MODERN_COMPANION_DEFAULTS),
      );
      appState.uiPresetIconRow = true;
      setUiToolbar({});
      setUiPresetIconRow(true);
    }
    if (modernExited) {
      appState.uiToolbar = { classic: uiToolbar.classic };
      appState.uiCompanionSlots = {};
      appState.uiLayoutSlots = {};
      appState.genWidget = {};
      appState.uiPresetIconRow = false;
      setUiToolbar({ classic: uiToolbar.classic });
      setUiPresetIconRow(false);
    }
    // 모던 해제 동의 플래그는 1회성 — 저장이 소비한다(재전환 시 새로 묻는다).
    setModernExitReset(false);
    localStorage.setItem('sdstudio-full-word-autocomplete', fullWordAc ? 'true' : 'false');
    sessionService.configChanged();
    onSave();
  };

  // key 기반 탭 정의(표시 순서 = 배열 순서). 숫자 오프셋 매핑 대신 key 로 콘텐츠를
  // 고르므로, 플랫폼별로 탭을 끼우거나 빼도 매핑이 어긋나지 않는다.
  const tabs = [
    { key: 'login', label: '로그인', icon: <FaUser size={14} /> },
    { key: 'customization', label: '테마', icon: <FaPalette size={14} /> },
    // 툴바 탭은 모바일 전용(② A 2차 피드백 후속 2): PC 는 편집 모드 드래그가 버튼
    // 배치(고정/⋯메뉴/숨김·동반 배정)를 전부 대체해 select UI 를 없애고, 남는 전역
    // 조작(클래식 토글·버튼 배치 초기화·퀵 메뉴 구성)은 레이아웃 탭으로 이관.
    // 모바일은 편집 모드가 없어 기존 select UI 가 유일한 수단이라 탭을 유지한다.
    ...(mobileMode ? [{ key: 'toolbar', label: '툴바', icon: <FaThLarge size={14} /> }] : []),
    { key: 'layout', label: '레이아웃', icon: <FaColumns size={14} /> },
    ...(!mobileMode ? [{ key: 'storage', label: '저장/이미지', icon: <FaFolder size={14} /> }] : []),
    { key: 'system', label: '시스템', icon: <FaCog size={14} /> },
    { key: 'personal', label: '개인 설정', icon: <FaSlidersH size={14} /> },
    // 복구는 모바일 전용 탭(데스크탑은 '저장/이미지' 탭 안에 동일 기능 존재)
    ...(mobileMode ? [{ key: 'recovery', label: '복구', icon: <FaWrench size={14} /> }] : []),
    ...(!mobileMode ? [{ key: 'keybindings', label: '키 바인딩', icon: <FaKeyboard size={14} /> }] : []),
  ];

  const getTabContent = (tabIdx: number) => {
    const key = tabs[tabIdx]?.key;
    switch (key) {
      case 'login':
        return <LoginTab {...{ accessToken, setAccessToken, loggedIn, loginWithToken, roundTag }} />;
      case 'storage':
        return <StorageImageTab {...{ saveLocation, selectFolder, clearImageCache, refreshImage, setRefreshImage, defaultExportFolder, setDefaultExportFolder, selectDefaultExportFolder, autoConvertWebp, setAutoConvertWebp, autoWebpQuality, setAutoWebpQuality, imageEditor, setImageEditor, useLocalBgRemoval, setUseLocalBgRemoval, ready, stage, progress, stageTexts, useGPU, setUseGPU, quality, setQuality }} />;
      case 'system':
        return <SystemTab {...{ delayTime, setDelayTime, storageWriteGuard, setStorageWriteGuard, exportConcurrency, setExportConcurrency, autoConvertWebp, setAutoConvertWebp, autoWebpQuality, setAutoWebpQuality }} />;
      case 'personal':
        return <PersonalTab {...{ classicSceneCard, setClassicSceneCard, fullWordAc, setFullWordAc, legacyProjectMode, setLegacyProjectMode, legacySceneEditor, setLegacySceneEditor, legacyWorkflowMode, setLegacyWorkflowMode, sceneToolbarLegacyText, setSceneToolbarLegacyText, uiFont, setUiFont, uiClassicFinish, setUiClassicFinish, allowDuplicateProjectOpen, setAllowDuplicateProjectOpen }} />;
      case 'customization':
        return <CustomizationTab {...{ uiTheme, setUiTheme, whiteMode, setWhiteMode, trueDark, setTrueDark, uiThemePresets, setUiThemePresets }} />;
      case 'toolbar':
        return <ToolbarTab {...{ uiToolbar, setUiToolbar, quickMenu: quickMenuCfg, setQuickMenu: setQuickMenuCfg, quickMenuButton, setQuickMenuButton }} />;
      case 'layout':
        return <LayoutTab {...{ uiLayoutTemplate, setUiLayoutTemplate, setModernExitReset, uiPresetIconRow, setUiPresetIconRow, uiToolbar, setUiToolbar, quickMenu: quickMenuCfg, setQuickMenu: setQuickMenuCfg, quickMenuButton, setQuickMenuButton, uiFloatViewMode, setUiFloatViewMode, mobileMode, onClose }} />;
      case 'recovery':
        return <RecoveryTab />;
      case 'keybindings':
        return <KeyBindingsTab />;
      default:
        return null;
    }
  };

  // 미저장 변경 여부 (#17) — handleSave 가 저장하는 필드만 비교(로드 시와 같은 기본값 적용).
  // saveLocation 은 선택 즉시 저장되므로 제외. 객체(uiTheme/uiToolbar)는 JSON 직렬화 비교.
  const dirty =
    savedCfg != null &&
    (imageEditor !== (savedCfg.imageEditor ?? 'photoshop') ||
      useGPU !== (savedCfg.useCUDA ?? false) ||
      quality !== (savedCfg.removeBgQuality ?? 'normal') ||
      refreshImage !== (savedCfg.refreshImage ?? false) ||
      autoConvertWebp !== (savedCfg.autoConvertWebp ?? false) ||
      autoWebpQuality !== (savedCfg.autoConvertWebpQuality ?? 80) ||
      whiteMode !== (savedCfg.whiteMode ?? false) ||
      useLocalBgRemoval !== (savedCfg.useLocalBgRemoval ?? false) ||
      delayTime !== (savedCfg.delayTime ?? 0) ||
      classicSceneCard !== (savedCfg.classicSceneCard ?? false) ||
      legacyProjectMode !== (savedCfg.legacyProjectMode ?? false) ||
      legacySceneEditor !== (savedCfg.legacySceneEditor ?? false) ||
      legacyWorkflowMode !== (savedCfg.legacyWorkflowMode ?? false) ||
      sceneToolbarLegacyText !== (savedCfg.sceneToolbarLegacyText ?? false) ||
      storageWriteGuard !== (savedCfg.storageWriteGuard ?? true) ||
      exportConcurrency !== (savedCfg.exportConcurrency ?? (isMobile ? 2 : 4)) ||
      (defaultExportFolder || '') !== (savedCfg.defaultExportFolder ?? '') ||
      trueDark !== (savedCfg.trueDark ?? false) ||
      // fullWordAc 는 config 파일이 아니라 appState+localStorage 저장 — 저장 시 appState 가 갱신되므로 그것과 비교
      fullWordAc !== appState.fullWordAutoComplete ||
      JSON.stringify(uiTheme) !== JSON.stringify(savedCfg.uiTheme ?? {}) ||
      JSON.stringify(uiThemePresets) !== JSON.stringify(savedCfg.uiThemePresets ?? []) ||
      JSON.stringify(uiToolbar) !== JSON.stringify(savedCfg.uiToolbar ?? {}) ||
      JSON.stringify(quickMenuCfg ?? null) !== JSON.stringify(savedCfg.quickMenu ?? null) ||
      quickMenuButton !== (savedCfg.quickMenuButton ?? false) ||
      uiLayoutTemplate !== (savedCfg.uiLayoutTemplate ?? 'classic') ||
      uiPresetIconRow !== (savedCfg.uiPresetIconRow ?? false) ||
      uiFloatViewMode !== (savedCfg.uiFloatViewMode ?? 'cover') ||
      uiFont !== (savedCfg.uiFont ?? 'system') ||
      uiClassicFinish !== (savedCfg.uiClassicFinish ?? false) ||
      allowDuplicateProjectOpen !== (savedCfg.allowDuplicateProjectOpen ?? false));

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 'var(--z-modal)',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <div
        className={'relative w-[90vw] max-w-xl md:max-w-2xl bg-[var(--c-zone)] rounded-xl shadow-2xl flex flex-col overflow-hidden border line-color ' + (mobileMode ? 'max-h-[90vh]' : 'max-h-[85vh]')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 미저장 변경 표시 (#17) — 헤더 중앙 빈 공간 위 절대배치 오버레이.
            흐름에 끼우면 열릴 때마다 내용이 밀리므로 absolute + pointer-events-none 로
            레이아웃·클릭에 영향 0. 닫기를 막지 않는 안내 전용. */}
        {dirty && (
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap shadow-sm bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-900/80 dark:text-amber-200 dark:border-amber-600">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-300" />
            저장 안 된 변경
          </div>
        )}
        {/* 헤더 */}
        <div className="flex items-center justify-between px-3 md:px-5 py-3 border-b line-color flex-none">
          <h1 className="text-base font-semibold text-default">환경설정</h1>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-muted transition-colors"
            onClick={onClose}
          >
            <FaTimes size={16} />
          </button>
        </div>
        {/* 탭 바 — 탭이 많아도 줄바꿈 대신 가로 스크롤.
            모바일=스크롤바 숨김(스와이프) / PC=얇은 스크롤바 표기 + Shift 없이 휠로 이동 */}
        <div
          className={
            'flex flex-nowrap overflow-x-auto border-b line-color px-2 flex-none ' +
            (mobileMode ? 'no-scrollbars' : 'thin-hscroll')
          }
          onWheel={(e) => {
            if (!mobileMode && e.deltaY) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
        >
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              className={
                'flex flex-none items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ' +
                (activeTab === i
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-transparent text-muted hover:text-gray-700 dark:hover:text-gray-200')
              }
              onClick={() => setActiveTab(i)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        {/* 탭 콘텐츠 — CSS Grid로 모든 탭을 같은 셀에 겹쳐 높이 통일 */}
        <div className="flex-1 overflow-auto px-3 py-4 md:p-5 overflow-x-hidden" style={{ minHeight: 0 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gridTemplateRows: '1fr',
          }}>
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
        <div className="flex-none px-3 py-4 md:p-4 border-t line-color">
          <button className="btn w-full back-sky py-2.5 rounded-lg font-medium"
            onClick={handleSave}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
});

export default ConfigScreen;
