// 이미지 상세 보기 「정보 칸」의 내용 규칙(2026-11-22 상세 보기 개편) — 순수 함수, jest imageDetailInfo.test.ts.
//
// · 입력 = 이미 있는 파서(util.extractPromptDataFromBase64 → ImportableMetadata)의 결과 + 파일에서 싸게 아는 사실
//   (파일 이름·실제 픽셀·형식·바이트 수·부스트 생성 계정·변형 씬의 원본 씬 이름). 새 파서를 만들지 않는다.
// · 출력 = 보여 줄 묶음(요약 칩·프롬프트·네거티브·캐릭터·생성 설정·참조 이미지·파일·프롬프트 구획). 값이 없는 칸·묶음은
//   만들지 않는다(빈 라벨을 남기지 않음). 메타데이터가 전혀 없으면 hasMeta=false — 화면은 안내 한 줄 + 파일 묶음만.
// · 파일에 들어 있는지 확실하지 않은 값(i2i 강도·노이즈 등 파서가 읽지 않는 키)은 넣지 않는다.
// · 참조 이미지의 base64 는 여기서 복사하지 않는다 — 칸은 순번만 들고, 화면이 job 의 배열을 그 순번으로 읽는다.
import type { ImportableMetadata } from './types';
import { ModelVersion } from '../backends/imageGen';
import {
  QUALITY_PRESET_LABELS,
  UC_LABELS,
  type UcPresetKey,
} from '../backends/genVendors/naiQualityPresets';
import { outputTimestampOf } from './imageOrderSort';
import { REFERENCE_EDITOR_TEXT, referenceTypeLabel } from './referenceEditorSpec';
import { formatBytes } from './googleDrive';

export interface DetailRow {
  key: string;
  label: string;
  value: string;
  /** 누르면 복사할 글자(시드 칩 등) */
  copy?: string;
}

export interface DetailCharacter {
  index: number;
  prompt: string;
  uc: string;
  /** 위치 표기 — 위치 사용이면 「(x, y)」(캐릭터 위치 지정 창과 같은 소수 둘째 자리), 아니면 「자동(AI 선택)」 */
  position?: string;
}

export interface DetailReference {
  /** job.vibeImageData / job.referenceImageData 의 순번 — 그림이 있으면 화면이 이 순번으로 읽는다 */
  index: number;
  hasImage: boolean;
  /** 「강도 0.60 · 정보 추출 1.00」처럼 한 줄 */
  text: string;
}

export interface DetailPromptPart {
  key: string;
  label: string;
  text: string;
}

export interface ImageDetailInfoModel {
  /** NAI 메타데이터(Comment)를 읽었는가 */
  hasMeta: boolean;
  chips: DetailRow[];
  prompt?: string;
  uc?: string;
  characters: DetailCharacter[];
  settings: DetailRow[];
  vibes: DetailReference[];
  charRefs: DetailReference[];
  file: DetailRow[];
  /** SDStudio 전용 메타의 프롬프트 구획(있을 때만) */
  promptParts: DetailPromptPart[];
}

export interface DetailFileFacts {
  filename: string;
  /** 실제 파일 픽셀(불러오기 effect 의 측정값) — 모르면 undefined */
  pixel?: { width: number; height: number };
  /** 파일 형식(imageFormats.imageExtFromBase64 결과 — 'png'·'webp'·'jpg') */
  format?: string;
  bytes?: number;
  /** 부스트 다중 계정 실행 — 씬 JSON 의 앱 내부 표식(메타에는 없음) */
  account?: string;
  accountLabel?: string;
  /** 변형 씬이면 원본 씬 이름(scene.sceneRef) */
  sourceScene?: string;
  /** 사전 세팅 종류 → 이름(workFlowService def.title). 모르면 원문 */
  workflowTitle?: (type: string) => string | undefined;
}

/** 모델 버전 이름표 — 사전 세팅 편집기의 「NAI 모델 버전」 고르기와 같은 이름 */
export const MODEL_VERSION_LABELS: Record<string, string> = {
  [ModelVersion.V5]: 'V5 Full',
  [ModelVersion.V5Medium]: 'V5 Full Medium (V5M)',
  [ModelVersion.V5Curated]: 'V5 Curated',
  [ModelVersion.V4_5]: 'V4.5 Full',
  [ModelVersion.V4_5Curated]: 'V4.5 Curated',
  [ModelVersion.V4]: 'V4 Full',
  [ModelVersion.V4Curated]: 'V4 Curated',
};

export const DETAIL_INFO_TEXT = {
  noMeta: '이 이미지에는 생성 정보가 없습니다',
  on: '켜짐',
  off: '꺼짐',
  yes: '예',
  autoPosition: '자동(AI 선택)',
} as const;


const UNKNOWN_MODEL = '알 수 없음';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numText = (v: unknown): string | undefined => (isNum(v) ? String(v) : undefined);
const fixed2 = (v: unknown): string | undefined => (isNum(v) ? v.toFixed(2) : undefined);
const nonEmpty = (s: unknown): string | undefined =>
  typeof s === 'string' && s.trim() ? s : undefined;

// 메타의 참조 배열에는 원본 그림 대신 인코딩된 바이브 데이터가 들어 있을 수 있다(생성 설정 적용 창 주석) —
// 그림 머리 바이트(PNG·WebP·JPEG, imageFormats.imageExtFromBase64 와 같은 시그니처)일 때만 작은 그림을 그린다.
export function isImageBase64(data: unknown): boolean {
  return typeof data === 'string' && /^(iVBOR|UklGR|\/9j\/)/.test(data);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 로컬 시각 「YYYY-MM-DD HH:mm:ss」 */
export function formatDetailTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** base64(접두사 없음) 문자열 길이 → 바이트 수(끝 = 채움 반영) */
export function base64ByteLength(base64: string): number {
  const len = base64.length;
  if (!len) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

/** 모델 표시명 — 파서의 판정(naiDiagnostics.model)이 먼저, 모르면 SDStudio 메타의 모델 버전 이름표 */
export function detailModelLabel(job: ImportableMetadata | undefined): string | undefined {
  const diag = job?.naiDiagnostics?.model;
  if (diag && diag !== UNKNOWN_MODEL) return diag;
  const saved = job?.sdstudioMetadata?.generationSettings?.modelVersion;
  if (saved && MODEL_VERSION_LABELS[saved]) return MODEL_VERSION_LABELS[saved];
  return undefined;
}

/** 월드컵 순위(1부터) — 순위가 갈리지 않았으면(모두 같은 순위 = 아직 겨루지 않음) undefined */
export function detailRankOf(
  game: readonly { rank: number; path: string }[] | undefined,
  filename: string,
): number | undefined {
  if (!game || game.length < 2) return undefined;
  const first = game[0].rank;
  if (game.every((p) => p.rank === first)) return undefined;
  const me = game.find((p) => p.path === filename);
  return me && isNum(me.rank) ? me.rank + 1 : undefined;
}

export function buildImageDetailInfo(
  job: ImportableMetadata | undefined,
  facts: DetailFileFacts,
): ImageDetailInfoModel {
  const pixelText = facts.pixel ? `${facts.pixel.width} × ${facts.pixel.height}` : undefined;

  // 파일 묶음 — 메타 유무와 무관
  const file: DetailRow[] = [];
  if (facts.filename) file.push({ key: 'filename', label: '파일 이름', value: facts.filename });
  if (facts.format) file.push({ key: 'format', label: '형식', value: facts.format.toUpperCase() });
  if (isNum(facts.bytes) && facts.bytes > 0) {
    file.push({ key: 'size', label: '파일 크기', value: formatBytes(facts.bytes) });
  }
  const t = facts.filename ? outputTimestampOf(facts.filename) : undefined;
  if (t !== undefined) file.push({ key: 'time', label: '생성 시각', value: formatDetailTime(t) });
  if (facts.account) {
    file.push({ key: 'account', label: facts.accountLabel ?? '생성 계정', value: facts.account });
  }
  if (facts.sourceScene) file.push({ key: 'source-scene', label: '원본 씬', value: facts.sourceScene });

  if (!job) {
    // 생성 정보가 없어도 해상도(실제 픽셀)는 잃지 않게 파일 묶음에 둔다
    if (pixelText) file.splice(2, 0, { key: 'pixel', label: '해상도', value: pixelText });
    return {
      hasMeta: false,
      chips: [],
      characters: [],
      settings: [],
      vibes: [],
      charRefs: [],
      file,
      promptParts: [],
    };
  }

  const model = detailModelLabel(job);
  const sampler = nonEmpty(job.sampling);
  const steps = numText(job.steps);
  const guidance = numText(job.promptGuidance);
  const seed = numText(job.seed);

  const chips: DetailRow[] = [];
  if (model) chips.push({ key: 'model', label: '모델', value: model });
  if (pixelText) chips.push({ key: 'pixel', label: '해상도', value: pixelText });
  if (sampler) chips.push({ key: 'sampler', label: '샘플러', value: sampler });
  if (steps) chips.push({ key: 'steps', label: '스텝', value: steps });
  if (guidance) chips.push({ key: 'guidance', label: '가이던스', value: guidance });
  if (seed) chips.push({ key: 'seed', label: '시드', value: seed, copy: seed });

  const settings: DetailRow[] = [];
  if (model) settings.push({ key: 'model', label: '모델', value: model });
  if (sampler) settings.push({ key: 'sampler', label: '샘플러', value: sampler });
  if (steps) settings.push({ key: 'steps', label: '스텝', value: steps });
  if (guidance) settings.push({ key: 'guidance', label: '프롬프트 가이던스', value: guidance });
  const rescale = numText(job.cfgRescale);
  if (rescale) settings.push({ key: 'cfg-rescale', label: 'CFG 리스케일', value: rescale });
  const noise = nonEmpty(job.noiseSchedule);
  if (noise) settings.push({ key: 'noise', label: '노이즈 스케줄', value: noise });
  if (typeof job.varietyPlus === 'boolean') {
    settings.push({
      key: 'variety',
      label: 'Variety+',
      value: job.varietyPlus ? DETAIL_INFO_TEXT.on : DETAIL_INFO_TEXT.off,
    });
  }
  if (seed) settings.push({ key: 'seed', label: '시드', value: seed, copy: seed });
  const req = job.resolution;
  if (
    req && isNum(req.width) && isNum(req.height) &&
    (!facts.pixel || facts.pixel.width !== req.width || facts.pixel.height !== req.height)
  ) {
    settings.push({ key: 'request-size', label: '요청 해상도', value: `${req.width} × ${req.height}` });
  }
  const gen = job.sdstudioMetadata?.generationSettings;
  if (gen) {
    const quality = gen.qualityPreset ?? (gen.disableQuality ? 'none' : 'standard');
    const qLabel = QUALITY_PRESET_LABELS[quality];
    if (qLabel) settings.push({ key: 'quality', label: '품질 태그', value: qLabel });
    const ucLabel = UC_LABELS[gen.ucPreset as UcPresetKey];
    if (ucLabel) settings.push({ key: 'uc-preset', label: 'UC 프리셋', value: ucLabel });
  }
  if (model && /인페인트/.test(model)) {
    settings.push({ key: 'inpaint', label: '인페인트', value: DETAIL_INFO_TEXT.yes });
  }

  const characters: DetailCharacter[] = (job.characterPrompts ?? [])
    .map((c, index) => {
      const pos = c.position;
      const position =
        pos && isNum(pos.x) && isNum(pos.y)
          ? job.useCoords
            ? `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`
            : DETAIL_INFO_TEXT.autoPosition
          : undefined;
      return { index, prompt: c.prompt ?? '', uc: c.uc ?? '', position };
    })
    .filter((c) => c.prompt.trim() || c.uc.trim());

  const vibes: DetailReference[] = (job.vibes ?? []).map((v, index) => ({
    index,
    hasImage: isImageBase64(job.vibeImageData?.[index]),
    text: [
      fixed2(v.strength) && `강도 ${fixed2(v.strength)}`,
      fixed2(v.info) && `정보 추출 ${fixed2(v.info)}`,
    ]
      .filter(Boolean)
      .join(' · '),
  }));

  const charRefs: DetailReference[] = (job.characterReferences ?? []).map((r, index) => ({
    index,
    hasImage: isImageBase64(job.referenceImageData?.[index]),
    text: [
      referenceTypeLabel(r.referenceType),
      // 「같은 의상 선호」 — 값이 있을 때만(V5 메타의 _mainoutfit·_anyoutfit 에서 읽은 명시 값).
      typeof r.preferSameOutfit === 'boolean' &&
        `${REFERENCE_EDITOR_TEXT.sameOutfit} ${r.preferSameOutfit ? '켬' : '끔'}`,
      fixed2(r.strength) && `강도 ${fixed2(r.strength)}`,
      fixed2(r.fidelity) && `충실도 ${fixed2(r.fidelity)}`,
    ]
      .filter(Boolean)
      .join(' · '),
  }));

  const promptParts: DetailPromptPart[] = [];
  const src = job.sdstudioMetadata?.promptSource;
  if (src) {
    const wf = nonEmpty(src.workflowType);
    if (wf) {
      promptParts.push({
        key: 'workflow',
        label: '사전 세팅 종류',
        text: facts.workflowTitle?.(wf) ?? wf,
      });
    }
    const parts: [string, string, unknown][] = [
      ['front', '상위 프롬프트', src.frontPrompt],
      ['character', '캐릭터 관련 태그', src.characterPrompt],
      ['extra', '프로젝트 추가 프롬프트', src.extraPrompt],
      ['middle', '씬에서 뽑힌 조합', src.middlePrompt],
      ['background', '배경 관련 태그', src.backgroundPrompt],
      ['back', '하위 프롬프트', src.backPrompt],
    ];
    for (const [key, label, text] of parts) {
      const s = nonEmpty(text);
      if (s) promptParts.push({ key, label, text: s });
    }
  }

  return {
    hasMeta: true,
    chips,
    prompt: nonEmpty(job.prompt),
    uc: nonEmpty(job.uc),
    characters,
    settings,
    vibes,
    charRefs,
    file,
    promptParts,
  };
}
