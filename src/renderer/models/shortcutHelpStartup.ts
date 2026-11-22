// 「시작 시 단축키 도움말 표시」(config.showShortcutHelpOnStartup, 2026-11-22 — 기본 끔, 사용자 결정).
//
// 앱이 시작해 설정을 처음 읽을 때 **한 번만** 씬 단축키 도움말 패널(appState.showSceneCheatsheet)을 맞춘다.
// App.tsx 의 설정 읽기는 config-changed 마다 다시 돌므로, 그 뒤에는 반영하지 않는다(사용자가 H 키·버튼으로
// 연 패널을 설정 저장이 닫아 버리지 않게). 실행 중 여닫음은 저장하지 않는다 — 설정은 「시작할 때 열지」만 정한다.
// 패널 초기값(AppService)은 false 라, 켜져 있을 때만 여는 것으로 「이 값으로 맞춤」과 같다.
// 서비스 의존 없음(jest: __tests__/shortcutHelpStartup.test.ts).

import type { Config } from '../../main/config';

export function shouldShowShortcutHelpOnStartup(config: Pick<Config, 'showShortcutHelpOnStartup'> | undefined | null): boolean {
  return config?.showShortcutHelpOnStartup === true;
}

/** 첫 호출에만 show(설정값)를 부르는 함수를 만든다. 창(렌더러)마다 하나. */
export function createStartupShortcutHelpApplier(show: () => void) {
  let applied = false;
  return (config: Pick<Config, 'showShortcutHelpOnStartup'> | undefined | null): void => {
    if (applied) return;
    applied = true;
    if (shouldShowShortcutHelpOnStartup(config)) show();
  };
}
