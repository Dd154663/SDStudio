// 고른 글로벌 프리셋 여러 개를 PNG 로 한 번에 내보내기(2026-11-22).
//
//  · PNG 한 장 = GlobalPresetService.buildExportPng — 카드의 「PNG로 내보내기」(exportToPng)와 같은 결과.
//  · 한 개씩 차례로 저장하고, 하나가 실패해도 나머지는 계속한다. 끝나면 결과를 한 번 알린다.
//  · 플랫폼 분기는 이 파일 한 곳(runGlobalPresetPngExport):
//      PC     = 폴더를 하나 골라 그 폴더에 바로 저장. 파일 이름 = 프리셋 이름 정리(sanitizeDownloadFolderName —
//               금지 문자·제어 문자·Windows 예약 이름), 같은 이름이 있으면 getUniqueFilename(「이름_1.png」 …)로 번호.
//      모바일 = 폴더를 고를 수 없어(Android selectDir 는 늘 undefined) 이미지 여러 장 다운로드와 같은 방식 —
//               기기 Download/<「글로벌 프리셋」 폴더>/ 에 차례로(폴더 이름이 겹치면 「글로벌 프리셋 (2)」,
//               폴더 안 같은 파일 이름은 backend.copyToDownloads 가 「이름 (2).png」). 앱 안 exports/ 에 잠깐 쓰고
//               복사한 뒤 지운다(단일 내보내기의 publishExport 와 같은 스테이징 자리).
//  · 한 개만 골랐으면 단일 내보내기 흐름(appState.exportGlobalPresetToPng) 그대로.
//  · 글로벌 저장소는 읽기만 한다(내용·순서·dirty 불변).

import { backend, globalPresetService } from '.';
import { appState } from './AppService';
import { platform } from './platform';
import {
  getUniqueFilename,
  pickUniqueDownloadFolderName,
  sanitizeDownloadFolderName,
} from './ImageDownloadService';
import { batchResultLine, failedNamesLine } from './deleteFlowRules';
import { PNG_IMAGE_EXT } from './imageFormats';

export const GLOBAL_PRESET_PNG_TEXT = {
  buttonLabel: 'PNG로 내보내기',
  progress: '프리셋 PNG 저장 중...',
  saved: (n: number) => `프리셋 PNG ${n}개를 저장했습니다`,
  savedInDownloads: (folder: string, n: number) =>
    `다운로드 폴더의 "${folder}"에 프리셋 PNG ${n}개를 저장했습니다`,
  /** 일부·전부 실패 — 저장 수·실패 수와 실패한 이름 */
  partial: (saved: number, failedNames: readonly string[]) =>
    `프리셋 PNG ${batchResultLine(saved, failedNames.length, '저장')}\n` +
    `저장하지 못한 프리셋: ${failedNamesLine(failedNames)}`,
  folderNotChosen: '저장 폴더를 고르지 않아 내보내지 않았습니다',
};

/** 이름이 비었거나 점·공백·제어 문자뿐일 때의 파일 이름 */
export const PRESET_PNG_DEFAULT_STEM = '프리셋';
/** 모바일 Download/ 아래 폴더 이름(겹치면 「 (2)」 …) */
export const PRESET_PNG_MOBILE_FOLDER = '글로벌 프리셋';

/** 프리셋 이름 → 파일 이름 줄기(확장자 제외). 이미지 다운로드의 폴더 이름 정리 규칙을 그대로 쓴다. */
export function presetPngFileStem(name: string): string {
  const raw = name ?? '';
  if (!raw.replace(/[\s.\x00-\x1f\x7f]/g, '')) return PRESET_PNG_DEFAULT_STEM;
  return sanitizeDownloadFolderName(raw);
}

export interface PresetPngTarget {
  id: string;
  name: string;
}

/** 저장 자리 — stem(정리된 이름)으로 PNG 한 장을 쓰고 실제 파일 이름을 돌려준다(겹침 회피는 자리 몫). */
export interface PresetPngSink {
  write(stem: string, pngBase64: string): Promise<string>;
}

export interface PresetPngExportResult {
  saved: { name: string; file: string }[];
  failed: { name: string; error: string }[];
}

/**
 * 차례로 PNG 를 만들어 저장한다. onProgress(done, total) 는 0 부터 한 개마다 부른다.
 * 하나가 실패해도(만들기·쓰기 모두) 실패로 세고 다음으로 넘어간다.
 */
export async function exportPresetPngs(
  targets: readonly PresetPngTarget[],
  deps: {
    buildPng: (id: string) => Promise<string>;
    sink: PresetPngSink;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<PresetPngExportResult> {
  const result: PresetPngExportResult = { saved: [], failed: [] };
  const total = targets.length;
  deps.onProgress?.(0, total);
  for (let i = 0; i < total; i++) {
    const t = targets[i];
    try {
      const png = await deps.buildPng(t.id);
      const file = await deps.sink.write(presetPngFileStem(t.name), png);
      result.saved.push({ name: t.name, file });
    } catch (e: any) {
      console.error('프리셋 PNG 저장 실패:', t.name, e);
      result.failed.push({ name: t.name, error: (e && e.message) || String(e ?? '') });
    }
    deps.onProgress?.(i + 1, total);
  }
  return result;
}

/** 결과 안내 — 전부 성공 = 토스트 한 줄, 실패가 있으면 확인 창(저장 수·실패 수·실패한 이름). */
export function presetPngResultNotice(
  result: PresetPngExportResult,
  mobileFolder?: string,
): { kind: 'message' | 'dialog'; text: string } {
  const n = result.saved.length;
  if (result.failed.length === 0) {
    return {
      kind: 'message',
      text:
        mobileFolder !== undefined
          ? GLOBAL_PRESET_PNG_TEXT.savedInDownloads(mobileFolder, n)
          : GLOBAL_PRESET_PNG_TEXT.saved(n),
    };
  }
  return {
    kind: 'dialog',
    text: GLOBAL_PRESET_PNG_TEXT.partial(
      n,
      result.failed.map((f) => f.name),
    ),
  };
}

/** PC — 고른 폴더(절대 경로)에 바로 쓴다. 같은 이름이 있으면 getUniqueFilename 의 번호(덮어쓰지 않음). */
export function createPcFolderSink(dir: string): PresetPngSink {
  return {
    async write(stem, png) {
      const file = await getUniqueFilename(dir, stem, PNG_IMAGE_EXT, true);
      await backend.writeDataFileAbsolute(`${dir}/${file}`, png);
      return file;
    },
  };
}

/** 모바일 — exports/ 에 잠깐 쓰고 Download/<folder>/ 로 복사(갤러리 등록·같은 이름 번호는 backend 몫) 뒤 스테이징을 지운다. */
export function createMobileDownloadsSink(folder: string): PresetPngSink {
  return {
    async write(stem, png) {
      const staging = `exports/${stem}.${PNG_IMAGE_EXT}`;
      await backend.writeDataFile(staging, png);
      try {
        await backend.copyToDownloads(staging, folder);
      } finally {
        try {
          await backend.deleteFile(staging);
        } catch (e) {
          /* 스테이징 정리 실패는 저장 결과를 바꾸지 않는다 */
        }
      }
      return `${stem}.${PNG_IMAGE_EXT}`;
    },
  };
}

/**
 * 멀티선택 도구줄 「PNG로 내보내기」. targets = 고른 프리셋(누른 시점의 id·이름).
 * 0개면 아무것도 하지 않는다(버튼이 비활성). 1개면 단일 내보내기 흐름.
 */
export async function runGlobalPresetPngExport(
  targets: readonly PresetPngTarget[],
): Promise<PresetPngExportResult | undefined> {
  if (targets.length === 0) return undefined;
  if (targets.length === 1) {
    const entry = globalPresetService.get(targets[0].id);
    if (!entry) {
      appState.pushMessage('내보내기 실패: 프리셋을 찾을 수 없습니다');
      return undefined;
    }
    await appState.exportGlobalPresetToPng(entry);
    return undefined;
  }

  let sink: PresetPngSink;
  let mobileFolder: string | undefined;
  if (platform.isMobile) {
    try {
      mobileFolder = await pickUniqueDownloadFolderName(
        sanitizeDownloadFolderName(PRESET_PNG_MOBILE_FOLDER),
        (n) => backend.existInDownloads(n),
      );
    } catch (e: any) {
      appState.pushMessage('내보내기 실패: ' + (e?.message || e));
      return undefined;
    }
    sink = createMobileDownloadsSink(mobileFolder);
  } else {
    const dir = await backend.selectDir();
    if (!dir) {
      appState.pushMessage(GLOBAL_PRESET_PNG_TEXT.folderNotChosen);
      return undefined;
    }
    sink = createPcFolderSink(dir);
  }

  let result: PresetPngExportResult;
  try {
    result = await exportPresetPngs(targets, {
      buildPng: (id) => globalPresetService.buildExportPng(id),
      sink,
      onProgress: (done, total) =>
        appState.setProgressDialog({ text: GLOBAL_PRESET_PNG_TEXT.progress, done, total }),
    });
  } finally {
    appState.setProgressDialog(undefined);
  }
  const notice = presetPngResultNotice(result, mobileFolder);
  if (notice.kind === 'message') appState.pushMessage(notice.text);
  else appState.pushDialog({ type: 'yes-only', text: notice.text });
  return result;
}
