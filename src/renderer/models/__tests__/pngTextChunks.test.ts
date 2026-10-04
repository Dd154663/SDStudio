/**
 * PNG 텍스트 청크 이관(2026-10-04 Focused inpainting S1) — 파싱·인코딩 왕복·CRC·NAI 메타 이관.
 */
import * as fs from 'fs';
import * as path from 'path';
import extractChunks from 'png-chunks-extract';
import * as PngChunk from 'png-chunk-text';
import {
  crc32,
  encodePngChunks,
  extractTextChunks,
  makeTextChunk,
  parsePngChunks,
  readTextChunk,
  textChunkKeyword,
  transferTextChunks,
} from '../pngTextChunks';

// NAI 생성 PNG(tEXt: Title·Description·Software·Source·Generation time·Comment 등)
const NAI_PNG = new Uint8Array(
  fs.readFileSync(path.join(__dirname, '../../defaultassets/anime.png')),
);

function tinyPng(extra: { type: string; data: Uint8Array }[] = []) {
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  return encodePngChunks([
    { type: 'IHDR', data: ihdr },
    ...extra,
    { type: 'IDAT', data: new Uint8Array([1, 2, 3]) },
    { type: 'IEND', data: new Uint8Array(0) },
  ]);
}

test('CRC-32 는 PNG 표준 값', () => {
  expect(crc32(new Uint8Array(Buffer.from('IEND', 'latin1')))).toBe(0xae426082);
});

test('실제 NAI PNG 를 파싱·재인코딩하면 바이트가 같다', () => {
  const chunks = parsePngChunks(NAI_PNG);
  expect(chunks[0].type).toBe('IHDR');
  expect(chunks[chunks.length - 1].type).toBe('IEND');
  const encoded = encodePngChunks(chunks);
  expect(encoded.length).toBe(NAI_PNG.length);
  expect(encoded.every((b, i) => b === NAI_PNG[i])).toBe(true);
});

test('텍스트 청크 추출 — Comment 포함', () => {
  const texts = extractTextChunks(NAI_PNG);
  const keywords = texts.map(textChunkKeyword);
  expect(keywords).toContain('Comment');
  const comment = readTextChunk(texts[keywords.indexOf('Comment')])!;
  expect(() => JSON.parse(comment.text)).not.toThrow();
});

test('다른 PNG 로 이관 — IEND 앞·순서 유지·외부 파서(CRC 검사)로 읽힘', () => {
  const target = tinyPng();
  const out = transferTextChunks(NAI_PNG, target);
  const parsed = extractChunks(out);
  expect(parsed[parsed.length - 1].name).toBe('IEND');
  const srcTexts = extractChunks(NAI_PNG)
    .filter((c: any) => c.name === 'tEXt')
    .map((c: any) => PngChunk.decode(c.data));
  const outTexts = parsed
    .filter((c: any) => c.name === 'tEXt')
    .map((c: any) => PngChunk.decode(c.data));
  expect(outTexts).toEqual(srcTexts);
  // IDAT 은 그대로
  expect(parsed.find((c: any) => c.name === 'IDAT')!.data).toEqual(new Uint8Array([1, 2, 3]));
  // 이관 뒤 텍스트가 IDAT 보다 뒤(IEND 바로 앞)
  const names = parsed.map((c: any) => c.name);
  expect(names.indexOf('tEXt')).toBeGreaterThan(names.indexOf('IDAT'));
});

test('대상의 같은 키워드 텍스트는 원본 값으로 바뀌고 다른 키워드는 남는다', () => {
  const source = tinyPng([makeTextChunk('Comment', '{"a":1}'), makeTextChunk('SDStudio', 'v1:xx')]);
  const target = tinyPng([makeTextChunk('Comment', 'old'), makeTextChunk('Keep', 'me')]);
  const out = extractTextChunks(transferTextChunks(source, target)).map(readTextChunk);
  expect(out).toEqual([
    { keyword: 'Keep', text: 'me' },
    { keyword: 'Comment', text: '{"a":1}' },
    { keyword: 'SDStudio', text: 'v1:xx' },
  ]);
});

test('비압축 iTXt 는 UTF-8 로 읽는다', () => {
  const head = Array.from('Title', (ch) => ch.charCodeAt(0)).concat([0, 0, 0, 0, 0]);
  const body = new Uint8Array([...head, ...Array.from(Buffer.from('한글 제목', 'utf8'))]);
  expect(readTextChunk({ type: 'iTXt', data: body })).toEqual({ keyword: 'Title', text: '한글 제목' });
});

test('원본에 텍스트가 없으면 대상 그대로', () => {
  const target = tinyPng();
  expect(transferTextChunks(tinyPng(), target)).toBe(target);
});

test('CRC 손상·서명 아님은 오류', () => {
  const broken = NAI_PNG.slice();
  broken[40] ^= 0xff; // 첫 tEXt 데이터 일부
  expect(() => parsePngChunks(broken)).toThrow(/CRC/);
  expect(() => parsePngChunks(new Uint8Array([1, 2, 3]))).toThrow();
});
