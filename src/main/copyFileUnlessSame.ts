import path from 'path';
import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';

// 같은 폴더의 임시 이름(.part)으로 먼저 쓰고 rename 으로 교체한다. 동기화 앱(Google
// Drive 데스크톱 등)이 감시하는 폴더에 쓰는 중인 반쪽 파일을 올리지 않게 하기 위함
// (드라이브 동기화 ①, 2026-09-28). 같은 볼륨 안 rename 이라 교체는 원자적이다.
export function partPathFor(destPath: string): string {
  return path.join(
    path.dirname(destPath),
    `.${path.basename(destPath)}.${randomBytes(6).toString('hex')}.part`,
  );
}

// 동일 파일은 복사를 생략하고 호출부가 결과 파일을 정리하지 않도록 알린다.
export async function copyFileUnlessSame(
  source: string,
  destination: string,
): Promise<'copied' | 'same-file'> {
  const sourcePath = path.resolve(source);
  const destPath = path.resolve(destination);
  const sourceStat = await fs.stat(sourcePath);
  if (sourcePath === destPath) return 'same-file';
  try {
    const destStat = await fs.stat(destPath);
    if (
      sourceStat.ino !== 0 &&
      sourceStat.dev === destStat.dev &&
      sourceStat.ino === destStat.ino
    ) return 'same-file';
    const [realSource, realDest] = await Promise.all([
      fs.realpath(sourcePath), fs.realpath(destPath),
    ]);
    if (realSource === realDest) return 'same-file';
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const partPath = partPathFor(destPath);
  try {
    await fs.copyFile(sourcePath, partPath);
    await fs.rename(partPath, destPath);
  } catch (e) {
    await fs.rm(partPath, { force: true }).catch(() => {});
    throw e;
  }
  return 'copied';
}
