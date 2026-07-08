/**
 * projectPaths — 프로젝트 데이터 경로 단일 출처 (SPEC_GUIDE §9, 트랙1 A1)
 *
 * 1) 바이트 동일성: 치환 전 문자열 결합과 결과가 정확히 같아야 한다
 *    (경로가 1바이트라도 달라지면 기존 사용자 데이터를 못 찾는다).
 * 2) 이름 검증: 빈/경로문자 이름이 조립 시점에 차단된다
 *    (2026-07-06 outs 증발 실사고의 1차 방어선).
 * 3) dataPathGuard 와 보호 루트 목록이 단일 출처로 동기화된다.
 */
import {
  PROJECT_DATA_ROOTS,
  PROJECT_IMAGE_ROOTS,
  PROJECT_JSON_ROOT,
  PROJECT_SCENE_IMAGE_ROOTS,
  PROJECT_SCENE_MASK_ROOTS,
  WORKSPACE_ROOT,
  invalidProjectName,
  projectFolderPath,
  projectJsonPath,
  projectPath,
  resolveProjectDir,
} from '../projectPaths';
import { dirDeleteViolation } from '../../backends/dataPathGuard';
import {
  setWorkspaceLayoutActive,
  registerProjectDir,
} from '../storageLayout';

describe('projectPath 바이트 동일성 (기존 문자열 결합 대비)', () => {
  const name = '내 프로젝트';
  const scene = '씬 A';

  it('대표 조립 형태가 레거시 결합과 정확히 일치한다', () => {
    // ImageService.getImageDir / getInPaintDir
    expect(projectPath('outs', name, scene)).toBe('outs/' + name + '/' + scene);
    expect(projectPath('inpaints', name, scene)).toBe(
      'inpaints/' + name + '/' + scene,
    );
    // ImageService.getVibesDir / getEncodedVibesDir / getReferenceDir
    expect(projectPath('vibes', name)).toBe('vibes/' + name);
    expect(projectPath('vibes', name, 'encoded')).toBe(
      'vibes/' + name + '/encoded',
    );
    expect(projectPath('references', name)).toBe('references/' + name);
    // SessionService.getInpaintOrgPath / getInpaintMaskPath
    expect(projectPath('inpaint_orgs', name, scene + '.png')).toBe(
      'inpaint_orgs/' + name + '/' + scene + '.png',
    );
    expect(projectPath('inpaint_masks', name, scene + '.png')).toBe(
      'inpaint_masks/' + name + '/' + scene + '.png',
    );
    // 다중 세그먼트 (씬/이미지)
    expect(projectPath('outs', name, scene, 'img.png')).toBe(
      'outs/' + name + '/' + scene + '/img.png',
    );
    // 점 시작 세그먼트('.trash')는 허용 — 휴지통 경로
    expect(projectPath('outs', name, scene, '.trash')).toBe(
      'outs/' + name + '/' + scene + '/.trash',
    );
  });

  it('projects 계열 경로가 레거시 결합과 일치한다', () => {
    expect(projectJsonPath(name)).toBe('projects/' + name + '.json');
    expect(projectJsonPath(name, 'a/b')).toBe(
      'projects/a/b/' + name + '.json',
    );
    expect(projectFolderPath('폴더')).toBe('projects/폴더');
    expect(projectFolderPath('a/b')).toBe('projects/a/b');
  });
});

describe('이름/세그먼트 검증 (조립 시점 차단)', () => {
  it('비정상 프로젝트 이름은 throw 한다', () => {
    for (const bad of ['', '   ', 'a/b', 'a\\b', '.', '..', '.hidden']) {
      expect(invalidProjectName(bad)).not.toBeNull();
      expect(() => projectPath('outs', bad)).toThrow();
      expect(() => projectJsonPath(bad)).toThrow();
    }
  });

  it('정상 이름은 통과한다 (한글·점 포함·점 2개 연속 부분 문자열)', () => {
    for (const ok of ['한글 프로젝트', 'a..b', 'foo.bar', 'proj (2)']) {
      expect(invalidProjectName(ok)).toBeNull();
      expect(() => projectPath('outs', ok)).not.toThrow();
    }
  });

  it('비정상 세그먼트(빈 값/./..·탈출 조합)는 throw 한다', () => {
    expect(() => projectPath('outs', 'p', '')).toThrow();
    expect(() => projectPath('outs', 'p', '  ')).toThrow();
    expect(() => projectPath('outs', 'p', '..')).toThrow();
    expect(() => projectPath('outs', 'p', 'a/../b')).toThrow();
    expect(() => projectFolderPath('..')).toThrow();
    expect(() => projectFolderPath('a//b')).toThrow();
    expect(() => projectJsonPath('p', '../x')).toThrow();
  });
});

describe('루트 목록 단일 출처', () => {
  it('PROJECT_DATA_ROOTS = 이미지 6루트 + projects', () => {
    expect(PROJECT_IMAGE_ROOTS).toHaveLength(6);
    expect(PROJECT_DATA_ROOTS).toHaveLength(7);
    expect(PROJECT_DATA_ROOTS).toContain(PROJECT_JSON_ROOT);
    // 씬형 하위 분류는 이미지 루트의 부분집합
    for (const r of [...PROJECT_SCENE_IMAGE_ROOTS, ...PROJECT_SCENE_MASK_ROOTS]) {
      expect(PROJECT_IMAGE_ROOTS).toContain(r);
    }
  });

  it('dataPathGuard 가 모든 데이터 루트를 보호한다 (파생 동기화)', () => {
    for (const root of PROJECT_DATA_ROOTS) {
      expect(dirDeleteViolation(root)).not.toBeNull(); // 루트 자체 삭제 거부
      expect(dirDeleteViolation(root + '/어떤프로젝트')).toBeNull(); // 하위는 허용
    }
  });

  it('dataPathGuard 가 신 루트(workspace)도 보호한다 (트랙1 (b))', () => {
    expect(dirDeleteViolation(WORKSPACE_ROOT)).not.toBeNull(); // 루트 자체 삭제 거부
    expect(dirDeleteViolation(WORKSPACE_ROOT + '/어떤폴더')).toBeNull(); // 하위는 허용
  });
});

describe('resolveProjectDir — 리졸버 항등 시임 (트랙1 (b) B1, §5)', () => {
  it('B1 시점엔 유효 이름을 그대로 반환한다 (항등)', () => {
    for (const name of ['내 프로젝트', 'foo.bar', 'proj (2)']) {
      expect(resolveProjectDir(name)).toBe(name);
    }
  });

  it('불량 이름은 throw 한다 (빈/`..`/구분자)', () => {
    for (const bad of ['', '   ', '..', 'a/b', 'a\\b']) {
      expect(() => resolveProjectDir(bad)).toThrow();
    }
  });
});

describe('신 배치(workspace) 활성 시 경로 분기 (트랙1 (b) B2, §2·§5)', () => {
  const name = '내 프로젝트';
  const dir = '내 프로젝트__ab12cd34';
  const scene = '씬 A';

  beforeEach(() => {
    setWorkspaceLayoutActive(true);
    registerProjectDir(name, dir);
  });
  afterEach(() => {
    // 활성=false 로 복귀(레지스트리도 clear) — 다른 테스트 회귀 방지.
    setWorkspaceLayoutActive(false);
  });

  it('projectPath 가 workspace/<물리폴더>/<root>/<세그먼트> 로 접힌다', () => {
    expect(projectPath('outs', name, scene)).toBe(
      'workspace/' + dir + '/outs/' + scene,
    );
    expect(projectPath('vibes', name)).toBe('workspace/' + dir + '/vibes');
    expect(projectPath('outs', name, scene, 'img.png')).toBe(
      'workspace/' + dir + '/outs/' + scene + '/img.png',
    );
    // 씬 휴지통(.trash) 세그먼트도 유지
    expect(projectPath('outs', name, '.trash', scene)).toBe(
      'workspace/' + dir + '/outs/.trash/' + scene,
    );
  });

  it('projectJsonPath 는 folder 인자를 무시하고 project.json 을 가리킨다', () => {
    expect(projectJsonPath(name)).toBe('workspace/' + dir + '/project.json');
    expect(projectJsonPath(name, 'a/b')).toBe(
      'workspace/' + dir + '/project.json',
    );
  });

  it('resolveProjectDir 는 등록된 물리 폴더를 반환한다', () => {
    expect(resolveProjectDir(name)).toBe(dir);
  });

  it('미등록 이름은 throw 한다 (조용한 구경로 폴백 금지 — split 방지)', () => {
    expect(() => projectPath('outs', '등록안된프로젝트')).toThrow();
    expect(() => projectJsonPath('등록안된프로젝트')).toThrow();
    expect(() => resolveProjectDir('등록안된프로젝트')).toThrow();
  });

  it('활성 상태에서도 빈/불량 이름은 조립 시점에 차단된다', () => {
    for (const bad of ['', '   ', 'a/b', '..']) {
      expect(() => projectPath('outs', bad)).toThrow();
      expect(() => projectJsonPath(bad)).toThrow();
    }
  });
});
