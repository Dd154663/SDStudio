/**
 * 캐릭터 위치 지정 오버레이(2026-09-26) — 순수 함수와 배경 결정 규칙.
 */
jest.mock('../index', () => ({
  imageService: {
    getOutputs: jest.fn(),
    getOutputDir: jest.fn(() => 'outs/S/A'),
  },
  imageHistoryService: { entries: [] as any[] },
}));
jest.mock('../../backends/imageGen', () => ({
  resolutionMap: {
    portrait: { width: 832, height: 1216 },
    landscape: { width: 1216, height: 832 },
    custom: { width: 0, height: 0 },
  },
}));

import {
  clampPosition,
  fitFrame,
  POSITION_GUIDE_LINES,
} from '../../componenets/CharacterPositionOverlay';
import {
  DEFAULT_POSITION_ASPECT,
  resolvePositionBackground,
  sceneAspect,
} from '../characterPositionBackground';
import { imageHistoryService, imageService } from '../index';

describe('fitFrame / clampPosition / guides', () => {
  it('상자 안에 비율을 유지해 맞춘다', () => {
    expect(fitFrame(400, 800, 832 / 1216)).toEqual({ width: 400, height: 584 });
    expect(fitFrame(800, 400, 832 / 1216)).toEqual({ width: 273, height: 400 });
    expect(fitFrame(0, 400, 1)).toEqual({ width: 0, height: 0 });
    expect(fitFrame(400, 400, 0)).toEqual({ width: 0, height: 0 });
  });
  it('좌표는 0~1 로 자른다', () => {
    expect(clampPosition(-0.2, 1.5)).toEqual({ x: 0, y: 1 });
    expect(clampPosition(0.3, 0.7)).toEqual({ x: 0.3, y: 0.7 });
  });
  it('안내선 4종: 없음·삼등분·황금비·격자(5×5)', () => {
    expect(POSITION_GUIDE_LINES.none).toEqual([]);
    expect(POSITION_GUIDE_LINES.thirds.length).toBe(2);
    expect(POSITION_GUIDE_LINES.phi).toEqual([0.382, 0.618]);
    expect(POSITION_GUIDE_LINES.grid).toEqual([0.2, 0.4, 0.6, 0.8]);
  });
});

describe('resolvePositionBackground', () => {
  const session: any = { name: 'S' };
  const scene: any = { type: 'scene', name: 'A', resolution: 'landscape' };
  beforeEach(() => {
    (imageService.getOutputs as jest.Mock).mockReset();
    (imageHistoryService as any).entries = [];
  });
  it('씬 해상도 비율: 이름표·custom·기본값', () => {
    expect(sceneAspect(scene)).toEqual({ width: 1216, height: 832 });
    expect(sceneAspect({ resolution: 'custom', resolutionWidth: 1000, resolutionHeight: 500 } as any)).toEqual({ width: 1000, height: 500 });
    expect(sceneAspect({ resolution: 'custom' } as any)).toEqual(DEFAULT_POSITION_ASPECT);
    expect(sceneAspect(undefined)).toEqual(DEFAULT_POSITION_ASPECT);
  });
  it('씬에서 열면 그 씬의 최근 생성작(목록 첫 항목)', () => {
    (imageService.getOutputs as jest.Mock).mockReturnValue(['new.png', 'old.png']);
    (imageHistoryService as any).entries = [{ sessionName: 'S', path: 'outs/S/B/x.png' }];
    const bg = resolvePositionBackground(session, scene);
    expect(bg.path).toBe('outs/S/A/new.png');
    expect(bg.aspect).toEqual({ width: 1216, height: 832 });
    expect(bg.caption).toContain('A');
  });
  it('씬에 생성작이 없으면 프로젝트 최근 생성작, 메인 패널은 프로젝트 최근 생성작', () => {
    (imageService.getOutputs as jest.Mock).mockReturnValue([]);
    (imageHistoryService as any).entries = [
      { sessionName: 'T', path: 'outs/T/Z/z.png' },
      { sessionName: 'S', path: 'outs/S/B/x.png' },
    ];
    expect(resolvePositionBackground(session, scene).path).toBe('outs/S/B/x.png');
    const main = resolvePositionBackground(session);
    expect(main.path).toBe('outs/S/B/x.png');
    expect(main.aspect).toEqual(DEFAULT_POSITION_ASPECT);
  });
  it('아무 이미지도 없으면 빈 화면', () => {
    (imageService.getOutputs as jest.Mock).mockReturnValue([]);
    const bg = resolvePositionBackground(session, scene);
    expect(bg.path).toBeUndefined();
    expect(bg.caption).toContain('빈 화면');
    expect(resolvePositionBackground(undefined).path).toBeUndefined();
  });
});
