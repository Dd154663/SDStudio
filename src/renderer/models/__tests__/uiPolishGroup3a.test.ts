// UI 정돈 그룹 3-a(2026-11-21, 움직임 — 공용 한 곳만 고치면 되는 것) 회귀 검사 — 소스 검사형(전역 CSS·큰 컴포넌트라 렌더 대신).
// 원칙: 창은 열림·닫힘 모두 즉시(등장 페이드 없음), opacity·transform 만, 0.15초 이하, 움직임 줄이기는 App.css 끝 한 곳(1ms 방식).
import * as fs from 'fs';
import * as path from 'path';

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('App.css');
const contexify = read('contexify.css');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 선택자 줄로 시작하는 마지막 블록 본문(같은 선택자가 앞에 있어도 이번에 더한 규칙을 본다)
const lastBlock = (src: string, selector: string) => {
  const re = new RegExp(`(^|\\n)\\s*${esc(selector)}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'g');
  let m: RegExpExecArray | null;
  let body: string | null = null;
  while ((m = re.exec(src))) body = m[2];
  if (body == null) throw new Error(`블록 없음: ${selector}`);
  return body;
};
const motionSection = css.slice(css.indexOf('/* ── 움직임 공용 규칙'));

describe('0. 토큰', () => {
  test('--motion-fast 120ms · --motion-base 130ms · --motion-ease-out', () => {
    expect(css).toMatch(/:root \{\s*--motion-fast: 120ms;[^\n]*\n\s*--motion-base: 130ms;[^\n]*\n\s*--motion-ease-out: cubic-bezier\(0\.2, 0, 0, 1\);/);
    // 시범 블록 리터럴은 그대로(테스트가 고정)
    expect(css).toMatch(/\.ui-pop-in \{\s*animation: ui-pop-in 130ms/);
  });
});

describe('1·2·3. 창은 열릴 때도 닫힐 때도 즉시(2026-11-21 사용자 결정 — 등장 페이드를 넣었다가 뺌)', () => {
  test('창 열림용 키프레임·data 속성 규칙이 없다', () => {
    expect(css).not.toMatch(/@keyframes motion-(fade|rise)-in/);
    for (const attr of ['data-confirm-panel', 'data-modal-panel', 'data-modal-backdrop', 'data-float-view-item']) {
      expect(css).not.toContain(`[${attr}]`);
    }
    // 확인 창 배경막·패널에 animation 을 걸지 않는다
    expect(motionSection).not.toMatch(/\.confirm-window[^{]*\{[^}]*animation:/);
    expect(motionSection).not.toMatch(/(height|width|top|left|border-width):[^;]*\d+ms/);
  });
  test('컴포넌트에 열림용 data 속성이 없다(확인 창·일반 창·전체 화면 보기)', () => {
    expect(read('ConfirmWindow.tsx')).not.toContain('data-confirm-panel');
    expect(read('ConfirmWindow.tsx')).toContain('<div className="fixed flex justify-center w-full confirm-window">');
    expect(read('ModalOverlay.tsx')).not.toMatch(/data-modal-(panel|backdrop)/);
    expect(read('FloatView.tsx')).not.toContain('data-float-view-item');
  });
});

describe('4. 우클릭 메뉴(react-contexify)', () => {
  test('들어옴 --motion-base·ease-out·4px, 나감 0.1s, 하위 메뉴 0.12s — animation 은 남김(animationend)', () => {
    expect(contexify).toContain('animation: contexify_fadeIn var(--motion-base, 130ms) var(--motion-ease-out, ease-out);');
    expect(contexify).toContain('animation: contexify_fadeOut 0.1s ease;');
    expect(contexify).toMatch(/@keyframes contexify_fadeIn \{\s*0% \{\s*opacity: 0;\s*transform: translateY\(4px\);/);
    expect(contexify).not.toContain('translateY(10px)');
    expect(contexify).toMatch(/\.contexify \.contexify_submenu \{[^}]*transition: opacity 0\.12s;/);
    expect(contexify).not.toContain('transition: opacity 0.265s');
  });
});

describe('5. 토스트', () => {
  test('등장 0.15s·8px + 끝나기 0.2초 전부터 사라짐 페이드(지연은 --toast-duration 에서)', () => {
    expect(css).toMatch(/@keyframes toast-rise \{\s*from \{\s*opacity: 0;\s*transform: translateY\(8px\);/);
    expect(css).toMatch(/@keyframes toast-out \{\s*from \{\s*opacity: 1;\s*\}\s*to \{\s*opacity: 0;/);
    expect(lastBlock(css, '.toast-rise')).toMatch(
      /animation:\s*toast-rise 0\.15s var\(--motion-ease-out\),\s*toast-out 0\.2s ease-in calc\(var\(--toast-duration, 5000ms\) - 200ms\) forwards;/,
    );
  });
  test('상수와 CSS 변수가 짝(상수 → --toast-duration), 수동 닫기는 즉시(removeMessage 그대로)', () => {
    const src = read('AlertWindow.tsx');
    expect(src).toContain('const TOAST_DURATION = 5000;');
    expect(src).toContain("const TOAST_STYLE = { '--toast-duration': `${TOAST_DURATION}ms` } as CSSProperties;");
    expect(src).toMatch(/className="toast-rise [^"]*"\s*style=\{TOAST_STYLE\}/);
    expect(src).toContain('onClick={() => appState.removeMessage(id)}');
    expect(src).toContain('setTimeout(() => appState.removeMessage(id), TOAST_DURATION)');
    // CSS 대체값이 상수와 같다
    expect(css).toContain('var(--toast-duration, 5000ms)');
  });
});

describe('6. 공용 버튼·칸 hover 전환, 누름은 즉시', () => {
  test('.round-button·.icon-button: filter·background-color --motion-fast(+ 종전 box-shadow 150ms)', () => {
    expect(css).toContain(
      'transition: filter var(--motion-fast) ease, background-color var(--motion-fast) ease, box-shadow 150ms ease;',
    );
    expect(css).toMatch(
      /\.icon-button \{\s*@apply active:brightness-90 hover:brightness-95 select-none whitespace-nowrap p-1;\s*border-radius: var\(--r-btn\);\s*transition: filter var\(--motion-fast\) ease, background-color var\(--motion-fast\) ease;/,
    );
  });
  test('그룹 2 공용 칸·줄: 색·바탕 전환(@layer components — 사용처 유틸이 이김), .clickable 은 제외', () => {
    const m = /@layer components \{\s*\.seg-group > \.seg-item,\s*\.tab-line > \.tab-line-item,\s*\.add-slot,\s*\.list-row-selected,\s*\.hover-row \{([^}]*)\}/.exec(
      motionSection,
    );
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/transition-property: color, background-color;\s*transition-duration: var\(--motion-fast\);/);
    // 규칙 선택자 줄(주석 제외)에 .clickable 이 없다
    expect(motionSection.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('.clickable');
    expect(css).toMatch(/\.clickable \{\s*@apply active:brightness-75 hover:brightness-90 cursor-pointer select-none;\s*\}/);
  });
  test(':active 는 transition 0ms, 공용 버튼에 누름 축소(scale) 없음', () => {
    const m = /\.round-button:active,\s*\.icon-button:active,\s*\.seg-group > \.seg-item:active,\s*\.tab-line > \.tab-line-item:active,\s*\.add-slot:active,\s*\.hover-row:active \{([^}]*)\}/.exec(
      motionSection,
    );
    expect(m).not.toBeNull();
    expect(m![1].trim()).toBe('transition-duration: 0ms;');
    expect(css).not.toMatch(/\.round-button:active[^{]*\{[^}]*scale/);
    expect(css).not.toMatch(/\.icon-button:active[^{]*\{[^}]*scale/);
  });
});

describe('7. 그리드 이미지 페이드', () => {
  test('이징은 animation-timing-function, 0.15s, 모바일 끔 그대로', () => {
    const b = /\n\.image-anime \{([^}]*)\}/.exec(css)![1];
    expect(b).toContain('animation-timing-function: cubic-bezier(0.645, 0.045, 0.355, 1);');
    expect(b).toContain('animation-duration: 0.15s;');
    expect(b).not.toContain('transition-timing-function');
    expect(css).toMatch(/@media \(hover: none\) and \(pointer: coarse\) \{\s*\.image-anime \{\s*animation: none;/);
  });
});

describe('8. 움직임 줄이기 — 한 곳', () => {
  const tail = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  test('파일 맨 끝, 1ms(none 아님)·반복 1·scroll auto, 예외 = 진행 막대·스피너', () => {
    expect(tail).toMatch(
      /^@media \(prefers-reduced-motion: reduce\) \{\s*\*:not\(\.progress-clip-animation\):not\(\.animate-spin\),\s*\*::before,\s*\*::after \{\s*animation-duration: 1ms !important;\s*animation-iteration-count: 1 !important;\s*transition-duration: 1ms !important;\s*scroll-behavior: auto !important;\s*\}\s*\}\s*$/,
    );
    expect(tail).not.toContain('animation: none');
    expect(tail).not.toContain('transition: none');
  });
  test('시범·V2 블록의 기존 줄이기 규칙은 남아 있음', () => {
    expect(css.match(/@media \(prefers-reduced-motion: reduce\)/g)!.length).toBeGreaterThanOrEqual(3);
    const pilot = css.slice(css.indexOf('@keyframes ui-pop-in'));
    expect(pilot.slice(pilot.indexOf('@media (prefers-reduced-motion: reduce)'))).toMatch(/^@media \(prefers-reduced-motion: reduce\) \{\s*\.ui-pop-in \{/);
    expect(css).toContain('.v2-swipe-glow, .v2-swipe-track, .v2-swipe-flow i { animation: none !important; }');
  });
  test('무한 흔들림은 iteration 1 로 멈춤(.toolbar-wiggle 은 예외 선택자가 아님)', () => {
    expect(css).toContain('animation: toolbar-wiggle 0.22s ease-in-out infinite;');
    expect(tail).not.toContain('toolbar-wiggle');
  });
});

describe('9. 되돌리기 바 — 칠하기 전용 transitionend 는 재측정하지 않음', () => {
  test('가드 함수와 연결', () => {
    const src = read('UndoRedoBar.tsx');
    expect(src).toContain(
      'const PAINT_ONLY_TRANSITION =\n  /^(filter|color|background-color|box-shadow|opacity|outline-color|border-(top|right|bottom|left)-color|border-color)$/;',
    );
    expect(src).toContain('if (isPaintOnlyTransition((e as TransitionEvent).propertyName)) return;');
    expect(src).toContain("document.addEventListener('transitionend', onTransitionEnd, true);");
    expect(src).toContain("document.removeEventListener('transitionend', onTransitionEnd, true);");
    expect(src).not.toContain("addEventListener('transitionend', schedule");
  });
  test('판정: 칠하기 속성만 무시, 자리·크기 속성과 이름 없는 이벤트는 재측정', () => {
    // 모듈을 불러오면 AppService 등이 딸려 오므로, 소스의 정규식을 그대로 꺼내 판정한다
    const src = read('UndoRedoBar.tsx');
    const lit = /const PAINT_ONLY_TRANSITION =\n\s*\/(.+)\/;/.exec(src)![1];
    const re = new RegExp(lit);
    for (const p of ['filter', 'color', 'background-color', 'box-shadow', 'opacity', 'outline-color', 'border-top-color']) {
      expect([p, re.test(p)]).toEqual([p, true]);
    }
    for (const p of ['transform', 'height', 'width', 'top', 'left', 'translate', 'border-top-width', 'visibility']) {
      expect([p, re.test(p)]).toEqual([p, false]);
    }
    expect(src).toContain('return !!propertyName && PAINT_ONLY_TRANSITION.test(propertyName);');
  });
});
