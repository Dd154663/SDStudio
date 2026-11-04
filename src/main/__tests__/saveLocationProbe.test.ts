/**
 * @jest-environment node
 */
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import {
  probeSaveLocation,
  ProbeFs,
  SAVE_LOCATION_DATA_DIRS,
} from '../saveLocationProbe';
import { SAVE_LOCATION_PROBE_LIMIT } from '../../shared/saveLocationChange';

// 저장 경로 하위 폴더 쓰기 검사(2026-11-04) — 임시 폴더 실제 fs + 실패를 흉내 내는 fs 래퍼.
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdstudio-probe-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// 실제 fs 에 위임하되 failDir 안의 프로브 쓰기만 EACCES 로 실패시킨다. 프로브한 폴더를 기록한다.
function spyFs(failDir?: string, failReaddir?: string) {
  const probedDirs: string[] = [];
  const f: ProbeFs = {
    mkdir: (d, o) => fs.mkdir(d, o),
    writeFile: async (file, data, enc) => {
      const dir = path.dirname(file);
      probedDirs.push(dir);
      if (failDir && dir === failDir) {
        const e: any = new Error('denied');
        e.code = 'EACCES';
        throw e;
      }
      await fs.writeFile(file, data, enc);
    },
    rm: (file) => fs.rm(file),
    readdir: async (d, o) => {
      if (failReaddir && d === failReaddir) {
        const e: any = new Error('denied');
        e.code = 'EPERM';
        throw e;
      }
      return fs.readdir(d, o);
    },
    stat: (p) => fs.stat(p),
  };
  return { f, probedDirs };
}

async function leftovers(dir: string): Promise<string[]> {
  return (await fs.readdir(dir)).filter((n) => n.endsWith('.wtest'));
}

test('데이터 폴더 목록 = workspace + projectPaths 7루트', () => {
  expect(SAVE_LOCATION_DATA_DIRS).toEqual([
    'workspace',
    'outs',
    'inpaints',
    'inpaint_orgs',
    'inpaint_masks',
    'vibes',
    'references',
    'projects',
  ]);
});

test('빈 폴더: 루트만 검사하고 통과, 프로브 파일은 남지 않는다', async () => {
  const { f, probedDirs } = spyFs();
  const r = await probeSaveLocation(root, { dataSubdirs: true, fs: f });
  expect(r).toMatchObject({ ok: true, probed: 1, truncated: false });
  expect(probedDirs).toEqual([root]);
  expect(await leftovers(root)).toEqual([]);
});

test('없는 폴더는 만들고 검사한다(기존 check-writable 과 같음)', async () => {
  const target = path.join(root, 'new', 'deep');
  const r = await probeSaveLocation(target, { dataSubdirs: true });
  expect(r.ok).toBe(true);
  expect((await fs.stat(target)).isDirectory()).toBe(true);
});

test('데이터 배치가 있으면 데이터 폴더와 직계 자식(점 시작 제외)까지 검사한다', async () => {
  await fs.mkdir(path.join(root, 'outs', '프로젝트A', '씬1'), { recursive: true });
  await fs.mkdir(path.join(root, 'outs', '.trash'), { recursive: true });
  await fs.mkdir(path.join(root, 'workspace', 'p__abcd1234'), { recursive: true });
  await fs.writeFile(path.join(root, 'outs', 'file.png'), 'x');
  await fs.mkdir(path.join(root, 'unrelated', 'sub'), { recursive: true });
  const { f, probedDirs } = spyFs();
  const r = await probeSaveLocation(root, { dataSubdirs: true, fs: f });
  expect(r.ok).toBe(true);
  expect(probedDirs).toEqual([
    root,
    path.join(root, 'workspace'),
    path.join(root, 'outs'),
    path.join(root, 'workspace', 'p__abcd1234'),
    path.join(root, 'outs', '프로젝트A'),
  ]);
  // 손자(씬 폴더)·관계없는 폴더·점 폴더는 검사하지 않는다
  expect(await leftovers(path.join(root, 'outs', '프로젝트A'))).toEqual([]);
});

test('dataSubdirs 가 없으면 루트만(동기화 폴더 선택 경로)', async () => {
  await fs.mkdir(path.join(root, 'outs', 'A'), { recursive: true });
  const { f, probedDirs } = spyFs();
  const r = await probeSaveLocation(root, { fs: f });
  expect(r.ok).toBe(true);
  expect(probedDirs).toEqual([root]);
});

test('프로젝트 폴더 쓰기 실패 → failedPath·code 반환', async () => {
  const bad = path.join(root, 'outs', 'B');
  await fs.mkdir(path.join(root, 'outs', 'A'), { recursive: true });
  await fs.mkdir(bad, { recursive: true });
  const { f } = spyFs(bad);
  const r = await probeSaveLocation(root, { dataSubdirs: true, fs: f });
  expect(r).toMatchObject({ ok: false, code: 'EACCES', failedPath: bad });
});

test('루트 쓰기 실패는 failedPath 없이 코드만', async () => {
  const { f } = spyFs(root);
  const r = await probeSaveLocation(root, { dataSubdirs: true, fs: f });
  expect(r.ok).toBe(false);
  expect(r.code).toBe('EACCES');
  expect(r.failedPath).toBeUndefined();
});

test('데이터 폴더 목록 읽기 실패 → 그 데이터 폴더를 failedPath 로', async () => {
  const outs = path.join(root, 'outs');
  await fs.mkdir(outs, { recursive: true });
  const { f } = spyFs(undefined, outs);
  const r = await probeSaveLocation(root, { dataSubdirs: true, fs: f });
  expect(r).toMatchObject({ ok: false, code: 'EPERM', failedPath: outs });
});

test('부팅(probeRoot:false)은 루트를 다시 쓰지 않는다', async () => {
  await fs.mkdir(path.join(root, 'projects'), { recursive: true });
  const { f, probedDirs } = spyFs();
  const r = await probeSaveLocation(root, { probeRoot: false, dataSubdirs: true, fs: f });
  expect(r.ok).toBe(true);
  expect(probedDirs).toEqual([path.join(root, 'projects')]);
});

test('상한: 루트 포함 limit 개까지만 프로브하고 나머지는 통과로 본다', async () => {
  for (let i = 0; i < 6; i++) {
    await fs.mkdir(path.join(root, 'outs', 'p' + i), { recursive: true });
  }
  // 상한 밖 폴더가 실패해도 검사하지 않으므로 통과
  const { f, probedDirs } = spyFs(path.join(root, 'outs', 'p5'));
  const r = await probeSaveLocation(root, { dataSubdirs: true, fs: f, limit: 4 });
  expect(r).toMatchObject({ ok: true, probed: 4, truncated: true });
  expect(probedDirs).toHaveLength(4);
  expect(SAVE_LOCATION_PROBE_LIMIT).toBe(200);
});
