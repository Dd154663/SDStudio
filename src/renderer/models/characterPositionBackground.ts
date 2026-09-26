import { imageHistoryService, imageService } from '.';
import { resolutionMap } from '../backends/imageGen';
import { GenericScene, Session } from './types';

/**
 * 캐릭터 위치 지정 오버레이의 배경(2026-09-26).
 *  · 씬에서 열면 그 씬의 가장 최근 생성작, 없으면 프로젝트(세션) 최근 생성작.
 *  · 메인 패널에서 열면 프로젝트 최근 생성작(히스토리 첫 항목).
 *  · 둘 다 없으면 빈 화면. 비율은 씬 해상도(custom 은 폭·높이), 씬이 없으면 새 씬 기본값 portrait.
 * 이미지가 실제로 있으면 오버레이가 그 이미지의 실제 크기 비율을 우선 쓴다.
 */
export interface PositionBackground {
  path?: string;
  aspect: { width: number; height: number };
  caption: string;
}

export const DEFAULT_POSITION_ASPECT = { width: 832, height: 1216 };

export function sceneAspect(scene: GenericScene | undefined): { width: number; height: number } {
  if (!scene) return DEFAULT_POSITION_ASPECT;
  const s: any = scene;
  if (s.resolution === 'custom' && s.resolutionWidth > 0 && s.resolutionHeight > 0) {
    return { width: s.resolutionWidth, height: s.resolutionHeight };
  }
  const r = (resolutionMap as any)[s.resolution];
  if (r && r.width > 0 && r.height > 0) return { width: r.width, height: r.height };
  return DEFAULT_POSITION_ASPECT;
}

export function resolvePositionBackground(
  session: Session | undefined,
  scene?: GenericScene,
): PositionBackground {
  const aspect = sceneAspect(scene);
  if (session && scene) {
    const outputs = imageService.getOutputs(session, scene);
    if (outputs.length) {
      return {
        path: imageService.getOutputDir(session, scene) + '/' + outputs[0],
        aspect,
        caption: `씬 「${scene.name}」 최근 생성작`,
      };
    }
  }
  if (session) {
    const entry = imageHistoryService.entries.find((e) => e.sessionName === session.name);
    if (entry) {
      return { path: entry.path, aspect, caption: '프로젝트 최근 생성작' };
    }
  }
  return { aspect, caption: '생성된 이미지 없음 · 빈 화면' };
}
