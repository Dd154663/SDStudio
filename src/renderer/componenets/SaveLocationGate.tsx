// 저장 경로 폴백 가드 창(데스크톱 전용 상태) — 지정 저장 폴더 접근 불가로 기본
// 위치에서 임시 실행 중일 때, 부팅 스피너 포함 화면 전체를 덮고 사용자가 상황을
// 확인해야만 메인 UI 를 노출한다.
//
// 배경: 조용히 기본 위치로 부팅하면 프로젝트 목록이 비어 보여 "프로젝트가 전부
// 초기화되었다"로 오해되기 쉽다(사후 다이얼로그는 게이트/다른 창에 가려짐).
// 2026-07-25 사용자 결정으로 전면 게이트로 격상.
//
// 색은 전부 --c-* 토큰, 버튼은 back-* 캡슐 클래스만 사용(MigrationGate 와 동일 —
// 다크·화이트 양 테마 가독성, specGuard).

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { backend } from '../models';
import { GateShell } from './MigrationGate';

const SaveLocationGate = observer(() => {
  const fb = appState.saveLocationFallback;
  const [restarting, setRestarting] = useState(false);
  if (!fb || appState.saveLocationFallbackAcked) return null;
  return (
    <GateShell>
      <div className="text-lg font-semibold text-red-500 dark:text-red-400">
        저장 폴더에 접근할 수 없습니다
      </div>
      <div className="text-sm text-sub whitespace-pre-line leading-relaxed">
        {`지정한 저장 위치에 접근할 수 없어(${fb.code}) 임시로 기본 위치에서 실행 중입니다.\n\n` +
          `지정 위치: ${fb.attempted}\n\n` +
          `기존 프로젝트는 사라진 것이 아닙니다 — 위 위치에 그대로 있습니다. ` +
          `지금 화면의 프로젝트 목록은 기본 위치 기준이라 비어 보이거나 다르게 보일 수 있습니다.\n\n` +
          `외장/네트워크 드라이브라면 연결·로그인 상태를 확인한 뒤 앱을 다시 시작해주세요.`}
      </div>
      <div className="flex flex-col gap-2 mt-1">
        <button
          className="w-full px-4 py-2 rounded back-sky clickable"
          disabled={restarting}
          onClick={async () => {
            setRestarting(true);
            try {
              await backend.restartApp();
            } catch (e) {
              console.error('앱 재시작 실패:', e);
              setRestarting(false);
            }
          }}
        >
          {restarting ? '다시 시작하는 중…' : '앱 다시 시작 (권장)'}
        </button>
        <button
          className="w-full px-4 py-2 rounded back-gray clickable"
          onClick={() => {
            appState.saveLocationFallbackAcked = true;
          }}
        >
          기본 위치로 계속 (임시)
        </button>
        <div className="text-xs text-muted">
          계속하면 이번 실행 동안 새로 만드는 프로젝트/이미지는 기본 위치에
          저장됩니다. 저장 위치를 바꾸려면 환경설정 → 이미지에서 다시
          지정해주세요.
        </div>
      </div>
    </GateShell>
  );
});

export default SaveLocationGate;
