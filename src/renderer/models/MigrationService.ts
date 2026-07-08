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
  PROJECT_META_FILE,
  PROJECT_JSON_FILE,
  WorkspaceProjectMeta,
  makeWorkspaceDirName,
  setWorkspaceLayoutActive,
  registerProjectDir,
} from './storageLayout';
import {
  PROJECT_JSON_ROOT,
  PROJECT_DATA_ROOTS,
  PROJECT_IMAGE_ROOTS,
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

export type MigrationChoice = 'proceed' | 'skip-backup' | 'later';

export type MigrationServiceState =
  | 'idle'
  | 'awaiting-choice'
  | 'backing-up'
  | 'migrating'
  | 'done'
  | 'failed';

export interface MigrationSpaceInfo {
  estimatedBytes: number; // 예상 백업 크기(project_sizes 합산×1.05)
  freeBytes: number | null; // 여유 공간(null=알 수 없음)
  sufficient: boolean; // 여유 ≥ 예상×1.2
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
    // 마커 읽기 실패(IO 오류)는 상위(bootstrap)가 구 배치 폴백하도록 예외 전파.
    this.markerExists = await backend.existFile(STORAGE_MARKER_FILE);
    const { entries, folders } = await this.scanLegacyProjects();
    this.pendingEntries = entries;
    this.pendingFolders = folders;
    return classifyDetection(this.markerExists, entries.length > 0);
  }

  // 신규 사용자('fresh') — 마커만 기록하고 신 배치 활성화.
  async markFreshAndActivate(): Promise<void> {
    await this.writeMarker();
    setWorkspaceLayoutActive(true);
  }

  // ── 전체 흐름('legacy') ──
  async runFullFlow(): Promise<void> {
    const incremental = this.markerExists;
    try {
      let choice: MigrationChoice = 'skip-backup';
      if (!incremental) {
        // 최초 마이그레이션 — 여유 공간 판정 후 게이트 선택 대기.
        await this.computeSpaceInfo();
        choice = await this.awaitChoice();
        if (choice === 'later') {
          // 마이그레이션을 미루고 구 배치 그대로 사용(활성화하지 않음).
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
  // 부분 실패 요약 확인(활성화 이미 완료 — 게이트 닫기).
  acknowledge(): void {
    this.state = 'done';
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
    this.spaceInfo = { estimatedBytes, freeBytes, sufficient };
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
    const entries = await this.buildBackupEntries();
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

  // 7루트(6 이미지 + projects) 재귀 + 루트 사이드카 json 을 아카이브 엔트리로 모은다.
  // 엔트리의 name(아카이브 내부 경로)은 상대 경로 그대로 — 백업 아카이브 논리 형식과 동일.
  private async buildBackupEntries(): Promise<FileEntry[]> {
    const out: FileEntry[] = [];
    const walk = async (relDir: string): Promise<void> => {
      let names: string[];
      let stats: { name: string }[];
      try {
        names = await backend.listFiles(relDir);
        stats = await backend.listFilesWithStats(relDir);
      } catch (e) {
        return; // 폴더 없음 — 건너뜀
      }
      const fileSet = new Set(stats.map((s) => s.name));
      for (const f of fileSet) {
        const rel = relDir + '/' + f;
        out.push({ name: rel, path: rel });
      }
      for (const sub of names) {
        if (fileSet.has(sub)) continue;
        await walk(relDir + '/' + sub);
      }
    };
    for (const root of PROJECT_DATA_ROOTS) {
      await walk(root);
    }
    // 루트 직하 사이드카 json(favorites/bookmarks/trash/… 무변경 대상)
    try {
      const rootStats = await backend.listFilesWithStats('');
      for (const s of rootStats) {
        if (s.name.endsWith('.json')) out.push({ name: s.name, path: s.name });
      }
    } catch (e) {}
    return out;
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
      const key = ledgerKey(raw.folder, raw.name);

      try {
        let led = ledger.projects[key];
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
            moveImages: plan.moveImages,
            state: 'pending',
            roots: {},
          };
          ledger.projects[key] = led;
        }
        if (led.state === 'done') continue; // 이미 완료(재개)
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
      }
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
      await backend.renameFile(oldJson, newJson);
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

  // json 을 가볍게 파싱해 id 필드만 확인(전체 Session 로드 금지). 파싱 실패=스킵 신호.
  private async readJsonIdOrSkip(
    raw: RawProjectEntry,
  ): Promise<{ skip: boolean; id?: string }> {
    const base = projectJsonPath(raw.name, raw.folder || undefined);
    const p = raw.deleted ? base.replace(/\.json$/, '.deleted') : base;
    try {
      const parsed = JSON.parse(await backend.readFile(p));
      const id =
        parsed && typeof parsed.id === 'string' && parsed.id
          ? parsed.id
          : undefined;
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
    return { entries, folders };
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
