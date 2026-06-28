// 앱이 지원하는 이미지 포맷 스펙 (단일 출처).
// 그동안 확장자(.png/.webp)와 accept 문자열이 여러 파일에 하드코딩돼 있었다.
// 포맷을 추가/변경할 때 이 모듈만 고치면 되도록 중앙화한다.
// 의존성 없는 순수 모듈(순환참조 안전).

// 생성 이미지(outs/ · inpaints/)로 저장·표시·메타데이터 추출하는 포맷.
// 정렬·필터·유실가드·export·휴지통·복구 등 "출력 이미지" 판정에 쓴다.
export const OUTPUT_IMAGE_EXTS = ['png', 'webp'] as const;

// 파일명이 앱이 다루는 생성 이미지인지 (확장자 기준, 소문자 .png/.webp).
export function isOutputImageFile(filename: string): boolean {
  return OUTPUT_IMAGE_EXTS.some((ext) => filename.endsWith('.' + ext));
}

// 이미 손실 압축 최적화된 포맷. export 최적화 시 재인코딩하면 이중 손실(화질 저하).
export const OPTIMIZED_IMAGE_EXTS = ['webp', 'avif'] as const;
export function isOptimizedImageFile(filename: string): boolean {
  return OPTIMIZED_IMAGE_EXTS.some((ext) =>
    filename.toLowerCase().endsWith('.' + ext),
  );
}

// 사용자가 임포트(프롬프트 메타데이터 추출)할 수 있는 이미지 MIME.
// jpeg 는 NAI 메타가 없을 수 있으나 추출 시도는 허용(없으면 빈 결과).
export const IMPORT_IMAGE_MIMES = [
  'image/png',
  'image/webp',
  'image/jpeg',
] as const;

// <input accept> / 파일 다이얼로그용 문자열.
export const IMPORT_IMAGE_ACCEPT = IMPORT_IMAGE_MIMES.join(',');

// 드롭/선택한 파일의 MIME 이 메타추출 임포트 대상인지.
export function isImportImageMime(mime: string): boolean {
  return (IMPORT_IMAGE_MIMES as readonly string[]).includes(mime);
}

// 접두사 없는 raw base64 의 시그니처로 이미지 확장자를 추정한다(알 수 없으면 png).
// 저장 시 올바른 확장자를 붙여야 표시·MIME 이 어긋나지 않는다.
export function imageExtFromBase64(base64: string): string {
  if (base64.startsWith('iVBOR')) return 'png'; // 89 50 4E 47
  if (base64.startsWith('UklGR')) return 'webp'; // 'RIFF'
  if (base64.startsWith('/9j/')) return 'jpg'; // FF D8 FF
  return 'png';
}
