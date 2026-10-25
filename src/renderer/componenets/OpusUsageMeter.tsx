import React, { useEffect, useState } from 'react';
import type { OpusUsageStatus } from '../backends/imageGen';
import {
  OPUS_ESTIMATE_HELP,
  opusCheckedLabel,
  presentOpusUsage,
} from '../models/opusUsagePresentation';

export function OpusUsageHelp() {
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer select-none">
        예상 장수 기준 · 도움말
      </summary>
      <p className="mt-2 leading-relaxed">{OPUS_ESTIMATE_HELP}</p>
    </details>
  );
}

export function OpusCheckedTime({ checkedAt }: { checkedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    // Label updates only: never poll the server to advance the timestamp.
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span title={checkedAt ? new Date(checkedAt).toLocaleString() : undefined}>
      {opusCheckedLabel(checkedAt, now)}
    </span>
  );
}

// line: 부모(relative)의 맨 아래에 깔리는 3px 선 — 모바일 일렬 계정 표기용(2026-09-20).
export function OpusUsageBar({
  status,
  warningPercent = 10,
  line = false,
}: {
  status?: OpusUsageStatus;
  warningPercent?: number;
  line?: boolean;
}) {
  const view = presentOpusUsage(status, warningPercent);
  if (status?.opusSubscribed === false) return null;
  const round = line ? '' : ' rounded-full';
  return (
    <div
      className={
        line
          ? 'absolute inset-x-0 bottom-0 h-[3px] bg-[var(--c-input-bg)]'
          : 'relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--c-input-bg)]'
      }
      role="progressbar"
      aria-label="Opus 생성 할당량"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={view.percent === undefined ? undefined : view.fill}
      aria-valuetext={
        view.percent === undefined
          ? '미확인'
          : view.purchased > 0
            ? `무료 ${view.free}%, 추가 충전 ${view.purchased}% 남음`
            : `${view.text} 남음`
      }
    >
      {/* 추가 충전분이 있으면 2중첩 — 아래 보라(합산 길이) 위에 무료분 막대를 겹친다(기준 폭 = max(100, 합)). */}
      {view.purchased > 0 && (
        <div
          data-opus-bar="purchased"
          className={`absolute inset-y-0 left-0 opus-usage-bar-fill${round}`}
          style={
            {
              width: `${view.fill}%`,
              '--opus-fill-bg': 'var(--c-purple-bg)',
              '--opus-fill-fg': 'var(--c-purple-fg)',
            } as React.CSSProperties
          }
        />
      )}
      <div
        data-opus-bar="free"
        className={`relative h-full opus-usage-bar-fill${round}`}
        style={
          {
            width: `${view.freeFill}%`,
            '--opus-fill-bg': `var(--c-${view.tone}-bg)`,
            '--opus-fill-fg': `var(--c-${view.tone}-fg)`,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

export default function OpusUsageMeter({
  status,
  checkedAt = 0,
  warningPercent = 10,
  loading = false,
  error,
  stale = false,
}: {
  status?: OpusUsageStatus;
  checkedAt?: number;
  warningPercent?: number;
  loading?: boolean;
  error?: string;
  stale?: boolean;
}) {
  const view = presentOpusUsage(status, warningPercent);
  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <strong className="text-xl text-default tabular-nums">
          {view.detailText}
        </strong>
        <span className="text-sm text-body tabular-nums">
          {view.images !== undefined
            ? `약 ${view.images.toLocaleString('ko-KR')}장`
            : status?.opusSubscribed === false
              ? 'Opus 미구독 · 무료 할당량 대상 아님'
            : loading
              ? '확인 중…'
              : error || '미확인'}
        </span>
      </div>
      <OpusUsageBar status={status} warningPercent={warningPercent} />
      {view.purchased > 0 && (
        <p className="text-xs text-body tabular-nums">
          무료 회복분 {view.free}% · 추가 충전 {view.purchased}%(회복되지 않음)
        </p>
      )}
      {view.percent === 0 && (
        <p className="text-xs back-red rounded px-2 py-1">
          할당량 소진 · 생성 시 Anlas 사용
        </p>
      )}
      {view.usingPurchased && (
        <p className="text-xs text-body">
          무료 할당량 소진 · 추가 충전분 사용 중(Anlas 소비 없음)
        </p>
      )}
      {view.percent !== undefined && view.free > 100 && (
        <p className="text-xs text-body">
          기본 한도보다 {view.free - 100}%p 초과
        </p>
      )}
      <div className="text-xs text-muted flex flex-wrap items-center gap-x-2 gap-y-1">
        {loading ? (
          <span>확인 중…</span>
        ) : error && status ? (
          <span>{error} · 이전 값</span>
        ) : stale ? (
          <span>이전 조회값</span>
        ) : null}
        <OpusCheckedTime checkedAt={checkedAt} />
      </div>
    </div>
  );
}
