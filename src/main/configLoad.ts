import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type ConfigLoadResult<T> =
  | { kind: 'loaded'; value: T }
  | { kind: 'missing' }
  | { kind: 'failed'; code: string };

type ReadText = (filePath: string) => Promise<string>;

function errorCode(error: unknown): string {
  const e = error as { code?: unknown; message?: unknown } | null;
  return String(e?.code || e?.message || error);
}

/**
 * config.json 부재는 최초 실행으로 취급하되, 읽기 실패와 JSON 파손은 구분해
 * 호출자가 잘못된 기본 저장 경로로 계속 부팅하지 않도록 한다.
 */
export async function loadJsonConfig<T extends object>(
  filePath: string,
  readText: ReadText = (path) => fs.readFile(path, 'utf-8'),
): Promise<ConfigLoadResult<T>> {
  let raw: string;
  try {
    raw = await readText(filePath);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ENOENT') {
      return { kind: 'missing' };
    }
    return { kind: 'failed', code: errorCode(error) };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('설정 파일의 최상위 값이 객체가 아닙니다');
    }
    return { kind: 'loaded', value: parsed as T };
  } catch (error) {
    return { kind: 'failed', code: errorCode(error) };
  }
}

type RenameFile = (oldPath: string, newPath: string) => Promise<void>;

/** 원본을 삭제하지 않고 같은 폴더의 고유한 백업명으로 격리한다. */
export async function backupFailedConfig(
  filePath: string,
  renameFile: RenameFile = fs.rename,
  now: () => number = Date.now,
  makeId: () => string = randomUUID,
): Promise<string> {
  const backupPath = path.join(
    path.dirname(filePath),
    `config.failed-${now()}-${makeId()}.bak`,
  );
  await renameFile(filePath, backupPath);
  return backupPath;
}
