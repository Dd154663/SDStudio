// 부스트 다중 계정 실행 중 계정 전환 잠금(B3, 2026-11-01) — 로그인 탭·할당량 상세 창 공용 훅.
// 판정은 LoginService.accountSwitchBlockedReason()(index.ts 가 taskQueueService.isBoostAccountLocked 를 주입) 하나로,
// 서비스가 거부하는 조건과 화면 비활성 조건이 같다. 큐의 start·stop·progress 이벤트마다 다시 읽는다.
import { useEffect, useState } from 'react';
import { loginService, taskQueueService } from '../models';

/** 지금 계정을 바꿀 수 없으면 안내 문구, 아니면 undefined. */
export function useBoostAccountLock(): string | undefined {
  const [reason, setReason] = useState<string | undefined>(() =>
    loginService.accountSwitchBlockedReason(),
  );
  useEffect(() => {
    const update = () => setReason(loginService.accountSwitchBlockedReason());
    update();
    const events = ['start', 'stop', 'progress', 'complete'];
    for (const ev of events) taskQueueService.addEventListener(ev, update);
    return () => {
      for (const ev of events) taskQueueService.removeEventListener(ev, update);
    };
  }, []);
  return reason;
}
