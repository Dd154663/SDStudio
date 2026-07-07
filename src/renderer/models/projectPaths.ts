// 프로젝트 데이터 경로 단일 출처 (SPEC_GUIDE §9)
//
// 프로젝트 1개의 데이터는 아래 7개 루트에 "프로젝트 이름"을 키로 흩어져
// 저장된다(트랙1 조사 보고서 참조). 이 경로들의 문자열 조립은 반드시 이
// 모듈을 거친다 — 루트 리터럴 결합('outs/' + name 등)은 specGuard 가 차단.
//
// 이름 검증을 조립 시점에 강제하는 것이 핵심: 빈 이름이 루트 자체가 되어
// outs 전체가 물리 삭제된 실사고(2026-07-06, project_data_root_guard)의
// 재발을 dataPathGuard(삭제 최종 관문)보다 앞 단계에서 차단한다.
//
// 주의: 이 모듈은 의존성 없는 리프(leaf)여야 한다 — backends(dataPathGuard)와
// models 양쪽에서 import 하므로 순환을 만들지 말 것.

export const PROJECT_JSON_ROOT = 'projects';

// 이미지/부속 데이터 6루트. 순서는 정규 순서(백업·복제·삭제 루프가 공유) —
// 각 루트 작업은 상호 독립이라 순서 자체는 동작에 영향 없음.
export const PROJECT_IMAGE_ROOTS = [
  'outs',
  'inpaints',
  'inpaint_orgs',
  'inpaint_masks',
  'vibes',
  'references',
] as const;

export type ProjectImageRoot = (typeof PROJECT_IMAGE_ROOTS)[number];
export type ProjectDataRoot = ProjectImageRoot | typeof PROJECT_JSON_ROOT;

// 전체 보호 대상 루트(7종) — dataPathGuard.PROTECTED_ROOTS 가 이 목록에서 파생.
export const PROJECT_DATA_ROOTS: readonly ProjectDataRoot[] = [
  ...PROJECT_IMAGE_ROOTS,
  PROJECT_JSON_ROOT,
];

// 씬 폴더형 루트: <root>/<프로젝트>/<씬>/ 아래에 이미지 파일들
export const PROJECT_SCENE_IMAGE_ROOTS: readonly ProjectImageRoot[] = [
  'outs',
  'inpaints',
];
// 씬 파일형 루트: <root>/<프로젝트>/<씬>.png 단일 파일
export const PROJECT_SCENE_MASK_ROOTS: readonly ProjectImageRoot[] = [
  'inpaint_masks',
  'inpaint_orgs',
];

// 프로젝트 이름이 경로 세그먼트로 쓰일 수 없는 사유를 반환 (null = 유효).
// 순수 함수 — jest 단독 테스트 대상. 기준은 dataPathGuard 세그먼트 검사와
// 일치시키되, 점(.) 시작 이름도 거부한다(스캔이 점 파일을 제외하므로 그런
// 프로젝트는 애초에 존재할 수 없고, '.trash' 등 예약 디렉터리와 충돌).
export function invalidProjectName(name: string): string | null {
  if (typeof name !== 'string') return '이름이 문자열이 아님';
  if (!name.trim()) return '빈/공백 이름';
  if (name.includes('/') || name.includes('\\')) return '경로 구분자 포함';
  if (name === '.' || name === '..') return '예약 세그먼트';
  if (name.startsWith('.')) return '점(.) 시작 이름';
  return null;
}

export function assertValidProjectName(name: string): void {
  const reason = invalidProjectName(name);
  if (reason) {
    throw new Error(`잘못된 프로젝트 이름(${reason}): ${JSON.stringify(name)}`);
  }
}

// 하위 세그먼트(씬 이름·파일명 등) 검사 — 빈 값과 상위 탈출('.'/'..')만 거부.
// '.trash' 같은 점 시작 세그먼트와 이름 속 점(a.b)은 정상이므로 허용한다.
// 세그먼트 안에 '/' 가 섞여 들어와도(조합 경로) 부분별로 검사한다.
function assertValidSegments(segments: string[]): void {
  for (const seg of segments) {
    if (typeof seg !== 'string' || !seg.trim()) {
      throw new Error(`잘못된 경로 세그먼트(빈 값): ${JSON.stringify(seg)}`);
    }
    for (const part of seg.split('/')) {
      if (!part.trim() || part === '.' || part === '..') {
        throw new Error(
          `잘못된 경로 세그먼트(빈 값/./..): ${JSON.stringify(seg)}`,
        );
      }
    }
  }
}

// '<root>/<프로젝트이름>[/<세그먼트>...]' — 프로젝트 데이터 경로 조립의 관문.
// 기존 문자열 결합('outs/' + name + '/' + scene)과 바이트 동일한 결과를 낸다.
export function projectPath(
  root: ProjectDataRoot,
  name: string,
  ...segments: string[]
): string {
  assertValidProjectName(name);
  assertValidSegments(segments);
  return segments.length
    ? root + '/' + name + '/' + segments.join('/')
    : root + '/' + name;
}

// 'projects/<폴더경로>' — 폴더는 중첩('a/b')이 정상이므로 이름 검증 대신
// 세그먼트 검사만 한다.
export function projectFolderPath(folder: string): string {
  assertValidSegments([folder]);
  return PROJECT_JSON_ROOT + '/' + folder;
}

// 'projects/[<폴더>/]<이름>.json' — 세션 본체 파일 경로.
export function projectJsonPath(name: string, folder?: string | null): string {
  assertValidProjectName(name);
  if (folder) {
    assertValidSegments([folder]);
    return PROJECT_JSON_ROOT + '/' + folder + '/' + name + '.json';
  }
  return PROJECT_JSON_ROOT + '/' + name + '.json';
}
