// 「시작 시 단축키 도움말 표시」(2026-11-22, 기본 끔) — 순수 함수 + 연결 소스 검사.
import fs from 'fs';
import path from 'path';
import {
  createStartupShortcutHelpApplier,
  shouldShowShortcutHelpOnStartup,
} from '../shortcutHelpStartup';

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

describe('shortcutHelpStartup', () => {
  test('기본(없음·false·이상한 값) = 열지 않음, true 만 연다', () => {
    expect(shouldShowShortcutHelpOnStartup(undefined)).toBe(false);
    expect(shouldShowShortcutHelpOnStartup({})).toBe(false);
    expect(shouldShowShortcutHelpOnStartup({ showShortcutHelpOnStartup: false })).toBe(false);
    expect(shouldShowShortcutHelpOnStartup({ showShortcutHelpOnStartup: 'true' as any })).toBe(false);
    expect(shouldShowShortcutHelpOnStartup({ showShortcutHelpOnStartup: true })).toBe(true);
  });

  test('첫 읽기에만 반영 — 뒤의 설정 다시 읽기는 무시', () => {
    const show = jest.fn();
    const apply = createStartupShortcutHelpApplier(show);
    apply({ showShortcutHelpOnStartup: true });
    apply({ showShortcutHelpOnStartup: true });
    expect(show).toHaveBeenCalledTimes(1);

    const show2 = jest.fn();
    const apply2 = createStartupShortcutHelpApplier(show2);
    apply2({}); // 첫 읽기 = 끔 → 열지 않음
    apply2({ showShortcutHelpOnStartup: true }); // 실행 중 켜서 저장해도 이번 실행에는 열지 않음(다음 실행부터)
    expect(show2).not.toHaveBeenCalled();
  });

  test('패널 초기값은 닫힘, App 의 설정 읽기가 applier 를 부른다(월드컵 도움말은 그대로)', () => {
    const app = read('AppService.ts');
    expect(app).toContain('@observable accessor showSceneCheatsheet: boolean = false;');
    expect(app).toContain('@observable accessor showTournamentCheatsheet: boolean = true;');
    const appTsx = read('../componenets/App.tsx');
    expect(appTsx).toMatch(
      /const applyStartupShortcutHelp = createStartupShortcutHelpApplier\(\(\) => \{\n\s*appState\.showSceneCheatsheet = true;\n\s*\}\);/,
    );
    const refresh = appTsx.slice(appTsx.indexOf('const refreshDarkMode = async'), appTsx.indexOf("sessionService.addEventListener('config-changed', refreshDarkMode)"));
    expect(refresh).toContain('applyStartupShortcutHelp(conf);');
    // 실행 중 여닫음(H 키·도구줄 버튼)은 설정에 쓰지 않는다
    const sq = read('../componenets/SceneQueueControl.tsx');
    expect(sq).not.toMatch(/showShortcutHelpOnStartup/);
  });
});
