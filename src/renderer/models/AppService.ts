import {
  backend,
  gameService,
  imageService,
  isMobile,
  localAIService,
  sessionService,
  taskQueueService,
  workFlowService,
  zipService,
} from '.';
import { Dialog } from '../componenets/ConfirmWindow';
import { dataUriToBase64, deleteImageFiles } from './ImageService';
import {
  createImageWithText,
  embedJSONInPNG,
  importPreset,
  importPresets,
} from './SessionService';
import { action, observable } from 'mobx';
import {
  CharacterPreset,
  GenericScene,
  InpaintScene,
  ISession,
  isValidPieceLibrary,
  isValidSession,
  PieceLibrary,
  PromptPiece,
  Scene,
  Session,
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

export interface SceneSelectorItem {
  type: 'scene' | 'inpaint';
  text: string;
  callback: (scenes: GenericScene[]) => void;
  scenes?: GenericScene[];
}

export class AppState {
  @observable accessor curSession: Session | undefined = undefined;
  @observable accessor messages: string[] = [];
  @observable accessor dialogs: Dialog[] = [];
  @observable accessor samples: number = 10;
  @observable accessor progressDialog: ProgressDialog | undefined = undefined;
  @observable accessor externalImage: string | undefined = undefined;
  @observable accessor appliedCharacterPreset: string | undefined = undefined; // 현재 적용된 캐릭터 프리셋 이름

  // 이미지 클립보드
  @observable accessor imageClipboard: string[] = [];

  // 만료 프로젝트 알림
  @observable accessor pendingExpiredProjects: {name: string, deletedAt: number}[] = [];

  @action
  addMessage(message: string): void {
    this.messages.push(message);
  }

  @action
  addDialog(dialog: Dialog): void {
    this.dialogs.push(dialog);
  }

  @action
  setSamples(samples: number): void {
    this.samples = samples;
  }

  pushMessage(msg: string) {
    this.messages.push(msg);
  }

  pushDialog(dialog: Dialog) {
    this.dialogs.push(dialog);
  }

  copyImagesToClipboard(paths: string[]) {
    this.imageClipboard = [...paths];
    this.pushMessage(paths.length + '장의 이미지가 복사되었습니다.');
  }

  async pasteImagesFromClipboard(session: Session, scene: GenericScene) {
    if (this.imageClipboard.length === 0) {
      this.pushMessage('복사된 이미지가 없습니다.');
      return;
    }
    const targetDir = imageService.getOutputDir(session, scene);
    let copied = 0;
    for (const srcPath of this.imageClipboard) {
      try {
        const filename = Date.now().toString() + '_' + copied + '.png';
        await backend.copyFile(srcPath, targetDir + '/' + filename);
        copied++;
      } catch (e) {
        console.error('이미지 붙여넣기 실패:', srcPath, e);
      }
    }
    await imageService.refresh(session, scene);
    this.pushMessage(copied + '장의 이미지가 붙여넣어졌습니다.');
  }

  pushDialogAsync(dialog: Dialog) {
    return new Promise<string | undefined>((resolve, reject) => {
      dialog.callback = (value?: string, text?: string) => {
        resolve(value);
      };
      dialog.onCancel = () => {
        resolve(undefined);
      };
      this.dialogs.push(dialog);
    });
  }

  setProgressDialog(dialog: ProgressDialog | undefined) {
    this.progressDialog = dialog;
  }

  handleFile(file: File) {
    if (file.type === 'application/json') {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const json = JSON.parse(e.target.result);
          handleJSONContent(file.name, json);
        } catch (err) {
          console.error(err);
        }
      };
      reader.readAsText(file);
    } else if (file.type === 'image/png') {
      if (!this.curSession) {
        return;
      }
      try {
        const reader = new FileReader();
        reader.onload = async (e: any) => {
          try {
            const base64 = dataUriToBase64(e.target.result);
            const preset = await importPreset(this.curSession!, base64);
            if (preset) {
              this.curSession!.selectedWorkflow = {
                workflowType: preset.type,
                presetName: preset.name,
              };
              this.pushDialog({
                type: 'yes-only',
                text: '그림체를 임포트 했습니다',
              });
            } else {
              this.externalImage = base64;
            }
          } catch (e) {}
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error(err);
      }
    }
    const handleJSONContent = async (name: string, json: any) => {
      if (name.endsWith('.json')) {
        name = name.slice(0, -5);
      }
      const handleAddSession = async (json: any) => {
        const importCool = async () => {
          const sess = await sessionService.get(json.name);
          if (!sess) {
            await sessionService.importSessionShallow(
              json as ISession,
              json.name,
            );
            const newSession = (await sessionService.get(json.name))!;
            this.curSession = newSession;
            this.pushDialog({
              type: 'yes-only',
              text: '프로젝트를 임포트 했습니다',
            });
          } else {
            this.pushDialog({
              type: 'input-confirm',
              text: '프로젝트를 임포트 합니다. 새 프로젝트 이름을 입력하세요.',
              callback: async (value) => {
                if (!value || value === '') {
                  return;
                }
                try {
                  await sessionService.importSessionShallow(
                    json as ISession,
                    value,
                  );
                  const newSession = (await sessionService.get(value))!;
                  this.curSession = newSession;
                } catch (e) {
                  this.pushMessage('이미 존재하는 프로젝트 이름입니다.');
                }
              },
            });
          }
        };
        if (!this.curSession) {
          await importCool();
        } else {
          this.pushDialog({
            type: 'select',
            text: '프로젝트를 임포트 합니다. 원하시는 방식을 선택해주세요.',
            items: [
              {
                text: '새 프로젝트로 임포트',
                value: 'new-project',
              },
              {
                text: '현재 프로젝트에 씬만 임포트 (⚠️! 씬이 덮어씌워짐)',
                value: 'cur-project',
              },
            ],
            callback: async (option?: string) => {
              if (option === 'new-project') {
                await importCool();
              } else if (option === 'cur-project') {
                const cur = this.curSession!;
                const newJson: ISession = await sessionService.migrate(json);
                for (const key of Object.keys(newJson.scenes)) {
                  if (cur.scenes.has(key)) {
                    cur.scenes.get(key)!.slots = newJson.scenes[key].slots.map(
                      (slot: any) =>
                        slot.map((piece: any) => PromptPiece.fromJSON(piece)),
                    );
                    cur.scenes.get(key)!.resolution =
                      newJson.scenes[key].resolution;
                  } else {
                    const scene = newJson.scenes[key];
                    cur.scenes.set(key, Scene.fromJSON(scene));
                    cur.scenes.get(key)!.mains = [];
                    cur.scenes.get(key)!.game = undefined;
                  }
                }
                appState.pushDialog({
                  type: 'yes-only',
                  text: '씬을 임포트 했습니다',
                });
              }
            },
          });
        }
      };
      if (isValidSession(json)) {
        handleAddSession(json);
      } else if (isValidPieceLibrary(json)) {
        if (!this.curSession) {
          this.pushMessage('세션을 먼저 선택해주세요.');
          return;
        }
        if (!json.version) {
          json = migratePieceLibrary(json);
        }
        if (!(json.name in this.curSession.library)) {
          this.curSession.library.set(json.name, PieceLibrary.fromJSON(json));
          sessionService.reloadPieceLibraryDB(this.curSession);
          this.pushDialog({
            type: 'yes-only',
            text: '조각모음을 임포트 했습니다',
          });
          return;
        }
        this.pushDialog({
          type: 'input-confirm',
          text: '조각그룹을 임포트 합니다. 새 조각그룹 이름을 입력하세요.',
          callback: (value) => {
            if (!value || value === '') {
              return;
            }
            if (this.curSession!.library.has(value)) {
              this.pushMessage('이미 존재하는 조각그룹 이름입니다.');
              return;
            }
            json.name = value;
            this.curSession!.library.set(value, PieceLibrary.fromJSON(json));
          },
        });
      }
    };
  }

  @action
  projectBackupMenu() {
    appState.pushDialog({
      type: 'select',
      text: '메뉴를 선택해주세요',
      items: [
        {
          text: '파일 불러오기',
          value: 'load',
        },
        {
          text: '프로젝트 백업 불러오기',
          value: 'loadDeep',
        },
        {
          text: '프로젝트 파일 내보내기 (이미지 미포함)',
          value: 'save',
        },
        {
          text: '프로젝트 백업 내보내기 (이미지 포함)',
          value: 'saveDeep',
        },
        {
          text: '✏️ 프로젝트 이름 수정',
          value: 'rename',
        },
        {
          text: appState.curSession && sessionService.isFavorite(appState.curSession.name)
            ? '⭐ 즐겨찾기 해제'
            : '⭐ 즐겨찾기 지정',
          value: 'toggleFavorite',
        },
      ],

      callback: async (value) => {
        if (value === 'save') {
          if (appState.curSession) {
            const proj = await sessionService.exportSessionShallow(
              appState.curSession,
            );
            const path = 'exports/' + appState.curSession.name + '.json';
            await backend.writeFile(path, JSON.stringify(proj));
            await backend.showFile(path);
          }
        } else if (value === 'saveDeep') {
          if (appState.curSession) {
            const path = 'exports/' + appState.curSession.name + '.tar';
            if (zipService.isZipping) {
              appState.pushMessage('이미 내보내기 작업이 진행중입니다.');
              return;
            }
            appState.setProgressDialog({
              text: '압축 파일 생성중..',
              done: 0,
              total: 1,
            });
            try {
              await sessionService.exportSessionDeep(appState.curSession, path);
            } catch (e: any) {
              appState.setProgressDialog(undefined);
              return;
            }
            appState.setProgressDialog(undefined);
            appState.pushDialog({
              type: 'yes-only',
              text: '백업이 완료되었습니다.',
            });
            await backend.showFile(path);
            appState.setProgressDialog(undefined);
          }
        } else if (value === 'load') {
          const file = await getFirstFile();
          appState.handleFile(file as any);
        } else if (value === 'rename') {
          if (!appState.curSession) {
            appState.pushMessage('프로젝트를 먼저 선택해주세요');
            return;
          }
          appState.pushDialog({
            type: 'input-confirm',
            text: '새로운 프로젝트 이름을 입력해주세요',
            callback: async (inputValue) => {
              if (!inputValue) return;
              if (sessionService.list().includes(inputValue)) {
                appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
                return;
              }
              const oldName = appState.curSession!.name;
              await imageService.onRenameSession(oldName, inputValue);
              await sessionService.rename(oldName, inputValue);
              appState.curSession!.name = inputValue;
              appState.pushMessage('프로젝트 이름이 변경되었습니다.');
            },
          });
        } else if (value === 'toggleFavorite') {
          if (!appState.curSession) {
            appState.pushMessage('프로젝트를 먼저 선택해주세요');
            return;
          }
          await sessionService.toggleFavorite(appState.curSession.name);
          const isFav = sessionService.isFavorite(appState.curSession.name);
          appState.pushMessage(isFav ? '즐겨찾기에 추가되었습니다' : '즐겨찾기가 해제되었습니다');
        } else {
          appState.pushDialog({
            type: 'input-confirm',
            text: '새로운 프로젝트 이름을 입력해주세요',
            callback: async (inputValue) => {
              if (inputValue) {
                if (inputValue in sessionService.list()) {
                  appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
                  return;
                }
                const tarPath = await backend.selectFile();
                if (tarPath) {
                  appState.setProgressDialog({
                    text: '프로젝트 백업을 불러오는 중입니다...',
                    done: 0,
                    total: 1,
                  });
                  try {
                    await sessionService.importSessionDeep(tarPath, inputValue);
                  } catch (e: any) {
                    appState.setProgressDialog(undefined);
                    appState.pushMessage(e.message);
                    return;
                  }
                  appState.setProgressDialog(undefined);
                  appState.pushDialog({
                    type: 'yes-only',
                    text: '프로젝트 백업을 불러왔습니다.',
                  });
                  const sess = await sessionService.get(inputValue);
                  this.curSession = sess;
                }
              }
            },
          });
        }
      },
    });
  }
  async exportPackage(type: 'scene' | 'inpaint', selected?: GenericScene[]) {
    const exportImpl = async (
      prefix: string,
      fav: boolean,
      opt: string,
      imageSize: number,
      separator: string,
      replaceSpaces: boolean,
    ) => {
      const paths = [];
      await imageService.refreshBatch(this.curSession!);
      const scenes = selected ?? this.curSession!.getScenes(type);
      for (const scene of scenes) {
        await gameService.refreshList(this.curSession!, scene);
        const cands = gameService.getOutputs(this.curSession!, scene);
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
        const sceneName = replaceSpaces ? scene.name.replace(/ /g, '_') : scene.name;
        const finalPrefix = replaceSpaces ? prefix.replace(/ /g, '_') : prefix;
        for (let i = 0; i < images.length; i++) {
          const path = images[i];
          if (images.length === 1) {
            paths.push({
              path:
                imageService.getOutputDir(this.curSession!, scene) + '/' + path,
              name: finalPrefix + sceneName + '.png',
            });
          } else {
            paths.push({
              path:
                imageService.getOutputDir(this.curSession!, scene) + '/' + path,
              name: finalPrefix + sceneName + separator + (i + 1).toString() + '.png',
            });
          }
        }
      }
      if (opt !== 'original') {
        const ext = opt === 'avif' ? '.avif' : '.webp';
        const optimizeMethod = opt === 'lossy'
          ? ImageOptimizeMethod.LOSSY
          : opt === 'avif'
            ? ImageOptimizeMethod.AVIF
            : ImageOptimizeMethod.LOSSLESS;
        try {
          let done = 0;
          for (const item of paths) {
            const outputPath = 'tmp/' + v4() + ext;
            appState.setProgressDialog({
              text: '이미지 크기 최적화 중..',
              done: done,
              total: paths.length,
            });
            await backend.resizeImage({
              inputPath: item.path,
              outputPath: outputPath,
              maxHeight: imageSize,
              maxWidth: imageSize,
              optimize: optimizeMethod,
            });
            item.path = outputPath;
            item.name = item.name.substring(0, item.name.length - 4) + ext;
            done++;
          }
        } catch (e: any) {
          appState.pushMessage(e.message);
          appState.setProgressDialog(undefined);
          return;
        }
      }
      appState.setProgressDialog({
        text: '이미지 압축파일 생성중..',
        done: 0,
        total: 1,
      });
      const outFilePath =
        'exports/' +
        this.curSession!.name +
        '_main_images_' +
        Date.now().toString() +
        '.tar';
      if (zipService.isZipping) {
        appState.pushDialog({
          type: 'yes-only',
          text: '이미 다른 이미지 내보내기가 진행중입니다',
        });
        return;
      }
      try {
        await zipService.zipFiles(paths, outFilePath);
      } catch (e: any) {
        appState.pushMessage(e.message);
        appState.setProgressDialog(undefined);
        return;
      }
      appState.setProgressDialog(undefined);
      appState.pushDialog({
        type: 'yes-only',
        text: '이미지 내보내기가 완료되었습니다',
      });
      await backend.showFile(outFilePath);
      appState.setProgressDialog(undefined);
    };
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

    const optItems = [
      { text: '원본', value: 'original' },
      { text: '저손실 webp 최적화 (에셋용 권장)', value: 'lossy' },
    ];
    if (!isMobile) {
      optItems.push({ text: '무손실 webp 최적화', value: 'lossless' });
    }
    optItems.push({ text: isMobile ? 'AVIF 최적화 (PC 권장)' : 'AVIF 최적화', value: 'avif' });
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
    const separatorInput = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: '파일명 구분자를 입력해주세요 (기본값: .)',
    });
    if (separatorInput === undefined) return;
    const separator = separatorInput || '.';
    const spaceOpt = await appState.pushDialogAsync({
      type: 'select',
      text: '파일명의 띄어쓰기를 언더바(_)로 변환할까요?',
      items: [
        { text: '아니오 (원본 유지)', value: 'no' },
        { text: '예 (띄어쓰기 → _)', value: 'yes' },
      ],
    });
    if (!spaceOpt) return;
    const replaceSpaces = spaceOpt === 'yes';
    if (format === 'normal') {
      await exportImpl('', menu === 'fav', opt, imageSize, separator, replaceSpaces);
    } else {
      appState.pushDialog({
        type: 'input-confirm',
        text: '캐릭터 이름을 입력해주세요',
        callback: async (prefix) => {
          if (!prefix) return;
          await exportImpl(prefix + separator, menu === 'fav', opt, imageSize, separator, replaceSpaces);
        },
      });
    }
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
      const newPngData = embedJSONInPNG(pngData, preset);
      const path =
        'exports/' + preset.name + '_' + Date.now().toString() + '.png';
      await backend.writeDataFile(path, newPngData);
      await backend.showFile(path);
    } catch (e: any) {
      appState.pushMessage('프리셋 내보내기 실패: ' + (e.message || e));
    }
  }

  @action
  openBatchProcessMenu(
    type: 'scene' | 'inpaint',
    setSceneSelector: (item: SceneSelectorItem | undefined) => void,
  ) {
    const removeBg = async (selected: GenericScene[]) => {
      if (!localAIService.ready) {
        appState.pushMessage('환경설정에서 배경 제거 기능을 활성화해주세요');
        return;
      }
      for (const scene of selected) {
        if (scene.mains.length === 0) {
          const images = gameService.getOutputs(this.curSession!, scene);
          if (!images.length) continue;
          let image = await imageService.fetchImage(
            imageService.getOutputDir(this.curSession!, scene) +
              '/' +
              images[0],
          );
          image = dataUriToBase64(image!);
          queueRemoveBg(this.curSession!, scene, image);
        } else {
          const mains = scene.mains;
          for (const main of mains) {
            const path =
              imageService.getOutputDir(this.curSession!, scene) + '/' + main;
            let image = await imageService.fetchImage(path);
            image = dataUriToBase64(image!);
            queueRemoveBg(this.curSession!, scene, image, (newPath: string) => {
              for (let j = 0; scene.mains.length; j++) {
                if (scene.mains[j] === main) {
                  scene.mains[j] = newPath.split('/').pop()!;
                  break;
                }
              }
            });
          }
        }
      }
    };

    const deleteScenes = async (selected: GenericScene[]) => {
      appState.pushDialog({
        type: 'confirm',
        text: `정말로 선택한 ${selected.length}개의 씬을 삭제하시겠습니까? (휴지통으로 이동)`,
        callback: async () => {
          const { trashService } = await import('.');
          for (const scene of selected) {
            await trashService.moveSceneToTrash(this.curSession!, scene);
          }
          appState.pushDialog({
            type: 'yes-only',
            text: `${selected.length}개의 씬이 휴지통으로 이동되었습니다.`,
          });
        },
      });
    };

    const cancelAllReservations = async (selected: GenericScene[]) => {
      let totalCancelled = 0;
      for (const scene of selected) {
        const stats = taskQueueService.statsTasksFromScene(this.curSession!, scene);
        const remaining = stats.total - stats.done;
        totalCancelled += remaining;
        taskQueueService.removeTasksFromScene(scene);
      }
      appState.pushDialog({
        type: 'yes-only',
        text: `${selected.length}개 씬에서 총 ${totalCancelled}개의 예약이 취소되었습니다.`,
      });
    };

    const handleBatchProcess = async (
      value: string,
      selected: GenericScene[],
    ) => {
      const isMain = (scene: GenericScene, path: string) => {
        const filename = path.split('/').pop()!;
        return !!(scene && scene.mains.includes(filename));
      };
      if (value === 'removeImage') {
        appState.pushDialog({
          type: 'select',
          text: '이미지를 삭제합니다. 원하시는 작업을 선택해주세요.',
          items: [
            {
              text: '모든 이미지 삭제',
              value: 'all',
            },
            {
              text: '즐겨찾기 제외 모든 이미지 삭제',
              value: 'fav',
            },
            {
              text: '즐겨찾기 제외 n등 이하 이미지 삭제',
              value: 'n',
            },
          ],
          callback: async (menu) => {
            if (menu === 'all') {
              appState.pushDialog({
                type: 'confirm',
                text: '정말로 모든 이미지를 삭제하시겠습니까?',
                callback: async () => {
                  for (const scene of selected) {
                    const paths = gameService
                      .getOutputs(this.curSession!, scene)
                      .map(
                        (x) =>
                          imageService.getOutputDir(this.curSession!, scene!) +
                          '/' +
                          x,
                      );
                    await deleteImageFiles(this.curSession!, paths, scene);
                  }
                },
              });
            } else if (menu === 'n') {
              appState.pushDialog({
                type: 'input-confirm',
                text: '몇등 이하 이미지를 삭제할지 입력해주세요.',
                callback: async (value) => {
                  if (value) {
                    for (const scene of selected) {
                      const paths = gameService
                        .getOutputs(this.curSession!, scene)
                        .map(
                          (x) =>
                            imageService.getOutputDir(
                              this.curSession!,
                              scene!,
                            ) +
                            '/' +
                            x,
                        );
                      const n = parseInt(value);
                      await deleteImageFiles(
                        this.curSession!,
                        paths.slice(n).filter((x) => !isMain(scene, x)),
                        scene,
                      );
                    }
                  }
                },
              });
            } else if (menu === 'fav') {
              appState.pushDialog({
                type: 'confirm',
                text: '정말로 즐겨찾기 외 모든 이미지를 삭제하시겠습니까?',
                callback: async () => {
                  for (const scene of selected) {
                    const paths = gameService
                      .getOutputs(this.curSession!, scene)
                      .map(
                        (x) =>
                          imageService.getOutputDir(this.curSession!, scene!) +
                          '/' +
                          x,
                      );
                    await deleteImageFiles(
                      this.curSession!,
                      paths.filter((x) => !isMain(scene, x)),
                      scene,
                    );
                  }
                },
              });
            }
          },
        });
      } else if (value === 'changeResolution') {
        const options = Object.entries(resolutionMap)
          .filter((x) => !x[0].includes('small'))
          .map(([key, value]) => {
            return {
              text: `${value.width}x${value.height}`,
              value: key,
            };
          });
        appState.pushDialog({
          type: 'dropdown',
          text: '변경할 해상도를 선택해주세요',
          items: options,
          callback: async (value?: string) => {
            if (!value) return;
            const action = () => {
              for (const scene of selected) {
                scene.resolution = value as Resolution;
              }
            };
            if (value.includes('large') || value.includes('wallpaper')) {
              appState.pushDialog({
                text: 'Anlas를 소모하는 해상도 입니다. 계속하겠습니까?',
                type: 'confirm',
                callback: () => {
                  action();
                },
              });
            } else {
              action();
            }
          },
        });
      } else if (value === 'removeAllFav') {
        appState.pushDialog({
          type: 'confirm',
          text: '정말로 모든 즐겨찾기를 해제하겠습니까?',
          callback: () => {
            for (const scene of selected) {
              scene.mains = [];
            }
          },
        });
      } else if (value === 'setFav') {
        appState.pushDialog({
          type: 'input-confirm',
          text: '몇등까지 즐겨찾기로 지정할지 입력해주세요',
          callback: async (value) => {
            if (value) {
              const n = parseInt(value);
              for (const scene of selected) {
                const cands = gameService
                  .getOutputs(this.curSession!, scene)
                  .slice(0, n);
                scene.mains = scene.mains
                  .concat(cands)
                  .filter((x, i, self) => self.indexOf(x) === i);
              }
            }
          },
        });
      } else if (value === 'removeBg') {
        removeBg(selected);
      } else if (value === 'deleteScenes') {
        deleteScenes(selected);
      } else if (value === 'cancelReservations') {
        cancelAllReservations(selected);
      } else if (value === 'export') {
        this.exportPackage(type, selected);
      } else if (value === 'transform') {
        const items = oneTimeFlows.map((x) => ({
          text: x.text,
          value: x.text,
        }));
        const menu = await appState.pushDialogAsync({
          text: '이미지 변형 방법을 선택하세요',
          type: 'select',
          items: items,
        });
        if (!menu) return;
        const menuItem = oneTimeFlowMap.get(menu)!;
        const input = menuItem.getInput
          ? await menuItem.getInput(this.curSession!)
          : undefined;
        for (const scene of selected) {
          for (let path of scene.mains) {
            path =
              imageService.getOutputDir(this.curSession!, scene) + '/' + path;
            let image = await imageService.fetchImage(path);
            image = dataUriToBase64(image!);
            const job = await extractPromptDataFromBase64(image);
            oneTimeFlowMap
              .get(menu)!
              .handler(
                appState.curSession!,
                scene,
                image,
                undefined,
                job,
                input,
              );
          }
        }
      } else if (value === 'sortScenes') {
        const allScenes = this.curSession!.getScenes(type);
        const selectedSet = new Set(selected.map(s => s.name));
        const selectedSorted = [...selected].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        const indices = allScenes
          .map((s, i) => selectedSet.has(s.name) ? i : -1)
          .filter(i => i !== -1);
        for (let i = 0; i < indices.length; i++) {
          this.curSession!.moveScene(selectedSorted[i], indices[i]);
        }
        appState.pushMessage('씬 정렬 완료');
      } else {
        console.log('Not implemented');
      }
    };

    const openMenu = () => {
      let items = [
        { text: '📁 이미지 내보내기', value: 'export' },
        { text: '🔪 즐겨찾기 이미지 배경 제거', value: 'removeBg' },
        { text: '🔄 즐겨찾기 이미지 변형', value: 'transform' },
        { text: '🗑️ 이미지 삭제', value: 'removeImage' },
        { text: '🖥️ 해상도 변경 ', value: 'changeResolution' },
        { text: '❌ 즐겨찾기 전부 해제', value: 'removeAllFav' },
        { text: '⭐ 상위 n등 즐겨찾기 지정', value: 'setFav' },
        { text: '📋 씬 내용 복제', value: 'copySceneContent' },
        { text: '🗂️ 씬 일괄 삭제', value: 'deleteScenes' },
        { text: '🔤 씬 이름순 정렬', value: 'sortScenes' },
        { text: '⏹️ 예약 일괄 취소', value: 'cancelReservations' },
      ];
      if (isMobile) {
        items = items.filter((x) => x.value !== 'removeBg');
      }
      appState.pushDialog({
        type: 'select',
        text: '선택할 씬들에 적용할 대량 작업을 선택해주세요',
        graySelect: true,
        items: items,
        callback: (value, text) => {
          if (value === 'copySceneContent') {
            const allScenes = this.curSession!.getScenes(type);
            if (allScenes.length < 2) {
              appState.pushMessage('씬이 2개 이상 필요합니다.');
              return;
            }
            appState.pushDialog({
              type: 'dropdown',
              text: '내용을 복사할 원본 씬을 선택해주세요',
              items: allScenes.map((s) => ({ text: s.name, value: s.name })),
              callback: (sourceName) => {
                if (!sourceName) return;
                const sourceScene = allScenes.find((s) => s.name === sourceName);
                if (!sourceScene) return;
                const targetScenes = allScenes.filter((s) => s.name !== sourceName);
                setSceneSelector({
                  type: type,
                  text: `📋 내용 붙여넣기 (원본: ${sourceName})`,
                  scenes: targetScenes,
                  callback: (selected) => {
                    setSceneSelector(undefined);
                    if (selected.length === 0) return;
                    appState.pushDialog({
                      type: 'confirm',
                      text: `원본 '${sourceName}'의 내용을 선택한 ${selected.length}개 씬에 덮어씌우시겠습니까?`,
                      callback: () => {
                        if (sourceScene.type === 'scene' && type === 'scene') {
                          const src = sourceScene as Scene;
                          const srcJSON = src.toJSON();
                          for (const target of selected) {
                            const t = target as Scene;
                            t.slots = srcJSON.slots.map((slot) =>
                              slot.map((piece) => PromptPiece.fromJSON(piece)),
                            );
                            t.meta = new Map(Object.entries(srcJSON.meta ?? {}));
                            t.sceneCharacterPrompts = (srcJSON.sceneCharacterPrompts || []).map((cp) => ({
                              ...cp,
                              enabled: cp.enabled !== false,
                            }));
                            t.useSceneCharacterPrompts = srcJSON.useSceneCharacterPrompts || false;
                            t.sceneCharacterUC = srcJSON.sceneCharacterUC || '';
                          }
                        } else if (sourceScene.type === 'inpaint' && type === 'inpaint') {
                          const src = sourceScene as InpaintScene;
                          const srcJSON = src.toJSON();
                          for (const target of selected) {
                            const t = target as InpaintScene;
                            t.workflowType = srcJSON.workflowType;
                            t.preset = srcJSON.preset && workFlowService.presetFromJSON(srcJSON.preset);
                          }
                        }
                        appState.pushMessage(`${selected.length}개 씬에 내용이 복제되었습니다.`);
                      },
                    });
                  },
                });
              },
            });
            return;
          }
          setSceneSelector({
            type: type,
            text: text!,
            callback: (selected) => {
              setSceneSelector(undefined);
              handleBatchProcess(value!, selected);
            },
          });
        },
      });
    };
    openMenu();
  }

  closeExternalImage() {
    this.externalImage = undefined;
  }

  @action
  setAppliedCharacterPreset(presetName: string | undefined) {
    this.appliedCharacterPreset = presetName;
  }

  @action
  clearAppliedCharacterPreset() {
    if (!this.curSession) return;
    
    const workflowType = this.curSession.selectedWorkflow?.workflowType;
    if (!workflowType) return;
    
    const shared = this.curSession.presetShareds.get(workflowType);
    if (!shared) return;
    
    // 프리셋에서 적용된 값들 초기화
    shared.vibes = [];
    shared.characterReferences = [];
    if (workflowType === 'SDImageGenEasy') {
      shared.characterPrompt = '';
      shared.backgroundPrompt = '';
      shared.uc = '';
    }
    
    this.appliedCharacterPreset = undefined;
    this.pushMessage('캐릭터 프리셋이 해제되었습니다');
  }

  /**
   * 현재 적용된 캐릭터 프리셋 객체를 가져옵니다.
   * @returns 현재 적용된 CharacterPreset 객체 또는 undefined
   */
  getAppliedCharacterPreset(): CharacterPreset | undefined {
    if (!this.curSession || !this.appliedCharacterPreset) {
      return undefined;
    }
    return this.curSession.getCharacterPreset(this.appliedCharacterPreset);
  }

  /**
   * 여러 그림체 파일을 한번에 가져오기
   */
  async importMultiplePresets() {
    if (!this.curSession) {
      this.pushMessage('세션을 먼저 선택해주세요.');
      return;
    }

    const files = await backend.selectFiles({
      filters: [
        { name: 'PNG 이미지', extensions: ['png'] },
        { name: '모든 파일', extensions: ['*'] },
      ],
    });

    if (!files || files.length === 0) {
      return;
    }

    this.setProgressDialog({
      text: '그림체 가져오는 중...',
      done: 0,
      total: files.length,
    });

    const results = {
      success: 0,
      failed: 0,
      failedNames: [] as string[],
    };

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
      
      try {
        // 파일 읽기
        const base64 = await backend.readBinaryFile(filePath);
        
        // 프리셋 가져오기
        const preset = await importPreset(this.curSession!, base64);
        
        if (preset) {
          results.success++;
        } else {
          results.failed++;
          results.failedNames.push(fileName);
        }
      } catch (e: any) {
        console.error(`Failed to import preset from ${fileName}:`, e);
        results.failed++;
        results.failedNames.push(fileName);
      }

      this.setProgressDialog({
        text: '그림체 가져오는 중...',
        done: i + 1,
        total: files.length,
      });
    }

    this.setProgressDialog(undefined);

    // 결과 메시지 표시
    if (results.success > 0 && results.failed === 0) {
      this.pushDialog({
        type: 'yes-only',
        text: `${results.success}개의 그림체를 성공적으로 가져왔습니다.`,
      });
    } else if (results.success > 0 && results.failed > 0) {
      this.pushDialog({
        type: 'yes-only',
        text: `${results.success}개의 그림체를 가져왔습니다.\n${results.failed}개의 파일은 유효한 그림체 파일이 아닙니다:\n${results.failedNames.slice(0, 5).join('\n')}${results.failedNames.length > 5 ? '\n...' : ''}`,
      });
    } else {
      this.pushDialog({
        type: 'yes-only',
        text: '선택한 파일들 중 유효한 그림체 파일이 없습니다.',
      });
    }

    // 첫 번째로 성공한 그림체 선택
    if (results.success > 0) {
      const presets = this.curSession!.presets.get('SDImageGenEasy');
      if (presets && presets.length > 0) {
        const lastPreset = presets[presets.length - 1];
        this.curSession!.selectedWorkflow = {
          workflowType: lastPreset.type,
          presetName: lastPreset.name,
        };
      }
    }
  }
}

export const appState = new AppState();
