// 데이터 루트 디렉터리 오삭제 방어 (2026-07-06 실사고 재발 방지)
//
// 배경: 프로젝트 영구삭제가 루트 리터럴 + name 으로 경로를 조립하는데, name 이
// 빈 문자열이면 outs 루트 자체가 되어 전체 생성 이미지가
// 물리 삭제되는 사고가 실제로 발생했다. 이 모듈은 deleteDir 의 최종 관문으로,
// 어떤 호출 경로로 오든 보호 루트/비정상 경로 삭제를 거부한다.
//
// 주의: 'localai'/'models' 루트는 LocalAI 재설치가 정당하게 통째 삭제하므로
// 보호 목록에 넣지 않는다 (LocalAIService.ts:37-40).

import { PROJECT_DATA_ROOTS, WORKSPACE_ROOT } from '../models/projectPaths';

// 보호 루트: 구 데이터 루트 7종 + 신 물리 통합 루트(workspace, 트랙1 (b)).
// 단일 출처(projectPaths)에서 파생 — workspace 는 B1 시점부터 선제 보호한다
// (단일 세그먼트 'workspace' 통째 삭제 거부 = 신 배치 전체 유실 차단).
const PROTECTED_ROOTS = new Set<string>([...PROJECT_DATA_ROOTS, WORKSPACE_ROOT]);

// 삭제 불가 사유를 반환 (null = 삭제 허용). 순수 함수 — jest 단독 테스트 대상.
export function dirDeleteViolation(path: string): string | null {
  if (typeof path !== 'string') return '경로가 문자열이 아님';
  // 구분자 통일 + 앞뒤 슬래시 제거 후 세그먼트 검사
  const norm = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!norm.trim()) return '빈 경로';
  const segs = norm.split('/');
  if (segs.some((s) => !s.trim() || s === '.' || s === '..')) {
    return '비정상 세그먼트(빈 값/./..) 포함';
  }
  if (segs.length === 1 && PROTECTED_ROOTS.has(segs[0])) {
    return '보호된 데이터 루트';
  }
  return null;
}

// deleteDir 구현(electron/android)이 삭제 직전에 호출한다. 위반이면 throw.
export function assertDeletableDirPath(path: string): void {
  const violation = dirDeleteViolation(path);
  if (violation) {
    throw new Error(
      `디렉터리 삭제 거부(${violation}): ${JSON.stringify(path)}`,
    );
  }
}
