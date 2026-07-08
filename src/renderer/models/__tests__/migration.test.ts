/**
 * 트랙1 (b) 저장소 v2 마이그레이션 — 순수 판정 로직 단위 테스트.
 *
 * 무거운 index.ts(전 서비스 배선)를 mock 으로 우회하고, detect() 판정과
 * 이름 배정(동명 복구 §3-4)·재개 선점 로직을 검증한다. 스펙: track1-b-migration-spec.md §3.
 */

// 마이그레이션 detect() 가 참조하는 backend 만 얇게 stub.
const backendMock = {
  existFile: jest.fn(async (_p: string) => false),
  listFiles: jest.fn(async (_p: string) => [] as string[]),
  listFilesWithStats: jest.fn(async (_p: string) => [] as { name: string }[]),
  readFile: jest.fn(async (_p: string) => '{}'),
  writeFile: jest.fn(async () => {}),
  getVersion: jest.fn(async () => '0.0.0-test'),
  getFreeSpace: jest.fn(async () => null),
};

jest.mock('../index', () => ({
  backend: backendMock,
  zipService: { zipFiles: jest.fn(async () => {}) },
}));

import {
  classifyDetection,
  resolveRecoveryName,
  assignLogicalNames,
  migrationService,
  RawProjectEntry,
} from '../MigrationService';

describe('classifyDetection (스펙 §3-2)', () => {
  it('마커 있음 + 잔존 json 있음 = legacy(증분)', () => {
    expect(classifyDetection(true, true)).toBe('legacy');
  });
  it('마커 있음 + 잔존 없음 = none', () => {
    expect(classifyDetection(true, false)).toBe('none');
  });
  it('마커 없음 + 잔존 없음 = fresh(신규 사용자)', () => {
    expect(classifyDetection(false, false)).toBe('fresh');
  });
  it('마커 없음 + 잔존 있음 = legacy(최초 마이그레이션)', () => {
    expect(classifyDetection(false, true)).toBe('legacy');
  });
});

describe('resolveRecoveryName (동명 복구 §3-4)', () => {
  it('선점되지 않은 이름은 그대로', () => {
    expect(resolveRecoveryName('foo', new Set())).toBe('foo');
  });
  it('선점된 이름은 _복구2 부터', () => {
    expect(resolveRecoveryName('foo', new Set(['foo']))).toBe('foo_복구2');
  });
  it('복구2 까지 선점되면 복구3', () => {
    expect(resolveRecoveryName('foo', new Set(['foo', 'foo_복구2']))).toBe(
      'foo_복구3',
    );
  });
});

describe('assignLogicalNames (이름 배정·이미지 귀속 §3-4)', () => {
  it('동명 2개: 첫째=원래 이름(이미지 귀속), 둘째=복구2(이미지 미귀속)', () => {
    const entries: RawProjectEntry[] = [
      { folder: '', name: 'proj', deleted: false },
      { folder: 'a', name: 'proj', deleted: false },
    ];
    const out = assignLogicalNames(entries);
    expect(out[0]).toMatchObject({ logicalName: 'proj', moveImages: true });
    expect(out[1]).toMatchObject({ logicalName: 'proj_복구2', moveImages: false });
  });

  it('동명 3개: 복구2, 복구3', () => {
    const entries: RawProjectEntry[] = [
      { folder: '', name: 'x', deleted: false },
      { folder: 'a', name: 'x', deleted: false },
      { folder: 'b', name: 'x', deleted: false },
    ];
    const out = assignLogicalNames(entries).map((e) => e.logicalName);
    expect(out).toEqual(['x', 'x_복구2', 'x_복구3']);
  });

  it('재개: 완료된 이름/이미지 원본 선점을 존중', () => {
    // 첫째가 이미 완료(원장 done)되어 남은 항목만 재배정하는 상황.
    const entries: RawProjectEntry[] = [
      { folder: 'a', name: 'proj', deleted: false },
    ];
    const out = assignLogicalNames(entries, ['proj'], ['proj']);
    expect(out[0]).toMatchObject({
      logicalName: 'proj_복구2',
      moveImages: false,
    });
  });

  it('서로 다른 이름은 이미지 각자 귀속', () => {
    const entries: RawProjectEntry[] = [
      { folder: '', name: 'a', deleted: false },
      { folder: '', name: 'b', deleted: true },
    ];
    const out = assignLogicalNames(entries);
    expect(out[0]).toMatchObject({ moveImages: true, deleted: false });
    expect(out[1]).toMatchObject({ moveImages: true, deleted: true });
  });
});

describe('migrationService.detect() (마커+스캔 조합)', () => {
  beforeEach(() => {
    backendMock.existFile.mockReset().mockResolvedValue(false);
    backendMock.listFiles.mockReset().mockResolvedValue([]);
    backendMock.listFilesWithStats.mockReset().mockResolvedValue([]);
  });

  it('마커 없음 + projects/ 비어 있음 = fresh', async () => {
    expect(await migrationService.detect()).toBe('fresh');
  });

  it('마커 없음 + projects/ 에 json 존재 = legacy', async () => {
    backendMock.listFiles.mockImplementation(async (p: string) =>
      p === 'projects' ? ['a.json'] : [],
    );
    backendMock.listFilesWithStats.mockImplementation(async (p: string) =>
      p === 'projects' ? [{ name: 'a.json' }] : [],
    );
    expect(await migrationService.detect()).toBe('legacy');
  });

  it('마커 있음 + projects/ 비어 있음 = none', async () => {
    backendMock.existFile.mockImplementation(
      async (p: string) => p === 'storage_version.json',
    );
    expect(await migrationService.detect()).toBe('none');
  });

  it('점 파일/.json.bak 은 잔존 항목으로 세지 않는다', async () => {
    backendMock.listFiles.mockImplementation(async (p: string) =>
      p === 'projects' ? ['.deleted', 'a.json.bak'] : [],
    );
    backendMock.listFilesWithStats.mockImplementation(async (p: string) =>
      p === 'projects' ? [{ name: '.deleted' }, { name: 'a.json.bak' }] : [],
    );
    expect(await migrationService.detect()).toBe('fresh');
  });
});
