import { observable, makeObservable, runInAction } from 'mobx';
import { persistService } from './PersistenceService';
import {
  backend,
  sessionService,
  trashService,
  projectTemplateService,
} from '.';
import { getAppState } from './appStateRef';
import { Session, genericSceneFromJSON } from './types';

const SIDECAR_PATH = 'templates.json';

// 폴더 기본 템플릿 지정 (프로젝트 상속 v2, 2026-07-16 합의).
// templateId = ProjectTemplateService 엔티티 id (불변 — 이름변경 캐스케이드 불필요).
export interface IFolderTemplateEntry {
  templateId: string;
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

  private loaded = false;
  // IO 오류(권한 등)로 로드가 실패하면 저장을 차단해 기존 지정 목록을
  // 빈 값으로 덮어쓰지 않는다 (trash.json 로드 실패 처리와 같은 취지).
  private loadFailed = false;

  constructor() {
    makeObservable(this);
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded || this.loadFailed) return;
    try {
      if (!(await backend.existFile(SIDECAR_PATH))) {
        this.loaded = true;
        return;
      }
      const raw = JSON.parse(await backend.readFile(SIDECAR_PATH));
      runInAction(() => {
        this.sceneNames = Array.isArray(raw?.sceneTemplates)
          ? raw.sceneTemplates.filter((n: unknown) => typeof n === 'string')
          : [];
        this.hiddenNames = Array.isArray(raw?.hiddenSceneTemplates)
          ? raw.hiddenSceneTemplates.filter(
              (n: unknown) => typeof n === 'string',
            )
          : [];
        this.quickGenName =
          typeof raw?.quickGenProject === 'string' && raw.quickGenProject
            ? raw.quickGenProject
            : null;
        const ft: Record<string, IFolderTemplateEntry> = {};
        if (raw?.folderTemplates && typeof raw.folderTemplates === 'object') {
          for (const [folder, entry] of Object.entries(raw.folderTemplates)) {
            if (
              typeof folder === 'string' &&
              folder &&
              entry &&
              typeof (entry as any).templateId === 'string'
            ) {
              ft[folder] = { templateId: (entry as any).templateId };
            }
          }
        }
        this.folderTemplates = ft;
        this.templateApplications = this.sanitizeApplications(
          raw?.templateApplications,
        );
      });
      this.loaded = true;
    } catch (e) {
      if (e instanceof SyntaxError) {
        // 파손 → 빈 목록으로 재시작 (지정만 잃음, 데이터 무손실)
        this.loaded = true;
        return;
      }
      this.loadFailed = true;
      console.error('templates.json 로드 실패(IO) — 템플릿 변경 차단:', e);
    }
  }

  private async save(): Promise<void> {
    if (!this.loaded) return; // 로드 실패 상태에서 저장 금지
    await persistService.write(
      SIDECAR_PATH,
      JSON.stringify({
        version: 1,
        sceneTemplates: this.sceneNames,
        hiddenSceneTemplates: this.hiddenNames,
        folderTemplates: this.folderTemplates,
        templateApplications: this.templateApplications,
        // null 이면 JSON.stringify 가 필드를 남기므로 undefined 로 생략
        quickGenProject: this.quickGenName ?? undefined,
      }),
    );
  }

  // 적용 기록 로드 방어: 형식이 어긋난 항목은 걸러내고 필드 기본값을 채운다
  // (구버전 데이터는 이 필드가 없어 빈 객체 → 무해).
  private sanitizeApplications(
    raw: unknown,
  ): Record<string, Record<string, ITemplateApplicationRecord>> {
    const out: Record<string, Record<string, ITemplateApplicationRecord>> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [project, byTpl] of Object.entries(raw as any)) {
      if (!project || !byTpl || typeof byTpl !== 'object') continue;
      const inner: Record<string, ITemplateApplicationRecord> = {};
      for (const [tplId, rec] of Object.entries(byTpl as any)) {
        if (!tplId || !rec || typeof rec !== 'object') continue;
        const r = rec as any;
        // 보호 영역: 알려진 값만 통과 (빈 배열이면 필드 생략)
        const protect = Array.isArray(r.protectAreas)
          ? (r.protectAreas.filter(
              (x: any) => x === 'characterPresets' || x === 'scenes',
            ) as TemplateProtectArea[])
          : [];
        inner[tplId] = {
          ...(protect.length > 0 ? { protectAreas: protect } : {}),
          inherited: !!r.inherited,
          presets: Array.isArray(r.presets)
            ? r.presets.filter(
                (p: any) =>
                  p &&
                  typeof p.type === 'string' &&
                  typeof p.name === 'string',
              )
            : [],
          characterPresetNames: Array.isArray(r.characterPresetNames)
            ? r.characterPresetNames.filter((n: any) => typeof n === 'string')
            : [],
          vibePaths: Array.isArray(r.vibePaths)
            ? r.vibePaths.filter((n: any) => typeof n === 'string')
            : [],
          referencePaths: Array.isArray(r.referencePaths)
            ? r.referencePaths.filter((n: any) => typeof n === 'string')
            : [],
        };
      }
      if (Object.keys(inner).length > 0) out[project] = inner;
    }
    return out;
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
    await this.ensureLoaded();
    if (!this.loaded) {
      getAppState().pushMessage('템플릿 목록을 불러오지 못해 변경할 수 없습니다.');
      return;
    }
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

  async setFolderTemplate(folder: string, templateId: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.loaded) {
      getAppState().pushMessage('템플릿 목록을 불러오지 못해 변경할 수 없습니다.');
      return;
    }
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
    await this.ensureLoaded();
    if (!this.loaded) return;
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
    await this.ensureLoaded();
    if (!this.loaded) {
      getAppState().pushMessage('템플릿 목록을 불러오지 못해 변경할 수 없습니다.');
      return;
    }
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
  ): Promise<void> {
    await this.ensureLoaded();
    if (!this.loaded) return;
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

  // 상속 끊기 — 이 프로젝트의 모든 적용 기록을 inherited=false 로 전환.
  // 이미 적용된 구성은 유지(전파·배지만 해제), 기록 자체는 남는다.
  async breakInheritance(project: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.loaded) return;
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
    await this.ensureLoaded();
    if (!this.loaded) return;
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
    await this.ensureLoaded();
    if (!this.loaded) return;
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
    await this.ensureLoaded();
    if (!this.loaded) return;
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
    await this.ensureLoaded();
    if (!this.loaded) return;
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

  async removeFolder(folder: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.loaded) return;
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
    await this.ensureLoaded();
    if (!this.loaded) return;
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
    await this.ensureLoaded();
    if (!this.loaded) return;
    // 적용 기록 정리 (하드 삭제 시점 — 씬 템플릿 지정과 동일 취지: 소프트
    // 삭제는 유지해 복원 시 되살아나고, 하드 삭제에서만 제거)
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
  async createSceneTemplate(session: Session): Promise<void> {
    const appState = getAppState();
    const name = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: `씬 템플릿 이름 (예: ${session.name} 씬템플릿)`,
    });
    if (!name) return;
    if (sessionService.list().includes(name)) {
      appState.pushMessage('같은 이름의 프로젝트가 이미 존재합니다.');
      return;
    }
    try {
      const json = await sessionService.exportSessionShallow(session);
      await sessionService.importSessionShallow(json, name);
    } catch (e: any) {
      appState.pushMessage(e.message || '씬 템플릿 생성에 실패했습니다.');
      return;
    }
    await this.designateHiddenTemplate(name);
    appState.pushMessage(
      `씬 템플릿 "${name}"이(가) 만들어졌습니다. 씬 툴바 ⋯ → 씬 템플릿에서 관리할 수 있습니다.`,
    );
  }

  // 빈 씬 템플릿 새로 만들기 — 빈 숨김 프로젝트를 만들어 바로 열어준다
  // (처음부터 템플릿을 설계하는 흐름, 2026-07-18 합의).
  // 반환 = 만든 템플릿 이름(취소/실패=null) — 관리 모달이 성공 시 닫히도록.
  async createEmptySceneTemplate(): Promise<string | null> {
    const appState = getAppState();
    const name = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: '빈 씬 템플릿 이름',
    });
    if (!name) return null;
    if (sessionService.list().includes(name)) {
      appState.pushMessage('같은 이름의 프로젝트가 이미 존재합니다.');
      return null;
    }
    try {
      await sessionService.add(name);
    } catch (e: any) {
      appState.pushMessage(e.message || '씬 템플릿 생성에 실패했습니다.');
      return null;
    }
    await this.designateHiddenTemplate(name);
    const tpl = await sessionService.get(name);
    if (tpl) appState.curSession = tpl;
    appState.pushMessage(
      `빈 씬 템플릿 "${name}"을(를) 열었습니다. 씬을 추가해 구성해주세요.`,
    );
    return name;
  }

  // 이름을 씬 템플릿 + 숨김으로 지정한다 (생성/복제/이관 공용).
  private async designateHiddenTemplate(name: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.loaded) return;
    runInAction(() => {
      if (!this.sceneNames.includes(name))
        this.sceneNames = [...this.sceneNames, name];
      if (!this.hiddenNames.includes(name))
        this.hiddenNames = [...this.hiddenNames, name];
    });
    await this.save();
  }

  // ── 1회 이관 (씬 템플릿 개편, 2026-07-18 합의) ──
  // 기존에 "일반 프로젝트를 씬 템플릿으로 지정"해 둔 항목을, 복제본(숨김)으로
  // 분리하고 원본은 일반 프로젝트로 되돌린다(지정 해제). 부팅 완료 후 비차단으로
  // 생성 호스트(주) 창에서만 실행 — 보조 창과의 중복 이관을 피한다.
  // 이관 대상 판정 = sceneNames 중 숨김이 아닌 실존 프로젝트 (멱등 —
  // 이관 후에는 모든 템플릿이 숨김이라 재실행해도 no-op).
  async migrateSceneTemplatesToHidden(): Promise<void> {
    await this.ensureLoaded();
    if (!this.loaded) return;
    const pending = this.listSceneTemplates().filter(
      (n) => !this.hiddenNames.includes(n),
    );
    if (pending.length === 0) return;
    const appState = getAppState();
    let migrated = 0;
    for (const name of pending) {
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
  // 반환 = 실제로 세션에 들어간 씬 이름 목록(추가+덮어쓰기, 최종 이름 기준).
  // 취소·실패 시 null (호출처가 자동 선택 등 후속을 건너뛰도록).
  async importSceneTemplate(session: Session): Promise<string[] | null> {
    const appState = getAppState();
    await this.ensureLoaded();
    const templates = this.listSceneTemplates().filter(
      (n) => n !== session.name,
    );
    if (templates.length === 0) {
      appState.pushMessage(
        '가져올 씬 템플릿이 없습니다. 먼저 "현재 씬 전체로 템플릿 만들기"로 템플릿을 만들어주세요.',
      );
      return null;
    }
    const tplName = await appState.pushDialogAsync({
      type: 'select',
      text: '가져올 씬 템플릿을 선택해주세요',
      items: templates.map((n) => ({ text: n, value: n })),
    });
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
          { text: '기존 씬을 덮어쓰기 (기존 씬은 휴지통으로)', value: 'overwrite' },
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
          if (old) await trashService.moveSceneToTrash(session, old);
          session.addScene(scene);
          replaced++;
          importedNames.push(scene.name);
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
    }
    const parts = [`추가 ${added}개`];
    if (replaced) parts.push(`덮어쓰기 ${replaced}개`);
    if (skipped) parts.push(`건너뜀 ${skipped}개`);
    appState.pushMessage(`씬 템플릿 가져오기 완료 — ${parts.join(', ')}`);
    return importedNames;
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
    await this.ensureLoaded();
    if (!this.loaded) return null;
    // 미지정이면 사이드카를 새로 읽어 다른 창이 만든 지정을 먼저 흡수한다
    // (templates.json 은 창 간 브로드캐스트 미대상 — 중복 생성 방지)
    if (!this.quickGenName) {
      try {
        const raw = JSON.parse(await backend.readFile(SIDECAR_PATH));
        if (typeof raw?.quickGenProject === 'string' && raw.quickGenProject) {
          runInAction(() => {
            this.quickGenName = raw.quickGenProject;
          });
        }
      } catch (e) {}
    }
    const cur = this.quickGenName;
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
      const old = this.quickGenName;
      // 소프트 삭제된 옛 전용 프로젝트가 복원되면 접근 불가 숨김 고아가 되므로
      // 재지정 시점에 옛 이름의 숨김을 함께 푼다(복원 시 일반 프로젝트로 보임).
      this.hiddenNames = [
        ...this.hiddenNames.filter((n) => n !== old && n !== name),
        name,
      ];
      this.quickGenName = name;
    });
    await this.save();
    return (await sessionService.get(name)) ?? null;
  }

}
