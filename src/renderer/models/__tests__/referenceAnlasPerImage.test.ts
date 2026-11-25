import { referenceAnlasPerImage } from '../../backends/genVendors/naiReference';
import { ModelVersion } from '../../backends/imageGen';

// 상단 Anlas 배지의 「-n」(이미지 1장마다 쓰는 레퍼런스 Anlas) — 실제로 보낼 레퍼런스 수 × 5.
// 레퍼런스로 인한 소모는 생성 시작 확인(유료 세팅)에 넣지 않는다(2026-11-25 사용자 결정) — 알림은 이 표시뿐이다.
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
