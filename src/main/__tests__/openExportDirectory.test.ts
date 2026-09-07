import path from 'path';
import { openExportDirectory } from '../openExportDirectory';

test('내보내기 저장 폴더를 정규화해 OS에 열도록 요청한다', async () => {
  const open = jest.fn(async () => '');
  const target = path.join(process.cwd(), 'exports') + '/./result';
  await openExportDirectory(target, open);
  expect(open).toHaveBeenCalledWith(path.resolve(target));
  expect(open).toHaveBeenCalledTimes(1);
});
test('OS가 반환한 열기 오류를 성공으로 무시하지 않는다', async () => {
  await expect(openExportDirectory('exports', async () => 'cannot open')).rejects.toThrow('cannot open');
});
