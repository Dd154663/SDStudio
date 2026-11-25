// 「캡처」 배선(2026-11-25) — 세션에서 재료를 뽑고(읽기만), 이미지를 한 장씩 읽어 그린 뒤, 다운로드 서비스로 저장한다.
// 순수 규칙 = captureSheet.ts, 그리기 = captureSheetRender.ts. 저장의 플랫폼 분기는 ImageDownloadService.saveGeneratedImage 한 곳.
// 프로젝트 데이터(씬·이미지·즐겨찾기)는 바꾸지 않는다 — 되돌리기 기록 없음(파일 생성).
import { appState } from './AppService';
import { backend, gameService, imageDownloadService, imageService } from '.';
import { platform } from './platform';
import type { GenericScene, InpaintScene, Session } from './types';
import {
  CaptureOptions,
  CapturePlan,
  CaptureSceneData,
  CaptureSource,
  CAPTURE_PIXEL_LIMIT,
  CAPTURE_TEXT,
} from './captureSheet';
import { CaptureDrawable, encodeCaptureCanvas, renderCaptureSheet } from './captureSheetRender';
import { CAPTURE_IMAGE_FORMATS } from './imageFormats';

/** 이 플랫폼의 한 장 화소 상한 */
export function capturePixelLimit(): number {
  return platform.isMobile ? CAPTURE_PIXEL_LIMIT.mobile : CAPTURE_PIXEL_LIMIT.pc;
}

/**
 * 씬 하나의 재료 — 대표 이미지는 카드와 같은 규칙: 이미지생성 씬 = 즐겨찾기 첫째 → 결과 첫째(getMainImage),
 * 이미지변형 씬 = 입력 이미지(preset.image, 없고 미러면 프로젝트 미러 이미지 — 카드가 보여 주는 것).
 * 즐겨찾기·결과는 그 씬의 결과 폴더(휴지통 제외 — gameService 목록).
 */
export function captureSceneData(session: Session, scene: GenericScene): CaptureSceneData {
  const dir = imageService.getOutputDir(session, scene);
  const files = gameService.getOutputs(session, scene);
  const outputs = files.map((f) => `${dir}/${f}`);
  const favorites = scene.mains.map((f) => `${dir}/${f}`);
  let main: CaptureSource | undefined;
  if (scene.type === 'scene') {
    const f = scene.mains[0] ?? files[0];
    main = f ? { kind: 'output', path: `${dir}/${f}` } : undefined;
  } else {
    const inpaint = scene as InpaintScene;
    const img =
      inpaint.preset?.image ||
      (inpaint.workflowType === 'SDMirror' ? session.mirrorImage : undefined);
    main = img ? { kind: 'input', path: img } : undefined;
  }
  return { name: scene.name, main, favorites, outputs };
}

/** 칸 하나의 이미지 데이터(data URI) — 빠르게 = 카드와 같은 썸네일, 고화질 = 원본(캐시에 올리지 않음) */
async function readCaptureSource(
  session: Session,
  source: CaptureSource,
  quality: CaptureOptions['quality'],
): Promise<string | null | undefined> {
  if (source.kind === 'input') return imageService.fetchVibeImage(session, source.path);
  if (quality === 'fast') return imageService.fetchImageSmall(source.path, platform.sceneThumbSize);
  if (!(await backend.existFile(source.path))) return null;
  return backend.readDataFile(source.path);
}

function decodeImage(dataUri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다'));
    img.src = dataUri;
  });
}

/** 폰트 로드를 잠깐만 기다린다(실패·시간 초과여도 기본 폰트로 계속) */
function waitForFont(font: string): Promise<unknown> {
  const fonts = (document as any).fonts as FontFaceSet | undefined;
  if (!fonts?.load) return Promise.resolve();
  return Promise.race([
    fonts.load(font).catch(() => undefined),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
}

/**
 * 계획대로 그려 저장한다. 진행 창(취소 가능) — 취소하면 아무것도 저장하지 않는다.
 * stem = 파일 이름(확장자 없음, captureFileStem).
 */
export async function runCaptureSheet(
  session: Session,
  plan: CapturePlan,
  options: CaptureOptions,
  stem: string,
): Promise<string | undefined> {
  let cancelled = false;
  const show = (done: number, total: number) =>
    appState.setProgressDialog({
      text: CAPTURE_TEXT.progress,
      done,
      total,
      onCancel: cancelled
        ? undefined
        : () => {
            cancelled = true;
            appState.setProgressDialog({ text: CAPTURE_TEXT.progress, done, total });
          },
    });
  let base64: string;
  try {
    const canvas = await renderCaptureSheet(plan.layout, options.fit, {
      createCanvas: (w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      },
      loadImage: async (source): Promise<CaptureDrawable | null> => {
        const data = await readCaptureSource(session, source, options.quality);
        if (!data) return null;
        return decodeImage(data);
      },
      releaseImage: (img) => {
        // 읽은 이미지는 그리자마자 놓는다(전부 메모리에 들고 있지 않게)
        if (img instanceof HTMLImageElement) img.src = '';
      },
      isCancelled: () => cancelled,
      onProgress: show,
      fontFamily: getComputedStyle(document.body).fontFamily,
      waitForFont,
    });
    if (!canvas) {
      appState.pushMessage(CAPTURE_TEXT.cancelled);
      return undefined;
    }
    try {
      base64 = encodeCaptureCanvas(canvas, options.format);
    } finally {
      // 큰 캔버스 메모리를 바로 돌려준다
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch (e: any) {
    console.error('Failed to build capture sheet:', e);
    appState.pushMessage(CAPTURE_TEXT.failed(e?.message || String(e)));
    return undefined;
  } finally {
    appState.setProgressDialog(undefined);
  }
  if (cancelled) {
    appState.pushMessage(CAPTURE_TEXT.cancelled);
    return undefined;
  }
  return imageDownloadService.saveGeneratedImage(base64, stem, CAPTURE_IMAGE_FORMATS[options.format].ext);
}
