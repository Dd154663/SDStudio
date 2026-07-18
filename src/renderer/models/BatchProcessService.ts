import {
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
  templateService,
  trashService,
  workFlowService,
  zipService,
} from '.';
import { platform } from './platform';
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
import type { SceneSelectorItem } from './AppService';

export class BatchProcessService {
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
          const images = gameService.getOutputs(appState.curSession!, scene);
          if (!images.length) continue;
          let image = await imageService.fetchImage(
            imageService.getOutputDir(appState.curSession!, scene) +
              '/' +
              images[0],
          );
          image = dataUriToBase64(image!);
          queueRemoveBg(appState.curSession!, scene, image);
        } else {
          const mains = scene.mains;
          for (const main of mains) {
            const path =
              imageService.getOutputDir(appState.curSession!, scene) + '/' + main;
            let image = await imageService.fetchImage(path);
            image = dataUriToBase64(image!);
            queueRemoveBg(appState.curSession!, scene, image, (newPath: string) => {
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
          for (const scene of selected) {
            await trashService.moveSceneToTrash(appState.curSession!, scene);
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
        const stats = taskQueueService.statsTasksFromScene(appState.curSession!, scene);
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
              const doDel = async () => {
                for (const scene of selected) {
                  const paths = gameService
                    .getOutputs(appState.curSession!, scene)
                    .map(
                      (x) =>
                        imageService.getOutputDir(appState.curSession!, scene!) +
                        '/' +
                        x,
                    );
                  await deleteImageFiles(appState.curSession!, paths, scene);
                }
              };
              if (appState.skipImageDeleteConfirm) { await doDel(); return; }
              appState.pushDialog({
                type: 'confirm',
                text: '정말로 모든 이미지를 삭제하시겠습니까?',
                showSkipConfirm: true,
                callback: doDel,
              });
            } else if (menu === 'n') {
              appState.pushDialog({
                type: 'input-confirm',
                text: '몇등 이하 이미지를 삭제할지 입력해주세요.',
                callback: async (value) => {
                  if (value) {
                    for (const scene of selected) {
                      const paths = gameService
                        .getOutputs(appState.curSession!, scene)
                        .map(
                          (x) =>
                            imageService.getOutputDir(
                              appState.curSession!,
                              scene!,
                            ) +
                            '/' +
                            x,
                        );
                      const n = parseInt(value);
                      await deleteImageFiles(
                        appState.curSession!,
                        paths.slice(n).filter((x) => !isMain(scene, x)),
                        scene,
                      );
                    }
                  }
                },
              });
            } else if (menu === 'fav') {
              const doDel = async () => {
                for (const scene of selected) {
                  const paths = gameService
                    .getOutputs(appState.curSession!, scene)
                    .map(
                      (x) =>
                        imageService.getOutputDir(appState.curSession!, scene!) +
                        '/' +
                        x,
                    );
                  const isMain = (scene: GenericScene, img: string) => {
                    if (!scene.mains) return false;
                    const filename = img.split('/').pop()!;
                    return scene.mains.includes(filename);
                  };
                  await deleteImageFiles(
                    appState.curSession!,
                    paths.filter((x) => !isMain(scene, x)),
                    scene,
                  );
                }
              };
              if (appState.skipImageDeleteConfirm) { await doDel(); return; }
              appState.pushDialog({
                type: 'confirm',
                text: '정말로 즐겨찾기 외 모든 이미지를 삭제하시겠습니까?',
                showSkipConfirm: true,
                callback: doDel,
              });
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
                  .getOutputs(appState.curSession!, scene)
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
        appState.exportPackage(type, selected);
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
          ? await menuItem.getInput(appState.curSession!)
          : undefined;
        for (const scene of selected) {
          for (let path of scene.mains) {
            path =
              imageService.getOutputDir(appState.curSession!, scene) + '/' + path;
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
      } else if (value === 'exportSceneNames') {
        // 씬 이름에서 특수문자 구분자 감지
        const specialCharRegex = /[^a-zA-Z0-9가-힣ぁ-んァ-ヶ一-龥\u3000-\u303F]/g;
        const detectedChars = new Set<string>();
        for (const s of selected) {
          const matches = s.name.match(specialCharRegex);
          if (matches) matches.forEach((c) => detectedChars.add(c));
        }

        let charsToReplace = new Set<string>();
        let replacement = '_';
        if (detectedChars.size > 0) {
          const replacementInput = await appState.pushDialogAsync({
            type: 'input-confirm',
            text: '씬 이름의 특수문자를 변환할 대체 문자를 입력해주세요 (기본값: _)',
          });
          if (replacementInput === undefined) return;
          replacement = replacementInput || '_';

          const items = Array.from(detectedChars).map((c) => ({
            text: c === ' ' ? '띄어쓰기' : `"${c}"`,
            value: c,
          }));
          const result = await appState.pushDialogAsync({
            type: 'checkbox',
            text: `씬 이름에서 감지된 특수문자입니다.\n"${replacement}" 로 변환할 문자를 선택해주세요:`,
            items: items,
          });
          if (result === undefined) return;
          try {
            charsToReplace = new Set(JSON.parse(result));
          } catch (e) {
            // 파싱 실패 시 변환 없음
          }
        }

        let names: string;
        if (charsToReplace.size > 0) {
          const escaped = Array.from(charsToReplace).map(
            (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          ).join('|');
          const regex = new RegExp(`(${escaped})+`, 'g');
          names = selected.map((s) => s.name.replace(regex, replacement)).join(', ');
        } else {
          names = selected.map((s) => s.name).join(', ');
        }
        const path = 'exports/scene_names_' + Date.now().toString() + '.txt';
        await backend.writeFile(path, names);
        await backend.showFile(path);
        appState.pushMessage(`${selected.length}개 씬 이름을 내보냈습니다.`);
      } else if (value === 'sortScenes') {
        const allScenes = appState.curSession!.getScenes(type);
        const selectedSet = new Set(selected.map(s => s.name));
        const selectedSorted = [...selected].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        const indices = allScenes
          .map((s, i) => selectedSet.has(s.name) ? i : -1)
          .filter(i => i !== -1);
        for (let i = 0; i < indices.length; i++) {
          appState.curSession!.moveScene(selectedSorted[i], indices[i]);
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
        { text: '❌ 즐겨찾기 전부 해제', value: 'removeAllFav' },
        { text: '⭐ 상위 n등 즐겨찾기 지정', value: 'setFav' },
        { text: '📋 씬 내용 복제', value: 'copySceneContent' },
        { text: '📦 다른 프로젝트로 씬 복사', value: 'copyToProject' },
        { text: '📝 씬 이름 내보내기', value: 'exportSceneNames' },
        { text: '🗂️ 씬 일괄 삭제', value: 'deleteScenes' },
        { text: '🔤 씬 이름순 정렬', value: 'sortScenes' },
        { text: '⏹️ 예약 일괄 취소', value: 'cancelReservations' },
      ];
      if (type === 'inpaint') {
        items.push({ text: '🪞 이미지생성 탭 씬 이미지미러로 복제', value: 'mirrorDuplicate' });
      }
      if (!platform.supportsRemoveBg) {
        items = items.filter((x) => x.value !== 'removeBg');
      }
      appState.pushDialog({
        type: 'select',
        text: '선택할 씬들에 적용할 대량 작업을 선택해주세요',
        graySelect: true,
        items: items,
        callback: (value, text) => {
          if (value === 'mirrorDuplicate') {
            const imageGenScenes = appState.curSession!.getScenes('scene');
            if (imageGenScenes.length === 0) {
              appState.pushMessage('이미지생성 씬이 없습니다.');
              return;
            }
            setSceneSelector({
              type: 'inpaint',
              text: '🪞 미러로 복제할 이미지생성 씬 선택',
              scenes: imageGenScenes,
              callback: (selected) => {
                setSceneSelector(undefined);
                if (selected.length === 0) return;
                appState.pushDialog({
                  type: 'confirm',
                  text: `선택한 ${selected.length}개 씬을 이미지미러 씬으로 복제하시겠습니까?`,
                  callback: () => {
                    let count = 0;
                    for (const scene of selected) {
                      const src = scene as Scene;
                      const srcJSON = src.toJSON();
                      // 이름 충돌 해결
                      let name = src.name;
                      if (appState.curSession!.hasScene('inpaint', name)) {
                        let i = 1;
                        while (
                          appState.curSession!.hasScene('inpaint', `${name}_${i}`)
                        )
                          i++;
                        name = `${name}_${i}`;
                      }
                      // SDMirror 프리셋 생성 + 중위 프롬프트 동기화
                      const preset =
                        workFlowService.buildPreset('SDMirror');
                      if (
                        srcJSON.slots.length > 0 &&
                        srcJSON.slots[0].length > 0
                      ) {
                        preset.prompt = srcJSON.slots[0][0].prompt;
                      }
                      const newScene = InpaintScene.fromJSON({
                        type: 'inpaint',
                        name,
                        workflowType: 'SDMirror',
                        preset: preset.toJSON(),
                        resolution: 'portrait',
                        mains: [],
                        imageMap: [],
                        round: undefined,
                        game: undefined,
                        slots: srcJSON.slots,
                      });
                      if (newScene) {
                        appState.curSession!.addScene(newScene);
                        count++;
                      }
                    }
                    appState.pushMessage(
                      `${count}개 씬이 이미지미러로 복제되었습니다.`,
                    );
                  },
                });
              },
            });
            return;
          }
          if (value === 'copySceneContent') {
            const allScenes = appState.curSession!.getScenes(type);
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
          if (value === 'copyToProject') {
            const curName = appState.curSession!.name;
            // 숨김 씬 템플릿 제외 (씬 템플릿 개편 2026-07-18)
            const allProjects = templateService
              .filterVisibleProjects(sessionService.list())
              .filter((n) => n !== curName);
            if (allProjects.length === 0) {
              appState.pushMessage('복사할 다른 프로젝트가 없습니다');
              return;
            }
            setSceneSelector({
              type: type,
              text: '📦 다른 프로젝트로 복사할 씬 선택',
              callback: (selected) => {
                setSceneSelector(undefined);
                if (selected.length === 0) return;

                appState.pushDialog({
                  text: '씬을 복사할 프로젝트를 선택하세요',
                  type: 'dropdown',
                  items: allProjects.map((n) => ({ text: n, value: n })),
                  callback: (targetName) => {
                    if (!targetName) return;

                    appState.pushDialog({
                      text: '복사 방식을 선택하세요',
                      type: 'select',
                      items: [
                        { text: '설정만 복사 (슬롯, 프롬프트 등)', value: 'config' },
                        { text: '이미지 포함 복사', value: 'with-images' },
                      ],
                      callback: async (mode) => {
                        if (!mode) return;

                        const targetSession = await sessionService.get(targetName);
                        if (!targetSession) {
                          appState.pushMessage('프로젝트를 불러올 수 없습니다');
                          return;
                        }

                        let totalCopied = 0;
                        let totalImages = 0;
                        for (const scene of selected) {
                          // 살아있는 씬의 toJSON() 재역직렬화라 null 이 나올 수 없다
                          const newScene = genericSceneFromJSON(scene.toJSON())!;
                          let cnt = 0;
                          const baseName = newScene.name;
                          const newNameFn = () => baseName + (cnt === 0 ? '' : '_' + cnt);
                          while (targetSession.hasScene(newScene.type, newNameFn())) {
                            cnt++;
                          }
                          newScene.name = newNameFn();

                          if (mode === 'config') {
                            newScene.imageMap = [];
                            newScene.mains = [];
                          }

                          targetSession.addScene(newScene);

                          if (mode === 'with-images' && scene.imageMap.length > 0) {
                            const srcDir = imageService.getOutputDir(appState.curSession!, scene);
                            const dstDir = imageService.getOutputDir(targetSession, newScene);
                            for (const img of scene.imageMap) {
                              try {
                                await backend.copyFile(srcDir + '/' + img, dstDir + '/' + img);
                                totalImages++;
                              } catch (e) {
                                console.error('이미지 복사 실패:', img, e);
                              }
                            }
                          }
                          totalCopied++;
                        }

                        const msg = mode === 'with-images'
                          ? `${totalCopied}개 씬이 "${targetName}" 프로젝트에 복사되었습니다 (이미지 ${totalImages}장)`
                          : `${totalCopied}개 씬이 "${targetName}" 프로젝트에 복사되었습니다`;
                        appState.pushMessage(msg);
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

  openChangeResolutionMenu(
    type: 'scene' | 'inpaint',
    setSceneSelector: (item: SceneSelectorItem | undefined) => void,
  ) {
    setSceneSelector({
      type: type,
      text: '🖥️ 해상도 변경할 씬 선택',
      callback: async (selected) => {
        setSceneSelector(undefined);
        if (selected.length === 0) return;
        const options = Object.entries(resolutionMap)
          .filter((x) => !x[0].includes('small'))
          .map(([key, value]) => {
            if (key === 'custom')
              return { text: '커스텀 (직접 입력)', value: key };
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
            if (value === 'custom') {
              const width = await appState.pushDialogAsync({
                type: 'input-confirm',
                text: '해상도 너비를 입력해주세요',
              });
              if (width == null) return;
              const height = await appState.pushDialogAsync({
                type: 'input-confirm',
                text: '해상도 높이를 입력해주세요',
              });
              if (height == null) return;
              try {
                const w = (parseInt(width) + 63) & ~63;
                const h = (parseInt(height) + 63) & ~63;
                for (const scene of selected) {
                  scene.resolution = 'custom' as Resolution;
                  scene.resolutionWidth = w;
                  scene.resolutionHeight = h;
                }
              } catch (e: any) {
                appState.pushMessage(e.message);
              }
              return;
            }
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
      },
    });
  }

  // WebP 일괄 변환 confirm 공통 문구. 원본 처리(데스크톱=OS 휴지통 이동/모바일=삭제)와
  // 모바일 부하 경고를 플랫폼에 맞게 안내한다.
  private webpConfirmText(head: string, quality: number): string {
    const origin = platform.isMobile
      ? '원본 PNG는 삭제됩니다.'
      : '원본 PNG는 복구 가능한 휴지통으로 이동합니다.';
    const warn = platform.isMobile
      ? '\n⚠ 모바일에서는 기기 사양에 따라 부하가 크고 매우 오래 걸릴 수 있습니다. 변환 중 취소하면 그때까지 변환된 분량은 안전하게 저장됩니다.'
      : '';
    return `${head}(품질 ${quality})로 변환합니다.\n프롬프트 메타데이터는 보존되며, ${origin}${warn} 계속할까요?`;
  }

  // 생성 이미지 PNG → WebP 일괄 변환 (사후 변환).
  // 프롬프트 메타데이터는 보존된다(데스크톱=EXIF 이월+스텔스, 모바일=스텔스 유지).
  openConvertToWebpMenu(
    type: 'scene' | 'inpaint',
    setSceneSelector: (item: SceneSelectorItem | undefined) => void,
  ) {
    if (!platform.supportsWebpConvert) {
      appState.pushMessage('이 플랫폼에서는 WebP 변환을 지원하지 않습니다.');
      return;
    }
    setSceneSelector({
      type: type,
      text: '🗜️ WebP로 변환할 씬 선택',
      callback: async (selected) => {
        setSceneSelector(undefined);
        if (selected.length === 0) return;

        const qInput = await appState.pushDialogAsync({
          type: 'input-confirm',
          text: 'WebP 품질을 입력해주세요 (1~100, 기본 80)',
        });
        if (qInput === undefined) return;
        let quality = 80;
        const q = parseInt(qInput);
        if (!isNaN(q) && q >= 1 && q <= 100) quality = q;

        appState.pushDialog({
          type: 'confirm',
          text: this.webpConfirmText(
            `선택한 ${selected.length}개 씬의 PNG 이미지를 WebP`,
            quality,
          ),
          callback: async () => {
            await this.runWebpConversion(appState.curSession!, selected, quality);
          },
        });
      },
    });
  }

  // 프로젝트 단위 WebP 즉시 최적화 (저장 공간 관리 모달, 데스크톱 전용).
  // 열려 있지 않은 프로젝트도 sessionService.get 으로 정식 로드해 씬 데이터 참조
  // (imageMap/mains/game)까지 갱신하는 동일 변환 경로를 태운다. 타 창이 락을 보유한
  // 프로젝트와 읽기 전용 미러는 차단(파일만 바꾸면 소유 창 세션과 어긋난다).
  async openProjectWebpOptimize(name: string) {
    if (!platform.supportsWebpConvert) {
      appState.pushMessage('이 플랫폼에서는 WebP 변환을 지원하지 않습니다.');
      return;
    }
    if (sessionService.isMirror(name)) {
      appState.pushMessage(
        '읽기 전용 미러로 열린 프로젝트는 최적화할 수 없습니다.',
      );
      return;
    }
    if (!(await sessionService.guardCrossWindowLock(name, 'WebP 최적화')))
      return;

    const qInput = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: 'WebP 품질을 입력해주세요 (1~100, 기본 80)',
    });
    if (qInput === undefined) return;
    let quality = 80;
    const q = parseInt(qInput);
    if (!isNaN(q) && q >= 1 && q <= 100) quality = q;

    appState.pushDialog({
      type: 'confirm',
      text: this.webpConfirmText(
        `프로젝트 [${name}]의 모든 PNG 이미지(씬+인페인트)를 WebP`,
        quality,
      ),
      callback: async () => {
        const session = await sessionService.get(name);
        if (!session) {
          appState.pushMessage('프로젝트를 불러오지 못했습니다.');
          return;
        }
        const selected: GenericScene[] = [
          ...session.scenes.values(),
          ...session.inpaints.values(),
        ];
        await this.runWebpConversion(session, selected, quality);
        // 절약된 용량이 바로 보이도록 크기 재계산 (실패해도 무시)
        void projectSizeService.calculate(name);
      },
    });
  }

  private async runWebpConversion(
    session: Session,
    selected: GenericScene[],
    quality: number,
  ) {
    await imageService.refreshBatch(session);
    await Promise.allSettled(
      selected.map((s) => gameService.refreshList(session, s)),
    );

    // 씬별 PNG 목록 → 평탄 작업 리스트(병렬 소진용). dir/webp 를 미리 계산.
    interface WebpTask {
      scene: GenericScene;
      dir: string;
      png: string;
      webp: string;
    }
    const tasks: WebpTask[] = [];
    for (const scene of selected) {
      const dir = imageService.getOutputDir(session, scene);
      const pngs = gameService
        .getOutputs(session, scene)
        .filter((c) => c.toLowerCase().endsWith('.png'));
      for (const png of pngs) {
        tasks.push({ scene, dir, png, webp: png.replace(/\.png$/i, '.webp') });
      }
    }
    const total = tasks.length;
    if (total === 0) {
      appState.pushMessage('변환할 PNG 이미지가 없습니다.');
      return;
    }

    // 씬별 성공 rename(png→webp) 맵. 병렬 변환 중에는 씬 객체를 건드리지 않고
    // 여기에만 쌓았다가 루프 후 씬당 1회 일괄 반영한다 — 동시 변이로 인한
    // MobX 재렌더 폭주를 막고(파일당 N회 → 씬당 1회) 갱신 순서를 명확히 한다.
    const renames = new Map<GenericScene, Map<string, string>>();
    for (const s of selected) renames.set(s, new Map());

    let done = 0;
    let fail = 0;
    let skipped = 0;
    // 중간 취소(특히 모바일 — 일괄 변환이 매우 오래 걸릴 수 있음): 플래그만 세우고
    // 남은 작업을 스킵으로 소진한다. 이미 변환된 분량은 아래 rename 일괄 반영을
    // 그대로 거치므로 데이터 참조가 깨지지 않는다(진행분 안전 저장 후 중단).
    let cancelled = false;
    const updateProgress = () => {
      appState.setProgressDialog({
        text: cancelled
          ? 'WebP 변환 취소 중... (진행분 마무리)'
          : 'WebP 변환 중...',
        done,
        total,
        onCancel: cancelled
          ? undefined
          : () => {
              cancelled = true;
              updateProgress();
            },
      });
    };
    updateProgress();

    // 내보내기 최적화와 동일한 동시성(공유 runPool + exportConcurrency). 순차(1장씩)
    // → 최대 4장 병렬. Phase 2 에서 상한을 코어 수로 올리면 이 한 곳이 함께 상향된다.
    const config = await backend.getConfig();
    const CONCURRENCY = Math.max(
      1,
      Math.min(
        platform.maxImageConcurrency,
        config.exportConcurrency ?? platform.exportConcurrency,
      ),
    );

    await runPool(tasks, CONCURRENCY, async (task) => {
      if (cancelled) {
        skipped++;
        done++;
        return;
      }
      const { scene, dir, png, webp } = task;
      try {
        await backend.convertToWebp(dir + '/' + png, dir + '/' + webp, quality);
        renames.get(scene)!.set(png, webp);
        // 원본 PNG 제거(데스크톱=OS 휴지통 이동, 모바일=삭제 — trashFile 의미)
        await backend.trashFile(dir + '/' + png);
        await imageService.invalidateCache(dir + '/' + png);
      } catch (e: any) {
        fail++;
        console.error('WebP 변환 실패:', dir + '/' + png, e?.message || e);
      }
      done++;
      updateProgress();
    });

    // 씬 데이터의 파일명 참조 3곳(imageMap/mains/game) 일괄 갱신 — 누락 시
    // 이미지 유실/즐겨찾기·랭킹 깨짐. 성공한 변환만 반영(실패분은 원본 png 유지).
    for (const scene of selected) {
      const map = renames.get(scene)!;
      if (map.size === 0) continue;
      scene.imageMap = scene.imageMap.map((x) => map.get(x) ?? x);
      scene.mains = scene.mains.map((x) => map.get(x) ?? x);
      if (scene.game) {
        for (const player of scene.game) {
          const w = map.get(player.path);
          if (w) player.path = w;
        }
      }
    }

    appState.setProgressDialog(undefined);
    await imageService.refreshBatch(session);
    await Promise.allSettled(
      selected.map((s) => gameService.refreshList(session, s)),
    );
    const success = done - fail - skipped;
    appState.pushMessage(
      cancelled
        ? `WebP 변환 취소됨: ${success}개 변환 저장, ${skipped}개 중단${fail ? `, ${fail}개 실패(원본 유지)` : ''}`
        : `WebP 변환 완료: ${success}개 성공${fail ? `, ${fail}개 실패(원본 유지)` : ''}`,
    );
  }
}
