// WebP 일괄 변환의 목적지 이름 — 같은 이름의 WebP 가 이미 있으면 덮지 않는다(2026-11-21).
// WebP 를 외부 편집기로 고치면 편집기가 같은 이름의 PNG 를 옆에 저장할 수 있고,
// 종전에는 그 PNG 를 변환하면서 원본 WebP 를 확인 없이 덮어썼다.
import * as fs from 'fs';
import * as path from 'path';
import { planWebpTargets } from '../imageFormats';

describe('planWebpTargets', () => {
  it('겹치는 이름이 없으면 확장자만 바꾼다', () => {
    const t = planWebpTargets(['1.png', '2.png'], ['1.png', '2.png']);
    expect([...t.entries()]).toEqual([
      ['1.png', '1.webp'],
      ['2.png', '2.webp'],
    ]);
  });

  it('같은 이름의 WebP 가 이미 있으면 (2) 를 붙인다', () => {
    const t = planWebpTargets(['1.png', '2.png'], ['1.png', '1.webp', '2.png']);
    expect(t.get('1.png')).toBe('1 (2).webp');
    expect(t.get('2.png')).toBe('2.webp');
  });

  it('(2) 도 있으면 다음 번호로 넘어간다', () => {
    const t = planWebpTargets(['a.png'], ['a.png', 'a.webp', 'a (2).webp']);
    expect(t.get('a.png')).toBe('a (3).webp');
  });

  it('대소문자만 다른 이름도 겹친 것으로 본다', () => {
    const t = planWebpTargets(['Cat.PNG'], ['Cat.PNG', 'cat.WEBP']);
    expect(t.get('Cat.PNG')).toBe('Cat (2).webp');
  });

  it('이번 변환끼리도 같은 목적지를 받지 않는다', () => {
    // 「a (2).png」 의 목적지와 「a.png」 가 밀려난 자리가 겹치는 경우
    const t = planWebpTargets(
      ['a.png', 'a (2).png'],
      ['a.png', 'a (2).png', 'a.webp'],
    );
    const values = [...t.values()].map((v) => v.toLowerCase());
    expect(new Set(values).size).toBe(2);
    expect(values).not.toContain('a.webp');
  });

  it('이름에 점이 여러 개여도 마지막 확장자 앞에 붙인다', () => {
    const t = planWebpTargets(['v1.2.png'], ['v1.2.png', 'v1.2.webp']);
    expect(t.get('v1.2.png')).toBe('v1.2 (2).webp');
  });
});

describe('WebP 일괄 변환 호출부', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'BatchProcessService.ts'),
    'utf-8',
  );

  it('목적지 이름을 planWebpTargets 로 정한다(폴더의 기존 파일과 대조)', () => {
    expect(src).toMatch(
      /planWebpTargets\(\s*pngs,\s*imageService\.getOutputs\(session, scene\)\s*\)/,
    );
  });

  it('확장자만 바꾼 이름을 그대로 목적지로 쓰지 않는다', () => {
    expect(src).not.toMatch(/webp:\s*png\.replace\(/);
    expect(src).not.toMatch(/webp:\s*pngPathToWebp\(/);
  });
});
