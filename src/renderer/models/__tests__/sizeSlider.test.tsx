/** @jest-environment jsdom */
// 크기 슬라이더(2026-11-23 사용자 결정 — 씬 카드 「스몰뷰/미디엄뷰/라지뷰」 순환 버튼·PC 이미지 그리드 S/M/L 단추를 슬라이더로).
// ① % → 크기 규칙(25·50·75 = 종전 세 단계, 양 끝, 범위 밖 정리) ② 썸네일 요청 = 단계 값 ③ 기억(기본 50·읽기 실패)
// ④ 공용 부품(range·접근성·화면 그리기마다 한 번 알림·두 번 누르면 50) ⑤ 두 화면 연결(같은 자리, 모바일 종전 그대로).
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import {
  IMAGE_GRID_SIZE_STEPS,
  IMAGE_GRID_SIZE_STORAGE_KEY,
  SCENE_CARD_FIXED_HEIGHT_VAR,
  SCENE_CARD_SIZE_STORAGE_KEY,
  SIZE_PERCENT_DEFAULT,
  SIZE_SLIDER_TEXT,
  effectiveSceneCardPercent,
  imageGridCellPx,
  imageGridThumbPx,
  normalizeSizePercent,
  readSizePercent,
  sceneCardFixedHeightPx,
  sceneCardMinWidthPx,
  writeSizePercent,
} from '../sizeSlider';
import SizeSlider from '../../componenets/SizeSlider';

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../../componenets', rel), 'utf-8').replace(/\r\n/g, '\n');

describe('% → 크기 규칙', () => {
  test('25·50·75% = 종전 세 단계와 정확히 같다', () => {
    expect([25, 50, 75].map(sceneCardMinWidthPx)).toEqual([180, 240, 320]);
    expect([25, 50, 75].map(sceneCardFixedHeightPx)).toEqual([192, 256, 384]); // h-48·h-64·h-96
    expect([25, 50, 75].map(imageGridCellPx)).toEqual([200, 400, 500]); // S·M·L
  });
  test('양 끝 — 같은 기울기로 연장, 하한에서 멈춤', () => {
    expect(sceneCardMinWidthPx(0)).toBe(150); // 연장 120 → 하한 150
    expect(sceneCardMinWidthPx(100)).toBe(400);
    expect(sceneCardFixedHeightPx(0)).toBe(128);
    expect(sceneCardFixedHeightPx(100)).toBe(512);
    expect(imageGridCellPx(0)).toBe(120); // 연장 0 → 하한 120
    expect(imageGridCellPx(100)).toBe(600);
  });
  test('사이 값은 연속(단조 증가)', () => {
    for (let p = 1; p <= 100; p++) {
      expect(sceneCardMinWidthPx(p)).toBeGreaterThanOrEqual(sceneCardMinWidthPx(p - 1));
      expect(sceneCardFixedHeightPx(p)).toBeGreaterThan(sceneCardFixedHeightPx(p - 1));
      expect(imageGridCellPx(p)).toBeGreaterThanOrEqual(imageGridCellPx(p - 1));
    }
    expect(sceneCardMinWidthPx(60)).toBe(272);
    expect(imageGridCellPx(40)).toBe(320);
  });
  test('범위 밖·이상한 값 정리', () => {
    expect(normalizeSizePercent(-10)).toBe(0);
    expect(normalizeSizePercent(250)).toBe(100);
    expect(normalizeSizePercent(33.6)).toBe(34);
    expect(normalizeSizePercent('70')).toBe(70);
    expect(normalizeSizePercent('')).toBe(SIZE_PERCENT_DEFAULT);
    expect(normalizeSizePercent('abc')).toBe(SIZE_PERCENT_DEFAULT);
    expect(normalizeSizePercent(NaN)).toBe(SIZE_PERCENT_DEFAULT);
    expect(normalizeSizePercent(undefined)).toBe(SIZE_PERCENT_DEFAULT);
    expect(sceneCardMinWidthPx(-50)).toBe(sceneCardMinWidthPx(0));
    expect(imageGridCellPx(999)).toBe(imageGridCellPx(100));
  });
  test('패널 없는 씬 목록(그리드 안 인페인트 씬 탭) = 75% 이상', () => {
    expect(effectiveSceneCardPercent(30, true)).toBe(30);
    expect(effectiveSceneCardPercent(30, false)).toBe(75);
    expect(effectiveSceneCardPercent(90, false)).toBe(90);
  });
});

describe('썸네일 요청 크기 = 단계 값으로 올림', () => {
  test('칸 크기 → 200·400·500', () => {
    expect(imageGridThumbPx(120)).toBe(200);
    expect(imageGridThumbPx(200)).toBe(200);
    expect(imageGridThumbPx(201)).toBe(400);
    expect(imageGridThumbPx(400)).toBe(400);
    expect(imageGridThumbPx(450)).toBe(500);
    expect(imageGridThumbPx(600)).toBe(500);
  });
  test('0~100% 전체에서 요청 크기는 단계 값 셋 중 하나뿐(캐시가 불어나지 않음)', () => {
    const sizes = new Set<number>();
    for (let p = 0; p <= 100; p++) sizes.add(imageGridThumbPx(imageGridCellPx(p)));
    expect([...sizes].sort((a, b) => a - b)).toEqual([...IMAGE_GRID_SIZE_STEPS]);
  });
});

describe('기억(localStorage, 앱 전체 하나)', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  test('값이 없으면 50, 저장한 값을 읽음, 키는 둘이 따로', () => {
    const s = mem();
    expect(readSizePercent(s, SCENE_CARD_SIZE_STORAGE_KEY)).toBe(50);
    writeSizePercent(s, SCENE_CARD_SIZE_STORAGE_KEY, 80);
    writeSizePercent(s, IMAGE_GRID_SIZE_STORAGE_KEY, 10);
    expect(readSizePercent(s, SCENE_CARD_SIZE_STORAGE_KEY)).toBe(80);
    expect(readSizePercent(s, IMAGE_GRID_SIZE_STORAGE_KEY)).toBe(10);
    expect(SCENE_CARD_SIZE_STORAGE_KEY).not.toBe(IMAGE_GRID_SIZE_STORAGE_KEY);
  });
  test('읽기·쓰기 실패·이상한 값 = 50, 던지지 않음', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSizePercent(broken, SCENE_CARD_SIZE_STORAGE_KEY)).toBe(50);
    expect(() => writeSizePercent(broken, SCENE_CARD_SIZE_STORAGE_KEY, 70)).not.toThrow();
    expect(readSizePercent(undefined, SCENE_CARD_SIZE_STORAGE_KEY)).toBe(50);
    const s = mem();
    s.m.set(IMAGE_GRID_SIZE_STORAGE_KEY, 'oops');
    expect(readSizePercent(s, IMAGE_GRID_SIZE_STORAGE_KEY)).toBe(50);
  });
  test('AppService 에 둘 다 localStorage 로 — config 동기화·저장 파일 아님', () => {
    const app = fs.readFileSync(path.join(__dirname, '../AppService.ts'), 'utf-8');
    expect(app).toMatch(/accessor sceneCardSizePercent: number = readSizePercent\(/);
    expect(app).toMatch(/accessor imageGridSizePercent: number = readSizePercent\(/);
    expect(app).toMatch(/setSceneCardSizePercent\(percent: number\)[\s\S]{0,200}writeSizePercent\(/);
    expect(app).toMatch(/setImageGridSizePercent\(percent: number\)[\s\S]{0,200}writeSizePercent\(/);
    const sync = fs.readFileSync(path.join(__dirname, '../configSync.ts'), 'utf-8');
    expect(sync).not.toMatch(/SizePercent/);
  });
});

describe('공용 부품 SizeSlider', () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    frames = [];
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
  const runFrames = () =>
    act(() => {
      const fs2 = frames;
      frames = [];
      fs2.forEach((f) => f(0));
    });

  test('range 0~100·접근성 이름·지금 값', () => {
    const { container } = render(<SizeSlider label="씬 카드 크기" value={50} onChange={() => {}} />);
    const input = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(input.min).toBe('0');
    expect(input.max).toBe('100');
    expect(input.value).toBe('50');
    expect(input.getAttribute('aria-label')).toBe('씬 카드 크기');
    expect(input.getAttribute('aria-valuetext')).toBe('50%');
    expect(input.className).toContain('w-28');
    expect(input.className).toContain('h-8');
    expect(SIZE_SLIDER_TEXT.tooltip('씬 카드 크기', 50)).toBe('씬 카드 크기 50% (두 번 누르면 기본 크기)');
  });
  test('끄는 동안 손잡이는 바로, 바깥 알림은 화면 그리기마다 한 번(마지막 값)', () => {
    const onChange = jest.fn();
    const { container } = render(<SizeSlider label="이미지 크기" value={50} onChange={onChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.change(input, { target: { value: '65' } });
    fireEvent.change(input, { target: { value: '70' } });
    expect(input.value).toBe('70');
    expect(onChange).not.toHaveBeenCalled();
    runFrames();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(70);
  });
  test('두 번 누르면 50', () => {
    const onChange = jest.fn();
    const { container } = render(<SizeSlider label="이미지 크기" value={90} onChange={onChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.doubleClick(input);
    expect(input.value).toBe('50');
    runFrames();
    expect(onChange).toHaveBeenLastCalledWith(50);
  });
  test('바깥 값이 바뀌면 따라가고, 사라질 때 못 알린 값은 바로 알린다', () => {
    const onChange = jest.fn();
    const r = render(<SizeSlider label="이미지 크기" value={50} onChange={onChange} />);
    r.rerender(<SizeSlider label="이미지 크기" value={20} onChange={onChange} />);
    const input = r.container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('20');
    fireEvent.change(input, { target: { value: '33' } });
    r.unmount();
    expect(onChange).toHaveBeenCalledWith(33);
  });
  test('입력 요소라 전역 단축키 억제 대상(keyTargetGuard)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isTextEntryElement } = require('../keyTargetGuard');
    const el = document.createElement('input');
    el.type = 'range';
    expect(isTextEntryElement(el)).toBe(true);
  });
});

describe('씬 카드 크기 연결(SceneQueueControl)', () => {
  const src = read('SceneQueueControl.tsx');
  test('순환 버튼 대신 슬라이더 — 보기 설정 묶음 안, 카드 모양 칸 오른쪽(같은 자리)', () => {
    expect(src).not.toMatch(/'(스몰뷰|미디엄뷰|라지뷰)'/);
    expect(src).not.toContain('setCellSize');
    const anchor = src.indexOf('data-scene-totals-anchor=""');
    const select = src.indexOf('{!appState.classicSceneCard && (', anchor);
    const slider = src.indexOf('<SceneCardSizeControl />', anchor);
    const groupEnd = src.indexOf('</div>', slider);
    expect(select).toBeGreaterThan(anchor);
    expect(slider).toBeGreaterThan(select);
    expect(src.slice(slider, groupEnd).trim()).toBe('<SceneCardSizeControl />');
  });
  test('값은 앱 전체 하나(appState) — 이미지생성·이미지변형 탭 공용', () => {
    expect(src).toMatch(/value=\{appState\.sceneCardSizePercent\}[\s\S]{0,80}appState\.setSceneCardSizePercent\(v\)/);
    expect(src).toContain('effectiveSceneCardPercent(appState.sceneCardSizePercent, hasPanel)');
    expect(src).toContain('<SceneCardGrid ref={gridContainerRef} hasPanel={!!showPannel}>');
  });
  test('열 최소 폭 = 규칙 함수, 모바일 최소 트랙은 종전 그대로', () => {
    expect(src).toContain("const gridMinTrack = isMobile ? 'min(9rem, 50%)' : `${sceneCardMinWidthPx(percent)}px`;");
    expect(src).toContain('gridTemplateColumns: `repeat(auto-fill, minmax(${gridMinTrack}, 1fr))`');
  });
  test('「높이 고정」 = 그리드가 넘기는 CSS 변수(Tailwind 클래스 글자와 상수가 같은 이름), 모바일 카드는 정사각형 그대로', () => {
    expect(src).toContain(`'w-full h-[var(${SCENE_CARD_FIXED_HEIGHT_VAR})]'`);
    expect(src).toContain('[SCENE_CARD_FIXED_HEIGHT_VAR]: `${sceneCardFixedHeightPx(percent)}px`');
    expect(src).toMatch(/const imageCellClass = isMobile\s*\? 'w-full aspect-square'/);
    expect(src).not.toMatch(/'w-full h-(48|64|96)'/);
  });
});

describe('이미지 그리드 크기 연결(ResultViewer)', () => {
  const src = read('ResultViewer.tsx');
  test('PC = 슬라이더, 모바일 = 종전 S/M/L 단추(같은 떠 있는 자리·평소 흐림)', () => {
    const box = src.indexOf('right-0 opacity-30 hover:opacity-100 transition-opacity flex');
    expect(box).toBeGreaterThan(0);
    const seg = src.slice(box, src.indexOf('export default ResultViewer'));
    expect(seg).toMatch(/selectedTab !== 2 && selectedTab !== 3 && !isMobile && \(\s*<SizeSlider\s*label=\{SIZE_SLIDER_TEXT\.imageGrid\}/);
    expect(seg).toMatch(/selectedTab !== 3 &&\s*isMobile &&\s*imagesSizes\.map/);
    expect(seg).toContain("${imageSize === index ? 'back-sky' : 'back-gray'}");
  });
  test('칸 크기는 연속 값, 썸네일 요청은 단계 값 — 모바일은 종전 단계 값 그대로', () => {
    expect(src).toContain('const gridCellSize = isMobile ? imagesSizes[imageSize].size : imageGridCellPx(gridSizePercent);');
    expect(src).toContain('const gridThumbSize = isMobile ? gridCellSize : imageGridThumbPx(gridCellSize);');
    expect(src.match(/thumbSize=\{gridThumbSize\}/g)).toHaveLength(3); // 이미지·즐겨찾기·휴지통
    // 칸이 받아 오는 크기 = 그리드 데이터의 imageSize = fetchSize(단계 값)
    expect(src).toContain('const fetchSize = thumbSize ?? imageSize;');
    expect(src).toMatch(/onFilenameChange,\s*fetchSize,\s*selectedImages,/);
    expect(src).toContain('isMobile ? 200 : Math.min(thumbSize, 400)');
    // 모바일 종전 분기 그대로
    expect(src).toContain('let columnWidth = isMobile ? imageSize / 2.5 : imageSize;');
    expect(src).toMatch(/if \(isMobile && imageSize === 500\) \{\s*columnWidth = containerWidth - 10;/);
  });
  test('크기를 바꾸면 보던 자리를 지킨다(PC 만)', () => {
    expect(src).toContain('gridRef.current.scrollTo({ scrollTop: nextTop });');
    expect(src).toMatch(/if \(isMobile \|\| !prev \|\| prev\.rowHeight === rowHeight/);
  });
  test('PC 값은 기억(appState), 모바일 단계 선택은 기억하지 않음', () => {
    expect(src).toContain('normalizeSizePercent(appState.imageGridSizePercent)');
    expect(src).toContain('appState.setImageGridSizePercent(percent);');
    expect(src).toContain('const [imageSize, setImageSize] = useState<number>(1);');
  });
});
