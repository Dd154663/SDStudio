// 저장 경로 변경 보류 안내(PC, 2026-11-04) — 환경설정에서 저장 경로를 바꾸고 「나중에 재시작」을
// 고르면, 재시작 전까지 이전 위치에 계속 저장 중임을 화면 위 한 줄로 알린다(설정 화면 밖에서도 보이게).
// 상태 = appState.saveLocationPending(세션 메모리), 문구 = shared/saveLocationChange.ts 단일 출처,
// 재시작 = saveLocationChangeFlow.restartForSaveLocation(restart-app IPC — 종료 시 각 창 flush 보장).
// 색은 --c-* 토큰(노랑 안내), 버튼은 기존 round-button back-sky.

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { backend } from '../models';
import { SAVE_LOCATION_CHANGE_TEXT } from '../../shared/saveLocationChange';
import { restartForSaveLocation } from '../models/saveLocationChangeFlow';

// 「지금 재시작」 버튼 — 설정 화면 저장 경로 줄과 이 막대가 함께 쓴다.
export const SaveLocationRestartButton = observer(
  ({ className = '' }: { className?: string }) => {
    const [restarting, setRestarting] = useState(false);
    return (
      <button
        type="button"
        data-save-location-restart
        className={'round-button back-sky btn-sm flex-none ' + className}
        disabled={restarting}
        onClick={async () => {
          setRestarting(true);
          const ok = await restartForSaveLocation({ backend, appState });
          if (!ok) setRestarting(false);
        }}
      >
        {restarting ? '다시 시작하는 중…' : SAVE_LOCATION_CHANGE_TEXT.restartNow}
      </button>
    );
  },
);

const SaveLocationPendingBar = observer(() => {
  const pending = appState.saveLocationPending;
  if (!pending) return null;
  return (
    <div
      data-save-location-pending-bar
      role="status"
      className="flex items-center gap-3 px-3 py-1 text-sm border-b line-color bg-[var(--c-yellow-bg)] text-[color:var(--c-yellow-fg)]"
    >
      <span className="flex-1 min-w-0 truncate" title={pending.nextRoot}>
        {SAVE_LOCATION_CHANGE_TEXT.pendingNotice(pending.previousRoot)}
      </span>
      <SaveLocationRestartButton />
    </div>
  );
});

export default SaveLocationPendingBar;
