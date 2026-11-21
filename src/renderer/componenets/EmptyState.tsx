import type { HTMLAttributes, ReactNode } from 'react';

// 빈 상태 표시 공용 부품(UI 정돈 그룹 2-d) — 종전 자리마다 크기(text-xs/sm/lg)·색(faint/muted)·정렬이 제각각이던
// 「목록·영역이 비었을 때」 문구를 두 형으로 모은다. 아이콘·삽화는 넣지 않는다. 문구는 호출부 그대로.
//   작은 형(sm) = 목록 안: text-sm text-faint 가운데 정렬.
//   큰 형(lg)   = 영역 전체: text-base text-muted 가운데 정렬 + 선택적 둘째 줄 힌트 text-sm text-faint.
// 여백(py-*)·높이(h-full)·격자 칸 차지(col-span-full) 같은 자리별 배치는 className 으로 넘긴다.

export const EMPTY_STATE_SM_CLASS = 'text-sm text-faint text-center';
export const EMPTY_STATE_LG_CLASS = 'flex flex-col items-center justify-center gap-1 text-center';
export const EMPTY_STATE_LG_TEXT_CLASS = 'text-base text-muted';
export const EMPTY_STATE_HINT_CLASS = 'text-sm text-faint';

type EmptyStateProps = {
  size?: 'sm' | 'lg';
  /** 둘째 줄 힌트(선택). */
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children'>;

export function EmptyState({ size = 'sm', hint, className, children, ...rest }: EmptyStateProps) {
  const extra = className ? ' ' + className : '';
  if (size === 'lg') {
    return (
      <div className={EMPTY_STATE_LG_CLASS + extra} data-empty-state="lg" {...rest}>
        <div className={EMPTY_STATE_LG_TEXT_CLASS}>{children}</div>
        {hint != null && hint !== false && <div className={EMPTY_STATE_HINT_CLASS}>{hint}</div>}
      </div>
    );
  }
  return (
    <div className={EMPTY_STATE_SM_CLASS + extra} data-empty-state="sm" {...rest}>
      {children}
      {hint != null && hint !== false && <div className={'mt-1 ' + EMPTY_STATE_HINT_CLASS}>{hint}</div>}
    </div>
  );
}

export default EmptyState;
