import { backend, isMobile } from '.';

// 텍스트(JSON) 파일 내보내기 공용 헬퍼 — 캐릭터 프리셋/씬 템플릿 내보내기가 공유.
// 플랫폼 분기(하드코딩 중복 방지): 모바일 = exports/ 에 저장 후 공유 시트,
// PC = Blob 다운로드. (CharacterPresetEditor 로컬 내보내기에서 추출, 2026-07-18)
export async function saveJsonFile(
  fileName: string,
  jsonStr: string,
): Promise<void> {
  if (isMobile) {
    const outPath = 'exports/' + fileName;
    await backend.writeFile(outPath, jsonStr);
    await backend.showFile(outPath);
  } else {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
}
