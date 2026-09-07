import { transferExportArchive } from '../exportArchiveTransfer';

const backend = {
  copyFileToAbsolute: jest.fn<Promise<'copied' | 'same-file'>, [string, string]>(),
  deleteFile: jest.fn<Promise<void>, [string]>(),
};
beforeEach(() => { jest.resetAllMocks(); backend.deleteFile.mockResolvedValue(); });
test('동일 파일 복사 결과는 원본 삭제를 호출하지 않는다', async () => {
  backend.copyFileToAbsolute.mockResolvedValue('same-file');
  await transferExportArchive(backend, 'exports/result.tar', 'exports/result.tar');
  expect(backend.deleteFile).not.toHaveBeenCalled();
});
test('다른 파일에 복사 성공한 경우에만 임시 원본을 삭제한다', async () => {
  backend.copyFileToAbsolute.mockResolvedValue('copied');
  expect(await transferExportArchive(backend, 'exports/result.tar', 'other/result.tar')).toEqual({ cleanupFailed: false });
  expect(backend.deleteFile).toHaveBeenCalledWith('exports/result.tar');
});
test('복사 실패 시 원본을 보존한다', async () => {
  backend.copyFileToAbsolute.mockRejectedValue(new Error('copy failed'));
  await expect(transferExportArchive(backend, 'exports/result.tar', 'other/result.tar')).rejects.toThrow('copy failed');
  expect(backend.deleteFile).not.toHaveBeenCalled();
});
test('정리 실패를 복사 실패로 전파하지 않아 재내보내기를 막는다', async () => {
  backend.copyFileToAbsolute.mockResolvedValue('copied');
  backend.deleteFile.mockRejectedValue(new Error('locked'));
  expect(await transferExportArchive(backend, 'exports/result.tar', 'other/result.tar')).toEqual({ cleanupFailed: true });
});
