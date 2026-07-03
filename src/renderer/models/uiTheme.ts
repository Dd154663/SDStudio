import { UiThemeConfig } from '../../main/config';

// UI 테마 커스터마이징: 사용자 "의도"(UiThemeConfig)를 실제 적용 CSS 변수 맵으로 파생하는
// 단일 출처. App.tsx(실적용)와 ConfigScreen 미리보기가 같은 함수를 써 동작 불일치를 막는다.

const HEX6 = /^#[0-9a-fA-F]{6}$/;
export const isHex6 = (v: string | undefined): v is string => !!v && HEX6.test(v);

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// 두 색을 t(0~1) 비율로 선형 보간. 적응형 텍스트 스케일(기준색↔배경색)의 핵심.
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  return toHex(
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
  );
}

// 배경색의 상대 휘도로 가독성 있는 전경(텍스트/아이콘) 색을 자동 결정.
export function readableFg(hex: string): string {
  const c = parseHex(hex);
  if (!c) return '#ffffff';
  // sRGB 가중 휘도 (대략). 임계값은 경험적으로 가독성 좋은 지점.
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return lum > 150 ? '#000000' : '#ffffff';
}

// UiThemeConfig → 루트(또는 미리보기 컨테이너) style 에 주입할 --c-* 변수 맵.
// 미설정/유효하지 않은 값은 건너뛰어, 해당 토큰은 기본 테마 값을 그대로 따른다.
// baseIsLight: 기본 테마가 화이트 모드인지(버튼 명암 문맥의 최종 폴백).
export function buildThemeVars(
  t?: UiThemeConfig,
  baseIsLight?: boolean,
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!t) return vars;

  if (isHex6(t.surface)) vars['--c-surface'] = t.surface;
  if (isHex6(t.surface2)) vars['--c-surface-2'] = t.surface2;
  if (isHex6(t.inputBg)) {
    vars['--c-input-bg'] = t.inputBg;
    vars['--c-input-text'] = readableFg(t.inputBg);
  }

  // 텍스트 패턴: 강조 텍스트(기준색)부터 본문→보조→흐림까지 한 사다리를 적응형으로 파생.
  // 각 단계 = 기준색을 배경색 쪽으로 mix(t↑일수록 옅음). 배경을 커스텀(예: 핑크)하면
  // 보조/흐림 텍스트도 그 배경 쪽으로 물들어 자연스러운 대비를 유지한다.
  if (t.textPattern) {
    const base = t.textPattern === 'light' ? '#000000' : '#ffffff';
    // 파생 기준 배경: 커스텀 surface 우선, 없으면 패턴 기본 배경.
    const bg = isHex6(t.surface)
      ? t.surface
      : t.textPattern === 'light'
        ? '#ffffff'
        : '#0f172a';
    // 라이트(어두운 글자)는 옅어지는 폭을 더 크게, 다크(밝은 글자)는 작게.
    const k = t.textPattern === 'light' ? 1 : 0.7;
    vars['--c-text'] = base;
    vars['--c-text-sub'] = mix(base, bg, 0.18 * k);
    vars['--c-text-label'] = mix(base, bg, 0.28 * k);
    vars['--c-text-muted'] = mix(base, bg, 0.5 * k);
    vars['--c-text-faint'] = mix(base, bg, 0.68 * k);
    vars['--c-icon-text'] = mix(base, bg, 0.42 * k);
  }

  // 테두리/구분선(--c-line): 수동 지정 우선. 미지정이면 배경색 또는 텍스트 패턴이
  // 커스텀된 시점부터 적응 파생 — 텍스트 사다리 끝보다 더 배경에 녹는 옅은 선.
  // 명암 방향은 텍스트 패턴을 따르고, 패턴이 없으면 배경 명도로 추정한다.
  if (isHex6(t.lineColor)) {
    vars['--c-line'] = t.lineColor;
  } else if (t.textPattern || isHex6(t.surface)) {
    const lightish = t.textPattern
      ? t.textPattern === 'light'
      : readableFg(t.surface!) === '#000000';
    const base = lightish ? '#000000' : '#ffffff';
    const bg = isHex6(t.surface) ? t.surface : lightish ? '#ffffff' : '#0f172a';
    vars['--c-line'] = mix(base, bg, lightish ? 0.8 : 0.85);
  }

  // 구분 구역 배경(--c-zone): 폴더 등 색 대비가 중요한 영역. 커스텀 배경 "색조"는 따라가지
  // 않고, 텍스트 패턴의 "명도"만 맞춰(라이트=옅은 중립/다크=짙은 중립) 어떤 커스텀 테마에서도
  // 텍스트·식별색 대비가 깨지지 않게 고정한다. 사용자가 직접 지정하면 그 값을 우선.
  // (미설정 + 패턴 없음 → App.css의 모드별 기본값을 그대로 사용)
  if (isHex6(t.zoneBg)) {
    vars['--c-zone'] = t.zoneBg;
  } else if (t.textPattern) {
    vars['--c-zone'] = t.textPattern === 'light' ? '#eceff4' : '#1e293b';
  }

  // 버튼 색 파생의 명암 문맥: 텍스트 패턴 > 커스텀 배경 명도 > 기본 테마(라이트/다크)
  const btnLight = t.textPattern
    ? t.textPattern === 'light'
    : isHex6(t.surface)
      ? readableFg(t.surface) === '#000000'
      : (baseIsLight ?? false);

  const setBtn = (name: string, color?: string) => {
    if (!isHex6(color)) return;
    const c = parseHex(color)!;
    // 기본 테마(다크)의 버튼 언어를 따른다: 지정색을 원색 그대로 칠하지 않고
    // 옅은 반투명 틴트 배경으로 파생해 색이 튀지 않게 한다.
    vars[`--c-${name}-bg`] =
      `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${btnLight ? 0.2 : 0.25})`;
    // 텍스트는 지정색 색조를 따르지 않는다 — 유색 배경 위 반투명 틴트에서
    // 색조 텍스트는 가독성이 떨어지므로, 명암 문맥에 따른 불투명 흑/백 고정.
    vars[`--c-${name}-fg`] = btnLight ? '#000000' : '#ffffff';
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
