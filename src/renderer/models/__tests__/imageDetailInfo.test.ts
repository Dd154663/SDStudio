// 이미지 상세 보기 개편(2026-11-22) — 정보 칸 내용 규칙(models/imageDetailInfo) + 배선 소스 계약.
import * as fs from 'fs';
import * as path from 'path';
import {
  base64ByteLength,
  buildImageDetailInfo,
  DETAIL_INFO_TEXT,
  detailModelLabel,
  detailRankOf,
  formatDetailTime,
} from '../imageDetailInfo';
import type { ImportableMetadata } from '../types';

const baseJob = (over: Partial<ImportableMetadata> = {}): ImportableMetadata =>
  ({
    prompt: '1girl, smile',
    uc: 'lowres',
    seed: 1234,
    promptGuidance: 5,
    cfgRescale: 0,
    sampling: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    steps: 28,
    vibes: [],
    normalizeStrength: true,
    varietyPlus: false,
    deliberateEulerAncestralBug: false,
    characterReferences: [],
    backend: { type: 'NAI' },
    useCoords: false,
    legacyPromptConditioning: false,
    characterPrompts: [],
    resolution: { width: 832, height: 1216 },
    naiDiagnostics: { model: 'V5 Full', transparentBackground: false },
    ...over,
  }) as ImportableMetadata;

const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

describe('buildImageDetailInfo — 메타 없음', () => {
  test('생성 정보 없음 + 파일 묶음만(해상도는 파일 묶음으로)', () => {
    const t = 1763800000000;
    const info = buildImageDetailInfo(undefined, {
      filename: `${t}.png`,
      pixel: { width: 832, height: 1216 },
      format: 'png',
      bytes: 1536 * 1024,
    });
    expect(info.hasMeta).toBe(false);
    expect(info.chips).toEqual([]);
    expect(info.settings).toEqual([]);
    expect(info.prompt).toBeUndefined();
    expect(info.promptParts).toEqual([]);
    expect(keys(info.file)).toEqual(['filename', 'format', 'pixel', 'size', 'time']);
    expect(info.file.find((r) => r.key === 'format')!.value).toBe('PNG');
    expect(info.file.find((r) => r.key === 'pixel')!.value).toBe('832 × 1216');
    expect(info.file.find((r) => r.key === 'size')!.value).toBe('1.5 MB');
    expect(info.file.find((r) => r.key === 'time')!.value).toBe(formatDetailTime(t));
    expect(DETAIL_INFO_TEXT.noMeta).toBe('이 이미지에는 생성 정보가 없습니다');
  });

  test('시각을 읽을 수 없는 이름(업스케일 uuid)·크기 모름은 줄을 만들지 않는다', () => {
    const info = buildImageDetailInfo(undefined, { filename: 'a1b2c3d4-uuid.png' });
    expect(keys(info.file)).toEqual(['filename']);
  });

  test('부스트 생성 계정·변형 씬 원본 씬 이름은 파일 묶음에', () => {
    const info = buildImageDetailInfo(baseJob(), {
      filename: 'x.png',
      account: '계정 B',
      accountLabel: '생성 계정',
      sourceScene: '원본',
    });
    expect(info.file.find((r) => r.key === 'account')).toEqual({ key: 'account', label: '생성 계정', value: '계정 B' });
    expect(info.file.find((r) => r.key === 'source-scene')!.value).toBe('원본');
  });
});

describe('buildImageDetailInfo — 요약 칩·생성 설정', () => {
  test('칩 순서 = 모델·해상도·샘플러·스텝·가이던스·시드(시드만 복사)', () => {
    const info = buildImageDetailInfo(baseJob(), { filename: 'x.png', pixel: { width: 832, height: 1216 } });
    expect(info.hasMeta).toBe(true);
    expect(keys(info.chips)).toEqual(['model', 'pixel', 'sampler', 'steps', 'guidance', 'seed']);
    expect(info.chips.filter((c) => c.copy).map((c) => c.copy)).toEqual(['1234']);
  });

  test('없는 칩은 빠진다(모델 알 수 없음·시드 없음·크기 모름)', () => {
    const info = buildImageDetailInfo(
      baseJob({ seed: undefined, naiDiagnostics: { model: '알 수 없음', transparentBackground: false } }),
      { filename: 'x.png' },
    );
    expect(keys(info.chips)).toEqual(['sampler', 'steps', 'guidance']);
  });

  test('생성 설정 표 — 리스케일·노이즈·Variety+·요청 해상도(실제 픽셀과 다를 때만)', () => {
    const same = buildImageDetailInfo(baseJob({ varietyPlus: true }), {
      filename: 'x.png',
      pixel: { width: 832, height: 1216 },
    });
    expect(keys(same.settings)).toEqual(['model', 'sampler', 'steps', 'guidance', 'cfg-rescale', 'noise', 'variety', 'seed']);
    expect(same.settings.find((r) => r.key === 'variety')!.value).toBe('켜짐');
    const diff = buildImageDetailInfo(baseJob(), { filename: 'x.png', pixel: { width: 1664, height: 2432 } });
    expect(diff.settings.find((r) => r.key === 'request-size')!.value).toBe('832 × 1216');
    expect(diff.settings.find((r) => r.key === 'variety')!.value).toBe('꺼짐');
  });

  test('V5M 처럼 리스케일 키가 없으면 그 줄이 없다', () => {
    const info = buildImageDetailInfo(baseJob({ cfgRescale: undefined as any }), { filename: 'x.png' });
    expect(keys(info.settings)).not.toContain('cfg-rescale');
  });

  test('품질 태그·UC 프리셋은 SDStudio 메타가 있을 때만(앱 이름표)', () => {
    expect(keys(buildImageDetailInfo(baseJob(), { filename: 'x.png' }).settings)).not.toContain('quality');
    const info = buildImageDetailInfo(
      baseJob({
        sdstudioMetadata: {
          schemaVersion: 1,
          promptSource: { schemaVersion: 1, workflowType: 'SDImageGen', frontPrompt: '', extraPrompt: '', middlePrompt: '', backPrompt: '' },
          generationSettings: { schemaVersion: 1, modelVersion: '5-full', furryMode: false, disableQuality: true, ucPreset: 'light' },
        },
      }),
      { filename: 'x.png' },
    );
    // qualityPreset 이 없는 구 메타는 disableQuality 로 해석
    expect(info.settings.find((r) => r.key === 'quality')!.value).toBe('없음 (None)');
    expect(info.settings.find((r) => r.key === 'uc-preset')!.value).toBe('약함 (Light)');
  });

  test('인페인트 결과는 모델 판정 글자로만 「인페인트: 예」', () => {
    const info = buildImageDetailInfo(
      baseJob({ naiDiagnostics: { model: 'V4.5 Curated 인페인트', transparentBackground: false } }),
      { filename: 'x.png' },
    );
    expect(info.settings.find((r) => r.key === 'inpaint')!.value).toBe('예');
  });
});

describe('buildImageDetailInfo — 캐릭터·참조 이미지·프롬프트 구획', () => {
  test('캐릭터 위치: 위치 사용이면 좌표(소수 둘째 자리), 아니면 자동 · 빈 캐릭터는 숨김', () => {
    const chars = [
      { id: '0', prompt: 'girl', uc: '', position: { x: 0.3, y: 0.5 } },
      { id: '1', prompt: '', uc: '' },
    ] as any;
    const on = buildImageDetailInfo(baseJob({ characterPrompts: chars, useCoords: true }), { filename: 'x.png' });
    expect(on.characters).toEqual([{ index: 0, prompt: 'girl', uc: '', position: '(0.30, 0.50)' }]);
    const off = buildImageDetailInfo(baseJob({ characterPrompts: chars, useCoords: false }), { filename: 'x.png' });
    expect(off.characters[0].position).toBe('자동(AI 선택)');
  });

  test('바이브·캐릭터 레퍼런스 = 순번·그림 유무·강도 줄(base64 는 복사하지 않음)', () => {
    const info = buildImageDetailInfo(
      baseJob({
        vibes: [{ path: '', strength: 0.6, info: 1 }, { path: '', strength: 0.4, info: 0.5 }] as any,
        vibeImageData: ['iVBORAAAA', 'ZW5jb2RlZA=='],
        characterReferences: [{ path: '', strength: 1, fidelity: 0.75, info: 1, referenceType: 'style', enabled: true }] as any,
      }),
      { filename: 'x.png' },
    );
    expect(info.vibes).toEqual([
      { index: 0, hasImage: true, text: '강도 0.60 · 정보 추출 1.00' },
      // 두 번째는 그림이 아닌 인코딩 데이터 — 작은 그림 없음
      { index: 1, hasImage: false, text: '강도 0.40 · 정보 추출 0.50' },
    ]);
    expect(info.charRefs).toEqual([{ index: 0, hasImage: false, text: '스타일 · 강도 1.00 · 충실도 0.75' }]);
    expect(JSON.stringify(info)).not.toContain('iVBORAAAA');
  });

  test('프롬프트 구획 — 값 있는 구획만, 사전 세팅 종류는 이름표 함수로', () => {
    const info = buildImageDetailInfo(
      baseJob({
        sdstudioMetadata: {
          schemaVersion: 1,
          promptSource: {
            schemaVersion: 1,
            workflowType: 'SDImageGen',
            frontPrompt: 'masterpiece',
            extraPrompt: '',
            middlePrompt: 'smile, sitting',
            backPrompt: '  ',
          },
        },
      }),
      { filename: 'x.png', workflowTitle: (t) => (t === 'SDImageGen' ? '이미지 생성' : undefined) },
    );
    expect(info.promptParts).toEqual([
      { key: 'workflow', label: '사전 세팅 종류', text: '이미지 생성' },
      { key: 'front', label: '상위 프롬프트', text: 'masterpiece' },
      { key: 'middle', label: '씬에서 뽑힌 조합', text: 'smile, sitting' },
    ]);
    expect(buildImageDetailInfo(baseJob(), { filename: 'x.png' }).promptParts).toEqual([]);
  });

  test('프롬프트·네거티브가 비면 묶음 없음', () => {
    const info = buildImageDetailInfo(baseJob({ uc: '' }), { filename: 'x.png' });
    expect(info.prompt).toBe('1girl, smile');
    expect(info.uc).toBeUndefined();
  });
});

describe('보조 함수', () => {
  test('모델 표시명 — 파서 판정이 먼저, 모르면 SDStudio 메타 버전 이름표', () => {
    expect(detailModelLabel(baseJob())).toBe('V5 Full');
    expect(
      detailModelLabel(
        baseJob({
          naiDiagnostics: { model: '알 수 없음', transparentBackground: false },
          sdstudioMetadata: {
            schemaVersion: 1,
            promptSource: { schemaVersion: 1, workflowType: 'SDImageGen', frontPrompt: '', extraPrompt: '', middlePrompt: '', backPrompt: '' },
            generationSettings: { schemaVersion: 1, modelVersion: '4-5-curated', furryMode: false, disableQuality: false, ucPreset: 'heavy' },
          },
        }),
      ),
    ).toBe('V4.5 Curated');
    expect(detailModelLabel(undefined)).toBeUndefined();
  });

  test('월드컵 순위 — 1부터, 아직 갈리지 않았으면(모두 같은 순위) 없음', () => {
    expect(detailRankOf(undefined, 'a.png')).toBeUndefined();
    expect(detailRankOf([{ path: 'a.png', rank: 2 }, { path: 'b.png', rank: 2 }, { path: 'c.png', rank: 2 }], 'a.png')).toBeUndefined();
    const game = [{ path: 'a.png', rank: 0 }, { path: 'b.png', rank: 1 }, { path: 'c.png', rank: 1 }];
    expect(detailRankOf(game, 'a.png')).toBe(1);
    expect(detailRankOf(game, 'c.png')).toBe(2);
    expect(detailRankOf(game, 'z.png')).toBeUndefined();
  });

  test('base64 바이트 수(채움 반영)', () => {
    expect(base64ByteLength(Buffer.from('abc').toString('base64'))).toBe(3);
    expect(base64ByteLength(Buffer.from('abcd').toString('base64'))).toBe(4);
    expect(base64ByteLength(Buffer.from('abcde').toString('base64'))).toBe(5);
    expect(base64ByteLength('')).toBe(0);
  });

  test('생성 시각 표기 YYYY-MM-DD HH:mm:ss', () => {
    expect(formatDetailTime(new Date(2026, 10, 22, 9, 5, 7).getTime())).toBe('2026-11-22 09:05:07');
  });
});

describe('배선 소스 계약', () => {
  const read = (f: string) =>
    fs.readFileSync(path.join(__dirname, '../../componenets', f), 'utf8').replace(/\r\n/g, '\n');

  test('FloatView 머리줄 자리는 headerSlot 인 창에만(absolute — 머리줄 높이·✕ 그대로), 다른 창 마크업 불변', () => {
    const src = read('FloatView.tsx');
    expect(src).toMatch(/\{view\.headerSlot && \(\s*<div\s+ref=\{setHeaderSlotEl\}\s+data-float-view-header-slot=""\s+className="absolute inset-y-0 left-11 right-0 flex items-center min-w-0"/);
    expect(src).toContain('value={view.headerSlot ? headerSlotEl : null}');
    // ✕·구석 자리 마크업은 그대로
    expect(src).toContain('{view.undoCorner && <UndoCornerSlot />}');
    expect(src).toContain('aria-label="뒤로"');
    // 이 자리를 켜는 곳은 이미지 상세 하나
    const rv = read('ResultViewer.tsx');
    expect(rv.match(/^\s*headerSlot$/gm)).toHaveLength(1);
  });

  test('넓은 폭만 머리줄 포털·버튼 세 묶음, 모바일 V2 의 넘겨받은 버튼 판정은 라벨 정규식 그대로', () => {
    const rv = read('ResultViewer.tsx');
    expect(rv).toContain('const wideLayout = !v2 && isWide;');
    expect(rv).toContain('createPortal(headerContent, headerSlotEl)');
    for (const g of ['image', 'use', 'file']) expect(rv).toContain(`data-detail-button-group="${g}"`);
    expect(rv).toContain("buttons.find((b: any) => /즐겨찾기/.test(pluginLabel(b)))");
    expect(rv).toContain("buttons.find((b: any) => /인페인/.test(pluginLabel(b)))");
    expect(rv).toContain('<button className={`round-button ${b.className}`} onClick={() => runPlugin(b)} aria-label={pluginLabel(b)}>');
  });

  test('넘겨받은 버튼 id — 라벨·className 은 종전 그대로(V2 판정 결과 불변)', () => {
    const sq = read('SceneQueueControl.tsx');
    expect(sq).toMatch(/id: 'favorite',\s*isOn: \(path: string\) => isMainImage\(path\),\s*text: \(path: string\) => \{\s*return isMainImage\(path\) \? '즐겨찾기 해제' : '즐겨찾기 지정';/);
    expect(sq).toMatch(/id: 'inpaint',\s*text: '인페인팅 씬 생성',\s*className: 'back-green'/);
    expect(sq).toMatch(/id: 'inpaint',\s*text: '해당 이미지로 인페인트',\s*className: 'back-orange'/);
    expect(sq).toMatch(/id: 'copy-to-original',\s*text: '원본 씬으로 이미지 복사',\s*className: 'back-green'/);
    expect(sq).toMatch(/id: 'variant',\s*text: '이미지 변형',\s*className: 'back-gray'/);
  });
});

// PC 버튼 줄(2026-11-22 사용자): 업스케일 버튼 글자에 Anlas 숫자를 넣지 않고(툴팁으로), 버튼마다 앞에 아이콘.
describe('상세 보기 PC 버튼 줄 — 아이콘과 업스케일 라벨', () => {
  const fs = require('fs');
  const path = require('path');
  const src: string = fs.readFileSync(
    path.resolve(__dirname, '../../componenets/ResultViewer.tsx'),
    'utf8',
  );
  const start = src.indexOf('data-detail-buttons=""');
  const row = src.slice(start, src.indexOf('data-detail-info-pane', start));
  test('업스케일 버튼은 숫자 없는 라벨을 쓰고 비용은 툴팁에만', () => {
    expect(start).toBeGreaterThan(-1);
    expect(row).toContain('{upscaleWideLabel}');
    expect(row).toContain('title={upscaleWideTitle}');
    expect(row).not.toContain('{upscaleLabel}');
    const label = /const upscaleWideLabel = ([^;]+);/.exec(src)![1];
    expect(label).not.toContain('Anlas');
    expect(/const upscaleWideTitle =[\s\S]*?;/.exec(src)![0]).toContain('Anlas 사용');
  });
  test('줄 안의 버튼은 모두 앞에 아이콘을 둔다', () => {
    const buttons = row.split('<button').slice(1).map((b) => b.slice(0, b.indexOf('</button>')));
    expect(buttons.length).toBeGreaterThanOrEqual(9);
    for (const b of buttons) {
      // 넘겨받는 버튼은 pluginIcon(b), 나머지는 ActionIcon·Fa* 아이콘
      expect(b).toMatch(/<ActionIcon |<Fa[A-Z]\w+ |\{pluginIcon\(b\)\}/);
    }
    expect(src).toMatch(/const pluginIcon = [\s\S]*?b\.id === 'inpaint'[\s\S]*?b\.id === 'variant'[\s\S]*?b\.id === 'copy-to-original'/);
  });
});
