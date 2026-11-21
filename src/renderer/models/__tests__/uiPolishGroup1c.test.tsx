// UI 정돈 그룹 1-c(2026-11-20) — 환경설정 밖의 편집 창·대화상자에 시범 부품 확대.
// ① 남은 기본 모양 전수 검사(소스): componenets/*.tsx 의 모든 체크 상자 = .setting-check(-sm)·.setting-switch,
//    모든 <select> = .app-select(허용 목록 = 쓰이지 않는 NumberSelect 하나) — 기본 모양이 다시 들어오면 여기서 잡힌다.
// ② 스위치 하나(SettingSwitch — 줄 구조를 그대로 둔 자리용): role="switch"·엔터 키·비활성(렌더)
// ③ CSS(작은 체크·optgroup·높이 고정 선택 칸) ④ 자리별 배치(사전 세팅·조각·템플릿 샘플링 묶음) ⑤ 기호 글자 → 아이콘.
import React, { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';
import { FaRedo, FaSync, FaUndo } from 'react-icons/fa';
import { SettingSwitch } from '../../componenets/SettingControls';
import { ICON_DICTIONARY } from '../iconDictionary';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');
// 주석(줄 주석으로 시작하는 줄·블록 주석)을 지운 소스 — 설명 글 속 「<select>」 같은 낱말을 세지 않게
const code = (f: string) =>
  read(f)
    // JSX 주석 {/* … */} 과 줄 첫머리에서 시작하는 블록 주석만(문자열 속 "image/*" 같은 것은 건드리지 않게)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
const tsxFiles = fs.readdirSync(COMP).filter((f) => f.endsWith('.tsx'));

// 여는 태그 하나(<input … /> 또는 <select … >) — 중괄호 안의 > (화살표 함수 등)는 건너뛴다
const openingTag = (src: string, start: number) => {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
};
const tagsOf = (src: string, name: string) => {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(openingTag(src, m.index));
  return out;
};

describe('① 남은 기본 모양 전수 검사', () => {
  test('체크 상자는 모두 .setting-check(작은 변형 포함) 또는 .setting-switch', () => {
    const bad: string[] = [];
    let total = 0;
    for (const f of tsxFiles) {
      for (const tag of tagsOf(code(f), 'input')) {
        if (!/type="checkbox"/.test(tag)) continue;
        total++;
        if (!/setting-check|setting-switch/.test(tag)) bad.push(`${f}: ${tag.slice(0, 120)}`);
      }
    }
    expect(bad).toEqual([]);
    expect(total).toBeGreaterThan(25); // 검사가 실제로 체크 상자를 찾고 있는지
  });

  test('<select> 는 모두 .app-select — 예외는 쓰이지 않는 NumberSelect 하나(명시 허용 목록)', () => {
    const ALLOW: Record<string, number> = { 'UtilComponents.tsx': 1 };
    const bad: string[] = [];
    let total = 0;
    // className={selectCls …} 처럼 상수로 줄 때는 같은 파일의 상수 값에 app-select 가 있는지 본다
    const hasAppSelect = (src: string, tag: string) => {
      if (/app-select/.test(tag)) return true;
      const id = /className=\{\s*(\w+)/.exec(tag)?.[1];
      return !!id && new RegExp(`const ${id}\\s*=\\s*'[^']*\\bapp-select\\b`).test(src);
    };
    for (const f of tsxFiles) {
      const src = code(f);
      const plain = tagsOf(src, 'select').filter((t) => !hasAppSelect(src, t));
      total += tagsOf(src, 'select').length;
      if (plain.length !== (ALLOW[f] ?? 0)) bad.push(`${f}: 기본 모양 ${plain.length}개`);
    }
    expect(bad).toEqual([]);
    expect(total).toBeGreaterThan(15);
    // 허용 목록의 근거 — NumberSelect 는 정의만 있고 그리는 곳이 없다
    expect(code('UtilComponents.tsx')).toMatch(/export const NumberSelect/);
    const users = tsxFiles.filter((f) => code(f).includes('<NumberSelect'));
    expect(users).toEqual([]);
  });

  test('.gray-input 과 .app-select 를 한 선택 칸에 같이 붙이지 않는다', () => {
    for (const f of tsxFiles) {
      for (const tag of tagsOf(code(f), 'select')) {
        expect({ f, both: /gray-input/.test(tag) && /app-select/.test(tag) }).toEqual({ f, both: false });
      }
    }
  });
});

describe('② 스위치 하나(SettingSwitch)', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const Harness = ({ disabled, spy }: { disabled?: boolean; spy: (v: boolean) => void }) => {
    const [on, setOn] = useState(false);
    return (
      <SettingSwitch
        id="g1cSwitch"
        ariaLabel="시험 스위치"
        checked={on}
        disabled={disabled}
        onChange={(v) => {
          spy(v);
          setOn(v);
        }}
      />
    );
  };

  test('role="switch"·.setting-switch·aria-checked, 누름과 엔터 키로 바뀜', async () => {
    const spy = jest.fn();
    await act(async () => root.render(<Harness spy={spy} />));
    const input = container.querySelector<HTMLInputElement>('#g1cSwitch')!;
    expect(input.type).toBe('checkbox');
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.className).toBe('setting-switch');
    expect(input.getAttribute('aria-label')).toBe('시험 스위치');
    expect(input.getAttribute('aria-checked')).toBe('false');
    await act(async () => input.click());
    expect(spy).toHaveBeenLastCalledWith(true);
    expect(input.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(spy).toHaveBeenLastCalledWith(false);
    expect(input.checked).toBe(false);
  });

  test('비활성이면 엔터 키도 무시', async () => {
    const spy = jest.fn();
    await act(async () => root.render(<Harness spy={spy} disabled />));
    const input = container.querySelector<HTMLInputElement>('#g1cSwitch')!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('③ CSS', () => {
  const css = read('App.css');
  test('작은 체크 상자(.setting-check-sm) = 15px, .setting-check 뒤에 있고 토큰 색은 그대로', () => {
    const base = css.indexOf('.setting-check {');
    const sm = css.indexOf('.setting-check.setting-check-sm {');
    expect(base).toBeGreaterThan(0);
    expect(sm).toBeGreaterThan(base);
    const block = css.slice(sm, css.indexOf('}', sm));
    expect(block).toMatch(/width: 15px;/);
    expect(block).toMatch(/height: 15px;/);
    expect(block).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
    expect(css).toMatch(/\.setting-check\.setting-check-sm::after \{[\s\S]*?border-width: 0 2px 2px 0;/);
  });
  test('optgroup 머리 글자·고를 수 없는 항목·높이 고정 선택 칸', () => {
    expect(css).toMatch(/\.app-select option,\s*\.app-select optgroup \{\s*background-color: var\(--c-surface-2\);\s*color: var\(--c-text\);/);
    expect(css).toMatch(/\.app-select option:disabled \{\s*color: var\(--c-text-faint\);/);
    expect(css).toMatch(/\.app-select\.app-select-tight \{\s*padding-top: 0;\s*padding-bottom: 0;/);
  });
});

describe('④ 자리별 배치', () => {
  test('사전 세팅: 모델 설정 묶음 + 즉시 저장 켬/끔 = 스위치(묶음 안 = 스위치 줄, 줄 구조 자리 = 스위치만)', () => {
    const src = read('PreSetEdtior.tsx');
    expect(src).toContain('<SettingGroup title="모델 설정 (전역)" className="mt-4">');
    expect(src).toMatch(/<SettingSwitchRow\s+id="globalFurryMode"/);
    expect(src).toMatch(/<SettingSwitchRow\s+id="globalAddQuality"/);
    // 투명 배경·워크플로 bool = field-row(PC 32px 줄) 그대로, 스위치는 줄 오른쪽 끝
    const tb = src.slice(src.indexOf('const TransparentBackgroundMainRow'));
    expect(tb).toMatch(/<div className="field-row pt-2 md:pt-3 flex gap-2 items-center">[\s\S]*?<HelpIcon content=\{TRANSPARENT_BACKGROUND_HELP\} \/>\s*<span className="ml-auto flex">\s*<SettingSwitch\s+id="mainTransparentBackground"/);
    expect(src).toMatch(/case 'bool':[\s\S]*?<InlineEditorField label=\{input\.label\}>\s*<span className="ml-auto flex">\s*<SettingSwitch/);
    expect(src).toMatch(/<label htmlFor="useCoords"[^>]*>캐릭터 위치 지정 모드<\/label>\s*<span className="ml-auto flex">\s*<SettingSwitch\s+id="useCoords"/);
  });
  test('조각 「랜덤 줄 선택 모드」 = 제자리 스위치(라벨: [켬/끔] (?) 한 줄 유지)', () => {
    expect(read('PieceEditor.tsx')).toMatch(/랜덤 줄 선택 모드:\{' '\}[\s\S]*?<SettingSwitch\s+checked=\{!!piece\.multi\}[\s\S]*?<HelpIcon content="켜면 생성할 때마다/);
  });
  test('템플릿 「샘플링」 = 묶음 상자, 머리 표식 유지·선택 칸 app-select(잠금 흐림 겹침 없음)', () => {
    const src = read('TemplateManagerModal.tsx');
    expect(src).toContain('<SettingGroup title="샘플링">');
    const g = src.slice(src.indexOf('<SettingGroup title="샘플링">'), src.indexOf('</SettingGroup>'));
    expect(g).toContain('data-template-sampling-head=');
    expect(g).toContain('data-template-sampling-family=');
    expect(g).toContain('data-template-v5m-notice=""');
    expect(g).not.toContain('<span className="text-xs font-medium text-muted">샘플링</span>');
    expect(src).toContain("const selectCls = 'mt-1 w-full app-select';");
    expect(src).toContain("const selectLockedCls = ' cursor-not-allowed';");
  });
  test('체크 줄 교체 3곳(새 id) · 내보내기 설정은 줄 구조 그대로 모양만', () => {
    expect(read('CharacterPresetEditor.tsx')).toMatch(/<SettingCheckRow\s+id="cyclingProjectFileMode"/);
    expect(read('ExportPresetManager.tsx')).toMatch(/<SettingCheckRow\s+id="exportPresetIsDefault"/);
    expect(read('BatchCreateModal.tsx')).toMatch(/<SettingCheckRow\s+id="batchSubfolderByChar"/);
    const ex = read('ExportSettingsFields.tsx');
    expect(ex.match(/className="setting-check"/g)).toHaveLength(4);
    expect(ex.match(/<label className="flex items-center gap-2 cursor-pointer select-none">/g)!.length).toBeGreaterThanOrEqual(3);
  });
  test('목록 검색줄 정렬 칸(공용 부품) = app-select, 높이(h-7/h-8)는 그대로', () => {
    const src = read('ListSearchBar.tsx');
    expect(src).toContain("const h = compact ? 'h-7 text-xs' : 'h-8 text-sm';");
    expect(src).toContain('className={`app-select app-select-tight ${h} flex-none`}');
  });
});

describe('⑤ 기호 글자 → 아이콘', () => {
  test('사전 새 키 reset-default·refresh 는 되돌리기·다시 실행·순환 생성과 다른 모양', () => {
    const d = ICON_DICTIONARY as Record<string, unknown>;
    for (const k of ['reset-default', 'refresh']) {
      expect(d[k]).toBeDefined();
      expect([FaUndo, FaRedo, FaSync]).not.toContain(d[k]);
    }
    expect(d['reset-default']).not.toBe(d.refresh);
  });
  test('기호 글자가 남지 않는다', () => {
    expect(code('ConfigKeyBindingsTab.tsx')).not.toContain('↺');
    expect(read('ConfigKeyBindingsTab.tsx')).toContain('<ActionIcon id="reset-default"');
    expect(read('ConfigKeyBindingsTab.tsx')).toContain('className="setting-icon-btn ui-press"');
    expect(code('StorageManageModal.tsx')).not.toContain('↻');
    expect(code('ArtistLibraryTab.tsx')).not.toMatch(/>×</);
    expect(code('ArtistLibraryTab.tsx')).toContain('<FaTimes size={10}');
    const inner = code('CharacterPresetInnerEditor.tsx');
    expect(inner).not.toMatch(/[▼▶▲]/);
    expect(inner).toMatch(/aria-expanded=\{showFilenameOptions\}/);
    expect(inner).toMatch(/aria-expanded=\{showRepImagePicker\}/);
    const ref = code('CharacterReferenceEditor.tsx');
    expect(ref).not.toMatch(/[▾▸]/);
    expect(ref).toMatch(/aria-expanded=\{showDefaults\}/);
  });
});
