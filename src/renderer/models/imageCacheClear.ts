// 환경설정 「이미지 캐시 초기화」가 지울 썸네일 폴더 목록(순수, 2026-11-21).
// 대상 = 현재 프로젝트의 이미지생성 씬(outs)·변형 씬(inpaints) 각각의 <이미지 폴더>/fastcache 뿐.
// 이미지 폴더는 호출부가 imageService.getOutputDir(= projectPaths 관문)로 준다. 관문이 던지는 씬(비정상 이름 등)은
// 그 씬만 건너뛴다. 돌려주는 경로는 언제나 「…/fastcache」 — 원본 폴더·.trash 자체를 가리키는 경로는 만들지 않는다(빈 경로는 버림).
// 종전 ConfigScreen 은 Map 인 session.scenes 를 Object.values 로 훑어 씬이 하나도 나오지 않았고 변형 씬은 대상이 아니었다.
import type { GenericScene } from './types';

export const FASTCACHE_DIR_NAME = 'fastcache';

export function collectProjectFastcacheDirs(
  session: { getScenes(type: 'scene' | 'inpaint'): GenericScene[] },
  outputDir: (scene: GenericScene) => string,
): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();
  for (const type of ['scene', 'inpaint'] as const) {
    for (const scene of session.getScenes(type)) {
      let base: string;
      try {
        base = outputDir(scene);
      } catch {
        continue;
      }
      if (typeof base !== 'string') continue;
      base = base.replace(/\/+$/, '');
      if (!base) continue;
      const dir = base + '/' + FASTCACHE_DIR_NAME;
      if (seen.has(dir)) continue;
      seen.add(dir);
      dirs.push(dir);
    }
  }
  return dirs;
}
