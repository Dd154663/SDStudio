/**
 * Capacitor `Filesystem.getUri` 가 주는 file:// URI → 실제 파일 경로(2026-11-25).
 *
 * URI 는 퍼센트 인코딩돼 있다(한글·공백 등이 %EC… %20 으로). 접두만 떼고 그대로 미디어 스캔에 넘기면 없는 경로를
 * 스캔해 갤러리·기본 파일 앱(MediaStore)에 등록되지 않는다 — 파일 이름에 한글이나 공백이 있으면 저장은 됐는데
 * 기본 앱에서 보이지 않던 원인(다른 파일 탐색기는 폴더를 직접 읽어 보였다).
 */
export function fileUriToPath(uri: string): string {
  const raw = uri.replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    // 깨진 인코딩이면 종전처럼 접두만 뗀 값
    return raw;
  }
}
