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
    // 전역 저장소 동기화(W6 P2) — saveTrash 가 저장 후 브로드캐스트 호출
    notifyGlobalStoreChanged: jest.fn(async () => {}),
  },
  imageService: {
    invalidateCacheBatch: jest.fn(async () => {}),
  },
  templateService: { removeProject: jest.fn(async () => {}) },
}));
jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));

import { TrashService } from '../TrashService';
import { backend, imageService } from '../index';
import { persistService } from '../PersistenceService';

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
    // 6개 이미지 루트 전부 삭제 대상 — references 누락 회귀 방지 (2026-07-07 수정)
    expect(calls).toEqual(
      expect.arrayContaining([
        'outs/foo',
        'inpaints/foo',
        'vibes/foo',
        'inpaint_masks/foo',
        'inpaint_orgs/foo',
        'references/foo',
      ]),
    );
  });
});

describe('TrashService 이미지 휴지통 배치 캐시 정리', () => {
  const session = { name: 'project' } as any;
  const scene = { name: 'scene', type: 'scene' } as any;

  beforeEach(() => {
    (backend.readFile as jest.Mock).mockReset().mockResolvedValue(
      JSON.stringify({ 'a.webp': 1, 'b.webp': 2 }),
    );
    (backend.deleteFile as jest.Mock).mockReset().mockResolvedValue(undefined);
    (imageService.invalidateCacheBatch as jest.Mock).mockClear();
    (persistService.write as jest.Mock).mockClear();
  });

  it('여러 이미지를 삭제해도 캐시는 파일별이 아니라 한 번에 정리한다', async () => {
    const svc = new TrashService();
    const failed = await svc.permanentlyDeleteImages(
      session,
      scene,
      ['a.webp', 'b.webp'],
    );

    expect(failed).toBe(0);
    expect(imageService.invalidateCacheBatch).toHaveBeenCalledTimes(1);
    expect(imageService.invalidateCacheBatch).toHaveBeenCalledWith([
      'outs/project/scene/.trash/a.webp',
      'outs/project/scene/.trash/b.webp',
    ]);
  });

  it('삭제 실패 파일은 메타와 배치 캐시 정리 대상에 남기지 않는다', async () => {
    (backend.deleteFile as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('locked'));
    (backend.existFile as jest.Mock).mockResolvedValueOnce(true);
    const svc = new TrashService();

    const failed = await svc.permanentlyDeleteImages(
      session,
      scene,
      ['a.webp', 'b.webp'],
    );

    expect(failed).toBe(1);
    expect(imageService.invalidateCacheBatch).toHaveBeenCalledWith([
      'outs/project/scene/.trash/a.webp',
    ]);
    const metaWrite = (persistService.write as jest.Mock).mock.calls.find(
      (c) => c[0] === 'outs/project/scene/.trash/.trash_meta.json',
    );
    expect(JSON.parse(metaWrite[1])).toEqual({ 'b.webp': 2 });
  });
});

describe('TrashService 이름변경 키 이관 (renameProjectKeys)', () => {
  const loadWith = async (data: unknown) => {
    (backend.existFile as jest.Mock).mockResolvedValueOnce(true);
    (backend.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(data));
    const svc = new TrashService();
    await svc.loadTrash();
    return svc;
  };
  const lastTrashWrite = () => {
    const calls = (persistService.write as jest.Mock).mock.calls.filter(
      (c) => c[0] === 'trash.json',
    );
    return calls.length ? JSON.parse(calls[calls.length - 1][1]) : null;
  };

  beforeEach(() => {
    (persistService.write as jest.Mock).mockClear();
  });

  it("scenes 복합 키('이름:씬')와 projects 항목을 새 이름으로 옮긴다", async () => {
    const svc = await loadWith({
      scenes: {
        'old:sceneA': { sceneData: {}, deletedAt: 1 },
        'other:x': { sceneData: {}, deletedAt: 2 },
      },
      projects: { old: { deletedAt: 3 } },
    });
    await svc.renameProjectKeys('old', 'new');
    const saved = lastTrashWrite();
    expect(saved.scenes['new:sceneA']).toBeDefined();
    expect(saved.scenes['old:sceneA']).toBeUndefined();
    expect(saved.scenes['other:x']).toBeDefined(); // 무관 프로젝트 보존
    expect(saved.projects['new']).toEqual({ deletedAt: 3 });
    expect(saved.projects['old']).toBeUndefined();
  });

  it('이관 대상이 없으면 저장하지 않는다', async () => {
    const svc = await loadWith({ scenes: {}, projects: {} });
    await svc.renameProjectKeys('none', 'x');
    expect(lastTrashWrite()).toBeNull();
  });

  it('미로드 상태에서는 저장 없이 건너뛴다 (기존 기록 보호)', async () => {
    const svc = new TrashService(); // loadTrash 미호출 = !loaded
    await svc.renameProjectKeys('old', 'new');
    expect(lastTrashWrite()).toBeNull();
  });
});
