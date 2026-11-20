// UI 정돈 그룹 1-b(2026-11-20): 도움말 패널 공용화. 공용 부품 HelpPanelButton 의 열기·닫기(버튼·바깥·닫기 관문),
// 칩 없는 줄·여러 칩·묶음 제목 없는 패널·폭 지정, 긴 툴팁 5곳의 문구 데이터와 화면 라벨 대조, 연결(소스 검사).
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';

const backLayers: { close: () => void; removed: boolean }[] = [];
jest.mock('../BackStackService', () => ({
  backStackService: {
    push: (close: () => void) => {
      const entry = { close, removed: false };
      backLayers.push(entry);
      return { remove: () => (entry.removed = true) };
    },
  },
}));

import { HelpPanelButton } from '../../componenets/HelpPanel';
import { HelpPanelData, helpChipsOf, helpPanelButtonLabel, placeAnchoredPanel } from '../helpPanel';
import { placeAnchoredPanel as placeFromSyntax } from '../promptSyntaxHelp';
import {
  CHARACTER_PRESET_HELP,
  FIND_REPLACE_HELP,
  FOLDER_TEMPLATE_HELP,
  TEMPLATE_BADGE_HELP,
  TEMPLATE_MANAGER_HELP,
} from '../helpPanelTexts';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  backLayers.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = (el: React.ReactElement) => act(async () => root.render(el));
const panel = () => document.body.querySelector<HTMLElement>('[data-help-panel]');
const button = () => container.querySelector<HTMLButtonElement>('button')!;
const press = (el: EventTarget, type = 'mousedown') =>
  act(async () => {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  });

const SAMPLE: HelpPanelData = {
  title: '시험 도움말',
  groups: [
    {
      id: 'g1',
      title: '첫 묶음',
      rows: [
        { id: 'one', example: '칩 하나', desc: '칩 한 개 줄' },
        { id: 'two', example: ['왼쪽', { kind: 'label', text: '오른쪽' }], desc: '칩 두 개 줄' },
        { id: 'text', desc: '칩 없는 줄' },
      ],
    },
  ],
};

describe('공용 모양·위치', () => {
  test('예시 펴기: 없음 → 빈 목록, 글자 → 이름 칩, 배열 → 여러 칩', () => {
    expect(helpChipsOf(undefined)).toEqual([]);
    expect(helpChipsOf('공백 검색')).toEqual([{ kind: 'label', text: '공백 검색' }]);
    expect(helpChipsOf(['a', { kind: 'keys', keys: ['Ctrl'] }])).toEqual([
      { kind: 'label', text: 'a' },
      { kind: 'keys', keys: ['Ctrl'] },
    ]);
  });
  test('위치 계산은 공용 모듈 하나 — 문법 파일의 예전 경로는 같은 함수', () => {
    expect(placeFromSyntax).toBe(placeAnchoredPanel);
  });
  test('접근성 이름 기본값 = 「대상 도움말」', () => {
    expect(helpPanelButtonLabel('찾기 및 변환')).toBe('찾기 및 변환 도움말');
  });
});

describe('공용 부품 열고 닫기', () => {
  test('누르면 열리고 다시 누르면 닫힌다 — aria-label·aria-expanded·aria-controls·닫기 관문 한 겹', async () => {
    await render(<HelpPanelButton data={SAMPLE} />);
    expect(button().getAttribute('aria-label')).toBe('시험 도움말 도움말');
    expect(button().getAttribute('type')).toBe('button');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();
    await act(async () => button().click());
    const p = panel()!;
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(button().getAttribute('aria-controls')).toBe(p.id);
    expect(p.getAttribute('role')).toBe('dialog');
    expect(p.className).toContain('help-panel');
    expect(p.className).toContain('ui-pop-in');
    expect(p.querySelector('h3')!.textContent).toBe('시험 도움말');
    expect(backLayers).toHaveLength(1);
    await act(async () => button().click());
    expect(panel()).toBeNull();
    expect(backLayers[0].removed).toBe(true);
  });
  test('바깥 누름(마우스·터치)이면 닫히고, 패널 안 누름은 그대로', async () => {
    await render(<HelpPanelButton data={SAMPLE} />);
    await act(async () => button().click());
    await press(panel()!.querySelector('h3')!);
    expect(panel()).not.toBeNull();
    await press(document.body, 'touchstart');
    expect(panel()).toBeNull();
    await act(async () => button().click());
    await press(document.body);
    expect(panel()).toBeNull();
  });
  test('Esc·뒤로 가기(닫기 관문 맨 위 겹)로 닫힌다', async () => {
    await render(<HelpPanelButton data={SAMPLE} />);
    await act(async () => button().click());
    await act(async () => backLayers[backLayers.length - 1].close());
    expect(panel()).toBeNull();
    expect(backLayers[backLayers.length - 1].removed).toBe(true);
  });
  test('칩 없는 줄은 전체 폭, 여러 칩은 한 칸에 나란히, 묶음 제목 줄', async () => {
    await render(<HelpPanelButton data={SAMPLE} width={320} exampleWidth={90} marker="sample-panel" />);
    await act(async () => button().click());
    const p = panel()!;
    expect(p.hasAttribute('data-sample-panel')).toBe(true);
    expect(p.style.width).toBe('320px');
    expect(p.style.getPropertyValue('--help-panel-example-w')).toBe('90px');
    expect(p.querySelector('.help-panel-caption')!.textContent).toBe('첫 묶음');
    const row = (id: string) => p.querySelector<HTMLElement>(`[data-help-row="${id}"]`)!;
    expect(row('one').querySelectorAll('.help-panel-chip')).toHaveLength(1);
    const two = row('two').querySelectorAll('.help-panel-examples .help-panel-chip');
    expect(Array.from(two).map((c) => c.textContent)).toEqual(['왼쪽', '오른쪽']);
    expect(row('text').className).toContain('help-panel-row-full');
    expect(row('text').querySelector('.help-panel-chip')).toBeNull();
    expect(row('text').textContent).toBe('칩 없는 줄');
  });
  test('묶음 하나에 제목이 없으면 묶음 제목 줄 없이 줄만', async () => {
    await render(<HelpPanelButton data={CHARACTER_PRESET_HELP} />);
    await act(async () => button().click());
    const p = panel()!;
    expect(p.querySelector('.help-panel-caption')).toBeNull();
    expect(p.querySelectorAll('[data-help-row]')).toHaveLength(3);
    expect(p.querySelectorAll('.help-panel-chip')).toHaveLength(0);
  });
});

// 묶음 제목 · 줄별 [칩들] · 설명
const shape = (d: HelpPanelData) =>
  d.groups.map((g) => ({
    title: g.title,
    rows: g.rows.map((r) => [helpChipsOf(r.example).map((c) => (c.kind === 'label' ? c.text : c.kind)), r.desc]),
  }));

describe('5곳 문구 데이터', () => {
  test('찾기 및 변환 — 사용자가 목업에서 승인한 문구 그대로', () => {
    expect(FIND_REPLACE_HELP.title).toBe('찾기 및 변환');
    expect(shape(FIND_REPLACE_HELP)).toEqual([
      { title: '기본', rows: [[['선택한 씬'], '선택한 씬의 글자를 찾아 한꺼번에 바꿉니다.']] },
      {
        title: '씬 선택과 무관한 범위',
        rows: [[['캐릭터 프리셋', '글로벌 프리셋'], '씬을 고르지 않아도 검색됩니다. 범위를 끄면 빠집니다.']],
      },
      {
        title: '이름을 바꾸는 범위',
        rows: [[['씬 이름', '프로젝트 이름'], '변환하면 실제 이름이 바뀝니다. 같은 이름이 이미 있으면 건너뜁니다.']],
      },
      { title: '옵션', rows: [[['공백 검색'], '검색어의 공백을 그대로 씁니다. 공백만 찾아 다른 글자로 바꿀 수 있습니다.']] },
    ]);
  });
  test('찾기 및 변환 — 범위·옵션 칩이 화면 라벨과 글자까지 같다', () => {
    const src = read('FindReplaceDialog.tsx');
    for (const [scope, label] of [
      ['preset', '캐릭터 프리셋'],
      ['global', '글로벌 프리셋'],
      ['sceneNames', '씬 이름'],
      ['projectName', '프로젝트 이름'],
    ]) {
      expect(src).toContain(`['${scope}', '${label}']`);
    }
    expect(src).toContain('<span className="text-sm text-gray-700 dark:text-gray-300">공백 검색</span>');
  });
  test('템플릿 관리 — 무엇인가 / 복사해 오기 / 저장되는 때(두 갈래)', () => {
    expect(TEMPLATE_MANAGER_HELP.title).toBe('템플릿 관리');
    expect(shape(TEMPLATE_MANAGER_HELP)).toEqual([
      {
        title: '무엇인가',
        rows: [
          [[], '새 프로젝트를 만들 때 시작 구성(프리셋, 캐릭터, 바이브, 레퍼런스, 씬)을 미리 세팅하는 워크플로우입니다.'],
          [[], '모든 영역은 직접 편집할 수 있습니다.'],
        ],
      },
      { title: '복사해 오기', rows: [[['복사해 오기'], '설정을 한 번 덮어쓰는 편의 기능입니다.']] },
      {
        title: '저장되는 때',
        rows: [
          [['프롬프트 수정'], '바닥의 [저장] 버튼을 누르거나 창을 닫을 때 저장됩니다.'],
          [['그 밖의 변경'], '복사해 오기, 캐릭터, 씬 변경은 바로 저장됩니다.'],
        ],
      },
    ]);
    // 칩·설명에 나온 버튼 이름이 화면에 실제로 있다
    const src = read('TemplateManagerModal.tsx');
    expect(src).toMatch(/>\s*복사해 오기\s*</);
    expect(src).toMatch(/>\s*저장\s*</);
  });
  test('캐릭터 프리셋·폴더 기본 템플릿 — 묶음 하나, 칩 없는 줄', () => {
    expect(shape(CHARACTER_PRESET_HELP)).toEqual([
      {
        title: undefined,
        rows: [
          [[], '캐릭터 프리셋은 캐릭터 프롬프트, 네거티브, 바이브, 레퍼런스의 묶음입니다.'],
          [[], '카드 버튼으로 현재 프로젝트에 적용하거나 해제합니다. 여러 개를 한꺼번에 적용할 수 있습니다.'],
          [[], '글로벌 프리셋은 모든 프로젝트에서 공유되며, 적용하면 현재 프로젝트로 사본이 들어갑니다.'],
        ],
      },
    ]);
    expect(FOLDER_TEMPLATE_HELP.title).toBe('폴더 기본 템플릿');
    expect(shape(FOLDER_TEMPLATE_HELP)).toEqual([
      {
        title: undefined,
        rows: [
          [[], '이 폴더(하위 폴더 포함)에서 새 프로젝트를 만들 때 아래 구성이 자동 적용됩니다.'],
          [[], '전역 템플릿을 복사해 온 뒤 이 폴더 전용으로 세부 조정할 수 있습니다. 전역 원본에는 영향이 없습니다.'],
          [[], '아무것도 세팅하지 않고 닫으면 지정이 해제됩니다.'],
        ],
      },
    ]);
  });
  test('배지 색 — 기호 칩 + 뜻', () => {
    expect(shape(TEMPLATE_BADGE_HELP)).toEqual([
      {
        title: undefined,
        rows: [
          [['♚'], '이 폴더의 기본 템플릿(부모)'],
          [['♟'], '그 템플릿을 상속받은 프로젝트'],
          [[], '배지 색으로 어느 부모의 자식인지 구분합니다.'],
        ],
      },
    ]);
  });
});

describe('연결(소스 검사)', () => {
  test('5곳이 공용 패널을 쓰고 종전 툴팁 문자열은 남지 않았다', () => {
    const find = read('FindReplaceDialog.tsx');
    expect(find).toContain('<HelpPanelButton data={FIND_REPLACE_HELP}');
    // 창 전체 도움말이라 제목 옆(「공백 검색」 줄이 아님 — 2026-11-20 실기 지적)
    expect(find).toMatch(/const FIND_TITLE = \([\s\S]{0,200}찾기 및 변환\s*<HelpPanelButton data=\{FIND_REPLACE_HELP\}/);
    expect(find).toContain('title={FIND_TITLE}');
    expect(find).not.toMatch(/공백 검색<\/span>\s*<\/label>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<HelpPanelButton/);
    expect(find).not.toMatch(/const FIND_HELP\b/);
    expect(find).not.toContain('HelpIcon');
    const tm = read('TemplateManagerModal.tsx');
    expect(tm).toContain('<HelpPanelButton data={TEMPLATE_MANAGER_HELP}');
    expect(tm).not.toContain('그 외 변경(복사해 오기·캐릭터·씬)은 즉시 저장됩니다');
    const cp = read('CharacterPresetEditor.tsx');
    expect(cp).toContain('<HelpPanelButton data={CHARACTER_PRESET_HELP}');
    expect(cp).not.toContain('HelpIcon');
    const ti = read('TemplateInheritModals.tsx');
    expect(ti).toContain('<HelpPanelButton data={FOLDER_TEMPLATE_HELP}');
    expect(ti).toContain('<HelpPanelButton data={TEMPLATE_BADGE_HELP}');
    expect(ti).not.toContain('HelpIcon');
  });
  test('「그대로」로 둔 짧은 툴팁은 HelpIcon 유지(템플릿 계열 설명)', () => {
    expect(read('TemplateManagerModal.tsx')).toContain('<HelpIcon content={TEMPLATE_SAMPLING_TEXT.familyHelp} size={13} />');
  });
  test('CSS 는 공용 이름 하나 — 예전 prompt-syntax-* 규칙이 남지 않았다', () => {
    const css = read('App.css');
    expect(css).not.toMatch(/\.prompt-syntax-/);
    for (const sel of ['.help-panel {', '.help-panel-row-full {', '.help-panel-chip {', '.help-panel-kbd {']) {
      expect(css.split(sel).length).toBe(2);
    }
    expect(css).toContain('grid-template-columns: var(--help-panel-example-w, 150px) minmax(0, 1fr);');
  });
});
