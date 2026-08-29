// 설정 파일/저장 경로 부팅 가드 창(데스크톱 전용 상태) — config.json 을 읽지
// 못했거나 지정 저장 폴더 접근 불가로 기본 위치에서 임시 실행 중일 때 화면 전체를
// 덮는다. 설정 파일 실패는 저장 경로를 알 수 없으므로 재시작 외 진행을 허용하지 않는다.
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
  const configFailure = appState.configLoadFailure;
  const [restarting, setRestarting] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  if (configFailure) {
    return (
      <GateShell>
        <div className="text-lg font-semibold text-red-500 dark:text-red-400">
          설정 파일을 읽을 수 없습니다
        </div>
        <div className="text-sm text-sub whitespace-pre-line leading-relaxed">
          {`저장 경로가 기록된 설정 파일을 읽지 못해 부팅을 중단했습니다. 잘못된 기본 위치로 계속 실행하면 프로젝트가 모두 사라진 것처럼 보일 수 있습니다.\n\n` +
            `설정 파일: ${configFailure.path}\n` +
            `오류: ${configFailure.code}\n\n` +
            `파일을 사용 중인 프로그램·백신·동기화 작업을 종료한 뒤 다시 시도해주세요. 같은 문제가 반복되면 설정 파일이 손상되었을 수 있으므로 삭제하거나 덮어쓰지 말고 별도로 보관해주세요. 기존 프로젝트 파일은 수정되지 않았습니다.`}
        </div>
        {recoveryError && (
          <div className="text-sm text-red-500 dark:text-red-400 whitespace-pre-line">
            {recoveryError}
          </div>
        )}
        {!resetConfirm ? (
          <div className="flex flex-col gap-2">
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
              {restarting ? '다시 시작하는 중…' : '앱 다시 시작하여 재시도'}
            </button>
            <button
              className="w-full px-4 py-2 rounded back-gray clickable"
              disabled={restarting}
              onClick={() => setResetConfirm(true)}
            >
              반복 실패 시 설정 복구
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="text-sm text-sub whitespace-pre-line">
              설정 파일을 별도 백업명으로 보존한 뒤 기본 설정으로 다시 시작합니다.
              프로젝트 파일은 건드리지 않지만, 사용자 지정 저장 위치와 앱 설정은
              환경설정에서 다시 지정해야 합니다.
            </div>
            <button
              className="w-full px-4 py-2 rounded back-orange clickable"
              disabled={restarting}
              onClick={async () => {
                setRestarting(true);
                setRecoveryError('');
                try {
                  const backupPath = await backend.backupFailedConfig();
                  console.log('손상 설정 백업:', backupPath);
                  await backend.restartApp();
                } catch (e: any) {
                  console.error('설정 파일 복구 실패:', e);
                  setRecoveryError(
                    `설정 파일을 백업하지 못했습니다. 파일 권한이나 잠금을 확인해주세요.\n(${String(
                      e?.message || e,
                    )})`,
                  );
                  setRestarting(false);
                }
              }}
            >
              {restarting ? '설정을 백업하는 중…' : '설정 파일 백업 후 초기화'}
            </button>
            <button
              className="w-full px-4 py-2 rounded back-gray clickable"
              disabled={restarting}
              onClick={() => setResetConfirm(false)}
            >
              돌아가기
            </button>
          </div>
        )}
      </GateShell>
    );
  }
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
