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

export function OpusUsageBar({
  status,
  warningPercent = 10,
}: {
  status?: OpusUsageStatus;
  warningPercent?: number;
}) {
  const view = presentOpusUsage(status, warningPercent);
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--c-input-bg)]"
      role="progressbar"
      aria-label="무료 생성 할당량"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={view.percent === undefined ? undefined : view.fill}
      aria-valuetext={
        view.percent === undefined ? '미확인' : `${view.text} 남음`
      }
    >
      <div
        className="h-full rounded-full opus-usage-bar-fill"
        style={
          {
            width: `${view.fill}%`,
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
          {view.text}
        </strong>
        <span className="text-sm text-body tabular-nums">
          {view.images !== undefined
            ? `약 ${view.images.toLocaleString('ko-KR')}장`
            : loading
              ? '확인 중…'
              : error || '미확인'}
        </span>
      </div>
      <OpusUsageBar status={status} warningPercent={warningPercent} />
      {view.percent === 0 && (
        <p className="text-xs back-red rounded px-2 py-1">
          무료 할당량 소진 · 생성 시 Anlas 사용
        </p>
      )}
      {view.percent !== undefined && view.percent > 100 && (
        <p className="text-xs text-body">
          기본 한도보다 {view.percent - 100}%p 초과
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
