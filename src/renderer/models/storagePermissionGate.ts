// 안드로이드 저장소 권한 부팅 게이트.
//
// 배경: MainActivity 는 '모든 파일 접근' 권한이 없으면 설정 화면을 띄우지만
// 앱 부팅은 그대로 계속된다. 사용자가 설정에서 허용하는 동안 JS 부트스트랩이
// 권한 없는 상태로 즐겨찾기/북마크/config 등을 읽어 조용히 "빈 값"으로
// 초기화하고, 이후 저장 시 그 빈 값이 기존 파일을 덮어쓴다(데이터 유실).
// → 부트스트랩의 데이터 로드 전에 실제 접근 가능 여부를 프로브로 확인하고,
//   가능해질 때까지 대기한다(설정에서 복귀하는 resume + 1초 폴링).
//
// 프로브 = 실제 쓰기+삭제 시도. 네이티브 API 조회 대신 실측이라 SDK 버전·
// 권한 모델 차이(런타임 권한/모든 파일 접근)와 무관하게 정확하다.

import { backend, isMobile } from '.';
import { appState } from './AppService';

const PROBE_PATH = '.SDStudio/.perm-probe'; // androidBackend 의 APP_DIR 과 동일 루트

async function probeStorageAccess(): Promise<boolean> {
  const { Filesystem, Directory, Encoding } = await import(
    '@capacitor/filesystem'
  );
  try {
    await Filesystem.writeFile({
      path: PROBE_PATH,
      data: 'ok',
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    await Filesystem.deleteFile({
      path: PROBE_PATH,
      directory: Directory.Documents,
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function waitForStorageAccess(): Promise<void> {
  if (!isMobile) return;

  // SDK<30(런타임 권한 모델) 대비: 권한 요청 다이얼로그 트리거. 30+ 에선 no-op.
  try {
    const { Filesystem } = await import('@capacitor/filesystem');
    await Filesystem.requestPermissions();
  } catch {}

  if (await probeStorageAccess()) {
    await reloadEarlyFailedConfig();
    return;
  }

  appState.bootStatusMessage =
    '저장소 권한을 기다리는 중…\n설정에서 "모든 파일 접근"을 허용해 주세요';
  try {
    await new Promise<void>((resolve) => {
      let settled = false;
      let listenerHandle: { remove: () => void } | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        listenerHandle?.remove();
        resolve();
      };
      const tryProbe = () => {
        probeStorageAccess().then((ok) => {
          if (ok) finish();
        });
      };
      const timer = setInterval(tryProbe, 1000);
      // 설정 화면에서 앱으로 복귀하는 순간 즉시 재확인
      (async () => {
        try {
          const { App: CapacitorApp } = await import('@capacitor/app');
          listenerHandle = await CapacitorApp.addListener(
            'appStateChange',
            ({ isActive }) => {
              if (isActive) tryProbe();
            },
          );
        } catch {}
      })();
    });
  } finally {
    appState.bootStatusMessage = '';
  }
  await reloadEarlyFailedConfig();
}

// androidBackend 생성자는 모듈 초기화 시점에 config.json 을 읽는데, 권한이
// 늦게 허용되면 그 읽기가 실패해 세션 내내 빈 config 로 남는다(이후 setConfig
// 가 빈 값을 덮어쓰는 유실 위험). 게이트 통과 후 재읽기로 복구한다.
// (안드로이드 전용 메서드라 기능 감지로 호출 — 데스크톱에선 존재하지 않음)
async function reloadEarlyFailedConfig(): Promise<void> {
  try {
    await (backend as any).reloadConfigIfFailed?.();
  } catch (e) {
    console.error('config 재로드 실패:', e);
  }
}
