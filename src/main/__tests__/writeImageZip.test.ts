/** @jest-environment node */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import { writeImageZip } from '../writeImageZip';
let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sdstudio-zip-')); });
afterEach(async () => {
  for (const name of await fs.readdir(dir)) await fs.unlink(path.join(dir, name));
  await fs.rmdir(dir);
});
test('실제 ZIP에 한글 이름과 바이너리 원본을 보존한다', async () => {
  const source = path.join(dir, 'source.png');
  const output = path.join(dir, 'result.zip');
  const data = new Uint8Array([0, 1, 2, 255, 128]);
  await fs.writeFile(source, data);
  const progress = jest.fn();
  await writeImageZip([{ name: '한글 씬.png', path: source }], output, progress);
  const bytes = await fs.readFile(output);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  const zip = await JSZip.loadAsync(new Uint8Array(bytes));
  expect(await zip.file('한글 씬.png')!.async('nodebuffer')).toEqual(Buffer.from(data));
  expect(progress).toHaveBeenLastCalledWith(1, 1);
  expect(await fs.readFile(source)).toEqual(Buffer.from(data));
  await expect(fs.stat(output + '.part')).rejects.toMatchObject({ code: 'ENOENT' });
});
test('입력 오류가 기존 완성 파일을 손상하지 않는다', async () => {
  const output = path.join(dir, 'result.zip');
  await fs.writeFile(output, 'previous');
  await expect(writeImageZip([{name:'missing.png',path:path.join(dir,'missing')}],output)).rejects.toThrow();
  expect(await fs.readFile(output,'utf8')).toBe('previous');
});
test('중복 이름을 조용히 덮어쓰지 않는다', async () => {
  const source = path.join(dir,'source'); await fs.writeFile(source,'data');
  await expect(writeImageZip([{name:'a',path:source},{name:'a',path:source}],path.join(dir,'result.zip'))).rejects.toThrow('중복');
});

test('스트리밍 도중 실패하면 .part를 정리하고 기존 ZIP을 보존한다', async () => {
  const source = path.join(dir,'source'); const output = path.join(dir,'result.zip');
  await fs.writeFile(source,'data'); await fs.writeFile(output,'previous');
  await expect(writeImageZip([{name:'image.png',path:source}],output,() => {
    require('fs').unlinkSync(source);
  })).rejects.toThrow();
  expect(await fs.readFile(output,'utf8')).toBe('previous');
  await expect(fs.stat(output+'.part')).rejects.toMatchObject({code:'ENOENT'});
});
