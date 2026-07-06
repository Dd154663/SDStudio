/**
 * 데이터 루트 오삭제 방어 가드 (2026-07-06 outs 전체 증발 실사고 재발 방지)
 *
 * 사고 경로: 이름 없는 '.deleted' 파일 → 프로젝트명 '' 으로 스캔 → 만료
 * 다이얼로그 노출 → 영구삭제 → deleteDir('outs/' + '') = outs 루트 삭제.
 * 세 겹의 방어를 각각 검증한다:
 *  1) dataPathGuard: deleteDir 최종 관문 (보호 루트/비정상 경로 거부)
 *  2) TrashService 스캔: 점(.) 파일이 유령 프로젝트가 되지 않음
 *  3) permanentlyDeleteProject: 비정상 이름 즉시 거부(파일시스템 무접촉)
 */
import { dirDeleteViolation } from '../../backends/dataPathGuard';

jest.mock('../index', () => ({
  backend: {
    existFile: jest.fn(async () => false),
    readFile: jest.fn(async () => '{}'),
    listFiles: jest.fn(async (dir: string) =>
      dir === 'projects' ? ['.deleted', 'foo.deleted', 'bar.json'] : [],
    ),
    listFilesWithStats: jest.fn(async (dir: string) =>
      dir === 'projects'
        ? [{ name: '.deleted' }, { name: 'foo.deleted' }, { name: 'bar.json' }]
        : [],
    ),
    deleteFile: jest.fn(async () => {}),
    deleteDir: jest.fn(async () => {}),
  },
  imageService: {},
}));
jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));

import { TrashService } from '../TrashService';
import { backend } from '../index';

describe('dataPathGuard.dirDeleteViolation', () => {
  it('보호 루트 자체는 거부한다', () => {
    for (const p of [
      'outs',
      'outs/',
      '/outs',
      'inpaints',
      'vibes',
      'inpaint_masks',
      'inpaint_orgs',
      'references',
      'projects',
      'outs\\',
    ]) {
      expect(dirDeleteViolation(p)).not.toBeNull();
    }
  });

  it('빈/비정상 경로는 거부한다', () => {
    for (const p of ['', '   ', '/', '.', '..', 'outs/..', 'a/../b', 'outs//x', 'outs/ /x']) {
      expect(dirDeleteViolation(p)).not.toBeNull();
    }
  });

  it('정상적인 하위 경로와 허용 루트는 통과한다', () => {
    for (const p of [
      'outs/myproject',
      'outs/프로젝트/씬',
      'inpaints/a/b',
      'tmp/uuid',
      'localai', // LocalAI 재설치가 정당하게 루트 삭제 (보호 대상 아님)
      'models',
      'artist_library/some-id',
      'projects/폴더명',
    ]) {
      expect(dirDeleteViolation(p)).toBeNull();
    }
  });
});

describe('TrashService 유령 프로젝트 방어', () => {
  const newLoaded = async () => {
    const svc = new TrashService();
    await svc.loadTrash(); // existFile=false → 빈 데이터로 로드됨
    return svc;
  };

  beforeEach(() => {
    (backend.deleteDir as jest.Mock).mockClear();
    (backend.deleteFile as jest.Mock).mockClear();
  });

  it("점 파일('.deleted')은 삭제 대상 프로젝트로 잡히지 않는다", async () => {
    const svc = await newLoaded();
    const deleted = await svc.getDeletedProjects();
    const names = deleted.map((d) => d.name);
    expect(names).toContain('foo');
    expect(names).not.toContain('');
  });

  it('빈/공백/경로문자 이름의 영구삭제는 파일시스템을 건드리지 않는다', async () => {
    const svc = await newLoaded();
    for (const bad of ['', '   ', 'a/b', 'a\\b', '..']) {
      await svc.permanentlyDeleteProject(bad);
    }
    expect(backend.deleteDir).not.toHaveBeenCalled();
    expect(backend.deleteFile).not.toHaveBeenCalled();
  });

  it('정상 이름의 영구삭제는 하위 경로만 지운다 (루트 아님)', async () => {
    const svc = await newLoaded();
    await svc.permanentlyDeleteProject('foo');
    const calls = (backend.deleteDir as jest.Mock).mock.calls.map((c) => c[0]);
    expect(calls.length).toBeGreaterThan(0);
    for (const p of calls) {
      // 모든 삭제 경로가 '<루트>/foo' 형태 — 가드 위반 없음
      expect(p.endsWith('/foo')).toBe(true);
      expect(dirDeleteViolation(p)).toBeNull();
    }
  });
});
