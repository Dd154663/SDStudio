/**
 * V5 캐릭터(정밀) 레퍼런스(2026-11-25) — 생성 핸들러 조립·예약 비용 판정·「유료 세팅」 항목.
 * - 레퍼런스는 referencesForModel 결과만 읽고, 모델 능력의 손질 방식(letterbox/bucket)으로 손질한다
 * - V5 는 계정과 무관하게 바이브 인코딩·불러오기를 건너뛴다
 * - calculateCost 에 「캐릭터 레퍼런스 n장」 항목
 */
const getConfig = jest.fn(async () => ({}));
const generateImage = jest.fn(async (_arg: any, _opt?: any) => {});
const checkEncodedVibeImage = jest.fn(async () => false);
const encodeVibeImage = jest.fn(async () => {});
const fetchEncodedVibeImage = jest.fn(async () => 'data:x;base64,ENC');
const fetchReferenceImage = jest.fn(async (_s: any, path: string) => `data:image/jpeg;base64,RAW-${path}`);
const prepareReferenceForApi = jest.fn(async (data: string, opts: any) => `${data}|${opts.preprocess}`);
const refresh = jest.fn(async () => undefined);

jest.mock('..', () => ({
  backend: {
    getConfig,
    generateImage,
    deleteFile: jest.fn(async () => {}),
    delegateComplete: jest.fn(async () => {}),
    delegateQueueSnapshot: jest.fn(async () => {}),
  },
  imageService: {
    onAddImage: jest.fn(),
    onAddInPaint: jest.fn(),
    removeImageReference: jest.fn(),
    checkEncodedVibeImage,
    encodeVibeImage,
    fetchEncodedVibeImage,
    fetchReferenceImage,
    prepareReferenceForApi,
  },
  isMobile: false,
  localAIService: {},
  loginService: {},
  opusUsageService: {
    refresh,
    takeLowWarning: jest.fn(() => false),
    takePurchasedNotice: jest.fn(() => false),
    needsPaidConfirm: jest.fn(() => false),
  },
  promptService: {},
  sessionService: {},
  taskQueueService: {},
  workFlowService: {},
}));

jest.mock('../AppService', () => ({
  appState: { pushMessage: jest.fn(), pushDialog: jest.fn(), confirmAsync: jest.fn() },
}));
jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));
jest.mock('../PromptService', () => ({
  expandPieces: jest.fn((uc: string) => uc),
  lowerPromptNode: jest.fn((node: any) => node?.text ?? ''),
  toPARR: jest.fn(),
}));
jest.mock('../ImageService', () => ({
  dataUriToBase64: jest.fn((data: string) => data.split(',')[1]),
}));
jest.mock('../workflows/SDWorkFlow', () => ({
  prepareMirrorCanvas: jest.fn(),
}));
jest.mock('../../componenets/BrushTool', () => ({
  getImageDimensions: jest.fn(),
}));
jest.mock('../focusedInpaintCanvas', () => ({
  prepareFocusedRequest: jest.fn(),
  composeFocusedResult: jest.fn(),
}));

import { ModelVersion, Resolution } from '../../backends/imageGen';
import { taskHandlers } from '../TaskHandlers';
import { TaskAttemptContext, TaskHandler } from '../TaskQueueService';

const REFS = [
  { path: 'a.png', info: 1, strength: 0.6, fidelity: 1, referenceType: 'character', enabled: true, preferSameOutfit: true, srcWidth: 800, srcHeight: 600 },
  { path: 'b.png', info: 1, strength: 0.6, fidelity: 1, referenceType: 'costume', enabled: true },
  { path: 'c.png', info: 1, strength: 0.6, fidelity: 1, referenceType: 'style', enabled: false },
];

function genTask(modelVersion: ModelVersion | undefined, refs: any[] = REFS, vibes: any[] = []) {
  return {
    id: 'g',
    params: {
      session: { name: 'project' },
      scene: {
        name: 'scene',
        type: 'scene',
        resolution: Resolution.Custom,
        resolutionWidth: 832,
        resolutionHeight: 1216,
      },
      outputPath: 'outs/project/scene',
      nodelay: false,
      ...(modelVersion
        ? {
            generationSnapshot: {
              schemaVersion: 1,
              modelVersion,
              furryMode: false,
              disableQuality: true,
              ucPreset: 'none',
              autoConvertWebp: false,
              autoConvertWebpQuality: 80,
            },
          }
        : {}),
      job: {
        type: 'sd',
        cfgRescale: 0,
        steps: 28,
        promptGuidance: 5,
        prompt: { type: 'text', text: 'girl' },
        sampling: 'k_euler_ancestral',
        uc: '',
        characterPrompts: [],
        useCoords: false,
        legacyPromptConditioning: false,
        normalizeStrength: true,
        varietyPlus: false,
        noiseSchedule: 'karras',
        characterReferences: refs,
        backend: { type: 'NAI' },
        vibes,
        seed: 1,
      },
    },
    done: 0,
    total: 1,
  } as any;
}

function ctxFor(worker?: TaskAttemptContext['worker']): TaskAttemptContext {
  return {
    attempt: 1,
    signal: new AbortController().signal,
    requestTimeoutMs: 120000,
    pauseTimeoutWhile: (fn) => fn(),
    restartTimeout: jest.fn(),
    imageIndex: 0,
    ...(worker ? { worker } : {}),
  };
}

const DEFAULT = { id: 'default', name: '기본 계정', isDefault: true };
const handler = (): TaskHandler => taskHandlers.find((h) => h.checkTask(genTask(ModelVersion.V5)))!;
const sentRefs = () => generateImage.mock.calls[0][0].characterReferences;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('handleTask 레퍼런스 조립', () => {
  test('V5 Full: 켜진 것(의상 포함)만 읽고 bucket 으로 손질, 원본 크기·같은 의상 선호를 넘긴다', async () => {
    await handler().handleTask(genTask(ModelVersion.V5), { stopped: false }, ctxFor(DEFAULT));
    expect(fetchReferenceImage.mock.calls.map((c) => c[1])).toEqual(['a.png', 'b.png']);
    expect(prepareReferenceForApi).toHaveBeenCalledWith('RAW-a.png', {
      preprocess: 'bucket',
      srcWidth: 800,
      srcHeight: 600,
    });
    expect(prepareReferenceForApi).toHaveBeenCalledWith('RAW-b.png', {
      preprocess: 'bucket',
      srcWidth: undefined,
      srcHeight: undefined,
    });
    const refs = sentRefs();
    expect(refs.map((r: any) => r.referenceType)).toEqual(['character', 'costume']);
    expect(refs[0].preferSameOutfit).toBe(true);
    expect(refs[1]).not.toHaveProperty('preferSameOutfit');
    expect(refs[0].image).toBe('RAW-a.png|bucket');
    // 레퍼런스가 실리면 Opus 무료 대상이 아니다 — 할당량 확인 블록을 건너뜀
    expect(refresh).not.toHaveBeenCalledWith(true);
  });

  test('V4.5: letterbox, 의상은 읽지도 않음', async () => {
    await handler().handleTask(genTask(ModelVersion.V4_5), { stopped: false }, ctxFor(DEFAULT));
    expect(fetchReferenceImage.mock.calls.map((c) => c[1])).toEqual(['a.png']);
    expect(prepareReferenceForApi.mock.calls[0][1].preprocess).toBe('letterbox');
    expect(sentRefs()).toHaveLength(1);
  });

  test.each([ModelVersion.V5Medium, ModelVersion.V4])('%s: 레퍼런스 파일을 읽지 않고 보내지 않음', async (version) => {
    await handler().handleTask(genTask(version), { stopped: false }, ctxFor(DEFAULT));
    expect(fetchReferenceImage).not.toHaveBeenCalled();
    expect(sentRefs()).toEqual([]);
  });

  test('실행당 캐시 키 = 경로 + 손질 방식(모델이 섞여도 손질이 섞이지 않음)', async () => {
    const run: any = { stopped: false };
    const one = [REFS[0]];
    await handler().handleTask(genTask(ModelVersion.V5, one), run, ctxFor(DEFAULT));
    await handler().handleTask(genTask(ModelVersion.V4_5, one), run, ctxFor(DEFAULT));
    await handler().handleTask(genTask(ModelVersion.V5, one), run, ctxFor(DEFAULT));
    expect(prepareReferenceForApi.mock.calls.map((c) => c[1].preprocess)).toEqual(['bucket', 'letterbox']);
    expect(generateImage.mock.calls.map((c) => c[0].characterReferences[0].image)).toEqual([
      'RAW-a.png|bucket',
      'RAW-a.png|letterbox',
      'RAW-a.png|bucket',
    ]);
  });

  test('기본 계정 + V5: 바이브 인코딩·불러오기 자체를 건너뜀(결정 5)', async () => {
    const task = genTask(ModelVersion.V5, [], [{ path: 'v.png', info: 1, strength: 0.6 }]);
    await handler().handleTask(task, { stopped: false }, ctxFor(DEFAULT));
    expect(checkEncodedVibeImage).not.toHaveBeenCalled();
    expect(encodeVibeImage).not.toHaveBeenCalled();
    expect(fetchEncodedVibeImage).not.toHaveBeenCalled();
    expect(generateImage.mock.calls[0][0].vibes).toEqual([]);
  });

  test('V4.5: 레퍼런스가 실리면 바이브는 요청에서 빠짐(종전 규칙), 의상만 있으면 바이브 유지', async () => {
    checkEncodedVibeImage.mockImplementation(async () => true);
    const vibes = [{ path: 'v.png', info: 1, strength: 0.6 }];
    await handler().handleTask(genTask(ModelVersion.V4_5, [REFS[0]], vibes), { stopped: false }, ctxFor(DEFAULT));
    expect(generateImage.mock.calls[0][0].vibes).toEqual([]);
    await handler().handleTask(genTask(ModelVersion.V4_5, [REFS[1]], vibes), { stopped: false }, ctxFor(DEFAULT));
    expect(generateImage.mock.calls[1][0].vibes).toHaveLength(1);
  });
});

describe('예약 비용 판정', () => {
  test.each([
    [ModelVersion.V5, true],
    [ModelVersion.V5Curated, true],
    [ModelVersion.V4_5, true],
    [ModelVersion.V5Medium, false],
    [ModelVersion.V4, false],
  ])('boostFacts.hasCharacterReference (%s) = %s', (version, expected) => {
    expect((handler() as any).boostFacts(genTask(version)).hasCharacterReference).toBe(expected);
  });

  test('레퍼런스는 생성 시작의 유료 세팅 항목을 내지 않는다(모든 모델 — 2026-11-25 사용자 결정)', () => {
    for (const v of [ModelVersion.V5, ModelVersion.V5Curated, ModelVersion.V4_5, ModelVersion.V5Medium, ModelVersion.V4, undefined]) {
      expect(handler().calculateCost(genTask(v as any))).toEqual([]);
    }
  });
});
