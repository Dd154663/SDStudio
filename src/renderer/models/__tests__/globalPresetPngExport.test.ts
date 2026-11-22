// 고른 글로벌 프리셋 PNG 일괄 내보내기(2026-11-22) — models/globalPresetPngExport.ts
// 이름 정리·겹침 번호·한 개 실패 시 계속·진행 콜백·결과 집계·플랫폼 분기, 단일 내보내기와 같은 PNG 함수, 도구줄 버튼.
import fs from 'fs';
import path from 'path';

let mockMobile = false;
const written = new Set<string>();
const backend = {
  selectDir: jest.fn(async (): Promise<string | undefined> => 'D:/out'),
  existFileAbsolute: jest.fn(async (p: string) => written.has(p)),
  writeDataFileAbsolute: jest.fn(async (p: string, _d: string) => {
    written.add(p);
  }),
  writeDataFile: jest.fn(async (_p: string, _d: string) => {}),
  copyToDownloads: jest.fn(async (_p: string, _sub?: string) => {}),
  deleteFile: jest.fn(async (_p: string) => {}),
  existInDownloads: jest.fn(async (_n: string) => false),
};
const entries: Record<string, { id: string; name: string }> = {};
const globalPresetService = {
  get: jest.fn((id: string) => entries[id]),
  buildExportPng: jest.fn(async (id: string) => `png-${id}`),
  // 저장소를 바꾸는 메서드 — 불리면 안 된다(읽기만)
  save: jest.fn(),
  scheduleSave: jest.fn(),
  markDirty: jest.fn(),
};
jest.mock('..', () => ({ backend, globalPresetService }));
const appState = {
  pushMessage: jest.fn(),
  pushDialog: jest.fn(),
  setProgressDialog: jest.fn(),
  exportGlobalPresetToPng: jest.fn(async () => {}),
};
jest.mock('../AppService', () => ({ appState }));
jest.mock('../ImageService', () => ({
  cropMirrorResultFromDataUri: jest.fn(),
  dataUriToBase64: (d: string) => d.split(',')[1],
}));
jest.mock('../platform', () => ({
  platform: {
    get isMobile() {
      return mockMobile;
    },
  },
}));

import {
  createPcFolderSink,
  exportPresetPngs,
  GLOBAL_PRESET_PNG_TEXT,
  PRESET_PNG_DEFAULT_STEM,
  presetPngFileStem,
  presetPngResultNotice,
  runGlobalPresetPngExport,
} from '../globalPresetPngExport';

const ROOT = path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

beforeEach(() => {
  jest.clearAllMocks();
  mockMobile = false;
  written.clear();
  for (const k of Object.keys(entries)) delete entries[k];
  backend.selectDir.mockImplementation(async () => 'D:/out');
  backend.existInDownloads.mockImplementation(async () => false);
  globalPresetService.buildExportPng.mockImplementation(async (id: string) => `png-${id}`);
});

describe('파일 이름 정리', () => {
  test('금지 문자·제어 문자·Windows 예약 이름·빈 이름', () => {
    expect(presetPngFileStem('a/b:c*?')).toBe('a_b_c__');
    expect(presetPngFileStem('그림\x01체')).toBe('그림 체');
    expect(presetPngFileStem('CON')).toBe('_CON');
    expect(presetPngFileStem('lpt1.x')).toBe('_lpt1.x');
    expect(presetPngFileStem('  끝점. ')).toBe('끝점');
    expect(presetPngFileStem('')).toBe(PRESET_PNG_DEFAULT_STEM);
    expect(presetPngFileStem(' .. ')).toBe(PRESET_PNG_DEFAULT_STEM);
    expect(presetPngFileStem('\x00\x1f')).toBe(PRESET_PNG_DEFAULT_STEM);
  });
});

describe('exportPresetPngs', () => {
  test('차례로 저장·한 개 실패해도 계속·진행 콜백·결과 집계', async () => {
    const order: string[] = [];
    const progress: [number, number][] = [];
    const r = await exportPresetPngs(
      [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
        { id: '3', name: 'C' },
      ],
      {
        buildPng: async (id) => {
          order.push(id);
          if (id === '2') throw new Error('대표 이미지 손상');
          return `png-${id}`;
        },
        sink: { write: async (stem) => `${stem}.png` },
        onProgress: (d, t) => progress.push([d, t]),
      },
    );
    expect(order).toEqual(['1', '2', '3']);
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(r.saved.map((s) => s.file)).toEqual(['A.png', 'C.png']);
    expect(r.failed).toEqual([{ name: 'B', error: '대표 이미지 손상' }]);
  });

  test('쓰기 실패도 실패로 세고 계속', async () => {
    const r = await exportPresetPngs(
      [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
      ],
      {
        buildPng: async (id) => id,
        sink: {
          write: async (stem) => {
            if (stem === 'A') throw new Error('디스크 가득');
            return `${stem}.png`;
          },
        },
      },
    );
    expect(r.saved).toEqual([{ name: 'B', file: 'B.png' }]);
    expect(r.failed.map((f) => f.name)).toEqual(['A']);
  });

  test('결과 안내 — 전부 성공 = 토스트, 실패 있음 = 저장 수·실패 수·실패 이름', () => {
    expect(presetPngResultNotice({ saved: [{ name: 'A', file: 'A.png' }, { name: 'B', file: 'B.png' }], failed: [] })).toEqual({
      kind: 'message',
      text: '프리셋 PNG 2개를 저장했습니다',
    });
    expect(presetPngResultNotice({ saved: [{ name: 'A', file: 'A.png' }], failed: [] }, '글로벌 프리셋')).toEqual({
      kind: 'message',
      text: '다운로드 폴더의 "글로벌 프리셋"에 프리셋 PNG 1개를 저장했습니다',
    });
    const n = presetPngResultNotice({
      saved: [{ name: 'A', file: 'A.png' }],
      failed: [
        { name: 'B', error: 'x' },
        { name: 'C', error: 'y' },
      ],
    });
    expect(n.kind).toBe('dialog');
    expect(n.text).toBe('프리셋 PNG 저장 1 · 실패 2\n저장하지 못한 프리셋: 「B」, 「C」');
  });
});

describe('PC 폴더 저장 — 겹침 번호(getUniqueFilename 재사용)', () => {
  test('폴더에 같은 이름이 있으면 덮어쓰지 않고 번호, 이번 묶음끼리도 겹치지 않음', async () => {
    written.add('D:/out/A.png');
    const sink = createPcFolderSink('D:/out');
    expect(await sink.write('A', 'p1')).toBe('A_1.png');
    expect(await sink.write('A', 'p2')).toBe('A_2.png');
    expect(await sink.write('B', 'p3')).toBe('B.png');
    expect(backend.writeDataFileAbsolute.mock.calls).toEqual([
      ['D:/out/A_1.png', 'p1'],
      ['D:/out/A_2.png', 'p2'],
      ['D:/out/B.png', 'p3'],
    ]);
  });
});

describe('runGlobalPresetPngExport', () => {
  const targets = [
    { id: '1', name: 'A' },
    { id: '2', name: 'A' },
    { id: '3', name: 'B/C' },
  ];

  test('PC: 폴더 고르기 → 차례로 저장 → 진행 창 열고 닫음 → 저장 수 안내', async () => {
    const r = await runGlobalPresetPngExport(targets);
    expect(backend.selectDir).toHaveBeenCalledTimes(1);
    expect(globalPresetService.buildExportPng.mock.calls.map((c) => c[0])).toEqual(['1', '2', '3']);
    expect(backend.writeDataFileAbsolute.mock.calls.map((c) => c[0])).toEqual([
      'D:/out/A.png',
      'D:/out/A_1.png',
      'D:/out/B_C.png',
    ]);
    expect(backend.writeDataFileAbsolute.mock.calls[0][1]).toBe('png-1');
    expect(appState.setProgressDialog).toHaveBeenCalledWith({ text: GLOBAL_PRESET_PNG_TEXT.progress, done: 0, total: 3 });
    expect(appState.setProgressDialog).toHaveBeenCalledWith({ text: GLOBAL_PRESET_PNG_TEXT.progress, done: 3, total: 3 });
    expect(appState.setProgressDialog).toHaveBeenLastCalledWith(undefined);
    expect(appState.pushMessage).toHaveBeenCalledWith('프리셋 PNG 3개를 저장했습니다');
    expect(r?.saved).toHaveLength(3);
    // 모바일 경로는 타지 않음
    expect(backend.copyToDownloads).not.toHaveBeenCalled();
    // 글로벌 저장소는 읽기만
    expect(globalPresetService.save).not.toHaveBeenCalled();
    expect(globalPresetService.scheduleSave).not.toHaveBeenCalled();
    expect(globalPresetService.markDirty).not.toHaveBeenCalled();
  });

  test('PC: 일부 실패 = 확인 창에 저장 수·실패 수·실패한 이름', async () => {
    globalPresetService.buildExportPng.mockImplementation(async (id: string) => {
      if (id === '2') throw new Error('없음');
      return `png-${id}`;
    });
    await runGlobalPresetPngExport([
      { id: '1', name: 'A' },
      { id: '2', name: '둘째' },
      { id: '3', name: 'C' },
    ]);
    expect(appState.pushMessage).not.toHaveBeenCalled();
    expect(appState.pushDialog).toHaveBeenCalledWith({
      type: 'yes-only',
      text: '프리셋 PNG 저장 2 · 실패 1\n저장하지 못한 프리셋: 「둘째」',
    });
    expect(appState.setProgressDialog).toHaveBeenLastCalledWith(undefined);
  });

  test('PC: 폴더를 고르지 않으면 안내만, 아무것도 만들거나 쓰지 않음', async () => {
    backend.selectDir.mockImplementation(async () => undefined);
    expect(await runGlobalPresetPngExport(targets)).toBeUndefined();
    expect(appState.pushMessage).toHaveBeenCalledWith(GLOBAL_PRESET_PNG_TEXT.folderNotChosen);
    expect(globalPresetService.buildExportPng).not.toHaveBeenCalled();
    expect(backend.writeDataFileAbsolute).not.toHaveBeenCalled();
    expect(appState.setProgressDialog).not.toHaveBeenCalled();
  });

  test('한 개만 고르면 단일 내보내기 흐름', async () => {
    entries['1'] = { id: '1', name: 'A' };
    await runGlobalPresetPngExport([{ id: '1', name: 'A' }]);
    expect(appState.exportGlobalPresetToPng).toHaveBeenCalledWith(entries['1']);
    expect(backend.selectDir).not.toHaveBeenCalled();
    expect(globalPresetService.buildExportPng).not.toHaveBeenCalled();
  });

  test('0개면 아무것도 하지 않음', async () => {
    expect(await runGlobalPresetPngExport([])).toBeUndefined();
    expect(backend.selectDir).not.toHaveBeenCalled();
    expect(appState.exportGlobalPresetToPng).not.toHaveBeenCalled();
  });

  test('모바일: 폴더를 묻지 않고 Download/「글로벌 프리셋」 폴더(겹치면 번호)로 차례로, 스테이징은 지움', async () => {
    mockMobile = true;
    backend.existInDownloads.mockImplementation(async (n: string) => n === '글로벌 프리셋');
    await runGlobalPresetPngExport([
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ]);
    expect(backend.selectDir).not.toHaveBeenCalled();
    expect(backend.writeDataFileAbsolute).not.toHaveBeenCalled();
    expect(backend.writeDataFile.mock.calls).toEqual([
      ['exports/A.png', 'png-1'],
      ['exports/B.png', 'png-2'],
    ]);
    expect(backend.copyToDownloads.mock.calls).toEqual([
      ['exports/A.png', '글로벌 프리셋 (2)'],
      ['exports/B.png', '글로벌 프리셋 (2)'],
    ]);
    expect(backend.deleteFile.mock.calls.map((c) => c[0])).toEqual(['exports/A.png', 'exports/B.png']);
    expect(appState.pushMessage).toHaveBeenCalledWith('다운로드 폴더의 "글로벌 프리셋 (2)"에 프리셋 PNG 2개를 저장했습니다');
  });

  test('모바일: 복사 실패는 실패로 세고 스테이징을 지운 뒤 계속', async () => {
    mockMobile = true;
    backend.copyToDownloads.mockImplementationOnce(async () => {
      throw new Error('권한 없음');
    });
    await runGlobalPresetPngExport([
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ]);
    expect(backend.copyToDownloads).toHaveBeenCalledTimes(2);
    expect(backend.deleteFile).toHaveBeenCalledTimes(2);
    expect(appState.pushDialog).toHaveBeenCalledWith({
      type: 'yes-only',
      text: '프리셋 PNG 저장 1 · 실패 1\n저장하지 못한 프리셋: 「A」',
    });
  });
});

describe('단일 내보내기와 같은 PNG 함수', () => {
  test('exportToPng = buildExportPng + 파일로 쓰기, 일괄은 buildExportPng 를 부른다', () => {
    const svc = read('models/GlobalPresetService.ts');
    const single = svc.slice(svc.indexOf('async exportToPng('), svc.indexOf('async buildExportPng('));
    expect(single).toContain('await this.buildExportPng(id)');
    expect(single).toContain('backend.writeDataFile(outPath, newPng)');
    // 단일 내보내기의 자리·이름 규칙은 그대로(exports/ → publishExport)
    expect(read('models/AppService.ts')).toContain("'exports/' + entry.name + '_' + Date.now().toString() + '.png'");
    expect(read('models/globalPresetPngExport.ts')).toContain('globalPresetService.buildExportPng(id)');
  });
});

describe('도구줄 버튼', () => {
  const tab = read('componenets/GlobalPresetTab.tsx');
  test('PC·모바일 멀티선택 줄에 하나씩 — 고른 것이 없으면 비활성, 중립 색', () => {
    const buttons = tab.split('data-gp-bulk-export-png=""').length - 1;
    expect(buttons).toBe(2);
    // PC
    expect(tab).toContain(
      '<button\n              className="round-button back-gray px-3 py-1.5 text-sm"\n              data-gp-bulk-export-png=""\n              disabled={selectedIds.size === 0}\n              onClick={handleBulkExportPng}\n            >\n              {GLOBAL_PRESET_PNG_TEXT.buttonLabel}',
    );
    // 모바일(같은 줄 다른 버튼과 같은 크기·모양)
    expect(tab).toContain(
      'className="round-button back-gray h-8 flex-1 min-w-0 px-1 text-xs" aria-label={GLOBAL_PRESET_PNG_TEXT.buttonLabel} data-gp-bulk-export-png="" disabled={selectedIds.size === 0} onClick={handleBulkExportPng}',
    );
    expect(GLOBAL_PRESET_PNG_TEXT.buttonLabel).toBe('PNG로 내보내기');
  });
  test('자리 = 「프로젝트로 (일괄) 복사」 뒤·삭제 앞', () => {
    const pc = tab.lastIndexOf('{GLOBAL_PRESET_PNG_TEXT.buttonLabel}');
    expect(tab.lastIndexOf('프로젝트로 일괄 복사', pc)).toBeGreaterThan(-1);
    expect(tab.indexOf('일괄 삭제', pc)).toBeGreaterThan(pc);
    const mobile = tab.indexOf('onClick={handleBulkExportPng}>내보내기</button>');
    expect(mobile).toBeGreaterThan(-1);
    expect(tab.lastIndexOf('>프로젝트로 복사</button>', mobile)).toBeGreaterThan(-1);
    expect(tab.indexOf('onClick={handleBulkDelete}>삭제</button>', mobile)).toBeGreaterThan(mobile);
  });
});
