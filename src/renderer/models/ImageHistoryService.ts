import { action, observable } from 'mobx';
import { imageService, sessionService } from '.';
import { toggleImageMain } from './ImageService';
import { getAppState } from './appStateRef';
import { GenericScene, Session } from './types';

// 최근 생성 이미지 히스토리 (우측 사이드바용).
// 메모리 기반(앱 재시작 시 초기화), 프로젝트(세션) 무관 통합 — 항목에 세션명을 함께 저장한다.
// 수집은 ImageService의 'image-added' 이벤트를 구독(생성 완료 단일 초크포인트).

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

export class ImageHistoryService {
  @observable accessor entries: GenerationHistoryEntry[] = [];

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
  }

  @action
  remove(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  // imageService의 세션/씬 이미지 목록과 대조해 사라진 파일 항목을 제거
  @action
  private prune(session: Session, scene?: GenericScene) {
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
      imageService.refreshBatch(session);
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
