import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { backend, sessionService, templateService } from '../models';
import { appState } from '../models/AppService';
import {
  isWorkspaceLayout,
  STORAGE_MARKER_FILE,
  PROJECT_META_FILE,
  PROJECT_JSON_FILE,
} from '../models/storageLayout';
import {
  WORKSPACE_ROOT,
  PROJECT_JSON_ROOT,
  PROJECT_IMAGE_ROOTS,
} from '../models/projectPaths';
import { isOutputImageFile } from '../models/imageFormats';
import { openStoragePermissionSettings } from '../models/storagePermissionGate';

// 저장소 진단 (모바일 환경설정 → 복구 탭).
//
// "프로젝트/이미지 증발처럼 보임" 근본 조사(2026-07-31,
// plans/android-storage-vanish-investigation.md) 보조 기능. Android 11+ 는
// '모든 파일 접근'이 없으면 이 설치본이 만들지 않은 파일을 오류 없이 숨기므로
// (FUSE), 권한 상태와 "물리 폴더 수 vs 앱이 인식한 파일 수"를 실측 대조해
// 숨김 의심 상태를 사용자에게 진단해 준다. 검사 자체는 읽기 전용이며, 쓰기는
// 미인식 폴더의 [복원/부분 복구] 버튼을 사용자가 눌러 확인했을 때만 일어난다.

interface DiagRow {
  label: string;
  status: 'ok' | 'warn' | 'info';
  detail: string;
}

// 미인식(깨진) 프로젝트 폴더 — project.json 도 .deleted 도 없어 스캔이 입양하지
// 못하는 상태. hasBak 이면 완전 복원, hasImages 만 있으면 부분 복구 대상.
interface BrokenEntry {
  dir: string;
  name: string;
  hasBak: boolean;
  hasImages: boolean;
}

const statusIcon = (s: DiagRow['status']) =>
  s === 'ok' ? '✅' : s === 'warn' ? '⚠️' : 'ℹ️';

export const StorageDiagnosticsSection = observer(() => {
  const [rows, setRows] = useState<DiagRow[]>([]);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [permissionWarn, setPermissionWarn] = useState(false);
  const [fuseWarn, setFuseWarn] = useState(false);
  const [broken, setBroken] = useState<BrokenEntry[]>([]);
  const [repairing, setRepairing] = useState(false);

  const run = async () => {
    if (running) return;
    setRunning(true);
    const next: DiagRow[] = [];
    let permWarn = false;
    let hiddenSuspect = false;
    const brokenNext: BrokenEntry[] = [];

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

    // 3) 프로젝트 실측 대조 — 물리 폴더를 상태별로 분류한다.
    //    · meta.json 비가시 = FUSE 파일 숨김 의심 (폴더는 보이는데 내용만 안 보임)
    //    · project.json/.deleted 전무 = 미인식(깨진) 폴더 — 스캔이 조용히
    //      건너뛰므로 여기서 잡아 복구 대상으로 노출한다
    try {
      const recognizedAll = sessionService.list();
      const visibleCount =
        templateService.filterVisibleProjects(recognizedAll).length;
      const hiddenCount = recognizedAll.length - visibleCount;
      if (workspace) {
        const dirs = (await backend.listFiles(WORKSPACE_ROOT)).filter(
          (d) => !d.startsWith('.'),
        );
        let metaVisible = 0;
        let active = 0;
        let trashed = 0;
        let internalBroken = 0;
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
          try {
            if (
              await backend.existFile(
                `${WORKSPACE_ROOT}/${d}/${PROJECT_JSON_FILE}`,
              )
            ) {
              active++;
              continue;
            }
            if (
              await backend.existFile(
                `${WORKSPACE_ROOT}/${d}/${PROJECT_JSON_FILE}.deleted`,
              )
            ) {
              trashed++;
              continue;
            }
            // .bak 은 존재만이 아니라 유효성(파싱+name)까지 확인 — 서비스의
            // 복원 판정과 일치시켜 '복원' 안내가 실제 동작과 어긋나지 않게 한다.
            let hasBak = false;
            try {
              const bak = JSON.parse(
                await backend.readFile(
                  `${WORKSPACE_ROOT}/${d}/${PROJECT_JSON_FILE}.bak`,
                ),
              );
              hasBak =
                !!bak &&
                typeof bak === 'object' &&
                !Array.isArray(bak) &&
                typeof bak.name === 'string' &&
                !!bak.name;
            } catch (e) {}
            // 복구할 데이터 판정: outs 씬 폴더 안의 실제 이미지 파일, 없으면
            // 나머지 이미지 루트(inpaints/references 등)의 잔존 항목까지 확인.
            let hasImages = false;
            try {
              const sceneDirs = (
                await backend.listFiles(`${WORKSPACE_ROOT}/${d}/outs`)
              ).filter((f) => !f.startsWith('.') && !f.includes('.'));
              for (const s of sceneDirs) {
                try {
                  const files = await backend.listFiles(
                    `${WORKSPACE_ROOT}/${d}/outs/${s}`,
                  );
                  if (files.some(isOutputImageFile)) {
                    hasImages = true;
                    break;
                  }
                } catch (e) {}
              }
            } catch (e) {}
            if (!hasImages) {
              for (const root of PROJECT_IMAGE_ROOTS) {
                if (root === 'outs') continue;
                try {
                  if (
                    (
                      await backend.listFiles(`${WORKSPACE_ROOT}/${d}/${root}`)
                    ).filter((f) => !f.startsWith('.')).length > 0
                  ) {
                    hasImages = true;
                    break;
                  }
                } catch (e) {}
              }
            }
            let nm = d;
            try {
              const m = JSON.parse(
                await backend.readFile(
                  `${WORKSPACE_ROOT}/${d}/${PROJECT_META_FILE}`,
                ),
              );
              if (m && typeof m.name === 'string' && m.name) nm = m.name;
            } catch (e) {}
            // 숨김 시스템 프로젝트(퀵 생성·씬 템플릿) 잔재는 수동 복구 대상에서
            // 제외 — 복구해도 숨김이 유지돼 보이지 않거나, 자동 재생성된 동명과
            // 충돌해 '_복구N' 가시 좀비만 생긴다. .bak 자가치유(무해)는 스캔이
            // 그대로 적용하므로 여기서 막아도 데이터 복원 기회는 잃지 않는다.
            if (templateService.filterVisibleProjects([nm]).length === 0) {
              internalBroken++;
              continue;
            }
            brokenNext.push({ dir: d, name: nm, hasBak, hasImages });
          } catch (e) {}
        }
        const fuseHidden = metaVisible < dirs.length;
        if (fuseHidden) hiddenSuspect = true;
        next.push({
          label: '프로젝트 인식',
          status: fuseHidden || brokenNext.length > 0 ? 'warn' : 'ok',
          detail: fuseHidden
            ? `프로젝트 폴더 ${dirs.length}개 중 정보 파일(meta.json)이 보이는 폴더가 ${metaVisible}개뿐 — 파일 숨김 의심`
            : brokenNext.length > 0
              ? `프로젝트 폴더 ${dirs.length}개 · 정상 ${active}개 · 미인식 ${brokenNext.length}개${trashed > 0 ? ` · 휴지통 ${trashed}개` : ''}${internalBroken > 0 ? ` · 내부용 잔재 ${internalBroken}개` : ''}`
              : `프로젝트 폴더 ${dirs.length}개 · 정상 인식 ${active}개 · 화면 표시 ${visibleCount}개${hiddenCount > 0 ? ` (내부용 ${hiddenCount}개 제외)` : ''}${trashed > 0 ? ` · 휴지통 ${trashed}개` : ''}${internalBroken > 0 ? ` · 내부용 잔재 ${internalBroken}개` : ''} — 정상`,
        });
      } else {
        const recognized = recognizedAll.length;
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
        if (suspicious) hiddenSuspect = true;
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
    setFuseWarn(hiddenSuspect);
    setBroken(brokenNext);
    setRan(true);
    setRunning(false);
  };

  // 미인식 폴더 복구 — 사용자가 버튼으로 명시 확인했을 때만 쓰기가 일어난다.
  // .bak 있으면 완전 복원, 없으면 부분 복구(최소 project.json 생성) 후 기존
  // '이미지 복구'(recoverProjectImages)로 씬/이미지를 재구성한다.
  const repair = (b: BrokenEntry) => {
    appState.pushDialog({
      type: 'confirm',
      text: b.hasBak
        ? `'${b.name}' 프로젝트를 백업본에서 복원할까요?\n마지막 저장 직전 상태로 되돌아갑니다.`
        : `'${b.name}' 프로젝트는 설정 파일이 유실되어 부분 복구만 가능합니다.\n이미지와 씬 구성은 복원되지만, 프롬프트·프리셋 등 설정은 복구되지 않습니다.\n진행할까요?`,
      callback: async () => {
        if (repairing) return;
        setRepairing(true);
        try {
          // fromBak 은 서비스가 실제 수행한 복구 방식(재검증 결과) — 진단
          // 시점의 hasBak 과 어긋날 수 있어 이후 동작은 반환값을 따른다.
          const res = await sessionService.repairBrokenWorkspaceFolder(b.dir);
          const sess = await sessionService.get(res.name);
          if (sess) {
            appState.curSession = sess;
            if (res.fromBak) {
              appState.pushDialog({
                type: 'yes-only',
                text: `'${res.name}' 프로젝트를 백업본에서 복원했습니다.\n설정 화면을 닫으면 프로젝트가 표시됩니다.`,
              });
            } else {
              // 부분 복구 — outs/ 스캔으로 이미지를 재연결(결과는 자체 안내).
              await appState.recoverProjectImages();
            }
          }
        } catch (e) {
          appState.pushDialog({
            type: 'yes-only',
            text: '복구에 실패했습니다: ' + ((e as Error)?.message || e),
          });
        } finally {
          setRepairing(false);
        }
        run(); // 재진단으로 목록 갱신
      },
    });
  };

  const hasWarn = rows.some((r) => r.status === 'warn');

  return (
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">
        저장소 진단
      </label>
      <p className="text-xs text-muted mb-2">
        프로젝트나 이미지가 갑자기 사라진 것처럼 보일 때 실행해 주세요. 권한
        상태와 데이터 인식 현황을 실측해 원인을 알려줍니다. 검사 자체는
        아무것도 수정하지 않으며, 복구는 발견된 항목의 버튼을 눌러 확인했을
        때만 진행됩니다.
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
            permissionWarn || fuseWarn ? (
              <div className="mt-1 px-2.5 py-2 rounded-md text-xs text-amber-600 dark:text-amber-400 border border-amber-400/40">
                ⚠️ 이상 징후가 있습니다. 파일이 삭제된 것이 아니라 안드로이드
                보안 정책이 기존 파일을 숨기고 있을 가능성이 큽니다. &ldquo;모든
                파일 접근&rdquo;을 허용한 뒤 앱을 완전히 종료하고 다시 실행해
                주세요 — 데이터가 그대로 표시됩니다.
              </div>
            ) : broken.length > 0 ? (
              <div className="mt-1 px-2.5 py-2 rounded-md text-xs text-amber-600 dark:text-amber-400 border border-amber-400/40">
                ⚠️ 앱이 인식하지 못하는 프로젝트 폴더가 발견되었습니다. 아래
                목록에서 복구를 시도할 수 있습니다.
              </div>
            ) : (
              <div className="mt-1 px-2.5 py-2 rounded-md text-xs text-amber-600 dark:text-amber-400 border border-amber-400/40">
                ⚠️ 이상 징후가 있습니다. 진단 항목의 경고 내용을 확인해 주세요.
              </div>
            )
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
          {/* 권한/파일 숨김 의심 상태에서는 복구 섹션을 숨긴다 — 숨김 상태에선
              정상 프로젝트가 전부 미인식으로 오판되며, 그 위에 골격을 쓰면
              숨겨진 원본을 해칠 수 있다. 권한 안내가 우선. */}
          {!permissionWarn && !fuseWarn && broken.length > 0 && (
            <div className="mt-2">
              <label className="block text-sm font-semibold gray-label mb-1">
                미인식 프로젝트 복구
              </label>
              <p className="text-xs text-muted mb-2">
                아래 폴더는 프로젝트 파일(project.json)이 유실되어 앱이 인식하지
                못합니다. 백업본이 있으면 마지막 저장 상태로 복원되고, 없으면
                이미지와 씬 구성만 되살리는 부분 복구를 시도합니다(프롬프트·
                프리셋 등 설정은 복구되지 않습니다).
              </p>
              <div className="flex flex-col gap-1.5">
                {broken.map((b) => (
                  <div
                    key={b.dir}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border line-color text-xs"
                  >
                    <span className="font-medium text-default flex-1 truncate">
                      {b.name}
                    </span>
                    <span className="text-muted flex-none">
                      {b.hasBak
                        ? '백업본 있음'
                        : b.hasImages
                          ? '이미지 있음'
                          : '복구할 데이터 없음'}
                    </span>
                    {(b.hasBak || b.hasImages) && (
                      <button
                        className="flex-none px-3 py-1 rounded-lg btn-solid-orange text-xs font-medium disabled:opacity-40"
                        disabled={repairing}
                        onClick={() => repair(b)}
                      >
                        {b.hasBak ? '복원' : '부분 복구'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
