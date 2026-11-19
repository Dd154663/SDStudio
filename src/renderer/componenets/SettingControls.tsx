// 설정 화면 공용 부품(2026-11-19 UI 정돈 시범 ②③) — 시범 적용은 환경설정 「커스텀」·「레이아웃」 탭(+ 같은 부품인 퀵 메뉴 구성).
// · SettingGroup     = 제목 있는 묶음 상자(.setting-group). 환경설정 PC 2단(cfg-two-col)에서는 탭 뿌리의 직계 자식이라
//                      상자 하나가 한 단 안에서 쪼개지지 않는다.
// · SettingCheckRow  = 체크 상자 한 줄. <label> 이 체크 상자·제목·설명을 감싸 글자를 눌러도 토글된다.
//                      <input type="checkbox"> 와 id 는 그대로(모양만 .setting-check — appearance:none), 저장·키보드·낭독기 불변.
// · SettingField     = 체크 줄이 아닌 항목(글꼴 고르기·선택 칸·버튼)을 묶음 안에서 체크 줄과 같은 들여쓰기로 둔다.
// 색·움직임은 App.css(.setting-*·.ui-press, prefers-reduced-motion 에서 끔). react 외 의존 없음.
import { ReactNode } from 'react';

export function SettingGroup({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={title}
      data-setting-group={title}
      className={'setting-group' + (className ? ' ' + className : '')}
    >
      <div className="setting-group-title" aria-hidden="true">
        {title}
      </div>
      {children}
    </div>
  );
}

export function SettingCheckRow({
  id,
  checked,
  onChange,
  disabled,
  label,
  note,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: ReactNode;
  // 제목 바로 뒤 짧은 덧붙임(예: 「클래식 마감에서는 항상 알약형」)
  note?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      data-setting-row={id}
      data-disabled={disabled ? '' : undefined}
      className="setting-check-row btn-ghost"
    >
      <input
        type="checkbox"
        id={id}
        className="setting-check"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className={'text-sm gray-label' + (disabled ? ' opacity-50' : '')}>{label}</span>
        {note && <span className="ml-2 text-xs text-faint">{note}</span>}
        {description && (
          <span className="block text-xs text-faint mt-0.5">{description}</span>
        )}
      </span>
    </label>
  );
}

export function SettingField({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={'setting-field' + (className ? ' ' + className : '')}>{children}</div>;
}
