import { useState } from 'react';
import { FaChevronDown } from 'react-icons/fa';
import { Resolution, resolutionMap } from '../backends/imageGen';
import { appState } from '../models/AppService';

// 해상도 표시 + 위로 열리는 드롭다운 피커 (2026-07-18, 퀵 생성 도입분을 공용 추출)
//  - 프리셋 목록: 씬 편집기와 동일하게 small 계열 제외, custom 은 직접 입력칸이 대신
//  - large/wallpaper 선택 시 Anlas 소모 confirm (씬 편집기 관례)
//  - 직접 입력은 64px 배수로 올림 보정
// 사용처: 퀵 생성 하단(QuickModeTab) / 프리셋 패널 새 씬 해상도 행(PreSetEdtior)

export interface ResolutionValue {
  resolution: string;
  width?: number;
  height?: number;
}

// 표시용 크기 계산 — 값이 없으면 portrait 기본값
export const resolutionValueToSize = (
  value: ResolutionValue | undefined,
): { width: number; height: number } => {
  if (!value) return resolutionMap.portrait;
  if (value.resolution === 'custom')
    return { width: value.width ?? 0, height: value.height ?? 0 };
  return (
    resolutionMap[value.resolution as Resolution] ?? resolutionMap.portrait
  );
};

interface ResolutionPickerProps {
  value: ResolutionValue | undefined;
  disabled?: boolean;
  // 확정된 변경만 전달한다 (Anlas confirm·64px 보정을 통과한 값)
  onApply: (v: ResolutionValue) => void;
  className?: string; // relative 래퍼에 추가 (예: flex-none)
  triggerClassName?: string; // 트리거 버튼에 추가 (예: h-full)
}

export const ResolutionPicker = ({
  value,
  disabled,
  onApply,
  className,
  triggerClassName,
}: ResolutionPickerProps) => {
  const [open, setOpen] = useState(false);
  const [wText, setWText] = useState('');
  const [hText, setHText] = useState('');
  const cur = resolutionValueToSize(value);

  const openPanel = () => {
    // 패널을 열 때 직접 입력칸을 현재 값으로 채운다
    setWText(String(cur.width || ''));
    setHText(String(cur.height || ''));
    setOpen(true);
  };

  const selectPreset = (key: Resolution) => {
    setOpen(false);
    const apply = () => onApply({ resolution: key });
    // Anlas 소모 해상도는 씬 편집기와 동일하게 확인을 거친다
    if (key.startsWith('large') || key.startsWith('wallpaper')) {
      appState.pushDialog({
        type: 'confirm',
        text: '해당 해상도는 Anlas를 소모합니다 (유료임) 계속하시겠습니까?',
        callback: apply,
      });
    } else {
      apply();
    }
  };

  const applyCustom = () => {
    const w = parseInt(wText);
    const h = parseInt(hText);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      appState.pushMessage('올바른 숫자를 입력해주세요');
      return;
    }
    // 64px 배수로 올림 보정 (씬 편집기 커스텀 해상도와 동일 규칙)
    const w64 = Math.max(64, (w + 63) & ~63);
    const h64 = Math.max(64, (h + 63) & ~63);
    setOpen(false);
    onApply({ resolution: 'custom', width: w64, height: h64 });
    if (w64 !== w || h64 !== h) {
      appState.pushMessage(`64px 배수로 보정되었습니다 — ${w64}x${h64}`);
    }
  };

  // 프리셋 목록: 씬 편집기와 동일하게 small 계열 제외, custom 은 입력칸이 대신한다
  const presetOptions = Object.entries(resolutionMap).filter(
    ([key]) => !key.startsWith('small') && key !== 'custom',
  ) as [Resolution, { width: number; height: number }][];

  return (
    <div className={'relative ' + (className ?? '')}>
      <button
        className={
          'flex items-center gap-1.5 px-3 rounded-lg border line-color bg-[var(--c-input-bg)] text-body text-sm whitespace-nowrap select-none hover:brightness-95 ' +
          (triggerClassName ?? 'py-1.5')
        }
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        {cur.width}x{cur.height}
        <FaChevronDown
          size={10}
          className={
            'text-faint transition-transform' + (open ? ' rotate-180' : '')
          }
        />
      </button>
      {open && (
        <>
          {/* 투명 백드롭 — 바깥 클릭 닫기 (퀵 메뉴 PC 팝오버 관례) */}
          <div
            className="fixed inset-0 z-[var(--z-widget)]"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full right-0 mb-2 z-[var(--z-widget)] w-56 rounded-lg border line-color bg-[var(--c-surface-2)] shadow-xl p-1.5">
            {presetOptions.map(([key, size]) => {
              const active =
                value?.resolution === key || (!value && key === 'portrait');
              return (
                <button
                  key={key}
                  className={
                    'btn-ghost w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm text-left ' +
                    (active ? 'font-semibold text-sky-500' : 'text-default')
                  }
                  onClick={() => selectPreset(key)}
                >
                  <span>
                    {size.width}x{size.height}
                  </span>
                  {(key.startsWith('large') || key.startsWith('wallpaper')) && (
                    <span className="text-[10px] text-amber-500">Anlas</span>
                  )}
                </button>
              );
            })}
            {/* 직접 입력 (64px 배수 자동 보정) */}
            <div className="border-t line-color mt-1.5 pt-1.5 px-1 pb-0.5">
              <div className="flex items-center gap-1.5">
                <input
                  className="w-0 flex-1 px-2 py-1 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  inputMode="numeric"
                  placeholder="너비"
                  value={wText}
                  onChange={(e) => setWText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
                />
                <span className="text-faint text-xs">x</span>
                <input
                  className="w-0 flex-1 px-2 py-1 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  inputMode="numeric"
                  placeholder="높이"
                  value={hText}
                  onChange={(e) => setHText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
                />
                <button
                  className="round-button back-sky text-sm !py-1 px-2.5 flex-none"
                  onClick={applyCustom}
                >
                  적용
                </button>
              </div>
              <div className="text-[10px] text-faint mt-1 px-0.5">
                직접 입력 — 64px 배수로 자동 보정
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
