import { BackgroundMode } from '@anuradev/capacitor-background-mode';
import { backend, isMobile } from '.';
import { appState } from './AppService';

// ── 모바일 권한 안내 온보딩 (부팅 완료 후 실행) ──
// 알림 권한 / 배터리 최적화 제외를 시스템 다이얼로그로 바로 요청하지 않고,
// 먼저 앱 내 안내 모달을 띄워 사용자가 '확인'을 눌렀을 때만 시스템 창을 연다.
//
// 배경: 종전에는 앱 시작 직후(로딩 화면과 겹쳐서) 시스템 다이얼로그가 자동으로
// 떴는데, 바깥 터치·뒤로가기로 닫혀 사용자가 모르고 지나치기 쉬웠다. 특히 알림
// 권한은 시스템 창을 2번 거부하면 영구 차단되어 앱에서 복구할 수 없다.
//
// 동작 규칙:
//  - 모달에서 '거절' → config 에 거절 플래그 저장, 이후 다시 안내하지 않음
//  - 모달에서 '확인' 후 시스템 창에서 거부 → 플래그를 세우지 않음 → 다음 부팅 때 재안내

interface PermissionStep {
  declinedKey: 'notifPermissionDeclined' | 'batteryPermissionDeclined';
  text: string;
  isGranted: () => Promise<boolean>;
  request: () => Promise<void>;
}

async function runStep(step: PermissionStep): Promise<void> {
  const config = await backend.getConfig();
  if (config[step.declinedKey]) return;
  try {
    if (await step.isGranted()) return;
  } catch {
    return; // 상태 조회가 안 되는 환경(구버전 OS 등)에서는 조용히 통과
  }

  const accepted = await new Promise<boolean>((resolve) => {
    appState.pushDialog({
      type: 'confirm',
      green: true,
      text: step.text,
      confirmText: '확인',
      cancelText: '거절',
      callback: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });

  if (!accepted) {
    config[step.declinedKey] = true;
    await backend.setConfig(config);
    return;
  }
  try {
    await step.request();
  } catch {}
}

export async function runMobilePermissionOnboarding(): Promise<void> {
  if (!isMobile) return;

  await runStep({
    declinedKey: 'notifPermissionDeclined',
    text:
      '🔔 알림 권한 안내\n\n' +
      '백그라운드에서 이미지 생성을 이어가려면 진행 상태 알림 권한이 필요합니다. ' +
      '권한이 없으면 화면을 끄거나 다른 앱으로 이동했을 때 생성이 중단될 수 있습니다.\n\n' +
      "'확인'을 누르면 권한 요청 창이 표시됩니다.\n'거절'을 누르면 다시 안내하지 않습니다.",
    isGranted: async () =>
      (await BackgroundMode.checkNotificationsPermission()).display ===
      'granted',
    request: async () => {
      await BackgroundMode.requestNotificationsPermission();
    },
  });

  await runStep({
    declinedKey: 'batteryPermissionDeclined',
    text:
      '🔋 백그라운드 동작 안내\n\n' +
      '장시간 생성이 도중에 끊기지 않으려면 배터리 최적화 대상에서 SDStudio 를 ' +
      '제외해야 합니다.\n\n' +
      "'확인'을 누르면 시스템 허용 창이 표시됩니다.\n'거절'을 누르면 다시 안내하지 않습니다.",
    isGranted: async () =>
      (await BackgroundMode.checkBatteryOptimizations()).disabled,
    request: async () => {
      await BackgroundMode.requestDisableBatteryOptimizations();
    },
  });
}
