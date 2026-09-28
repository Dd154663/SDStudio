// 작가 라이브러리 백업 복원 시 샘플 이미지의 모델 계열(family) 보존
// (드라이브 동기화 C안 ② B4, 2026-09-28 — 전엔 복원하면 family 가 사라졌다).

const readFile = jest.fn();
const existFile = jest.fn(async () => true);
const copyFile = jest.fn(async () => {});
const write = jest.fn(async () => {});

jest.mock('..', () => ({
  backend: {
    readFile,
    existFile,
    copyFile,
    renameFile: jest.fn(async () => {}),
    deleteFile: jest.fn(async () => {}),
    deleteDir: jest.fn(async () => {}),
  },
}));
jest.mock('../PersistenceService', () => ({
  persistService: { write },
}));

import { ArtistLibraryService } from '../ArtistLibraryService';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('유효한 family(v4_5|v5)는 보존하고, 없거나 잘못된 값은 넣지 않는다', async () => {
  readFile.mockResolvedValueOnce(
    JSON.stringify({
      artists: [
        {
          name: 'Alice',
          images: [
            { id: 'i1', path: 'artist_library/x/i1.png', family: 'v5' },
            { id: 'i2', path: 'artist_library/x/i2.webp', family: 'v4_5' },
            { id: 'i3', path: 'artist_library/x/i3.png' },
            { id: 'i4', path: 'artist_library/x/i4.png', family: 'v9' },
          ],
          tags: [],
        },
      ],
    }),
  );
  const svc = new ArtistLibraryService();
  const res = await svc.restoreFromBackupDir('tmp/r', 'rename');
  expect(res).toEqual({ added: 1, skipped: 0, overwritten: 0 });
  const imgs = svc.artists[0].images;
  expect(imgs.map((i) => i.family)).toEqual(['v5', 'v4_5', undefined, undefined]);
  expect('family' in imgs[2]).toBe(false);
  expect('family' in imgs[3]).toBe(false);
  expect(imgs[1].path).toMatch(/\.webp$/);
});
