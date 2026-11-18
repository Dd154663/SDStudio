import { action, observable, makeObservable, reaction, runInAction } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import {
  CharacterPreset,
  GenericScene,
  Session,
  VibeItem,
  ReferenceItem,
} from './types';
import {
  taskQueueService,
  workFlowService,
  sessionService,
  imageService,
  globalCharacterPresetService,
  backend,
} from '.';
import { dataUriToBase64 } from './ImageService';
import { queueWorkflow } from './TaskQueueService';
import { appState } from './AppService';
import {
  AppliedCharacterRestorePoint,
  captureAppliedCharacter,
  restoreAppliedCharacter,
} from './cyclingRestore';

export type CyclingState = 'idle' | 'running' | 'paused' | 'completed';

// 순차 생성 큐 항목. 로컬/글로벌 프리셋을 모두 표현한다.
export interface CyclingItem {
  kind: 'local' | 'global';
  name: string;
  preset: CharacterPreset; // 표시 및 로컬 적용용
  globalId?: string; // kind === 'global' 일 때 글로벌 엔트리 id
}

export interface CyclingOptions {
  // ON이면 프리셋마다 현재 프로젝트를 복제(이미지 미포함)해 프리셋 이름의 새 프로젝트를 만들고
  // 그 프로젝트에 적용·생성한다. OFF면 기존처럼 현재 프로젝트 하나에 갈아끼우며 생성.
  projectFileMode: boolean;
}

export class CyclingSessionService {
  @observable accessor state: CyclingState = 'idle';
  @observable accessor presetQueue: CyclingItem[] = [];
  @observable accessor currentPresetIndex: number = -1;
  @observable accessor totalPresets: number = 0;
  @observable accessor completedPresets: number = 0;
  @observable accessor currentPresetName: string = '';

  private session: Session | null = null;
  private scenes: GenericScene[] = [];
  private samples: number = 1;
  private workflowType: string = '';
  private projectFileMode: boolean = false;
  private stopHandler: (() => void) | null = null;
  private disposers: (() => void)[] = [];
  // 「현재 프로젝트」 모드 되돌리기(2026-11-18 경로 12, cyclingRestore.ts) — 대상 프로젝트와 워크플로별 바꾸기 전 적용 캐릭터 상태.
  // 끝나면(완료·취소·오류로 끝남) restoreAppliedState 가 한 번 되돌리고 비운다. 일시정지는 끝이 아니다.
  private restoreTarget: Session | null = null;
  private restorePoints: Map<string, AppliedCharacterRestorePoint> = new Map();
  // 적용·예약 진행 중(runInPlacePreset 안) — 이 동안 취소되면 예약이 끝난 뒤 되돌린다(남은 씬이 원래 캐릭터로 예약되지 않게)
  private inPlaceBusy = false;

  constructor() {
    makeObservable(this);
  }

  @action
  start(
    session: Session,
    items: CyclingItem[],
    scenes: GenericScene[],
    samples: number,
    options?: CyclingOptions,
  ) {
    if (this.state === 'running') return;
    if (items.length === 0 || scenes.length === 0) return;

    const workflowType = session.selectedWorkflow?.workflowType;
    if (!workflowType) return;

    // 기존 큐가 비어있지 않으면 경고
    // 직전 순차 생성이 아직 적용·예약 중(취소 직후)이면 그 되돌리기가 끝날 때까지 받지 않는다
    if (!taskQueueService.isEmpty() || this.inPlaceBusy) {
      appState.pushMessage('기존 예약을 먼저 완료하거나 제거해주세요');
      return;
    }

    this.session = session;
    this.scenes = [...scenes];
    this.samples = samples;
    this.workflowType = workflowType;
    this.projectFileMode = options?.projectFileMode ?? false;
    // 「현재 프로젝트」 모드만 원래 프로젝트의 적용 상태를 바꾼다 — 워크플로마다 처음 바꾸기 직전 상태를 잡는다(runInPlacePreset).
    // 프로젝트 파일 모드는 복제한 새 프로젝트에 적용하므로 되돌릴 것이 없다.
    this.restoreTarget = this.projectFileMode ? null : session;
    this.restorePoints = new Map();
    this.presetQueue = [...items];
    this.totalPresets = items.length;
    this.completedPresets = 0;
    this.currentPresetIndex = -1;
    this.state = 'running';

    // 'stop' 이벤트 리스너 등록
    this.stopHandler = this.onQueueStop.bind(this);
    taskQueueService.addEventListener('stop', this.stopHandler);

    // 안전장치: 세션 변경 감시.
    // 프로젝트 파일 모드에서는 생성 대상이 curSession이 아니므로(백그라운드),
    // 사용자가 원본에서 다른 프로젝트로 이동해도 취소되면 안 된다 → 등록하지 않음.
    if (!this.projectFileMode) {
      const sessionDisposer = reaction(
        () => appState.curSession,
        (newSession) => {
          if (newSession !== this.session && this.state !== 'idle') {
            this.cancel();
          }
        },
      );
      this.disposers.push(sessionDisposer);
    }

    // 첫 프리셋으로 진행
    this.advanceToNextPreset();
  }

  @action
  private async advanceToNextPreset() {
    this.currentPresetIndex++;

    if (this.currentPresetIndex >= this.presetQueue.length) {
      // 모든 프리셋 완료
      this.state = 'completed';
      appState.pushMessage(
        `순차 생성 완료: ${this.completedPresets}개 프리셋 처리됨`,
      );
      this.cleanup();
      this.state = 'idle';
      return;
    }

    const desc = this.presetQueue[this.currentPresetIndex];
    this.currentPresetName = desc.name;

    // 프리셋 전환 쿨다운 (첫 프리셋 제외 — API 레이트 리밋 방지)
    if (this.currentPresetIndex > 0) {
      appState.pushMessage(`다음 프리셋 "${desc.name}" 준비 중 (5초 대기)...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (this.state !== 'running') return; // 대기 중 취소된 경우
    }

    try {
      if (this.projectFileMode) {
        await this.runProjectFilePreset(desc);
      } else {
        await this.runInPlacePreset(desc);
      }
    } catch (e: any) {
      appState.pushMessage(
        `프리셋 "${desc.name}" 처리 실패: ${e?.message || e}`,
      );
      if (this.state !== 'running') return;
      // 실패해도 다음 프리셋으로 진행
      this.completedPresets++;
      this.advanceToNextPreset();
    }
  }

  // 기존 동작: 현재 프로젝트 하나에 프리셋을 갈아끼우며 생성
  private async runInPlacePreset(desc: CyclingItem) {
    const session = this.session;
    if (!session) return;
    const scenes = this.scenes;
    this.inPlaceBusy = true;
    try {
      let preset = desc.preset;
      if (desc.kind === 'global' && desc.globalId) {
        // 글로벌 이미지를 현재 세션에 실체화한 프리셋을 적용
        preset = await globalCharacterPresetService.instantiateIntoSession(
          session,
          desc.globalId,
        );
        // 실체화를 기다리는 동안 취소됐으면 적용하지 않는다(되돌린 뒤 다시 바꿔 놓지 않게)
        if (this.state !== 'running') return;
      }
      const workflowType = session.selectedWorkflow?.workflowType;
      if (workflowType && this.restoreTarget === session && !this.restorePoints.has(workflowType)) {
        this.restorePoints.set(workflowType, captureAppliedCharacter(session, workflowType));
      }
      this.applyPreset(preset, session);
      const point = workflowType ? this.restorePoints.get(workflowType) : undefined;
      if (point) point.lastApplied = preset.name;
      await this.queueScenes(session, scenes);
    } finally {
      this.inPlaceBusy = false;
      // 적용·예약 도중 끝났으면(취소 등) 예약을 마친 지금 되돌린다. 계속 진행 중·일시정지면 그대로.
      if (this.state !== 'running' && this.state !== 'paused') this.restoreAppliedState();
    }
  }

  /**
   * 순차 생성이 바꾼 적용 캐릭터 상태를 시작 전으로 되돌린다(완료·취소·오류로 끝날 때 한 번). 적용·예약 도중이면 미룬다
   * (runInPlacePreset 의 finally 가 부른다). 예약된 작업은 입력이 이미 굳어 있어 되돌려도 남은 생성은 그대로다(cyclingRestore.ts).
   * 대상 프로젝트가 더는 불러온 그 객체가 아니면(삭제·이름 변경 등) 건드리지 않는다.
   */
  private restoreAppliedState() {
    if (this.inPlaceBusy) return;
    const target = this.restoreTarget;
    const points = this.restorePoints;
    this.restoreTarget = null;
    this.restorePoints = new Map();
    if (!target || points.size === 0) return;
    if (!sessionService.isLoaded(target.name) || sessionService.getFast(target.name) !== target) return;
    runInAction(() => {
      for (const point of points.values()) restoreAppliedCharacter(point);
    });
  }

  // 프로젝트 파일 모드: 프리셋마다 현재 프로젝트를 복제해 새 프로젝트에 적용·생성
  private async runProjectFilePreset(desc: CyclingItem) {
    if (!this.session) return;
    const folder = sessionService.getFolderOf(this.session.name);
    const newName = this.uniqueProjectName(desc.name);

    // 이미지 미포함 복제 (프로젝트 파일 내보내기와 동일)
    const iSession = await sessionService.exportSessionShallow(this.session);
    await sessionService.importSessionShallow(iSession, newName);
    if (folder) await sessionService.moveToFolder(newName, folder);

    const newSession = sessionService.getFast(newName);
    if (!newSession) throw new Error('새 프로젝트 생성 실패');

    // shallow 복제는 JSON 토큰만 복사하고 이미지 파일은 복사하지 않으므로,
    // 캐릭터 프리셋(바이브/레퍼런스) 이미지 디렉터리를 새 세션으로 복사한다.
    // 이렇게 해야 새 프로젝트의 "캐릭터 프리셋 관리"에서 이미지가 깨지지 않고,
    // 복사된 로컬 프리셋을 재적용해도 정상 동작한다.
    await this.copyImageDir(
      imageService.getVibesDir(this.session),
      imageService.getVibesDir(newSession),
    );
    await this.copyImageDir(
      imageService.getReferenceDir(this.session),
      imageService.getReferenceDir(newSession),
    );
    appState.pushMessage(`'${newName}' 프로젝트 생성됨`);

    // 적용 프리셋 결정
    let preset: CharacterPreset;
    if (desc.kind === 'global' && desc.globalId) {
      // 글로벌 이미지는 세션 외부(global_char_images)에 있으므로 새 세션에 실체화
      preset = await globalCharacterPresetService.instantiateIntoSession(
        newSession,
        desc.globalId,
      );
    } else {
      // 로컬 프리셋은 이미지 디렉터리를 복사했으므로 원본 토큰이 새 세션에서 해석됨
      preset = desc.preset;
    }
    this.applyPreset(preset, newSession);

    // 선택 씬을 새 세션 기준으로 매핑해 큐잉
    const mapped: GenericScene[] = [];
    for (const s of this.scenes) {
      const sc = newSession.scenes.get(s.name);
      if (sc) mapped.push(sc);
    }
    await this.queueScenes(newSession, mapped);
  }

  // 현재 프로젝트와 같은 이름이 없도록 고유한 프로젝트 이름을 만든다.
  private uniqueProjectName(base: string): string {
    let name = (base || '프리셋').trim() || '프리셋';
    if (!sessionService.resourceList.includes(name)) return name;
    let i = 2;
    while (sessionService.resourceList.includes(`${name} (${i})`)) i++;
    return `${name} (${i})`;
  }

  // 한 이미지 디렉터리(평면)의 모든 파일을 다른 디렉터리로 복사한다.
  // 파일명(=토큰)을 그대로 유지하므로 프리셋 JSON의 이미지 참조가 그대로 해석된다.
  // (encoded 같은 하위 디렉터리 엔트리는 readDataFile 실패로 자연히 건너뛴다 — 생성 시 재생성됨)
  private async copyImageDir(srcDir: string, destDir: string) {
    let files: string[] = [];
    try {
      files = await backend.listFiles(srcDir);
    } catch (e) {
      return; // 소스 디렉터리가 없으면 복사할 것도 없음
    }
    for (const f of files) {
      try {
        const data = await backend.readDataFile(srcDir + '/' + f);
        if (data) {
          await backend.writeDataFile(destDir + '/' + f, dataUriToBase64(data));
        }
      } catch (e) {}
    }
  }

  private applyPreset(preset: CharacterPreset, target: Session) {
    const workflowType = target.selectedWorkflow?.workflowType;
    if (!workflowType) return;

    let shared = target.presetShareds.get(workflowType);
    if (!shared) {
      shared = workFlowService.buildShared(workflowType);
      target.presetShareds.set(workflowType, shared);
    }

    // 이전 프리셋 항목 제거 (사용자 직접 추가 항목 유지)
    const prevVibes = (shared.vibes || []).filter((v: VibeItem) => !v.fromPreset);
    const prevRefs = (shared.characterReferences || []).filter((r: ReferenceItem) => !r.fromPreset);

    // 프리셋 바이브/레퍼런스를 태그 붙여서 추가
    const presetVibes = (preset.vibes || []).map((v: VibeItem) => {
      const item = VibeItem.fromJSON(v.toJSON());
      item.fromPreset = preset.name;
      return item;
    });
    const presetRefs = (preset.characterReferences || []).map((r: ReferenceItem) => {
      const item = ReferenceItem.fromJSON(r.toJSON());
      item.fromPreset = preset.name;
      return item;
    });

    shared.vibes = [...prevVibes, ...presetVibes];
    shared.characterReferences = [...prevRefs, ...presetRefs];

    // 이전 프리셋 캐릭터 프롬프트 제거 (사용자 항목 유지)
    // 순환 적용은 이전 프리셋 유래 항목을 전부 교체하므로, 이름이 달라도
    // 기존 역할 대응 순서를 이어받아야 씬의 번호 기반 혼합이 흔들리지 않는다.
    const replacedPrompt = (shared.characterPrompts || []).find(
      (cp: any) => !!cp.fromPreset,
    );
    const prevPrompts = (shared.characterPrompts || []).filter(
      (cp: any) => !cp.fromPreset
    );
    if (preset.characterPrompt || preset.characterUC) {
      const newEntry = {
        id: replacedPrompt?.id || uuidv4(),
        prompt: preset.characterPrompt || '',
        uc: preset.characterUC || '',
        position: { x: 0.5, y: 0.5 },
        enabled: true,
        fromPreset: preset.name,
        order: replacedPrompt?.order,
      };
      shared.characterPrompts = [...prevPrompts, newEntry];
    } else {
      shared.characterPrompts = prevPrompts;
    }

    shared._appliedPresetName = preset.name;
  }

  private async queueScenes(target: Session, scenes: GenericScene[]) {
    if (!target.selectedWorkflow) return;

    for (const scene of scenes) {
      await queueWorkflow(
        target,
        target.selectedWorkflow,
        scene,
        this.samples,
      );
    }

    taskQueueService.run();
  }

  private onQueueStop() {
    if (this.state !== 'running') return;

    if (taskQueueService.isEmpty()) {
      // 자연 완료 → 다음 프리셋으로 진행
      this.completedPresets++;
      this.advanceToNextPreset();
    } else {
      // 수동 중지 → 일시정지
      this.state = 'paused';
    }
  }

  @action
  resume() {
    if (this.state !== 'paused') return;

    this.state = 'running';

    if (taskQueueService.isEmpty()) {
      // 큐가 비었으면 (수동 중지 후 사용자가 태스크 삭제한 경우)
      this.completedPresets++;
      this.advanceToNextPreset();
    } else {
      // 큐에 태스크가 남아있으면 이어서 실행
      taskQueueService.run();
    }
  }

  @action
  cancel() {
    if (this.state === 'idle') return;

    this.state = 'idle';
    this.cleanup();
    appState.pushMessage('순차 생성이 취소되었습니다');
  }

  private cleanup() {
    // 이벤트 리스너 제거
    if (this.stopHandler) {
      taskQueueService.removeEventListener('stop', this.stopHandler);
      this.stopHandler = null;
    }

    // MobX reaction 정리
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers = [];

    // 끝(완료·취소) — 적용 캐릭터를 시작 전으로(적용·예약 도중이면 그 흐름이 끝난 뒤 runInPlacePreset 이 되돌린다)
    this.restoreAppliedState();

    this.session = null;
    this.scenes = [];
    this.currentPresetName = '';
    this.projectFileMode = false;
  }

  // ─── 대기 중 프리셋 관리 (중간 수정) ───────────────────────

  @action
  moveQueuedPreset(fromIndex: number, toIndex: number) {
    // 현재 실행 중인 프리셋 이후만 수정 가능
    const minIndex = this.currentPresetIndex + 1;
    if (fromIndex < minIndex || toIndex < minIndex) return;
    if (fromIndex >= this.presetQueue.length || toIndex >= this.presetQueue.length) return;

    const [moved] = this.presetQueue.splice(fromIndex, 1);
    this.presetQueue.splice(toIndex, 0, moved);
    this.presetQueue = [...this.presetQueue];
  }

  @action
  removeQueuedPreset(index: number) {
    // 현재 실행 중인 프리셋은 제거 불가
    if (index <= this.currentPresetIndex) return;
    if (index >= this.presetQueue.length) return;

    this.presetQueue.splice(index, 1);
    this.presetQueue = [...this.presetQueue];
    this.totalPresets = this.presetQueue.length;
  }

  @action
  addQueuedPreset(item: CyclingItem) {
    this.presetQueue.push(item);
    this.presetQueue = [...this.presetQueue];
    this.totalPresets = this.presetQueue.length;
  }

  // 남은 프리셋 목록 (현재 이후)
  get remainingPresets(): CyclingItem[] {
    if (this.currentPresetIndex < 0) return this.presetQueue;
    return this.presetQueue.slice(this.currentPresetIndex + 1);
  }
}
