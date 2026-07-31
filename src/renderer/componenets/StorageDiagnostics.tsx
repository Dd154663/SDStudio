import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { backend, sessionService } from '../models';
import {
  isWorkspaceLayout,
  STORAGE_MARKER_FILE,
  PROJECT_META_FILE,
} from '../models/storageLayout';
import { WORKSPACE_ROOT, PROJECT_JSON_ROOT } from '../models/projectPaths';
import { openStoragePermissionSettings } from '../models/storagePermissionGate';

// 저장소 진단 (모바일 환경설정 → 복구 탭).
//
// "프로젝트/이미지 증발처럼 보임" 근본 조사(2026-07-31,
// plans/android-storage-vanish-investigation.md) 보조 기능. Android 11+ 는
// '모든 파일 접근'이 없으면 이 설치본이 만들지 않은 파일을 오류 없이 숨기므로
// (FUSE), 권한 상태와 "물리 폴더 수 vs 앱이 인식한 파일 수"를 실측 대조해
// 숨김 의심 상태를 사용자에게 진단해 준다. 읽기 전용 — 아무것도 수정하지 않는다.

interface DiagRow {
  label: string;
  status: 'ok' | 'warn' | 'info';
  detail: string;
}

const statusIcon = (s: DiagRow['status']) =>
  s === 'ok' ? '✅' : s === 'warn' ? '⚠️' : 'ℹ️';

export const StorageDiagnosticsSection = observer(() => {
  const [rows, setRows] = useState<DiagRow[]>([]);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [permissionWarn, setPermissionWarn] = useState(false);

  const run = async () => {
    if (running) return;
    setRunning(true);
    const next: DiagRow[] = [];
    let permWarn = false;

    // 1) 모든 파일 접근 권한 (Android 11+ 전용 특수 권한)
    try {
      const { default: ZipPlugin } = await import('../backends/zipService');
      const st = await ZipPlugin.storagePermissionStatus({});
      if (!st.required) {
        next.push({
          label: '모든 파일 접근 권한',
          status: 'ok',
          detail: '이 안드로이드 버전(10 이하)은 해당 없음',
        });
      } else if (st.granted) {
        next.push({
          label: '모든 파일 접근 권한',
          status: 'ok',
          detail: '허용됨',
        });
      } else {
        permWarn = true;
        next.push({
          label: '모든 파일 접근 권한',
          status: 'warn',
          detail: '미허용 — 기존 파일이 시스템에 의해 숨겨질 수 있습니다',
        });
      }
    } catch {
      next.push({
        label: '모든 파일 접근 권한',
        status: 'info',
        detail: '상태를 조회할 수 없습니다',
      });
    }

    // 2) 저장소 배치 + 마커 파일 가시성
    const workspace = isWorkspaceLayout();
    try {
      const markerVisible = await backend.existFile(STORAGE_MARKER_FILE);
      if (workspace) {
        next.push({
          label: '저장소 배치',
          status: markerVisible ? 'ok' : 'warn',
          detail: markerVisible
            ? '신 배치(workspace) · 마커 정상'
            : '신 배치인데 마커 파일이 보이지 않음 — 파일 숨김 의심',
        });
      } else {
        next.push({
          label: '저장소 배치',
          status: 'info',
          detail: '구 배치(마이그레이션 전)',
        });
      }
    } catch {
      next.push({
        label: '저장소 배치',
        status: 'info',
        detail: '마커 확인 실패',
      });
    }

    // 3) 프로젝트 실측 대조 — 물리 폴더/파일 수 vs 앱 인식 수.
    //    (숨김 상태에선 폴더는 보이는데 그 안의 파일만 안 보인다)
    try {
      const recognized = sessionService.list().length;
      if (workspace) {
        const dirs = (await backend.listFiles(WORKSPACE_ROOT)).filter(
          (d) => !d.startsWith('.'),
        );
        let metaVisible = 0;
        for (const d of dirs) {
          try {
            if (
              await backend.existFile(
                `${WORKSPACE_ROOT}/${d}/${PROJECT_META_FILE}`,
              )
            ) {
              metaVisible++;
            }
          } catch (e) {}
        }
        const mismatch = metaVisible < dirs.length;
        next.push({
          label: '프로젝트 인식',
          status: mismatch ? 'warn' : 'ok',
          detail: mismatch
            ? `프로젝트 폴더 ${dirs.length}개 중 정보 파일(meta.json)이 보이는 폴더가 ${metaVisible}개뿐 — 파일 숨김 의심`
            : `프로젝트 폴더 ${dirs.length}개 · 앱 인식 ${recognized}개 — 정상`,
        });
      } else {
        const jsons = (await backend.listFiles(PROJECT_JSON_ROOT)).filter(
          (n) => !n.startsWith('.') && n.endsWith('.json'),
        );
        // 구 배치 숨김 의심: 프로젝트 파일은 0개인데 결과물 폴더 흔적은 있음
        let outsDirs = 0;
        try {
          outsDirs = (await backend.listFiles('outs')).filter(
            (d) => !d.startsWith('.'),
          ).length;
        } catch (e) {}
        const suspicious = jsons.length === 0 && outsDirs > 0;
        next.push({
          label: '프로젝트 인식',
          status: suspicious ? 'warn' : 'ok',
          detail: suspicious
            ? `프로젝트 파일이 0개인데 결과물 폴더가 ${outsDirs}개 존재 — 파일 숨김 의심`
            : `프로젝트 파일 ${jsons.length}개 · 앱 인식 ${recognized}개`,
        });
      }
    } catch {
      next.push({
        label: '프로젝트 인식',
        status: 'info',
        detail: '실측에 실패했습니다',
      });
    }

    // 4) 설정 파일 가시성 (정보성 — 최초 실행 직후엔 없을 수 있음)
    try {
      const cfg = await backend.existFile('config.json');
      next.push({
        label: '설정 파일(config.json)',
        status: 'info',
        detail: cfg ? '보임' : '보이지 않음 (최초 실행이면 정상)',
      });
    } catch (e) {}

    // 5) 저장 공간
    try {
      const free = await backend.getFreeSpace();
      if (free !== null) {
        next.push({
          label: '저장 공간 여유',
          status: free < 500 * 1024 * 1024 ? 'warn' : 'ok',
          detail: `${(free / (1024 * 1024 * 1024)).toFixed(1)} GB`,
        });
      }
    } catch (e) {}

    setRows(next);
    setPermissionWarn(permWarn);
    setRan(true);
    setRunning(false);
  };

  const hasWarn = rows.some((r) => r.status === 'warn');

  return (
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">
        저장소 진단
      </label>
      <p className="text-xs text-muted mb-2">
        프로젝트나 이미지가 갑자기 사라진 것처럼 보일 때 실행해 주세요. 권한
        상태와 데이터 인식 현황을 실측해 원인을 알려줍니다. 아무것도 수정하지
        않는 읽기 전용 검사입니다.
      </p>
      <button
        className="px-4 py-2 rounded-lg btn-solid-sky text-sm font-medium transition-colors disabled:opacity-40"
        disabled={running}
        onClick={run}
      >
        {running ? '진단 중...' : '진단 실행'}
      </button>
      {ran && (
        <div className="mt-3 flex flex-col gap-1.5">
          {rows.map((r, i) => (
            <div
              key={i}
              className="flex items-start gap-2 px-2.5 py-1.5 rounded-md border line-color text-xs"
            >
              <span className="flex-none">{statusIcon(r.status)}</span>
              <span className="font-medium text-default flex-none">
                {r.label}
              </span>
              <span className="text-muted">{r.detail}</span>
            </div>
          ))}
          {hasWarn ? (
            <div className="mt-1 px-2.5 py-2 rounded-md text-xs text-amber-600 dark:text-amber-400 border border-amber-400/40">
              ⚠️ 이상 징후가 있습니다. 파일이 삭제된 것이 아니라 안드로이드
              보안 정책이 기존 파일을 숨기고 있을 가능성이 큽니다. &ldquo;모든
              파일 접근&rdquo;을 허용한 뒤 앱을 완전히 종료하고 다시 실행해
              주세요 — 데이터가 그대로 표시됩니다.
            </div>
          ) : (
            <div className="mt-1 px-2.5 py-2 rounded-md text-xs text-green-600 dark:text-green-400 border border-green-500/40">
              ✅ 이상 없음 — 권한과 데이터 인식이 정상입니다.
            </div>
          )}
          {permissionWarn && (
            <button
              className="self-start mt-1 px-4 py-2 rounded-lg btn-solid-sky text-sm font-medium"
              onClick={() => {
                openStoragePermissionSettings().catch(() => {});
              }}
            >
              모든 파일 접근 설정 열기
            </button>
          )}
        </div>
      )}
    </div>
  );
});
