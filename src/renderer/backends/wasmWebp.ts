// 모바일 WebP 인코딩 경로 (wasm libwebp — @jsquash/webp).
//
// 데스크톱 WebP 변환은 main 프로세스의 sharp 가 담당하지만 모바일(WebView)에는
// sharp 가 없다. 이 모듈은 모바일의 WebP 인코딩 전부(자동 변환 1장씩 + 씬/프로젝트
// 일괄 변환)를 렌더러에서 libwebp wasm 으로 처리한다. 일괄 변환은 오래 걸릴 수
// 있어 진입 시 경고+진행 중 취소를 제공한다(BatchProcessService).
//
// NAI stealth 워터마크(알파 LSB) 보존 원리 — 플랜 mobile-auto-webp.md 참조:
//  - 캔버스 디코드(drawImage→getImageData)는 알파 채널을 비트 그대로 돌려준다.
//    기존 스텔스 추출기(util.ts extractMetadataFromAlpha)가 같은 방식으로 읽는 것이
//    프로덕션 검증이다.
//  - alpha_quality 100 = libwebp 알파 무손실 인코딩(sharp 손실 webp 기본값과 동일).
//  - P0 실측(2026-07-18): 실물 NAI PNG(832×1216) 변환 후 알파 diff 0 픽셀,
//    스텔스 비트스트림 13,600비트 완전 동일, 1105KB→62KB.
//  - EXIF 이월은 생략 — SDStudio 프롬프트 추출기는 2차 폴백으로 알파 스텔스를 직접
//    해독하므로 인식이 유지되고, NAI 인스펙터도 스텔스만 읽는다.
//
// 이 모듈은 무겁다(wasm ~수백 KB) — 반드시 동적 import 로만 로드할 것
// (androidBackend.convertToWebp 가 유일한 진입점).
import { simd } from 'wasm-feature-detect';
import { Buffer } from 'buffer';
import encode, { init } from '@jsquash/webp/encode';

// 번들된 wasm 에셋 URL (webpack asset/resource)
import wasmUrl from '@jsquash/webp/codec/enc/webp_enc.wasm';
import wasmSimdUrl from '@jsquash/webp/codec/enc/webp_enc_simd.wasm';
import {
  embedSDStudioMetadataInWebpBytes,
  extractSDStudioMetadataFromPngBase64,
} from '../../shared/sdstudioImageMetadata';

let initPromise: Promise<void> | undefined;

// wasm 을 직접 fetch→컴파일해 init 에 공급한다. simd 지원 여부로 파일을 고르는
// 기준이 encode.js 내부의 글루 JS 선택 기준과 동일해 짝이 맞는다.
// (fetch→ArrayBuffer 경유는 로컬 서버의 .wasm MIME 불확실성 회피)
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const url = (await simd()) ? wasmSimdUrl : wasmUrl;
      const bytes = await (await fetch(url)).arrayBuffer();
      await init(await WebAssembly.compile(bytes));
    })();
    // 실패 시 다음 호출에서 재시도할 수 있게 캐시를 비운다
    initPromise.catch(() => {
      initPromise = undefined;
    });
  }
  return initPromise;
}

function loadImage(dataUri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지 디코드 실패'));
    img.src = dataUri;
  });
}

// PNG(raw base64) → WebP(raw base64). RGB 는 quality 손실 압축, 알파는 무손실.
export async function encodePngBase64ToWebp(
  pngBase64: string,
  quality: number,
): Promise<string> {
  await ensureInit();
  const img = await loadImage(`data:image/png;base64,${pngBase64}`);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d context 생성 실패');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Uint8Array(
    await encode(imageData, { quality, alpha_quality: 100 }),
  );
  const metadata = extractSDStudioMetadataFromPngBase64(pngBase64);
  const finalOut = metadata
    ? embedSDStudioMetadataInWebpBytes(out, metadata)
    : out;
  return Buffer.from(finalOut).toString('base64');
}
