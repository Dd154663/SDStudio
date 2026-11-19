// PC 화면 배율(시험 기능, 2026-11-19) — 허용 목록·기본값·저장값·적용 경로 고정.
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_UI_ZOOM_PERCENT,
  UI_ZOOM_PERCENT_OPTIONS,
  normalizeUiZoomPercent,
  uiZoomFactorOf,
  uiZoomPercentForSave,
} from '../../../shared/uiZoom';
import { CONFIG_GROUP_FIELDS, CONFIG_SYNC_EXCLUDED } from '../configSync';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf-8');

test('허용 목록은 100·95·90·85·80·75 이고 기본은 100', () => {
  expect([...UI_ZOOM_PERCENT_OPTIONS]).toEqual([100, 95, 90, 85, 80, 75]);
  expect(DEFAULT_UI_ZOOM_PERCENT).toBe(100);
});

test.each([
  [undefined, 100],
  [null, 100],
  [100, 100],
  [90, 90],
  [75, 75],
  ['85', 85],
  [' 80 ', 80],
  ['', 100],
  [70, 100],
  [87, 100],
  [0.9, 100],
  [NaN, 100],
  ['abc', 100],
  [{}, 100],
  [true, 100],
])('normalizeUiZoomPercent(%p) = %p', (input, expected) => {
  expect(normalizeUiZoomPercent(input)).toBe(expected);
});

test('창 배율 = 백분율 ÷ 100, 이상한 값은 1', () => {
  expect(uiZoomFactorOf(80)).toBeCloseTo(0.8);
  expect(uiZoomFactorOf(undefined)).toBe(1);
  expect(uiZoomFactorOf(42)).toBe(1);
});

test('저장값: 100% 와 이상한 값은 키를 비우고, 나머지는 그대로', () => {
  expect(uiZoomPercentForSave(100)).toBeUndefined();
  expect(uiZoomPercentForSave(13)).toBeUndefined();
  expect(uiZoomPercentForSave(95)).toBe(95);
  expect(uiZoomPercentForSave('75')).toBe(75);
});

test('기기별 값이라 환경설정 내보내기에서 뺀다', () => {
  expect(CONFIG_SYNC_EXCLUDED).toContain('uiZoomPercent');
  const all = Object.values(CONFIG_GROUP_FIELDS).flat() as string[];
  expect(all).not.toContain('uiZoomPercent');
});

test('main 이 창 생성·문서 로드·set-config 때 설정 배율을 적용한다', () => {
  const main = read('main/main.ts');
  expect(main).toContain('zoomFactor: uiZoomFactorOf(config.uiZoomPercent)');
  expect(main).toContain("win.webContents.on('dom-ready', () => applyUiZoom(win));");
  const setConfig = main.slice(main.indexOf("ipcMain.handle('set-config'"));
  const body = setConfig.slice(0, setConfig.indexOf('\n});'));
  expect(body).toContain('for (const w of BrowserWindow.getAllWindows()) applyUiZoom(w);');
});
