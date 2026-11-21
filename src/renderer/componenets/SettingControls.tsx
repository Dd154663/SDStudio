// 설정 화면 공용 부품(2026-11-19 UI 정돈 시범 ②③) — 시범 적용은 환경설정 「커스텀」·「레이아웃」 탭(+ 같은 부품인 퀵 메뉴 구성).
// · SettingGroup     = 제목 있는 묶음 상자(.setting-group). 환경설정 PC 2단(cfg-two-col)에서는 탭 뿌리의 직계 자식이라
//                      상자 하나가 한 단 안에서 쪼개지지 않는다.
// · SettingCheckRow  = 체크 상자 한 줄. <label> 이 체크 상자·제목·설명을 감싸 글자를 눌러도 토글된다.
//                      <input type="checkbox"> 와 id 는 그대로(모양만 .setting-check — appearance:none), 저장·키보드·낭독기 불변.
// · SettingSwitchRow = 스위치 한 줄(누르는 즉시 저장되는 자리만, 2026-11-20). 글자 왼쪽·스위치 오른쪽 끝, input 은 role="switch".
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
          <span className="block text-xs text-muted mt-0.5">{description}</span>
        )}
      </span>
    </label>
  );
}

// 스위치 줄(2026-11-20 UI 정돈 그룹 1-a, 목업 승인) — 누르는 즉시 저장되는 자리 전용(「저장」 반영 자리는 SettingCheckRow).
// 글자(제목·설명)가 왼쪽, 스위치가 오른쪽 끝. 체크 줄과 같은 방식으로 <input type="checkbox" role="switch"> 를 그대로 두고
// 그림만 바꾼다(.setting-switch — appearance:none 트랙 + ::after 손잡이) — id·checked·disabled·스페이스 키·낭독기 유지,
// 엔터 키만 여기서 더한다(체크 상자는 기본으로 엔터에 반응하지 않음).
export function SettingSwitchRow({
  id,
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      data-setting-row={id}
      data-disabled={disabled ? '' : undefined}
      className="setting-switch-row btn-ghost"
    >
      <span className="min-w-0">
        <span className={'text-sm gray-label' + (disabled ? ' opacity-50' : '')}>{label}</span>
        {description && (
          <span className="block text-xs text-muted mt-0.5">{description}</span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        id={id}
        className="setting-switch"
        checked={checked}
        aria-checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (!disabled) onChange(!checked);
        }}
      />
    </label>
  );
}

// 스위치 하나(줄 없이 — 2026-11-20 UI 정돈 그룹 1-c). 높이·여백이 정해진 줄(사전 세팅 패널 field-row 등)이나
// 「라벨: [켬/끔] (?)」 처럼 다른 컨트롤과 한 줄에 섞인 자리에 그 줄 구조를 그대로 두고 끼운다.
// SettingSwitchRow 와 같은 input(role="switch"·.setting-switch·엔터 키), 배치는 사용처가 정한다.
// 주의: .setting-switch 의 margin 이 유틸(ml-auto 등)보다 뒤에 있어 이긴다 — 여백·밀어내기는 감싸개에 준다.
export function SettingSwitch({
  id,
  checked,
  onChange,
  disabled,
  ariaLabel,
  className,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      id={id}
      className={'setting-switch' + (className ? ' ' + className : '')}
      checked={checked}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (!disabled) onChange(!checked);
      }}
    />
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
