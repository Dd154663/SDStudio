import React, { useState } from 'react';

// 모바일 WebView 의 네이티브 컬러 다이얼로그가 빈약해서, 앱 내장 HSL 슬라이더
// 피커로 대체한다. (플러그인 불필요 — input[type=range] + HSL↔hex 변환만 사용)

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || '').trim());
  let r = 14;
  let g = 165;
  let b = 233; // 기본 sky #0ea5e9
  if (m) {
    const int = parseInt(m[1], 16);
    r = (int >> 16) & 255;
    g = (int >> 8) & 255;
    b = int & 255;
  }
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const color =
      lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

interface Props {
  initial: string;
  onChange: (hex: string) => void;
  onClose?: () => void;
}

export default function MobileColorPicker({
  initial,
  onChange,
  onClose,
}: Props) {
  const [hsl, setHsl] = useState(() => hexToHsl(initial));
  const [hexText, setHexText] = useState(() => {
    const v = hexToHsl(initial);
    return hslToHex(v.h, v.s, v.l);
  });

  const apply = (next: { h: number; s: number; l: number }) => {
    setHsl(next);
    const hx = hslToHex(next.h, next.s, next.l);
    setHexText(hx);
    onChange(hx);
  };

  const onHexInput = (raw: string) => {
    setHexText(raw);
    if (/^#?[0-9a-fA-F]{6}$/.test(raw.trim())) {
      const next = hexToHsl(raw);
      setHsl(next);
      onChange(hslToHex(next.h, next.s, next.l));
    }
  };

  const preview = hslToHex(hsl.h, hsl.s, hsl.l);
  // 슬라이더 트랙 그라데이션
  const hueBg =
    'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)';
  const satBg = `linear-gradient(to right, hsl(${hsl.h} 0% ${hsl.l}%), hsl(${hsl.h} 100% ${hsl.l}%))`;
  const lightBg = `linear-gradient(to right, #000, hsl(${hsl.h} ${hsl.s}% 50%), #fff)`;

  return (
    <div
      className="w-full flex flex-col gap-2.5 pt-1"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-md flex-none border border-gray-300 dark:border-slate-500"
          style={{ backgroundColor: preview }}
        />
        <input
          value={hexText}
          onChange={(e) => onHexInput(e.target.value)}
          spellCheck={false}
          className="w-24 px-2 py-1 rounded-md text-sm bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-500 text-default outline-none"
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="gray-label w-8 flex-none text-xs">색상</span>
          <input
            type="range"
            min={0}
            max={360}
            value={hsl.h}
            onChange={(e) => apply({ ...hsl, h: parseInt(e.target.value, 10) })}
            className="color-slider flex-1"
            style={{ background: hueBg }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="gray-label w-8 flex-none text-xs">채도</span>
          <input
            type="range"
            min={0}
            max={100}
            value={hsl.s}
            onChange={(e) => apply({ ...hsl, s: parseInt(e.target.value, 10) })}
            className="color-slider flex-1"
            style={{ background: satBg }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="gray-label w-8 flex-none text-xs">명도</span>
          <input
            type="range"
            min={0}
            max={100}
            value={hsl.l}
            onChange={(e) => apply({ ...hsl, l: parseInt(e.target.value, 10) })}
            className="color-slider flex-1"
            style={{ background: lightBg }}
          />
        </div>
      </div>
      {onClose && (
        <div className="flex justify-end pt-0.5">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-md text-sm bg-gray-200 dark:bg-slate-600 text-body hover:bg-gray-300 dark:hover:bg-slate-500"
          >
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
