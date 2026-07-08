// NAI "stealth pnginfo" 워터마크 보존 (트랙2 WebP Phase 4).
//
// NAI 공식 인스펙터는 EXIF 가 아니라 이미지 알파 채널에 눈에 안 보이게 심긴
// 비트스트림(stealth)을 읽는다. 포맷(2026-07-08 실측 확정):
//   - 알파 채널 LSB 를 "열 우선(x 바깥, y 안쪽)" 순서로 읽어 비트스트림 구성
//   - [매직 15자(120비트)][길이 32비트][파라미터 데이터 (gzip/raw)]
//   - 매직: 'stealth_pnginfo'(무압축) / 'stealth_pngcomp'(gzip)
//
// 리사이즈·재인코딩은 알파를 리샘플해 이 워터마크를 파괴한다. 이 모듈은 내용을
// 디코딩하지 않고 "비트스트림만 그대로 이송"한다: 소스에서 추출 → 리사이즈된 출력
// 알파에 재삽입 → webp 무손실 알파로 인코딩. 페이로드가 NAI 가 쓴 것과 바이트
// 동일하므로 NAI 인스펙터가 그대로 읽는다. 상세: project_nai_stealth_metadata.

// 알파 모드 매직(우리가 다루는 대상). RGB 모드(stealth_rgb*)는 알파가 없어 해당 없음.
const STEALTH_MAGICS = ['stealth_pnginfo', 'stealth_pngcomp'];
const MAGIC_BITS = 15 * 8; // 120
const LEN_BITS = 32;
const HEADER_BITS = MAGIC_BITS + LEN_BITS; // 152

// 열 우선 i 번째 비트에 해당하는 알파 바이트의 버퍼 오프셋.
// i = x*height + y  (x = i/height, y = i%height)
function alphaOffset(i: number, width: number, height: number, channels: number): number {
  const x = (i / height) | 0;
  const y = i - x * height;
  return (y * width + x) * channels + (channels - 1);
}

// 소스 RGBA(raw)에서 stealth 비트스트림 전체(매직+길이+데이터)를 추출한다.
// stealth 가 없거나(매직 불일치) 손상(길이 비정상)이면 null.
export function extractStealthBits(
  rgba: Buffer,
  width: number,
  height: number,
  channels: number,
): Uint8Array | null {
  const totalPixels = width * height;
  if (channels < 4 || totalPixels < HEADER_BITS) return null;

  const bitAt = (i: number): number => rgba[alphaOffset(i, width, height, channels)] & 1;

  // 매직 15자 (8비트 MSB-first)
  let magic = '';
  for (let c = 0; c < 15; c++) {
    let code = 0;
    for (let b = 0; b < 8; b++) code = (code << 1) | bitAt(c * 8 + b);
    magic += String.fromCharCode(code);
  }
  if (!STEALTH_MAGICS.includes(magic)) return null;

  // 길이 32비트 (big-endian)
  let lenBits = 0;
  for (let b = 0; b < LEN_BITS; b++) lenBits = lenBits * 2 + bitAt(MAGIC_BITS + b);
  const total = HEADER_BITS + lenBits;
  if (lenBits <= 0 || total > totalPixels) return null;

  const bits = new Uint8Array(total);
  for (let i = 0; i < total; i++) bits[i] = bitAt(i);
  return bits;
}

// 출력 RGBA(raw)의 알파에 비트스트림을 열 우선으로 심는다. 데이터 이후 나머지
// 알파는 255(불투명). 알파 = 254(bit0)/255(bit1) 이라 이미지는 완전 불투명 유지.
// (버퍼를 제자리 수정)
export function embedStealthBits(
  rgba: Buffer,
  width: number,
  height: number,
  channels: number,
  bits: Uint8Array,
): void {
  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i++) {
    const off = alphaOffset(i, width, height, channels);
    rgba[off] = i < bits.length ? 0xfe | bits[i] : 0xff;
  }
}

// 타깃 픽셀 수가 비트스트림을 담기에 충분한지.
export function canEmbed(bits: Uint8Array, width: number, height: number): boolean {
  return width * height >= bits.length;
}
