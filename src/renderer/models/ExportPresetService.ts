import { persistService } from './PersistenceService';
import {
  batchProcessService,
  backupService,
  backend,
  gameService,
  globalCharacterPresetService,
  globalPieceService,
  globalPresetService,
  artistLibraryService,
  imageService,
  localAIService,
  projectSizeService,
  sessionService,
  taskQueueService,
  trashService,
  workFlowService,
  zipService,
} from '.';
import { platform, buildImageOptimizeOptions } from './platform';
import { runPool } from './concurrency';
import type { GlobalPresetType, IGlobalPresetEntry } from './GlobalPresetService';
import { SUPPORTED_GLOBAL_PRESET_TYPES } from './GlobalPresetService';
import { Dialog } from '../componenets/ConfirmWindow';
import { cropMirrorResultFromDataUri, dataUriToBase64, deleteImageFiles } from './ImageService';
import {
  createImageWithText,
  embedJSONInPNG,
  importPreset,
  normalizePresetJson,
  readJSONFromPNG,
} from './SessionService';
import { action, observable } from 'mobx';
import {
  CharacterPreset,
  GenericScene,
  InpaintScene,
  ISession,
  isValidPieceLibrary,
  isValidSession,
  isValidNAISPreset,
  extractNAISPieceNames,
  convertNAISToSession,
  Piece,
  PieceLibrary,
  PromptPiece,
  Scene,
  Session,
  genericSceneFromJSON,
} from './types';
import { extractPromptDataFromBase64, getFirstFile } from './util';
import { ImageOptimizeMethod } from '../backend';
import { v4 } from 'uuid';
import { Resolution, resolutionMap } from '../backends/imageGen';
import { ProgressDialog } from '../componenets/ProgressWindow';
import { migratePieceLibrary } from './legacy';
import {
  oneTimeFlowMap,
  oneTimeFlows,
  queueRemoveBg,
} from './workflows/OneTimeFlows';
import { appState } from './AppService';
import type { ExportPreset } from './AppService';
import {
  buildPatternPrefix,
  resolveExportTargetFolder,
  sanitizeFilenamePart,
} from './exportPresetUtils';
import type { FilenamePattern } from './exportPresetUtils';
import { isOptimizedImageFile } from './imageFormats';
import { decoratePresetExportImage } from './presetExportDecoration';

export class ExportPresetService {
  // ── 내보내기 프리셋 헬퍼 ──
  // 저장 위치: APP_DIR/exportPresets.json (로컬 파일 — 백업에 포함됨).
  // 과거엔 localStorage('sdstudio-export-presets')에 저장돼 비-로컬 데이터였고
  // 모바일 데이터 삭제 시 함께 증발하며 백업에도 안 담겼다. 파일로 이관한다.
  // sync API(loadExportPresets) 유지를 위해 인메모리 캐시 + 파일 라이트스루.
  private exportPresetsCache: ExportPreset[] | null = null;
  private exportPresetsLoaded = false;

  // 시작 시 1회 호출(index.ts). 파일을 읽고, 없으면 localStorage에서 비파괴 이관한다.
  async initExportPresets(): Promise<void> {
    if (this.exportPresetsLoaded) return;
    let presets: ExportPreset[] | null = null;
    try {
      const raw = await backend.readFile('exportPresets.json');
      presets = JSON.parse(raw);
    } catch {
      // 파일 없음 → localStorage 마이그레이션 시도 (1회, 비파괴)
      try {
        const ls = localStorage.getItem('sdstudio-export-presets');
        if (ls) {
          presets = JSON.parse(ls);
          // 파일로 이관. localStorage 원본은 롤백 안전망으로 남겨둔다(삭제하지 않음).
          await persistService.write(
            'exportPresets.json',
            JSON.stringify(presets),
          );
          console.log(
            '[Migration] 내보내기 프리셋 localStorage → exportPresets.json 이관 완료',
          );
        }
      } catch {}
    }
    // 로드 도중 saveExportPresets가 먼저 일어났다면(loaded=true) 덮어쓰지 않는다.
    if (!this.exportPresetsLoaded) {
      this.exportPresetsCache = presets ?? [];
      this.exportPresetsLoaded = true;
    }
  }

  loadExportPresets(): ExportPreset[] {
    if (this.exportPresetsCache !== null) return this.exportPresetsCache;
    // 아직 디스크 로드 전 — localStorage로 즉시 대응(동기)해 회귀를 막는다.
    try {
      const raw = localStorage.getItem('sdstudio-export-presets');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  saveExportPresets(presets: ExportPreset[]) {
    this.exportPresetsCache = presets;
    this.exportPresetsLoaded = true; // 이후 늦은 init 로드가 덮어쓰지 못하게
    persistService.write('exportPresets.json', JSON.stringify(presets)).catch(
      (e) => {
        console.error('내보내기 프리셋 저장 실패:', e);
      },
    );
  }

  private formatExportPresetLabel(p: ExportPreset): string {
    const parts: string[] = [p.name];
    const detail: string[] = [];
    detail.push(p.menu === 'fav' ? '즐겨찾기' : '전체');
    if (p.format === 'prefix' && p.prefix) detail.push(`캐릭터: ${p.prefix}`);
    if (p.format === 'prefix_ask') detail.push('캐릭터: 직접 입력');
    if (p.opt !== 'original') detail.push(`${p.opt}·${p.imageSize}px`);
    else detail.push('원본');
    return `${p.name}  (${detail.join(', ')})`;
  }

  private async detectSpecialChars(
    type: 'scene' | 'inpaint',
    selected: GenericScene[] | undefined,
    separator: string,
    autoConvert = false,
  ): Promise<Set<string> | undefined> {
    const scenes = selected || appState.curSession!.getScenes(type);
    return this.detectSpecialCharsFromNames(
      scenes.map((s) => s.name),
      separator,
      autoConvert,
    );
  }

  // 씬 이름 목록에서 특수문자를 감지하고, 있으면 구분자 변환 여부를 한 번 묻는다.
  // autoConvert=true 면 묻지 않고 감지된 특수문자 전부를 변환 대상으로 반환.
  // 반환: 변환할 문자 Set (없으면 빈 Set), 사용자가 취소하면 undefined.
  async detectSpecialCharsFromNames(
    sceneNames: string[],
    separator: string,
    autoConvert = false,
  ): Promise<Set<string> | undefined> {
    const specialCharRegex = /[^a-zA-Z0-9가-힣ぁ-んァ-ヶ一-龥　-〿]/g;
    const detectedChars = new Set<string>();
    for (const nm of sceneNames) {
      const matches = nm.match(specialCharRegex);
      if (matches) matches.forEach((c) => detectedChars.add(c));
    }

    let charsToReplace = new Set<string>();
    if (detectedChars.size > 0) {
      // 자동 변환: 묻지 않고 감지된 특수문자 전부를 구분자로 변환
      if (autoConvert) return detectedChars;
      const items = Array.from(detectedChars).map((c) => ({
        text: c === ' ' ? '띄어쓰기' : `"${c}"`,
        value: c,
      }));
      const result = await appState.pushDialogAsync({
        type: 'checkbox',
        text: `씬 이름에서 감지된 특수문자입니다.\n"${separator}" 로 변환할 문자를 선택해주세요:`,
        items: items,
      });
      if (result === undefined) return undefined; // 취소
      try {
        charsToReplace = new Set(JSON.parse(result));
      } catch (e) {}
    }
    return charsToReplace;
  }

  async exportPackage(
    type: 'scene' | 'inpaint',
    selected?: GenericScene[],
    presetOverride?: ExportPreset,
  ) {
    appState.lastExportType = type;
    appState.lastExportSelected = selected;
    const exportImpl = async (
      prefix: string,
      fav: boolean,
      opt: string,
      imageSize: number,
      quality: number | undefined,
      preserveStealth: boolean,
      separator: string,
      charsToReplace: Set<string>,
      filenamePattern: FilenamePattern | undefined,
      applyCharacterAffix: boolean,
      targetFolder: string | null,
      outputMode: 'tar' | 'files',
    ) => {
      let paths: { path: string; name: string }[] = [];
      await imageService.refreshBatch(appState.curSession!);
      const scenes = selected ?? appState.curSession!.getScenes(type);
      await Promise.allSettled(scenes.map((s) => gameService.refreshList(appState.curSession!, s)));

      // 파일명 패턴 프리픽스(프로젝트/폴더명) — export 1회당 고정
      const patternProjectName = appState.curSession!.name;
      const patternFolderPath = sessionService.getFolderOf(patternProjectName);
      const patternFolderName = patternFolderPath
        ? sessionService.folderLeafName(patternFolderPath)
        : '';
      const patternPrefix = buildPatternPrefix(
        filenamePattern,
        patternFolderName,
        patternProjectName,
        separator,
      );
      for (const scene of scenes) {
        const cands = gameService.getOutputs(appState.curSession!, scene);
        const imageMap: any = {};
        cands.forEach((x) => {
          imageMap[x] = true;
        });
        const images = [];
        if (fav) {
          if (scene.mains.length) {
            for (const main of scene.mains) {
              if (imageMap[main]) images.push(main);
            }
          } else {
            if (cands.length) {
              images.push(cands[0]);
            }
          }
        } else {
          for (const cand of cands) {
            images.push(cand);
          }
        }
        // 캐릭터 프리셋 파일명 옵션 적용 (토글 off 면 접두/접미사 미적용)
        const characterPreset = applyCharacterAffix
          ? appState.getAppliedCharacterPreset()
          : null;
        const presetPrefix = characterPreset?.filenamePrefix || '';
        const presetSuffix = characterPreset?.filenameSuffix || '';

        let sceneName = scene.name;
        let finalPrefix = prefix;
        let finalPresetPrefix = presetPrefix ? presetPrefix + separator : '';
        let finalPresetSuffix = presetSuffix ? separator + presetSuffix : '';
        if (charsToReplace.size > 0) {
          const escaped = Array.from(charsToReplace).map(
            (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          ).join('|');
          const regex = new RegExp(`(${escaped})+`, 'g');
          sceneName = sceneName.replace(regex, separator);
          finalPrefix = finalPrefix.replace(regex, separator);
          finalPresetPrefix = finalPresetPrefix.replace(regex, separator);
          finalPresetSuffix = finalPresetSuffix.replace(regex, separator);
        }
        const isMirror = scene.type === 'inpaint' && (scene as InpaintScene).workflowType === 'SDMirror';
        for (let i = 0; i < images.length; i++) {
          let imgPath = imageService.getOutputDir(appState.curSession!, scene) + '/' + images[i];
          if (isMirror) {
            const imgData = await imageService.fetchImage(imgPath);
            if (imgData) {
              const cropped = await cropMirrorResultFromDataUri(imgData, (scene as InpaintScene).mirrorCropX);
              const tmpPath = 'tmp/' + v4() + '.png';
              await backend.writeDataFile(tmpPath, cropped);
              imgPath = tmpPath;
            }
          }
          // 파일명: [patternPrefix][presetPrefix_][manualPrefix_]sceneName[_presetSuffix][_index].<ext>
          // 확장자는 최종 출력 바이트에 맞춘다: 원본=소스 확장자(webp/png), 최적화=opt(webp/avif).
          const outExt =
            opt === 'original'
              ? imgPath.split('.').pop() || 'png'
              : opt === 'avif'
                ? 'avif'
                : 'webp';
          const baseName =
            patternPrefix + finalPresetPrefix + finalPrefix + sceneName + finalPresetSuffix;
          const name = images.length === 1
            ? baseName + '.' + outExt
            : baseName + separator + (i + 1).toString() + '.' + outExt;
          paths.push({ path: imgPath, name });
        }
      }
      if (opt !== 'original') {
        // 이중 최적화 가드: 이미 최적화(webp/avif)된 소스가 섞여 있으면 묻는다.
        const alreadyOptCount = paths.filter((p) =>
          isOptimizedImageFile(p.path),
        ).length;
        let skipAlreadyOpt = false;
        if (alreadyOptCount > 0) {
          const choice = await appState.pushDialogAsync({
            type: 'select',
            text: `선택한 이미지 중 ${alreadyOptCount}개가 이미 최적화(webp/avif)되어 있습니다.\n다시 최적화하면 화질이 저하될 수 있습니다. 어떻게 할까요?`,
            items: [
              { text: '이미 최적화된 것은 원본 유지', value: 'skip' },
              { text: '전부 다시 최적화', value: 'all' },
              { text: '취소', value: 'cancel' },
            ],
          });
          if (!choice || choice === 'cancel') {
            appState.exportProgress = undefined;
            return;
          }
          skipAlreadyOpt = choice === 'skip';
        }
        const ext = opt === 'avif' ? '.avif' : '.webp';
        const optimizeMethod = opt === 'lossy'
          ? ImageOptimizeMethod.LOSSY
          : opt === 'avif'
            ? ImageOptimizeMethod.AVIF
            : ImageOptimizeMethod.LOSSLESS;
        let done = 0;
        let failCount = 0;
        const config = await backend.getConfig();
        const CONCURRENCY = Math.max(1, Math.min(platform.maxImageConcurrency, config.exportConcurrency ?? platform.exportConcurrency));
        const results: (typeof paths[0] | null)[] = new Array(paths.length).fill(null);

        appState.exportProgress = {
          text: '이미지 크기 최적화 중..',
          done: 0,
          total: paths.length,
        };

        // 동시 실행 수 제한 병렬 처리 (공유 runPool — export/backup/webp일괄 단일 출처)
        await runPool(paths, CONCURRENCY, async (item, idx) => {
          // 원본 유지 선택 시: 이미 최적화된 소스는 재인코딩 없이 그대로(확장자 일치)
          if (skipAlreadyOpt && isOptimizedImageFile(item.path)) {
            const srcExt = item.path.split('.').pop() || 'webp';
            results[idx] = {
              path: item.path,
              name: item.name.replace(/\.[^.]+$/, '.' + srcExt),
            };
            done++;
            appState.exportProgress = {
              text: '이미지 크기 최적화 중..',
              done: done,
              total: paths.length,
            };
            return;
          }
          const outputPath = 'tmp/' + v4() + ext;
          try {
            await backend.resizeImage({
              inputPath: item.path,
              outputPath: outputPath,
              maxHeight: imageSize,
              maxWidth: imageSize,
              optimize: optimizeMethod,
              quality: quality,
              preserveStealth: preserveStealth,
            });
            results[idx] = {
              path: outputPath,
              // name 은 이미 최종 확장자(.webp/.avif)를 갖고 있으므로 그대로 사용
              name: item.name,
            };
          } catch (e: any) {
            failCount++;
            console.error('이미지 최적화 실패:', item.path, e.message);
          }
          done++;
          appState.exportProgress = {
            text: '이미지 크기 최적화 중..',
            done: done,
            total: paths.length,
          };
        });

        paths = results.filter((r): r is typeof paths[0] => r !== null);
        if (failCount > 0) {
          appState.pushMessage(`${failCount}개 이미지 최적화 실패 (건너뜀)`);
        }
        if (paths.length === 0) {
          appState.pushMessage('최적화 가능한 이미지가 없습니다');
          appState.exportProgress = undefined;
          return;
        }
      }

      // ── 개별 파일 출력(무압축): 목표 폴더가 있으면 그 아래, 없으면 exports/ 하위에 저장 ──
      if (outputMode === 'files') {
        const outDirName =
          sanitizeFilenamePart(appState.curSession!.name) +
          '_' +
          Date.now().toString();
        const baseDest = targetFolder
          ? `${targetFolder}/${outDirName}`
          : `exports/${outDirName}`;
        appState.exportProgress = {
          text: '이미지 복사 중..',
          done: 0,
          total: paths.length,
        };
        let copied = 0;
        let copyFail = 0;
        for (const item of paths) {
          try {
            if (targetFolder) {
              await backend.copyFileToAbsolute(item.path, `${baseDest}/${item.name}`);
            } else {
              await backend.copyFile(item.path, `${baseDest}/${item.name}`);
            }
          } catch (e: any) {
            copyFail++;
            console.error('이미지 복사 실패:', item.path, e.message);
          }
          copied++;
          appState.exportProgress = {
            text: '이미지 복사 중..',
            done: copied,
            total: paths.length,
          };
        }
        appState.exportProgress = undefined;
        if (copyFail > 0) {
          appState.pushMessage(`${copyFail}개 이미지 복사 실패 (건너뜀)`);
        }
        if (copyFail === paths.length) {
          appState.pushMessage('내보낼 이미지가 없습니다');
          return;
        }
        appState.showExportComplete();
        if (targetFolder) {
          await backend.showFile(baseDest);
        } else {
          await backend.publishExport(baseDest);
        }
        return;
      }

      appState.exportProgress = {
        text: '이미지 압축파일 생성중..',
        done: 0,
        total: 1,
      };
      const outFilePath =
        'exports/' +
        appState.curSession!.name +
        '_main_images_' +
        Date.now().toString() +
        '.tar';
      if (zipService.isZipping) {
        appState.pushDialog({
          type: 'yes-only',
          text: '이미 다른 이미지 내보내기가 진행중입니다',
        });
        appState.exportProgress = undefined;
        return;
      }
      try {
        await zipService.zipFiles(paths, outFilePath);
      } catch (e: any) {
        appState.pushMessage(e.message);
        appState.exportProgress = undefined;
        return;
      }
      appState.exportProgress = undefined;
      // 목표 폴더 지정 시(데스크톱) tar 를 그 폴더로 복사 후 원본(exports/) 정리
      if (targetFolder) {
        const tarName = outFilePath.split('/').pop()!;
        const dest = `${targetFolder}/${tarName}`;
        try {
          await backend.copyFileToAbsolute(outFilePath, dest);
          await backend.deleteFile(outFilePath);
          appState.showExportComplete();
          await backend.showFile(dest);
          return;
        } catch (e: any) {
          appState.pushMessage(
            '목표 폴더로 복사하지 못해 기본 다운로드 폴더로 전환합니다: ' +
              (e.message || e),
          );
          await backend.publishExport(outFilePath);
          return;
        }
      }
      appState.showExportComplete();
      await backend.publishExport(outFilePath);
    };

    // 프리셋 1개를 실행 (선택/빠른 export 공용). 캐릭터 이름 입력·특수문자·목표폴더 해석 포함.
    const runPreset = async (ep: ExportPreset) => {
      const charsToReplace = await this.detectSpecialChars(
        type,
        selected,
        ep.separator,
        ep.autoConvertSeparator === true,
      );
      if (charsToReplace === undefined) return;
      let epPrefix = '';
      if (ep.format === 'prefix' && ep.prefix) {
        epPrefix = ep.prefix + ep.separator;
      } else if (ep.format === 'prefix_ask') {
        const inputName = await appState.pushDialogAsync({
          type: 'input-confirm',
          text: '캐릭터 이름을 입력해주세요',
        });
        if (!inputName) return;
        epPrefix = inputName + ep.separator;
      }
      const targetFolder = await this.resolveTargetFolderFor(ep);
      await exportImpl(
        epPrefix,
        ep.menu === 'fav',
        ep.opt,
        ep.imageSize,
        ep.quality,
        ep.preserveStealth === true,
        ep.separator,
        charsToReplace,
        ep.filenamePattern,
        ep.applyCharacterAffix !== false,
        targetFolder,
        ep.outputMode === 'files' ? 'files' : 'tar',
      );
    };

    // 빠른 export: 선택 다이얼로그를 건너뛰고 지정된 프리셋을 바로 실행
    if (presetOverride) {
      await runPreset(presetOverride);
      return;
    }

    // ── 프리셋 선택 또는 직접 설정 (항상 표시) ──
    const presets = this.loadExportPresets();
    const presetItems: { text: string; value: string }[] = presets.map((p: ExportPreset, i: number) => ({
      text: p.name,
      value: `preset_${i}`,
    }));
    presetItems.push({ text: '⚙️ 프리셋 관리', value: '_manage' });
    presetItems.push({ text: '── 직접 설정으로 내보내기 ──', value: '_manual' });

    const choice = await appState.pushDialogAsync({
      type: 'select',
      text: '내보내기 방법을 선택해주세요',
      items: presetItems,
    });
    if (!choice) return;

    if (choice === '_manage') {
      appState.openExportPresetManager();
      return;
    }

    if (choice.startsWith('preset_')) {
      const idx = parseInt(choice.split('_')[1]);
      const ep = presets[idx];
      if (!ep) return;
      await runPreset(ep);
      return;
    }
    // '_manual' → 아래 기존 다이얼로그 체인

    // ── 기존 다이얼로그 체인 (직접 설정) ──
    const menu = await appState.pushDialogAsync({
      type: 'select',
      text: '내보낼 이미지를 선택해주세요',
      items: [
        { text: '즐겨찾기 이미지만 내보내기', value: 'fav' },
        { text: '모든 이미지 전부 내보내기', value: 'all' },
      ],
    });
    if (!menu) return;
    const format = await appState.pushDialogAsync({
      type: 'select',
      text: '파일 이름 형식을 선택해주세요',
      items: [
        { text: '(씬이름).(이미지 번호).png', value: 'normal' },
        { text: '(캐릭터 이름).(씬이름).(이미지 번호)', value: 'prefix' },
      ],
    });
    if (!format) return;

    const optItems = buildImageOptimizeOptions();
    const opt = await appState.pushDialogAsync({
      type: 'select',
      text: '이미지 크기 최적화 방법을 선택해주세요',
      items: optItems,
    });
    if (!opt) return;
    let imageSize = 0;
    if (opt !== 'original') {
      const inputImageSize = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '이미지 픽셀 크기를 결정해주세요 (추천값 1024)',
      });
      if (!inputImageSize) return;
      try {
        imageSize = parseInt(inputImageSize);
      } catch (error) {
        return;
      }
    }
    // 화질 백분율 — 압축 품질. lossy/avif 만 의미(lossless·original 은 무시).
    // 빈값/무효 입력은 기본값(webp 80·avif 50) 사용, 취소(undefined)만 중단.
    let quality: number | undefined = undefined;
    if (opt === 'lossy' || opt === 'avif') {
      const qInput = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: `이미지 화질을 입력해주세요 (1~100, 기본 ${opt === 'avif' ? 50 : 80})`,
      });
      if (qInput === undefined) return;
      const q = parseInt(qInput);
      if (!isNaN(q) && q >= 1 && q <= 100) quality = q;
    }
    // NAI 스테가노그래피(알파 워터마크) 보존 — webp 만 가능(AVIF 는 알파 평탄화).
    // 리사이즈로 파괴되는 워터마크를 추출·재삽입해 NAI 인스펙터 인식을 유지한다.
    let preserveStealth = false;
    if (opt === 'lossy' || opt === 'lossless') {
      const stealthChoice = await appState.pushDialogAsync({
        type: 'select',
        text: 'NAI 스테가노그래피(워터마크)를 보존할까요?\n보존 시 NAI 인스펙터 인식이 유지되지만 처리가 느려집니다.',
        items: [
          { text: '보존 안 함 (빠름)', value: 'no' },
          { text: '보존 (NAI 호환)', value: 'yes' },
        ],
      });
      if (stealthChoice === undefined) return;
      preserveStealth = stealthChoice === 'yes';
    }
    const separatorInput = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: '파일명 구분자를 입력해주세요 (기본값: .)',
    });
    if (separatorInput === undefined) return;
    const separatorOptions = await appState.pushDialogAsync({
      type: 'checkbox',
      text: '파일명 구분자 옵션',
      items: [{ text: '구분자 없음', value: 'none' }],
    });
    if (separatorOptions === undefined) return;
    let noSeparator = false;
    try {
      noSeparator = JSON.parse(separatorOptions).includes('none');
    } catch (e) {}
    const separator = noSeparator ? '' : separatorInput || '.';

    // 특수문자 감지 (공통 헬퍼 사용)
    // 특수문자 감지 (공통 헬퍼 사용)
    const charsToReplace = await this.detectSpecialChars(type, selected, separator);
    if (charsToReplace === undefined) return;

    // 캐릭터 이름 입력 또는 바로 내보내기
    let prefix = '';
    if (format === 'prefix') {
      const inputPrefix = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '캐릭터 이름을 입력해주세요',
      });
      if (!inputPrefix) return;
      prefix = inputPrefix + separator;
    }

    // 직접 설정 export 는 현행 동작 유지 (패턴=씬, 캐릭터접두사 적용, 목표폴더 없음, tar)
    await exportImpl(
      prefix,
      menu === 'fav',
      opt,
      imageSize,
      quality,
      preserveStealth,
      separator,
      charsToReplace,
      'scene',
      true,
      null,
      'tar',
    );
  }

  // ⚡ 빠른 export: isDefault 로 지정된 프리셋을 선택 다이얼로그 없이 바로 실행.
  async quickExportPackage(type: 'scene' | 'inpaint', selected?: GenericScene[]) {
    const presets = this.loadExportPresets();
    const def = presets.find((p) => p.isDefault);
    if (!def) {
      appState.pushMessage(
        '빠른 export 기본 프리셋이 없습니다. 프리셋 관리에서 "기본 프리셋"을 지정해주세요.',
      );
      return;
    }
    await this.exportPackage(type, selected, def);
  }

  // 프리셋의 목표 폴더(절대경로) 해석. 모바일은 임의 폴더 export 미지원이라 항상 null.
  private async resolveTargetFolderFor(
    preset: ExportPreset,
  ): Promise<string | null> {
    if (!platform.supportsTargetFolder) return null;
    const config = await backend.getConfig();
    const projectFolder = sessionService.getFolderOf(appState.curSession!.name);
    return resolveExportTargetFolder(
      preset,
      projectFolder,
      config.defaultExportFolder,
    );
  }

  async exportPreset(session: Session, preset: any) {
    try {
      let pngData;
      if (preset.profile) {
        const vibeImage = await imageService.fetchVibeImage(session, preset.profile);
        const base64 = vibeImage ? dataUriToBase64(vibeImage) : null;
        // PNG base64는 반드시 iVBOR로 시작 (PNG 시그니처 89 50 4E 47)
        if (base64 && base64.startsWith('iVBOR')) {
          pngData = base64;
        } else {
          pngData = await createImageWithText(832, 1216, preset.name);
        }
      } else {
        pngData = await createImageWithText(832, 1216, preset.name);
      }
      const decoratedPng = await decoratePresetExportImage(
        pngData,
        'local',
        preset.name,
      );
      const newPngData = embedJSONInPNG(decoratedPng, preset);
      const path =
        'exports/' + preset.name + '_' + Date.now().toString() + '.png';
      await backend.writeDataFile(path, newPngData);
      await backend.publishExport(path);
    } catch (e: any) {
      appState.pushMessage('프리셋 내보내기 실패: ' + (e.message || e));
    }
  }
}
