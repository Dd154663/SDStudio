// 대량 작업 「🎭 인페인트 마스크 일괄 적용」(P3)·「🎚️ 강도·노이즈 일괄 변경」(P4) 흐름(2026-10-04, 변형 탭 대량 작업·
// 선택 모드 「선택 작업」 — PC·모바일 공용). 순수 규칙·문구는 variantBatch.ts, 계약은 SPEC_GUIDE §6 「대량 작업 I2I」·§7-2.
//
// - 프리셋 변경은 runInAction 한 번(toJSON reaction → 저장 큐). 직접 파일 쓰기는 마스크 저장(imageService.storeVibeImage)
//   하나 — 씬마다 새 파일(편집기가 마스크를 제자리에서 덮어쓰므로 파일 공유 금지), 옛 마스크 파일은 지우지 않는다.
// - preselected = 선택 모드에서 이미 고른 씬(씬 선택 창을 건너뜀 — 해상도 변경 changeResolutionOfScenes 와 같은 관례).
import { runInAction } from 'mobx';
import { imageService } from '.';
import { appState } from './AppService';
import { dataUriToBase64 } from './ImageService';
import { getImageDimensions } from '../componenets/BrushTool';
import { resizeMaskPng } from './focusedInpaintCanvas';
import type { GenericScene, InpaintScene, Session } from './types';
import {
  batchResultKind,
  I2I_BATCH_TEXT,
  INPAINT_WORKFLOW_TYPE,
  promptUnitValue,
  workflowHasNoise,
} from './i2iBatch';
import { chooseScenes } from './sceneSelectorHost';
import type { SceneSelectorSetter as SetSceneSelector } from './sceneSelectorHost';
import {
  applyStrengthBatch,
  currentUnitValue,
  focusPatchForTarget,
  isMaskSource,
  maskApplyResultText,
  sameSize,
  splitMaskTargets,
  splitStrengthTargets,
  strengthBatchResultText,
  VARIANT_BATCH_TEXT,
} from './variantBatch';
import type { FocusPatch } from './variantBatch';

/** 프로젝트 파일 이미지(첨부 이미지·마스크)의 크기. 읽지 못하면 undefined(i2iBatchFlow 의 마스크 판정과 공용). */
export async function readVibeImageSize(
  session: Session,
  path: string | undefined,
): Promise<{ width: number; height: number } | undefined> {
  if (!path) return undefined;
  try {
    const data = await imageService.fetchVibeImage(session, path);
    if (!data) return undefined;
    return await getImageDimensions(dataUriToBase64(data));
  } catch (e) {
    return undefined;
  }
}

/** 고르는 사이 지워졌거나 워크플로우가 바뀌지 않은 씬인가. */
function stillSame(session: Session, scene: InpaintScene, workflowType: string): boolean {
  return (
    session.getScene('inpaint', scene.name) === scene &&
    scene.workflowType === workflowType &&
    !!scene.preset
  );
}

/**
 * P3 — 마스크가 있는 인페인트 씬 하나(원본)의 마스크·Focused 값을 다른 인페인트 씬들에 적용한다.
 * 대상 이미지와 크기가 같으면 원본 마스크 PNG 그대로, 다르면 최근접 크기 변경(이진 유지) — 씬마다 새 파일.
 */
export function openMaskApplyFlow(
  type: 'scene' | 'inpaint',
  setSceneSelector: SetSceneSelector,
  preselected?: readonly GenericScene[],
) {
  const session = appState.curSession;
  if (!session) return;
  const sources = session.getScenes('inpaint').filter((s) => isMaskSource(s as InpaintScene));
  if (sources.length === 0) {
    appState.pushMessage(VARIANT_BATCH_TEXT.noMaskSources);
    return;
  }
  void (async () => {
    const picked = await chooseScenes(setSceneSelector, {
      type,
      text: VARIANT_BATCH_TEXT.maskSourceSelect,
      scenes: sources,
    });
    if (picked.length === 0) return;
    if (picked.length > 1) {
      appState.pushMessage(VARIANT_BATCH_TEXT.pickOneMaskSource);
      return;
    }
    const source = picked[0] as InpaintScene;
    const selected = await chooseScenes(
      setSceneSelector,
      { type, text: VARIANT_BATCH_TEXT.maskTargetSelect },
      preselected,
    );
    if (selected.length === 0) return;
    const { targets, skipped } = splitMaskTargets(selected as InpaintScene[], source.name);
    if (targets.length === 0) {
      appState.pushMessage(VARIANT_BATCH_TEXT.noMaskTargets(skipped.length));
      return;
    }
    const overwriting = targets.filter((s) => !!s.preset?.mask).length;
    if (overwriting > 0) {
      const ok = await appState.confirmAsync({
        text: VARIANT_BATCH_TEXT.maskOverwriteConfirm(overwriting, targets.length),
        confirmText: VARIANT_BATCH_TEXT.maskOverwriteButton,
        danger: true,
      });
      if (!ok) return;
    }
    if (appState.curSession !== session) {
      appState.pushMessage(I2I_BATCH_TEXT.sessionChanged);
      return;
    }
    await applyMaskToScenes(session, source, targets, skipped.length);
  })();
}

async function applyMaskToScenes(
  session: Session,
  source: InpaintScene,
  targets: InpaintScene[],
  skippedCount: number,
) {
  // 원본 마스크는 한 번만 읽는다(크기 = 원본 이미지 크기 — 편집기 마스크 캔버스가 원본 해상도)
  let sourceMask: string | undefined;
  let sourceSize: { width: number; height: number } | undefined;
  try {
    const data = await imageService.fetchVibeImage(session, source.preset.mask);
    sourceMask = data ? dataUriToBase64(data) : undefined;
    sourceSize = sourceMask ? await getImageDimensions(sourceMask) : undefined;
  } catch (e) {
    console.error('원본 마스크 읽기 실패:', source.name, e);
  }
  if (!sourceMask || !sourceSize) {
    appState.pushMessage(VARIANT_BATCH_TEXT.maskSourceReadFailed, 'error');
    return;
  }
  const sourcePreset = source.preset;
  const prepared: { scene: InpaintScene; path: string; focus: FocusPatch }[] = [];
  const failed: string[] = [];
  let resized = 0;
  for (const scene of targets) {
    try {
      const size = await readVibeImageSize(session, scene.preset?.image);
      if (!size) throw new Error('대상 이미지를 읽지 못했습니다.');
      const same = sameSize(sourceSize, size);
      const data = same ? sourceMask : await resizeMaskPng(sourceMask, size.width, size.height);
      // 씬마다 새 파일(공유 금지) — 쓴 내용을 읽기 캐시에 선적재
      const path = await imageService.storeVibeImage(session, data, true);
      prepared.push({ scene, path, focus: focusPatchForTarget(sourcePreset, sourceSize, size) });
      if (!same) resized++;
    } catch (e) {
      console.error('마스크 적용 준비 실패:', scene.name, e);
      failed.push(scene.name);
    }
  }
  if (appState.curSession !== session) {
    appState.pushMessage(I2I_BATCH_TEXT.sessionChanged);
    return;
  }
  let applied = 0;
  runInAction(() => {
    for (const { scene, path, focus } of prepared) {
      if (!stillSame(session, scene, INPAINT_WORKFLOW_TYPE)) {
        failed.push(scene.name);
        continue;
      }
      scene.preset.mask = path;
      Object.assign(scene.preset, focus);
      applied++;
    }
  });
  appState.pushMessage(
    maskApplyResultText({ applied, resized, skipped: skippedCount, failed }),
    batchResultKind(applied, failed.length),
  );
}

/**
 * P4 — 고른 변형 씬(I2I·인페인트·미러)의 강도를 한 값으로, 대상에 I2I 가 있으면 노이즈도(선택) 바꾼다.
 */
export function openStrengthBatchFlow(
  type: 'scene' | 'inpaint',
  setSceneSelector: SetSceneSelector,
  preselected?: readonly GenericScene[],
): Promise<void> {
  const session = appState.curSession;
  if (!session) return Promise.resolve();
  return (async () => {
    const selected = await chooseScenes(
      setSceneSelector,
      { type, text: VARIANT_BATCH_TEXT.strengthTargetSelect },
      preselected,
    );
    if (selected.length === 0) return;
    const { targets, skipped } = splitStrengthTargets(selected as InpaintScene[]);
    if (targets.length === 0) {
      appState.pushMessage(VARIANT_BATCH_TEXT.noStrengthTargets(skipped.length));
      return;
    }
    const currentStrength = currentUnitValue(targets[0].preset.strength, 1);
    const strength = await promptUnitValue(
      VARIANT_BATCH_TEXT.strengthInput(currentStrength),
      currentStrength,
    );
    if (strength === undefined) return;
    let noise: number | undefined;
    const i2iTargets = targets.filter((s) => workflowHasNoise(s.workflowType));
    if (i2iTargets.length > 0) {
      const currentNoise = currentUnitValue(i2iTargets[0].preset.noise, 0);
      const choice = await appState.pushDialogAsync({
        type: 'select',
        text: VARIANT_BATCH_TEXT.noiseQuestion(i2iTargets.length),
        items: [
          { text: VARIANT_BATCH_TEXT.noiseChange(currentNoise), value: 'change' },
          { text: VARIANT_BATCH_TEXT.noiseKeep, value: 'keep' },
        ],
      });
      if (!choice) return;
      if (choice === 'change') {
        noise = await promptUnitValue(VARIANT_BATCH_TEXT.noiseInput(currentNoise), currentNoise);
        if (noise === undefined) return;
      }
    }
    if (appState.curSession !== session) {
      appState.pushMessage(I2I_BATCH_TEXT.sessionChanged);
      return;
    }
    const failed: string[] = [];
    let result = { changed: 0, noiseChanged: 0 };
    runInAction(() => {
      const live = targets.filter((s) => {
        const ok = stillSame(session, s, s.workflowType);
        if (!ok) failed.push(s.name);
        return ok;
      });
      result = applyStrengthBatch(live, { strength, noise });
    });
    appState.pushMessage(
      strengthBatchResultText({
        changed: result.changed,
        strength,
        noise,
        noiseChanged: result.noiseChanged,
        skipped: skipped.length,
        failed,
      }),
      batchResultKind(result.changed, failed.length),
    );
  })();
}
