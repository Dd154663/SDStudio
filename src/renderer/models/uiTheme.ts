import { UiThemeConfig } from '../../main/config';

// UI 테마 커스터마이징: 사용자 "의도"(UiThemeConfig)를 실제 적용 CSS 변수 맵으로 파생하는
// 단일 출처. App.tsx(실적용)와 ConfigScreen 미리보기가 같은 함수를 써 동작 불일치를 막는다.

const HEX6 = /^#[0-9a-fA-F]{6}$/;
export const isHex6 = (v: string | undefined): v is string => !!v && HEX6.test(v);

// 배경색의 상대 휘도로 가독성 있는 전경(텍스트/아이콘) 색을 자동 결정.
export function readableFg(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // sRGB 가중 휘도 (대략). 임계값은 경험적으로 가독성 좋은 지점.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 150 ? '#000000' : '#ffffff';
}

// UiThemeConfig → 루트(또는 미리보기 컨테이너) style 에 주입할 --c-* 변수 맵.
// 미설정/유효하지 않은 값은 건너뛰어, 해당 토큰은 기본 테마 값을 그대로 따른다.
export function buildThemeVars(t?: UiThemeConfig): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!t) return vars;

  if (isHex6(t.surface)) vars['--c-surface'] = t.surface;
  if (isHex6(t.surface2)) vars['--c-surface-2'] = t.surface2;
  if (isHex6(t.inputBg)) {
    vars['--c-input-bg'] = t.inputBg;
    vars['--c-input-text'] = readableFg(t.inputBg);
  }

  // 텍스트 패턴: 본문/부가/아이콘 색을 흑백 한 세트로 일괄 전환(배경 가독성 보장).
  if (t.textPattern === 'light') {
    vars['--c-text'] = '#000000';
    vars['--c-text-sub'] = '#334155'; // slate-700
    vars['--c-text-label'] = '#374151'; // gray-700
    vars['--c-icon-text'] = '#4b5563'; // gray-600
  } else if (t.textPattern === 'dark') {
    vars['--c-text'] = '#ffffff';
    vars['--c-text-sub'] = '#e2e8f0'; // slate-200
    vars['--c-text-label'] = '#e2e8f0'; // slate-200
    vars['--c-icon-text'] = '#ffffff';
  }

  const setBtn = (name: string, color?: string) => {
    if (!isHex6(color)) return;
    vars[`--c-${name}-bg`] = color;
    vars[`--c-${name}-fg`] = readableFg(color);
  };

  if (t.unifyButtons) {
    // 통합: 초록/하늘/주황/노랑(즐겨찾기) = 강조 하나로, 회색=일반, 빨강=위험(삭제 유지).
    // 색을 명시하지 않아도 통합을 켜는 즉시 합쳐지도록 기본 역할색으로 폴백한다.
    const accent = isHex6(t.accent) ? t.accent : '#0ea5e9';
    const neutral = isHex6(t.neutral) ? t.neutral : '#6b7280';
    const danger = isHex6(t.danger) ? t.danger : '#ef4444';
    setBtn('green', accent);
    setBtn('sky', accent);
    setBtn('orange', accent);
    setBtn('yellow', accent);
    setBtn('gray', neutral);
    setBtn('red', danger);
  } else {
    const b = t.buttons ?? {};
    setBtn('green', b.green);
    setBtn('sky', b.sky);
    setBtn('orange', b.orange);
    setBtn('gray', b.gray);
    setBtn('red', b.red);
  }

  return vars;
}
