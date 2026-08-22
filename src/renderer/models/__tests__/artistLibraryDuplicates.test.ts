const readFile = jest.fn();
const renameFile = jest.fn(async () => {});
const copyFile: jest.Mock<any, any> = jest.fn(async () => {});
const deleteFile = jest.fn(async () => {});
const deleteDir = jest.fn(async () => {});
const write = jest.fn(async () => {});

jest.mock('..', () => ({
  backend: {
    readFile,
    renameFile,
    copyFile,
    deleteFile,
    deleteDir,
  },
}));

jest.mock('../PersistenceService', () => ({
  persistService: { write },
}));

import {
  ArtistLibraryService,
  IArtistEntry,
} from '../ArtistLibraryService';

const artist = (
  id: string,
  name: string,
  createdAt: number,
  paths: string[] = [],
): IArtistEntry => ({
  id,
  name,
  images: paths.map((path, index) => ({ id: `${id}-${index}`, path })),
  tags: [],
  favorite: false,
  createdAt,
  updatedAt: createdAt,
});

beforeEach(() => {
  jest.useFakeTimers();
  readFile.mockReset();
  renameFile.mockClear();
  copyFile.mockReset().mockResolvedValue(undefined);
  deleteFile.mockReset().mockResolvedValue(undefined);
  deleteDir.mockReset().mockResolvedValue(undefined);
  write.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('ArtistLibraryService 중복 작가 처리', () => {
  test('신규 생성은 공백과 대소문자만 다른 기존 작가를 재사용한다', () => {
    const service = new ArtistLibraryService();
    const first = service.createArtist('  Alice   Smith  ')!;
    const duplicate = service.createArtist('alice smith')!;

    expect(duplicate.id).toBe(first.id);
    expect(service.artists).toHaveLength(1);
    expect(first.name).toBe('Alice Smith');
  });

  test('일괄 병합은 동일 이름 그룹의 이미지와 태그를 가장 오래된 카드에 합친다', async () => {
    const service = new ArtistLibraryService();
    const target = artist('old', 'Alice Smith', 10, [
      'artist_library/old/cover.png',
    ]);
    target.tags = ['#rough'];
    const duplicate = artist('new', ' alice   smith ', 20, [
      'artist_library/new/a.webp',
      'artist_library/new/b.png',
    ]);
    duplicate.tags = ['#color'];
    duplicate.favorite = true;
    service.artists = [duplicate, target, artist('other', 'Bob', 30)];

    const result = await service.mergeDuplicateArtists();

    expect(result).toEqual({ groups: 1, mergedArtists: 1, copiedImages: 2 });
    expect(service.artists).toHaveLength(2);
    expect(service.getArtist('new')).toBeUndefined();
    const merged = service.getArtist('old')!;
    expect(merged.images).toHaveLength(3);
    expect(merged.images[0].path).toBe('artist_library/old/cover.png');
    expect(merged.tags).toEqual(['#rough', '#color']);
    expect(merged.favorite).toBe(true);
    expect(copyFile).toHaveBeenCalledTimes(2);
    expect(copyFile.mock.calls[0][0]).toBe('artist_library/new/a.webp');
    expect(copyFile.mock.calls[0][1]).toMatch(
      /^artist_library\/old\/.+\.webp$/,
    );
    expect(write).toHaveBeenCalledWith(
      'artist_library.json.tmp',
      expect.stringContaining('Alice Smith'),
    );
    expect(deleteDir).toHaveBeenCalledWith('artist_library/new');
  });

  test('이미지 복사 실패 시 기존 카드와 파일을 유지한다', async () => {
    const service = new ArtistLibraryService();
    service.artists = [
      artist('old', 'Alice', 10),
      artist('new', 'alice', 20, [
        'artist_library/new/a.png',
        'artist_library/new/b.png',
      ]),
    ];
    copyFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('copy failed'));

    await expect(service.mergeDuplicateArtists()).rejects.toThrow('copy failed');

    expect(service.artists).toHaveLength(2);
    expect(service.getArtist('new')).toBeDefined();
    expect(deleteDir).not.toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalledTimes(1);
  });

  test('라이브러리 JSON 저장 실패 시 병합을 되돌린다', async () => {
    const service = new ArtistLibraryService();
    service.artists = [
      artist('old', 'Alice', 10),
      artist('new', 'alice', 20, ['artist_library/new/a.png']),
    ];
    renameFile.mockRejectedValueOnce(new Error('rename failed'));
    write
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('save failed'));

    await expect(service.mergeDuplicateArtists()).rejects.toThrow('save failed');

    expect(service.artists).toHaveLength(2);
    expect(service.getArtist('new')).toBeDefined();
    expect(deleteDir).not.toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalledTimes(1);
  });
});
