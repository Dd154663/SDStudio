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

// 리눅스 데스크톱(Electron) 여부. 안드로이드 WebView 도 navigator.platform 이
// 'Linux'로 시작하므로 반드시 Electron 여부와 함께 판정한다.
const isLinux = !isMobile && window.navigator.platform.startsWith('Linux');

export const platform = {
  isMobile,
  isLinux,

  // --- 튜닝 상수 ---
  imageCacheSize: isMobile ? 64 : 256,
  // 이미지 캐시 총 용량 상한(문자 수 ≈ base64 바이트). 썸네일(수십 KB)과
  // 원본(수 MB)이 한 캐시에 섞여 있어 개수 제한만으로는 원본이 몰릴 때
  // 메모리가 수백 MB 까지 커질 수 있다 → 용량으로도 제한.
  imageCacheBytes: isMobile ? 32 * 1024 * 1024 : 128 * 1024 * 1024,
  encodedVibeCacheSize: isMobile ? 32 : 128,
  exportConcurrency: isMobile ? 2 : 4,
  // 이미지 최적화 병렬 처리 "상한"(설정 슬라이더 max·서비스 cap 공유 단일 출처).
  // 감지된 논리 코어 수에 적응적으로 스케일한다(24코어 데스크톱이면 24까지). 상한
  // 32 는 서버급 다코어의 병리적 값만 막는 가드 — 그 이상은 디스크 I/O·메모리가 먼저
  // 병목이라 실익이 없다. 고코어 머신은 RAM 도 비례해 크므로 동시 디코딩 버퍼는
  // 문제되지 않는다. main 의 UV_THREADPOOL_SIZE 캡과 일치시킨다. 모바일은 저사양·
  // 네이티브 리사이저 특성상 2 유지. 실제 병렬 수는 사용자가 슬라이더로 선택.
  maxImageConcurrency: isMobile
    ? 2
    : Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 32)),
  // 씬 카드 썸네일 크기. 모바일에서 500 요청은 fastcache 를 거치지 않고
  // "원본 통째 로드"로 우회되는데(ImageService.fetchImageSmall 분기),
  // 씬 그리드는 가상화가 없어 전체 씬의 원본이 메모리에 올라간다 → 400 사용.
  sceneThumbSize: isMobile ? 400 : 500,
  // 모바일 생성 직후 사전 생성할 썸네일 크기. 500은 모바일에서 원본 로드로
  // 우회되므로(위와 동일) 사전 생성 대상에서 제외 — 원본을 LRU 에 불필요하게
  // 올려 다른 캐시를 밀어내는 낭비를 막는다.
  pregenThumbSizes: [200, 400],

  // --- 능력 플래그 (데스크톱 전용 기능) ---
  supportsLosslessWebp: !isMobile, // sharp 무손실 webp 최적화
  supportsTargetFolder: !isMobile, // 임의(절대경로) 폴더로 export
  // 로컬 AI(배경 제거) 실행 파일 가용 여부 — 일괄 배경 제거 메뉴·로컬 배경 제거
  // 설정 UI·LocalAI 다운로드를 모두 이 플래그로 게이트한다.
  // 리눅스는 LocalAI 바이너리 미배포(HF 저장소 권한 없음, 2026-07-20)로 제외.
  supportsRemoveBg: !isMobile && !isLinux,
  // 생성 이미지 PNG→WebP 일괄 변환(씬/프로젝트 단위). 모바일도 wasm libwebp 로
  // 지원(2026-07-18 사용자 확정 — 찾는 사람을 위해 개방하되, 진입 시 부하 경고
  // +변환 중 취소 제공. BatchProcessService.webpConfirmText/runWebpConversion 참조).
  supportsWebpConvert: true,
  // 자동 WebP 변환(새 생성 이미지 1장씩)은 모바일도 지원 — 데스크톱=sharp,
  // 모바일=wasm libwebp(backends/wasmWebp.ts). 일괄 변환과 달리 부하가 장당
  // 단위라 저사양에서도 감당 가능(사용자 확정, 2026-07-18).
  supportsAutoWebpConvert: true,
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
