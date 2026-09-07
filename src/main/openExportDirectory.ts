import path from 'path';

// 파일 선택 API의 무응답 대신 내보내기 결과 폴더를 명시적으로 연다.
export async function openExportDirectory(
  directory: string,
  openPath: (target: string) => Promise<string>,
): Promise<void> {
  const error = await openPath(path.resolve(directory));
  if (error) throw new Error(error);
}
