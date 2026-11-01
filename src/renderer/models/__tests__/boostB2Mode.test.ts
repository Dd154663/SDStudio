/**
 * 부스트 모드 B2(2026-11-01) — 순수 판정·참여 판정기·LoginService 후보 스냅샷·씬 내부 표식 직렬화.
 * - boostMode: 설정 정규화(구버전 = 꺼짐), D1 범위 3종 참여·생성 직전 재확인, D2 대상(변형 토글·Anlas 작업),
 *   비용 갈래, D3 A 배수, D4 A 몫(맡기·취소·1계정 남음), D12 순회 건너뜀, D8 표식 맵
 * - BoostPlanner: 저장 순서대로 한 번씩 조회(동시 조회 없음)·범위별 자격·캐시·조회 실패 제외
 * - LoginService.getBoostAccountSnapshot: 현재 로그인 토큰과 같은 프로필 제외(중복 계정 = 기본 워커만)
 * - Scene/InpaintScene imageAccounts: 있을 때만 직렬화, 손상 값 버림, 구 JSON 호환
 */
let profileData: string | undefined;
let currentToken: string | undefined;

const backend = {
  readLoginToken: jest.fn(async () => currentToken),
  readTokenProfileData: jest.fn(async () => profileData),
  writeTokenProfileData: jest.fn(async (data: string) => {
    profileData = data;
  }),
  writeFile: jest.fn(async () => {}),
};

jest.mock('..', () => ({ backend, workFlowService: { presetFromJSON: (j: any) => j } }));

import type { OpusUsageStatus } from '../../backends/imageGen';
import {
  BOOST_TEXT,
  boostCostClass,
  BoostJobFacts,
  canBoostAccountGenerate,
  cancelShare,
  cancelWorkerShares,
  IMAGE_ACCOUNT_MAX,
  isBoostAccountEligible,
  isBoostTargetJob,
  isShareTask,
  needsBoostQuotaCheck,
  normalizeBoostAccountScope,
  normalizeBoostMode,
  normalizeImageAccounts,
  pickShare,
  recordImageAccount,
  replicateFactor,
  resolveBoostSettings,
  settleSharesForSurvivor,
  shareCapacity,
  shouldSkipAutoRotation,
  unuseShare,
  useShare,
} from '../boostMode';
import { BoostPlanner } from '../boostPlanner';
import { LoginService } from '../LoginService';
import { InpaintScene, Scene } from '../types';
import { CONFIG_SYNC_EXCLUDED } from '../configSync';

const usage = (over: Partial<OpusUsageStatus> = {}): OpusUsageStatus => ({
  opusSubscribed: true,
  percent: 50,
  purchasedPercent: 0,
  isNegative: false,
  timeUntilNextPercent: 60,
  ...over,
});

const facts = (over: Partial<BoostJobFacts> = {}): BoostJobFacts => ({
  kind: 'gen',
  fast: false,
  isV5: true,
  width: 832,
  height: 1216,
  steps: 28,
  hasCharacterReference: false,
  ...over,
});

describe('boostMode — 설정', () => {
  test('구버전 config(키 없음)·알 수 없는 값 = 꺼짐·무료 범위·변형 작업 꺼짐', () => {
    expect(resolveBoostSettings({})).toEqual({ mode: 'off', scope: 'free', variantTasks: false });
    expect(resolveBoostSettings(undefined)).toEqual({ mode: 'off', scope: 'free', variantTasks: false });
    expect(normalizeBoostMode('A')).toBe('off');
    expect(normalizeBoostMode('replicate')).toBe('replicate');
    expect(normalizeBoostMode('split')).toBe('split');
    expect(normalizeBoostAccountScope('everything')).toBe('free');
    expect(normalizeBoostAccountScope('anlas')).toBe('anlas');
    expect(resolveBoostSettings({ boostVariantTasks: 'true' }).variantTasks).toBe(false);
    expect(resolveBoostSettings({ boostVariantTasks: true }).variantTasks).toBe(true);
  });

  test('D12: 부스트가 켜져 있으면 자동 순회를 건너뛴다', () => {
    expect(shouldSkipAutoRotation({ multiTokenAutoRotate: true })).toBe(false);
    expect(shouldSkipAutoRotation({ multiTokenAutoRotate: true, boostMode: 'split' })).toBe(true);
    expect(shouldSkipAutoRotation({ boostMode: 'replicate' })).toBe(true);
    expect(shouldSkipAutoRotation({ boostMode: 'off' })).toBe(false);
  });

  test('부스트 키 4종은 환경설정 동기화에서 제외(기기별 동의)', () => {
    for (const k of ['boostMode', 'boostAccountScope', 'boostVariantTasks', 'boostWarningDismissed']) {
      expect(CONFIG_SYNC_EXCLUDED).toContain(k);
    }
  });
});

describe('boostMode — 참여(D1)·대상(D2)·비용', () => {
  test('참여 자격: free = 구독+무료분>0, purchased = 무료 또는 추가 충전>0, anlas = 조회 성공한 계정 전부', () => {
    const free = usage({ percent: 30 });
    const purchasedOnly = usage({ percent: 0, purchasedPercent: 40 });
    const empty = usage({ percent: 0, purchasedPercent: 0 });
    const negative = usage({ percent: 0, isNegative: true });
    const unsub = usage({ opusSubscribed: false, percent: 0 });
    expect([free, purchasedOnly, empty, negative, unsub].map((u) => isBoostAccountEligible('free', u))).toEqual([
      true, false, false, false, false,
    ]);
    expect([free, purchasedOnly, empty, negative, unsub].map((u) => isBoostAccountEligible('purchased', u))).toEqual([
      true, true, false, false, false,
    ]);
    expect([free, purchasedOnly, empty, negative, unsub].map((u) => isBoostAccountEligible('anlas', u))).toEqual([
      true, true, true, true, true,
    ]);
    // 조회 실패(로그인 무효 등)는 어느 범위에서도 참여하지 않는다
    expect(isBoostAccountEligible('anlas', undefined)).toBe(false);
  });

  test('비용 갈래: V5 소형 = quota, V4.x 소형 = opus, 큰 해상도·스텝 초과·캐릭터 레퍼런스 = anlas', () => {
    expect(boostCostClass(facts())).toBe('quota');
    expect(boostCostClass(facts({ isV5: false }))).toBe('opus');
    expect(boostCostClass(facts({ width: 1536, height: 1024 }))).toBe('anlas');
    expect(boostCostClass(facts({ steps: 29 }))).toBe('anlas');
    expect(boostCostClass(facts({ isV5: false, hasCharacterReference: true }))).toBe('anlas');
    expect(boostCostClass(facts({ width: NaN }))).toBe('anlas');
  });

  test('대상: 일반 생성은 기본 대상, 변형 작업은 토글, 빠른 생성 제외, Anlas 작업은 anlas 범위만', () => {
    const free = { scope: 'free' as const, variantTasks: false };
    expect(isBoostTargetJob(facts(), free)).toBe(true);
    expect(isBoostTargetJob(facts({ isV5: false }), free)).toBe(true); // V4.5 포함
    expect(isBoostTargetJob(facts({ fast: true }), free)).toBe(false);
    expect(isBoostTargetJob(facts({ kind: 'inpaint' }), free)).toBe(false);
    expect(isBoostTargetJob(facts({ kind: 'i2i' }), { ...free, variantTasks: true })).toBe(true);
    expect(isBoostTargetJob(facts({ steps: 40 }), free)).toBe(false);
    expect(isBoostTargetJob(facts({ steps: 40 }), { scope: 'purchased', variantTasks: false })).toBe(false);
    expect(isBoostTargetJob(facts({ steps: 40 }), { scope: 'anlas', variantTasks: false })).toBe(true);
    expect(isBoostTargetJob(undefined, free)).toBe(false);
  });

  test('생성 직전 재확인: quota 요청만 조회, 범위별 탈락 조건', () => {
    expect(needsBoostQuotaCheck('free', 'quota')).toBe(true);
    expect(needsBoostQuotaCheck('purchased', 'quota')).toBe(true);
    expect(needsBoostQuotaCheck('anlas', 'quota')).toBe(false);
    expect(needsBoostQuotaCheck('free', 'opus')).toBe(false);
    const purchasedOnly = usage({ percent: 0, purchasedPercent: 10 });
    expect(canBoostAccountGenerate('free', purchasedOnly, 'quota')).toBe(false);
    expect(canBoostAccountGenerate('purchased', purchasedOnly, 'quota')).toBe(true);
    expect(canBoostAccountGenerate('purchased', usage({ percent: 0, isNegative: true }), 'quota')).toBe(false);
    expect(canBoostAccountGenerate('free', undefined, 'quota')).toBe(false);
    expect(canBoostAccountGenerate('anlas', undefined, 'anlas')).toBe(true);
    expect(canBoostAccountGenerate('free', undefined, 'anlas')).toBe(false);
    expect(canBoostAccountGenerate('free', undefined, 'opus')).toBe(true);
    expect(canBoostAccountGenerate('free', usage({ opusSubscribed: false }), 'opus')).toBe(false);
  });
});

describe('boostMode — A 배수(D3)·몫(D4)', () => {
  test('배수: A·대상·참여 2개 이상일 때만 참여 수', () => {
    expect(replicateFactor({ mode: 'replicate' }, 3, true)).toBe(3);
    expect(replicateFactor({ mode: 'replicate' }, 1, true)).toBe(1);
    expect(replicateFactor({ mode: 'replicate' }, 3, false)).toBe(1);
    expect(replicateFactor({ mode: 'split' }, 3, true)).toBe(1);
    expect(replicateFactor({ mode: 'off' }, 3, true)).toBe(1);
  });

  test('몫 맡기: 자기 몫 → 다 쓰면 빈 몫을 하나 더, 남의 몫은 맡지 않는다', () => {
    const t: any = { total: 6, done: 0, boostShares: 3 }; // 몫 3개 × 2장
    expect(isShareTask(t)).toBe(true);
    const owners: (string | undefined)[] = [];
    expect(pickShare(t, owners, 'a')).toBe(0);
    useShare(t, 0);
    expect(pickShare(t, owners, 'b')).toBe(1);
    useShare(t, 1);
    expect(pickShare(t, owners, 'a')).toBe(0);
    useShare(t, 0);
    // a 는 자기 몫을 다 써서 아무도 맡지 않은 몫 2 를 맡는다
    expect(pickShare(t, owners, 'a')).toBe(2);
    expect(owners).toEqual(['a', 'b', 'a']);
    expect(pickShare(t, owners, 'c')).toBe(-1);
    expect(isShareTask({ total: 4, done: 0 } as any)).toBe(false);
  });

  test('몫 취소: 남은 장(미할당 범위)을 건너뜀으로 돌리고 다시 맡지 않음 · 취소된 몫의 반납 장도 건너뜀', () => {
    const t: any = { total: 6, done: 1, inFlight: 1, boostShares: 2 }; // 몫 2개 × 3장
    const owners: (string | undefined)[] = ['a', 'b'];
    useShare(t, 1); // b: 성공 1(done 1)
    useShare(t, 1); // b: 진행 중 1
    expect(shareCapacity(t, 1)).toBe(1);
    expect(cancelWorkerShares(t, owners, 'b')).toBe(1);
    expect(t.skipped).toBe(1);
    expect(shareCapacity(t, 1)).toBe(0);
    expect(cancelShare(t, 1)).toBe(0); // 두 번 취소하지 않음
    // 진행 중이던 b 의 장이 반납되면 몫이 취소됐으므로 건너뜀
    expect(unuseShare(t, 1)).toBe('skipped');
    expect(t.skipped).toBe(2);
    // a 의 몫은 그대로
    expect(shareCapacity(t, 0)).toBe(3);
    expect(unuseShare(t, 0)).toBe('returned');
  });

  test('1계정만 남음: 남은 계정 몫만 남기고 나머지(다른 계정·빈 몫) 취소, 몫이 없으면 하나 맡는다', () => {
    const t: any = { total: 9, done: 0, boostShares: 3 };
    const owners: (string | undefined)[] = ['a', 'b'];
    useShare(t, 0);
    useShare(t, 1);
    t.done = 2;
    expect(settleSharesForSurvivor(t, owners, 'a')).toBe(2 + 3);
    expect(shareCapacity(t, 0)).toBe(2);
    expect(t.skipped).toBe(5);
    const t2: any = { total: 4, done: 0, boostShares: 2 };
    const owners2: (string | undefined)[] = [];
    expect(settleSharesForSurvivor(t2, owners2, 'z')).toBe(2);
    expect(owners2[0]).toBe('z');
    expect(shareCapacity(t2, 0)).toBe(2);
  });
});

describe('boostMode — 내부 표식(D8)', () => {
  test('맵 추가는 새 객체, 같은 파일은 갱신, 상한 넘으면 오래된 것부터 버림', () => {
    const a = recordImageAccount(undefined, '1.png', '계정A')!;
    const b = recordImageAccount(a, '2.png', '계정B')!;
    expect(b).not.toBe(a);
    expect(b).toEqual({ '1.png': '계정A', '2.png': '계정B' });
    expect(recordImageAccount(b, '3.png', '  ')).toBe(b);
    const capped = recordImageAccount(b, '3.png', 'C', 2)!;
    expect(Object.keys(capped)).toEqual(['2.png', '3.png']);
    expect(IMAGE_ACCOUNT_MAX).toBeGreaterThan(100);
  });

  test('정리: 손상 값·빈 맵은 없음', () => {
    expect(normalizeImageAccounts(undefined)).toBeUndefined();
    expect(normalizeImageAccounts('x')).toBeUndefined();
    expect(normalizeImageAccounts([])).toBeUndefined();
    expect(normalizeImageAccounts({ 'a.png': 3, '': 'x' })).toBeUndefined();
    expect(normalizeImageAccounts({ 'a.png': ' 계정 ', 'b.png': 1 })).toEqual({ 'a.png': '계정' });
  });

  test('Scene·InpaintScene: 있을 때만 imageAccounts 키를 쓰고, 구 JSON(키 없음)·손상 값은 없음으로 읽는다', () => {
    const base = { name: 's', resolution: 'portrait', imageMap: ['1.png'], mains: [] };
    const old = Scene.fromJSON({ ...base, type: 'scene', slots: [], meta: {} } as any);
    expect(old.imageAccounts).toBeUndefined();
    expect('imageAccounts' in old.toJSON()).toBe(false);
    const marked = Scene.fromJSON({
      ...base,
      type: 'scene',
      slots: [],
      meta: {},
      imageAccounts: { '1.png': '계정B', bad: 5 },
    } as any);
    expect(marked.imageAccounts).toEqual({ '1.png': '계정B' });
    expect(marked.toJSON().imageAccounts).toEqual({ '1.png': '계정B' });
    const broken = Scene.fromJSON({ ...base, type: 'scene', slots: [], meta: {}, imageAccounts: 'x' } as any);
    expect(broken.imageAccounts).toBeUndefined();
    const inp = InpaintScene.fromJSON({
      ...base,
      type: 'inpaint',
      workflowType: 'SDInpaint',
      imageAccounts: { '1.png': '계정C' },
    } as any)!;
    expect(inp.toJSON().imageAccounts).toEqual({ '1.png': '계정C' });
  });

  test('문구: 표식 이름표·진행 표식', () => {
    expect(BOOST_TEXT.progressTag(3)).toBe('부스트 ×3');
    expect(BOOST_TEXT.progressTag(3, true)).toBe('×3');
    expect(BOOST_TEXT.restTag(1, 3)).toBe('휴식 중 1/3');
  });
});

describe('BoostPlanner — 참여 계정 결정', () => {
  const candidates = [
    { id: 'p1', name: '계정1', token: 'tok-1' },
    { id: 'p2', name: '계정2', token: 'tok-2' },
    { id: 'p3', name: '계정3', token: 'tok-3' },
  ];

  function makePlanner(usages: Record<string, OpusUsageStatus | Error>) {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    let clock = 1_000_000;
    const getUsageForToken = jest.fn(async (token: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(token);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      const u = usages[token];
      if (u instanceof Error) throw u;
      return u;
    });
    const planner = new BoostPlanner({
      getConfig: async () => ({ boostMode: 'split', boostAccountScope: 'purchased', modelVersion: 'v5' }),
      getAccountSnapshot: async () => ({ active: { id: 'p0', name: '활성' }, candidates }),
      getUsageForToken,
      now: () => clock,
    });
    return {
      planner,
      getUsageForToken,
      order,
      maxActive: () => maxActive,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  test('저장 순서대로 한 번씩(동시 조회 없음) 조회하고 범위에 맞는 계정만, 조회 실패는 제외', async () => {
    const { planner, order, maxActive } = makePlanner({
      'tok-1': usage({ percent: 0, purchasedPercent: 20 }),
      'tok-2': new Error('network'),
      'tok-3': usage({ percent: 10 }),
    });
    const plan = await planner.getParticipants('purchased', 0);
    expect(order).toEqual(['tok-1', 'tok-2', 'tok-3']);
    expect(maxActive()).toBe(1);
    expect(plan.participants.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(plan.activeName).toBe('활성');
    const freeOnly = await planner.getParticipants('free', 0);
    expect(freeOnly.participants.map((p) => p.id)).toEqual(['p3']);
  });

  test('예약 시점 재사용: 같은 범위·maxAge 안이면 다시 조회하지 않고, 실행 시작(0)은 새로 조회', async () => {
    const { planner, getUsageForToken, advance } = makePlanner({
      'tok-1': usage(),
      'tok-2': usage(),
      'tok-3': usage(),
    });
    await planner.getParticipants('free', 60_000);
    expect(getUsageForToken).toHaveBeenCalledTimes(3);
    await planner.getParticipants('free', 60_000);
    expect(getUsageForToken).toHaveBeenCalledTimes(3);
    advance(61_000);
    await planner.getParticipants('free', 60_000);
    expect(getUsageForToken).toHaveBeenCalledTimes(6);
    await planner.getParticipants('free', 0);
    expect(getUsageForToken).toHaveBeenCalledTimes(9);
    // 진행 중 조회는 합친다
    const [x, y] = await Promise.all([planner.getParticipants('anlas', 0), planner.getParticipants('anlas', 0)]);
    expect(x).toBe(y);
    expect(getUsageForToken).toHaveBeenCalledTimes(12);
  });

  test('설정 읽기: 모드·범위·모델(대상 판정 폴백)', async () => {
    const { planner } = makePlanner({});
    expect(await planner.getSettings()).toEqual({
      mode: 'split',
      scope: 'purchased',
      variantTasks: false,
      modelVersion: 'v5',
    });
  });
});

describe('LoginService.getBoostAccountSnapshot', () => {
  beforeEach(() => {
    profileData = undefined;
    currentToken = undefined;
    jest.clearAllMocks();
  });

  test('현재 로그인 토큰과 같은 프로필은 후보에서 빼고(기본 워커가 맡음) 활성 이름으로 돌려준다', async () => {
    profileData = JSON.stringify({
      version: 1,
      activeId: 'a',
      profiles: [
        { id: 'a', name: '메인', token: 'tok-main' },
        { id: 'b', name: '서브', token: 'tok-sub' },
        { id: 'c', name: '서브2', token: 'tok-sub2' },
      ],
    });
    currentToken = ' tok-main ';
    const service = new LoginService();
    const snap = await service.getBoostAccountSnapshot();
    expect(snap.active).toEqual({ id: 'a', name: '메인' });
    expect(snap.candidates).toEqual([
      { id: 'b', name: '서브', token: 'tok-sub' },
      { id: 'c', name: '서브2', token: 'tok-sub2' },
    ]);
  });

  test('수동 로그인(저장 프로필과 다른 토큰)이면 활성 없음·저장 프로필 전부가 후보', async () => {
    profileData = JSON.stringify({
      version: 1,
      profiles: [{ id: 'b', name: '서브', token: 'tok-sub' }],
    });
    currentToken = 'tok-manual';
    const service = new LoginService();
    const snap = await service.getBoostAccountSnapshot();
    expect(snap.active).toBeUndefined();
    expect(snap.candidates.map((c) => c.id)).toEqual(['b']);
  });

  test('로그인 토큰을 읽지 못하면 throw(중복 여부를 모르면 부스트하지 않음)', async () => {
    profileData = JSON.stringify({ version: 1, profiles: [] });
    backend.readLoginToken.mockImplementationOnce(async () => {
      throw new Error('io');
    });
    const service = new LoginService();
    await expect(service.getBoostAccountSnapshot()).rejects.toThrow('io');
  });
});
