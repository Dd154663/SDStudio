import {
  backend,
  sessionService,
  imageService,
  trashService,
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
  templateService,
  imageHistoryService,
} from '.';
import { reaction } from 'mobx';
import { appState } from './AppService';
import { persistService } from './PersistenceService';
import { runMobilePermissionOnboarding } from './mobilePermissions';
import { waitForStorageAccess } from './storagePermissionGate';
import { migrationService } from './MigrationService';
import { setWorkspaceLayoutActive, STORAGE_MARKER_FILE } from './storageLayout';
import { WORKSPACE_ROOT } from './projectPaths';
import type { Session } from './types';

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

  // 창 제목에 현재 프로젝트명을 반영 — 작업표시줄/Alt+Tab 에서 창을 구분하기 위함
  // (멀티 윈도우 W6, 데스크톱). curSession 변경 시 mobx reaction 으로 최소 침습 갱신.
  // 모바일은 작업표시줄이 없어 무의미하지만 무해하다.
  reaction(
    () => appState.curSession?.name,
    (name) => {
      document.title = name ? `SDStudio — ${name}` : 'SDStudio';
    },
    { fireImmediately: true },
  );

  // 프로젝트 배타 락 (W6 P1, 데스크톱 멀티 윈도우): curSession 전환을 이 단일
  // 지점에서 감시해 락을 확보/해제한다 — 흩어진 할당 지점(16곳)은 건드리지 않는
  // 최소 침습. 확보 실패(다른 창이 보유) 시 토스트+소유 창 포커스+이전 세션 복귀.
  // 모바일/단일 창은 backend 기본 구현이 "항상 성공"이라 사실상 no-op.
  // 이름 기준으로 감시하므로 현재 프로젝트의 이름 변경도 자동 재키잉(새 이름
  // acquire → 옛 이름 release)된다. 창이 닫히면 main 이 그 창의 락을 자동 해제.
  let lockHeldSession: Session | undefined; // 락을 확보한 세션 (실패 복귀용)
  let lockSeq = 0; // 빠른 연속 전환 시 낡은 acquire 결과를 폐기하는 세대 번호
  reaction(
    () => appState.curSession?.name,
    async (name, prevName) => {
      const seq = ++lockSeq;
      if (!name) {
        if (prevName) {
          backend.releaseProjectLock(prevName).catch(() => {});
          // 미러였다면 종료 처리(마킹 해제+버려진 편집 캐시 파기)
          if (sessionService.isMirror(prevName))
            sessionService.endMirror(prevName);
        }
        lockHeldSession = undefined;
        return;
      }
      const session = appState.curSession;
      let ok = true;
      try {
        ok = await backend.acquireProjectLock(name);
      } catch (e) {
        console.error('프로젝트 락 확보 실패(허용으로 진행):', e);
      }
      if (seq !== lockSeq) return; // 더 새로운 전환이 있음 — 이 결과는 폐기
      if (ok) {
        if (prevName && prevName !== name) {
          backend.releaseProjectLock(prevName).catch(() => {});
        }
        lockHeldSession = session;
        // 이전 세션이 읽기 전용 미러였다면 종료 처리 — 마킹 해제 + 버려진 편집이
        // 캐시로 살아남지 않게 파기(재열기 시 "그대로 남은" 혼동 방지, 2026-07-18
        // 실기 피드백). 미러는 락이 없어 release 호출 경로는 기존대로 둬도 무해.
        if (prevName && sessionService.isMirror(prevName)) {
          sessionService.endMirror(prevName);
        }
      } else {
        // 다른 창이 소유 중. "같은 프로젝트 중복 열기 허용" 설정이면 "소유 창으로
        // 이동 / 읽기 전용 미러로 열기" 를 고르게 한다(설정 OFF 면 종전 동작 그대로).
        if (appState.allowDuplicateProjectOpen) {
          const choice = await appState.pushDialogAsync({
            type: 'select',
            text: `"${name}" 프로젝트는 다른 창에서 열려 있습니다. 어떻게 할까요?`,
            items: [
              { text: '소유 창으로 이동', value: 'focus' },
              { text: '읽기 전용 미러로 열기', value: 'mirror' },
            ],
          });
          if (seq !== lockSeq) return; // 대기 중 더 새로운 전환 — 결과 폐기
          if (choice === 'mirror') {
            // 미러로 열기: 락 미획득. 이전 프로젝트의 락은 놓는다 — 이 창은 더
            // 이상 그 프로젝트를 표시하지 않는데 락만 쥐고 있으면 다른 창이
            // "열려 있음" 충돌을 만나고, 포커스를 받아도 미러만 보여 혼란스럽다
            // (release 는 main 이 소유 검사라 미보유면 무해).
            sessionService.mirrorSessions.add(name);
            if (prevName && prevName !== name) {
              backend.releaseProjectLock(prevName).catch(() => {});
              if (sessionService.isMirror(prevName)) {
                sessionService.endMirror(prevName);
              }
            }
            lockHeldSession = undefined; // 복귀 대상 없음(실패 시 미선택 화면으로)
            // 미러는 디스크 최신본으로 연다 — 이 창의 낡은 캐시(예전에 열었던
            // 인스턴스나 직전 미러의 버려진 편집)가 소유 창의 최근 저장을 가리지
            // 않게 캐시를 파기하고 새로 읽어 교체한다(이름이 같아 이 reaction 은
            // 재발화하지 않는다). 로드 실패 시엔 기존 인스턴스 유지(최선 노력).
            sessionService.evict(name);
            const fresh = await sessionService.get(name);
            if (seq !== lockSeq) return; // 로드 대기 중 전환 — 결과 폐기
            if (fresh) appState.curSession = fresh;
            appState.pushMessage(
              '읽기 전용 미러로 열었습니다 — 즐겨찾기·삭제·생성 외 편집은 저장되지 않습니다',
            );
            return;
          }
          // choice !== 'mirror'(이동/취소) → 아래 기존 동작(포커스 + 복귀)
        }
        // 안내 토스트는 요청 창이 아닌 **소유 창**에 띄운다 — 포커스가 즉시
        // 소유 창으로 넘어가므로, 여기(요청 창)에 남기면 돌아왔을 때 낡은
        // 메시지만 덩그러니 남는다(2026-07-17 실기 피드백).
        backend
          .focusProjectLockOwner(
            name,
            `"${name}" 프로젝트는 이 창에 열려 있습니다`,
          )
          .catch(() => {});
        // 락 보유 세션(또는 미선택 화면)으로 복귀 — 이 재할당으로 reaction 이
        // 한 번 더 돌지만, 보유 중인 락 재확보(멱등)라 무한 루프는 없다.
        appState.curSession = lockHeldSession;
      }
    },
  );

  // 락 소유 창으로 전달된 안내 수신 — 다른 창의 열기/파괴 작업 충돌 시 main 이
  // 이 창(소유 창)에 보낸 메시지를 토스트로 표시한다.
  backend.onLockOwnerNotice((message) => appState.pushMessage(message));

  // 생성 위임 브리지 (W6 P3, 데스크톱 멀티 윈도우): 이 창이 호스트인지 조회하고
  // 제출/실행/취소/완료/미러 IPC 를 연결한다. 모바일/단일 창은 backend 기본 구현이
  // "항상 호스트" no-op 이라 사실상 아무 배선도 하지 않는다(종전과 동일).
  await taskQueueService.initGenerationHostBridge();

  // 전역 저장소 동기화 수신 (W6 P2, 데스크톱 멀티 윈도우): 다른 창이 공유
  // 저장소를 저장하면 여기서 디스크 재로드로 반영한다(낙관적 쓰기+브로드캐스트).
  // 보낸 창은 main 이 제외하므로 자기 저장에 자기 재로드가 겹치지 않는다.
  backend.onGlobalStoreChanged(async (key) => {
    try {
      if (key === 'config') {
        // main 의 config 는 이미 최신 — config-changed 경로(App.tsx 구독)가
        // get-config 재조회 + appState 미러 재적용을 수행한다.
        sessionService.configChanged();
      } else if (key === 'global-character-presets') {
        await globalCharacterPresetService.load();
      } else if (key === 'trash') {
        await trashService.reloadExternal();
      } else if (key === 'session-meta') {
        await sessionService.reloadSharedMeta();
      }
    } catch (e) {
      console.error('전역 저장소 동기화 실패:', key, e);
    }
  });

  // 창 간 세션 op 수신 (읽기 전용 미러 / 같은 프로젝트 중복 열기): 다른 창이 보낸
  // 이미지 즐겨찾기(mains) 변경을 이 창의 메모리에 반영한다(로드된 세션에만).
  // 소유 창이면 mobx reaction 이 자동 저장(=위임의 실체), 미러 창은 P0 가드가 드롭.
  backend.onSessionOp((payload) => {
    try {
      sessionService.applySessionOp(payload);
    } catch (e) {
      console.error('세션 op 적용 실패:', e);
    }
  });

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
    //      선택을 받을 때까지 여기서 대기한다.
    try {
      // [오판 방어 ①] 지정 저장 경로 접근 실패로 기본 경로 폴백 중이면(데스크톱)
      // 판정을 보류한다 — 엉뚱한(기본) 루트에 마커를 기록하거나 그 루트의 옛
      // 데이터로 마이그레이션 게이트를 띄우면 안 된다. 마커가 이미 있으면
      // 활성화만 하고 통과(폴백 경고는 App.tsx 가 안내).
      const bootWarnings = await backend.getBootWarnings().catch(() => null);
      const saveLocFallback = !!bootWarnings?.saveLocationFallback;
      // [오판 방어 ②] 보조 창(데스크톱 멀티 윈도우)은 마이그레이션을 수행하지
      // 않는다 — 호스트 창이 "나중에 하기"를 고른 뒤 보조 창이 이동을 돌리면
      // 두 창의 배치 인식이 갈라져 목록이 통째로 비어 보인다. 마커만 따라간다.
      const migrationAllowed =
        !saveLocFallback && taskQueueService.isGenerationHost;
      if (!migrationAllowed) {
        if (await backend.existFile(STORAGE_MARKER_FILE)) {
          setWorkspaceLayoutActive(true);
        }
      } else {
        const det = await migrationService.detect();
        if (det === 'fresh') {
          // 신규 사용자 — 신 배치 활성화(구 데이터 흔적 재검증·마커 기록은 내부).
          await migrationService.markFreshAndActivate();
        } else if (det === 'none') {
          // 마커 있음·잔존 없음 — 신 배치로 통과.
          setWorkspaceLayoutActive(true);
        } else {
          // 'legacy' — 최초 마이그레이션(게이트) 또는 증분 이동. "나중에 하기"
          // 선택 시 activate 하지 않고 구 배치 그대로 init 진행.
          await migrationService.runFullFlow();
        }
      }
    } catch (e) {
      console.error('저장소 마이그레이션 판정/실행 실패:', e);
      // [오판 방어 ③] 구 배치 폴백 전 재확인 — workspace 에 프로젝트가 있으면
      // (이미 이관된 사용자) 구 배치로 내려가는 순간 빈 projects/ 를 스캔해
      // 목록이 통째로 비어 보인다. 이 경우 신 배치를 유지한다.
      try {
        const ws = await backend
          .listFiles(WORKSPACE_ROOT)
          .catch(() => [] as string[]);
        if (ws.some((d: string) => !d.startsWith('.'))) {
          console.error('→ workspace 데이터 감지: 구 배치 폴백 대신 신 배치 유지');
          setWorkspaceLayoutActive(true);
        }
      } catch (e2) {}
    }

    // 2) 핵심: 세션 서비스 준비
    //    (저장 디렉터리 보장 → 즐겨찾기/북마크/휴지통 사전 로드 → 초기 스캔 → 가시성 저장 훅)
    try {
      await sessionService.init();
    } catch (e) {
      console.error('세션 서비스 초기화 실패(주기 루프가 재시도):', e);
    }

    // 2.5) [데스크톱 멀티 윈도우 W6 P1] "새 창에서 열기"로 이 창에 예치된 초기
    //      프로젝트가 있으면 연다. 락은 위 curSession reaction 이 확보한다
    //      (이론상 경합 실패 시 토스트+소유 창 포커스+선택 화면 복귀).
    //      일반 창/모바일은 backend 기본 구현이 null 이라 통과.
    try {
      const initial = await backend.takeInitialProject();
      if (initial) {
        const sess = await sessionService.get(initial);
        if (sess) {
          imageService.refreshBatch(sess);
          appState.curSession = sess;
        }
      }
    } catch (e) {
      console.error('초기 프로젝트 로드 실패(선택 화면으로 진행):', e);
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
      // 숨김 씬 템플릿 목록을 UI 렌더 전에 확보 — 목록 필터가 첫 렌더부터 적용된다
      // (보조 창 포함 — 이관은 아래에서 호스트만)
      templateService.ensureLoaded(),
      imageHistoryService.ensureLoaded(), // 지난 실행 히스토리 복원(전체 최근 30장)
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
  // 씬 템플릿 → 숨김 프로젝트 1회 이관 (씬 템플릿 개편, 2026-07-18) — 지정된
  // 일반 프로젝트를 복제본(숨김)으로 분리한다. 멱등이라 실패 항목은 다음 부팅에서
  // 재시도. 생성 호스트(주) 창에서만 실행해 보조 창과의 중복 이관을 피한다
  // (모바일/단일 창은 항상 호스트).
  if (taskQueueService.isGenerationHost) {
    templateService.migrateSceneTemplatesToHidden().catch((e) => {
      console.error('씬 템플릿 숨김 이관 실패:', e);
    });
  }
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
