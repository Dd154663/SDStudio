// 글로벌 캐릭터 프리셋 파일 불러오기 정책(드라이브 동기화 C안 ② B2, 2026-09-28):
//  - 기본(rename) = 종전 동작(새 id, 동명은 `_n`)
//  - skip = 동명 제외(이미지도 저장하지 않음)
//  - overwrite = updateEntry 로 id 유지 갱신(프로젝트 fromGlobalId 링크 보존),
//    기존 이미지 정리, 한 기존 항목은 한 번만 덮어씀
//  - countFileConflicts = 기존 이름과 같은 파일 항목 수

const files: Record<string, string> = {};
let imageSeq = 0;
const backend = {
  readFile: jest.fn(async (p: string) => {
    if (!(p in files)) throw new Error('no file');
    return files[p];
  }),
  existFile: jest.fn(async () => false),
  renameFile: jest.fn(async () => {}),
  readDataFile: jest.fn(async () => null),
  writeDataFile: jest.fn(async () => {}),
  deleteFile: jest.fn(async () => {}),
  notifyGlobalStoreChanged: jest.fn(async () => {}),
};

jest.mock('..', () => ({ backend, imageService: {} }));
jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));
jest.mock('uuid', () => ({ v4: () => `u${++imageSeq}` }));
// types 는 무거운 모듈을 끌어오므로 스텁 — fromJSON/toJSON 은 얕은 복사 왕복
jest.mock('../types', () => ({
  CharacterPreset: {
    fromJSON: (j: any) => ({
      ...j,
      toJSON() {
        const { toJSON, ...rest } = this as any;
        return JSON.parse(JSON.stringify(rest));
      },
    }),
  },
  Session: class {},
}));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s }));

import { GlobalCharacterPresetService } from '../GlobalCharacterPresetService';

const seed = (
  svc: GlobalCharacterPresetService,
  entries: Array<{ id: string; name: string; vibe?: string; folder?: string }>,
) => {
  svc.presets = entries.map((e) => ({
    id: e.id,
    name: e.name,
    createdAt: 1,
    updatedAt: 1,
    preset: {
      name: e.name,
      prompt: 'old',
      vibes: e.vibe ? [{ path: e.vibe }] : [],
      characterReferences: [],
    } as any,
    ...(e.folder ? { folder: e.folder } : {}),
  }));
};

const fileItem = (name: string, prompt: string, withImage = false) => ({
  name,
  prompt,
  vibes: withImage ? [{ path: 'v.png' }] : [],
  characterReferences: [],
  ...(withImage ? { vibeImages: [{ filename: 'v.png', data: 'data:x' }] } : {}),
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  imageSeq = 0;
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('importFromFileData 정책', () => {
  it('기본(rename): 새 id 로 추가, 동명은 `_1`', async () => {
    const svc = new GlobalCharacterPresetService();
    seed(svc, [{ id: 'a', name: 'Alice' }]);
    const res = await svc.importFromFileData({
      presets: [fileItem('Alice', 'new'), fileItem('Bob', 'b')],
    });
    expect(res).toEqual({ added: 2, updated: 0, skipped: 0 });
    expect(svc.presets.map((p) => p.name)).toEqual(['Alice', 'Alice_1', 'Bob']);
    expect((svc.get('a')!.preset as any).prompt).toBe('old');
  });

  it('skip: 동명은 건너뛰고 이미지도 저장하지 않는다', async () => {
    const svc = new GlobalCharacterPresetService();
    seed(svc, [{ id: 'a', name: 'Alice' }]);
    const res = await svc.importFromFileData(
      { presets: [fileItem('Alice', 'new', true), fileItem('Bob', 'b')] },
      'skip',
    );
    expect(res).toEqual({ added: 1, updated: 0, skipped: 1 });
    expect(svc.presets.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    expect(backend.writeDataFile).not.toHaveBeenCalled();
  });

  it('overwrite: 같은 id 를 유지한 채 내용만 교체하고 안 쓰는 옛 이미지를 정리한다', async () => {
    const svc = new GlobalCharacterPresetService();
    seed(svc, [{ id: 'a', name: 'Alice', vibe: 'oldvibe.png', folder: '폴더1' }]);
    const res = await svc.importFromFileData(
      { presets: [{ ...fileItem('Alice', 'new', true), globalFolder: '폴더2' }] },
      'overwrite',
    );
    expect(res).toEqual({ added: 0, updated: 1, skipped: 0 });
    expect(svc.presets).toHaveLength(1);
    const e = svc.get('a')!;
    expect(e.name).toBe('Alice');
    expect((e.preset as any).prompt).toBe('new');
    expect(e.updatedAt).not.toBe(1); // 프로젝트 사본이 fromGlobalRev 차이로 갱신됨
    expect(e.preset.vibes[0].path).toMatch(/^u\d+\.png$/);
    expect(e.folder).toBe('폴더2');
    expect(backend.deleteFile).toHaveBeenCalledWith('global_char_images/oldvibe.png');
  });

  it('overwrite: 파일 안 같은 이름이 또 나오면 한 번만 덮어쓰고 나머지는 새 이름으로', async () => {
    const svc = new GlobalCharacterPresetService();
    seed(svc, [{ id: 'a', name: 'Alice' }]);
    const res = await svc.importFromFileData(
      { presets: [fileItem('Alice', 'first'), fileItem('Alice', 'second')] },
      'overwrite',
    );
    expect(res).toEqual({ added: 1, updated: 1, skipped: 0 });
    expect((svc.get('a')!.preset as any).prompt).toBe('first');
    expect(svc.presets.map((p) => p.name)).toEqual(['Alice', 'Alice_1']);
  });

  it('countFileConflicts: 이름 정규화(trim·빈 이름) 후 기존과 같은 항목 수', () => {
    const svc = new GlobalCharacterPresetService();
    seed(svc, [
      { id: 'a', name: 'Alice' },
      { id: 'n', name: '이름없음' },
    ]);
    expect(
      svc.countFileConflicts({
        presets: [fileItem(' Alice ', ''), fileItem('', ''), fileItem('Bob', ''), null],
      }),
    ).toBe(2);
    expect(svc.countFileConflicts({})).toBe(0);
  });

  it('형식 오류는 throw', async () => {
    const svc = new GlobalCharacterPresetService();
    await expect(svc.importFromFileData({})).rejects.toThrow(
      '올바른 캐릭터 프리셋 파일이 아닙니다',
    );
  });
});
