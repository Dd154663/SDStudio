import { observable, makeObservable, runInAction } from 'mobx';
import { persistService } from './PersistenceService';
import {
  backend,
  sessionService,
  trashService,
  projectTemplateService,
} from '.';
import { getAppState } from './appStateRef';
import { nameErrorMessage, projectNameRules, promptName } from './nameInput';
import { Session, genericSceneFromJSON } from './types';
import type { GenericScene } from './types';
import { stringifyExportJson } from './jsonExport';
import type { ProjectTemplateEntrySnapshot } from './ProjectTemplateService';
import { askImportPolicy, notifyImportDone } from './importFlow';
import { GlobalStoreBlockedError, StoreFile, GLOBAL_STORE_SYNC_KEYS } from './storeFile';
import { canonicalJson, mergeByKey, mergeStringSet } from './storeMerge';
import { globalStoreDeps } from './globalStoreDeps';
import {
  sanitizeProjectApplications,
  type ProjectTemplateTrashPart,
} from './templateTrashPart';
import {
  planFullBackupTemplates,
  type FullBackupIncomingProject,
  type FullBackupRestoreMode,
  type FullBackupTemplatePlanCounts,
  type PreOverwriteDesignation,
} from './fullBackupTemplatePlan';

/** 씬 템플릿 지정 목록 파일 이름(데이터 루트 직하) — 전체 백업이 같은 이름으로 담는다(2026-11-18 T1) */
export const TEMPLATES_SIDECAR_FILE = 'templates.json';
const SIDECAR_PATH = TEMPLATES_SIDECAR_FILE;
// 사용자 안내용 이름(storeFile 알림)
const TEMPLATES_STORE_LABEL = '템플릿 지정 목록';

/** 고아 숨김 자동 해제 안내(2026-11-18 T5) — 이름은 몇 개만 보인다 */
export const TEMPLATE_STORE_TEXT = {
  hiddenReleased: (names: string[]) => {
    const shown = names.slice(0, 3).map((n) => `"${n}"`).join(', ');
    const more = names.length > 3 ? ` 외 ${names.length - 3}개` : '';
    return `숨겨져 있던 프로젝트 ${names.length}개를 다시 표시했습니다 — ${shown}${more}`;
  },
} as const;

/**
 * 전체 백업 복원의 씬 템플릿 지정 반영 결과(restoreFromFullBackup).
 * none = 반영할 것이 없음 · blocked = 지정 목록이 막혀 건너뜀(아무것도 쓰지 않음) · applied = 반영·저장함
 */
export type FullBackupTemplatesOutcome =
  | { kind: 'none' }
  | { kind: 'blocked' }
  | { kind: 'applied'; counts: FullBackupTemplatePlanCounts };

// 폴더 기본 템플릿 지정 (프로젝트 상속 v2, 2026-07-16 합의).
// templateId = ProjectTemplateService 엔티티 id (불변 — 이름변경 캐스케이드 불필요).
export interface IFolderTemplateEntry {
  templateId: string;
}

/** 폴더 삭제 되돌리기용 템플릿 스냅숏(snapshotFolderTemplates) — 메모리에만 둔다 */
export interface FolderTemplateSnapshot {
  assignments: { folder: string; templateId: string }[];
  locals: ProjectTemplateEntrySnapshot[];
  applications: { project: string; templateId: string; record: ITemplateApplicationRecord }[];
}

// 템플릿 적용 기록 (프로젝트 상속 마감, 2026-07-16 합의).
//
// 프리셋 직렬화가 스키마 기반이라 프리셋 JSON에 출처 마킹을 심을 수 없어
// (WorkFlow materializeWFObj 는 params 키만 직렬화), 마킹은 사이드카의 이 필드에
// 둔다. 하나로 ♟배지(inherited=true)·상속 끊기·전파 대상 조회·교체 의미론을 해결.
//  - inherited: true = 폴더 자동 상속(♟ 배지·전파 대상)
//  - presets/characterPresetNames: 이 적용이 세션에 만든 프리셋/캐릭터 인스턴스
//  - vibePaths/referencePaths: presetShareds 에 주입한 바이브/캐릭터 레퍼런스 path
//  - protectAreas: 재적용·전파 시 제거도 추가도 하지 않는 보호 영역 (일괄 생성
//    R2 스펙 6항 — 축으로 적용된 캐릭터 프리셋/씬 보호). 옵셔널 = 구버전 호환.
export type TemplateProtectArea = 'characterPresets' | 'scenes';
export interface ITemplateApplicationRecord {
  inherited: boolean;
  presets: { type: string; name: string }[];
  characterPresetNames: string[];
  vibePaths: string[];
  referencePaths: string[];
  protectAreas?: TemplateProtectArea[];
}

/**
 * importSceneTemplate 결과(2026-11-04 되돌리기 2차 묶음 5) — 호출부가 sceneImportUndo.recordSceneTemplateImport 로 기록한다.
 * added = 세션에 들어간 씬 객체(들어간 순서), trashed = 덮어쓰기로 휴지통에 보낸 기존 씬(휴지통 슬롯·직전 이름·자리).
 */
export interface SceneTemplateImportResult {
  template: string;
  names: string[];
  added: GenericScene[];
  trashed: { scene: GenericScene; info: { slot: string; name: string; index: number } }[];
}

/** templates.json 을 해석한 메모리 형태(parseTemplatesSidecar 결과) */
export interface TemplatesSidecarData {
  sceneNames: string[];
  hiddenNames: string[];
  quickGenName: string | null;
  folderTemplates: Record<string, IFolderTemplateEntry>;
  templateApplications: Record<string, Record<string, ITemplateApplicationRecord>>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
// 필드가 아예 없거나 null = 구버전·빈 값(정상). 있는데 형식이 다르면 손상
const absent = (v: unknown) => v === undefined || v === null;

// 적용 기록 로드 방어: 형식이 어긋난 항목은 걸러내고 필드 기본값을 채운다
// (구버전 데이터는 이 필드가 없어 빈 객체 → 무해).
function sanitizeApplications(
  raw: unknown,
): Record<string, Record<string, ITemplateApplicationRecord>> {
  const out: Record<string, Record<string, ITemplateApplicationRecord>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [project, byTpl] of Object.entries(raw as any)) {
    if (!project || !byTpl || typeof byTpl !== 'object') continue;
    // 한 프로젝트 몫의 규칙은 휴지통 스냅숏(templateTrashPart)과 같은 함수 — 2026-11-18 T2
    const inner = sanitizeProjectApplications(byTpl);
    if (Object.keys(inner).length > 0) out[project] = inner;
  }
  return out;
}

/**
 * templates.json 원문 → 메모리 형태. 손상이면 null(StoreFile 이 손상본 보존 → 사본 복구 → 안내로 처리한다 — .tmp·.bak* 후보에도
 * 같은 규칙이 쓰인다). 손상 = JSON 이 아님·최상위가 객체가 아님·**있는 필드의 형식이 다름**(sceneTemplates/hiddenSceneTemplates 가
 * 배열이 아님, quickGenProject 가 문자열이 아님, folderTemplates/templateApplications 가 객체가 아님). 필드가 없거나 null 인 구버전
 * 파일은 정상(빈 값). 배열·객체 안의 개별 항목이 어긋난 것은 종전대로 항목 단위로 걸러 낸다. (구) templates 필드는 무시.
 * 해석 중 예외도 손상으로 본다(StoreFile 의 parse throw = 손상).
 */
export function parseTemplatesSidecar(text: string): TemplatesSidecarData | null {
  const raw: any = JSON.parse(text);
  if (!isPlainObject(raw)) return null;
  const st = raw.sceneTemplates;
  const hs = raw.hiddenSceneTemplates;
  const qg = raw.quickGenProject;
  const ftRaw = raw.folderTemplates;
  const taRaw = raw.templateApplications;
  if (!absent(st) && !Array.isArray(st)) return null;
  if (!absent(hs) && !Array.isArray(hs)) return null;
  if (!absent(qg) && typeof qg !== 'string') return null;
  if (!absent(ftRaw) && !isPlainObject(ftRaw)) return null;
  if (!absent(taRaw) && !isPlainObject(taRaw)) return null;
  const ft: Record<string, IFolderTemplateEntry> = {};
  if (isPlainObject(ftRaw)) {
    for (const [folder, entry] of Object.entries(ftRaw)) {
      if (folder && entry && typeof (entry as any).templateId === 'string') {
        ft[folder] = { templateId: (entry as any).templateId };
      }
    }
  }
  return {
    sceneNames: Array.isArray(st) ? st.filter((n: unknown) => typeof n === 'string') : [],
    hiddenNames: Array.isArray(hs) ? hs.filter((n: unknown) => typeof n === 'string') : [],
    quickGenName: typeof qg === 'string' && qg ? qg : null,
    folderTemplates: ft,
    templateApplications: sanitizeApplications(taRaw),
  };
}

/** 사본 회전 기준 항목 수(0 이면 그 내용으로 .bak1 을 만들지 않는다) */
export function countTemplatesSidecarItems(d: TemplatesSidecarData): number {
  return (
    d.sceneNames.length +
    d.hiddenNames.length +
    Object.keys(d.folderTemplates).length +
    Object.keys(d.templateApplications).length +
    (d.quickGenName ? 1 : 0)
  );
}

const EMPTY_TEMPLATES_SIDECAR: TemplatesSidecarData = {
  sceneNames: [],
  hiddenNames: [],
  quickGenName: null,
  folderTemplates: {},
  templateApplications: {},
};

/**
 * 여러 창 동기화(2026-11-18 T4)의 필드별 3방향 병합 — 이 창에 저장 안 된 변경(local)이 있을 때만 쓴다. 순수 함수.
 * base = 이 창이 마지막으로 읽었거나 쓴 내용(null = 빈 목록), remote = 다른 창이 방금 저장한 내용.
 *  - 지정·숨김: mergeStringSet / 폴더 기본 템플릿: 폴더 키 단위 / 적용 기록: 프로젝트 키 단위(한 프로젝트의 기록 묶음 = 한 항목)
 *  - 퀵 생성 이름: 이 창이 기준에서 바꿨으면 이 창 값, 아니면 다른 창 값
 *  - 결과에 고아 숨김(숨김에만 있고 지정도 퀵 생성도 아님)이 남으면 숨김에서 뺀다(덜 숨기는 쪽 — 어디에도 안 보이는 프로젝트 방지).
 *    예: 이 창은 퀵 생성 이름을 바꾸고 다른 창은 옛 퀵 생성 이름을 숨김에 둔 경우. 병합 결과는 어차피 저장되므로 함께 나간다.
 */
export function mergeTemplatesSidecar(
  base: TemplatesSidecarData | null,
  local: TemplatesSidecarData,
  remote: TemplatesSidecarData,
): TemplatesSidecarData {
  const b = base ?? EMPTY_TEMPLATES_SIDECAR;
  const sceneNames = mergeStringSet(b.sceneNames, local.sceneNames, remote.sceneNames);
  let hiddenNames = mergeStringSet(b.hiddenNames, local.hiddenNames, remote.hiddenNames);
  const quickGenName =
    local.quickGenName !== b.quickGenName ? local.quickGenName : remote.quickGenName;
  hiddenNames = hiddenNames.filter((n) => sceneNames.includes(n) || n === quickGenName);
  return {
    sceneNames,
    hiddenNames,
    quickGenName,
    folderTemplates: mergeByKey(b.folderTemplates, local.folderTemplates, remote.folderTemplates),
    templateApplications: mergeByKey(
      b.templateApplications,
      local.templateApplications,
      remote.templateApplications,
    ),
  };
}

/**
 * 템플릿 관련 사이드카(templates.json) 관리
 *
 * - 씬 템플릿: "이미지 없는 일반 프로젝트"를 씬 묶음 템플릿으로 지정한 목록
 *   (sceneTemplates 필드). 프로젝트 상속 v2 의 "씬 프리셋" 소스이기도 하다.
 * - 폴더 기본 템플릿: 폴더 경로 → 프로젝트 템플릿(ProjectTemplateService) id.
 *   해당 폴더(하위 포함)에서 새 프로젝트 생성 시 자동 적용된다.
 * - (구) '프로젝트를 템플릿으로 지정'(templates 필드)은 프로젝트 상속 v2 에서
 *   폐기 — 로드 시 무시한다. 구버전은 이 파일의 미지 필드를 몰라도 무해
 *   (feedback_data_migration).
 * - 시작 시 로드 없음 — 사용처에서 ensureLoaded 지연 로드 (ProjectSizeService 패턴).
 */
export class TemplateService {
  // 씬 템플릿 지정 목록 — "이미지 없는 일반 프로젝트"를 씬 묶음 템플릿으로
  // 지정한 것. 같은 사이드카의 sceneTemplates 필드에 저장(필드 추가 = 호환 안전).
  @observable accessor sceneNames: string[] = [];
  // 숨김 프로젝트 목록 — 씬 템플릿 개편(2026-07-18 합의): 템플릿은
  // 별도 숨김 프로젝트로 분리해 일반 프로젝트 목록(사이드바·드로어·브라우저·
  // 프로젝트 선택)에서 제외한다. 같은 사이드카의 hiddenSceneTemplates 필드
  // (필드 추가 = 호환 안전 — 구버전은 이 필드를 몰라 숨김만 풀릴 뿐 무해).
  // 씬 템플릿(⊆ sceneNames) 외에 퀵 생성 전용 프로젝트(quickGenName)도 포함한다.
  @observable accessor hiddenNames: string[] = [];
  // 퀵 생성 전용 프로젝트 이름 (퀵 생성 개편, 2026-07-18 합의) — 퀵 생성 탭이
  // 어느 프로젝트에서 열려도 항상 이 숨김 프로젝트의 씬/출력 폴더를 사용한다.
  // 같은 사이드카의 quickGenProject 필드(필드 추가 = 호환 안전).
  @observable accessor quickGenName: string | null = null;
  // 폴더 기본 템플릿: 폴더 경로 → 템플릿 지정. 같은 사이드카의 folderTemplates
  // 필드(필드 추가 = 호환 안전 — 구버전은 이 필드를 몰라도 무해).
  @observable accessor folderTemplates: Record<string, IFolderTemplateEntry> =
    {};
  // 템플릿 적용 기록: 프로젝트 이름 → (템플릿 id → 적용 기록). 같은 사이드카의
  // templateApplications 필드(필드 추가 = 호환 안전). 키=프로젝트 이름(기존
  // 사이드카 관례) — rename/delete 캐스케이드에 편승한다.
  @observable accessor templateApplications: Record<
    string,
    Record<string, ITemplateApplicationRecord>
  > = {};

  // 지정 목록을 정상으로 읽었는가(ok·missing·recovered·corrupt-empty). false = 아직 안 읽음 또는 읽기 실패(차단)
  private loaded = false;
  // 동시에 여러 곳이 ensureLoaded 를 불러도 한 번만 읽는다(두 번째 읽기가 그 사이의 변경을 디스크 내용으로 되돌리지 않게)
  private loading: Promise<void> | null = null;
  /**
   * 목록을 믿을 수 없어 변경이 막힌 상태(읽기 실패 또는 「없음」 뒤 쓰기 충돌) — 씬 템플릿 관리 창의 안내용 observable 사본.
   * 진실은 store.loadFailed(StoreFile)이고, 로드·저장·쓰기 확인 뒤에 맞춘다.
   */
  @observable accessor listUnavailable = false;

  // 로드 판정·저장·사본 회전·쓰기 충돌 차단(storeFile.ts 단일 출처, 2026-11-18 T3). 파일 형식은 종전 그대로.
  // 저장은 변경마다 즉시(saveNowOrThrow) — Android 는 종료 훅이 없어 디바운스하지 않는다. 실패하면 dirty 가 남아
  // 종료·백그라운드 전환 flush(bootstrap flushGlobalStoresNow)가 다시 시도한다.
  private store = new StoreFile<TemplatesSidecarData>(
    {
      file: SIDECAR_PATH,
      label: TEMPLATES_STORE_LABEL,
      parse: parseTemplatesSidecar,
      countItems: countTemplatesSidecarItems,
      serialize: () => this.serialize(),
      // 디바운스 저장(schedule)은 쓰지 않는다 — StoreFile 내부 경로용 값
      saveDelayMs: 1000,
      // 여러 창 동기화(2026-11-18 T4): 저장 성공 뒤 다른 창이 다시 읽게 알린다(bootstrap 수신부 → reloadExternal).
      // 보낸 창은 main 이 제외한다. Android 는 창이 하나라 기본 구현이 no-op.
      afterWrite: () => {
        try {
          backend.notifyGlobalStoreChanged(GLOBAL_STORE_SYNC_KEYS.sceneTemplates).catch(() => {});
        } catch {
          /* 알림 없는 backend(테스트 목 등) — 저장 자체는 끝났다 */
        }
      },
    },
    globalStoreDeps,
  );

  constructor() {
    makeObservable(this);
  }

  /** 파일을 읽지 못했거나 쓰기 충돌로 저장·변경이 막힌 상태 */
  get loadFailed(): boolean {
    return this.store.loadFailed;
  }

  /** 사용자 안내용 저장소 이름(storeFile 알림과 같은 값) */
  get storeLabel(): string {
    return TEMPLATES_STORE_LABEL;
  }

  private syncBlocked(): void {
    const v = this.store.loadFailed;
    if (this.listUnavailable !== v) {
      runInAction(() => {
        this.listUnavailable = v;
      });
    }
  }

  private serialize(): string {
    return JSON.stringify({
      version: 1,
      sceneTemplates: this.sceneNames,
      hiddenSceneTemplates: this.hiddenNames,
      folderTemplates: this.folderTemplates,
      templateApplications: this.templateApplications,
      // null 이면 JSON.stringify 가 필드를 남기므로 undefined 로 생략
      quickGenProject: this.quickGenName ?? undefined,
    });
  }

  // 읽기 전이면 읽는다. 읽기 실패로 막힌 상태에서는 다시 읽지 않는다(재시도 지연이 잦은 호출부마다 붙지 않게) —
  // 다시 읽기는 관련 화면 진입 때 reloadIfFailed() 로만.
  async ensureLoaded(): Promise<void> {
    if (this.loaded || this.store.loadFailed) return;
    await this.load();
  }

  /** 읽기 실패로 막혀 있으면 한 번 다시 읽는다(씬 템플릿 관리·폴더 기본 템플릿 창·퀵 생성 진입 때). 성공하면 차단이 풀린다 */
  async reloadIfFailed(): Promise<void> {
    if (this.store.loadFailed) await this.load();
  }

  /** 지금 메모리 내용(병합의 local·되돌리기 비교용) */
  private currentData(): TemplatesSidecarData {
    return {
      sceneNames: this.sceneNames,
      hiddenNames: this.hiddenNames,
      quickGenName: this.quickGenName,
      folderTemplates: this.folderTemplates,
      templateApplications: this.templateApplications,
    };
  }

  private applyData(d: TemplatesSidecarData): void {
    runInAction(() => {
      this.sceneNames = d.sceneNames;
      this.hiddenNames = d.hiddenNames;
      this.quickGenName = d.quickGenName;
      this.folderTemplates = d.folderTemplates;
      this.templateApplications = d.templateApplications;
    });
  }

  /**
   * 다른 창이 templates.json 을 저장했다는 알림으로 다시 읽는다(데스크톱 여러 창, 2026-11-18 T4 — 글로벌 저장소 묶음 2 와 같은 방식).
   *  - 아직 읽지 않았으면 무동작(다음 ensureLoaded 가 최신본을 읽는다). 읽기 실패로 막힌 상태는 StoreFile 이 건너뛴다(reloadIfFailed 몫).
   *  - 저장 안 된 변경이 없으면 디스크 내용으로 교체(즉시 저장 구조라 대부분 이 경로). **디스크에 쓰지 않는다** — 고아 숨김 자동 해제도
   *    하지 않는다(알림 왕복 방지, 해제는 정상 로드에서만).
   *  - 있으면(직전 저장 실패로 dirty) 필드별 3방향 병합(mergeTemplatesSidecar) — 저장 예약은 StoreFile 이 한다.
   *  - 신규(없음) 상태였던 창은 여기서 파일을 읽어 정상 상태가 된다(다음 저장이 쓰기 충돌 차단에 걸리지 않음).
   * 반영은 저장 줄 안의 동기 콜백 — 그 사이에 변경 메서드가 끼어들지 않는다.
   */
  async reloadExternal(): Promise<void> {
    if (this.loading) {
      try {
        await this.loading;
      } catch {
        /* 로드 실패는 load 경로가 처리 */
      }
    }
    if (!this.loaded) return;
    await this.store.reloadExternal({
      replace: (remote) => this.applyData(remote),
      merge: (remote, base) => this.applyData(mergeTemplatesSidecar(base, this.currentData(), remote)),
    });
    this.syncBlocked();
  }

  private load(): Promise<void> {
    if (!this.loading) {
      this.loading = this.doLoad().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  // 판정 규칙은 storeFile(§13-3): 「없음」은 확실할 때만, 읽기 실패는 짧게 재시도 후 차단(안내 창), 손상(형식 불일치 포함 —
  // parseTemplatesSidecar)은 `.corrupt-<시각>` 보존 → 사본(.tmp·.bak1~3·.bak)에서 되살려 본 파일에 되돌려 씀(직전 재확인) →
  // 없으면 빈 목록. 안내는 StoreFile 이 알림 허브로 낸다.
  private async doLoad(): Promise<void> {
    const res = await this.store.load();
    this.syncBlocked();
    if (res.keepMemory) return; // 쓰기 충돌 뒤 다시 읽기 실패 등 — 이미 가진 목록 유지
    if (res.kind === 'io-failed') {
      this.loaded = false; // 변경은 막히고 목록은 비어 보인다(관리 창은 「읽지 못했습니다」)
      return;
    }
    const d =
      res.kind === 'ok' || res.kind === 'recovered'
        ? res.data
        : {
            sceneNames: [],
            hiddenNames: [],
            quickGenName: null,
            folderTemplates: {},
            templateApplications: {},
          };
    runInAction(() => {
      this.sceneNames = d.sceneNames;
      this.hiddenNames = d.hiddenNames;
      this.quickGenName = d.quickGenName;
      this.folderTemplates = d.folderTemplates;
      this.templateApplications = d.templateApplications;
    });
    this.loaded = true;
    if (res.kind === 'ok') await this.releaseOrphanHidden();
  }

  /**
   * 고아 숨김 자동 해제(2026-11-18 사용자 결정 — 푸는 버튼 대신 감지하면 보이게). 정상(ok) 로드에서만 부른다.
   * 숨김 목록에 있지만 씬 템플릿 지정에도 없고 퀵 생성 프로젝트도 아닌 이름은 어디에도 보이지 않는다 → 숨김에서 빼 일반
   * 프로젝트로 보이게 하고 저장(1회). 숨김에 넣는 경로(designateHiddenTemplate·이관·퀵 생성)는 모두 지정과 함께 넣으므로
   * 정상 동작에서는 생기지 않는다. 프로젝트 파일 실존은 기준으로 쓰지 않는다(Android 권한 없음 = 오류 없이 안 보임).
   * 반대(지정에만 있고 숨김에 없음)는 이관 전 구형 씬 템플릿의 정상 상태라 건드리지 않는다.
   */
  private async releaseOrphanHidden(): Promise<void> {
    const orphans = this.hiddenNames.filter(
      (n) => !this.sceneNames.includes(n) && n !== this.quickGenName,
    );
    if (orphans.length === 0) return;
    runInAction(() => {
      this.hiddenNames = this.hiddenNames.filter((n) => !orphans.includes(n));
    });
    try {
      await this.save();
    } catch (e) {
      // 메모리에는 반영됨(보임) — dirty 가 남아 종료·백그라운드 전환 저장이 다시 시도한다
      console.error('templates.json 고아 숨김 해제 저장 실패:', e);
    }
    try {
      getAppState().pushMessage(TEMPLATE_STORE_TEXT.hiddenReleased(orphans));
    } catch (e) {
      console.warn('고아 숨김 해제 안내 실패:', e);
    }
  }

  /**
   * 지금 저장(변경마다 즉시 — 종전 방식). dirty 를 세운 뒤 쓴다: 실패해도 dirty 가 남아 flushSave 가 다시 시도한다.
   * 종전 계약: 쓰기 오류는 호출부로 던진다. 차단(읽기 실패·「없음」 뒤 쓰기 충돌)은 던지지 않는다 — 안내는 StoreFile 이
   * 했다(충돌 = 확인 창, 차단 = 토스트). 읽기 전·읽기 실패 상태에서는 아무것도 하지 않는다.
   */
  private async save(): Promise<void> {
    if (!this.loaded) return;
    this.store.markDirty();
    try {
      await this.store.saveNowOrThrow();
    } catch (e) {
      if (e instanceof GlobalStoreBlockedError) return;
      throw e;
    } finally {
      this.syncBlocked();
    }
  }

  /** 종료·백그라운드 전환 때 — 바뀐 것(저장 실패로 남은 dirty)이 있을 때만 쓴다 */
  async flushSave(): Promise<void> {
    await this.store.flush();
    this.syncBlocked();
  }

  /**
   * 변경 메서드 진입부: 읽기 전이면 읽고, 바꿀 수 있으면 true. 막혔으면 안내(토스트 — StoreFile 의 3초 간격 제한) 후 false.
   * 던지지 않는다(프로젝트 이름 변경·삭제·폴더 변경 뒤의 연쇄 호출이 본 작업을 깨지 않게 — 종전 「조용히 반환」 계약).
   */
  private async ready(): Promise<boolean> {
    await this.ensureLoaded();
    if (this.loaded && !this.store.loadFailed) return true;
    this.store.canWrite(); // 차단이면 안내
    return false;
  }

  /**
   * 되돌리기 어려운 작업(씬 템플릿·퀵 생성·폴더 기본 템플릿 엔티티 만들기 등) 직전 확인 — 지정을 저장할 수 없으면 만들기 전에
   * 멈춘다(종전: 프로젝트만 만들어지고 지정이 빠진 채 「만들어졌습니다」). 「없음」으로 시작했는데 지금 파일이 있으면 쓰기 충돌로
   * 막는다(StoreFile.confirmWritable — 아무것도 쓰지 않음). 막히면 안내 후 false.
   */
  async confirmWritable(): Promise<boolean> {
    if (!(await this.ready())) return false;
    const ok = await this.store.confirmWritable();
    this.syncBlocked();
    return ok;
  }

  isSceneTemplate(name: string): boolean {
    return this.sceneNames.includes(name);
  }

  // 숨김 프로젝트(=분리된 씬 템플릿) 판정 — 일반 프로젝트 목록 UI 가 제외 필터로
  // 사용한다. observable 이라 observer 컴포넌트는 로드 완료 시 자동 재렌더된다.
  isHiddenProject(name: string): boolean {
    return this.hiddenNames.includes(name);
  }

  // 프로젝트 이름 목록에서 숨김 템플릿을 제외한다 — 목록 표시 지점 공용 헬퍼.
  filterVisibleProjects(names: string[]): string[] {
    if (this.hiddenNames.length === 0) return names;
    return names.filter((n) => !this.hiddenNames.includes(n));
  }

  listSceneTemplates(): string[] {
    try {
      const existing = new Set(sessionService.list());
      return this.sceneNames.filter((n) => existing.has(n));
    } catch (e) {
      return [...this.sceneNames];
    }
  }

  async toggleSceneTemplate(name: string): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내 토스트(종전 같은 취지의 메시지)
    runInAction(() => {
      this.sceneNames = this.isSceneTemplate(name)
        ? this.sceneNames.filter((n) => n !== name)
        : [...this.sceneNames, name];
    });
    await this.save();
  }

  // ===== 폴더 기본 템플릿 (프로젝트 상속 안 A) =====

  getFolderTemplate(folder: string): IFolderTemplateEntry | undefined {
    return this.folderTemplates[folder];
  }

  // 폴더(+조상 폴더, 가까운 순) 에서 유효한 기본 템플릿을 찾는다.
  // 템플릿 엔티티가 사라진 stale 지정은 건너뛰고 더 위 조상을 계속 본다.
  async resolveFolderTemplate(
    folder: string | null,
  ): Promise<(IFolderTemplateEntry & { folder: string }) | undefined> {
    await this.ensureLoaded();
    if (!this.loaded) return undefined;
    try {
      await projectTemplateService.ensureLoaded();
    } catch (e) {
      return undefined;
    }
    let cur: string | null = folder;
    while (cur) {
      const entry = this.folderTemplates[cur];
      if (entry && projectTemplateService.get(entry.templateId)) {
        return { ...entry, folder: cur };
      }
      const idx = cur.lastIndexOf('/');
      cur = idx >= 0 ? cur.substring(0, idx) : null;
    }
    return undefined;
  }

  async setFolderTemplate(
    folder: string,
    templateId: string,
    opts?: { onlyIfEmpty?: boolean },
  ): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내 토스트(종전 같은 취지의 메시지)
    // 되돌리기 재부착(restoreFolderTemplates)은 비어 있는 폴더에만 — 판단을 ready() 의 await 뒤 현재 메모리로 한다
    // (그 사이 다른 창 저장 재로드로 들어온 지정을 덮지 않게, 2026-11-18 T4)
    if (opts?.onlyIfEmpty && this.folderTemplates[folder]) return;
    runInAction(() => {
      this.folderTemplates = {
        ...this.folderTemplates,
        [folder]: { templateId },
      };
    });
    await this.save();
  }

  // 템플릿 엔티티 삭제 시 해당 지정 일괄 해제 (ProjectTemplateService.delete 가 호출)
  async clearFolderTemplatesByTemplateId(templateId: string): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내만(던지지 않음)
    const keys = Object.keys(this.folderTemplates).filter(
      (f) => this.folderTemplates[f].templateId === templateId,
    );
    if (keys.length === 0) return;
    runInAction(() => {
      const next = { ...this.folderTemplates };
      for (const k of keys) delete next[k];
      this.folderTemplates = next;
    });
    await this.save();
  }

  async clearFolderTemplate(folder: string): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내 토스트(종전 같은 취지의 메시지)
    if (!this.folderTemplates[folder]) return;
    runInAction(() => {
      const next = { ...this.folderTemplates };
      delete next[folder];
      this.folderTemplates = next;
    });
    await this.save();
  }

  // ===== 템플릿 적용 기록 (프로젝트 상속 마감) =====

  getApplication(
    project: string,
    templateId: string,
  ): ITemplateApplicationRecord | undefined {
    return this.templateApplications[project]?.[templateId];
  }

  // inherited=true 인 적용 기록 1개 반환 (♟ 배지·상속 끊기 판정용).
  // 폴더 자동 상속은 프로젝트당 최대 1개이므로 첫 항목이면 충분.
  getInheritedApplication(
    project: string,
  ): (ITemplateApplicationRecord & { templateId: string }) | undefined {
    const byTpl = this.templateApplications[project];
    if (!byTpl) return undefined;
    for (const [templateId, rec] of Object.entries(byTpl)) {
      if (rec.inherited) return { ...rec, templateId };
    }
    return undefined;
  }

  async recordApplication(
    project: string,
    templateId: string,
    record: ITemplateApplicationRecord,
    opts?: { onlyIfEmpty?: boolean },
  ): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내만(던지지 않음)
    // setFolderTemplate 의 onlyIfEmpty 와 같은 취지(await 뒤 현재 메모리로 판단)
    if (opts?.onlyIfEmpty && this.templateApplications[project]?.[templateId]) return;
    runInAction(() => {
      const byTpl = { ...(this.templateApplications[project] ?? {}) };
      byTpl[templateId] = record;
      this.templateApplications = {
        ...this.templateApplications,
        [project]: byTpl,
      };
    });
    await this.save();
  }

  /**
   * 템플릿 재적용 되돌리기 전용(templateReapplyUndo) — (project, templateId) 적용 기록 하나를 record 로 되돌린다.
   * record 가 undefined 면 그 기록을 지운다(처음 적용을 되돌린 경우 — 그 프로젝트에 기록이 더 없으면 프로젝트 칸도 정리).
   * 막혔으면(읽기 실패·쓰기 충돌) 아무것도 바꾸지 않고 false. 쓰기 오류는 던진다(종전 save 계약).
   */
  async restoreApplication(
    project: string,
    templateId: string,
    record: ITemplateApplicationRecord | undefined,
  ): Promise<boolean> {
    if (!(await this.ready())) return false;
    runInAction(() => {
      const byTpl = { ...(this.templateApplications[project] ?? {}) };
      if (record) byTpl[templateId] = record;
      else delete byTpl[templateId];
      const next = { ...this.templateApplications };
      if (Object.keys(byTpl).length > 0) next[project] = byTpl;
      else delete next[project];
      this.templateApplications = next;
    });
    await this.save();
    return !this.store.loadFailed;
  }

  // 상속 끊기 — 이 프로젝트의 모든 적용 기록을 inherited=false 로 전환.
  // 이미 적용된 구성은 유지(전파·배지만 해제), 기록 자체는 남는다.
  async breakInheritance(project: string): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내만(던지지 않음)
    const byTpl = this.templateApplications[project];
    if (!byTpl) return;
    let changed = false;
    const next: Record<string, ITemplateApplicationRecord> = {};
    for (const [tplId, rec] of Object.entries(byTpl)) {
      if (rec.inherited) {
        next[tplId] = { ...rec, inherited: false };
        changed = true;
      } else {
        next[tplId] = rec;
      }
    }
    if (!changed) return;
    runInAction(() => {
      this.templateApplications = {
        ...this.templateApplications,
        [project]: next,
      };
    });
    await this.save();
  }

  // 이 템플릿을 참조하는 적용 기록이 하나라도 있는지 — 빈 폴더 템플릿의
  // 자동 삭제 가드용 (지우면 기록이 함께 정리돼 자식 ♟/보호가 사라진다).
  hasApplications(templateId: string): boolean {
    for (const byTpl of Object.values(this.templateApplications)) {
      if (byTpl[templateId]) return true;
    }
    return false;
  }

  // 이 템플릿을 상속 중(inherited=true)인 자식 프로젝트 이름 목록 — 전파 대상 조회.
  listInheritedChildren(templateId: string): string[] {
    const out: string[] = [];
    for (const [project, byTpl] of Object.entries(this.templateApplications)) {
      if (byTpl[templateId]?.inherited) out.push(project);
    }
    return out;
  }

  async removeApplicationsOfProject(project: string): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내만(던지지 않음)
    if (!this.templateApplications[project]) return;
    runInAction(() => {
      const next = { ...this.templateApplications };
      delete next[project];
      this.templateApplications = next;
    });
    await this.save();
  }

  async renameProjectApplications(
    oldName: string,
    newName: string,
  ): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내만(던지지 않음)
    if (!this.templateApplications[oldName]) return;
    runInAction(() => {
      const next = { ...this.templateApplications };
      next[newName] = next[oldName];
      delete next[oldName];
      this.templateApplications = next;
    });
    await this.save();
  }

  // 템플릿 엔티티 삭제 시 해당 템플릿의 적용 기록 일괄 해제
  // (ProjectTemplateService.delete 가 clearFolderTemplatesByTemplateId 옆에서 호출).
  async clearApplicationsByTemplateId(templateId: string): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내만(던지지 않음)
    let changed = false;
    const next: Record<
      string,
      Record<string, ITemplateApplicationRecord>
    > = {};
    for (const [project, byTpl] of Object.entries(this.templateApplications)) {
      if (byTpl[templateId]) {
        const inner = { ...byTpl };
        delete inner[templateId];
        changed = true;
        if (Object.keys(inner).length > 0) next[project] = inner;
      } else {
        next[project] = byTpl;
      }
    }
    if (!changed) return;
    runInAction(() => {
      this.templateApplications = next;
    });
    await this.save();
  }

  // 폴더 이름변경/삭제 연동 — SessionService.renameFolder/deleteFolder 가 호출.
  // (folderColors/folderOrder 이관과 같은 규칙: 정확 일치 + 하위 경로 프리픽스)
  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내만(던지지 않음)
    const oldPrefix = oldPath + '/';
    let changed = false;
    const next: Record<string, IFolderTemplateEntry> = {};
    for (const [folder, entry] of Object.entries(this.folderTemplates)) {
      let key = folder;
      if (folder === oldPath) key = newPath;
      else if (folder.startsWith(oldPrefix))
        key = newPath + folder.substring(oldPath.length);
      if (key !== folder) changed = true;
      next[key] = entry;
    }
    if (!changed) return;
    runInAction(() => {
      this.folderTemplates = next;
    });
    await this.save();
  }

  // 폴더 삭제 되돌리기용(2026-11-04 되돌리기 2차 묶음 3 P1-b, 사용자 결정 D7 ①) — removeFolder 가 지울 것을 미리 떠 둔다:
  // 폴더·하위 폴더의 기본 템플릿 지정, 그중 폴더 전용 로컬 템플릿 엔티티(이미지 포함), 그 엔티티의 적용 기록(♟ 상속 링크 —
  // ProjectTemplateService.delete 가 함께 지운다). 지정 저장소를 못 읽으면 빈 스냅숏(그때는 removeFolder 도 아무것도 지우지 않는다).
  async snapshotFolderTemplates(folder: string): Promise<FolderTemplateSnapshot> {
    const snap: FolderTemplateSnapshot = { assignments: [], locals: [], applications: [] };
    await this.ensureLoaded();
    if (!this.loaded) return snap;
    const prefix = folder + '/';
    for (const [f, entry] of Object.entries(this.folderTemplates)) {
      if (f === folder || f.startsWith(prefix)) {
        snap.assignments.push({ folder: f, templateId: entry.templateId });
      }
    }
    if (snap.assignments.length === 0) return snap;
    try {
      await projectTemplateService.ensureLoaded();
    } catch (e) {
      return snap;
    }
    const localIds = new Set<string>();
    for (const a of snap.assignments) {
      if (localIds.has(a.templateId)) continue;
      if (!projectTemplateService.get(a.templateId)?.folderLocal) continue;
      const s = await projectTemplateService.snapshotEntry(a.templateId);
      if (!s) continue;
      localIds.add(a.templateId);
      snap.locals.push(s);
    }
    for (const [project, byTpl] of Object.entries(this.templateApplications)) {
      for (const [templateId, record] of Object.entries(byTpl)) {
        if (localIds.has(templateId)) {
          snap.applications.push({ project, templateId, record: JSON.parse(JSON.stringify(record)) });
        }
      }
    }
    return snap;
  }

  /**
   * snapshotFolderTemplates 의 결과를 다시 붙인다 — 로컬 템플릿 재생성(같은 id) → 지정(비어 있는 폴더만) → 적용 기록(비어 있는 것만).
   * 이미 있는 것은 건드리지 않는다(여러 번 불러도 같다). 다시 붙이지 못한 폴더 지정 수를 돌려준다.
   */
  async restoreFolderTemplates(snap: FolderTemplateSnapshot): Promise<{ failed: number }> {
    let failed = 0;
    if (snap.assignments.length === 0) return { failed };
    if (!(await this.ready())) return { failed: snap.assignments.length };
    try {
      await projectTemplateService.ensureLoaded();
    } catch (e) {
      return { failed: snap.assignments.length };
    }
    for (const s of snap.locals) {
      try {
        await projectTemplateService.restoreEntry(s);
      } catch (e) {
        console.warn('폴더 전용 템플릿 재생성 실패:', s.entry.id, e);
      }
    }
    const folders = new Set(sessionService.listFolders());
    for (const a of snap.assignments) {
      if (this.folderTemplates[a.folder]) continue;
      if (!folders.has(a.folder) || !projectTemplateService.get(a.templateId)) {
        failed++;
        continue;
      }
      await this.setFolderTemplate(a.folder, a.templateId, { onlyIfEmpty: true });
    }
    for (const app of snap.applications) {
      if (this.templateApplications[app.project]?.[app.templateId]) continue;
      if (!projectTemplateService.get(app.templateId)) continue;
      await this.recordApplication(app.project, app.templateId, app.record, { onlyIfEmpty: true });
    }
    return { failed };
  }

  async removeFolder(folder: string): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내만(던지지 않음)
    const prefix = folder + '/';
    const keys = Object.keys(this.folderTemplates).filter(
      (f) => f === folder || f.startsWith(prefix),
    );
    if (keys.length === 0) return;
    const ids = new Set(keys.map((k) => this.folderTemplates[k].templateId));
    runInAction(() => {
      const next = { ...this.folderTemplates };
      for (const k of keys) delete next[k];
      this.folderTemplates = next;
    });
    await this.save();
    // 폴더 전용 로컬 템플릿 엔티티는 폴더와 함께 제거 (누수 방지 —
    // 전역 템플릿을 참조하는 구형 지정은 건드리지 않음)
    try {
      await projectTemplateService.ensureLoaded();
      for (const id of ids) {
        const ent = projectTemplateService.get(id);
        if (ent?.folderLocal) await projectTemplateService.delete(id);
      }
    } catch (e) {}
  }

  // 프로젝트 이름변경/삭제 연동 — SessionService.rename/delete 가 호출.
  // (사이드카 키 이관 — trash/project_sizes 와 같은 규칙, 트랙1 B2 참조)
  // 폴더 템플릿은 엔티티 id 참조라 프로젝트 이름과 무관 — 씬 템플릿만 이관.
  async renameProject(oldName: string, newName: string): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내만(던지지 않음)
    // 적용 기록 키 이관 (씬 템플릿 지정과 함께 편승)
    await this.renameProjectApplications(oldName, newName);
    // 퀵 생성 전용 프로젝트도 이관 대상 (sceneNames 밖이라 별도 판정)
    const isQuick = this.quickGenName === oldName;
    if (!this.isSceneTemplate(oldName) && !isQuick) return;
    runInAction(() => {
      this.sceneNames = this.sceneNames.map((n) =>
        n === oldName ? newName : n,
      );
      // 숨김 목록도 함께 이관 — 이관 누락 시 이름변경만으로 숨김이 풀린다
      this.hiddenNames = this.hiddenNames.map((n) =>
        n === oldName ? newName : n,
      );
      if (isQuick) this.quickGenName = newName;
    });
    await this.save();
  }

  async removeProject(name: string): Promise<void> {
    if (!(await this.ready())) return; // 막혔으면 안내만(던지지 않음)
    // 적용 기록 정리 (하드 삭제 시점). 2026-11-18 T2 부터 소프트 삭제는 지정·적용 기록을 휴지통 기록으로 옮기므로
    // (takeProjectForTrash 계열) 여기서 지울 것은 그 전에 지운 예전 휴지통 기록의 몫과, 지정 목록이 막혀 옮기지 못한 몫뿐이다.
    await this.removeApplicationsOfProject(name);
    const isQuick = this.quickGenName === name;
    if (!this.isSceneTemplate(name) && !isQuick) return;
    runInAction(() => {
      this.sceneNames = this.sceneNames.filter((n) => n !== name);
      this.hiddenNames = this.hiddenNames.filter((n) => n !== name);
      // 퀵 전용 프로젝트 하드 삭제 → 지정 해제 (다음 퀵 생성 시 새로 만든다)
      if (isQuick) this.quickGenName = null;
    });
    await this.save();
  }

  // ===== 휴지통 기록으로 옮기기 (2026-11-18 T2) =====
  //
  // 소프트 삭제(SessionService.delete)는 이 이름의 몫(씬 템플릿 지정·숨김·퀵 생성 지정·적용 기록)을 휴지통 기록의 사이드카
  // 스냅숏으로 옮긴다 — 같은 이름으로 새로 만든 프로젝트가 숨겨지거나 옛 적용 기록을 물려받지 않게, 새 이름으로 복원해도 템플릿으로
  // 돌아오게. 순서: captureProjectForTrash(읽기만) → 휴지통 기록 저장 → releaseProjectForTrash(templates.json 에서 빼기).
  // 복원은 restoreProjectFromTrash(최종 이름). 지정 목록이 막혔으면 옮기지 않는다(종전대로 templates.json 에 남음 — 두 벌 금지).

  /**
   * 소프트 삭제 직전 이 이름의 템플릿 몫(읽기 전용 — 쓰지 않는다). 지정 목록을 읽지 못했거나 막혔으면 null(옮기지 않는다),
   * 옮길 것이 없으면 undefined. 적용 기록은 사본(이후 메모리 변경과 분리).
   */
  async captureProjectForTrash(name: string): Promise<ProjectTemplateTrashPart | null | undefined> {
    await this.ensureLoaded();
    if (!this.loaded || this.store.loadFailed) return null;
    const part: ProjectTemplateTrashPart = {};
    if (this.sceneNames.includes(name)) part.sceneTemplate = true;
    if (this.quickGenName === name) part.quickGen = true;
    if ((part.sceneTemplate || part.quickGen) && this.hiddenNames.includes(name)) part.hidden = true;
    const apps = this.templateApplications[name];
    if (apps && Object.keys(apps).length > 0) {
      part.applications = JSON.parse(JSON.stringify(apps));
    }
    if (!part.sceneTemplate && !part.quickGen && !part.applications) return undefined;
    return part;
  }

  /**
   * 휴지통 기록에 실은 뒤 그 몫을 templates.json 에서 뺀다(저장 1회). 판단은 ready() 의 await 뒤 현재 메모리로 — 뜬 것만 뺀다
   * (그 사이 다른 창이 넣은 것은 스냅숏에 없으므로 남긴다). 단 숨김은 지정이 빠져 고아가 되면 함께 뺀다(덜 숨기는 쪽).
   * 막혔으면 안내 후 조용히 반환(지정은 templates.json 에도 남는다 — 복원은 같은 지정을 두 번 걸어도 무해). 쓰기 오류는 던진다
   * (메모리는 뺀 상태, dirty 가 남아 종료·백그라운드 전환 저장이 다시 시도).
   */
  async releaseProjectForTrash(name: string, part: ProjectTemplateTrashPart): Promise<void> {
    if (!(await this.ready())) return;
    const dropScene = !!part.sceneTemplate && this.sceneNames.includes(name);
    const dropQuick = !!part.quickGen && this.quickGenName === name;
    const nextScene = dropScene ? this.sceneNames.filter((n) => n !== name) : this.sceneNames;
    const nextQuick = dropQuick ? null : this.quickGenName;
    const stillDesignated = nextScene.includes(name) || nextQuick === name;
    const dropHidden = this.hiddenNames.includes(name) && !stillDesignated;
    const own = this.templateApplications[name];
    const appIds = own ? Object.keys(part.applications ?? {}).filter((id) => id in own) : [];
    if (!dropScene && !dropQuick && !dropHidden && appIds.length === 0) return;
    runInAction(() => {
      if (dropScene) this.sceneNames = nextScene;
      if (dropQuick) this.quickGenName = null;
      if (dropHidden) this.hiddenNames = this.hiddenNames.filter((n) => n !== name);
      if (appIds.length > 0) {
        const next = { ...this.templateApplications };
        const inner = { ...(next[name] ?? {}) };
        for (const id of appIds) delete inner[id];
        if (Object.keys(inner).length > 0) next[name] = inner;
        else delete next[name];
        this.templateApplications = next;
      }
    });
    await this.save();
  }

  /**
   * 휴지통 복원 뒤 템플릿 몫을 최종 이름(name)으로 되살린다(SessionService.applyProjectSidecar). 이미 있는 것은 건드리지 않는다
   * (여러 번 불러도 같다 — 지정이 templates.json 과 스냅숏 양쪽에 남은 경우 포함).
   *  - 씬 템플릿: 지정(+ 숨김이었으면 숨김). 지정만 있던 구형 상태는 그대로 지정만.
   *  - 퀵 생성: 지금 퀵 생성 지정이 비어 있을 때만 다시 지정하고 숨긴다(있으면 일반 프로젝트로 보이게 둔다).
   *  - 적용 기록: 그 이름에 기록이 하나도 없을 때만, 가리키는 프로젝트 템플릿이 실제로 있는 것만.
   * 반환 ok=false = 지정 목록이 막혀 되살리지 못함(저장 직전 쓰기 충돌 포함 — 넣은 값은 되돌린다) 또는 프로젝트 템플릿 목록을 읽지
   * 못해 적용 기록을 확인하지 못함. 쓰기 오류는 던진다(메모리에는 반영됨 — dirty 가 남아 다시 저장).
   */
  async restoreProjectFromTrash(
    name: string,
    part: ProjectTemplateTrashPart,
  ): Promise<{ ok: boolean }> {
    // 복원 = 사용자 명시 작업 — 읽기 실패로 막혀 있으면 한 번 다시 읽는다(스냅숏은 이미 휴지통 기록에서 꺼냈다)
    await this.reloadIfFailed();
    if (!(await this.ready())) return { ok: false };
    let appsUnverified = false;
    let apps: Record<string, ITemplateApplicationRecord> | undefined;
    if (part.applications && !this.templateApplications[name]) {
      try {
        await projectTemplateService.ensureLoaded();
        if (projectTemplateService.loadFailed) {
          appsUnverified = true;
        } else {
          const kept: Record<string, ITemplateApplicationRecord> = {};
          for (const [id, rec] of Object.entries(part.applications)) {
            if (projectTemplateService.get(id)) kept[id] = JSON.parse(JSON.stringify(rec));
          }
          if (Object.keys(kept).length > 0) apps = kept;
        }
      } catch (e) {
        appsUnverified = true; // 못 읽으면 연결하지 않는다(고아 참조 금지)
      }
    }
    // 이하 판단은 await 뒤 현재 메모리로
    const addScene = !!part.sceneTemplate && !this.sceneNames.includes(name);
    const setQuick = !!part.quickGen && this.quickGenName === null;
    const wantHidden = (!!part.sceneTemplate && !!part.hidden) || setQuick;
    const addHidden = wantHidden && !this.hiddenNames.includes(name);
    const addApps = !!apps && !this.templateApplications[name];
    if (!addScene && !setQuick && !addHidden && !addApps) return { ok: !appsUnverified };
    runInAction(() => {
      if (addScene) this.sceneNames = [...this.sceneNames, name];
      if (setQuick) this.quickGenName = name;
      if (addHidden) this.hiddenNames = [...this.hiddenNames, name];
      if (addApps) this.templateApplications = { ...this.templateApplications, [name]: apps! };
    });
    await this.save();
    if (this.store.loadFailed) {
      // 저장 직전 쓰기 충돌로 막혔다(안내는 StoreFile) — 보이는 것과 디스크가 어긋나지 않게 이 복원이 넣은 것만 되돌린다
      // (그 사이 다른 경로가 바꾼 값은 덮지 않는다 — restoreFromFullBackup 과 같은 취지)
      runInAction(() => {
        if (addScene) this.sceneNames = this.sceneNames.filter((n) => n !== name);
        if (setQuick && this.quickGenName === name) this.quickGenName = null;
        if (addHidden) this.hiddenNames = this.hiddenNames.filter((n) => n !== name);
        if (addApps && this.templateApplications[name] && canonicalJson(this.templateApplications[name]) === canonicalJson(apps)) {
          const next = { ...this.templateApplications };
          delete next[name];
          this.templateApplications = next;
        }
      });
      return { ok: false };
    }
    return { ok: !appsUnverified };
  }

  // ===== 전체 백업 복원 (2026-11-18 T1) =====

  /**
   * 덮어쓰기 직전 이 프로젝트의 지정 상태 — 지정 정보가 없는 예전 백업으로 덮어쓸 때 되살릴 값(읽기 전용, 쓰지 않음).
   * 지정 목록을 읽지 못했으면 null.
   */
  async designationOf(name: string): Promise<PreOverwriteDesignation | null> {
    await this.ensureLoaded();
    if (!this.loaded || this.store.loadFailed) return null;
    return {
      sceneTemplate: this.sceneNames.includes(name),
      hidden: this.hiddenNames.includes(name),
      quickGen: this.quickGenName === name,
    };
  }

  /**
   * 전체 백업의 지정 목록을 받는 쪽에 합친다 — 계획은 순수 함수(fullBackupTemplatePlan), 반영은 여기서 저장 1회.
   * backupText = 백업 `__settings__/templates.json` 원문(없으면 null — 예전 백업). 손상·형식 불일치면 지정 정보 없음으로 본다.
   * 받는 쪽 프로젝트·폴더·프로젝트 템플릿 id 는 호출 시점 값(프로젝트 템플릿 채택 뒤에 부른다).
   * 진입부는 ready()(막혔으면 안내 토스트 후 blocked — 아무것도 쓰지 않음). 반영할 것이 없으면 읽지도 않고 none.
   */
  async restoreFromFullBackup(input: {
    backupText: string | null;
    mode: FullBackupRestoreMode;
    incoming: FullBackupIncomingProject[];
    preOverwrite: Record<string, PreOverwriteDesignation>;
  }): Promise<FullBackupTemplatesOutcome> {
    let backup: TemplatesSidecarData | null = null;
    if (input.backupText !== null) {
      try {
        backup = parseTemplatesSidecar(input.backupText);
      } catch (e) {
        backup = null;
      }
      if (!backup) console.warn('전체 백업의 templates.json 을 읽지 못해 지정 정보 없이 복원합니다');
    }
    // 할 일이 없으면 지정 목록을 읽지도 않는다 — 백업에 지정 항목이 있거나, 예전 백업 덮어쓰기에서 되살릴 지정이 있을 때만
    const hasPre = Object.values(input.preOverwrite).some((p) => p.sceneTemplate || p.quickGen);
    const needsWork = backup ? countTemplatesSidecarItems(backup) > 0 : hasPre;
    if (!needsWork) return { kind: 'none' };
    if (!(await this.ready())) return { kind: 'blocked' };
    let templateIds: string[] = [];
    try {
      await projectTemplateService.ensureLoaded();
      if (!projectTemplateService.loadFailed) {
        templateIds = projectTemplateService.list().map((t) => t.id);
      }
    } catch (e) {
      templateIds = []; // 못 읽으면 폴더 기본 템플릿·적용 기록은 연결하지 않는다(고아 참조 금지)
    }
    const before: TemplatesSidecarData = {
      sceneNames: this.sceneNames,
      hiddenNames: this.hiddenNames,
      quickGenName: this.quickGenName,
      folderTemplates: this.folderTemplates,
      templateApplications: this.templateApplications,
    };
    const plan = planFullBackupTemplates({
      mode: input.mode,
      backup,
      current: before,
      incoming: input.incoming,
      preOverwrite: input.preOverwrite,
      existingProjects: sessionService.list(),
      existingFolders: sessionService.listFolders(),
      templateIds,
    });
    if (!plan.changed) return { kind: 'none' };
    runInAction(() => {
      this.sceneNames = plan.next.sceneNames;
      this.hiddenNames = plan.next.hiddenNames;
      this.quickGenName = plan.next.quickGenName;
      this.folderTemplates = plan.next.folderTemplates;
      this.templateApplications = plan.next.templateApplications;
    });
    try {
      await this.save();
    } catch (e) {
      // 메모리에는 반영됨 — dirty 가 남아 종료·백그라운드 전환 저장이 다시 시도한다
      console.error('전체 백업 복원: 씬 템플릿 지정 저장 실패(다시 시도 예정):', e);
    }
    if (this.store.loadFailed) {
      // 저장 직전 쓰기 충돌로 막혔다(다른 창이 파일을 만듦 등 — 안내는 StoreFile) — 보이는 것과 디스크가 어긋나지 않게 되돌린다.
      // 저장 await 사이에 다른 경로(다른 창 저장 재로드 등)가 바꾼 필드는 덮지 않는다 — 이 복원이 넣은 값 그대로인 필드만(2026-11-18 T4)
      // (observable 대입은 사본이 되므로 같은 객체 비교 대신 내용 비교)
      const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
      runInAction(() => {
        if (same(this.sceneNames, plan.next.sceneNames)) this.sceneNames = before.sceneNames;
        if (same(this.hiddenNames, plan.next.hiddenNames)) this.hiddenNames = before.hiddenNames;
        if (this.quickGenName === plan.next.quickGenName) this.quickGenName = before.quickGenName;
        if (same(this.folderTemplates, plan.next.folderTemplates)) {
          this.folderTemplates = before.folderTemplates;
        }
        if (same(this.templateApplications, plan.next.templateApplications)) {
          this.templateApplications = before.templateApplications;
        }
      });
      return { kind: 'blocked' };
    }
    return { kind: 'applied', counts: plan.counts };
  }

  // ===== 씬 템플릿 (여러 씬 묶음의 즉시 임포트) =====
  //
  // 씬 템플릿의 실체 = "이미지 없는 일반 프로젝트"(사용자 합의, 2026-07-07).
  // 개편(2026-07-18 합의): 템플릿 프로젝트는 **숨김**으로 분리해 일반 목록에서
  // 제외한다(원본 프로젝트와의 결합 해소). 관리 UI = SceneTemplateManager 모달
  // (select 다이얼로그 연쇄는 불편하다는 실기 피드백으로 폐기) — 씬 툴바 ⋯의
  // '씬 템플릿' 버튼·퀵 메뉴가 appState.sceneTemplateManagerOpen 으로 연다.
  // 수정은 템플릿을 열어 기존 씬 카드 UI 로 하면 되므로 전용 편집 화면이 없다.

  // 주어진 프로젝트의 씬 전체를 "이미지 없는 숨김 프로젝트"로 복제해 씬 템플릿으로
  // 지정. 기존 얕은 복제(exportSessionShallow → importSessionShallow)를 재사용한다.
  // 공개 메서드 — ⋯메뉴(현재 세션) 외에 드로어 행 액션('씬 템플릿으로 만들기')과
  // 관리 메뉴의 복제도 호출한다.
  // opts.initialName = 이름 칸 처음 값 — 관리 창 「복제」만 넘긴다(2026-11-14 M2 C9, 「X 복사본」 제안).
  // 「현재 씬 전체로 만들기」·드로어 「씬 템플릿으로 만들기」는 종전대로 빈 칸.
  async createSceneTemplate(
    session: Session,
    opts?: { initialName?: string },
  ): Promise<void> {
    const appState = getAppState();
    // 지정 목록을 저장할 수 없으면 이름을 묻기 전에 멈춘다(안내는 confirmWritable) — 종전엔 프로젝트만 만들어지고 지정이 빠졌다
    if (!(await this.confirmWritable())) return;
    // 씬 템플릿은 숨김 프로젝트 — 프로젝트와 같은 이름 규칙·중복 검사(창 안에서, D2)
    const name = await promptName({
      title: `씬 템플릿 이름 (예: ${session.name} 씬템플릿)`,
      ...projectNameRules(sessionService),
      ...(opts?.initialName ? { initial: opts.initialName } : {}),
    });
    if (!name) return;
    // 이름을 입력하는 사이에 막혔을 수 있다(다른 창이 파일을 만듦 등) — 만들기 직전에 한 번 더
    if (!(await this.confirmWritable())) return;
    try {
      const json = await sessionService.exportSessionShallow(session);
      await sessionService.importSessionShallow(json, name);
    } catch (e: any) {
      appState.pushMessage(
        nameErrorMessage(e, 'project', name, '씬 템플릿 생성에 실패했습니다.'),
        'error',
      );
      return;
    }
    if (!(await this.designateHiddenTemplate(name))) {
      appState.pushMessage(this.notDesignatedText(name), 'error');
      return;
    }
    appState.pushMessage(
      `씬 템플릿 "${name}"이(가) 만들어졌습니다. 씬 툴바 ⋯ → 씬 템플릿에서 관리할 수 있습니다.`,
    );
  }

  // 빈 씬 템플릿 새로 만들기 — 빈 숨김 프로젝트를 만들어 바로 열어준다
  // (처음부터 템플릿을 설계하는 흐름, 2026-07-18 합의).
  // 반환 = 만든 템플릿 이름(취소/실패=null) — 관리 모달이 성공 시 닫히도록.
  async createEmptySceneTemplate(): Promise<string | null> {
    const appState = getAppState();
    if (!(await this.confirmWritable())) return null; // createSceneTemplate 과 같은 사전 확인
    const name = await promptName({
      title: '빈 씬 템플릿 이름',
      ...projectNameRules(sessionService),
    });
    if (!name) return null;
    if (!(await this.confirmWritable())) return null;
    try {
      await sessionService.add(name);
    } catch (e: any) {
      appState.pushMessage(
        nameErrorMessage(e, 'project', name, '씬 템플릿 생성에 실패했습니다.'),
        'error',
      );
      return null;
    }
    const designated = await this.designateHiddenTemplate(name);
    const tpl = await sessionService.get(name);
    if (tpl) appState.curSession = tpl;
    if (!designated) {
      appState.pushMessage(this.notDesignatedText(name), 'error');
      return name;
    }
    appState.pushMessage(
      `빈 씬 템플릿 "${name}"을(를) 열었습니다. 씬을 추가해 구성해주세요.`,
    );
    return name;
  }

  // 이름을 씬 템플릿 + 숨김으로 지정한다 (생성/복제/이관 공용).
  // 반환 = 지정을 저장했는가(false = 막혀서 저장 못 함 — 프로젝트는 일반 프로젝트로 보인다). 쓰기 오류는 종전대로 던진다.
  private async designateHiddenTemplate(name: string): Promise<boolean> {
    if (!(await this.ready())) return false; // 막혔으면 안내만(던지지 않음)
    runInAction(() => {
      if (!this.sceneNames.includes(name))
        this.sceneNames = [...this.sceneNames, name];
      if (!this.hiddenNames.includes(name))
        this.hiddenNames = [...this.hiddenNames, name];
    });
    await this.save();
    return !this.store.loadFailed;
  }

  // 만들기 직전 확인을 통과했는데도 지정 저장이 막힌 드문 경우(그 사이 쓰기 충돌) — 「만들어졌습니다」 대신 사실대로 알린다
  private notDesignatedText(name: string): string {
    return `"${name}" 프로젝트는 만들었지만 템플릿 지정 목록을 저장하지 못해 일반 프로젝트로 보입니다.`;
  }

  // ── 파일 내보내기/불러오기 (PC↔모바일 크로스 작업 이동, 2026-07-18) ──
  // 실체가 숨김 프로젝트이므로 인앱 복제와 같은 얕은 직렬화(exportSessionShallow —
  // 이미지 제외·스타일 프로필 인라인)를 그대로 파일에 담는다. 캐릭터 프리셋의
  // 바이브/레퍼런스 이미지가 빠지는 것도 인앱 복제와 동일 의미론.

  // 반환 = 파일 내용 JSON 문자열 (실패 시 null — 메시지는 여기서 처리)
  async exportSceneTemplateFile(name: string): Promise<string | null> {
    const appState = getAppState();
    const tpl = await sessionService.get(name);
    if (!tpl) {
      appState.pushMessage('씬 템플릿 프로젝트를 불러올 수 없습니다.');
      return null;
    }
    const json = await sessionService.exportSessionShallow(tpl);
    return stringifyExportJson({
      version: 1,
      type: 'sdstudio-scene-template',
      name,
      session: json,
    });
  }

  // 파일 내용 → 새 숨김 템플릿 프로젝트 생성 + 지정. 반환 = 만든 이름(실패·건너뜀 null).
  // 같은 이름의 씬 템플릿이 있으면 공용 불러오기 흐름(드라이브 동기화 ② B3)으로
  // [새 이름으로 추가 / 건너뛰기]를 묻는다(덮어쓰기는 지원하지 않아 숨김).
  // 새 이름 규칙은 기존 `(2)` 그대로. 템플릿이 아닌 동명 프로젝트는 묻지 않고 `(2)`.
  async importSceneTemplateFile(text: string): Promise<string | null> {
    const appState = getAppState();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch (e) {
      appState.pushMessage('올바른 씬 템플릿 파일이 아닙니다.');
      return null;
    }
    if (
      data?.type !== 'sdstudio-scene-template' ||
      !data.session ||
      typeof data.session !== 'object'
    ) {
      appState.pushMessage('올바른 씬 템플릿 파일이 아닙니다.');
      return null;
    }
    // 지정 목록을 저장할 수 없으면 프로젝트를 만들기 전에 멈춘다(안내는 confirmWritable)
    if (!(await this.confirmWritable())) return null;
    // 프로젝트 이름은 경로 구성요소가 되므로 파일시스템 예약 문자를 제거하고,
    // 빈 이름은 기본값으로 대체 (데이터 루트 오삭제 방어와 같은 취지의 빈 이름 검증)
    const base =
      (typeof data.name === 'string' ? data.name : '')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .trim() || '가져온 씬 템플릿';
    const policy = await askImportPolicy({
      label: '씬 템플릿',
      conflictCount: this.listSceneTemplates().includes(base) ? 1 : 0,
      allow: { overwrite: false },
    });
    if (!policy) return null;
    if (policy === 'skip') {
      notifyImportDone('씬 템플릿', { added: 0, updated: 0, skipped: 1 });
      return null;
    }
    if (!(await this.confirmWritable())) return null; // 정책을 묻는 사이에 막혔을 수 있다
    let name = base;
    let i = 2;
    while (sessionService.list().includes(name)) {
      name = `${base} (${i})`;
      i++;
    }
    try {
      await sessionService.importSessionShallow(data.session, name);
    } catch (e: any) {
      appState.pushMessage(e?.message || '씬 템플릿 불러오기에 실패했습니다.');
      return null;
    }
    if (!(await this.designateHiddenTemplate(name))) {
      appState.pushMessage(this.notDesignatedText(name), 'error');
      return null;
    }
    notifyImportDone('씬 템플릿', {
      added: 1,
      updated: 0,
      skipped: 0,
      extra: `불러온 이름: ${name}`,
    });
    return name;
  }

  // ── 1회 이관 (씬 템플릿 개편, 2026-07-18 합의) ──
  // 기존에 "일반 프로젝트를 씬 템플릿으로 지정"해 둔 항목을, 복제본(숨김)으로
  // 분리하고 원본은 일반 프로젝트로 되돌린다(지정 해제). 부팅 완료 후 비차단으로
  // 생성 호스트(주) 창에서만 실행 — 보조 창과의 중복 이관을 피한다.
  // 이관 대상 판정 = sceneNames 중 숨김이 아닌 실존 프로젝트 (멱등 —
  // 이관 후에는 모든 템플릿이 숨김이라 재실행해도 no-op).
  async migrateSceneTemplatesToHidden(): Promise<void> {
    // 부팅 비차단 작업 — 막혔으면 조용히 건너뛴다(읽기 실패 안내 창이 이미 떴다)
    await this.ensureLoaded();
    if (!this.loaded || this.store.loadFailed) return;
    const pending = this.listSceneTemplates().filter(
      (n) => !this.hiddenNames.includes(n),
    );
    if (pending.length === 0) return;
    // 복제본 프로젝트를 만들기 전에 지정을 저장할 수 있는지 확인(못 하면 다음 부팅에 복제본이 또 생긴다)
    if (!(await this.confirmWritable())) return;
    const appState = getAppState();
    let migrated = 0;
    for (const name of pending) {
      // 앞 항목의 await 사이에 다른 창 저장 재로드로 지정이 풀렸거나 이미 숨김이 됐으면 건너뛴다(2026-11-18 T4 —
      // 처음에 뽑은 목록만 믿고 복제본을 만들지 않게)
      if (!this.sceneNames.includes(name) || this.hiddenNames.includes(name)) continue;
      try {
        const src = await sessionService.get(name);
        if (!src) continue;
        // 복제본 이름: "<원본> (템플릿)" + 필요 시 번호
        let cloneName = `${name} (템플릿)`;
        let i = 2;
        while (sessionService.list().includes(cloneName)) {
          cloneName = `${name} (템플릿 ${i})`;
          i++;
        }
        const json = await sessionService.exportSessionShallow(src);
        await sessionService.importSessionShallow(json, cloneName);
        runInAction(() => {
          this.sceneNames = [
            ...this.sceneNames.filter((n) => n !== name),
            cloneName,
          ];
          this.hiddenNames = [...this.hiddenNames, cloneName];
        });
        await this.save();
        // 그 사이 쓰기 충돌로 막혔으면 복제본을 더 만들지 않는다
        if (this.store.loadFailed) break;
        migrated++;
      } catch (e) {
        // 실패 항목은 지정을 유지 — 다음 부팅에서 재시도된다
        console.error(`씬 템플릿 "${name}" 숨김 이관 실패:`, e);
      }
    }
    if (migrated > 0) {
      appState.pushMessage(
        `씬 템플릿 ${migrated}개를 별도 템플릿(숨김)으로 분리했습니다. 원본 프로젝트는 일반 프로젝트로 유지됩니다.`,
      );
    }
  }

  // 씬 템플릿의 일반 씬 전체를 현재 프로젝트에 추가한다.
  // 충돌 정책(사용자 합의): 겹치는 씬이 있으면 덮어쓰기/번호 부여/건너뛰기 중 택1.
  // 덮어쓰기는 기존 씬을 moveSceneToTrash 경유로 제거한다 — 씬 제거 시 outs 폴더
  // .trash 이동 규칙(project_scene_loss_guard) 준수. 직접 Map 삭제 금지.
  // 공개 메서드 — 씬 툴바 ⋯메뉴 외에 순차 생성 설정 패널에서도 호출한다.
  // 반환 = SceneTemplateImportResult(names = 실제로 세션에 들어간 씬 이름 목록 — 추가+덮어쓰기, 최종 이름 기준).
  // 취소·실패 시 null (호출처가 자동 선택 등 후속을 건너뛰도록).
  // 되돌리기(2026-11-04 2차 묶음 5): 여기서는 기록하지 않는다(서비스 안 기록 금지 — SPEC 「되돌리기 계약」). 들어간 씬 객체·
  // 휴지통으로 보낸 기존 씬(슬롯·원래 이름·자리)을 돌려주고 호출부가 sceneImportUndo.recordSceneTemplateImport 로 1항목 기록한다.
  // templateName(2026-11-11 오버레이 묶음 1): 씬 템플릿 관리 창의 행 「프로젝트로 복사」처럼 템플릿을 이미 고른 호출부는
  // 이름을 넘겨 선택 창을 건너뛴다. 목록에 없는 이름(자기 자신·지워진 템플릿)이면 안내 후 null. 생략하면 종전처럼 고른다.
  async importSceneTemplate(
    session: Session,
    templateName?: string,
  ): Promise<SceneTemplateImportResult | null> {
    const appState = getAppState();
    await this.ensureLoaded();
    const templates = this.listSceneTemplates().filter(
      (n) => n !== session.name,
    );
    if (templates.length === 0) {
      appState.pushMessage(
        '프로젝트로 복사할 씬 템플릿이 없습니다. 먼저 "현재 씬 전체로 템플릿 만들기"로 템플릿을 만들어주세요.',
      );
      return null;
    }
    let tplName: string | null | undefined;
    if (templateName !== undefined) {
      if (!templates.includes(templateName)) {
        appState.pushMessage('이 씬 템플릿은 현재 프로젝트로 복사할 수 없습니다.');
        return null;
      }
      tplName = templateName;
    } else {
      tplName = await appState.pushDialogAsync({
        type: 'select',
        text: '프로젝트로 복사할 씬 템플릿을 선택해주세요',
        items: templates.map((n) => ({ text: n, value: n })),
      });
    }
    if (!tplName) return null;
    const tpl = await sessionService.get(tplName);
    if (!tpl) {
      appState.pushMessage('씬 템플릿 프로젝트를 불러올 수 없습니다.');
      return null;
    }
    const scenes = tpl.getScenes('scene');
    if (scenes.length === 0) {
      appState.pushMessage('이 템플릿에는 씬이 없습니다.');
      return null;
    }
    const conflicts = scenes.filter((s) => session.hasScene('scene', s.name));
    let policy = 'number';
    if (conflicts.length > 0) {
      const sel = await appState.pushDialogAsync({
        type: 'select',
        text: `이름이 겹치는 씬이 ${conflicts.length}개 있습니다. 어떻게 할까요?`,
        items: [
          { text: '번호를 붙여 모두 추가 (씬_1, 씬_2…)', value: 'number' },
          { text: '기존 씬을 덮어쓰기 (기존 씬은 휴지통으로)', value: 'overwrite', danger: true },
          { text: '겹치는 씬은 건너뛰기', value: 'skip' },
        ],
      });
      if (!sel) return null;
      policy = sel;
    }
    let added = 0;
    let replaced = 0;
    let skipped = 0;
    const importedNames: string[] = [];
    const addedScenes: GenericScene[] = [];
    const trashedScenes: SceneTemplateImportResult['trashed'] = [];
    const moveFailed: string[] = [];
    for (const src of scenes) {
      // 크로스 프로젝트 씬 복사 선례(AppContextMenu '설정만 복사') 재사용 —
      // 템플릿 프로젝트에서 생성된 이미지/토너먼트 흔적은 가져오지 않는다.
      const scene = genericSceneFromJSON(src.toJSON());
      if (!scene) continue;
      scene.imageMap = [];
      scene.mains = [];
      (scene as any).game = undefined;
      (scene as any).round = undefined;
      if (session.hasScene(scene.type, scene.name)) {
        if (policy === 'skip') {
          skipped++;
          continue;
        }
        if (policy === 'overwrite') {
          const old = session.getScene(scene.type, scene.name);
          // 기존 씬을 휴지통으로 옮기지 못하면(파일 잠금·다른 창 잠금) 덮어쓰지 않고 건너뛴다 —
          // 이동 실패 시 기존 씬은 그대로 남는다(2026-10-02 S1).
          if (old) {
            const oldName = old.name;
            const oldIndex = session.getScenes(old.type).indexOf(old);
            let slot: string | undefined;
            try {
              slot = await trashService.moveSceneToTrash(session, old);
            } catch (e) {
              console.error('씬 템플릿 덮어쓰기: 기존 씬 휴지통 이동 실패:', scene.name, e);
            }
            if (session.hasScene(scene.type, scene.name)) {
              moveFailed.push(scene.name);
              continue;
            }
            if (slot) trashedScenes.push({ scene: old, info: { slot, name: oldName, index: oldIndex } });
          }
          session.addScene(scene);
          replaced++;
          importedNames.push(scene.name);
          addedScenes.push(scene);
          continue;
        }
        // number: 기존 크로스 복사와 동일한 '_n' 접미 관례
        let cnt = 1;
        const base = scene.name;
        while (session.hasScene(scene.type, `${base}_${cnt}`)) cnt++;
        scene.name = `${base}_${cnt}`;
      }
      session.addScene(scene);
      added++;
      importedNames.push(scene.name);
      addedScenes.push(scene);
    }
    const parts = [`추가 ${added}개`];
    if (replaced) parts.push(`덮어쓰기 ${replaced}개`);
    if (skipped) parts.push(`건너뜀 ${skipped}개`);
    if (moveFailed.length) {
      parts.push(
        `기존 씬을 휴지통으로 옮기지 못해 건너뜀 ${moveFailed.length}개(${moveFailed.slice(0, 5).join(', ')}${moveFailed.length > 5 ? ' 외' : ''})`,
      );
    }
    appState.pushMessage(`씬 템플릿을 프로젝트로 복사했습니다 — ${parts.join(', ')}`);
    return { template: tplName, names: importedNames, added: addedScenes, trashed: trashedScenes };
  }

  // ===== 퀵 생성 전용 프로젝트 (퀵 생성 개편, 2026-07-18 합의) =====
  //
  // 퀵 생성 탭은 종전에 "열려 있는 프로젝트의 default 씬"을 재활용해 결과물이
  // 프로젝트마다 흩어졌다. 개편 후에는 전용 숨김 프로젝트 1개를 지정해 두고
  // 어느 프로젝트에서 접근해도 항상 이 프로젝트의 씬/출력 폴더(outs/<전용>/)를
  // 쓴다. 프롬프트/프리셋은 종전대로 현재 프로젝트 것을 사용(사용자 합의) —
  // 예약 경로는 sceneQueueActions.queueQuickScene 참조.
  // 씬 템플릿(sceneNames)에는 넣지 않아 템플릿 관리 모달에는 나타나지 않는다.

  // 전용 프로젝트를 확보해 반환한다 — 없거나 삭제됐으면 새로 만든다.
  async ensureQuickGenProject(): Promise<Session | null> {
    // 퀵 생성 탭 진입 = 명시적 진입점 — 읽기 실패로 막혀 있으면 여기서 한 번 다시 읽는다
    await this.reloadIfFailed();
    if (!(await this.ready())) return null; // 막혔으면 안내만(종전처럼 null)
    // 미지정이면 다른 창이 만든 지정을 먼저 흡수한다 — 다른 창 저장 알림(T4)이 늦게 오거나 놓친 경우의 중복 생성(「퀵 생성 (2)」)
    // 방지. 사이드카를 엿봐(읽기 전용) 퀵 생성 지정이 있을 때만 정식 외부 재로드(reloadExternal — 쓰지 않음)로 목록 전체를 받는다:
    // 종전처럼 이름만 받으면 숨김 목록이 낡아 아래 자가 치유 저장이 「없음」 상태에서 쓰기 충돌로 막히거나 다른 창 지정을 덮었다.
    // 지정이 없으면 종전대로(「없음」 오판 뒤에는 아래 confirmWritable 이 막는다).
    if (!this.quickGenName) {
      let diskHasQuick = false;
      try {
        const raw = JSON.parse(await backend.readFile(SIDECAR_PATH));
        diskHasQuick = typeof raw?.quickGenProject === 'string' && !!raw.quickGenProject;
      } catch (e) {}
      if (diskHasQuick) await this.reloadExternal();
    }
    let cur = this.quickGenName;
    // 지정된 프로젝트가 이 창의 목록에 없으면(다른 창이 방금 만든 프로젝트 — 프로젝트 목록은 창 사이에 자동 갱신되지 않는다)
    // 새로 만들기 전에 목록을 한 번 다시 읽는다. 기존 sessionService.update(flush + 목록 재스캔) 재사용.
    if (cur && !sessionService.list().includes(cur)) {
      try {
        await sessionService.update();
      } catch (e) {
        console.warn('퀵 생성: 프로젝트 목록 다시 읽기 실패:', e);
      }
      cur = this.quickGenName;
    }
    if (cur && sessionService.list().includes(cur)) {
      const s = await sessionService.get(cur);
      if (s) {
        // 자가 치유: 어떤 이유로 숨김이 풀렸으면 다시 숨긴다
        if (!this.hiddenNames.includes(cur)) {
          runInAction(() => {
            this.hiddenNames = [...this.hiddenNames, cur];
          });
          await this.save();
        }
        return s;
      }
    }
    // 새로 만들기 전에 지정을 저장할 수 있는지 확인 — 「없음」 오판(Android) 뒤 「퀵 생성 (2)」를 만들고 저장해
    // 본 파일(지정 전체)을 덮던 경로를 막는다(쓰기 충돌 차단 + 안내, 프로젝트는 만들지 않음)
    if (!(await this.confirmWritable())) return null;
    // 확인을 기다리는 사이 다른 창 저장 재로드로 쓸 수 있는 지정이 들어왔으면 그것을 쓴다(중복 생성 방지, 2026-11-18 T4)
    const arrived = this.quickGenName;
    if (arrived && arrived !== cur && sessionService.list().includes(arrived)) {
      const s = await sessionService.get(arrived);
      if (s) return s;
    }
    // 새로 생성 — 이름 충돌 시 번호 부여
    let name = '퀵 생성';
    let i = 2;
    while (sessionService.list().includes(name)) {
      name = `퀵 생성 (${i})`;
      i++;
    }
    try {
      await sessionService.add(name);
    } catch (e: any) {
      getAppState().pushMessage(
        e.message || '퀵 생성 전용 프로젝트 생성에 실패했습니다.',
      );
      return null;
    }
    runInAction(() => {
      // 반영 직전의 현재 값(add 의 await 사이 재로드로 바뀌었을 수 있다) — 판단 때 본 값(cur)과 함께 숨김을 푼다(덜 숨기는 쪽)
      const old = this.quickGenName;
      // 소프트 삭제된 옛 전용 프로젝트가 복원되면 접근 불가 숨김 고아가 되므로
      // 재지정 시점에 옛 이름의 숨김을 함께 푼다(복원 시 일반 프로젝트로 보임).
      this.hiddenNames = [
        ...this.hiddenNames.filter((n) => n !== old && n !== cur && n !== name),
        name,
      ];
      this.quickGenName = name;
    });
    await this.save();
    return (await sessionService.get(name)) ?? null;
  }

}
