// 이미지 메타 → 상위/추가/씬/하위 분배(2026-10-05) — 생성 구획 메타 생성→이미지 삽입→파싱→분배 왕복,
// 메타 없는 이미지 폴백(전부 상위), 가중치 숫자 공백 형태(N1) 보존, WebP 전용 청크 경로.
jest.mock('../index', () => ({
  backend: {},
  isMobile: false,
  promptService: {
    parseWord: (word: string) => ({ type: 'text', text: word }),
  },
  globalPieceService: {},
}));

import { Buffer } from 'buffer';
import extractChunks from 'png-chunks-extract';
import encodeChunks from 'png-chunks-encode';
import * as PngChunk from 'png-chunk-text';
import { createSDPrompts, toPARR } from '../PromptService';
import { PromptPiece, Scene } from '../types';
import { extractPromptDataFromBase64 } from '../util';
import {
  SDStudioImageMetadataV1,
  SDStudioPromptSourceV1,
  embedSDStudioMetadataInPngBase64,
  embedSDStudioMetadataInWebpBytes,
  extractSDStudioMetadataFromBase64,
} from '../../../shared/sdstudioImageMetadata';
import {
  joinPromptSections,
  planPromptImport,
  sceneSlotsMatchMiddle,
} from '../sdstudioPromptImport';

const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function addNaiComment(base64: string, comment: string): string {
  const chunks = extractChunks(Buffer.from(base64, 'base64') as unknown as Uint8Array);
  const iend = chunks.findIndex((chunk) => chunk.name === 'IEND');
  chunks.splice(iend, 0, PngChunk.encode('Comment', comment));
  return Buffer.from(encodeChunks(chunks)).toString('base64');
}

function piece(prompt: string): PromptPiece {
  return PromptPiece.fromJSON({ prompt, characterPrompts: [], id: prompt, enabled: true } as any);
}

// 실제 생성 경로(createSDPrompts)가 만드는 구획 메타 — N1(숫자 끝 태그 공백) 형태의 가중치 포함.
async function generatedSource(): Promise<SDStudioPromptSourceV1> {
  const session = { extraPrompt: '1.2::artist:abc ::, extra tag' } as any;
  const preset = {
    type: 'SDImageGen',
    frontPrompt: 'masterpiece, 0.8::artist:xyz 2 ::',
    backPrompt: 'year 2024, very aesthetic',
  };
  const scene = { slots: [[piece('1girl, smile')]] } as any as Scene;
  const prompts = await createSDPrompts(session, preset, { type: 'SDImageGen' }, scene);
  const node = prompts[0];
  if (node.type !== 'group' || !node.sdstudioPromptSource) throw new Error('구획 메타 없음');
  return node.sdstudioPromptSource;
}

function metaOf(source: SDStudioPromptSourceV1): SDStudioImageMetadataV1 {
  return { schemaVersion: 1, promptSource: source };
}

const SESSION_SCENE = { targetType: 'SDImageGen', placeExtra: true, middle: 'scene' } as const;

describe('SDStudio 구획 메타 → 프롬프트 칸 분배', () => {
  test('생성→PNG 삽입→파싱 왕복: 상위·추가·씬·하위가 각자 칸으로 간다(N1 공백 형태 그대로)', async () => {
    const source = await generatedSource();
    const merged = toPARR(
      joinPromptSections(source.frontPrompt, source.extraPrompt, source.middlePrompt, source.backPrompt),
    ).join(', ');
    // 메타의 NAI Comment 는 통합 프롬프트(가중치 숫자 공백 형태 포함)
    const png = embedSDStudioMetadataInPngBase64(
      addNaiComment(pngBase64, JSON.stringify({ prompt: merged, uc: 'lowres', steps: 28, scale: 5, sampler: 'k_euler' })),
      metaOf(source),
    );
    const job = await extractPromptDataFromBase64(png);
    expect(job?.prompt).toBe(merged);
    expect(job?.sdstudioMetadata?.promptSource).toEqual(source);

    const plan = planPromptImport(job!.prompt, job!.sdstudioMetadata?.promptSource, SESSION_SCENE);
    expect(plan).toEqual({
      split: true,
      frontPrompt: 'masterpiece, 0.8::artist:xyz 2 ::',
      extraPrompt: '1.2::artist:abc ::, extra tag',
      middlePrompt: '1girl, smile',
      backPrompt: 'year 2024, very aesthetic',
    });
  });

  test('메타 없는 이미지(NAI 공식·옛 SDStudio·I2I 결과)는 통합 프롬프트 전부 → 상위', async () => {
    const png = addNaiComment(pngBase64, JSON.stringify({ prompt: 'a, b, c', uc: '', steps: 28, scale: 5, sampler: 'k_euler' }));
    const job = await extractPromptDataFromBase64(png);
    expect(job?.sdstudioMetadata).toBeUndefined();
    expect(planPromptImport(job!.prompt, job!.sdstudioMetadata?.promptSource, SESSION_SCENE)).toEqual({
      split: false,
      frontPrompt: 'a, b, c',
    });
  });

  test('생성 프리셋이 아닌 대상(I2I 등)은 메타가 있어도 통합 → 상위', async () => {
    const source = await generatedSource();
    const plan = planPromptImport('merged', source, { ...SESSION_SCENE, targetType: 'SDI2I' });
    expect(plan).toEqual({ split: false, frontPrompt: 'merged' });
    expect(planPromptImport('merged', source, { ...SESSION_SCENE, targetType: undefined }).split).toBe(false);
  });

  test('놓을 자리가 없는 구획은 생성 순서를 지켜 합친다(추가→상위 끝, 씬→하위 앞)', async () => {
    const source = await generatedSource();
    const plan = planPromptImport('x', source, { targetType: 'SDImageGen', placeExtra: false, middle: 'fold' });
    expect(plan.extraPrompt).toBeUndefined();
    expect(plan.middlePrompt).toBeUndefined();
    const tokens = [...toPARR(plan.frontPrompt), ...toPARR(plan.backPrompt!)];
    const generated = toPARR(
      joinPromptSections(source.frontPrompt, source.extraPrompt, source.middlePrompt, source.backPrompt),
    );
    expect(tokens).toEqual(generated);
  });

  test("씬을 바꾸지 않기로 하면(omit) 씬 구획은 프리셋에 넣지 않는다", async () => {
    const source = await generatedSource();
    const plan = planPromptImport('x', source, { targetType: 'SDImageGen', placeExtra: true, middle: 'omit' });
    expect(plan.middlePrompt).toBeUndefined();
    expect(plan.backPrompt).toBe(source.backPrompt);
    expect(plan.frontPrompt).toBe(source.frontPrompt);
  });

  test('이지 모드 이미지: 이지 대상은 공유 칸으로, 일반 대상은 상위 끝·하위 앞에 합친다', () => {
    const source: SDStudioPromptSourceV1 = {
      schemaVersion: 1,
      workflowType: 'SDImageGenEasy',
      frontPrompt: 'front',
      extraPrompt: 'extra',
      middlePrompt: 'mid',
      backPrompt: 'back',
      characterPrompt: 'char',
      backgroundPrompt: 'bg',
    };
    const easy = planPromptImport('x', source, { ...SESSION_SCENE, targetType: 'SDImageGenEasy' });
    expect(easy).toMatchObject({ frontPrompt: 'front', backPrompt: 'back', characterPrompt: 'char', backgroundPrompt: 'bg' });
    const normal = planPromptImport('x', source, SESSION_SCENE);
    expect(normal).toMatchObject({ frontPrompt: 'front, char', backPrompt: 'bg, back', extraPrompt: 'extra', middlePrompt: 'mid' });
    expect(normal.characterPrompt).toBeUndefined();
    // 일반 이미지 → 이지 대상: 생성 당시와 같도록 캐릭터·배경 칸을 비운다
    const fromNormal = planPromptImport('x', { ...source, workflowType: 'SDImageGen', characterPrompt: undefined, backgroundPrompt: undefined }, { ...SESSION_SCENE, targetType: 'SDImageGenEasy' });
    expect(fromNormal).toMatchObject({ characterPrompt: '', backgroundPrompt: '' });
  });

  test('WebP 변환 뒤(SDST 청크, EXIF 뒤에 붙음)에도 구획 메타를 읽는다', async () => {
    const source = await generatedSource();
    // 실제 변환 결과 배치: VP8X · ALPH · VP8 · EXIF · SDST
    const chunk = (name: string, size: number) => {
      const b = Buffer.alloc(8 + size + (size & 1));
      b.write(name, 0, 4, 'ascii');
      b.writeUInt32LE(size, 4);
      return Array.from(b);
    };
    const body = [...chunk('VP8X', 10), ...chunk('ALPH', 3), ...chunk('VP8 ', 4), ...chunk('EXIF', 7)];
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 4, 'ascii');
    header.write('WEBP', 8, 4, 'ascii');
    header.writeUInt32LE(body.length + 4, 4);
    const webp = embedSDStudioMetadataInWebpBytes(
      Uint8Array.from([...Array.from(header), ...body]),
      metaOf(source),
    );
    const meta = extractSDStudioMetadataFromBase64(Buffer.from(webp).toString('base64'));
    expect(meta?.promptSource).toEqual(source);
    expect(planPromptImport('merged', meta?.promptSource, SESSION_SCENE).split).toBe(true);
  });
});

describe('씬 교체 필요 여부', () => {
  const p = (prompt: string, enabled = true) => ({ prompt, enabled });
  test('한 칸 한 조각이 같으면 교체 불필요', () => {
    expect(sceneSlotsMatchMiddle([[p('1girl, smile')]], '1girl, smile')).toBe(true);
    expect(sceneSlotsMatchMiddle([[p('1girl, smile'), p('other')]], '1girl, smile')).toBe(false);
    expect(sceneSlotsMatchMiddle([[p('a')], [p('b')]], 'a, b')).toBe(false);
  });
  test('빈 중간: 칸이 없거나 켜진 조각이 모두 빈 글자면 같음', () => {
    expect(sceneSlotsMatchMiddle([], '')).toBe(true);
    expect(sceneSlotsMatchMiddle([[p('')]], '')).toBe(true);
    expect(sceneSlotsMatchMiddle([[p('x', false)]], '')).toBe(false);
    expect(sceneSlotsMatchMiddle([[p('x')]], '')).toBe(false);
  });
});
