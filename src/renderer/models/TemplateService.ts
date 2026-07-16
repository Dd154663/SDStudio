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
        folderTemplates: this.folderTemplates,
        templateApplications: this.templateApplications,
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
    if (!this.isSceneTemplate(oldName)) return;
    runInAction(() => {
      this.sceneNames = this.sceneNames.map((n) =>
        n === oldName ? newName : n,
      );
    });
    await this.save();
  }

  async removeProject(name: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.loaded) return;
    // 적용 기록 정리 (하드 삭제 시점 — 씬 템플릿 지정과 동일 취지: 소프트
    // 삭제는 유지해 복원 시 되살아나고, 하드 삭제에서만 제거)
    await this.removeApplicationsOfProject(name);
    if (!this.isSceneTemplate(name)) return;
    runInAction(() => {
      this.sceneNames = this.sceneNames.filter((n) => n !== name);
    });
    await this.save();
  }

  // ===== 씬 템플릿 (여러 씬 묶음의 즉시 임포트) =====
  //
  // 씬 템플릿의 실체 = "이미지 없는 일반 프로젝트"(사용자 합의, 2026-07-07).
  // 수정은 그 프로젝트를 열어 기존 씬 카드 UI 로 하면 되므로 전용 편집 화면이 없다.
  // 씬 툴바 ⋯메뉴의 '씬 템플릿' 버튼이 이 메뉴를 연다.
  async sceneTemplateMenu(session: Session): Promise<void> {
    const appState = getAppState();
    const action = await appState.pushDialogAsync({
      type: 'select',
      text: '씬 템플릿',
      items: [
        { text: '📥 씬 템플릿 가져오기', value: 'import' },
        { text: '📤 현재 씬 전체로 템플릿 만들기', value: 'create' },
        { text: '✏️ 템플릿 열기 (씬 수정)', value: 'open' },
      ],
    });
    if (!action) return;
    if (action === 'import') await this.importSceneTemplate(session);
    else if (action === 'create') await this.createSceneTemplate(session);
    else if (action === 'open') await this.openSceneTemplate();
  }

  // 현재 프로젝트의 씬 전체를 "이미지 없는 프로젝트"로 복제해 씬 템플릿으로 지정.
  // 기존 얕은 복제(exportSessionShallow → importSessionShallow)를 그대로 재사용한다.
  private async createSceneTemplate(session: Session): Promise<void> {
    const appState = getAppState();
    const name = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: `씬 템플릿 프로젝트 이름 (예: ${session.name} 씬템플릿)`,
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
    await this.ensureLoaded();
    if (this.loaded && !this.isSceneTemplate(name)) {
      runInAction(() => {
        this.sceneNames = [...this.sceneNames, name];
      });
      await this.save();
    }
    appState.pushMessage(
      `씬 템플릿 "${name}"이(가) 만들어졌습니다. 프로젝트로 열면 씬을 수정할 수 있습니다.`,
    );
  }

  // 씬 템플릿의 일반 씬 전체를 현재 프로젝트에 추가한다.
  // 충돌 정책(사용자 합의): 겹치는 씬이 있으면 덮어쓰기/번호 부여/건너뛰기 중 택1.
  // 덮어쓰기는 기존 씬을 moveSceneToTrash 경유로 제거한다 — 씬 제거 시 outs 폴더
  // .trash 이동 규칙(project_scene_loss_guard) 준수. 직접 Map 삭제 금지.
  private async importSceneTemplate(session: Session): Promise<void> {
    const appState = getAppState();
    await this.ensureLoaded();
    const templates = this.listSceneTemplates().filter(
      (n) => n !== session.name,
    );
    if (templates.length === 0) {
      appState.pushMessage(
        '가져올 씬 템플릿이 없습니다. 먼저 "현재 씬 전체로 템플릿 만들기"로 템플릿을 만들어주세요.',
      );
      return;
    }
    const tplName = await appState.pushDialogAsync({
      type: 'select',
      text: '가져올 씬 템플릿을 선택해주세요',
      items: templates.map((n) => ({ text: n, value: n })),
    });
    if (!tplName) return;
    const tpl = await sessionService.get(tplName);
    if (!tpl) {
      appState.pushMessage('씬 템플릿 프로젝트를 불러올 수 없습니다.');
      return;
    }
    const scenes = tpl.getScenes('scene');
    if (scenes.length === 0) {
      appState.pushMessage('이 템플릿에는 씬이 없습니다.');
      return;
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
      if (!sel) return;
      policy = sel;
    }
    let added = 0;
    let replaced = 0;
    let skipped = 0;
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
    }
    const parts = [`추가 ${added}개`];
    if (replaced) parts.push(`덮어쓰기 ${replaced}개`);
    if (skipped) parts.push(`건너뜀 ${skipped}개`);
    appState.pushMessage(`씬 템플릿 가져오기 완료 — ${parts.join(', ')}`);
  }

  // 템플릿 프로젝트를 열어 씬 카드 UI 로 수정하게 한다.
  private async openSceneTemplate(): Promise<void> {
    const appState = getAppState();
    await this.ensureLoaded();
    const templates = this.listSceneTemplates();
    if (templates.length === 0) {
      appState.pushMessage('지정된 씬 템플릿이 없습니다.');
      return;
    }
    const tplName = await appState.pushDialogAsync({
      type: 'select',
      text: '열어서 수정할 씬 템플릿',
      items: templates.map((n) => ({ text: n, value: n })),
    });
    if (!tplName) return;
    const tpl = await sessionService.get(tplName);
    if (!tpl) {
      appState.pushMessage('씬 템플릿 프로젝트를 불러올 수 없습니다.');
      return;
    }
    appState.curSession = tpl;
  }

}
