// 진행 막대·스피너 공용 부품(UI 정돈 그룹 2-d) — 종전 자리마다 복사하던 마크업(App·MigrationGate·BatchCreateModal·
// CharacterPresetEditor·ArtistTagModal 막대, App·MigrationGate·ResultViewer 스피너)을 한 벌로.
// 진행 값 계산·문구·표시 조건은 호출부 그대로 — 이 부품은 모양만 맡는다.
// 하단 작업 진행 막대(TaskQueueControl)·진행 창의 큰 막대(ProgressWindow)는 고유 디자인이라 대상 아님.

/** 막대 모양 단일 출처(테스트·확인용). 트랙 = --c-input-bg, 채움 = --c-focus-ring, 알약 모서리. */
export const PROGRESS_TRACK_CLASS = 'w-full bg-[var(--c-input-bg)] rounded-full overflow-hidden';
export const PROGRESS_FILL_CLASS = 'h-full bg-[var(--c-focus-ring)] rounded-full transition-all';

/** 0~100 으로 자른 퍼센트(NaN·무한대는 0 — 전체 0 으로 나눈 자리). */
export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

type ProgressBarProps = {
  /** 0~1 비율. percent 와 둘 중 하나. */
  value?: number;
  /** 0~100 퍼센트. */
  percent?: number;
  /** 막대 높이 유틸(자리마다 지금 높이 유지 — 기본 h-2). */
  heightClass?: string;
  /** 바깥 여백 등 트랙에 덧붙일 유틸. */
  className?: string;
  /** 낭독기용 이름(선택). */
  label?: string;
};

export function ProgressBar({ value, percent, heightClass = 'h-2', className, label }: ProgressBarProps) {
  const pct = clampPercent(percent ?? (value ?? 0) * 100);
  return (
    <div
      className={`${PROGRESS_TRACK_CLASS} ${heightClass}${className ? ' ' + className : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      data-progress-bar=""
    >
      <div className={PROGRESS_FILL_CLASS} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 스피너 — 종전 마크업 그대로(지름 기본 32px). */
export const SPINNER_CLASS =
  'rounded-full border-2 border-[color:var(--c-line)] border-t-sky-500 animate-spin';

export function Spinner({ size = 32 }: { size?: number }) {
  return (
    <div
      className={SPINNER_CLASS}
      style={{ width: size, height: size }}
      data-spinner=""
    />
  );
}
