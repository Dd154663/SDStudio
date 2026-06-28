// 플랫폼(데스크톱/모바일) 차이의 단일 출처.
//
// 여기 모으는 것은 "진짜 플랫폼 VALUE 차이"뿐이다:
//   - 튜닝 상수 (캐시 크기, 동시성 등)
//   - 능력 플래그 (데스크톱 전용 기능 가용 여부)
//   - 능력 기반 UI 옵션 빌더 (여러 곳에 중복되던 것)
// 순수 레이아웃 분기(`isMobile ? <A/> : <B/>`, className 등)는 대상이 아니며
// 각 컴포넌트에 그대로 둔다.
//
// isMobile 은 index.ts 의 것과 동일한 신호(window.electron 부재)지만,
// 여기서 로컬로 계산한다. index 에서 import 하면 서비스 초기화 중 모듈 평가
// 시점에 isMobile 이 아직 할당되지 않아(TDZ) 데스크톱으로 오판될 수 있기 때문.
// window.electron 은 preload 가 번들 실행 전에 주입하므로 모듈 평가 시점에 안전하다.
const isMobile = window.electron == null;

export const platform = {
  isMobile,

  // --- 튜닝 상수 ---
  imageCacheSize: isMobile ? 64 : 256,
  encodedVibeCacheSize: isMobile ? 32 : 128,
  exportConcurrency: isMobile ? 2 : 4,

  // --- 능력 플래그 (데스크톱 전용 기능) ---
  supportsLosslessWebp: !isMobile, // sharp 무손실 webp 최적화
  supportsTargetFolder: !isMobile, // 임의(절대경로) 폴더로 export
  supportsRemoveBg: !isMobile, // 배경 제거 (로컬 AI)
  supportsWebpConvert: !isMobile, // 생성 이미지 PNG→WebP 변환
};

// 이미지 크기 최적화 방법 선택 옵션.
// ExportPresetService / BackupService 의 동일 코드 중복을 제거한 단일 출처.
export function buildImageOptimizeOptions(): { text: string; value: string }[] {
  const items = [
    { text: '원본', value: 'original' },
    { text: '저손실 webp 최적화 (에셋용 권장)', value: 'lossy' },
  ];
  if (platform.supportsLosslessWebp) {
    items.push({ text: '무손실 webp 최적화', value: 'lossless' });
  }
  items.push({
    text: isMobile ? 'AVIF 최적화 (PC 권장)' : 'AVIF 최적화',
    value: 'avif',
  });
  return items;
}
