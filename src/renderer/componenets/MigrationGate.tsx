// 트랙1 (b) 저장소 v2 마이그레이션 전면 게이트.
//
// migrationService.state 가 idle/done 이 아니면 App 전체(부팅 스피너 포함)를 덮는
// 전면 화면을 렌더한다. 부팅 게이트(bootReady) 이전에 실행되며, 백업/이동 진행과
// 백업 선택 다이얼로그를 담당한다. 스펙: track1-b-migration-spec.md §4.
//
// 색은 전부 --c-* 토큰(App.css), 버튼은 back-*/btn-solid-* 캡슐 클래스만 사용해
// 다크·화이트 양 테마 가독성을 보장한다(하드코딩 색 금지 — specGuard).

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { migrationService } from '../models/MigrationService';
import { appState } from '../models/AppService';
import { isMobile } from '../models';

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '알 수 없음';
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// 공용 카드 셸 — 세로 단순 레이아웃(모바일 호환).
// SaveLocationGate(저장 경로 폴백 가드)도 재사용한다.
export function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[var(--z-drag-overlay)] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
    >
      <div className="w-full max-w-md rounded-xl shadow-2xl border line-color bg-[var(--c-surface-2)] text-default p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="w-8 h-8 rounded-full border-2 border-[color:var(--c-line)] border-t-sky-500 animate-spin" />
  );
}

// ── 백업 선택 다이얼로그 ──
// "백업 없이 계속"은 실수 방지를 위해 인라인 2중 재확인(1차·최종)을 거친다.
// (부팅 게이트라 ConfirmWindow 미가용 — 카드 내용 교체 방식으로 확인 단계 구현)
const ChoicePanel = observer(() => {
  const [skipStep, setSkipStep] = useState<0 | 1 | 2>(0);
  const info = migrationService.spaceInfo;

  if (skipStep > 0) {
    return (
      <GateShell>
        <div className="text-lg font-semibold text-red-500 dark:text-red-400">
          {skipStep === 1 ? '백업 없이 진행 — 확인' : '백업 없이 진행 — 마지막 확인'}
        </div>
        <div className="text-sm text-sub whitespace-pre-line leading-relaxed">
          {skipStep === 1
            ? '백업 없이 이동을 진행하면 도중 문제가 발생했을 때 복구할 수단이 없습니다.\n\n정말 백업 없이 진행하시겠습니까?'
            : '마지막 확인입니다.\n\n정말 정말 백업 없이 진행하시겠습니까?'}
        </div>
        <div className="flex flex-col gap-2 mt-1">
          <button
            className="w-full px-4 py-2 rounded back-red clickable"
            onClick={() =>
              skipStep === 1
                ? setSkipStep(2)
                : migrationService.chooseSkipBackup()
            }
          >
            {skipStep === 1 ? '네, 백업 없이 진행합니다' : '네, 정말 진행합니다'}
          </button>
          <button
            className="w-full px-4 py-2 rounded back-gray clickable"
            onClick={() => setSkipStep(0)}
          >
            돌아가기
          </button>
        </div>
      </GateShell>
    );
  }

  return (
    <GateShell>
      <div className="text-lg font-semibold text-default">
        저장소 구조 업데이트
      </div>
      <div className="text-sm text-sub whitespace-pre-line leading-relaxed">
        {
          '더 안전하고 빠른 새 저장 방식으로 전환합니다.\n전환 전 전체 데이터를 백업하는 것을 권장합니다. 백업 후 이동이 진행되며, 완료까지 앱을 사용할 수 없습니다.'
        }
      </div>
      {info && (
        <div className="text-xs text-muted rounded-md bg-[var(--c-zone)] p-3 flex flex-col gap-1">
          <div>
            예상 백업 크기:{' '}
            {info.measured
              ? `약 ${formatBytes(info.estimatedBytes)}`
              : info.estimatedBytes > 0
                ? `약 ${formatBytes(info.estimatedBytes)} (정밀 계산 중…)`
                : '계산 중…'}
          </div>
          <div>사용 가능 공간: {formatBytes(info.freeBytes)}</div>
          {!info.sufficient && (
            <div className="text-orange-500 dark:text-orange-400 mt-1">
              여유 공간이 부족하거나 확인할 수 없습니다. 이미지 최적화(설정 → 일괄
              작업)로 공간을 확보할 수 있습니다.
            </div>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2 mt-1">
        <button
          className="w-full px-4 py-2 rounded back-sky clickable"
          onClick={() => migrationService.chooseProceed()}
        >
          백업 후 진행 (권장)
        </button>
        <button
          className="w-full px-4 py-2 rounded back-red clickable"
          onClick={() => setSkipStep(1)}
        >
          백업 없이 계속 (주의 — 복구 불가)
        </button>
        <button
          className="w-full px-4 py-2 rounded back-gray clickable"
          onClick={() => migrationService.chooseLater()}
        >
          나중에 하기
        </button>
        <button
          className="w-full px-4 py-2 rounded back-gray clickable"
          onClick={() => migrationService.chooseDismiss()}
        >
          다시 알리지 않음
        </button>
        <div className="text-xs text-muted">
          다시 알리지 않음을 선택해도 환경설정 → 시스템 → 저장소 구조에서 언제든
          다시 시작할 수 있습니다.
        </div>
      </div>
    </GateShell>
  );
});

const MigrationGate = observer(() => {
  const state = migrationService.state;
  if (state === 'idle' || state === 'done') return null;

  if (state === 'awaiting-choice') {
    return <ChoicePanel />;
  }

  // ── 백업 진행 ──
  if (state === 'backing-up') {
    const ep = appState.exportProgress;
    return (
      <GateShell>
        <div className="flex items-center gap-3">
          <Spinner />
          <div className="text-lg font-semibold text-default">백업 중…</div>
        </div>
        <div className="text-sm text-sub">
          {migrationService.backupPhase || '데이터를 백업하고 있습니다.'}
        </div>
        {/* PC: 파일별 진행(zip-progress→exportProgress) 구독. Android: 단계 문구만. */}
        {!isMobile && ep && !ep.completed && (
          <div>
            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full transition-all"
                style={{
                  width: `${(ep.done / Math.max(ep.total, 1)) * 100}%`,
                }}
              />
            </div>
            <div className="text-xs text-muted mt-1">
              {ep.done}/{ep.total}
            </div>
          </div>
        )}
        <div className="text-xs text-orange-500 dark:text-orange-400">
          완료될 때까지 앱을 종료하지 마세요. 화면을 끄거나 다른 앱으로
          전환하면 작업이 중단될 수 있습니다.
        </div>
      </GateShell>
    );
  }

  // ── 이동 진행 ──
  if (state === 'migrating') {
    const total = migrationService.projectTotal;
    const cur = migrationService.projectCurrent;
    const pct = total > 0 ? (cur / total) * 100 : 0;
    return (
      <GateShell>
        <div className="flex items-center gap-3">
          <Spinner />
          <div className="text-lg font-semibold text-default">
            프로젝트 이동 중…
          </div>
        </div>
        <div className="text-sm text-sub truncate">
          {migrationService.currentProjectName || '준비 중…'}
        </div>
        {migrationService.backupReused && (
          <div className="text-xs text-muted">
            기존 백업을 재사용했습니다 (백업 단계 생략).
          </div>
        )}
        <div>
          <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-500 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-xs text-muted mt-1">
            {cur}/{total}
          </div>
        </div>
        <div className="text-xs text-orange-500 dark:text-orange-400">
          완료될 때까지 앱을 종료하지 마세요. 화면을 끄거나 다른 앱으로
          전환하면 작업이 중단될 수 있습니다.
        </div>
      </GateShell>
    );
  }

  // ── 실패 ──
  if (state === 'failed') {
    const fatal = migrationService.fatal;
    const failed = migrationService.failedProjects;
    return (
      <GateShell>
        <div className="text-lg font-semibold text-red-500 dark:text-red-400">
          {fatal ? '마이그레이션 실패' : '일부 프로젝트 이동 실패'}
        </div>
        {fatal ? (
          <>
            <div className="text-sm text-sub whitespace-pre-line leading-relaxed">
              {
                '마이그레이션 도중 오류가 발생했습니다. 앱을 다시 시작하면 남은 작업을 자동으로 이어서 진행합니다.'
              }
            </div>
            {migrationService.errorMessage && (
              <div className="text-xs text-muted rounded-md bg-[var(--c-zone)] p-3 break-words">
                {migrationService.errorMessage}
              </div>
            )}
            <button
              className="w-full px-4 py-2 rounded back-sky clickable mt-1"
              onClick={() => window.location.reload()}
            >
              앱 다시 시작
            </button>
          </>
        ) : (
          <>
            <div className="text-sm text-sub leading-relaxed">
              대부분의 프로젝트는 이동을 마쳤지만, 아래 프로젝트는 건너뛰었습니다
              (원본은 그대로 남아 있습니다):
            </div>
            <div className="text-xs text-muted rounded-md bg-[var(--c-zone)] p-3 max-h-40 overflow-y-auto flex flex-col gap-1">
              {failed.map((n, i) => (
                <div key={i} className="break-words">
                  • {n}
                </div>
              ))}
            </div>
            <button
              className="w-full px-4 py-2 rounded back-sky clickable mt-1"
              onClick={() => migrationService.acknowledge()}
            >
              계속
            </button>
          </>
        )}
      </GateShell>
    );
  }

  return null;
});

export default MigrationGate;
