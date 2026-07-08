// 신 배치(workspace/, storage v2)의 런타임 상태 — 활성 플래그 + 이름→물리폴더 레지스트리.
//
// projectPaths 와 같은 리프(leaf) 모듈(무의존) — projectPaths(경로 분기)·
// 마이그레이터·부트스트랩·스캔이 공유한다. 스펙: track1-b-migration-spec.md §2·§5.
//
// 핵심 계약:
// - 물리 폴더명은 생성/마이그레이션 시 1회 고정(makeWorkspaceDirName)되고
//   이름변경에도 불변 — rename 은 meta.json/레지스트리 키 갱신뿐.
// - 활성(active) 여부의 진실 = 데이터 루트의 storage_version.json 마커.
//   이 모듈은 부트스트랩이 마커를 읽어 반영한 캐시일 뿐이다.
// - 레지스트리는 스캔(신 배치 목록)·생성·이름변경·삭제 시점에만 갱신한다.

export const STORAGE_MARKER_FILE = 'storage_version.json';
export const MIGRATION_LEDGER_FILE = 'migration_ledger.json';
export const PROJECT_META_FILE = 'meta.json';
export const PROJECT_JSON_FILE = 'project.json';

// meta.json 파일 포맷 (프로젝트당 초소형 사이드카 — 이름/폴더/id 의 단일 출처)
export interface WorkspaceProjectMeta {
  version: 1;
  id: string; // 세션 uuid v4 (Session.id 와 동일)
  name: string; // 논리 이름 (사이드카·UI 키)
  folder: string; // 논리 폴더 경로 ('' = 루트)
}

let active = false;
const dirByName = new Map<string, string>();

export function isWorkspaceLayout(): boolean {
  return active;
}

// 부트스트랩/마이그레이터 전용 — 마커 확인 직후, 스캔 전에 호출.
// false 전환은 테스트 복귀용(런타임에서 비활성화 흐름은 없음).
export function setWorkspaceLayoutActive(value: boolean): void {
  active = value;
  if (!value) dirByName.clear();
}

export function physicalDirOf(name: string): string | undefined {
  return dirByName.get(name);
}

export function registerProjectDir(name: string, dir: string): void {
  dirByName.set(name, dir);
}

export function unregisterProjectDir(name: string): void {
  dirByName.delete(name);
}

export function renameProjectDirKey(oldName: string, newName: string): void {
  const dir = dirByName.get(oldName);
  if (dir !== undefined) {
    dirByName.delete(oldName);
    dirByName.set(newName, dir);
  }
}

// 역조회(물리폴더 → 논리 이름) — 워처 경로 파싱용. 호출 빈도가 낮아 선형 탐색.
export function nameOfPhysicalDir(dir: string): string | undefined {
  for (const [name, d] of dirByName) {
    if (d === dir) return name;
  }
  return undefined;
}

// Windows 금지 문자 목록 (경로 구분자 포함). 제어문자는 charCode 검사로 거른다
// — 정규식 유니코드 이스케이프를 소스에 쓰지 않는 이유: 리터럴 제어문자가
// 파일에 박히는 도구 사고 전례가 있어 회피.
const FORBIDDEN_DIR_CHARS = '<>:"/\\|?*';

// 물리 폴더명 생성: '정제이름__짧은id' (스펙 §2-2). 생성/마이그레이션 시 1회만.
// - NFC 정규화, Windows 금지문자·제어문자 제거, 앞뒤 점/공백 제거, 40자 절단
// - 빈 결과는 'project' 폴백, 유일성은 id(uuid) 접미가 보장
export function makeWorkspaceDirName(name: string, id: string): string {
  const shortId = id.replace(/-/g, '').slice(0, 8) || 'noid';
  let base = '';
  for (const ch of name.normalize('NFC')) {
    if (ch.charCodeAt(0) < 32) continue;
    if (FORBIDDEN_DIR_CHARS.includes(ch)) continue;
    base += ch;
  }
  base = base
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  if (base.length > 40) {
    base = base.slice(0, 40).trim().replace(/[. ]+$/g, '');
  }
  if (!base) base = 'project';
  return base + '__' + shortId;
}
