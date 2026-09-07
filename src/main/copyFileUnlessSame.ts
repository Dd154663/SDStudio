import path from 'path';
import { promises as fs } from 'fs';

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
  await fs.copyFile(sourcePath, destPath);
  return 'copied';
}
