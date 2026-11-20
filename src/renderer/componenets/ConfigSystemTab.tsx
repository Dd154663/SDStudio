// 설정 화면 탭: 시스템(key 'system', 라벨 「시스템」) — SystemTab(+FolderCleanupSection·LegacyCleanupSection·MigrationDiagSection·TaskLogSection)
import { useEffect, useState, useCallback } from 'react';
import {
  appUpdateNoticeService,
  backend,
  isMobile,
  sessionService,
  taskQueueService,
} from '../models';
import { platform } from '../models/platform';
import { appState } from '../models/AppService';
import { TaskLog } from '../models/TaskQueueService';
import {
  formatDelaySeconds,
  normalizeRequestDelayJitterMs,
  normalizeRequestDelayMs,
  REQUEST_DELAY_JITTER_MAX_MS,
  REQUEST_DELAY_MAX_MS,
  REQUEST_DELAY_STEP_MS,
  REQUEST_DELAY_TEXT,
} from '../models/requestTiming';
import { migrationService } from '../models/MigrationService';
import type { MigrationDiagStatus } from '../models/MigrationService';
import { persistService } from '../models/PersistenceService';
import {
  scanLegacyRemnants,
  deleteLegacyRemnants,
} from '../models/legacyCleanup';
import type { LegacyScanResult } from '../models/legacyCleanup';
import {
  EXAMPLE_VIBE_TEXT,
  removableItems,
  summarizeExampleVibeScan,
} from '../models/exampleVibeCleanup';
import type { ExampleVibeItem, ExampleVibeScanResult } from '../models/exampleVibeCleanup';
import {
  deleteExampleVibesNow,
  scanExampleVibesNow,
} from '../models/exampleVibeCleanupRuntime';
import { formatBytes } from '../models/googleDrive';
import ModalOverlay from './ModalOverlay';
import { SettingCheckRow, SettingField, SettingGroup } from './SettingControls';

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

  // 결과를 알린다 — 예전엔 실패를 삼키고 아무 안내도 없었다(2026-10-03 U1·X7).
  const deleteFiles = async (targets: { name: string }[]) => {
    setCleaning(true);
    let failed = 0;
    for (const f of targets) {
      try {
        await backend.deleteFile(folder + '/' + f.name);
      } catch (e) {
        failed++;
        console.error('파일 삭제 실패:', f.name, e);
      }
    }
    await loadFiles();
    setCleaning(false);
    const done = targets.length - failed;
    if (failed > 0) {
      appState.pushMessage(
        `${label}: ${done}개 삭제, ${failed}개는 삭제하지 못했습니다.`,
        'error',
      );
    } else {
      appState.pushMessage(`${label}: 파일 ${done}개를 삭제했습니다.`, 'success');
    }
  };

  // 네이티브 confirm/alert 대신 앱 확인 창·토스트(2026-10-03 U1·X7)
  const confirmDelete = async (targets: { name: string }[], text: string) => {
    const ok = await appState.confirmAsync({
      text: `${text}\n삭제한 파일은 되돌릴 수 없습니다.`,
      confirmText: '영구 삭제',
      danger: 'permanent',
    });
    if (ok) await deleteFiles(targets);
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
                  onClick={() =>
                    void confirmDelete(
                      files,
                      `${label}의 모든 파일(${files.length}개, ${formatSize(totalSize)})을 삭제합니다.`,
                    )
                  }
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
                        appState.pushMessage(`${days}일 이전 파일이 없습니다.`, 'info');
                        return;
                      }
                      void confirmDelete(
                        oldFiles,
                        `${days}일 이전 파일 ${oldFiles.length}개(${formatSize(oldSize)})를 삭제합니다.`,
                      );
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
    // 모바일은 영구 삭제(Enter 로 확정하지 않음), PC 는 OS 휴지통 이동(D1)
    appState.pushDialog({
      type: 'confirm',
      danger: isMobile ? 'permanent' : true,
      text: isMobile
        ? `구 저장소 잔재 ${summary}를 영구 삭제합니다.\n삭제 후에는 복구할 수 없습니다. 계속할까요?`
        : `구 저장소 잔재 ${summary}를 OS 휴지통으로 이동합니다.\n(필요 시 휴지통에서 복구할 수 있습니다)`,
      confirmText: isMobile ? '영구 삭제' : '정리 진행',
      callback: async () => {
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
          <div className="text-xs text-muted rounded-md bg-[var(--c-zone)] p-2 flex flex-col gap-0.5">
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

/* ── 시스템 탭 하위: 예제 프리셋 잔존 이미지 정리 (2026-11-15) ──
   이전 버전(PR #11 cf7cb6d 이전)이 새 프로젝트마다 vibes/ 에 써 둔 예제 프리셋 PNG 3종을 크기→SHA-256 로
   식별해, 프로젝트가 참조하지 않는 것만 사용자 확인 뒤 정리한다(models/exampleVibeCleanup.ts).
   검사 = 무쓰기. PC = OS 휴지통 이동(복구 가능), 모바일 = 영구 삭제. 되돌리기 기록 없음(구 저장소 잔재 정리와 같은 범주).
   저장소 배치와 무관하게 항상 표시한다. */
export const ExampleVibeCleanupSection = () => {
  const [scan, setScan] = useState<ExampleVibeScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const doScan = async () => {
    setScanning(true);
    try {
      setScan(await scanExampleVibesNow());
    } catch (e) {
      setScan(null);
      appState.pushMessage('예제 이미지 검사에 실패했습니다.', 'error');
    }
    setScanning(false);
  };

  const removable = scan ? removableItems(scan) : [];

  const doClean = () => {
    if (!scan || removable.length === 0 || cleaning) return;
    const { summary, easyPresetCount } = summarizeExampleVibeScan(scan);
    const easyLine =
      easyPresetCount > 0
        ? `\n퀵 생성 전용 프로젝트의 이지 모드 예제 프리셋 ${easyPresetCount}개도 함께 제거합니다.`
        : '';
    // 모바일은 영구 삭제(Enter 로 확정하지 않음), PC 는 OS 휴지통 이동 — LegacyCleanupSection 과 같은 두 문구 체계
    appState.pushDialog({
      type: 'confirm',
      danger: isMobile ? 'permanent' : true,
      text: isMobile
        ? `예제 프리셋 잔존 이미지(${summary})를 영구 삭제합니다.${easyLine}\n삭제 후에는 복구할 수 없습니다. 계속할까요?`
        : `예제 프리셋 잔존 이미지(${summary})를 OS 휴지통으로 이동합니다.${easyLine}\n(필요 시 휴지통에서 복구할 수 있습니다)`,
      confirmText: isMobile ? '영구 삭제' : '정리 진행',
      callback: async () => {
        setCleaning(true);
        const res = await deleteExampleVibesNow(removable, (done, total) =>
          setProgress({ done, total }),
        );
        setCleaning(false);
        setProgress(null);
        appState.pushMessage(
          res.failed.length > 0
            ? `예제 이미지 ${res.deleted}개 정리, ${res.failed.length}개 실패`
            : `예제 프리셋 잔존 이미지 ${res.deleted}개를 정리했습니다.` +
              (res.presetsRemoved > 0 ? ` (이지 모드 프리셋 ${res.presetsRemoved}개 제거)` : ''),
          res.failed.length > 0 ? 'error' : 'success',
        );
        await doScan();
      },
    });
  };

  // 프로젝트별 묶음(검사 순서 유지)
  const groups: { project: string; items: ExampleVibeItem[] }[] = [];
  for (const it of scan?.items ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.project === it.project) last.items.push(it);
    else groups.push({ project: it.project, items: [it] });
  }
  const summary = scan ? summarizeExampleVibeScan(scan) : null;

  return (
    // 묶음 상자(2026-11-20 UI 정돈 그룹 1-a) — 제목은 묶음 제목(EXAMPLE_VIBE_TEXT.label) 한 번만, 안쪽 줄은 [검사] 버튼만.
    // data-example-vibe-section 은 묶음 바깥 감싸개(시스템 탭 2단 흐름 단위, 제목 글자 포함)에 둔다.
    <div data-example-vibe-section>
     <SettingGroup title={EXAMPLE_VIBE_TEXT.label}>
     <SettingField className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          className="btn text-xs back-gray px-2 py-0.5 rounded"
          onClick={doScan}
          disabled={scanning || cleaning}
          data-example-vibe-scan
        >
          {scanning ? '검사 중...' : scan ? '새로고침' : '검사'}
        </button>
      </div>
      <p className="text-xs text-faint">{EXAMPLE_VIBE_TEXT.description}</p>
      {scan && scan.projectsFailed.length > 0 && (
        <p className="text-xs text-orange-500 dark:text-orange-400" data-example-vibe-failed>
          프로젝트 {scan.projectsFailed.length}개는 읽지 못해 검사하지 않았습니다:{' '}
          {scan.projectsFailed.join(', ')}
        </p>
      )}
      {scan && scan.items.length === 0 && (
        <p className="text-xs text-faint" data-example-vibe-empty>
          {EXAMPLE_VIBE_TEXT.none}
        </p>
      )}
      {scan && summary && scan.items.length > 0 && (
        <>
          <div className="text-sm gray-label" data-example-vibe-summary>
            {summary.summary}
          </div>
          {summary.referencedNote && (
            <p className="text-xs text-faint">{summary.referencedNote}</p>
          )}
          <div
            className="text-xs text-muted rounded-md bg-[var(--c-zone)] p-2 flex flex-col gap-1"
            data-example-vibe-list
          >
            {groups.map((g) => (
              <div key={g.project} data-example-vibe-project={g.project}>
                <div className="font-bold break-all">{g.project}</div>
                {g.items.map((it) => (
                  <div
                    key={it.fileName}
                    className="pl-3 flex items-center gap-2 flex-wrap"
                    data-example-vibe-item={it.fileName}
                  >
                    <span>
                      {it.label} ({formatBytes(it.size)})
                    </span>
                    {!it.referenced && it.easyPresets && it.easyPresets.length > 0 && (
                      <span className="px-1.5 rounded back-gray" data-example-vibe-easy-preset>
                        {EXAMPLE_VIBE_TEXT.easyPresetBadge}
                      </span>
                    )}
                    {it.referenced && (
                      <span
                        className="px-1.5 rounded back-gray"
                        data-example-vibe-referenced
                      >
                        {EXAMPLE_VIBE_TEXT.referencedBadge}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {removable.length > 0 && (
            <button
              className="btn text-sm back-red px-3 py-1.5 rounded"
              onClick={doClean}
              disabled={cleaning}
              data-example-vibe-clean
            >
              {cleaning
                ? progress
                  ? `정리 중... ${progress.done}/${progress.total}`
                  : '정리 중...'
                : isMobile
                  ? '영구 삭제'
                  : '휴지통으로 이동'}
            </button>
          )}
        </>
      )}
     </SettingField>
     </SettingGroup>
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
      type: 'confirm',
      text:
        '마이그레이션을 시작하려면 프로그램을 다시 시작해야 합니다.\n' +
        '다시 시작하면 부팅 시 마이그레이션 안내가 표시됩니다.\n\n지금 다시 시작할까요?',
      confirmText: '지금 다시 시작',
      callback: async () => {
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

  // 묶음 상자(2026-11-20 UI 정돈 그룹 1-a) — 진단을 읽은 뒤에만 그린다(빈 상자 방지). 제목은 묶음 제목 한 번만.
  return (
   <SettingGroup title="저장소 구조">
    <SettingField>
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
    </SettingField>
   </SettingGroup>
  );
};

/* ── 탭: 시스템 (기술·진단·정보) ── */
const SystemTab = ({
  requestDelayMs, setRequestDelayMs, requestDelayJitterMs, setRequestDelayJitterMs,
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
          items: [
            { text: '다운로드 페이지 열기', value: 'open' },
            { text: '다시 알리지 않음', value: 'dismiss' },
          ],
          // 내장 취소의 뜻은 「나중에」(다음 알림에서 다시 묻는다)
          cancelText: '나중에',
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
      {/* Google 드라이브 연동·환경설정 내보내기/불러오기는 「드라이브」 탭으로 옮겼다(드라이브 API ⑤). */}
      {/* 묶음 상자(2026-11-20 UI 정돈 그룹 1-a — 사용자 승인: 붙어 있는 구획만 합침): 저장 보호 / 생성 간격 / 이미지 최적화 /
          (모바일) WebP 자동 변환 / 폴더 정리 / 작업 로그 / 저장소 구조 / 예제 프리셋 잔존 이미지 정리 / 업데이트와 정보.
          항목·순서·문구·id·저장 방식은 그대로, 구분선(hr) 대신 상자. PC 는 cfg-two-col 이 상자 단위로 2단에 흘린다. */}
      <SettingGroup title="저장 보호">
        <SettingCheckRow
          id="cfgStorageGuard"
          checked={storageWriteGuard}
          onChange={setStorageWriteGuard}
          label="저장소 불안정 시 자동 저장 보호 (권장)"
          description="저장소 접근이 일시적으로 불안정할 때 자동 저장을 잠시 멈춰 데이터 손상을 막습니다. 멈춘 동안의 직전 편집은 저장이 미뤄질 수 있습니다(접근이 회복되면 자동 재개). 꺼도 손상 방지 가드는 항상 동작합니다."
        />
      </SettingGroup>
      <SettingGroup title="생성 간격">
       <SettingField>
        {/* 요청 사이 지연(2026-10-03 T3): 대기 = max(0, 지연 ± 무작위 폭), 단일 출처 requestTiming */}
        <label htmlFor="cfgRequestDelay" className="block text-sm gray-label mb-1">
          {REQUEST_DELAY_TEXT.delayLabel}
        </label>
        <div className="flex items-center gap-2">
          <input id="cfgRequestDelay" type="range" min={0} max={REQUEST_DELAY_MAX_MS} step={REQUEST_DELAY_STEP_MS}
            value={requestDelayMs}
            onChange={(e) => setRequestDelayMs(normalizeRequestDelayMs(Number(e.target.value)))}
            className="flex-1 min-w-0" />
          <span className="text-sm gray-label w-14 text-right flex-none tabular-nums">{formatDelaySeconds(requestDelayMs)}</span>
        </div>
        <label htmlFor="cfgRequestDelayJitter" className="block text-sm gray-label mb-1 mt-3">
          {REQUEST_DELAY_TEXT.jitterLabel}
        </label>
        <div className="flex items-center gap-2">
          <input id="cfgRequestDelayJitter" type="range" min={0} max={REQUEST_DELAY_JITTER_MAX_MS} step={REQUEST_DELAY_STEP_MS}
            value={requestDelayJitterMs}
            onChange={(e) => setRequestDelayJitterMs(normalizeRequestDelayJitterMs(Number(e.target.value)))}
            className="flex-1 min-w-0" />
          <span className="text-sm gray-label w-14 text-right flex-none tabular-nums">±{formatDelaySeconds(requestDelayJitterMs)}</span>
        </div>
        <p className="text-xs text-faint mt-1">
          {REQUEST_DELAY_TEXT.help}
        </p>
       </SettingField>
      </SettingGroup>
      <SettingGroup title="이미지 최적화">
       <SettingField>
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
       </SettingField>
      </SettingGroup>
      {/* 자동 WebP 변환 — 데스크톱은 저장경로 탭에 동일 설정이 있어 모바일만 노출 */}
      {isMobile && (
        <SettingGroup title="WebP 자동 변환">
          <SettingCheckRow
            id="cfgAutoWebpM"
            checked={autoConvertWebp}
            onChange={setAutoConvertWebp}
            label="새로 생성되는 이미지를 WebP로 자동 변환"
            description="생성 직후 PNG를 WebP로 재인코딩해 저장 용량을 줄입니다. 프롬프트 메타데이터와 NAI 인식(스텔스 워터마크)은 유지되며, 기존 이미지에는 영향이 없습니다. 변환에 실패하면 원본 PNG가 그대로 저장됩니다."
          />
          {autoConvertWebp && (
            <SettingField className="flex items-center gap-2">
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
            </SettingField>
          )}
        </SettingGroup>
      )}
      <SettingGroup title="폴더 정리">
        {/* exports·tmp 두 구획을 한 상자에 — 각자의 소제목(라벨)은 유지 */}
        <SettingField>
          <FolderCleanupSection folder="exports" label="exports 폴더 정리" />
        </SettingField>
        <SettingField className="pt-2">
          <FolderCleanupSection folder="tmp" label="tmp 폴더 정리" description="이미지 내보내기 시 생성되는 임시 파일이 저장됩니다." />
        </SettingField>
      </SettingGroup>
      <SettingGroup title="작업 로그">
        <SettingField>
          <TaskLogSection />
        </SettingField>
      </SettingGroup>
      {/* 저장소 구조 묶음은 MigrationDiagSection 이 진단을 읽은 뒤 스스로 그린다(읽기 전엔 아무것도 없음) */}
      <MigrationDiagSection />
      {/* 예제 프리셋 잔존 이미지 정리 — 구 저장소 잔재 정리 바로 아래, 저장소 배치와 무관하게 항상 표시 */}
      <ExampleVibeCleanupSection />
      <SettingGroup title="업데이트와 정보">
        {/* 업데이트·정보 두 구획을 한 상자에 — 각자의 소제목은 유지 */}
        <SettingField className="space-y-2">
          <label className="block text-sm gray-label mb-1">업데이트</label>
          <button
            className="px-3 py-1.5 text-sm back-sky rounded clickable disabled:opacity-50"
            disabled={checkingUpdate}
            onClick={handleCheckUpdate}
          >
            {checkingUpdate ? '확인 중...' : '업데이트 확인'}
          </button>
        </SettingField>
        <SettingField className="space-y-2 pt-2">
          <label className="block text-sm gray-label mb-1">정보</label>
          <div className="flex flex-col gap-1 text-sm">
            <a
              className="btn-link cursor-pointer"
              onClick={() => backend.openWebPage('https://github.com/Dd154663/SDStudio')}
            >
              GitHub — Dd154663/SDStudio
            </a>
            <a
              className="btn-link cursor-pointer"
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
        </SettingField>
      </SettingGroup>
      {showRickroll && (
        <ModalOverlay
          isOpen={true}
          onClose={() => setShowRickroll(false)}
          title="🎉 축하합니다!"
          size="m"
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

/* ── 작업 로그 ── */
// 테스트(overlayBundleD.test.tsx)용으로 내보낸다
// 로그 한 줄 서식 — 시간 서식기는 모듈에서 한 번만 만든다(줄마다 toLocaleTimeString 이 서식기를 새로 만들던 비용 제거,
// 2026-11-15 성능 조사 F1). 출력은 종전 `toLocaleTimeString('ko-KR', { hour12: false })` 와 같은 HH:MM:SS.
const taskLogTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const formatTaskLog = (log: TaskLog) => {
  const date = new Date(log.timestamp);
  const day =
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0');
  const time = taskLogTimeFormat.format(date);
  const levelLabel = log.level === 'error' ? '[오류]' : log.level === 'warn' ? '[경고]' : '[정보]';
  return `${day} ${time} ${levelLabel} [${log.scene}] ${log.message}`;
};

export const TaskLogSection = () => {
  const [showDialog, setShowDialog] = useState(false);
  const logs = taskQueueService.taskLogs;
  // 창은 공용 ModalOverlay(2026-11-14 오버레이 묶음 D, size m) — 뒤로 가기·Esc 는 이 창만 닫고(닫기 관문),
  // 바깥 클릭은 누름·뗌 모두 배경일 때만(글자 드래그 선택 중 닫힘 방지)이 래퍼에 내장돼 있다. 2026-10-03 U1·X2·X6.
  const formatLog = formatTaskLog;

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
      <ModalOverlay
        isOpen={showDialog}
        onClose={() => setShowDialog(false)}
        title="작업 로그"
        size="m"
        footer={
          <>
            {/* [다운로드][닫기] 순서(2026-10-03 D1) — 바닥 버튼 규격은 내보내기 프리셋 관리와 같음 */}
            <button
              className="px-4 py-2 rounded-lg btn-solid-sky text-sm font-medium transition-colors"
              onClick={downloadLogs}
              disabled={logs.length === 0}
            >
              다운로드
            </button>
            <button
              className="px-4 py-2 rounded-lg btn-neutral text-body text-sm transition-colors"
              onClick={() => setShowDialog(false)}
            >
              닫기
            </button>
          </>
        }
        footerStart={
          // 위험 보조 동작은 바닥줄 왼쪽(슬롯 규약) — 동작은 종전 그대로(확인 없음)
          <button
            className="px-4 py-2 rounded-lg btn-solid-red text-sm font-medium transition-colors"
            onClick={() => taskQueueService.clearLogs()}
            disabled={logs.length === 0}
          >
            초기화
          </button>
        }
      >
        {/* 목록은 창이 열렸을 때만 만든다 — 닫힌 ModalOverlay 는 아무것도 그리지 않지만 자식 JSX 는 부모 렌더 때
            먼저 계산되므로, 조건 없이 두면 시스템 탭이 다시 그려질 때마다 최대 500줄 서식이 돈다(묶음 D 에서
            `showDialog &&` 바깥으로 나갔던 것을 되돌림, 2026-11-15 성능 조사 F1). */}
        {showDialog && (
          <div className="text-xs font-mono" data-task-log-list>
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
        )}
      </ModalOverlay>
    </>
  );
};

export default SystemTab;
