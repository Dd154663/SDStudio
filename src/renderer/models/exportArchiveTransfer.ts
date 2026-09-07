import type { Backend } from '../backend';

// Copy failures propagate; cleanup failures must not trigger a second export.
export async function transferExportArchive(
  backend: Pick<Backend, 'copyFileToAbsolute' | 'deleteFile'>,
  source: string,
  destination: string,
): Promise<{ cleanupFailed: boolean }> {
  const result = await backend.copyFileToAbsolute(source, destination);
  if (result !== 'copied') return { cleanupFailed: false };
  try {
    await backend.deleteFile(source);
    return { cleanupFailed: false };
  } catch {
    return { cleanupFailed: true };
  }
}
