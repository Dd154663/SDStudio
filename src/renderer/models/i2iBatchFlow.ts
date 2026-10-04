// 대량 작업 「I2I로 이미지생성 씬 복사」(B1)·「일괄 이미지 첨부」(B2) 흐름(2026-10-04, 변형 탭 대량 작업 — PC·모바일 공용).
// 순수 규칙·문구·값 입력은 i2iBatch.ts, 계약은 SPEC_GUIDE §6 「대량 작업 I2I」·§7-3 ⓕ·ⓖ.
//
// - 씬 추가·프리셋 변경은 세션 관문(session.addScene·프리셋 필드 대입 → toJSON reaction → 저장 큐)만 쓴다.
//   직접 파일 쓰기는 첨부 이미지 저장(imageService.storeVibeImage) 하나 — 씬마다 고유 파일
//   (편집기가 씬 파일을 제자리에서 덮어쓰므로 파일 공유 금지, SPEC §11 일괄 예약 성능 규칙과 같은 이유).
// - 비동기 준비(프롬프트 조립·이미지 저장)를 먼저 끝내고 씬 등록·프리셋 대입은 runInAction 한 번으로 묶는다
//   (저장 reaction 이 씬 수만큼 돌지 않게 — 예약이 아니라 withProgressBatch 대상은 아님).
// - 해상도 = 첨부 이미지 크기(R-res, inpaintResolution.ts). 1MP 초과 안내는 한 번만(같은 이미지).
import { runInAction } from 'mobx';
import { imageService, workFlowService } from '.';
import { appState } from './AppService';
import type { SceneSelectorItem } from './AppService';
import { dataUriToBase64, getMainImagePath } from './ImageService';
import { IMPORT_IMAGE_ACCEPT } from './imageFormats';
import {
  applyImageResolution,
  inpaintSceneResolutionFields,
  paidResolutionNotice,
  resolutionFromImage,
} from './inpaintResolution';
import type { ImageResolution } from './inpaintResolution';
import { numberedName } from './nameInput';
import { combinationMiddlePrompt, enumerateCombinations } from './PromptService';
import { GenericScene, InpaintScene, PromptNode, Scene, Session } from './types';
import { buildSDImageGenJob } from './workflows/SDWorkFlow';
import {
  resolveSceneCharacterPrompts,
  usesSceneCharacterPromptData,
} from './sceneCharacterPrompts';
import type { ComboMode } from './comboMode';
import { joinPromptParts, snapshotComboFields } from './variantCombo';
import type { ComboSnapshotFields } from './variantCombo';
import {
  applyStrengthNoise,
  askComboMode,
  askImageSource,
  askStrengthNoise,
  batchResultKind,
  I2I_BATCH_TEXT,
  I2I_COPY_SOURCE_WORKFLOWS,
  I2I_WORKFLOW_TYPE,
  i2iComboPresetFromJob,
  i2iCopyResultText,
  imageAttachResultText,
  splitI2ITargets,
} from './i2iBatch';
import type { StrengthNoise } from './i2iBatch';

type SetSceneSelector = (item: SceneSelectorItem | undefined) => void;

/** 잡 조립용 빈 프롬프트(B1 은 생성 설정만 옮기고 프롬프트는 조합 모드 규칙으로 채운다). */
const EMPTY_PROMPT: PromptNode = { type: 'text', text: '' };

/** 고른 이미지 — raw base64(데이터 URL 머리 없음)와 크기 기준 해상도. */
interface PickedImage {
  base64: string;
  resolution: ImageResolution;
}

/** 파일 선택 창에서 이미지 한 장(raw base64). 취소면 undefined(취소 이벤트가 없는 환경은 응답 없음). */
function pickImageFile(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMPORT_IMAGE_ACCEPT;
    input.addEventListener('cancel', () => resolve(undefined));
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(undefined);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(dataUriToBase64(reader.result as string));
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

/**
 * 기존 이미지 고르기 — 씬 선택 창(SceneSelector, 썸네일 = 씬 대표 이미지)을 그대로 써서 이미지생성 씬 하나를 고르면
 * 그 씬의 대표 이미지(즐겨찾기 첫 장, 없으면 순위 1위 — getMainImagePath)를 쓴다. 창을 닫으면 응답 없음.
 */
async function pickExistingImage(
  session: Session,
  type: 'scene' | 'inpaint',
  setSceneSelector: SetSceneSelector,
): Promise<string | undefined> {
  await imageService.refreshBatch(session);
  const candidates = session
    .getScenes('scene')
    .filter((s) => !!getMainImagePath(session, s as Scene));
  if (candidates.length === 0) {
    appState.pushMessage(I2I_BATCH_TEXT.noSourceImages);
    return undefined;
  }
  const picked = await new Promise<GenericScene[]>((resolve) => {
    setSceneSelector({
      type,
      text: I2I_BATCH_TEXT.sourceSelect,
      scenes: candidates,
      callback: (selected) => {
        setSceneSelector(undefined);
        resolve(selected);
      },
    });
  });
  if (picked.length === 0) return undefined;
  if (picked.length > 1) {
    appState.pushMessage(I2I_BATCH_TEXT.pickOneSource);
    return undefined;
  }
  const path = getMainImagePath(session, picked[0] as Scene);
  if (!path) {
    appState.pushMessage(I2I_BATCH_TEXT.sourceHasNoImage);
    return undefined;
  }
  const data = await imageService.fetchImage(path);
  return data ? dataUriToBase64(data) : undefined;
}

/**
 * 이미지 출처 묻기 → 이미지 받기 → 크기 확인. 취소 = undefined, [이미지 없이] = null.
 * 크기를 못 읽으면(손상·이미지 아님) 안내하고 undefined(아무것도 만들거나 바꾸지 않음).
 */
async function askImage(
  session: Session,
  type: 'scene' | 'inpaint',
  setSceneSelector: SetSceneSelector,
  allowNone: boolean,
): Promise<PickedImage | null | undefined> {
  const source = await askImageSource(allowNone);
  if (!source) return undefined;
  if (source === 'none') return null;
  const base64 =
    source === 'file'
      ? await pickImageFile()
      : await pickExistingImage(session, type, setSceneSelector);
  if (!base64) return undefined;
  const resolution = await resolutionFromImage(base64);
  if (!resolution) {
    appState.pushMessage(I2I_BATCH_TEXT.imageReadFailed, 'error');
    return undefined;
  }
  return { base64, resolution };
}

/** 강도·노이즈 처음 값 = I2I 프리셋 기본값. */
function i2iDefaults(): StrengthNoise {
  const preset = workFlowService.buildPreset(I2I_WORKFLOW_TYPE);
  return { strength: preset.strength, noise: preset.noise };
}

/** 첨부 이미지가 있으면 강도·노이즈를 묻는다. 취소 = false, 이미지만 = undefined. */
async function askValuesForImage(
  image: PickedImage | null,
): Promise<StrengthNoise | undefined | false> {
  if (!image) return undefined;
  const r = await askStrengthNoise(i2iDefaults());
  if (!r) return false;
  return r.values;
}

/** B1 — 이미지생성 씬들을 이미지 투 이미지 변형 씬으로 복사한다. */
export function openI2ICopyFlow(type: 'scene' | 'inpaint', setSceneSelector: SetSceneSelector) {
  const session = appState.curSession;
  if (!session) return;
  const sources = session.getScenes('scene');
  if (sources.length === 0) {
    appState.pushMessage(I2I_BATCH_TEXT.noImageGenScenes);
    return;
  }
  setSceneSelector({
    type,
    text: I2I_BATCH_TEXT.copySelect,
    scenes: sources,
    callback: async (selected) => {
      setSceneSelector(undefined);
      if (selected.length === 0) return;
      // 조합 모드(2026-10-04 B4) — 상위·하위·전역 네거티브를 실시간 공유할지, 지금 값을 고정할지
      const mode = await askComboMode();
      if (!mode) return;
      const image = await askImage(session, type, setSceneSelector, true);
      if (image === undefined) return;
      const values = await askValuesForImage(image);
      if (values === false) return;
      if (appState.curSession !== session) {
        appState.pushMessage(I2I_BATCH_TEXT.sessionChanged);
        return;
      }
      await createI2IScenes(session, selected as Scene[], image, values, mode);
    },
  });
}

async function createI2IScenes(
  session: Session,
  sources: Scene[],
  image: PickedImage | null,
  values: StrengthNoise | undefined,
  mode: ComboMode,
) {
  const workflow = session.selectedWorkflow;
  const [genType, genPreset, genShared] = workflow
    ? session.getCommonSetup(workflow)
    : [undefined, undefined, undefined];
  if (!genType || !genPreset || !I2I_COPY_SOURCE_WORKFLOWS.has(genType)) {
    appState.pushMessage(I2I_BATCH_TEXT.noCopySetup, 'error');
    return;
  }
  // 「복사 시점 1회 복제」 고정값 — 묶음 전체가 같은 사전 세팅이므로 한 번만 만든다
  let snapshot: ComboSnapshotFields | undefined;
  if (mode === 'snapshot') {
    try {
      snapshot = await snapshotComboFields(genType, genPreset, genShared, session.extraPrompt);
    } catch (e: any) {
      console.error('I2I 고정값 만들기 실패:', e);
      appState.pushMessage(I2I_BATCH_TEXT.noCopySetup, 'error');
      return;
    }
  }

  const prepared: InpaintScene[] = [];
  const failed: string[] = [];
  let firstError: string | undefined;
  const planned = new Set<string>();
  const taken = (name: string) => session.hasScene('inpaint', name) || planned.has(name);
  for (const src of sources) {
    try {
      // 생성 설정(샘플링 등)은 예약과 같은 잡 조립에서 옮기고, 프롬프트는 조합 모드 규칙(조합은 slots 로 복사 —
      // 예약 때 생성 경로와 같은 규칙으로 전개, SPEC §7-4). 조각은 여기서 풀지 않는다.
      const job = buildSDImageGenJob(src, EMPTY_PROMPT, [], genPreset, genShared);
      const first = enumerateCombinations(src, 1)[0];
      const preset = i2iComboPresetFromJob(
        workFlowService.buildPreset(I2I_WORKFLOW_TYPE),
        job,
        {
          middlePrompt: first ? combinationMiddlePrompt(first) : '',
          sceneUc: joinPromptParts(
            usesSceneCharacterPromptData(src) ? src.sceneCharacterUC : '',
            src.sceneUC,
          ),
          characterPrompts: resolveSceneCharacterPrompts(genPreset, genShared, src),
          mode,
          snapshot,
        },
      );
      if (image) {
        applyStrengthNoise(preset, values);
        // 씬마다 고유 파일(공유 금지) — 쓴 내용을 읽기 캐시에 선적재
        preset.image = await imageService.storeVibeImage(session, image.base64, true);
      }
      const name = numberedName(src.name, taken);
      planned.add(name);
      const scene = InpaintScene.fromJSON({
        type: 'inpaint',
        name,
        workflowType: I2I_WORKFLOW_TYPE,
        preset: preset.toJSON(),
        // 이미지가 있으면 그 크기(R-res ⓕ), 없으면 원본 씬 해상도(커스텀 너비·높이 포함)
        ...inpaintSceneResolutionFields(I2I_WORKFLOW_TYPE, src, image?.resolution),
        // 원본 씬 연결 — 결과 보기 「원본 씬으로 이미지 복사」·이미지 상세의 변형 씬 목록
        sceneRef: src.name,
        // 조합 깊은 복사(toJSON→fromJSON — 원본 씬과 조각 객체를 공유하지 않음)·조합 모드
        slots: src.toJSON().slots,
        comboMode: mode,
        mains: [],
        imageMap: [],
        round: undefined,
        game: undefined,
      });
      if (!scene) throw new Error('변형 씬을 만들지 못했습니다.');
      prepared.push(scene);
    } catch (e: any) {
      console.error('I2I 씬 복사 실패:', src.name, e);
      failed.push(src.name);
      if (!firstError) firstError = e?.message ? String(e.message) : undefined;
    }
  }

  if (appState.curSession !== session) {
    appState.pushMessage(I2I_BATCH_TEXT.sessionChanged);
    return;
  }
  // 등록은 한 번에 — 준비하는 사이 같은 이름 씬이 생겼으면 다시 번호를 붙인다.
  runInAction(() => {
    const added = new Set<string>();
    for (const scene of prepared) {
      if (session.hasScene('inpaint', scene.name)) {
        scene.name = numberedName(
          scene.name,
          (n) => session.hasScene('inpaint', n) || added.has(n),
        );
      }
      added.add(scene.name);
      session.addScene(scene);
    }
  });

  const withImage = image ? prepared.length : 0;
  appState.pushMessage(
    i2iCopyResultText({ created: prepared.length, withImage, failed, firstError }),
    batchResultKind(prepared.length, failed.length),
  );
  const notice = image && withImage > 0 ? paidResolutionNotice(image.resolution) : undefined;
  if (notice) appState.pushMessage(notice, 'info');
}

/** B2 — 고른 변형 씬 중 I2I 씬에 같은 이미지를 첨부한다(씬마다 고유 파일). */
export function openImageAttachFlow(type: 'scene' | 'inpaint', setSceneSelector: SetSceneSelector) {
  const session = appState.curSession;
  if (!session) return;
  setSceneSelector({
    type,
    text: I2I_BATCH_TEXT.attachSelect,
    callback: async (selected) => {
      setSceneSelector(undefined);
      if (selected.length === 0) return;
      const { targets, skipped } = splitI2ITargets(selected as InpaintScene[]);
      if (targets.length === 0) {
        appState.pushMessage(I2I_BATCH_TEXT.noI2ITargets(skipped.length));
        return;
      }
      const image = await askImage(session, type, setSceneSelector, false);
      if (!image) return;
      const values = await askValuesForImage(image);
      if (values === false) return;
      const overwriting = targets.filter((s) => !!s.preset?.image).length;
      if (overwriting > 0) {
        const ok = await appState.confirmAsync({
          text: I2I_BATCH_TEXT.overwriteConfirm(overwriting, targets.length),
          confirmText: I2I_BATCH_TEXT.overwriteConfirmButton,
          danger: true,
        });
        if (!ok) return;
      }
      if (appState.curSession !== session) {
        appState.pushMessage(I2I_BATCH_TEXT.sessionChanged);
        return;
      }
      await attachImageToScenes(session, targets, skipped.length, image, values);
    },
  });
}

async function attachImageToScenes(
  session: Session,
  targets: InpaintScene[],
  skippedCount: number,
  image: PickedImage,
  values: StrengthNoise | undefined,
) {
  const stored: { scene: InpaintScene; path: string }[] = [];
  const failed: string[] = [];
  for (const scene of targets) {
    try {
      // 씬마다 고유 파일(공유 금지) — 쓴 내용을 읽기 캐시에 선적재
      const path = await imageService.storeVibeImage(session, image.base64, true);
      stored.push({ scene, path });
    } catch (e) {
      console.error('첨부 이미지 저장 실패:', scene.name, e);
      failed.push(scene.name);
    }
  }
  let applied = 0;
  runInAction(() => {
    for (const { scene, path } of stored) {
      // 고르는 사이 지워지거나 워크플로우가 바뀐 씬은 건너뛴다
      if (
        session.getScene('inpaint', scene.name) !== scene ||
        scene.workflowType !== I2I_WORKFLOW_TYPE ||
        !scene.preset
      ) {
        failed.push(scene.name);
        continue;
      }
      scene.preset.image = path;
      applyStrengthNoise(scene.preset, values);
      applyImageResolution(scene, image.resolution);
      applied++;
    }
  });
  appState.pushMessage(
    imageAttachResultText({ applied, skipped: skippedCount, failed }),
    batchResultKind(applied, failed.length),
  );
  const notice = applied > 0 ? paidResolutionNotice(image.resolution) : undefined;
  if (notice) appState.pushMessage(notice, 'info');
}
