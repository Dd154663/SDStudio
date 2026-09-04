import { action, observable, runInAction } from 'mobx';
import { backend, imageService, sessionService } from '.';
import { toggleImageMain } from './ImageService';
import { persistService } from './PersistenceService';
import { projectPath } from './projectPaths';
import { getAppState } from './appStateRef';
import { GenericScene, Session } from './types';

// 최근 생성 이미지 히스토리 (우측 사이드바용).
// 프로젝트(세션) 무관 통합 — 항목에 세션명을 함께 저장한다.
// 수집은 ImageService의 'image-added' 이벤트를 구독(생성 완료 단일 초크포인트).
//
// 영속화 (2026-07-18 개편): 종전에는 메모리 기반(앱 재시작 시 초기화)이었으나,
// history.json 사이드카에 저장해 다음 실행에서 복원한다. 보관 상한은 종전과
// 같은 **전체 최근 HISTORY_LIMIT장** (세션당 상한안은 프로젝트가 많을 때 목록
// ×30 부하 우려로 사용자 결정으로 기각 — 재제안 시 참고).
// 항목은 경로 문자열 메타뿐이라 파일이 작고(썸네일은 fastcache 재사용),
// 사라진 파일/씬은 기존 자가 정리(prune·셀 로드 실패·클릭 검증)가 걷어낸다.

export interface GenerationHistoryEntry {
  id: string; // = path (파일명이 Date.now() 기반이라 유니크)
  sessionName: string;
  sceneType: 'scene' | 'inpaint';
  sceneName: string;
  filename: string;
  path: string; // 이미지 절대(저장소 기준) 경로
  createdAt: number;
}

export const HISTORY_LIMIT = 30;

const SIDECAR_PATH = 'history.json';

export class ImageHistoryService {
  @observable accessor entries: GenerationHistoryEntry[] = [];

  private loaded = false;
  // IO 오류(권한 등)로 로드가 실패하면 저장을 차단해 기존 히스토리를
  // 빈 값으로 덮어쓰지 않는다 (templates.json 로드 실패 처리와 같은 취지).
  private loadFailed = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    imageService.addEventListener('image-added', ((e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) return;
      this.push({
        sessionName: d.session.name,
        sceneType: d.sceneType,
        sceneName: d.sceneName,
        filename: d.filename,
        path: d.path,
      });
    }) as EventListener);
    // 이미지 목록 갱신(삭제/새로고침) 시 사라진 파일의 히스토리 항목 정리
    imageService.addEventListener('updated', ((e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.session) this.prune(d.session, d.scene);
    }) as EventListener);
  }

  // 사이드카 로드 + 런타임 수집분과 병합 (bootstrap 3단계에서 비차단 호출).
  // 하드 삭제된 프로젝트의 항목은 로드 시점에 걸러낸다(이름변경 항목은 클릭
  // 검증 resolve 가 정리). 수집(image-added)이 로드보다 먼저 시작될 수 있어
  // 덮어쓰지 않고 id 기준으로 병합한다.
  async ensureLoaded(): Promise<void> {
    if (this.loaded || this.loadFailed) return;
    try {
      if (!(await backend.existFile(SIDECAR_PATH))) {
        this.loaded = true;
        return;
      }
      const raw = JSON.parse(await backend.readFile(SIDECAR_PATH));
      const arr: any[] = Array.isArray(raw?.entries) ? raw.entries : [];
      let existing: Set<string> | null = null;
      try {
        existing = new Set(sessionService.list());
      } catch (e) {}
      // 저장된 path 는 "생성 시점 배치" 기준이라 구→신 마이그레이션 직후엔
      // 무효가 된다(파일이 workspace/ 하위로 이동). 세션·씬·파일명으로 현재
      // 배치 기준 경로를 projectPath 관문으로 재계산한다 — 구 배치에서는
      // 항등이라 동작 무변경. 재계산 불가(미등록/이상 이름 throw)면 항목 폐기.
      const rebuildPath = (e: any): string | null => {
        try {
          return (
            projectPath(
              e.sceneType === 'scene' ? 'outs' : 'inpaints',
              e.sessionName,
              e.sceneName,
            ) +
            '/' +
            e.filename
          );
        } catch {
          return null;
        }
      };
      const valid: GenerationHistoryEntry[] = arr
        .filter(
          (e) =>
            e &&
            typeof e.path === 'string' &&
            e.path &&
            typeof e.sessionName === 'string' &&
            typeof e.sceneName === 'string' &&
            typeof e.filename === 'string' &&
            (e.sceneType === 'scene' || e.sceneType === 'inpaint'),
        )
        .filter((e) => !existing || existing.has(e.sessionName))
        .map((e) => {
          const path = rebuildPath(e);
          if (!path) return null;
          return {
            id: path,
            sessionName: e.sessionName,
            sceneType: e.sceneType,
            sceneName: e.sceneName,
            filename: e.filename,
            path,
            createdAt: typeof e.createdAt === 'number' ? e.createdAt : 0,
          };
        })
        .filter((e): e is GenerationHistoryEntry => e !== null);
      const hadRuntime = this.entries.length > 0;
      runInAction(() => {
        const merged = [...this.entries];
        const have = new Set(merged.map((e) => e.id));
        for (const e of valid) {
          if (!have.has(e.id)) merged.push(e);
        }
        merged.sort((a, b) => b.createdAt - a.createdAt);
        this.entries = merged.slice(0, HISTORY_LIMIT);
      });
      this.loaded = true;
      // 로드 전에 수집된 항목이 있으면(부팅 중 생성 완료) 병합 결과를 저장해 둔다
      if (hadRuntime) this.scheduleSave();
    } catch (e) {
      if (e instanceof SyntaxError) {
        // 파손 → 빈 히스토리로 재시작 (표시용 메타만 잃음, 이미지 무손실)
        this.loaded = true;
        return;
      }
      this.loadFailed = true;
      console.error('history.json 로드 실패(IO) — 히스토리 저장 차단:', e);
    }
  }

  // 디바운스 저장 — 생성 1장마다 즉시 쓰지 않고 몰아서 1회.
  // 로드 전/로드 실패 상태에서는 저장하지 않는다(기존 파일 보호).
  private scheduleSave() {
    if (!this.loaded || this.loadFailed) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch((e) => console.error('히스토리 저장 실패:', e));
    }, 800);
  }

  private async save(): Promise<void> {
    await persistService.write(
      SIDECAR_PATH,
      JSON.stringify({
        version: 1,
        entries: this.entries.map((e) => ({
          sessionName: e.sessionName,
          sceneType: e.sceneType,
          sceneName: e.sceneName,
          filename: e.filename,
          path: e.path,
          createdAt: e.createdAt,
        })),
      }),
    );
  }

  @action
  push(d: {
    sessionName: string;
    sceneType: 'scene' | 'inpaint';
    sceneName: string;
    filename: string;
    path: string;
  }) {
    this.entries = [
      {
        id: d.path,
        sessionName: d.sessionName,
        sceneType: d.sceneType,
        sceneName: d.sceneName,
        filename: d.filename,
        path: d.path,
        createdAt: Date.now(),
      },
      ...this.entries.filter((e) => e.id !== d.path),
    ].slice(0, HISTORY_LIMIT);
    this.scheduleSave();
  }

  @action
  remove(id: string) {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) this.scheduleSave();
  }

  // imageService의 세션/씬 이미지 목록과 대조해 사라진 파일 항목을 제거
  @action
  private prune(session: Session, scene?: GenericScene) {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => {
      if (e.sessionName !== session.name) return true;
      if (scene && (e.sceneName !== scene.name || e.sceneType !== scene.type))
        return true;
      const map =
        e.sceneType === 'scene' ? imageService.images : imageService.inpaints;
      const files = map[e.sessionName]?.[e.sceneName];
      if (!files) return true; // 아직 스캔 전이면 판단 보류
      return files.includes(e.filename);
    });
    if (this.entries.length !== before) this.scheduleSave();
  }

  // 조용한 조회(부수효과 없음): 셀의 즐겨찾기 표시 등 렌더용
  async resolveQuiet(
    entry: GenerationHistoryEntry,
  ): Promise<{ session: Session; scene: GenericScene } | null> {
    const session = await sessionService.get(entry.sessionName);
    const scene =
      entry.sceneType === 'scene'
        ? session?.scenes.get(entry.sceneName)
        : session?.inpaints.get(entry.sceneName);
    if (!session || !scene) return null;
    return { session, scene };
  }

  // 클릭 시점 검증: 세션 로드 + 씬 존재 확인. 실패하면 항목 제거 후 null.
  async resolve(
    entry: GenerationHistoryEntry,
  ): Promise<{ session: Session; scene: GenericScene } | null> {
    const session = await sessionService.get(entry.sessionName);
    const scene =
      entry.sceneType === 'scene'
        ? session?.scenes.get(entry.sceneName)
        : session?.inpaints.get(entry.sceneName);
    if (!session || !scene) {
      getAppState().pushMessage('원본 씬을 찾을 수 없어 히스토리에서 제거했습니다');
      this.remove(entry.id);
      return null;
    }
    return { session, scene };
  }

  // 이미지 즐겨찾기(메인) 토글 — 썸네일 탭/클릭과 컨텍스트 메뉴 공용.
  // scene.mains는 mobx 옵저버블이라 observer 셀이 자동 갱신되고,
  // 비활성 세션의 변경도 ResourceSyncService가 자동 저장한다.
  async toggleFavorite(entry: GenerationHistoryEntry): Promise<void> {
    const resolved = await this.resolve(entry);
    if (!resolved) return;
    const { session, scene } = resolved;
    // 창 간 동기화 헬퍼(읽기 전용 미러): 소유 창 위임 + 로컬 반영
    toggleImageMain(session, scene, entry.filename);
  }

  // 좌클릭/컨텍스트 메뉴 "해당 씬으로 이동" 공용 진입점.
  // openGrid=false: 씬 카드로 스크롤 / true: 해당 씬 이미지 그리드(ResultViewer) 열기
  async navigateTo(
    entry: GenerationHistoryEntry,
    opts: { openGrid: boolean },
  ): Promise<void> {
    const resolved = await this.resolve(entry);
    if (!resolved) return;
    const { session } = resolved;
    const appState = getAppState();
    if (appState.curSession?.name !== session.name) {
      // 타 프로젝트 항목 → 프로젝트 전환 (ProjectDrawer.selectProject와 동일 패턴)
      appState.curSession = session;
    }
    const cell = await this.waitForSceneCell(entry.sceneType, entry.sceneName);
    if (!cell) return;
    if (opts.openGrid) {
      sessionService.dispatchEvent(
        new CustomEvent('open-result-viewer', {
          detail: {
            sceneType: entry.sceneType,
            sceneName: entry.sceneName,
            filename: entry.filename,
          },
        }),
      );
    } else {
      // 열려 있는 이미지 그리드(ResultViewer)를 먼저 닫아야 스크롤이 보인다
      sessionService.dispatchEvent(new CustomEvent('close-result-viewer'));
      // 오버레이 언마운트가 반영된 다음 프레임에 스크롤
      await new Promise((r) => setTimeout(r, 0));
      cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // 해당 씬 셀이 "보이는" 상태가 될 때까지 탭 전환을 재발신하며 대기.
  // 매 틱 재발신하는 이유: 프로젝트 전환 시 TabComponent가 리마운트(key=세션명)되어
  // 리스너 등록 전 dispatch가 유실될 수 있음 — 탭 전환은 멱등이라 반복해도 무해.
  private waitForSceneCell(
    type: 'scene' | 'inpaint',
    name: string,
    timeoutMs = 2500,
  ): Promise<HTMLElement | null> {
    const tabAction = type === 'scene' ? 'tab-1' : 'tab-2';
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const tick = () => {
        window.dispatchEvent(
          new CustomEvent('shortcut-action', {
            detail: { action: tabAction },
          }),
        );
        const el = document.getElementById(`scene-cell-${type}-${name}`);
        if (el && el.offsetParent !== null) {
          resolve(el);
          return;
        }
        if (Date.now() > deadline) {
          resolve(null);
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    });
  }
}
