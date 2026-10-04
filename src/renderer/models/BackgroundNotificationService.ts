import { taskQueueService, backend, isMobile } from '.';

// 모바일 백그라운드(포그라운드 서비스) 알림에 생성 진행 상태를 표시한다.
// - TaskQueueService 의 start/progress/stop/complete 이벤트를 구독해 알림 내용을 갱신.
// - setSettings 호출은 알림을 재생성하므로 과도한 호출을 막기 위해 스로틀링한다.
export class BackgroundNotificationService {
  private lastUpdate = 0;
  private readonly throttleMs = 2500;
  private trailingTimer: ReturnType<typeof setTimeout> | null = null;
  // 연속 실패로 큐가 정지됐을 때의 안내(T4) — 다음 실행 시작 전까지 「대기 중」 대신 표시한다.
  // 이 알림은 포그라운드 서비스의 상주 알림(무음 채널)이라 따로 울리지 않고 문구만 바뀐다.
  private stopNotice: string | null = null;

  start() {
    if (!isMobile) return; // 모바일 전용 (데스크톱은 no-op)
    const onChange = () => this.update(false);
    const onForce = () => this.update(true);
    const onStart = () => {
      this.stopNotice = null;
      this.update(true);
    };
    const onFailureStop = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      this.stopNotice = typeof text === 'string' && text ? text.replace(/\n/g, ' ') : null;
      this.update(true);
    };
    taskQueueService.addEventListener('start', onStart);
    taskQueueService.addEventListener('failure-stop', onFailureStop);
    taskQueueService.addEventListener('progress', onChange);
    taskQueueService.addEventListener('stop', onForce);
    taskQueueService.addEventListener('complete', onChange);
  }

  private formatTime(ms: number): string {
    const seconds = ms / 1000;
    if (seconds < 60) return `${Math.round(seconds)}초`;
    const minutes = seconds / 60;
    if (minutes < 60) return `${Math.round(minutes)}분`;
    return `${Math.round(minutes / 60)}시간`;
  }

  private update(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastUpdate < this.throttleMs) {
      // 스로틀로 버린 마지막 변경도 창이 끝나면 한 번 반영한다(꼬리 갱신). 일괄 예약의
      // 중간 진행 반영 뒤 최종 반영이 스로틀에 걸려 알림 수치가 멈춰 있지 않게(2026-10-02 P1).
      if (!this.trailingTimer) {
        this.trailingTimer = setTimeout(() => {
          this.trailingTimer = null;
          this.update(false);
        }, this.throttleMs - (now - this.lastUpdate));
      }
      return;
    }
    if (this.trailingTimer) {
      clearTimeout(this.trailingTimer);
      this.trailingTimer = null;
    }
    this.lastUpdate = now;
    try {
      const stats = taskQueueService.statsAllTasks();
      const remain = stats.total - stats.done;
      let text: string;
      if (taskQueueService.isRunning() && remain > 0) {
        const ms = taskQueueService.estimateTime('mean');
        text = `이미지 생성 중 · ${remain}개 남음 (예상 ${this.formatTime(ms)})`;
      } else if (this.stopNotice) {
        text = this.stopNotice;
      } else if (remain > 0) {
        text = `대기 중 · ${remain}개 예약됨`;
      } else {
        text = '대기 중';
      }
      backend.updateBackgroundNotification('SDStudio', text);
    } catch (e) {}
  }
}
