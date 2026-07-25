// 트랙1 (b) 물리 통합 — 저장소 v2 마이그레이션 서비스.
//
// 구 배치(projects/<폴더>/<이름>.json + outs/<이름>/… 등 7루트 분산)를 신 배치
// (workspace/<정제이름__짧은id>/{meta.json, project.json, outs/…})로 rename 이동한다.
// 스펙 단일 출처: track1-b-migration-spec.md §3(알고리즘)·§4(백업 게이트)·§7(롤백).
//
// 부팅 창(bootstrap.ts): waitForStorageAccess()·getConfig() 이후, sessionService.init()
// 직전에 실행된다. UI 는 MigrationGate.tsx 가 이 서비스의 observable 상태를 구독한다.
//
// ⚠️ models/index.ts 에 싱글턴 등록하지 않는다(부트 순서 밖 사이드이펙트 방지) —
//    이 모듈이 직접 export 하는 싱글턴(migrationService)만 사용한다.

import { observable } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { backend, zipService, backgroundKeepAliveService } from '.';
import { appState } from './AppService';
import { FileEntry } from '../backend';
import {
  STORAGE_MARKER_FILE,
  MIGRATION_LEDGER_FILE,
  MIGRATION_OPTOUT_FILE,
  PROJECT_META_FILE,
  PROJECT_JSON_FILE,
  WorkspaceProjectMeta,
  makeWorkspaceDirName,
  setWorkspaceLayoutActive,
  isWorkspaceLayout,
  registerProjectDir,
} from './storageLayout';
import {
  PROJECT_JSON_ROOT,
  PROJECT_DATA_ROOTS,
  PROJECT_IMAGE_ROOTS,
  WORKSPACE_ROOT,
  projectPath,
  workspacePath,
  projectJsonPath,
} from './projectPaths';

// ─────────────────────────────────────────────────────────────────────────
// 순수(무-IO) 판정 로직 — 단위 테스트 대상(스펙 §3-2·§3-4).
// ─────────────────────────────────────────────────────────────────────────

// 마커 유무 + 구 projects/ 잔존 json 유무로 부팅 판정을 낸다(스펙 §3-2).
// - 잔존 json 있음 → 'legacy'(마커 있으면 증분 이동, 없으면 최초 마이그레이션)
// - 잔존 json 없음 + 마커 있음 → 'none'(신 배치로 통과)
// - 잔존 json 없음 + 마커 없음 → 'fresh'(신규 사용자 — 마커만 기록)
export function classifyDetection(
  markerExists: boolean,
  hasResidualJson: boolean,
): 'none' | 'fresh' | 'legacy' {
  if (hasResidualJson) return 'legacy';
  return markerExists ? 'none' : 'fresh';
}

// 사람이 읽는 용량 문자열(오류/게이트 문구용) — 1GB 이상은 GB, 미만은 MB.
export function formatSizeKo(bytes: number): string {
  const GB = 1024 ** 3;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

// 동명 프로젝트 충돌 시 유일한 논리 이름을 만든다(스펙 §3-4).
// 첫 번째는 원래 이름, 두 번째부터 '이름_복구N'(N=2,3,…). taken 은 변형하지 않는다.
export function resolveRecoveryName(
  original: string,
  taken: Set<string>,
): string {
  if (!taken.has(original)) return original;
  let n = 2;
  while (taken.has(`${original}_복구${n}`)) n++;
  return `${original}_복구${n}`;
}

export interface RawProjectEntry {
  folder: string; // 논리 폴더 경로('' = 루트)
  name: string; // json 파일명에서 확장자를 뗀 원래 이름
  deleted: boolean; // 소프트 삭제(.deleted)
}

export interface PlannedName {
  folder: string;
  originalName: string;
  logicalName: string; // 충돌 시 '이름_복구N'
  deleted: boolean;
  moveImages: boolean; // 이미지 6루트는 원래 이름 첫 등장 프로젝트에만 귀속
}

// 스캔 순서의 원시 항목들에 논리 이름·이미지 귀속을 배정한다(스펙 §3-4).
// reservedNames/reservedOriginals: 재개 시 이미 완료된(원장 done) 항목이 선점한
// 논리 이름/이미지 원본 — 이를 존중해 잔존 항목만 이어서 배정한다.
export function assignLogicalNames(
  entries: RawProjectEntry[],
  reservedNames: string[] = [],
  reservedOriginals: string[] = [],
): PlannedName[] {
  const takenNames = new Set<string>(reservedNames);
  const claimedOriginals = new Set<string>(reservedOriginals);
  const out: PlannedName[] = [];
  for (const e of entries) {
    const logicalName = resolveRecoveryName(e.name, takenNames);
    takenNames.add(logicalName);
    const moveImages = !claimedOriginals.has(e.name);
    if (moveImages) claimedOriginals.add(e.name);
    out.push({
      folder: e.folder,
      originalName: e.name,
      logicalName,
      deleted: e.deleted,
      moveImages,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// 원장(migration_ledger.json) — 프로젝트·루트 단위 재개/역이동 근거(스펙 §2-4).
// ─────────────────────────────────────────────────────────────────────────

type ProjectState = 'pending' | 'moving' | 'done' | 'failed';

interface LedgerProject {
  originalName: string;
  logicalName: string;
  folder: string;
  dir: string; // 물리 폴더명(정제이름__짧은id)
  id: string; // 세션 uuid
  deleted: boolean;
  moveImages: boolean;
  state: ProjectState;
  roots: Partial<Record<string, 'done'>>;
  error?: string;
}

interface Ledger {
  version: 1;
  startedAt: number;
  projects: Record<string, LedgerProject>;
  // 백업 완료 근거(스펙 §4-0) — 재사용/재개 판정용. file=완성된 tar 파일명.
  backup?: { done: boolean; file: string };
}

// 원장 키 — (폴더, 이름) 조합은 구 배치에서 유일(같은 폴더에 동명 불가).
function ledgerKey(folder: string, name: string): string {
  return folder + '\u0000' + name;
}

export type MigrationChoice = 'proceed' | 'skip-backup' | 'later' | 'dismiss';

// 진단 조회 결과(설정→시스템 상태 표시용, 트랙1 B3). 읽기 전용 스냅샷.
export interface MigrationDiagStatus {
  layout: 'workspace' | 'legacy';
  optedOut: boolean; // "다시 알리지 않음" 기록 존재(구 배치일 때만 의미)
  marker: {
    storageVersion: number;
    migratedAt: number;
    appVersion: string;
  } | null;
  ledger: {
    startedAt: number;
    total: number;
    done: number;
    failed: number;
    incomplete: number; // pending·moving 잔여(비정상 중단 흔적)
    backupFile: string | null; // 마이그레이션 직전 전체 백업 파일명(완료 기록 시)
  } | null;
}

export type MigrationServiceState =
  | 'idle'
  | 'awaiting-choice'
  | 'backing-up'
  | 'migrating'
  | 'done'
  | 'failed';

export interface MigrationSpaceInfo {
  estimatedBytes: number; // 예상 백업 크기(사이드카 추정 → 실측으로 비동기 보정)
  freeBytes: number | null; // 여유 공간(null=알 수 없음)
  sufficient: boolean; // 여유 ≥ 예상×1.2
  measured: boolean; // true = 백업 대상 실측 합산(신뢰 가능), false = 사이드카 추정
}

class MigrationService {
  // ── observable 상태(MigrationGate 구독) ──
  @observable accessor state: MigrationServiceState = 'idle';
  @observable accessor projectTotal: number = 0;
  @observable accessor projectCurrent: number = 0;
  @observable accessor currentProjectName: string = '';
  // Android 백업 단계 표시(파일별 진행 이벤트가 없어 단계 문구로 대체 — 스펙 §4-0)
  @observable accessor backupPhase: string = '';
  // 기존 완성 백업을 재사용해 백업 단계를 스킵했는지(게이트/진행 고지용 — 스펙 §4-0)
  @observable accessor backupReused: boolean = false;
  @observable accessor spaceInfo: MigrationSpaceInfo | null = null;
  @observable accessor failedProjects: string[] = [];
  @observable accessor errorMessage: string = '';
  // 치명 실패(재부팅 재개 필요) vs 부분 실패(완료 후 요약 고지) 구분
  @observable accessor fatal: boolean = false;

  // detect() 캐시(runFullFlow 가 재사용)
  private markerExists = false;
  private pendingEntries: RawProjectEntry[] = [];
  private pendingFolders: string[] = [];

  private choiceResolver: ((c: MigrationChoice) => void) | undefined;

  // ── 판정 ──
  async detect(): Promise<'none' | 'fresh' | 'legacy'> {
    this.markerExists = await backend.existFile(STORAGE_MARKER_FILE);
    if (!this.markerExists) {
      // existFile 은 모든 오류를 false 로 삼킨다(양 플랫폼 공통) — 마커가 실제로
      // 있는데 일시 IO 오류로 못 본 오판을, 실제 내용 읽기+파싱으로 한 번 더 확인.
      try {
        const raw = JSON.parse(await backend.readFile(STORAGE_MARKER_FILE));
        if (raw && typeof raw.storageVersion === 'number') {
          this.markerExists = true;
        }
      } catch (e) {}
    }
    // 옵트아웃("다시 알리지 않음") + 마커 없음 = 구 배치 계속 사용 확정 상태.
    // 게이트도 이동도 없으므로 값비싼 projects/ 전체 스캔(직후 sessionService.init
    // 스캔과 중복)을 건너뛴다 — 옵트아웃 사용자의 매 부팅 비용 제거.
    // runFullFlow 가 옵트아웃을 다시 확인해 즉시 idle 로 돌아가므로 동작 동일.
    // (마커 있음=증분 케이스는 옵트아웃과 무관하게 스캔해야 하므로 제외)
    if (!this.markerExists && (await this.readOptOut())) {
      this.pendingEntries = [];
      this.pendingFolders = [];
      return 'legacy';
    }
    const { entries, folders } = await this.scanLegacyProjects();
    this.pendingEntries = entries;
    this.pendingFolders = folders;
    return classifyDetection(this.markerExists, entries.length > 0);
  }

  // 신규 사용자('fresh') — 신 배치 활성화 + 마커 기록.
  // 'fresh' 는 "마커도 없고 구 projects/ json 도 없음"인데, 스캔이 일시 IO 오류를
  // 전부 '없음'으로 삼킨 오판일 수 있다. 잘못 확정하면 마커가 선기록되어 구 데이터가
  // 안 보이게 되므로 흔적을 재검증한다.
  async markFreshAndActivate(): Promise<void> {
    const hasWorkspaceData = await this.hasWorkspaceData();
    if (!hasWorkspaceData && (await this.hasLegacyTraces())) {
      // 구 배치 데이터 흔적이 있는데 스캔은 0개 — 신규 확정 보류.
      // 이번 부팅은 구 배치로 진행하고, 다음 부팅에서 스캔이 성공하면
      // 'legacy' 로 정상 판정된다(마커 미기록이므로 재판정 가능).
      console.warn(
        '[마이그레이션] fresh 판정 보류 — 구 배치 데이터 흔적 감지(스캔 일시 오류 가능성). 마커 기록/활성화 건너뜀.',
      );
      return;
    }
    // 활성화를 마커 기록보다 먼저 — 마커 쓰기 한 번의 실패가 활성화를 막으면
    // workspace 에 데이터가 있는 사용자(마커만 소실)가 빈 구 배치를 스캔해
    // "프로젝트 전멸"로 보인다. 마커는 다음 부팅에서 재시도된다.
    setWorkspaceLayoutActive(true);
    try {
      await this.writeMarker();
    } catch (e) {
      console.error('[마이그레이션] 마커 기록 실패(활성화는 유지 — 다음 부팅 재시도):', e);
    }
  }

  // workspace/ 에 프로젝트 폴더가 하나라도 있는지 — 마커 소실 복구 판정용.
  private async hasWorkspaceData(): Promise<boolean> {
    try {
      const dirs = await backend.listFiles(WORKSPACE_ROOT);
      return dirs.some((d) => !d.startsWith('.'));
    } catch (e) {
      return false;
    }
  }

  // 구 배치 데이터 흔적 — projects/ 에 비어 있지 않은 내용물, 또는 구식 루트/
  // 사이드카 존재. 신규 사용자에게는 어느 것도 없다.
  private async hasLegacyTraces(): Promise<boolean> {
    try {
      const pj = await backend.listFiles(PROJECT_JSON_ROOT);
      if (pj.some((n) => !n.startsWith('.'))) return true;
    } catch (e) {}
    for (const t of ['outs', 'favorites.json']) {
      try {
        if (await backend.existFile(t)) return true;
      } catch (e) {}
    }
    return false;
  }

  // ── 전체 흐름('legacy') ──
  async runFullFlow(): Promise<void> {
    const incremental = this.markerExists;
    try {
      let choice: MigrationChoice = 'skip-backup';
      if (!incremental) {
        // "다시 알리지 않음" 기록이 있으면 게이트를 띄우지 않고 구 배치로 계속.
        // (재개는 설정 → 시스템 → 저장소 구조의 마이그레이션 시작 버튼)
        if (await this.readOptOut()) {
          this.state = 'idle';
          return;
        }
        // 최초 마이그레이션 — 여유 공간 판정 후 게이트 선택 대기.
        await this.computeSpaceInfo();
        choice = await this.awaitChoice();
        if (choice === 'later' || choice === 'dismiss') {
          // 마이그레이션을 미루고 구 배치 그대로 사용(활성화하지 않음).
          // 'dismiss' 는 다음 부팅부터 게이트도 띄우지 않는다(옵트아웃 기록).
          if (choice === 'dismiss') {
            await this.writeOptOut();
          }
          this.state = 'idle';
          return;
        }
        // 'skip-backup' 은 백업 없이 바로 이동.
      }

      // 백업·이동은 수 분 이상 걸릴 수 있다. 모바일에서 이 구간에 화면이 꺼지거나
      // 앱이 전환되면 Chromium 백그라운드 동결 → OS 프로세스 킬로 작업이 중단된다.
      // 생성 큐가 검증한 무음 오디오 keep-alive 를 이 구간에만 수동 유지한다.
      // (게이트 버튼 클릭으로 user gesture 확보 직후라 오디오 시작 가능. try/finally
      //  로 반드시 해제.) 스펙 §4-0.
      backgroundKeepAliveService.acquireHold();
      try {
        if (!incremental && choice === 'proceed') {
          await this.runBackup();
        }
        await this.runMigration();
      } finally {
        backgroundKeepAliveService.releaseHold();
      }

      if (!incremental) {
        await this.writeMarker();
      }
      // 마이그레이션이 끝났으므로 옵트아웃 기록은 더 이상 의미 없음 — 정리.
      await this.clearOptOut();
      setWorkspaceLayoutActive(true);

      if (this.failedProjects.length > 0) {
        this.fatal = false;
        this.state = 'failed'; // 완료했으나 일부 실패 — 요약 고지
      } else {
        this.state = 'done';
      }
    } catch (e) {
      console.error('마이그레이션 치명 실패:', e);
      this.errorMessage = String((e as any)?.message ?? e);
      this.fatal = true;
      this.state = 'failed';
      // 활성화하지 않음 — 재부팅 시 원장으로 재개.
    }
  }

  // ── 게이트 선택(MigrationGate 가 호출) ──
  chooseProceed(): void {
    this.resolveChoice('proceed');
  }
  chooseSkipBackup(): void {
    this.resolveChoice('skip-backup');
  }
  chooseLater(): void {
    this.resolveChoice('later');
  }
  chooseDismiss(): void {
    this.resolveChoice('dismiss');
  }
  // 부분 실패 요약 확인(활성화 이미 완료 — 게이트 닫기).
  acknowledge(): void {
    this.state = 'done';
  }

  // ── 옵트아웃("다시 알리지 않음") 기록 — 데이터 루트 직하 파일 ──
  private async readOptOut(): Promise<boolean> {
    try {
      return await backend.existFile(MIGRATION_OPTOUT_FILE);
    } catch (e) {
      return false;
    }
  }
  private async writeOptOut(): Promise<void> {
    try {
      await backend.writeFile(
        MIGRATION_OPTOUT_FILE,
        JSON.stringify({ dismissedAt: Date.now() }),
      );
    } catch (e) {}
  }
  // 설정의 마이그레이션 시작 버튼 — 옵트아웃 해제(다음 부팅에서 게이트 재표시).
  async clearOptOut(): Promise<void> {
    try {
      if (await backend.existFile(MIGRATION_OPTOUT_FILE)) {
        await backend.deleteFile(MIGRATION_OPTOUT_FILE);
      }
    } catch (e) {}
  }

  private awaitChoice(): Promise<MigrationChoice> {
    this.state = 'awaiting-choice';
    return new Promise<MigrationChoice>((resolve) => {
      this.choiceResolver = resolve;
    });
  }
  private resolveChoice(c: MigrationChoice): void {
    const r = this.choiceResolver;
    this.choiceResolver = undefined;
    if (r) r(c);
  }

  // ── 여유 공간 판정(스펙 §4-1) ──
  // 1차: project_sizes.json 사이드카로 즉시 추정(게이트를 지연 없이 띄우기 위함).
  // 2차: 백업 대상 파일을 실제로 걸어 합산한 실측치로 비동기 보정 — 사이드카는
  //      수동 계산이라 낡거나 비어 있을 수 있고 tar 오버헤드도 빠져 있어, 실제
  //      백업이 예상보다 수 GB 큰 문제(예: 예상 28GB vs 실제 33GB)가 보고됐다.
  private async computeSpaceInfo(): Promise<void> {
    let estimatedBytes = 0;
    try {
      const raw = JSON.parse(await backend.readFile('project_sizes.json'));
      if (raw && raw.entries) {
        for (const k of Object.keys(raw.entries)) {
          estimatedBytes += Number(raw.entries[k]?.bytes) || 0;
        }
      }
    } catch (e) {
      // 사이드카 없음/파손 → 0(알 수 없음 취급)
    }
    estimatedBytes = Math.round(estimatedBytes * 1.05);
    let freeBytes: number | null = null;
    try {
      freeBytes = await backend.getFreeSpace();
    } catch (e) {
      freeBytes = null;
    }
    const sufficient =
      freeBytes != null &&
      estimatedBytes > 0 &&
      freeBytes >= estimatedBytes * 1.2;
    this.spaceInfo = { estimatedBytes, freeBytes, sufficient, measured: false };
    // 실측 보정은 게이트가 떠 있는 동안 백그라운드로 진행(대기시키지 않음).
    void this.refineSpaceInfo();
  }

  // 백업 대상 실측 합산으로 spaceInfo 를 보정한다(읽기 전용 — 실패해도 무해).
  private async refineSpaceInfo(): Promise<void> {
    try {
      const { entries, totalBytes } = await this.buildBackupEntries();
      const estimatedBytes = MigrationService.estimateArchiveBytes(
        entries.length,
        totalBytes,
      );
      const freeBytes = this.spaceInfo?.freeBytes ?? null;
      this.spaceInfo = {
        estimatedBytes,
        freeBytes,
        sufficient:
          freeBytes != null &&
          estimatedBytes > 0 &&
          freeBytes >= estimatedBytes * 1.2,
        measured: true,
      };
    } catch (e) {
      console.error('백업 크기 실측 실패(사이드카 추정 유지):', e);
    }
  }

  // 무압축 tar 산출 크기 추정: 실측 합계 + 파일당 오버헤드(512B 헤더 + 평균
  // 512B 블록 패딩 ≈ 1KB) + 트레일러 여유.
  private static estimateArchiveBytes(
    fileCount: number,
    totalBytes: number,
  ): number {
    return Math.round(totalBytes + fileCount * 1024 + 4096);
  }

  // ── 마커 기록 ──
  private async writeMarker(): Promise<void> {
    let appVersion = '';
    try {
      appVersion = await backend.getVersion();
    } catch (e) {}
    const marker = {
      storageVersion: 2,
      migratedAt: Date.now(),
      appVersion,
    };
    await backend.writeFile(STORAGE_MARKER_FILE, JSON.stringify(marker));
  }

  // ── 백업(스펙 §4-0) — sessionService.init 전이라 BackupService 미사용, 직접 구성 ──
  private async runBackup(): Promise<void> {
    this.state = 'backing-up';

    // 기존 백업 재사용 판정(스펙 §4-0): exports/ 목록에서 잔여 .tar.part(불완전 —
    // 원자 rename 전 종료)는 삭제하고, 완성된 .tar(최종명 = rename 성공 = 완성)가
    // 있으면 백업 단계를 통째로 스킵한다. 장시간 백업 직전 앱 사망 후 재시작 시
    // 처음부터 반복하는 무한 루프를 끊는다. PC·Android 공통(양쪽 .part 임시명 동일).
    const reuse = await this.findReusableBackup();
    if (reuse) {
      this.backupReused = true;
      this.backupPhase = `기존 백업 재사용: ${reuse}`;
      await this.recordBackupDone(reuse);
      return;
    }

    this.backupPhase = '백업할 파일 목록을 만드는 중…';
    const { entries, totalBytes } = await this.buildBackupEntries();

    // 공간 하드 가드: 실측 필요 용량보다 여유 공간이 부족하면 시작하지 않는다.
    // 수십 GB 를 쓰다 디스크가 가득 차 중간에 죽는 것보다 즉시 명확히 실패하는
    // 편이 안전하다(잔여 .part 는 다음 부팅에 정리됨). 여유 공간을 알 수 없으면
    // 종전대로 진행한다.
    const needed = MigrationService.estimateArchiveBytes(
      entries.length,
      totalBytes,
    );
    let free: number | null = null;
    try {
      free = await backend.getFreeSpace();
    } catch (e) {}
    if (free != null && free < needed * 1.02) {
      throw new Error(
        `저장 공간이 부족해 백업을 시작할 수 없습니다 (필요 약 ${formatSizeKo(
          needed,
        )}, 남은 공간 ${formatSizeKo(free)}). ` +
          '공간을 확보한 뒤 프로그램을 다시 시작하거나, 백업 없이 진행을 선택해주세요.',
      );
    }

    this.backupPhase = `백업 중 (${entries.length}개 파일)`;
    // PC 파일별 진행: zip-progress IPC → App.tsx 핸들러가 appState.exportProgress
    // 를 갱신하는데, 그 핸들러는 exportProgress 가 이미 있을 때만 갱신한다. 여기서
    // seed 해 진행바가 흐르게 하고, 완료/실패 시 정리한다(스펙 §4-0).
    appState.exportProgress = {
      text: '압축파일 생성 중..',
      done: 0,
      total: entries.length || 1,
    };
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `pre-migration-backup-${ts}.tar`;
    const outPath = `exports/${fileName}`;
    try {
      await zipService.zipFiles(entries, outPath);
    } finally {
      appState.exportProgress = undefined;
    }
    this.backupPhase = '백업 완료';
    // 완료 직후 원장에 기록 — 이후(다음 부팅 재개 등) 판정 근거(스펙 §4-0).
    await this.recordBackupDone(fileName);
  }

  // exports/ 를 훑어 잔여 .tar.part(불완전)는 삭제하고, 완성된 백업 tar 파일명이
  // 있으면 반환한다(없으면 null). 완성 여부는 최종명(.tar) 존재 = 원자 rename 성공.
  private async findReusableBackup(): Promise<string | null> {
    let names: string[];
    try {
      names = await backend.listFiles('exports');
    } catch (e) {
      return null; // exports 폴더 없음 — 재사용할 백업 없음
    }
    let completed: string | null = null;
    for (const n of names) {
      if (!n.startsWith('pre-migration-backup-')) continue;
      if (n.endsWith('.tar.part')) {
        // 불완전 백업(원자 rename 전 종료) — 삭제.
        try {
          await backend.deleteFile('exports/' + n);
        } catch (e) {}
      } else if (n.endsWith('.tar')) {
        completed = n; // 완성 백업 — 재사용 후보
      }
    }
    return completed;
  }

  // 백업 완료(또는 재사용) 사실을 원장에 기록한다(비치명 — 실패해도 무시).
  private async recordBackupDone(file: string): Promise<void> {
    try {
      const ledger = await this.loadLedger();
      ledger.backup = { done: true, file };
      await this.saveLedger(ledger);
    } catch (e) {}
  }

  // 백업에서 제외하는 파생 캐시 디렉터리 — 원본만으로 재생성 가능하고, 포함하면
  // 백업이 실데이터 대비 수 배로 커진다(백업 용량 초과 보고의 주원인).
  // fastcache = 썸네일 캐시(원본 1장당 3개), encoded = 바이브 인코딩 캐시.
  // .trash 등 점 시작 디렉터리(휴지통)는 아래 walk 의 점 필터가 제외한다.
  private static readonly BACKUP_SKIP_DIRS = new Set(['fastcache', 'encoded']);

  // 프로젝트 7루트 밖의 글로벌 이미지 루트 — 루트 사이드카 json 이 참조하므로
  // 함께 백업해야 복구 시 글로벌 프리셋/캐릭터/작가 라이브러리 이미지가 살아남는다.
  private static readonly BACKUP_EXTRA_ROOTS = [
    'global_vibes',
    'global_char_images',
    'artist_library',
    'project_template_images',
  ];

  // 7루트(6 이미지 + projects) 재귀 + 글로벌 이미지 루트 + 루트 사이드카 json 을
  // 아카이브 엔트리로 모은다. totalBytes = 대상 파일 실측 합계(공간 가드·실측 추정용).
  // 엔트리의 name(아카이브 내부 경로)은 상대 경로 그대로 — 백업 아카이브 논리 형식과 동일.
  private async buildBackupEntries(): Promise<{
    entries: FileEntry[];
    totalBytes: number;
  }> {
    const out: FileEntry[] = [];
    let totalBytes = 0;
    const walk = async (relDir: string): Promise<void> => {
      let names: string[];
      let stats: { name: string; size: number }[];
      try {
        names = await backend.listFiles(relDir);
        stats = await backend.listFilesWithStats(relDir);
      } catch (e) {
        return; // 폴더 없음 — 건너뜀
      }
      const fileSet = new Set(stats.map((s) => s.name));
      for (const s of stats) {
        const rel = relDir + '/' + s.name;
        out.push({ name: rel, path: rel });
        totalBytes += s.size || 0;
      }
      for (const sub of names) {
        if (fileSet.has(sub)) continue;
        // 파생 캐시·점 디렉터리(.trash 등)는 백업 제외.
        if (sub.startsWith('.') || MigrationService.BACKUP_SKIP_DIRS.has(sub))
          continue;
        await walk(relDir + '/' + sub);
      }
    };
    for (const root of PROJECT_DATA_ROOTS) {
      await walk(root);
    }
    for (const root of MigrationService.BACKUP_EXTRA_ROOTS) {
      await walk(root);
    }
    // 루트 직하 사이드카 json(favorites/bookmarks/trash/… 무변경 대상)
    try {
      const rootStats = await backend.listFilesWithStats('');
      for (const s of rootStats) {
        if (s.name.endsWith('.json')) {
          out.push({ name: s.name, path: s.name });
          totalBytes += s.size || 0;
        }
      }
    } catch (e) {}
    return { entries: out, totalBytes };
  }

  // ── 이동 루프(스펙 §3-3) ──
  private async runMigration(): Promise<void> {
    this.state = 'migrating';
    const ledger = await this.loadLedger();
    const entries = this.pendingEntries;

    // 빈 폴더 생존 — folderOrder.json 에 없는 폴더명 보충(스펙 §3-4).
    await this.supplementEmptyFolders(this.pendingFolders);

    // 완료된(원장 done) 항목이 선점한 이름/이미지 원본을 재개 배정에 반영.
    const reservedNames: string[] = [];
    const reservedOriginals: string[] = [];
    for (const key of Object.keys(ledger.projects)) {
      const p = ledger.projects[key];
      if (p.state === 'done') {
        reservedNames.push(p.logicalName);
        if (p.moveImages) reservedOriginals.push(p.originalName);
      }
    }
    const planned = assignLogicalNames(entries, reservedNames, reservedOriginals);

    this.projectTotal = planned.length;
    this.projectCurrent = 0;

    for (let i = 0; i < planned.length; i++) {
      const plan = planned[i];
      const raw = entries[i];
      this.projectCurrent = i + 1;
      this.currentProjectName = plan.logicalName;
      let key = ledgerKey(raw.folder, raw.name);
      // 되살아난 항목 재이동 시 새 논리 이름/이미지 귀속을 강제하기 위한 플래그.
      let resurrected = false;

      try {
        let led = ledger.projects[key];
        if (led && led.state === 'done') {
          // 원장은 완료인데 원본 json 이 다시 존재하는 경우(구버전 다운그레이드
          // 왕복·백업 수동 복원) — 그냥 건너뛰면 그 데이터는 영구히 안 보인다.
          // 대체 키로 새 항목을 만들어 재이동한다.
          if (!(await backend.existFile(this.legacyJsonPath(raw)))) {
            continue; // 정상 완료(원본 없음)
          }
          let n = 2;
          while (ledger.projects[`${key}#${n}`]?.state === 'done') n++;
          key = `${key}#${n}`;
          led = ledger.projects[key];
          resurrected = true;
        }
        if (!led) {
          // 신규 항목 — json.id 확인(파싱 실패 시 스킵+failed).
          const idOrSkip = await this.readJsonIdOrSkip(raw);
          if (idOrSkip.skip) {
            ledger.projects[key] = {
              originalName: raw.name,
              logicalName: plan.logicalName,
              folder: raw.folder,
              dir: '',
              id: '',
              deleted: raw.deleted,
              moveImages: plan.moveImages,
              state: 'failed',
              roots: {},
              error: 'json 파싱 실패(스킵)',
            };
            this.pushFailure(plan.logicalName);
            await this.saveLedger(ledger);
            continue;
          }
          const id = idOrSkip.id || uuidv4();
          led = {
            originalName: raw.name,
            logicalName: plan.logicalName,
            folder: raw.folder,
            dir: makeWorkspaceDirName(plan.logicalName, id),
            id,
            deleted: raw.deleted,
            // 되살아난 항목은 이미지 귀속을 다시 받는다 — 이전 시대의 이미지
            // 루트는 이미 이동됐으므로, 지금 구 루트에 있는 폴더는 새 시대 것.
            moveImages: resurrected ? true : plan.moveImages,
            state: 'pending',
            roots: {},
          };
          ledger.projects[key] = led;
        }
        if (led.state === 'done') continue; // 방어(정상 흐름에선 위에서 분기)
        if (!led.dir) {
          // 과거 json 파싱 실패로 dir='' 로 기록된 failed 항목 — 그대로 두면
          // 매 부팅 경로 조립에서 throw 하며 영구 실패한다. 재계획 후 재시도.
          const idOrSkip = await this.readJsonIdOrSkip(raw);
          if (idOrSkip.skip) {
            this.pushFailure(led.logicalName);
            continue; // 여전히 파싱 불가 — failed 유지
          }
          led.id = idOrSkip.id || uuidv4();
          led.dir = makeWorkspaceDirName(led.logicalName, led.id);
        }
        await this.moveProject(led, ledger);
      } catch (e) {
        // 프로젝트 단위 실패는 원장 기록 후 다음 프로젝트 계속(전체 중단 금지).
        console.error('프로젝트 이동 실패(계속):', plan.logicalName, e);
        const led = ledger.projects[key];
        if (led) {
          led.state = 'failed';
          led.error = String((e as any)?.message ?? e);
        }
        this.pushFailure(plan.logicalName);
        await this.saveLedger(ledger).catch(() => {});
      }
    }
    await this.saveLedger(ledger);
  }

  private async moveProject(led: LedgerProject, ledger: Ledger): Promise<void> {
    led.state = 'moving';
    await this.saveLedger(ledger);

    // ② workspace/<dir>/ 생성 + ③ meta.json 기록(writeFile 이 디렉터리 생성).
    const meta: WorkspaceProjectMeta = {
      version: 1,
      id: led.id,
      name: led.logicalName,
      folder: led.folder,
    };
    await backend.writeFile(
      workspacePath(led.dir, PROJECT_META_FILE),
      JSON.stringify(meta),
    );

    // ④ 이미지 6루트(정규 순서) — 구 존재 시에만 이동(멱등).
    if (led.moveImages) {
      for (const root of PROJECT_IMAGE_ROOTS) {
        if (led.roots[root] === 'done') continue;
        const oldPath = projectPath(root, led.originalName);
        if (await backend.existFile(oldPath)) {
          await backend.renameDir(oldPath, workspacePath(led.dir, root));
        }
        led.roots[root] = 'done';
        // 루트 1개마다 원장 저장 — 중단 시 재개 지점을 정밀화(마지막 순서인
        // vibes/references 만 미이동으로 남는 어중간한 상태를 최소화).
        await this.saveLedger(ledger);
      }
    } else if (led.roots['attachCopy'] !== 'done') {
      // 동명 충돌로 이미지 6루트를 받지 못한 프로젝트 — 구 배치에서는 동명
      // 프로젝트끼리 이미지 폴더를 물리 공유했으므로, 첨부(레퍼런스/바이브)가
      // 살아남도록 선점 프로젝트의 vibes/references 만 복사해 준다(outs 등
      // 대용량 생성물은 종전 정책대로 선점 측 단독 귀속).
      const claimant = Object.values(ledger.projects).find(
        (p) =>
          p.originalName === led.originalName &&
          p.moveImages &&
          p.state === 'done',
      );
      if (claimant) {
        for (const root of ['vibes', 'references']) {
          await this.copyDirRecursive(
            workspacePath(claimant.dir, root),
            workspacePath(led.dir, root),
          );
        }
      }
      led.roots['attachCopy'] = 'done';
      await this.saveLedger(ledger);
    }

    // ⑤ json 마지막 — 활성은 project.json, 소프트삭제는 project.json.deleted.
    const baseOld = projectJsonPath(led.originalName, led.folder || undefined);
    const oldJson = led.deleted
      ? baseOld.replace(/\.json$/, '.deleted')
      : baseOld;
    const newJson = led.deleted
      ? workspacePath(led.dir, PROJECT_JSON_FILE + '.deleted')
      : workspacePath(led.dir, PROJECT_JSON_FILE);
    if (await backend.existFile(oldJson)) {
      if (led.logicalName !== led.originalName) {
        // 동명 충돌로 '_복구N' 논리 이름을 받은 프로젝트 — json 안의 name 도
        // 논리 이름으로 재기록한다. 그대로 두면 로드된 세션의 name 이 레지스트리
        // 키와 어긋나, vibes/references 등 이미지 경로가 다른(또는 미등록)
        // 프로젝트로 해석된다(마이그레이션 후 레퍼런스 첨부 깨짐의 근본 원인).
        try {
          const parsed = JSON.parse(await backend.readFile(oldJson));
          parsed.name = led.logicalName;
          await backend.writeFile(newJson, JSON.stringify(parsed));
          await backend.deleteFile(oldJson);
        } catch (e) {
          // 파싱 실패 시 이동이라도 보장 — 이름 정정은 로드 시 자가 치유가 담당.
          await backend.renameFile(oldJson, newJson);
        }
      } else {
        await backend.renameFile(oldJson, newJson);
      }
    }
    // .bak 동반 이동(존재 시).
    const oldBak = baseOld + '.bak';
    if (await backend.existFile(oldBak)) {
      await backend.renameFile(
        oldBak,
        workspacePath(led.dir, PROJECT_JSON_FILE + '.bak'),
      );
    }

    // ⑥ 원장 done + 레지스트리 등록.
    led.state = 'done';
    registerProjectDir(led.logicalName, led.dir);
    await this.saveLedger(ledger);
  }

  // src 디렉터리의 파일·하위 폴더를 dest 로 복사한다(파생 캐시·점 폴더 제외).
  // src 가 없으면 조용히 통과. 개별 파일 실패는 기록만 하고 계속(전체 중단 금지).
  private async copyDirRecursive(src: string, dest: string): Promise<void> {
    let names: string[];
    let stats: { name: string }[];
    try {
      names = await backend.listFiles(src);
      stats = await backend.listFilesWithStats(src);
    } catch (e) {
      return; // 폴더 없음
    }
    const fileSet = new Set(stats.map((s) => s.name));
    for (const f of fileSet) {
      try {
        await backend.copyFile(src + '/' + f, dest + '/' + f);
      } catch (e) {
        console.error('첨부 이미지 복사 실패(계속):', src + '/' + f, e);
      }
    }
    for (const sub of names) {
      if (fileSet.has(sub)) continue;
      if (sub.startsWith('.') || MigrationService.BACKUP_SKIP_DIRS.has(sub))
        continue;
      await this.copyDirRecursive(src + '/' + sub, dest + '/' + sub);
    }
  }

  // 구 배치에서 이 항목의 json 물리 경로(활성 .json / 소프트삭제 .deleted).
  private legacyJsonPath(raw: RawProjectEntry): string {
    const base = projectJsonPath(raw.name, raw.folder || undefined);
    return raw.deleted ? base.replace(/\.json$/, '.deleted') : base;
  }

  // json 을 가볍게 파싱해 id 필드만 확인(전체 Session 로드 금지). 파싱 실패=스킵 신호.
  private async readJsonIdOrSkip(
    raw: RawProjectEntry,
  ): Promise<{ skip: boolean; id?: string }> {
    const p = this.legacyJsonPath(raw);
    try {
      const parsed = JSON.parse(await backend.readFile(p));
      // 세션 json 은 항상 객체다 — 배열/원시값(favorites 류 사이드카가 잘못
      // 섞인 경우)은 프로젝트가 아니므로 스킵해 유령 프로젝트 생성을 막는다.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { skip: true };
      }
      const id =
        typeof parsed.id === 'string' && parsed.id ? parsed.id : undefined;
      return { skip: false, id };
    } catch (e) {
      return { skip: true };
    }
  }

  private pushFailure(name: string): void {
    this.failedProjects = [...this.failedProjects, name];
  }

  // ── 빈 폴더 보충(스펙 §3-4) ──
  private async supplementEmptyFolders(folders: string[]): Promise<void> {
    if (folders.length === 0) return;
    try {
      let arr: string[] = [];
      try {
        arr = JSON.parse(await backend.readFile('folderOrder.json')) || [];
        if (!Array.isArray(arr)) arr = [];
      } catch (e) {}
      let changed = false;
      for (const f of folders) {
        if (f && !arr.includes(f)) {
          arr.push(f);
          changed = true;
        }
      }
      if (changed) {
        await backend.writeFile('folderOrder.json', JSON.stringify(arr));
      }
    } catch (e) {
      console.error('빈 폴더 보충 실패(계속):', e);
    }
  }

  // ── 구 projects/ 재귀 스캔 — json/.deleted 항목 + 폴더 목록 ──
  private async scanLegacyProjects(): Promise<{
    entries: RawProjectEntry[];
    folders: string[];
  }> {
    const entries: RawProjectEntry[] = [];
    const folders: string[] = [];
    const walk = async (relDir: string, folder: string): Promise<void> => {
      let names: string[];
      let stats: { name: string }[];
      try {
        names = await backend.listFiles(relDir);
        stats = await backend.listFilesWithStats(relDir);
      } catch (e) {
        return; // 폴더 없음/접근 불가
      }
      const fileSet = new Set(stats.map((s) => s.name));
      for (const fname of fileSet) {
        if (fname.startsWith('.')) continue; // 이름 없는 점 파일('.deleted' 등) 제외
        if (fname.endsWith('.json.bak')) continue; // .bak 동반 파일은 항목 아님
        // 구식 위치의 사이드카(v1 시절 projects/favorites.json) — 프로젝트가 아니다.
        // 이관 대상으로 삼으면 'favorites' 유령 프로젝트가 생기고 즐겨찾기가 소실된다
        // (부팅 순서상 loadFavorites 의 자체 이관보다 마이그레이션이 먼저 본다).
        if (folder === '' && fname === 'favorites.json') continue;
        if (fname.endsWith('.json')) {
          entries.push({ folder, name: fname.slice(0, -5), deleted: false });
        } else if (fname.endsWith('.deleted')) {
          entries.push({
            folder,
            name: fname.slice(0, -'.deleted'.length),
            deleted: true,
          });
        }
      }
      const subdirs = names.filter(
        (e) => !fileSet.has(e) && !e.startsWith('.'),
      );
      for (const sub of subdirs) {
        const childFolder = folder ? folder + '/' + sub : sub;
        folders.push(childFolder);
        await walk(relDir + '/' + sub, childFolder);
      }
    };
    await walk(PROJECT_JSON_ROOT, '');
    // 활성(.json)을 소프트 삭제(.deleted)보다 먼저 배치 — 동명 충돌 시 활성
    // 프로젝트가 원래 이름과 이미지 6루트를 선점하도록. 삭제 항목이 선점하면
    // 활성 쪽 이미지 루트가 미등록 삭제 폴더로 이동해 outs/레퍼런스/바이브가
    // 통째로 사라진 것처럼 보인다(마이그레이션 후 첨부 깨짐 시나리오).
    const sorted = [
      ...entries.filter((e) => !e.deleted),
      ...entries.filter((e) => e.deleted),
    ];
    return { entries: sorted, folders };
  }

  // ── 진단 조회(트랙1 B3) — 설정→시스템의 상태 표시 전용, 읽기만 한다 ──
  // 원장/마커의 스키마 해석을 이 서비스 안에 유지하기 위한 public 창구.
  async readDiagStatus(): Promise<MigrationDiagStatus> {
    let marker: MigrationDiagStatus['marker'] = null;
    try {
      const raw = JSON.parse(await backend.readFile(STORAGE_MARKER_FILE));
      if (raw && typeof raw.storageVersion === 'number') {
        marker = {
          storageVersion: raw.storageVersion,
          migratedAt: typeof raw.migratedAt === 'number' ? raw.migratedAt : 0,
          appVersion: String(raw.appVersion ?? ''),
        };
      }
    } catch (e) {}
    let ledger: MigrationDiagStatus['ledger'] = null;
    try {
      if (await backend.existFile(MIGRATION_LEDGER_FILE)) {
        const l = await this.loadLedger();
        const states = Object.values(l.projects).map((p) => p.state);
        ledger = {
          startedAt: l.startedAt,
          total: states.length,
          done: states.filter((s) => s === 'done').length,
          failed: states.filter((s) => s === 'failed').length,
          incomplete: states.filter((s) => s !== 'done' && s !== 'failed')
            .length,
          backupFile: l.backup?.done ? l.backup.file : null,
        };
      }
    } catch (e) {}
    return {
      layout: isWorkspaceLayout() ? 'workspace' : 'legacy',
      optedOut: await this.readOptOut(),
      marker,
      ledger,
    };
  }

  // ── 원장 로드/저장 ──
  private async loadLedger(): Promise<Ledger> {
    try {
      const raw = JSON.parse(await backend.readFile(MIGRATION_LEDGER_FILE));
      if (raw && raw.version === 1 && raw.projects) return raw as Ledger;
    } catch (e) {}
    return { version: 1, startedAt: Date.now(), projects: {} };
  }
  private async saveLedger(l: Ledger): Promise<void> {
    await backend.writeFile(MIGRATION_LEDGER_FILE, JSON.stringify(l));
  }

  // ── 역이동(롤백, 스펙 §7) — UI 배선 없이 함수만 제공 ──
  async rollbackMigration(): Promise<void> {
    const ledger = await this.loadLedger();
    for (const key of Object.keys(ledger.projects)) {
      const e = ledger.projects[key];
      if (e.state !== 'done') continue;
      try {
        const base = projectJsonPath(e.originalName, e.folder || undefined);
        const oldJson = e.deleted ? base.replace(/\.json$/, '.deleted') : base;
        const newJson = e.deleted
          ? workspacePath(e.dir, PROJECT_JSON_FILE + '.deleted')
          : workspacePath(e.dir, PROJECT_JSON_FILE);
        if (await backend.existFile(newJson)) {
          await backend.renameFile(newJson, oldJson);
        }
        const newBak = workspacePath(e.dir, PROJECT_JSON_FILE + '.bak');
        if (await backend.existFile(newBak)) {
          await backend.renameFile(newBak, base + '.bak');
        }
        if (e.moveImages) {
          for (const root of PROJECT_IMAGE_ROOTS) {
            const src = workspacePath(e.dir, root);
            if (await backend.existFile(src)) {
              await backend.renameDir(src, projectPath(root, e.originalName));
            }
          }
        }
        try {
          await backend.deleteFile(workspacePath(e.dir, PROJECT_META_FILE));
        } catch (err) {}
      } catch (err) {
        console.error('역이동 실패(계속):', e.logicalName, err);
      }
    }
    try {
      await backend.deleteFile(STORAGE_MARKER_FILE);
    } catch (e) {}
    setWorkspaceLayoutActive(false);
  }
}

export const migrationService = new MigrationService();
