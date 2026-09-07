import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { copyFileUnlessSame } from '../copyFileUnlessSame';

let dir: string;
let source: string;
let dest: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sdstudio-copy-test-'));
  source = path.join(dir, 'archive.tar');
  dest = path.join(dir, 'output.tar');
  await fs.writeFile(source, 'archive contents');
});
afterEach(async () => {
  for (const file of [dest, source]) {
    try { await fs.unlink(file); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  }
  await fs.rmdir(dir);
});
test('동일한 파일로 내보내면 정리 금지를 반환하고 내용을 유지한다', async () => {
  expect(await copyFileUnlessSame(source, source)).toBe('same-file');
  expect(await fs.readFile(source, 'utf8')).toBe('archive contents');
});
test('상대 구간이 들어간 동일 경로도 정리하지 않는다', async () => {
  expect(await copyFileUnlessSame(source, `${dir}/./archive.tar`)).toBe('same-file');
});
test('다른 이름의 하드링크도 같은 파일로 판정한다', async () => {
  await fs.link(source, dest);
  expect(await copyFileUnlessSame(source, dest)).toBe('same-file');
  expect(await fs.readFile(dest, 'utf8')).toBe('archive contents');
});
test('다른 경로에는 실제 복사한 뒤 정리 가능을 반환한다', async () => {
  expect(await copyFileUnlessSame(source, dest)).toBe('copied');
  expect(await fs.readFile(dest, 'utf8')).toBe('archive contents');
  expect(await fs.readFile(source, 'utf8')).toBe('archive contents');
});
