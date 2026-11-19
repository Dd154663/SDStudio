import { observable, action, makeObservable } from 'mobx';
import { backend, imageService } from '.';
import { GenericScene, InpaintScene, Session, CharacterPreset } from './types';

function getMirrorCropX(scene: GenericScene): number | undefined {
  if (isMirrorScene(scene)) {
    return (scene as InpaintScene).mirrorCropX;
  }
  return undefined;
}
import { appState } from './AppService';
import { cropMirrorResultFromDataUri, dataUriToBase64 } from './ImageService';
import { DownloadSettings } from '../../main/config';
import { imageExtFromBase64 } from './imageFormats';
import { platform } from './platform';

/**
 * 다운로드 안내 문구(2026-11-19 다운로드 창 개편 — 단일 출처).
 * 모바일은 저장 폴더를 고를 수 없어 기기 「다운로드」 폴더(backend.copyToDownloads — 원본 파일명, 갤러리 등록)로 저장한다.
 */
export const IMAGE_DOWNLOAD_TEXT = {
  mobileSavedOne: '다운로드 폴더에 저장했습니다',
  mobileSavedMany: (n: number) => `${n}장을 다운로드 폴더에 저장했습니다`,
  /** 여러 장(씬 이름 폴더) — 모바일 */
  mobileSavedManyInFolder: (folder: string, n: number) => `다운로드 폴더의 "${folder}"에 ${n}장을 저장했습니다`,
  mobileFailed: (n: number) => `${n}장을 저장하지 못했습니다`,
  /** 여러 장(씬 이름 폴더) — PC */
  pcSavedManyInFolder: (folder: string, n: number) => `"${folder}" 폴더에 ${n}개의 이미지를 저장했습니다`,
  pcFailedMany: (n: number) => `${n}개의 이미지 저장에 실패했습니다`,
  folderNotChosen: '저장 폴더를 고르지 않아 다운로드하지 않았습니다',
  folderChanged: (path: string) => `저장 폴더를 바꿨습니다: ${path}`,
  progress: '이미지 다운로드 중...',
};

/** 여러 장 다운로드 옵션 — onProgress(done, total) 는 저장 폴더가 정해진 뒤 0 부터 장마다 부른다 */
export interface DownloadImagesOptions {
  onProgress?: (done: number, total: number) => void;
}

function isMirrorScene(scene: GenericScene): boolean {
  return scene.type === 'inpaint' && (scene as InpaintScene).workflowType === 'SDMirror';
}

/**
 * 파일명에 사용할 수 없는 특수문자를 안전한 문자로 치환
 */
export function sanitizeFilename(filename: string): string {
  // Windows/Mac/Linux에서 파일명에 사용할 수 없는 문자들
  const invalidChars = /[<>:"/\\|?*]/g;
  // 연속된 공백을 하나로
  const multipleSpaces = /\s+/g;
  // 앞뒤 공백 및 점 제거
  const trimPattern = /^[\s.]+|[\s.]+$/g;

  let sanitized = filename
    .replace(invalidChars, '_')
    .replace(multipleSpaces, ' ')
    .replace(trimPattern, '');

  // 빈 문자열이면 기본값
  if (!sanitized) {
    sanitized = 'image';
  }

  // 최대 길이 제한 (확장자 제외 200자)
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200);
  }

  return sanitized;
}

/**
 * 파일명 중복 시 자동 넘버링
 */
export async function getUniqueFilename(
  directory: string,
  baseFilename: string,
  extension: string,
  useAbsolutePath: boolean = false,
): Promise<string> {
  let filename = `${baseFilename}.${extension}`;
  let counter = 1;

  // 파일 존재 여부 확인 (최대 9999번까지)
  const checkFile = async (): Promise<string> => {
    const fullPath = `${directory}/${filename}`;
    const exists = useAbsolutePath
      ? await backend.existFileAbsolute(fullPath)
      : await backend.existFile(fullPath);
    if (!exists) {
      return filename;
    }
    if (counter > 9999) {
      return `${baseFilename}_${Date.now()}.${extension}`;
    }
    filename = `${baseFilename}_${counter}.${extension}`;
    counter += 1;
    return checkFile();
  };

  return checkFile();
}

/** 여러 장 다운로드 폴더(씬 이름 폴더) 규칙 — 2026-11-19 */
export const DOWNLOAD_FOLDER_DEFAULT_NAME = '이미지';
/** 폴더 이름 최대 글자 수(코드 포인트). 「 (n)」 접미와 파일명이 붙어도 경로가 지나치게 길지 않게 */
export const DOWNLOAD_FOLDER_MAX_LENGTH = 100;
/** 「 (2)」 … 「 (999)」 까지 시도하고, 그래도 있으면 시각 접미 */
export const DOWNLOAD_FOLDER_MAX_SUFFIX = 999;
// Windows 예약 장치 이름(확장자가 붙어도 예약 — 「CON.txt」). 위첨자 숫자 변형 포함.
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/**
 * 씬 이름 → 파일 시스템에 안전한 폴더 이름. sanitizeFilename(금지 문자 → _, 공백 정리, 앞뒤 점·공백 제거)에 더해
 * 제어 문자 제거, 길이 제한(자른 뒤 끝 점·공백 재정리), Windows 예약 이름 앞에 「_」, 빈 결과면 기본 이름.
 */
export function sanitizeDownloadFolderName(name: string): string {
  const cleaned = (name ?? '').replace(/[\x00-\x1f\x7f]/g, ' ');
  // 점·공백뿐이면 sanitizeFilename 이 'image' 로 채우므로 그 전에 기본 이름으로
  if (!cleaned.replace(/[\s.]/g, '')) return DOWNLOAD_FOLDER_DEFAULT_NAME;
  let s = sanitizeFilename(cleaned);
  const chars = Array.from(s);
  if (chars.length > DOWNLOAD_FOLDER_MAX_LENGTH) {
    s = chars.slice(0, DOWNLOAD_FOLDER_MAX_LENGTH).join('').replace(/[\s.]+$/, '');
  }
  if (!s) return DOWNLOAD_FOLDER_DEFAULT_NAME;
  const stem = s.split('.')[0].trim();
  if (WINDOWS_RESERVED_NAME.test(stem)) s = `_${s}`;
  return s;
}

/**
 * 같은 이름의 폴더·파일이 이미 있으면 「base (2)」「base (3)」 … 를 쓴다(덮어쓰거나 섞지 않음).
 * DOWNLOAD_FOLDER_MAX_SUFFIX 를 넘으면 「base (<시각>)」. exists = 그 이름이 있는지(플랫폼별 판정).
 */
export async function pickUniqueDownloadFolderName(
  base: string,
  exists: (name: string) => Promise<boolean>,
  now: () => number = Date.now,
): Promise<string> {
  if (!(await exists(base))) return base;
  for (let n = 2; n <= DOWNLOAD_FOLDER_MAX_SUFFIX; n++) {
    const candidate = `${base} (${n})`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base} (${now()})`;
}

/**
 * 파일명 생성 옵션
 */
export interface FilenameOptions {
  sceneName: string;
  prefix?: string;
  suffix?: string;
  includeTimestamp?: boolean;
  includeIndex?: boolean;
  index?: number;
  customName?: string;
}

/**
 * 파일명 생성
 */
export function generateFilename(options: FilenameOptions): string {
  const {
    sceneName,
    prefix = '',
    suffix = '',
    includeTimestamp = false,
    includeIndex = false,
    index = 0,
    customName,
  } = options;

  const parts: string[] = [];

  // 접두사
  if (prefix) {
    parts.push(sanitizeFilename(prefix));
  }

  // 메인 이름 (커스텀 이름 또는 씬 이름)
  if (customName) {
    parts.push(sanitizeFilename(customName));
  } else {
    parts.push(sanitizeFilename(sceneName));
  }

  // 접미사
  if (suffix) {
    parts.push(sanitizeFilename(suffix));
  }

  // 인덱스
  if (includeIndex && index > 0) {
    parts.push(index.toString().padStart(3, '0'));
  }

  // 타임스탬프
  if (includeTimestamp) {
    parts.push(Date.now().toString());
  }

  return parts.join('_');
}

/**
 * 다운로드 항목
 */
export interface DownloadItem {
  id: string;
  sourcePath: string;
  targetFilename: string;
  sceneName: string;
  selected: boolean;
}

/**
 * 이미지 다운로드 서비스
 */
export class ImageDownloadService {
  @observable accessor settings: DownloadSettings = {
    autoNumbering: true,
    overwriteExisting: false,
    includeTimestamp: false,
  };

  @observable accessor downloadQueue: DownloadItem[] = [];

  @observable accessor isDownloading: boolean = false;

  @observable accessor downloadProgress: number = 0;

  constructor() {
    makeObservable(this);
    // 설정 로드는 bootstrap 이 loadSettings() 를 호출해 수행한다
    // (생성자에서 IO 를 시작하지 않는다 — 부팅 순서 보장).
  }

  /**
   * 설정 로드
   */
  @action
  async loadSettings() {
    try {
      const config = await backend.getConfig();
      if (config.downloadSettings) {
        this.settings = { ...this.settings, ...config.downloadSettings };
      }
    } catch (e) {
      console.error('Failed to load download settings:', e);
    }
  }

  /**
   * 설정 저장
   */
  @action
  async saveSettings() {
    try {
      const config = await backend.getConfig();
      config.downloadSettings = this.settings;
      await backend.setConfig(config);
    } catch (e) {
      console.error('Failed to save download settings:', e);
    }
  }

  /**
   * 마지막 저장 경로 업데이트
   */
  @action
  async updateLastSavePath(path: string) {
    this.settings.lastSavePath = path;
    await this.saveSettings();
  }

  /**
   * 파일명 미리보기 생성
   */
  generateFilenamePreview(
    _session: Session,
    scene: GenericScene,
    characterPreset?: CharacterPreset,
    index?: number,
  ): string {
    const prefix =
      characterPreset?.filenamePrefix || this.settings.defaultPrefix || '';
    const suffix =
      characterPreset?.filenameSuffix || this.settings.defaultSuffix || '';

    return generateFilename({
      sceneName: scene.name,
      prefix,
      suffix,
      includeTimestamp: this.settings.includeTimestamp,
      includeIndex: index !== undefined,
      index,
    });
  }

  /**
   * PC 저장 폴더 — 지정돼 있지 않으면 폴더 선택 창을 띄운다. 고르지 않으면 안내하고 undefined.
   */
  private async ensureSavePath(): Promise<string | undefined> {
    let savePath = this.settings.lastSavePath;
    if (!savePath) {
      savePath = await backend.selectDir();
      if (!savePath) {
        appState.pushMessage(IMAGE_DOWNLOAD_TEXT.folderNotChosen);
        return undefined;
      }
      await this.updateLastSavePath(savePath);
    }
    return savePath;
  }

  /**
   * 모바일: 기기 「다운로드」 폴더로 한 장씩 순서대로 복사(브리지에 이미지 데이터를 태우지 않는 네이티브 복사).
   * 파일명은 원본 그대로(PC 의 접두사·접미사·넘버링·미러 자르기는 적용되지 않음).
   * folderSceneName 이 있으면 Download/<씬 이름 폴더>/ 에 저장한다(여러 장 — 폴더는 첫 복사 때 backend 가 만든다).
   */
  private async copyToDeviceDownloads(
    imagePaths: string[],
    options?: DownloadImagesOptions,
    folderSceneName?: string,
  ): Promise<{ success: number; failed: number }> {
    const result = { success: 0, failed: 0 };
    const total = imagePaths.length;
    let folder: string | undefined;
    if (folderSceneName !== undefined) {
      try {
        folder = await pickUniqueDownloadFolderName(
          sanitizeDownloadFolderName(folderSceneName),
          (n) => backend.existInDownloads(n),
        );
      } catch (e: any) {
        console.error('Failed to pick download folder name:', e);
        appState.pushMessage(`이미지 저장 실패: ${e?.message || e}`);
        return result;
      }
    }
    options?.onProgress?.(0, total);
    for (let i = 0; i < total; i++) {
      try {
        if (folder !== undefined) await backend.copyToDownloads(imagePaths[i], folder);
        else await backend.copyToDownloads(imagePaths[i]);
        result.success += 1;
      } catch (e) {
        console.error(`Failed to copy image ${imagePaths[i]}:`, e);
        result.failed += 1;
      }
      options?.onProgress?.(i + 1, total);
    }
    if (result.success > 0) {
      appState.pushMessage(
        folder !== undefined
          ? IMAGE_DOWNLOAD_TEXT.mobileSavedManyInFolder(folder, result.success)
          : total > 1
            ? IMAGE_DOWNLOAD_TEXT.mobileSavedMany(result.success)
            : IMAGE_DOWNLOAD_TEXT.mobileSavedOne,
      );
    }
    if (result.failed > 0) {
      appState.pushMessage(IMAGE_DOWNLOAD_TEXT.mobileFailed(result.failed));
    }
    return result;
  }

  /**
   * 단일 이미지 다운로드(모바일 = 다운로드 폴더 복사, PC = 저장 폴더·파일명 규칙)
   */
  async downloadSingleImage(
    _session: Session,
    scene: GenericScene,
    imagePath: string,
    characterPreset?: CharacterPreset,
    customFilename?: string,
  ): Promise<boolean> {
    if (platform.isMobile) {
      const r = await this.copyToDeviceDownloads([imagePath]);
      return r.success > 0;
    }
    try {
      // 저장 경로 선택(없으면 폴더 선택 — 고르지 않으면 안내 후 중단)
      const savePath = await this.ensureSavePath();
      if (!savePath) {
        return false;
      }

      // 파일명 생성
      const prefix =
        characterPreset?.filenamePrefix || this.settings.defaultPrefix || '';
      const suffix =
        characterPreset?.filenameSuffix || this.settings.defaultSuffix || '';

      let baseFilename: string;
      if (customFilename) {
        baseFilename = sanitizeFilename(customFilename);
      } else {
        baseFilename = generateFilename({
          sceneName: scene.name,
          prefix,
          suffix,
          includeTimestamp: this.settings.includeTimestamp,
        });
      }

      // 이미지 데이터 읽기
      const imageData = await imageService.fetchImage(imagePath);
      if (!imageData) {
        throw new Error('이미지를 읽을 수 없습니다');
      }

      // SDMirror 씬이면 우측 절반만 크롭
      const base64 = isMirrorScene(scene)
        ? await cropMirrorResultFromDataUri(imageData, getMirrorCropX(scene))
        : dataUriToBase64(imageData);

      // 확장자는 실제 바이트에 맞춘다(webp/png; 미러 크롭은 png)
      const ext = imageExtFromBase64(base64);

      // 중복 처리
      let finalFilename: string;
      if (this.settings.autoNumbering && !this.settings.overwriteExisting) {
        finalFilename = await getUniqueFilename(savePath, baseFilename, ext, true);
      } else {
        finalFilename = `${baseFilename}.${ext}`;
      }

      // 파일 저장 (절대 경로 사용)
      const fullPath = `${savePath}/${finalFilename}`;
      await backend.writeDataFileAbsolute(fullPath, base64);

      appState.pushMessage(`이미지가 저장되었습니다: ${finalFilename}`);
      return true;
    } catch (e: any) {
      console.error('Failed to download image:', e);
      appState.pushMessage(`이미지 저장 실패: ${e.message}`);
      return false;
    }
  }

  /**
   * 여러 이미지 일괄 다운로드(모바일 = 다운로드 폴더 복사, PC = 저장 폴더·파일명 규칙)
   */
  async downloadMultipleImages(
    _session: Session,
    scene: GenericScene,
    imagePaths: string[],
    characterPreset?: CharacterPreset,
    options?: DownloadImagesOptions,
  ): Promise<{ success: number; failed: number }> {
    const result = { success: 0, failed: 0 };

    if (imagePaths.length === 0) {
      return result;
    }

    // 2장 이상 = 씬 이름 폴더를 만들어 그 안에 저장(1장 = 종전처럼 폴더 없이)
    const useFolder = imagePaths.length >= 2;

    if (platform.isMobile) {
      return this.copyToDeviceDownloads(imagePaths, options, useFolder ? scene.name : undefined);
    }

    try {
      // 저장 경로 선택(없으면 폴더 선택 — 고르지 않으면 안내 후 중단)
      const rootPath = await this.ensureSavePath();
      if (!rootPath) {
        return result;
      }
      // 폴더는 미리 만들지 않는다 — 첫 파일을 쓸 때 writeDataFileAbsolute 가 상위 폴더를 만든다(전부 실패면 빈 폴더 없음).
      const folderName = useFolder
        ? await pickUniqueDownloadFolderName(sanitizeDownloadFolderName(scene.name), (n) =>
            backend.existFileAbsolute(`${rootPath}/${n}`),
          )
        : undefined;
      const savePath = folderName !== undefined ? `${rootPath}/${folderName}` : rootPath;

      this.isDownloading = true;
      this.downloadProgress = 0;
      options?.onProgress?.(0, imagePaths.length);

      const prefix =
        characterPreset?.filenamePrefix || this.settings.defaultPrefix || '';
      const suffix =
        characterPreset?.filenameSuffix || this.settings.defaultSuffix || '';

      // 순차적으로 다운로드 처리
      const downloadImage = async (index: number): Promise<void> => {
        if (index >= imagePaths.length) {
          return;
        }

        const imagePath = imagePaths[index];

        try {
          // 파일명 생성
          const baseFilename = generateFilename({
            sceneName: scene.name,
            prefix,
            suffix,
            includeTimestamp: this.settings.includeTimestamp,
            includeIndex: true,
            index: index + 1,
          });

          // 이미지 데이터 읽기
          const imageData = await imageService.fetchImage(imagePath);
          if (!imageData) {
            throw new Error('이미지를 읽을 수 없습니다');
          }

          // SDMirror 씬이면 우측 절반만 크롭
          const base64 = isMirrorScene(scene)
            ? await cropMirrorResultFromDataUri(imageData, getMirrorCropX(scene))
            : dataUriToBase64(imageData);

          // 확장자는 실제 바이트에 맞춘다(webp/png; 미러 크롭은 png)
          const ext = imageExtFromBase64(base64);

          // 중복 처리
          let finalFilename: string;
          if (this.settings.autoNumbering && !this.settings.overwriteExisting) {
            finalFilename = await getUniqueFilename(
              savePath!,
              baseFilename,
              ext,
              true,
            );
          } else {
            finalFilename = `${baseFilename}.${ext}`;
          }

          // 파일 저장 (절대 경로 사용)
          const fullPath = `${savePath}/${finalFilename}`;
          await backend.writeDataFileAbsolute(fullPath, base64);

          result.success += 1;
        } catch (e) {
          console.error(`Failed to download image ${imagePath}:`, e);
          result.failed += 1;
        }

        this.downloadProgress = ((index + 1) / imagePaths.length) * 100;
        options?.onProgress?.(index + 1, imagePaths.length);

        // 다음 이미지 처리
        await downloadImage(index + 1);
      };

      await downloadImage(0);

      if (result.success > 0) {
        appState.pushMessage(
          folderName !== undefined
            ? IMAGE_DOWNLOAD_TEXT.pcSavedManyInFolder(folderName, result.success)
            : `${result.success}개의 이미지가 저장되었습니다`,
        );
      }
      if (result.failed > 0) {
        appState.pushMessage(IMAGE_DOWNLOAD_TEXT.pcFailedMany(result.failed));
      }
    } catch (e: any) {
      console.error('Failed to download images:', e);
      appState.pushMessage(`이미지 저장 실패: ${e.message}`);
    } finally {
      this.isDownloading = false;
      this.downloadProgress = 0;
    }

    return result;
  }

  /**
   * 장수에 맞춰 한 장/여러 장 다운로드를 고른다. showProgress 면 여러 장일 때 진행 창(appState.setProgressDialog)을
   * 저장 폴더가 정해진 뒤부터 보이고 끝나면 닫는다. 결과 안내는 각 다운로드 함수가 띄운다.
   * 반환의 success 0 = 저장한 것이 없음(폴더 미선택·실패 모두).
   */
  async downloadImages(
    session: Session,
    scene: GenericScene,
    imagePaths: string[],
    characterPreset?: CharacterPreset,
    showProgress = false,
  ): Promise<{ success: number; failed: number }> {
    if (imagePaths.length === 0) return { success: 0, failed: 0 };
    if (imagePaths.length === 1) {
      const ok = await this.downloadSingleImage(session, scene, imagePaths[0], characterPreset);
      return ok ? { success: 1, failed: 0 } : { success: 0, failed: 0 };
    }
    if (!showProgress) {
      return this.downloadMultipleImages(session, scene, imagePaths, characterPreset);
    }
    try {
      return await this.downloadMultipleImages(session, scene, imagePaths, characterPreset, {
        onProgress: (done, total) =>
          appState.setProgressDialog({ text: IMAGE_DOWNLOAD_TEXT.progress, done, total }),
      });
    } finally {
      appState.setProgressDialog(undefined);
    }
  }

  /**
   * 히스토리 이미지 한 장 다운로드. 모바일은 원본 씬을 찾지 않고 바로 다운로드 폴더로 복사하고(종전 동작),
   * PC 는 resolveTarget 으로 프로젝트·씬을 찾은 뒤 파일명 규칙으로 저장한다(찾지 못한 안내는 resolveTarget 쪽).
   */
  async downloadHistoryImage(
    imagePath: string,
    resolveTarget: () => Promise<
      | { session: Session; scene: GenericScene; characterPreset?: CharacterPreset }
      | null
      | undefined
    >,
  ): Promise<boolean> {
    if (platform.isMobile) {
      const r = await this.copyToDeviceDownloads([imagePath]);
      return r.success > 0;
    }
    const target = await resolveTarget();
    if (!target) return false;
    return this.downloadSingleImage(
      target.session,
      target.scene,
      imagePath,
      target.characterPreset,
    );
  }

  /**
   * 저장 경로 변경(PC 전용 — 모바일은 폴더 선택이 없어 아무것도 하지 않는다)
   */
  async changeSavePath(): Promise<string | undefined> {
    if (platform.isMobile) return undefined;
    const newPath = await backend.selectDir();
    if (newPath) {
      await this.updateLastSavePath(newPath);
    }
    return newPath;
  }

  /**
   * 다운로드 설정 업데이트
   */
  @action
  async updateSettings(newSettings: Partial<DownloadSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    await this.saveSettings();
  }
}
