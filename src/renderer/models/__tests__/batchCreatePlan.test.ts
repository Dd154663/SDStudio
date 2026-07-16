// 일괄 생성(배치 R2) 조합·이름 순수 로직 가드 — batchCreatePlan.ts (리프 모듈,
// mock 불필요). 이름 규칙(스펙 4항)·서브폴더(5항)·충돌 해소(`_n` 접미) 고정.
import {
  buildBatchItemName,
  buildBatchCombinations,
  resolveBatchName,
} from '../batchCreatePlan';

describe('buildBatchItemName — 이름 규칙', () => {
  it('양 축 = {캐릭터}_{씬템플릿}, 한 축뿐이면 그 축 이름', () => {
    expect(buildBatchItemName('앨리스', '씬셋A')).toBe('앨리스_씬셋A');
    expect(buildBatchItemName('앨리스', undefined)).toBe('앨리스');
    expect(buildBatchItemName(undefined, '씬셋A')).toBe('씬셋A');
  });
});

describe('buildBatchCombinations — 데카르트 곱', () => {
  const chars = [
    { id: 'c1', name: '앨리스' },
    { id: 'c2', name: '밥' },
  ];
  const scenes = ['씬셋A', '씬셋B'];

  it('2×2 = 4개 조합, 서브폴더 = 캐릭터 이름', () => {
    const items = buildBatchCombinations(chars, scenes, true);
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({
      name: '앨리스_씬셋A',
      charPresetId: 'c1',
      sceneTemplateName: '씬셋A',
      subfolder: '앨리스',
    });
    expect(items[3]).toEqual({
      name: '밥_씬셋B',
      charPresetId: 'c2',
      sceneTemplateName: '씬셋B',
      subfolder: '밥',
    });
  });

  it('서브폴더 OFF 면 subfolder 미지정', () => {
    const items = buildBatchCombinations(chars, scenes, false);
    expect(items.every((i) => i.subfolder === undefined)).toBe(true);
  });

  it('캐릭터 축만 (씬 축 없음 = 템플릿 기본 씬)', () => {
    const items = buildBatchCombinations(chars, [], true);
    expect(items).toEqual([
      { name: '앨리스', charPresetId: 'c1', subfolder: '앨리스' },
      { name: '밥', charPresetId: 'c2', subfolder: '밥' },
    ]);
  });

  it('씬 축만 (캐릭터 축 없음 — 서브폴더 플래그 무시)', () => {
    const items = buildBatchCombinations([], scenes, true);
    expect(items).toEqual([
      { name: '씬셋A', sceneTemplateName: '씬셋A' },
      { name: '씬셋B', sceneTemplateName: '씬셋B' },
    ]);
  });

  it('양 축 모두 비면 빈 배열 (실행 비활성 조건)', () => {
    expect(buildBatchCombinations([], [], true)).toEqual([]);
  });
});

describe('resolveBatchName — 충돌 해소 (기존 프로젝트+배치 내)', () => {
  it('충돌 없으면 그대로, taken 에 등록', () => {
    const taken = new Set<string>(['다른것']);
    expect(resolveBatchName('앨리스_씬셋A', taken)).toBe('앨리스_씬셋A');
    expect(taken.has('앨리스_씬셋A')).toBe(true);
  });

  it('기존 프로젝트와 충돌 시 _n 접미', () => {
    const taken = new Set<string>(['앨리스']);
    expect(resolveBatchName('앨리스', taken)).toBe('앨리스_1');
  });

  it('배치 내 반복 충돌은 순번 증가 (_1, _2, …)', () => {
    const taken = new Set<string>(['이름']);
    expect(resolveBatchName('이름', taken)).toBe('이름_1');
    expect(resolveBatchName('이름', taken)).toBe('이름_2');
    // 기존에 이름_3 이 이미 있으면 건너뛴다
    taken.add('이름_3');
    expect(resolveBatchName('이름', taken)).toBe('이름_4');
  });
});
