import { backend, imageService, taskQueueService } from '..';
import { getImageDimensions } from '../../componenets/BrushTool';
import { estimateNaiUpscaleCost } from '../../backends/genVendors/naiUpscale';
import { appState } from '../AppService';
import { GenericScene, Session, UpscaleJob } from '../types';
import { dataUriToBase64 } from '../ImageService';

/** 원본은 그대로 두고 같은 씬에 별도 결과를 추가하는 단발 유료 작업. */
export async function queueNaiUpscale(session: Session, scene: GenericScene, image: string) {
  const { width, height } = await getImageDimensions(image);
  estimateNaiUpscaleCost(width, height);
  const job: UpscaleJob = {
    type: 'upscale', image, width, height,
    resolution: `${width}x${height}`,
    backend: { type: 'NAI' },
  };
  await taskQueueService.addTask({
    session, scene, job, outputPath: imageService.getOutputDir(session, scene),
  }, 1);
}

export interface NaiUpscaleTarget { scene: GenericScene; path: string }

/** 즐겨찾기 없는 씬에서 임의의 대표 이미지로 대체하지 않는다. */
export function collectFavoriteUpscaleTargets(session: Session, scenes: GenericScene[]): NaiUpscaleTarget[] {
  return scenes.flatMap((scene) => [...new Set(scene.mains)].map((name) => ({
    scene, path: imageService.getOutputDir(session, scene) + '/' + name,
  })));
}

let preparingBatch = false;

/** 다중 선택/대량 작업 공용. 대상과 비용을 한 번만 확인하며 큐에는 파일 경로만 보관한다. */
export async function queueNaiUpscaleImages(
  session: Session,
  targets: NaiUpscaleTarget[],
  confirmBatch = targets.length > 1,
) {
  if (preparingBatch) return;
  const unique = [...new Map(targets.map((t) => [t.path, t])).values()];
  if (!unique.length) {
    appState.pushMessage('업스케일할 이미지가 없습니다.');
    return;
  }
  preparingBatch = true;
  let cancelled = false;
  let skipped = 0;
  let totalCost = 0;
  const ready: { target: NaiUpscaleTarget; width: number; height: number }[] = [];
  const showProgress = unique.length > 1;
  try {
    try {
      for (let i = 0; i < unique.length; i++) {
        if (cancelled) return;
        if (showProgress) appState.setProgressDialog({
          text: '업스케일 대상 확인', done: i, total: unique.length,
          onCancel: () => { cancelled = true; },
        });
        try {
          const source = dataUriToBase64(await backend.readDataFile(unique[i].path));
          const { width, height } = await getImageDimensions(source);
          const cost = estimateNaiUpscaleCost(width, height);
          ready.push({ target: unique[i], width, height });
          totalCost += cost;
        } catch {
          skipped++;
        }
      }
    } finally {
      if (showProgress) appState.setProgressDialog(undefined);
    }
    if (cancelled) return;
    if (!ready.length) {
      appState.pushMessage('업스케일 가능한 이미지가 없습니다. 파일 누락 또는 해상도 제한을 확인해주세요.');
      return;
    }
    if (confirmBatch) {
      const confirmed = await new Promise<boolean>((resolve) => appState.pushDialog({
        type: 'confirm',
        text: `업스케일 ×2 · ${ready.length}장 · 예상 ${totalCost} Anlas` +
          (skipped ? `\n미지원·읽기 실패 ${skipped}장 제외` : ''),
        confirmText: '일괄 예약',
        callback: () => resolve(true), onCancel: () => resolve(false),
      }));
      if (!confirmed) return;
    }
    for (const { target, width, height } of ready) {
      try {
        await taskQueueService.addTask({
          session, scene: target.scene,
          outputPath: imageService.getOutputDir(session, target.scene),
          job: { type: 'upscale', image: '', imagePath: target.path, width, height,
            resolution: `${width}x${height}`, backend: { type: 'NAI' } },
        }, 1);
      } catch { skipped++; }
    }
    if (skipped > 0) appState.pushMessage(`업스케일 ${skipped}장 제외 (미지원·읽기 또는 예약 실패)`);
  } finally {
    preparingBatch = false;
  }
}
