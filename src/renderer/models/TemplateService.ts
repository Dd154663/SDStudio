import { observable, makeObservable, runInAction } from 'mobx';
import { persistService } from './PersistenceService';
import { backend, sessionService, trashService } from '.';
import { getAppState } from './appStateRef';
import { Session, genericSceneFromJSON } from './types';

const SIDECAR_PATH = 'templates.json';

// 신규 프로젝트 생성 시 '빈 프로젝트' 선택지의 다이얼로그 값 — '/' 는 경로
// 구분자라 프로젝트 이름에 쓸 수 없으므로 실제 이름과 충돌 불가.
const BLANK_VALUE = '/blank';

/**
 * 프로젝트 템플릿 지정 관리 (트랙1 A3)
 *
 * - "템플릿" = 사용자가 지정한 기존 프로젝트. 신규 프로젝트 생성 시 그 프로젝트의
 *   설정(프리셋·라이브러리·캐릭터 프리셋 등)만 상속한다 — 상속 로직은
 *   SessionService.createSessionFromTemplate 참조.
 * - 지정 목록은 사이드카 templates.json 에 저장 (세션 파일 포맷 무변경 —
 *   feedback_data_migration: 구버전은 이 파일을 몰라도 무해).
 * - 시작 시 로드 없음 — 사용처에서 ensureLoaded 지연 로드 (ProjectSizeService 패턴).
 */
export class TemplateService {
  @observable accessor names: string[] = [];
  // 씬 템플릿 지정 목록 — "이미지 없는 일반 프로젝트"를 씬 묶음 템플릿으로
  // 지정한 것. 같은 사이드카의 sceneTemplates 필드에 저장(필드 추가 = 호환 안전).
  @observable accessor sceneNames: string[] = [];

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
        this.names = Array.isArray(raw?.templates)
          ? raw.templates.filter((n: unknown) => typeof n === 'string')
          : [];
        this.sceneNames = Array.isArray(raw?.sceneTemplates)
          ? raw.sceneTemplates.filter((n: unknown) => typeof n === 'string')
          : [];
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
        templates: this.names,
        sceneTemplates: this.sceneNames,
      }),
    );
  }

  isTemplate(name: string): boolean {
    return this.names.includes(name);
  }

  // 지정 목록 중 실존 프로젝트만 (수동 조작 등으로 남은 stale 지정 제외)
  list(): string[] {
    try {
      const existing = new Set(sessionService.list());
      return this.names.filter((n) => existing.has(n));
    } catch (e) {
      return [...this.names];
    }
  }

  async toggle(name: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.loaded) {
      getAppState().pushMessage('템플릿 목록을 불러오지 못해 변경할 수 없습니다.');
      return;
    }
    runInAction(() => {
      this.names = this.isTemplate(name)
        ? this.names.filter((n) => n !== name)
        : [...this.names, name];
    });
    await this.save();
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

  // 프로젝트 이름변경/삭제 연동 — SessionService.rename/delete 가 호출.
  // (사이드카 키 이관 — trash/project_sizes 와 같은 규칙, 트랙1 B2 참조)
  async renameProject(oldName: string, newName: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.loaded) return;
    if (!this.isTemplate(oldName) && !this.isSceneTemplate(oldName)) return;
    runInAction(() => {
      this.names = this.names.map((n) => (n === oldName ? newName : n));
      this.sceneNames = this.sceneNames.map((n) =>
        n === oldName ? newName : n,
      );
    });
    await this.save();
  }

  async removeProject(name: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.loaded) return;
    if (!this.isTemplate(name) && !this.isSceneTemplate(name)) return;
    runInAction(() => {
      this.names = this.names.filter((n) => n !== name);
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

  // 신규 프로젝트 생성 시 템플릿 선택 다이얼로그.
  // 반환: undefined = 사용자 취소(생성 중단) / null = 빈 프로젝트 / string = 템플릿 이름.
  // 지정된 템플릿이 하나도 없으면 다이얼로그 없이 즉시 null (기존 생성 UX 그대로).
  async pickTemplateForCreate(): Promise<string | null | undefined> {
    await this.ensureLoaded();
    const templates = this.list();
    if (templates.length === 0) return null;
    const sel = await getAppState().pushDialogAsync({
      type: 'select',
      text: '어떤 구성으로 시작할까요?',
      items: [
        { text: '빈 프로젝트', value: BLANK_VALUE },
        ...templates.map((n) => ({ text: `템플릿: ${n}`, value: n })),
      ],
    });
    if (!sel) return undefined;
    return sel === BLANK_VALUE ? null : sel;
  }
}
