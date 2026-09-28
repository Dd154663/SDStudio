import { backend, isMobile } from '.';
import { deliverExport, getSyncFolder } from './driveSync';
import type { DeliverResult, DriveExportKind } from './driveSync';
import { sanitizeFilenamePart } from './exportPresetUtils';

// 텍스트(JSON) 파일 내보내기 공용 헬퍼 — 캐릭터 프리셋/씬 템플릿 내보내기가 공유.
// 플랫폼 분기(하드코딩 중복 방지): 모바일 = exports/ 에 임시 생성 후 다운로드로 이동,
// PC = Blob 다운로드. (CharacterPresetEditor 로컬 내보내기에서 추출, 2026-07-18)
//
// driveKind(선택, 2026-09-28 드라이브 동기화 ①): 지정하면 내보내기 끝에서 공용
// 목적지 선택(driveSync.deliverExport)을 쓴다. PC 는 Blob 다운로드라 exports/ 파일이
// 없으므로, 드라이브 동기화 폴더가 설정된 경우에만 exports/ 에 쓰고 목적지를 고른다.
// 미지정 호출부(프로젝트 로컬 캐릭터 프리셋 등)는 기존 동작 그대로다.
// 반환 = 'cancelled' 면 사용자가 목적지 선택을 취소한 것(완료 안내를 띄우지 않는다).
export async function saveJsonFile(
  fileName: string,
  jsonStr: string,
  driveKind?: DriveExportKind,
): Promise<DeliverResult> {
  if (isMobile) {
    const outPath = 'exports/' + fileName;
    await backend.writeFile(outPath, jsonStr);
    if (driveKind) return await deliverExport(outPath, driveKind);
    await backend.publishExport(outPath);
    return 'downloads';
  }
  if (driveKind && (await getSyncFolder())) {
    // 사용자 입력 이름(씬 템플릿 이름 등)이 들어가므로 파일 시스템 예약 문자를 치환한다.
    const dot = fileName.lastIndexOf('.');
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : '';
    const safeName = (sanitizeFilenamePart(stem) || 'sdstudio-export') + ext;
    const outPath = 'exports/' + safeName;
    await backend.writeFile(outPath, jsonStr);
    return await deliverExport(outPath, driveKind);
  }
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloads';
}
