import { taskQueueService, isMobile } from '.';

// 모바일 백그라운드 생성 멈춤(Chromium 백그라운드 페이지 동결) 우회 서비스.
//
// 최신 Android WebView(Chromium)는 페이지가 숨겨진 뒤 약 1분이 지나면 JS 태스크 큐를
// 통째로 동결(Page Lifecycle freeze)한다. 포그라운드 서비스/배터리 설정과 무관한
// Chromium 내부 동작이라, 백그라운드 이미지 생성 루프(JS)가 그대로 멈춰버린다.
// 단, "오디오를 재생 중인 페이지"는 동결에서 면제된다 (실기기 검증 완료).
//
// 이 서비스는 "앱이 백그라운드 + 생성 큐가 동작 중"일 때만 사람이 들을 수 없는
// 저주파(40Hz) 톤을 미세 음량으로 재생해 동결을 면제시킨다. 폰 스피커는 40Hz를
// 재생하지 못하므로 실제로는 들리지 않고, 다른 앱의 음악 재생에도 영향이 없음을
// 실기기에서 확인했다. 포그라운드 복귀 또는 생성 완료 시 즉시 중지한다.
export class BackgroundKeepAliveService {
  private audioCtx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private active = false;
  // 생성 큐와 독립적인 수동 유지(참조 카운트). 마이그레이션처럼 큐 밖의 장시간
  // 작업이 백그라운드 동결로 중단되지 않도록 그 구간에만 오디오를 유지한다.
  private manualHolds = 0;

  start() {
    if (!isMobile) return; // 모바일 전용 (데스크톱은 no-op)
    const onChange = () => this.update();
    document.addEventListener('visibilitychange', onChange);
    taskQueueService.addEventListener('start', onChange);
    taskQueueService.addEventListener('stop', onChange);
    taskQueueService.addEventListener('complete', onChange);
  }

  // 수동 유지 획득/해제 — 생성 큐 동작과 무관하게 동결을 면제한다(모바일 전용).
  // 중첩 호출 가능(참조 카운트). start() 호출 전에도 동작한다(마이그레이션은 부팅
  // 게이트에서 start() 이전에 실행되므로). 반드시 try/finally 로 release 를 짝지을 것.
  acquireHold() {
    if (!isMobile) return; // 데스크톱은 no-op
    this.manualHolds++;
    this.update();
  }
  releaseHold() {
    if (!isMobile) return;
    this.manualHolds = Math.max(0, this.manualHolds - 1);
    this.update();
  }

  private update() {
    const need =
      this.manualHolds > 0 ||
      (document.visibilityState === 'hidden' && taskQueueService.isRunning());
    if (need && !this.active) this.enable();
    else if (!need && this.active) this.disable();
  }

  private enable() {
    try {
      if (!this.audioCtx) this.audioCtx = new AudioContext();
      const gain = this.audioCtx.createGain();
      gain.gain.value = 0.05;
      this.osc = this.audioCtx.createOscillator();
      this.osc.frequency.value = 40;
      this.osc.connect(gain).connect(this.audioCtx.destination);
      this.osc.start();
      this.audioCtx.resume().catch(() => {});
      this.active = true;
    } catch (e) {
      this.active = false;
    }
  }

  private disable() {
    try {
      this.osc?.stop();
      this.osc?.disconnect();
    } catch (e) {}
    this.osc = null;
    try {
      this.audioCtx?.suspend();
    } catch (e) {}
    this.active = false;
  }
}
