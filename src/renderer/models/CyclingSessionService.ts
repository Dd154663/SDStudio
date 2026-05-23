import { action, observable, makeObservable, reaction } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import {
  CharacterPreset,
  GenericScene,
  Session,
  VibeItem,
  ReferenceItem,
} from './types';
import { taskQueueService, workFlowService } from '.';
import { queueWorkflow } from './TaskQueueService';
import { appState } from './AppService';

export type CyclingState = 'idle' | 'running' | 'paused' | 'completed';

export class CyclingSessionService {
  @observable accessor state: CyclingState = 'idle';
  @observable accessor presetQueue: CharacterPreset[] = [];
  @observable accessor currentPresetIndex: number = -1;
  @observable accessor totalPresets: number = 0;
  @observable accessor completedPresets: number = 0;
  @observable accessor currentPresetName: string = '';

  private session: Session | null = null;
  private scenes: GenericScene[] = [];
  private samples: number = 1;
  private workflowType: string = '';
  private stopHandler: (() => void) | null = null;
  private disposers: (() => void)[] = [];

  constructor() {
    makeObservable(this);
  }

  @action
  start(
    session: Session,
    presets: CharacterPreset[],
    scenes: GenericScene[],
    samples: number,
  ) {
    if (this.state === 'running') return;
    if (presets.length === 0 || scenes.length === 0) return;

    const workflowType = session.selectedWorkflow?.workflowType;
    if (!workflowType) return;

    // 기존 큐가 비어있지 않으면 경고
    if (!taskQueueService.isEmpty()) {
      appState.pushMessage('기존 예약을 먼저 완료하거나 제거해주세요');
      return;
    }

    this.session = session;
    this.scenes = [...scenes];
    this.samples = samples;
    this.workflowType = workflowType;
    this.presetQueue = [...presets];
    this.totalPresets = presets.length;
    this.completedPresets = 0;
    this.currentPresetIndex = -1;
    this.state = 'running';

    // 'stop' 이벤트 리스너 등록
    this.stopHandler = this.onQueueStop.bind(this);
    taskQueueService.addEventListener('stop', this.stopHandler);

    // 안전장치: 세션 변경 감시
    const sessionDisposer = reaction(
      () => appState.curSession,
      (newSession) => {
        if (newSession !== this.session && this.state !== 'idle') {
          this.cancel();
        }
      },
    );
    this.disposers.push(sessionDisposer);

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

    const preset = this.presetQueue[this.currentPresetIndex];
    this.currentPresetName = preset.name;

    // 프리셋 적용
    this.applyPreset(preset);

    // 프리셋 전환 쿨다운 (첫 프리셋 제외 — API 레이트 리밋 방지)
    if (this.currentPresetIndex > 0) {
      appState.pushMessage(`다음 프리셋 "${preset.name}" 준비 중 (5초 대기)...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (this.state !== 'running') return; // 대기 중 취소된 경우
    }

    // 씬 큐잉 + 실행
    this.queueAllScenes();
  }

  private applyPreset(preset: CharacterPreset) {
    if (!this.session) return;

    let shared = this.session.presetShareds.get(this.workflowType);
    if (!shared) {
      shared = workFlowService.buildShared(this.workflowType);
      this.session.presetShareds.set(this.workflowType, shared);
    }

    // 바이브 복사
    if (preset.vibes && preset.vibes.length > 0) {
      shared.vibes = preset.vibes.map((v: VibeItem) =>
        VibeItem.fromJSON(v.toJSON()),
      );
    } else {
      shared.vibes = [];
    }

    // 레퍼런스 복사
    if (preset.characterReferences && preset.characterReferences.length > 0) {
      shared.characterReferences = preset.characterReferences.map(
        (r: ReferenceItem) => ReferenceItem.fromJSON(r.toJSON()),
      );
    } else {
      shared.characterReferences = [];
    }

    // 캐릭터 프롬프트 모드 (모든 워크플로우 호환)
    shared.characterPrompts = [
      {
        id: uuidv4(),
        prompt: preset.characterPrompt || '',
        uc: preset.characterUC || '',
        position: { x: 0, y: 0 },
        enabled: true,
      },
    ];

    shared._appliedPresetName = preset.name;
  }

  private async queueAllScenes() {
    if (!this.session || !this.session.selectedWorkflow) return;

    for (const scene of this.scenes) {
      await queueWorkflow(
        this.session,
        this.session.selectedWorkflow,
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

    this.session = null;
    this.scenes = [];
    this.currentPresetName = '';
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
  addQueuedPreset(preset: CharacterPreset) {
    this.presetQueue.push(preset);
    this.presetQueue = [...this.presetQueue];
    this.totalPresets = this.presetQueue.length;
  }

  // 남은 프리셋 목록 (현재 이후)
  get remainingPresets(): CharacterPreset[] {
    if (this.currentPresetIndex < 0) return this.presetQueue;
    return this.presetQueue.slice(this.currentPresetIndex + 1);
  }
}
