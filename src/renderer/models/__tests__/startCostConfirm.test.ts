import { planStartCostConfirm, START_COST_ANLAS_CONFIRM_THRESHOLD } from '../startCostConfirm';
import { referenceAnlasPerImage } from '../../backends/genVendors/naiReference';
import { ModelVersion } from '../../backends/imageGen';

const ref = (anlas: number, scene = 's') => ({ scene, text: '캐릭터 레퍼런스 1장 (1장당 5 Anlas)', anlas });
const steps = (scene = 's') => ({ scene, text: '스탭 수 28개 초과' });
const NL = String.fromCharCode(10);

describe('생성 시작 확인 판정', () => {
  test('항목이 없으면 묻지 않는다', () => {
    expect(planStartCostConfirm([])).toEqual({ confirm: false, text: '', knownAnlas: 0 });
  });

  test('레퍼런스만 있고 합계가 기준 이하면 묻지 않는다(기준과 같아도)', () => {
    expect(planStartCostConfirm([ref(500), ref(500)]).confirm).toBe(false);
    expect(planStartCostConfirm([ref(START_COST_ANLAS_CONFIRM_THRESHOLD)]).confirm).toBe(false);
  });

  test('레퍼런스 합계가 기준을 넘으면 합계 한 줄로 묻는다(예약마다 줄을 늘어놓지 않음)', () => {
    const plan = planStartCostConfirm([ref(600), ref(600)]);
    expect(plan.confirm).toBe(true);
    expect(plan.knownAnlas).toBe(1200);
    const lines = plan.text.split(NL);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('1200 Anlas');
  });

  test('스텝·해상도 항목은 종전처럼 항상 묻고, 기준 이하의 레퍼런스 줄은 넣지 않는다', () => {
    const plan = planStartCostConfirm([steps('a'), ref(50, 'a')]);
    expect(plan.confirm).toBe(true);
    expect(plan.text.split(NL)).toEqual([
      'Anlas를 소모하는 유료 세팅입니다. 계속합니까?',
      '스탭 수 28개 초과 (씬: a)',
    ]);
  });

  test('둘 다 해당하면 합계 줄이 먼저, 그 밖의 항목은 10줄까지', () => {
    const many = Array.from({ length: 15 }, (_, i) => steps('s' + i));
    const lines = planStartCostConfirm([ref(2000), ...many]).text.split(NL);
    expect(lines).toHaveLength(12);
    expect(lines[1]).toContain('2000 Anlas');
    expect(lines[2]).toBe('스탭 수 28개 초과 (씬: s0)');
  });
});

describe('장당 Anlas 소모', () => {
  const refs = [
    { path: 'a.png', referenceType: 'character' },
    { path: 'b.png', referenceType: 'costume' },
    { path: 'c.png', referenceType: 'style', enabled: false },
  ];
  test('실제로 보낼 레퍼런스 수 × 5', () => {
    expect(referenceAnlasPerImage(refs, ModelVersion.V5)).toBe(10);
    expect(referenceAnlasPerImage(refs, ModelVersion.V4_5)).toBe(5); // 의상은 V4.5 에 보내지 않음
    expect(referenceAnlasPerImage(refs, ModelVersion.V5Medium)).toBe(0);
    expect(referenceAnlasPerImage(undefined, ModelVersion.V5)).toBe(0);
  });
});
