import { createReadStream, createWriteStream, promises as fs } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import JSZip from 'jszip';

export async function writeImageZip(
  files: { name: string; path: string }[],
  destination: string,
  progress: (done: number, total: number) => void = () => {},
): Promise<void> {
  // JSZip writes ZIP32. Reject sizes needing ZIP64 rather than emit a corrupt archive.
  if (files.length >= 65535) throw new Error('ZIP 파일 수 제한을 초과했습니다. TAR 형식을 사용해주세요.');
  const zip = new JSZip();
  let sizeBound = 0;
  const names = new Set<string>();
  let done = 0;
  for (const file of files) {
    if (names.has(file.name)) throw new Error('ZIP 내부 파일 이름이 중복됩니다.');
    names.add(file.name);
    const stat = await fs.stat(file.path);
    sizeBound += Math.ceil(stat.size * 1.01) + Buffer.byteLength(file.name, 'utf8') * 2 + 1024;
    if (sizeBound >= 0xffffffff) throw new Error('ZIP 용량 제한을 초과했습니다. TAR 형식을 사용해주세요.');
    // Delay opening each source until the archive reaches it: no full-image buffering
    // and no simultaneous file descriptor per image.
    const source = Readable.from((async function* () {
      yield* createReadStream(file.path);
      progress(++done, files.length);
    })());
    zip.file(file.name, source, { date: stat.mtime, createFolders: false });
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = destination + '.part';
  try {
    progress(0, files.length);
    await pipeline(
      zip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 1 } }),
      createWriteStream(temporary),
    );
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}
