// 대량 작업 I2I 일괄(2026-10-04 B1 「I2I로 이미지생성 씬 복사」·B2 「일괄 이미지 첨부」) — models/i2iBatch.ts·
// workflows/importedJob.ts·nameInput.numberedName 의 순수 규칙. 계약: SPEC_GUIDE §6 「대량 작업 I2I」·§7-3.
const pushed: any[] = [];
const answers: (string | undefined)[] = [];
jest.mock('../appStateRef', () => ({
  getAppState: () => ({
    pushDialogAsync: (dialog: any) => {
      pushed.push(dialog);
      return Promise.resolve(answers.shift());
    },
  }),
}));

import { numberedName } from '../nameInput';
import { applyImportedJob, IMPORTED_JOB_KEYS } from '../workflows/importedJob';
import {
  applyStrengthNoise,
  askImageSource,
  askStrengthNoise,
  batchResultKind,
  I2I_BATCH_TEXT,
  i2iCopyResultText,
  i2iPresetFromGeneralJob,
  imageAttachResultText,
  lowerJobForI2I,
  parseUnitInterval,
  splitI2ITargets,
} from '../i2iBatch';

beforeEach(() => {
  pushed.splice(0);
  answers.splice(0);
});

describe('이름 접미 규칙(numberedName)', () => {
  test('비어 있으면 원본 이름 그대로', () => {
    expect(numberedName('씬A', () => false)).toBe('씬A');
  });

  test('겹치면 「이름 (2)」, 그것도 겹치면 (3)', () => {
    const existing = new Set(['씬A']);
    expect(numberedName('씬A', (n) => existing.has(n))).toBe('씬A (2)');
    existing.add('씬A (2)');
    expect(numberedName('씬A', (n) => existing.has(n))).toBe('씬A (3)');
  });

  test('같은 묶음에서 앞서 정한 이름도 피한다(같은 원본 이름 두 번)', () => {
    const existing = new Set(['씬A']);
    const planned = new Set<string>();
    const taken = (n: string) => existing.has(n) || planned.has(n);
    const names = ['씬A', '씬A', '씬B'].map((base) => {
      const name = numberedName(base, taken);
      planned.add(name);
      return name;
    });
    expect(names).toEqual(['씬A (2)', '씬A (3)', '씬B']);
  });
});

// 일반 씬 잡(PromptNode) → 이미지 투 이미지 프리셋
const lower = (node: any) => `L(${node.text})`;
const freshI2IPreset = () => ({
  image: '',
  mask: '',
  strength: 1,
  noise: 0,
  steps: 28,
  cfgRescale: 0,
  promptGuidance: 5,
  sampling: 'k_euler_ancestral',
  noiseSchedule: 'karras',
  prompt: '',
  uc: '',
  characterPrompts: [],
  useCoords: false,
  legacyPromptConditioning: false,
  normalizeStrength: true,
  varietyPlus: false,
  deliberateEulerAncestralBug: false,
  vibes: [],
  characterReferences: [],
  seed: null,
});
const generalJob = (): any => ({
  type: 'sd',
  cfgRescale: 0.2,
  steps: 40,
  promptGuidance: 6.5,
  prompt: { type: 'text', text: 'girl, smile' },
  sampling: 'k_dpmpp_2m',
  uc: 'lowres, 씬 네거티브',
  characterPrompts: [
    { id: 'c1', prompt: { type: 'text', text: 'boy' }, uc: 'bad hands', position: { x: 0.3, y: 0.5 }, enabled: true },
  ],
  useCoords: true,
  legacyPromptConditioning: true,
  normalizeStrength: false,
  varietyPlus: true,
  deliberateEulerAncestralBug: true,
  characterReferences: [{ path: 'ref' }],
  noiseSchedule: 'exponential',
  backend: { type: 'NAI' },
  vibes: [{ path: 'vibe' }],
  seed: 1234,
  image: 'SHOULD-NOT-COPY',
  mask: 'SHOULD-NOT-COPY',
  strength: 0.11,
  noise: 0.22,
});

describe('프리셋 변환(i2iPresetFromGeneralJob — 「즐겨찾기 이미지 변형」과 같은 규칙)', () => {
  test('프롬프트·UC·캐릭터 프롬프트·샘플링 등 공통 설정을 옮긴다', () => {
    const preset = i2iPresetFromGeneralJob(freshI2IPreset(), generalJob(), lower);
    expect(preset.prompt).toBe('L(girl, smile)');
    expect(preset.uc).toBe('lowres, 씬 네거티브');
    expect(preset.characterPrompts).toEqual([
      { id: 'c1', prompt: 'L(boy)', uc: 'bad hands', position: { x: 0.3, y: 0.5 }, enabled: true },
    ]);
    expect(preset.cfgRescale).toBe(0.2);
    expect(preset.promptGuidance).toBe(6.5);
    expect(preset.sampling).toBe('k_dpmpp_2m');
    expect(preset.noiseSchedule).toBe('exponential');
    expect(preset.useCoords).toBe(true);
    expect(preset.legacyPromptConditioning).toBe(true);
    expect(preset.normalizeStrength).toBe(false);
    expect(preset.varietyPlus).toBe(true);
    expect(preset.deliberateEulerAncestralBug).toBe(true);
  });

  test('이미지·마스크·강도·노이즈·스텝·시드·바이브·캐릭터 레퍼런스는 옮기지 않는다', () => {
    const preset = i2iPresetFromGeneralJob(freshI2IPreset(), generalJob(), lower);
    expect(preset.image).toBe('');
    expect(preset.mask).toBe('');
    expect(preset.strength).toBe(1);
    expect(preset.noise).toBe(0);
    expect(preset.steps).toBe(28);
    expect(preset.seed).toBeNull();
    expect(preset.vibes).toEqual([]);
    expect(preset.characterReferences).toEqual([]);
  });

  test('옮기는 키 목록은 기존 applyImportedJob 12개 그대로, 누락 값은 기본값 유지', () => {
    expect([...IMPORTED_JOB_KEYS]).toEqual([
      'cfgRescale',
      'promptGuidance',
      'sampling',
      'noiseSchedule',
      'prompt',
      'uc',
      'characterPrompts',
      'useCoords',
      'legacyPromptConditioning',
      'normalizeStrength',
      'varietyPlus',
      'deliberateEulerAncestralBug',
    ]);
    const preset = applyImportedJob(freshI2IPreset(), { prompt: 'only prompt' } as any);
    expect(preset.prompt).toBe('only prompt');
    expect(preset.uc).toBe('');
    expect(preset.sampling).toBe('k_euler_ancestral');
    expect(applyImportedJob(freshI2IPreset(), undefined).promptGuidance).toBe(5);
  });

  test('lowerJobForI2I 는 원본 잡을 바꾸지 않는다', () => {
    const job = generalJob();
    const lowered = lowerJobForI2I(job, lower);
    expect(lowered.prompt).toBe('L(girl, smile)');
    expect(job.prompt).toEqual({ type: 'text', text: 'girl, smile' });
    expect(job.characterPrompts[0].prompt).toEqual({ type: 'text', text: 'boy' });
  });
});

describe('대상 필터(splitI2ITargets — B2 는 I2I 씬에만)', () => {
  test('SDI2I 만 대상, 인페인트·미러·이미지 수정은 건너뜀', () => {
    const scenes = [
      { name: 'a', workflowType: 'SDI2I' },
      { name: 'b', workflowType: 'SDInpaint' },
      { name: 'c', workflowType: 'SDMirror' },
      { name: 'd', workflowType: 'SDI2I' },
      { name: 'e', workflowType: 'Augment' },
    ];
    const { targets, skipped } = splitI2ITargets(scenes);
    expect(targets.map((s) => s.name)).toEqual(['a', 'd']);
    expect(skipped.map((s) => s.name)).toEqual(['b', 'c', 'e']);
  });
});

describe('강도·노이즈 적용', () => {
  test('함께 적용이면 넣고, 이미지만(undefined)이면 그대로', () => {
    const p1: any = { strength: 1, noise: 0 };
    applyStrengthNoise(p1, { strength: 0.6, noise: 0.1 });
    expect(p1).toEqual({ strength: 0.6, noise: 0.1 });
    const p2: any = { strength: 1, noise: 0 };
    applyStrengthNoise(p2, undefined);
    expect(p2).toEqual({ strength: 1, noise: 0 });
  });

  test('0~1 숫자 해석(0.01 반올림), 범위 밖·문자·빈 값은 거부', () => {
    expect(parseUnitInterval('0.7')).toBe(0.7);
    expect(parseUnitInterval(' 1 ')).toBe(1);
    expect(parseUnitInterval('0')).toBe(0);
    expect(parseUnitInterval('0.333')).toBe(0.33);
    expect(parseUnitInterval('1.5')).toBeUndefined();
    expect(parseUnitInterval('-0.1')).toBeUndefined();
    expect(parseUnitInterval('abc')).toBeUndefined();
    expect(parseUnitInterval('')).toBeUndefined();
    expect(parseUnitInterval(undefined)).toBeUndefined();
  });

  test('askStrengthNoise — 이미지만', async () => {
    answers.push('image-only');
    await expect(askStrengthNoise({ strength: 1, noise: 0 })).resolves.toEqual({ values: undefined });
    expect(pushed[0].items.map((x: any) => x.text)).toEqual([
      I2I_BATCH_TEXT.applyWithValues,
      I2I_BATCH_TEXT.imageOnly,
    ]);
  });

  test('askStrengthNoise — 함께 적용(값 입력, 처음 값 = 기본값, 창 안 검증)', async () => {
    answers.push('with-values', '0.6', '0.1');
    await expect(askStrengthNoise({ strength: 1, noise: 0 })).resolves.toEqual({
      values: { strength: 0.6, noise: 0.1 },
    });
    expect(pushed[1].type).toBe('input-confirm');
    expect(pushed[1].inputValue).toBe('1');
    expect(pushed[2].inputValue).toBe('0');
    expect(pushed[1].validate('1.5')).toBe(I2I_BATCH_TEXT.unitRange);
    expect(pushed[1].validate('0.5')).toBeNull();
  });

  test('askStrengthNoise — 어느 단계든 취소면 undefined', async () => {
    answers.push(undefined);
    await expect(askStrengthNoise({ strength: 1, noise: 0 })).resolves.toBeUndefined();
    answers.push('with-values', '0.5', undefined);
    await expect(askStrengthNoise({ strength: 1, noise: 0 })).resolves.toBeUndefined();
  });

  test('askImageSource — B1 은 [이미지 없이] 포함, B2 는 파일·기존 둘', async () => {
    answers.push('none');
    await expect(askImageSource(true)).resolves.toBe('none');
    expect(pushed[0].items.map((x: any) => x.value)).toEqual(['file', 'existing', 'none']);
    answers.push(undefined);
    await expect(askImageSource(false)).resolves.toBeUndefined();
    expect(pushed[1].items.map((x: any) => x.value)).toEqual(['file', 'existing']);
  });
});

describe('토스트 집계', () => {
  test('B1 — N개 I2I 씬 생성(이미지 첨부 M개) + 실패', () => {
    expect(i2iCopyResultText({ created: 3, withImage: 3, failed: [] })).toBe(
      '3개 I2I 씬 생성(이미지 첨부 3개)',
    );
    expect(i2iCopyResultText({ created: 2, withImage: 0, failed: [] })).toBe(
      '2개 I2I 씬 생성(이미지 첨부 0개)',
    );
    expect(
      i2iCopyResultText({ created: 1, withImage: 1, failed: ['x', 'y'], firstError: '조각 없음' }),
    ).toBe('1개 I2I 씬 생성(이미지 첨부 1개) · 실패 2개: x, y\n첫 오류: 조각 없음');
  });

  test('B2 — 첨부 N개 + 건너뜀 K개(인페인트/미러 등) + 실패', () => {
    expect(imageAttachResultText({ applied: 2, skipped: 0, failed: [] })).toBe(
      '2개 I2I 씬에 이미지를 첨부했습니다',
    );
    expect(imageAttachResultText({ applied: 2, skipped: 3, failed: ['z'] })).toBe(
      '2개 I2I 씬에 이미지를 첨부했습니다 · 건너뜀 3개(인페인트/미러 등) · 실패 1개: z',
    );
    expect(I2I_BATCH_TEXT.noI2ITargets(2)).toContain('건너뜀 2개');
  });

  test('실패 이름은 5개까지만', () => {
    const failed = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(imageAttachResultText({ applied: 0, skipped: 0, failed })).toContain(
      '실패 6개: a, b, c, d, e 외',
    );
  });

  test('토스트 종류', () => {
    expect(batchResultKind(3, 0)).toBe('success');
    expect(batchResultKind(2, 1)).toBe('info');
    expect(batchResultKind(0, 2)).toBe('error');
    expect(batchResultKind(0, 0)).toBe('success');
  });
});
