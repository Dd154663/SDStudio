import {
  backend,
  sessionService,
  globalPieceService,
  globalPresetService,
  globalCharacterPresetService,
  artistLibraryService,
  taskQueueService,
  imageDownloadService,
  loginService,
  appUpdateNoticeService,
  localAIService,
  backgroundNotificationService,
  backgroundKeepAliveService,
} from '.';
import { appState } from './AppService';
import { persistService } from './PersistenceService';
import { runMobilePermissionOnboarding } from './mobilePermissions';
import { waitForStorageAccess } from './storagePermissionGate';
import { migrationService } from './MigrationService';
import { setWorkspaceLayoutActive } from './storageLayout';

// ── 명시적 부트 시퀀스 ──
// 앱의 모든 비동기 초기화가 여기서 "정해진 순서"로 일어난다.
// models/index.ts 는 싱글톤 생성(순수 배선)만 하고, IO 를 동반하는 준비는
// 전부 이 함수가 수행한다. App 은 appState.bootReady 로 메인 UI 를 게이트하므로
// "서비스가 준비되기 전에 UI/다른 서비스가 사용" 하는 부류의 race 가 원천 차단된다.
//
// 원칙:
//  - 실패해도 앱은 뜬다: 각 단계는 개별 격리(allSettled/try)되고, ready 는 finally 로 보장.
//  - ready 이전 = 사용자 데이터에 필요한 준비만. 네트워크·백그라운드 작업은 ready 후 비차단.

let started = false;

export async function bootstrapApp(): Promise<void> {
  if (started) return; // React StrictMode/재호출 방어
  started = true;
  const t0 = Date.now();

  // 각 단계는 개별 격리한다 — 앞 단계 실패가 뒤 단계(특히 세션 초기화)를
  // 건너뛰게 하면 안 된다. 부팅이 일부 실패해도 앱은 반드시 뜬다.
  // (전체를 try/finally 로 감싸 어떤 예외 경로에서도 ready 게이트는 반드시 열린다)
  try {
    // 0) 종료 시 저장 훅을 가장 먼저 등록 — 부팅 도중 종료해도 안전하게 저장 시도
    try {
      registerOnCloseFlush();
    } catch (e) {
      console.error('종료 훅 등록 실패:', e);
    }

    // 0.5) [안드로이드] 저장소 접근 가능해질 때까지 대기 — MainActivity 의
    //     '모든 파일 접근' 설정 화면과 부팅이 경합하면 아래 모든 로드가
    //     권한 오류로 빈 값이 되고, 이후 저장이 기존 데이터를 덮어쓴다.
    //     (데스크톱은 즉시 통과)
    try {
      await waitForStorageAccess();
    } catch (e) {
      console.error('저장소 권한 게이트 실패(진행):', e);
    }

    // 1) 설정 로드 보장 (이후 단계·컴포넌트가 config 를 안전하게 읽는다)
    try {
      await backend.getConfig();
    } catch (e) {
      console.error('설정 로드 실패(기본값으로 진행):', e);
    }

    // 1.5) [트랙1 (b)] 저장소 v2 마이그레이션 판정·실행 — 권한+config 확보 후,
    //      세션 스캔(init) 전의 유일한 창(스펙 §3-1). 게이트 UI(MigrationGate)가
    //      선택을 받을 때까지 여기서 대기한다. 판정 실패(마커 IO 오류 등)는
    //      구 배치로 폴백(활성화하지 않음 — 안전 쪽).
    try {
      const det = await migrationService.detect();
      if (det === 'fresh') {
        // 신규 사용자 — 마커만 기록하고 신 배치 활성화.
        await migrationService.markFreshAndActivate();
      } else if (det === 'none') {
        // 마커 있음·잔존 없음 — 신 배치로 통과.
        setWorkspaceLayoutActive(true);
      } else {
        // 'legacy' — 최초 마이그레이션(게이트) 또는 증분 이동. "나중에 하기"
        // 선택 시 activate 하지 않고 구 배치 그대로 init 진행.
        await migrationService.runFullFlow();
      }
    } catch (e) {
      console.error('저장소 마이그레이션 판정/실행 실패(구 배치 폴백):', e);
    }

    // 2) 핵심: 세션 서비스 준비
    //    (저장 디렉터리 보장 → 즐겨찾기/북마크/휴지통 사전 로드 → 초기 스캔 → 가시성 저장 훅)
    try {
      await sessionService.init();
    } catch (e) {
      console.error('세션 서비스 초기화 실패(주기 루프가 재시도):', e);
    }

    // 3) 가벼운 로컬 데이터 병렬 로드 — 하나가 실패해도 나머지는 진행
    const results = await Promise.allSettled([
      globalPieceService.load(),
      globalPresetService.load(),
      globalCharacterPresetService.load(),
      artistLibraryService.load(),
      taskQueueService.loadLogs(), // 이전 실행의 작업 로그 복원(파일 없으면 무시)
      imageDownloadService.loadSettings(),
      appState.initExportPresets(), // localStorage → exportPresets.json 1회 이관 + 로드
    ]);
    for (const r of results) {
      if (r.status === 'rejected') console.error('부팅 로드 실패(계속 진행):', r.reason);
    }
  } finally {
    // 준비 완료 — 메인 UI 게이트를 연다
    appState.bootReady = true;
    console.log(`부팅 완료: ${Date.now() - t0}ms`);
  }

  // 4) ready 이후 비차단 백그라운드 작업 — UI 표시를 막지 않는다
  // 자동 저장 루프 (반환하지 않음)
  sessionService.runLoop().catch((e) => {
    console.error('자동 저장 루프 중단(치명적 — 저장 미가동 위험):', e);
  });
  // 시작 시 1회 토큰 검증 (네트워크)
  loginService.refresh().catch(() => {});
  // 새 버전 확인 (네트워크)
  Promise.resolve(appUpdateNoticeService.run()).catch(() => {});
  // 로컬 배경 제거 모델 존재 확인
  Promise.resolve(localAIService.statsModels()).catch(() => {});
  // 모바일 포그라운드 알림 / 백그라운드 동결 우회
  Promise.resolve(backgroundNotificationService.start()).catch(() => {});
  Promise.resolve(backgroundKeepAliveService.start()).catch(() => {});
  // 모바일 권한 안내(알림/배터리) — 메인 UI 위에 순차 모달, '확인' 시에만 시스템 창
  runMobilePermissionOnboarding().catch(() => {});
}

// 앱 종료 시 저장되지 않은 편집을 마지막으로 저장한다.
// (기존 models/index.ts 모듈 평가 시점 등록에서 이동 — 동작 동일)
function registerOnCloseFlush() {
  backend.onClose(() => {
    (async () => {
      try {
        await sessionService.flushOnClose();
        await globalPresetService.flushSave();
        await globalPieceService.flushSave();
        await globalCharacterPresetService.flushSave();
        await artistLibraryService.flushSave();
        await taskQueueService.flushSaveLogs();
        // 쓰기 파이프라인에 남아 있는(대기/진행 중) 저장까지 전부 디스크에 반영
        await persistService.flushAll();
      } catch (e) {
        console.error('종료 시 저장 실패:', e);
      } finally {
        await backend.close();
      }
    })();
  });
}
