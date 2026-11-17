// M5 묶음 b(2026-11-16, 플랜 guides/plans/2026-11-16-m5-flow-dedup.md):
//  P8  폴더 일괄 이미지 내보내기 「직접 설정」 = DirectExportDialog 폼 한 창(scope 'folder') — 안내 한 줄,
//      2026-11-16 묶음 b-2 부터 숨김 칸 없음(모든 칸을 프로젝트와 같은 규칙으로 씀 — folderImageExport.test.ts),
//      폼 결과 → 실행 옵션은 프로젝트와 같은 exportRunOptionsFromPreset
//  R1  파일 내보내기·불러오기 명칭 — 목록 전부를 한 파일로 = 「백업」/「백업 불러오기」, 한 건·선택분 = 「내보내기」/「불러오기」
//  R1-b 로컬 캐릭터 프리셋 파일 불러오기 = 공용 정책 흐름(새 이름·건너뛰기·덮어쓰기, 겹침 없으면 묻지 않음)
import fs from 'fs';
import path from 'path';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

const state: any = { directExportRequest: undefined };
const dialogState = {
  pushDialogAsync: jest.fn(),
  confirmAsync: jest.fn(),
  pushDialog: jest.fn(),
  pushMessage: jest.fn(),
};
const writeDataFile = jest.fn(async (_p: string, _d: string) => {});
const sessionPresets = new Map<string, any>();
jest.mock('..', () => ({
  isMobile: false,
  backend: { selectDir: async () => '/chosen', writeDataFile: (p: string, d: string) => writeDataFile(p, d) },
  imageService: { getVibesDir: () => 'p/vibes', getReferenceDir: () => 'p/references' },
  globalCharacterPresetService: {},
}));
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../appStateRef', () => ({ getAppState: () => dialogState }));
jest.mock('../types', () => ({ CharacterPreset: { fromJSON: (j: any) => ({ ...j }) } }));
jest.mock('../platform', () => ({ buildImageOptimizeOptions: () => [{ text: '원본', value: 'original' }, { text: 'WebP', value: 'lossy' }, { text: '무손실', value: 'lossless' }, { text: 'AVIF', value: 'avif' }] }));
jest.mock('../../componenets/ModalOverlay', () => ({ children, toolbar, aside, footer, footerStart }: any) => <div>{toolbar}{aside}{children}{footerStart}{footer}</div>);
jest.mock('../../componenets/UtilComponents', () => ({ DropdownSelect: ({ selectedOption, options, onSelect }: any) => <select value={selectedOption} onChange={(e) => onSelect({ value: e.target.value })}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));

import DirectExportDialog from '../../componenets/DirectExportDialog';
import {
  emptyExportForm,
  exportFormToPreset,
  exportRunOptionsFromPreset,
  FOLDER_EXPORT_FIXED_NOTE,
  FOLDER_EXPORT_UNUSED_FIELDS,
  isExportFieldShown,
} from '../exportSettings';
import {
  applyLocalCharacterPresetImport,
  countLocalCharacterPresetConflicts,
} from '../localCharacterPresetImport';
import { importLocalCharacterPresetsText } from '../characterPresetImport';
import { IMPORT_FLOW_TEXT } from '../importFlow';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ─────────────────────────── P8 ───────────────────────────
describe('P8 폴더 일괄 「직접 설정」 = 직접 내보내기 폼(scope folder)', () => {
  let root: Root;
  let container: HTMLDivElement;
  let resolve: jest.Mock;
  beforeEach(() => {
    (global as any).IS_REACT_ACT_ENVIRONMENT = true;
    resolve = jest.fn();
    state.pushMessage = jest.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const click = (text: string) =>
    (Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement).click();
  const selectWith = (value: string) =>
    Array.from(container.querySelectorAll('select')).find((s) => s.querySelector(`option[value="${value}"]`));

  test('폴더 범위: 숨김 칸 없이 프로젝트와 같은 칸 + 안내 한 줄, 머리에 폴더·프로젝트 수', async () => {
    state.directExportRequest = { projectName: 'F', projectCount: 3, sceneNames: ['a', 'b'], scope: 'folder', resolve };
    await act(async () => root.render(<DirectExportDialog />));
    // 2026-11-17 b-3: 종류별 개수(변형 씬 이름을 안 받으면 0개)
    expect(container.textContent).toContain('폴더 "F" · 프로젝트 3개 · 생성 씬 2개 · 변형 씬 0개');
    expect(container.querySelector('[data-direct-export-folder-note]')!.textContent).toBe(FOLDER_EXPORT_FIXED_NOTE);
    // 2026-11-16 묶음 b-2: 파일명 패턴·출력 형태·접두/접미사 토글·목표 폴더도 보인다
    expect(selectWith('project.scene')).toBeDefined();
    expect(selectWith('zip')).toBeDefined();
    expect(container.textContent).toContain('캐릭터 프리셋 접두사/접미사 적용');
    expect(container.textContent).toContain('폴더 선택');
    // 최적화 lossy 면 화질·스테가노그래피·재최적화 칸도 보인다
    const opt = selectWith('avif')!;
    await act(async () => {
      opt.value = 'lossy';
      opt.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('input[placeholder="80"]')).not.toBeNull();
    expect(container.textContent).toContain('NAI 스테가노그래피 보존 (');
    expect(container.textContent).toContain('재최적화');
    expect(container.querySelector('input[placeholder="1024"]')).not.toBeNull();
    expect(selectWith('fav')).toBeDefined();
    expect(selectWith('prefix')).toBeDefined();
    expect(container.textContent).toContain('특수문자 묻지 않고 구분자로 자동 변환');
    act(() => click('내보내기'));
    expect(resolve).toHaveBeenCalledTimes(1);
    // 「대상」 기본값 = 생성 씬
    expect(resolve.mock.calls[0][0].folderTarget).toBe('scene');
  });

  test('폴더 범위 「대상」 칸(b-3): 이미지 범위 앞, 세 선택지·도움말, 고른 값이 결과로, 특수문자 감지가 대상 따라감', async () => {
    state.directExportRequest = {
      projectName: 'F', projectCount: 2, sceneNames: ['a', 'b c'], variantSceneNames: ['v#1', 'w', 'x'], scope: 'folder', resolve,
    };
    await act(async () => root.render(<DirectExportDialog />));
    expect(container.textContent).toContain('폴더 "F" · 프로젝트 2개 · 생성 씬 2개 · 변형 씬 3개');
    const target = container.querySelector('[data-export-folder-target] select') as HTMLSelectElement;
    expect(target).not.toBeNull();
    expect(Array.from(target.options).map((o) => o.value)).toEqual(['scene', 'inpaint', 'both']);
    expect(Array.from(target.options).map((o) => o.textContent)).toEqual(['생성 씬 — 기본', '변형 씬', '생성 씬 + 변형 씬']);
    expect(target.value).toBe('scene');
    expect(container.textContent).toContain('변형 씬 이미지는 프로젝트 폴더 안 「변형」 폴더에 따로 담깁니다.');
    // 첫 칸 = 대상, 그다음 이미지 범위
    const selects = Array.from(container.querySelectorAll('select'));
    expect(selects[0]).toBe(target);
    expect(selects[1].querySelector('option[value="fav"]')).not.toBeNull();
    // 생성 씬만: 띄어쓰기만 감지
    const charLabels = () => Array.from(container.querySelectorAll('fieldset label')).map((l) => l.textContent);
    expect(charLabels()).toEqual(['띄어쓰기']);
    await act(async () => {
      target.value = 'inpaint';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(charLabels()).toEqual(['#']);
    await act(async () => {
      target.value = 'both';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(charLabels()).toEqual(['띄어쓰기', '#']);
    act(() => click('내보내기'));
    expect(resolve.mock.calls[0][0].folderTarget).toBe('both');
    // 프리셋 저장 형식에는 넣지 않는다
    expect(resolve.mock.calls[0][0].preset).not.toHaveProperty('folderTarget');
  });

  test('「대상」을 바꿔 감지 목록에서 빠진 문자는 결과에 넣지 않음', async () => {
    state.directExportRequest = {
      projectName: 'F', projectCount: 1, sceneNames: ['b c'], variantSceneNames: ['v#1'], scope: 'folder', resolve,
    };
    await act(async () => root.render(<DirectExportDialog />));
    const box = container.querySelector('fieldset input[type="checkbox"]') as HTMLInputElement;
    act(() => box.click());
    const target = container.querySelector('[data-export-folder-target] select') as HTMLSelectElement;
    await act(async () => {
      target.value = 'inpaint';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => click('내보내기'));
    expect(resolve.mock.calls[0][0]).toMatchObject({ folderTarget: 'inpaint', charsToReplace: [] });
  });

  test('프로젝트 범위(종전): 숨김 없음, 안내 없음', async () => {
    state.directExportRequest = { projectName: 'P', sceneNames: ['a'], resolve };
    await act(async () => root.render(<DirectExportDialog />));
    expect(container.textContent).toContain('P · 대상 씬 1개');
    expect(container.querySelector('[data-direct-export-folder-note]')).toBeNull();
    // 「대상」 칸은 폴더 범위 전용
    expect(container.querySelector('[data-export-folder-target]')).toBeNull();
    expect(selectWith('both')).toBeUndefined();
    act(() => click('내보내기'));
    expect(resolve.mock.calls[0][0]).not.toHaveProperty('folderTarget');
    expect(selectWith('project.scene')).toBeDefined();
    expect(selectWith('zip')).toBeDefined();
    expect(container.textContent).toContain('캐릭터 프리셋 접두사/접미사 적용');
    expect(container.textContent).toContain('폴더 선택');
  });

  test('숨김 칸 목록·판정 — 묶음 b-2 부터 비어 있음(모든 칸 표시)', () => {
    expect([...FOLDER_EXPORT_UNUSED_FIELDS]).toEqual([]);
    for (const key of ['menu', 'format', 'filenamePattern', 'outputMode', 'prefix', 'applyCharacterAffix', 'opt', 'imageSize',
      'quality', 'preserveStealth', 'separator', 'autoConvertSeparator', 'targetFolder', 'reoptimize'] as const) {
      expect(isExportFieldShown(key, 'folder')).toBe(true);
      expect(isExportFieldShown(key, 'project')).toBe(true);
    }
  });

  test('폼 결과 → 실행 옵션(프로젝트·폴더 공용)', () => {
    const form = (patch: any) => exportFormToPreset({ ...emptyExportForm(), ...patch });
    // 기본 폼 = 즐겨찾기만·원본·구분자 「.」·접두 없음·tar·접두/접미사 켬·재최적화 skip
    expect(exportRunOptionsFromPreset(form({}))).toEqual({
      prefix: '', fav: true, opt: 'original', imageSize: 1024, quality: undefined, preserveStealth: false, separator: '.',
      filenamePattern: 'scene', applyCharacterAffix: true, outputMode: 'tar', reoptimize: 'skip',
    });
    expect(exportRunOptionsFromPreset(form({ menu: 'all', opt: 'lossy', imageSize: 512 }))).toMatchObject({ fav: false, opt: 'lossy', imageSize: 512 });
    // 캐릭터 이름 형식 = 「이름 + 구분자」
    expect(exportRunOptionsFromPreset(form({ format: 'prefix', prefix: '앨리스', separator: '_' })).prefix).toBe('앨리스_');
    // 구분자 비움 = 구분자 없음
    expect(exportRunOptionsFromPreset(form({ format: 'prefix', prefix: '앨리스', separator: '' }))).toMatchObject({ prefix: '앨리스', separator: '' });
  });

  test('저장된 프리셋 → 실행 옵션(종전 프리셋 분기 그대로)', () => {
    const base = exportFormToPreset(emptyExportForm());
    expect(exportRunOptionsFromPreset({ ...base, format: 'prefix', prefix: '' }).prefix).toBe('');
    expect(exportRunOptionsFromPreset({ ...base, format: 'prefix_ask' }, '밥').prefix).toBe('밥.');
    expect(exportRunOptionsFromPreset({ ...base, format: 'normal', prefix: '무시' }).prefix).toBe('');
  });

  test('BackupService: 직접 설정은 폼 요청(scope folder)으로, 연속 질문 문구는 사라짐', () => {
    const src = read('models/BackupService.ts');
    expect(src).toContain("scope: 'folder'");
    expect(src).toContain('appState.requestDirectExport(');
    for (const gone of ['파일명 구분자를 입력해주세요', '파일명 구분자 옵션', '이미지 픽셀 크기를 결정해주세요', '내보낼 이미지를 선택해주세요']) {
      expect(src).not.toContain(gone);
    }
  });
});

// ─────────────────────────── R1 ───────────────────────────
describe('R1 명칭: 목록 전부 = 백업 / 백업 불러오기', () => {
  test('캐릭터 프리셋(로컬·글로벌) 버튼·툴팁·토스트', () => {
    const src = read('componenets/CharacterPresetEditor.tsx');
    for (const gone of ['모든 프리셋 내보내기', '모든 글로벌 프리셋 내보내기', '"프리셋 파일 불러오기', '캐릭터 프리셋을 내보냈습니다', '글로벌 프리셋을 내보냈습니다']) {
      expect(src).not.toContain(gone);
    }
    expect(src).toContain('이 프로젝트의 캐릭터 프리셋 전체를 한 파일로 백업');
    expect(src).toContain('글로벌 캐릭터 프리셋 전체를 한 파일로 백업');
    expect(src).toContain('백업 파일에서 캐릭터 프리셋 불러오기');
    expect(src).toContain('백업 파일에서 글로벌 캐릭터 프리셋 불러오기');
    expect(src.match(/<ActionIcon id="backup" size=\{11\} \/>\s*백업\s*</g)?.length).toBe(2);
    expect(src.match(/<ActionIcon id="import" size=\{11\} \/>\s*백업 불러오기/g)?.length).toBe(2);
  });
  test('전역 조각: 「전체 백업」 → 「백업」, 선택 그룹 「내보내기」·한 파일 「불러오기」는 그대로', () => {
    const src = read('componenets/PieceEditor.tsx');
    expect(src).not.toContain('전체 백업 내보내기');
    expect(src).toContain('<span className={labelClass}>백업</span>');
    expect(src).toContain('선택한 조각그룹 내보내기');
    expect(src).toContain('불러오기 (.txt/.json)');
  });
});

// ─────────────────────────── R1-b ───────────────────────────
function target(names: string[]) {
  const map = new Map<string, any>(names.map((n) => [n, { name: n, characterPrompt: 'old' }]));
  const writes: string[] = [];
  return {
    map,
    writes,
    t: {
      has: (n: string) => map.has(n),
      add: (json: any) => map.set(json.name, json),
      replace: (name: string, json: any) => map.set(name, json),
      writeVibe: async (f: string) => {
        writes.push('v:' + f);
      },
      writeReference: async (f: string) => {
        writes.push('r:' + f);
      },
      newImageName: () => 'new.png',
    },
  };
}
const fileData = () => ({
  version: 1,
  presets: [
    { name: 'A', characterPrompt: 'new A', vibes: [{ path: 'va.png' }], vibeImages: [{ filename: 'va.png', data: 'x' }] },
    { name: 'B', characterPrompt: 'new B' },
    { name: 'A', characterPrompt: 'new A2' },
  ],
});

describe('R1-b 로컬 캐릭터 프리셋 불러오기 동명 처리', () => {
  test('겹침 수 = 시작 시점 기존 이름과 같은 항목 수(파일 안 같은 이름 둘은 2)', () => {
    expect(countLocalCharacterPresetConflicts(fileData(), (n) => n === 'A')).toBe(2);
    expect(countLocalCharacterPresetConflicts(fileData(), () => false)).toBe(0);
    expect(countLocalCharacterPresetConflicts({ nope: 1 }, () => true)).toBe(0);
  });
  test('새 이름으로 추가: 「A (2)」「A (3)」, 기존 유지', async () => {
    const { map, t } = target(['A']);
    const res = await applyLocalCharacterPresetImport(fileData(), 'rename', t);
    expect(res).toEqual({ added: 3, updated: 0, skipped: 0 });
    expect([...map.keys()]).toEqual(['A', 'A (2)', 'B', 'A (3)']);
    expect(map.get('A').characterPrompt).toBe('old');
    expect(map.get('A (2)').vibeImages).toBeUndefined();
  });
  test('건너뛰기: 시작 때 있던 이름은 추가도 이미지 쓰기도 안 함', async () => {
    const { map, writes, t } = target(['A']);
    const res = await applyLocalCharacterPresetImport(fileData(), 'skip', t);
    expect(res).toEqual({ added: 1, updated: 0, skipped: 2 });
    expect([...map.keys()]).toEqual(['A', 'B']);
    expect(writes).toEqual([]);
  });
  test('덮어쓰기: 같은 이름 자리에서 교체 1회, 파일 안 두 번째 같은 이름은 새 이름', async () => {
    const { map, writes, t } = target(['A', 'C']);
    const res = await applyLocalCharacterPresetImport(fileData(), 'overwrite', t);
    expect(res).toEqual({ added: 2, updated: 1, skipped: 0 });
    expect([...map.keys()]).toEqual(['A', 'C', 'B', 'A (2)']);
    expect(map.get('A')).toMatchObject({ name: 'A', characterPrompt: 'new A', vibes: [{ path: 'va.png' }] });
    expect(map.get('A (2)').characterPrompt).toBe('new A2');
    expect(writes).toEqual(['v:va.png']);
  });
  test('안전하지 않은 이미지 이름은 새 이름 + 참조 갱신(종전 X15b 그대로)', async () => {
    const { map, writes, t } = target([]);
    await applyLocalCharacterPresetImport(
      { presets: [{ name: 'Z', vibes: [{ path: '../evil.png' }], vibeImages: [{ filename: '../evil.png', data: 'x' }] }] },
      'rename',
      t,
    );
    expect(writes).toEqual(['v:new.png']);
    expect(map.get('Z').vibes).toEqual([{ path: 'new.png' }]);
  });
  test('형식 아님 = throw', async () => {
    await expect(applyLocalCharacterPresetImport({}, 'rename', target([]).t)).rejects.toThrow('올바른 캐릭터 프리셋 파일');
  });

  describe('흐름(importLocalCharacterPresetsText)', () => {
    const session = {
      hasCharacterPreset: (n: string) => sessionPresets.has(n),
      addCharacterPreset: (p: any) => sessionPresets.set(p.name, p),
      updateCharacterPreset: (old: string, p: any) => sessionPresets.set(old, p),
    } as any;
    beforeEach(() => {
      jest.clearAllMocks();
      sessionPresets.clear();
      state.pushMessage = jest.fn();
    });
    test('겹치는 이름이 없으면 묻지 않고 추가, 완료 안내는 공통 형식', async () => {
      await importLocalCharacterPresetsText(session, JSON.stringify({ presets: [{ name: 'X' }] }));
      expect(dialogState.pushDialogAsync).not.toHaveBeenCalled();
      expect([...sessionPresets.keys()]).toEqual(['X']);
      expect(dialogState.pushDialog).toHaveBeenCalledWith({
        type: 'yes-only',
        text: '캐릭터 프리셋 불러오기를 마쳤습니다.\n추가 1 · 갱신 0 · 건너뜀 0',
      });
    });
    test('겹치면 정책 선택(새 이름·건너뛰기·덮어쓰기), 덮어쓰기는 확인 1회 뒤 교체', async () => {
      sessionPresets.set('X', { name: 'X', characterPrompt: 'old' });
      dialogState.pushDialogAsync.mockResolvedValueOnce('overwrite');
      dialogState.confirmAsync.mockResolvedValueOnce(true);
      await importLocalCharacterPresetsText(session, JSON.stringify({ presets: [{ name: 'X', characterPrompt: 'new' }] }));
      const ask = dialogState.pushDialogAsync.mock.calls[0][0];
      expect(ask.items.map((i: any) => i.value)).toEqual(['rename', 'skip', 'overwrite']);
      expect(ask.text).toContain('이름이 같은 항목이 1개 있습니다');
      const confirm = dialogState.confirmAsync.mock.calls[0][0];
      expect(confirm.text).toContain('기존 캐릭터 프리셋 1개를 덮어씁니다.');
      expect(confirm.text).toContain(IMPORT_FLOW_TEXT.protection.replaceContent);
      expect(sessionPresets.get('X').characterPrompt).toBe('new');
      expect(dialogState.pushDialog.mock.calls[0][0].text).toContain('추가 0 · 갱신 1 · 건너뜀 0');
    });
    test('덮어쓰기 확인을 거절하면 아무것도 안 바뀜', async () => {
      sessionPresets.set('X', { name: 'X', characterPrompt: 'old' });
      dialogState.pushDialogAsync.mockResolvedValueOnce('overwrite');
      dialogState.confirmAsync.mockResolvedValueOnce(false);
      await importLocalCharacterPresetsText(session, JSON.stringify({ presets: [{ name: 'X', characterPrompt: 'new' }] }));
      expect(sessionPresets.get('X').characterPrompt).toBe('old');
      expect(dialogState.pushDialog).not.toHaveBeenCalled();
    });
    test('정책 창 취소 = 무변경', async () => {
      sessionPresets.set('X', { name: 'X' });
      dialogState.pushDialogAsync.mockResolvedValueOnce(undefined);
      await importLocalCharacterPresetsText(session, JSON.stringify({ presets: [{ name: 'X' }] }));
      expect([...sessionPresets.keys()]).toEqual(['X']);
      expect(writeDataFile).not.toHaveBeenCalled();
    });
    test('이미지는 이 프로젝트 vibes/·references/ 에', async () => {
      await importLocalCharacterPresetsText(
        session,
        JSON.stringify({ presets: [{ name: 'Y', vibeImages: [{ filename: 'a.png', data: 'd1' }], referenceImages: [{ filename: 'b.png', data: 'd2' }] }] }),
      );
      expect(writeDataFile.mock.calls).toEqual([['p/vibes/a.png', 'd1'], ['p/references/b.png', 'd2']]);
    });
    test('잘못된 파일 = 안내만', async () => {
      await importLocalCharacterPresetsText(session, '{bad');
      expect(state.pushMessage).toHaveBeenCalledWith('올바른 캐릭터 프리셋 파일이 아닙니다');
    });
  });
});
