// 안드로이드 저장소 권한 부팅 게이트.
//
// 배경 (2026-07-31 근본 조사 — plans/android-storage-vanish-investigation.md):
// 데이터 루트는 공유 저장소(Documents/.SDStudio)다. Android 11+ 의 스코프드
// 스토리지(FUSE)는 '모든 파일 접근'이 없으면 이 설치본이 만들지 않은 파일
// (재설치·기기 이전·MediaStore 재구축 이전의 데이터)을 File API 목록/읽기에서
// **오류 없이** 숨긴다 — 파일은 디스크에 있는데 앱에는 "전부 증발"로 보이고,
// 그 상태의 저장/백업은 2차 피해(포크·불완전 tar)를 만든다.
// 종전의 "쓰기 프로브" 게이트는 새 파일 쓰기가 항상 성공하는 스코프드 스토리지
// 특성상 이 상태를 통과시켰다(무력). → Android 11+ 는 네이티브 상태 조회
// (Environment.isExternalStorageManager)로 허용될 때까지 부팅을 차단한다.
//
// Android 10 이하는 런타임 권한 모델이라 종전 흐름(권한 요청 + 실측 프로브)이
// 정확하다 — 그대로 유지. 네이티브 조회가 실패하면(구 플러그인 등) 프로브로 폴백.

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

// Android 11+ '모든 파일 접근' 상태 조회. null = 조회 불가(프로브 폴백).
async function allFilesStatus(): Promise<{
  required: boolean;
  granted: boolean;
} | null> {
  try {
    const { default: ZipService } = await import('../backends/zipService');
    const st = await ZipService.storagePermissionStatus({});
    if (st && typeof st.required === 'boolean') return st;
  } catch {}
  return null;
}

// '모든 파일 접근' 설정 화면 열기 — 부팅 게이트 화면의 [설정 열기] 버튼이 호출.
export async function openStoragePermissionSettings(): Promise<void> {
  try {
    const { default: ZipService } = await import('../backends/zipService');
    await ZipService.openAllFilesSettings({});
  } catch (e) {
    console.error('모든 파일 접근 설정 화면 열기 실패:', e);
  }
}

// 조건이 참이 될 때까지 대기 — 1초 폴링 + 설정 화면에서 복귀(resume) 시 즉시 재확인.
async function waitUntil(check: () => Promise<boolean>): Promise<void> {
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
    const tryCheck = () => {
      check().then((ok) => {
        if (ok) finish();
      });
    };
    const timer = setInterval(tryCheck, 1000);
    (async () => {
      try {
        const { App: CapacitorApp } = await import('@capacitor/app');
        listenerHandle = await CapacitorApp.addListener(
          'appStateChange',
          ({ isActive }) => {
            if (isActive) tryCheck();
          },
        );
      } catch {}
    })();
  });
}

export async function waitForStorageAccess(): Promise<void> {
  if (!isMobile) return;

  // ── Android 11+: '모든 파일 접근' 필수 (허용 전 부팅 진행 금지) ──
  const status = await allFilesStatus();
  if (status?.required) {
    if (!status.granted) {
      appState.storagePermissionBlocked = true;
      appState.bootStatusMessage = '저장소 권한을 기다리는 중…';
      try {
        await waitUntil(async () => {
          const st = await allFilesStatus();
          // 조회가 갑자기 실패하면 차단을 풀지 않는다(보수적) — 다음 폴링에서 재시도
          return !!st && (!st.required || st.granted);
        });
      } finally {
        appState.storagePermissionBlocked = false;
        appState.bootStatusMessage = '';
      }
    }
    await reloadEarlyFailedConfig();
    return;
  }

  // ── Android 10 이하(런타임 권한) 또는 네이티브 조회 실패: 종전 프로브 흐름 ──
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
    await waitUntil(probeStorageAccess);
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
