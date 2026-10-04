/**
 * PNG 청크 파싱·텍스트 청크 이관(2026-10-04 Focused inpainting S1) — 순수 TS(Uint8Array 만 사용).
 *
 * Focused 합성은 캔버스로 새 PNG 를 만들기 때문에 서버 결과 PNG 의 텍스트 메타(NAI 의 `Comment`·
 * `Description`·`Software`·`Source` 등, SDStudio 전용 `SDStudio` 키)가 사라진다. 이 모듈로
 * 결과 PNG 의 `tEXt`/`iTXt`/`zTXt` 청크를 그대로 꺼내 합성 PNG 의 IEND 앞에 넣는다.
 * NAI stealth(알파 채널 LSB) 메타는 픽셀이 바뀌므로 보존되지 않는다(SPEC_GUIDE §7).
 */

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const PNG_TEXT_CHUNK_TYPES: readonly string[] = ['tEXt', 'iTXt', 'zTXt'];

let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** PNG CRC-32(청크 타입+데이터 대상). */
export function crc32(...parts: Uint8Array[]): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) c = table[(c ^ part[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function typeBytes(type: string): Uint8Array {
  if (!/^[A-Za-z]{4}$/.test(type)) throw new Error(`잘못된 PNG 청크 타입: ${type}`);
  return new Uint8Array([0, 1, 2, 3].map((i) => type.charCodeAt(i)));
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

// Latin-1 바이트 → 문자열(큰 본문도 인자 개수 한계에 걸리지 않게 나눠 변환).
function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** PNG 를 청크 목록으로 나눈다. 서명·길이·CRC 가 어긋나면 오류. */
export function parsePngChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error('PNG 서명이 아닙니다.');
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('손상된 PNG 청크입니다.');
    const length = readUint32(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error('손상된 PNG 청크 길이입니다.');
    const type = latin1(bytes.subarray(typeStart, dataStart));
    const data = bytes.slice(dataStart, dataEnd);
    const expected = readUint32(bytes, dataEnd);
    if (crc32(bytes.subarray(typeStart, dataStart), data) !== expected) {
      throw new Error(`PNG 청크 CRC 불일치: ${type}`);
    }
    chunks.push({ type, data });
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  if (!chunks.length || chunks[chunks.length - 1].type !== 'IEND') {
    throw new Error('PNG IEND 청크가 없습니다.');
  }
  return chunks;
}

/** 청크 목록을 PNG 바이트로(CRC 계산). */
export function encodePngChunks(chunks: PngChunk[]): Uint8Array {
  const total = PNG_SIGNATURE.length + chunks.reduce((sum, c) => sum + 12 + c.data.length, 0);
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE, 0);
  let offset = PNG_SIGNATURE.length;
  for (const chunk of chunks) {
    const type = typeBytes(chunk.type);
    writeUint32(out, offset, chunk.data.length);
    out.set(type, offset + 4);
    out.set(chunk.data, offset + 8);
    writeUint32(out, offset + 8 + chunk.data.length, crc32(type, chunk.data));
    offset += 12 + chunk.data.length;
  }
  return out;
}

export function isTextChunk(chunk: PngChunk): boolean {
  return PNG_TEXT_CHUNK_TYPES.includes(chunk.type);
}

/** 텍스트 청크의 키워드(첫 NUL 앞, Latin-1). */
export function textChunkKeyword(chunk: PngChunk): string {
  const end = chunk.data.indexOf(0);
  const raw = chunk.data.subarray(0, end < 0 ? chunk.data.length : end);
  return latin1(raw);
}

/** PNG 의 텍스트 청크(tEXt/iTXt/zTXt)를 순서대로 꺼낸다. */
export function extractTextChunks(png: Uint8Array): PngChunk[] {
  return parsePngChunks(png).filter(isTextChunk);
}

/**
 * 비압축 텍스트 읽기(검사·테스트용): tEXt 는 Latin-1, 비압축 iTXt 는 UTF-8. zTXt·압축 iTXt 는 null.
 */
export function readTextChunk(chunk: PngChunk): { keyword: string; text: string } | null {
  const keyword = textChunkKeyword(chunk);
  const sep = chunk.data.indexOf(0);
  if (sep < 0) return null;
  if (chunk.type === 'tEXt') {
    return { keyword, text: latin1(chunk.data.subarray(sep + 1)) };
  }
  if (chunk.type === 'iTXt') {
    const compressed = chunk.data[sep + 1];
    if (compressed !== 0) return null;
    let p = sep + 3;
    const langEnd = chunk.data.indexOf(0, p);
    if (langEnd < 0) return null;
    const transEnd = chunk.data.indexOf(0, langEnd + 1);
    if (transEnd < 0) return null;
    p = transEnd + 1;
    const body = chunk.data.subarray(p);
    try {
      // TextDecoder 없는 환경(jsdom)도 같은 결과 — 올바른 UTF-8 만 성공.
      return { keyword, text: decodeURIComponent(Array.from(body, (b) => '%' + b.toString(16).padStart(2, '0')).join('')) };
    } catch (_) {
      return null;
    }
  }
  return null;
}

/** tEXt 청크 만들기(키워드·본문 Latin-1). */
export function makeTextChunk(keyword: string, text: string): PngChunk {
  const bytes = new Uint8Array(keyword.length + 1 + text.length);
  for (let i = 0; i < keyword.length; i++) bytes[i] = keyword.charCodeAt(i) & 0xff;
  bytes[keyword.length] = 0;
  for (let i = 0; i < text.length; i++) bytes[keyword.length + 1 + i] = text.charCodeAt(i) & 0xff;
  return { type: 'tEXt', data: bytes };
}

/**
 * 원본 PNG 의 텍스트 청크를 대상 PNG 의 IEND 앞에 넣는다(원래 순서 유지).
 * 대상에 같은 키워드의 텍스트 청크가 있으면 원본 쪽으로 바꾼다. 원본에 텍스트가 없으면 대상 그대로.
 */
export function transferTextChunks(source: Uint8Array, target: Uint8Array): Uint8Array {
  const texts = extractTextChunks(source);
  if (!texts.length) return target;
  const keywords = new Set(texts.map(textChunkKeyword));
  const chunks = parsePngChunks(target).filter(
    (c) => !(isTextChunk(c) && keywords.has(textChunkKeyword(c))),
  );
  const iend = chunks.findIndex((c) => c.type === 'IEND');
  chunks.splice(iend, 0, ...texts);
  return encodePngChunks(chunks);
}
