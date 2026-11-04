import path from 'path';
import { promises as nodeFs } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import {
  PROJECT_DATA_ROOTS,
  WORKSPACE_ROOT,
} from '../renderer/models/projectPaths';
import {
  CheckWritableResult,
  SAVE_LOCATION_PROBE_LIMIT,
} from '../shared/saveLocationChange';

// 저장 경로 쓰기 검사(2026-11-04): 고른 폴더(데이터 루트 후보) 자신과, 그 안에 이미 SDStudio
// 데이터 배치가 있으면 그 데이터 폴더와 직계 자식(프로젝트 폴더)까지 실제 파일 쓰기로 확인한다.
// 루트만 쓸 수 있고 하위 폴더가 읽기 전용(다른 PC·사용자에게서 복사한 폴더 등)이면 저장이
// 조용히 실패하기 때문. main.ts 의 check-writable(선택 시)과 initFolder(부팅 경고)가 쓴다.
//
// 데이터 폴더 이름은 projectPaths 단일 출처(7루트 + workspace)를 따른다. 경로는 path.join 으로만
// 만든다. 프로브 파일은 기존 check-writable 과 같은 방식(.uuid.wtest 생성 → 즉시 삭제)이다.

// 테스트에서 바꿔 끼우는 fs 부분집합.
export interface ProbeFs {
  mkdir(dir: string, opts: { recursive: true }): Promise<unknown>;
  writeFile(file: string, data: string, enc: 'utf-8'): Promise<void>;
  rm(file: string): Promise<void>;
  readdir(
    dir: string,
    opts: { withFileTypes: true },
  ): Promise<Array<{ name: string; isDirectory(): boolean }>>;
  stat(p: string): Promise<{ isDirectory(): boolean }>;
}

export interface ProbeOptions {
  // 고른 폴더 자신을 검사(없으면 만든다). 부팅은 initFolder 가 이미 했으므로 false.
  probeRoot?: boolean;
  // 데이터 폴더·프로젝트 폴더까지 검사.
  dataSubdirs?: boolean;
  limit?: number;
  fs?: ProbeFs;
  makeProbeName?: () => string;
}

export interface ProbeResult extends CheckWritableResult {
  // 실제로 프로브한 폴더 수(고른 폴더 포함).
  probed: number;
  // 상한에 걸려 검사하지 않은 폴더가 남았는지.
  truncated: boolean;
}

// SDStudio 데이터 폴더 이름(데이터 루트 직하). 순서 = 검사 순서.
export const SAVE_LOCATION_DATA_DIRS: readonly string[] = [
  WORKSPACE_ROOT,
  ...PROJECT_DATA_ROOTS,
];

function errCode(e: any): string {
  return String(e?.code || e?.message || e);
}

async function probeDir(dir: string, fs: ProbeFs, makeName: () => string) {
  const probe = path.join(dir, '.' + makeName() + '.wtest');
  await fs.writeFile(probe, 'ok', 'utf-8');
  await fs.rm(probe).catch(() => {});
}

export async function probeSaveLocation(
  root: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const fs = options.fs ?? (nodeFs as unknown as ProbeFs);
  const makeName = options.makeProbeName ?? uuidv4;
  const limit = Math.max(1, options.limit ?? SAVE_LOCATION_PROBE_LIMIT);
  const probeRoot = options.probeRoot ?? true;
  let probed = 0;

  if (probeRoot) {
    try {
      await fs.mkdir(root, { recursive: true });
      await probeDir(root, fs, makeName);
      probed++;
    } catch (e) {
      return { ok: false, code: errCode(e), probed, truncated: false };
    }
  }
  if (!options.dataSubdirs) return { ok: true, probed, truncated: false };

  // 1) 이미 있는 데이터 폴더만 고른다(없으면 SDStudio 데이터가 아님 → 루트 검사로 충분).
  const dataDirs: string[] = [];
  for (const name of SAVE_LOCATION_DATA_DIRS) {
    const dir = path.join(root, name);
    try {
      const st = await fs.stat(dir);
      if (st.isDirectory()) dataDirs.push(dir);
    } catch (e) {
      // 없음(ENOENT 등) — 건너뛴다.
    }
  }

  // 2) 데이터 폴더 → 각 직계 자식(점 시작 이름은 예약·숨김이라 제외) 순으로 상한까지.
  const queue: string[] = [...dataDirs];
  for (const dataDir of dataDirs) {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fs.readdir(dataDir, { withFileTypes: true });
    } catch (e) {
      return { ok: false, code: errCode(e), failedPath: dataDir, probed, truncated: false };
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      queue.push(path.join(dataDir, ent.name));
    }
  }
  for (let i = 0; i < queue.length; i++) {
    if (probed >= limit) return { ok: true, probed, truncated: true };
    const dir = queue[i];
    try {
      await probeDir(dir, fs, makeName);
      probed++;
    } catch (e) {
      return { ok: false, code: errCode(e), failedPath: dir, probed, truncated: false };
    }
  }
  return { ok: true, probed, truncated: false };
}
