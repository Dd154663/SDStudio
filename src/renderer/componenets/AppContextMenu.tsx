import { observer } from 'mobx-react-lite';
import { getSnapshot } from 'mobx-state-tree';
import { Item, Menu, Separator } from 'react-contexify';
import { sessionService, backend, imageService, isMobile, imageDownloadService } from '../models';
import { appState } from '../models/AppService';
import { dataUriToBase64, deleteImageFiles } from '../models/ImageService';
import { createImageWithText, embedJSONInPNG } from '../models/SessionService';
import {
  SceneContextAlt,
  ImageContextAlt,
  StyleContextAlt,
  ContextMenuType,
  genericSceneFromJSON,
  GallaryImageContextAlt,
  GenericScene,
} from '../models/types';
import { oneTimeFlowMap, oneTimeFlows } from '../models/workflows/OneTimeFlows';
import { extractPromptDataFromBase64 } from '../models/util';
import {
  addScenesToQueue,
  removeScenesFromQueue,
} from '../models/sceneQueueActions';

export const AppContextMenu = observer(() => {
  const duplicateScene = async (ctx: SceneContextAlt) => {
    const newScene = genericSceneFromJSON(ctx.scene.toJSON());
    let cnt = 0;
    const newName = () =>
      newScene.name + '_copy' + (cnt === 0 ? '' : cnt.toString());
    while (appState.curSession!.hasScene(newScene.type, newName())) {
      cnt++;
    }
    newScene.name = newName();
    appState.curSession!.addScene(newScene);
  };
  const moveSceneFront = (ctx: SceneContextAlt) => {
    const curSession = appState.curSession;
    curSession!.moveScene(ctx.scene, 0);
  };
  const moveSceneBack = (ctx: SceneContextAlt) => {
    const curSession = appState.curSession;
    curSession!.moveScene(ctx.scene, curSession!.scenes.size - 1);
  };
  const copySceneToProject = async (ctx: SceneContextAlt) => {
    await copyScenesToProject([ctx.scene]);
  };

  const copyScenesToProject = async (scenes: GenericScene[]) => {
    const session = appState.curSession;
    if (!session || scenes.length === 0) return;
    const curName = session.name;
    const allProjects = sessionService.list().filter((n) => n !== curName);
    if (allProjects.length === 0) {
      appState.pushMessage('복사할 다른 프로젝트가 없습니다');
      return;
    }

    const countLabel = scenes.length > 1 ? `선택한 ${scenes.length}개 씬을` : '씬을';

    // 1) 대상 프로젝트 선택
    const targetName = await appState.pushDialogAsync({
      text: `${countLabel} 복사할 프로젝트를 선택하세요`,
      type: 'dropdown',
      items: allProjects.map((n) => ({ text: n, value: n })),
    });
    if (!targetName) return;

    // 2) 복사 모드 선택
    const mode = await appState.pushDialogAsync({
      text: '복사 방식을 선택하세요',
      type: 'select',
      items: [
        { text: '설정만 복사 (슬롯, 프롬프트 등)', value: 'config' },
        { text: '이미지 포함 복사', value: 'with-images' },
      ],
    });
    if (!mode) return;

    // 3) 대상 세션 로드
    const targetSession = await sessionService.get(targetName);
    if (!targetSession) {
      appState.pushMessage('프로젝트를 불러올 수 없습니다');
      return;
    }

    let totalCopiedImages = 0;
    let successCount = 0;

    for (const srcScene of scenes) {
      // 4) 씬 복제
      const newScene = genericSceneFromJSON(srcScene.toJSON());
      if (!newScene) continue;
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
        targetSession.addScene(newScene);
        successCount++;
      } else {
        const srcDir = imageService.getOutputDir(session, srcScene);
        const dstDir = imageService.getOutputDir(targetSession, newScene);
        targetSession.addScene(newScene);

        const allImages = [...srcScene.imageMap];
        let copied = 0;
        for (const img of allImages) {
          try {
            await backend.copyFile(srcDir + '/' + img, dstDir + '/' + img);
            copied++;
          } catch (e) {
            console.error('이미지 복사 실패:', img, e);
          }
        }
        totalCopiedImages += copied;
        successCount++;
      }
    }

    if (successCount > 1) {
      const imgMsg = mode === 'with-images' ? ` (이미지 ${totalCopiedImages}장)` : '';
      appState.pushMessage(`${successCount}개 씬을 "${targetName}" 프로젝트에 복사했습니다${imgMsg}`);
    } else if (successCount === 1) {
      const imgMsg = mode === 'with-images' ? ` (이미지 ${totalCopiedImages}장)` : '';
      appState.pushMessage(`씬을 "${targetName}" 프로젝트에 복사했습니다${imgMsg}`);
    }
  };

  const handleSceneItemClick = ({ id, props }: any) => {
    const ctx = props.ctx as SceneContextAlt;
    if (id === 'duplicate') {
      duplicateScene(ctx);
    } else if (id === 'copy-to-project') {
      const selectedNames = appState.selectedScenes;
      if (selectedNames.size > 1) {
        const session = appState.curSession;
        if (session) {
          const selectedScenes: GenericScene[] = [];
          for (const name of selectedNames) {
            const scene = session.scenes.get(name) || session.inpaints.get(name);
            if (scene) selectedScenes.push(scene);
          }
          if (selectedScenes.length > 0) {
            copyScenesToProject(selectedScenes);
            return;
          }
        }
      }
      copySceneToProject(ctx);
    } else if (id === 'move-front') {
      moveSceneFront(ctx);
    } else if (id === 'move-back') {
      moveSceneBack(ctx);
    } else if (id === 'delete') {
      const selectedNames = appState.selectedScenes;
      if (selectedNames.size > 1) {
        appState.pushDialog({
          type: 'confirm',
          text: `선택한 ${selectedNames.size}개 씬을 삭제할까요? (휴지통으로 이동)`,
          callback: async () => {
            const { trashService } = await import('../models');
            const session = appState.curSession;
            if (!session) return;
            for (const name of selectedNames) {
              const scene = session.scenes.get(name) || session.inpaints.get(name);
              if (scene) {
                try { await trashService.moveSceneToTrash(session, scene); } catch (e) {}
              }
            }
            appState.clearSceneSelection();
          },
        });
      } else {
        appState.pushDialog({
          type: 'confirm',
          text: '정말로 삭제하시겠습니까? (휴지통으로 이동)',
          callback: async () => {
            const { trashService } = await import('../models');
            await trashService.moveSceneToTrash(appState.curSession!, ctx.scene);
          },
        });
      }
    } else if (id === 'delete-all-selected-images') {
      deleteAllImagesFromSelected(false);
    } else if (id === 'delete-all-selected-images-except-fav') {
      deleteAllImagesFromSelected(true);
    } else if (id === 'queue-add-all-or-selected') {
      const session = appState.curSession;
      if (session) {
        addScenesToQueue(
          session,
          ctx.scene.type,
          appState.selectedScenes.size > 0,
        );
      }
    } else if (id === 'queue-remove-all-or-selected') {
      const session = appState.curSession;
      if (session) {
        removeScenesFromQueue(
          session,
          ctx.scene.type,
          appState.selectedScenes.size > 0,
        );
      }
    }
  };
  const deleteAllImagesFromSelected = async (excludeFav: boolean) => {
    const session = appState.curSession;
    if (!session) return;
    const selectedNames = appState.selectedScenes;
    if (selectedNames.size === 0) {
      appState.pushMessage('선택된 씬이 없습니다.');
      return;
    }

    const scenes: { scene: any; paths: string[] }[] = [];
    let totalImages = 0;

    for (const name of selectedNames) {
      const scene = session.scenes.get(name) || session.inpaints.get(name);
      if (!scene) continue;
      if (!scene.imageMap || scene.imageMap.length === 0) continue;

      const dir = imageService.getOutputDir(session, scene);
      let paths = scene.imageMap.map((img: string) => dir + '/' + img);

      if (excludeFav && scene.mains) {
        const favs = new Set(scene.mains);
        paths = paths.filter((p: string) => {
          const filename = p.split('/').pop()!;
          return !favs.has(filename);
        });
      }

      if (paths.length > 0) {
        scenes.push({ scene, paths });
        totalImages += paths.length;
      }
    }

    if (totalImages === 0) {
      appState.pushMessage('삭제할 이미지가 없습니다.');
      return;
    }

    const label = excludeFav ? '즐겨찾기 제외 ' : '';
    const doBatchDelete = async () => {
      appState.setProgressDialog({ text: '이미지 삭제 중...', done: 0, total: scenes.length });
      let done = 0;
      for (const { scene, paths } of scenes) {
        try {
          await deleteImageFiles(session, paths, scene);
        } catch (e) {
          console.error('이미지 삭제 실패:', e);
        }
        appState.setProgressDialog({ text: '이미지 삭제 중...', done: ++done, total: scenes.length });
      }
      appState.setProgressDialog(undefined);
      appState.pushMessage(`${scenes.length}개 씬에서 ${totalImages}장의 이미지를 삭제했습니다.`);
    };
    if (appState.skipImageDeleteConfirm) {
      await doBatchDelete();
      return;
    }
    appState.pushDialog({
      type: 'confirm',
      text: `${selectedNames.size}개 씬에서 ${label}${totalImages}장의 이미지를 삭제할까요?`,
      showSkipConfirm: true,
      callback: doBatchDelete,
    });
  };
  const duplicateImage = async (ctx: GallaryImageContextAlt) => {
    if (!ctx.scene) return;
    for (const path of ctx.path) {
      const tmp = path.slice(0, path.lastIndexOf('/'));
      // 원본 확장자 보존(webp/png) — 고정 .png 로 복제하면 내용/확장자 불일치
      const ext = path.split('.').pop() || 'png';
      await backend.copyFile(path, tmp + '/' + Date.now().toString() + '.' + ext);
    }
    imageService.refresh(appState.curSession!, ctx.scene);
    appState.pushDialog({
      type: 'yes-only',
      text: '이미지를 복제했습니다',
    });
  };
  const copyImage = (ctx: GallaryImageContextAlt) => {
    appState.pushDialog({
      type: 'dropdown',
      text: '이미지를 어디에 복사할까요?',
      items: Array.from(appState.curSession!.scenes.keys()).map((key) => ({
        text: key,
        value: key,
      })),
      callback: async (value) => {
        if (!value) return;

        const scene = appState.curSession!.scenes.get(value);
        if (!scene) {
          return;
        }

        for (const path of ctx.path) {
          await backend.copyFile(
            path,
            imageService.getImageDir(appState.curSession!, scene) +
              '/' +
              Date.now().toString() +
              '.png',
          );
        }
        imageService.refresh(appState.curSession!, scene);
        appState.pushDialog({
          type: 'yes-only',
          text: '이미지를 복사했습니다',
        });
      },
    });
  };
  const clipboardImage = async (ctx: GallaryImageContextAlt) => {
    await backend.copyImageToClipboard(ctx.path[0]);
  };
  const favImage = (ctx: GallaryImageContextAlt) => {
    if (!ctx.scene) return;
    for (const path_ of ctx.path) {
      const path = path_.split('/').pop()!;
      if (ctx.scene.mains.includes(path)) {
        ctx.scene.mains.splice(ctx.scene.mains.indexOf(path), 1);
      } else {
        ctx.scene.mains.push(path);
      }
    }
  };
  const deleteImg = async (ctx: GallaryImageContextAlt) => {
    const doDelete = async () => {
      await deleteImageFiles(appState.curSession!, ctx.path, ctx.scene);
    };
    if (appState.skipImageDeleteConfirm) {
      await doDelete();
      return;
    }
    appState.pushDialog({
      type: 'confirm',
      text: '정말로 삭제하시겠습니까?',
      showSkipConfirm: true,
      callback: doDelete,
    });
  };
  const downloadImage = async (ctx: GallaryImageContextAlt) => {
    if (!ctx.scene) return;
    const characterPreset = appState.getAppliedCharacterPreset();
    if (ctx.path.length === 1) {
      // 단일 이미지 다운로드
      await imageDownloadService.downloadSingleImage(
        appState.curSession!,
        ctx.scene,
        ctx.path[0],
        characterPreset,
      );
    } else {
      // 다중 이미지 다운로드
      await imageDownloadService.downloadMultipleImages(
        appState.curSession!,
        ctx.scene,
        ctx.path,
        characterPreset,
      );
    }
  };
  const transformImage = async (ctx: GallaryImageContextAlt) => {
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
    for (const p of ctx.path) {
      let image = await imageService.fetchImage(p);
      image = dataUriToBase64(image!);
      const job = await extractPromptDataFromBase64(image);
      menuItem.handler(
        appState.curSession!,
        ctx.scene!,
        image,
        undefined,
        job,
        input,
      );
    }
  };
  const saveImageAsGlobalPreset = async (ctx: any) => {
    const path = Array.isArray(ctx.path) ? ctx.path[0] : ctx.path;
    if (!path) return;
    await appState.saveImageAsGlobalPreset(path);
  };
  const saveImageToArtistLibrary = async (ctx: any) => {
    const path = Array.isArray(ctx.path) ? ctx.path[0] : ctx.path;
    if (!path) return;
    await appState.saveImageToArtistLibrary(path);
  };
  const handleImageItemClick = ({ id, props }: any) => {
    const ctx2: GallaryImageContextAlt = {
      ...props.ctx,
      type: 'gallary_image',
      path: [props.ctx.path],
    };
    if (id === 'duplicate') {
      duplicateImage(ctx2);
    } else if (id === 'copy') {
      copyImage(ctx2);
    } else if (id === 'clipboard') {
      clipboardImage(ctx2);
    } else if (id === 'fav') {
      favImage(ctx2);
    } else if (id === 'delete') {
      deleteImg(ctx2);
    } else if (id === 'download') {
      downloadImage(ctx2);
    } else if (id === 'save-global') {
      saveImageAsGlobalPreset(ctx2);
    } else if (id === 'save-artist') {
      saveImageToArtistLibrary(ctx2);
    }
  };
  const handleImageItemClick2 = ({ id, props }: any) => {
    if (id === 'duplicate') {
      duplicateImage(props.ctx);
    } else if (id === 'copy') {
      copyImage(props.ctx);
    } else if (id === 'clipboard') {
      clipboardImage(props.ctx);
    } else if (id === 'fav') {
      favImage(props.ctx);
    } else if (id === 'delete') {
      deleteImg(props.ctx);
    } else if (id === 'transform') {
      transformImage(props.ctx);
    } else if (id === 'download') {
      downloadImage(props.ctx);
    } else if (id === 'save-global') {
      saveImageAsGlobalPreset(props.ctx);
    } else if (id === 'save-artist') {
      saveImageToArtistLibrary(props.ctx);
    }
  };
  const exportStyle = async (ctx: StyleContextAlt) => {
    await appState.exportPreset(appState.curSession!, ctx.preset);
  };
  const deleteStyle = async (ctx: StyleContextAlt) => {
    appState.pushDialog({
      type: 'confirm',
      text: '정말로 삭제하시겠습니까?',
      callback: async () => {
        const curSession = appState.curSession;
        const presets = appState.curSession!.presets.get(ctx.preset.type)!;
        if (presets.length === 1) {
          appState.pushMessage('그림체는 최소 한 개 이상이어야 합니다');
          return;
        }
        curSession!.removePreset(ctx.preset.type, ctx.preset.name);
      },
    });
  };
  const editStyle = async (ctx: StyleContextAlt) => {
    sessionService.styleEdit(ctx.preset, ctx.container);
  };
  const handleStyleItemClick = ({ id, props }: any) => {
    if (id === 'export') {
      exportStyle(props.ctx as StyleContextAlt);
    } else if (id === 'delete') {
      deleteStyle(props.ctx as StyleContextAlt);
    } else if (id === 'edit') {
      editStyle(props.ctx as StyleContextAlt);
    } else if (id === 'to-global') {
      const ctx = props.ctx as StyleContextAlt;
      appState.exportPresetToGlobal(ctx.session, ctx.preset);
    }
  };
  return (
    <>
      <Menu id={ContextMenuType.Scene}>
        <Item id="queue-add-all-or-selected" onClick={handleSceneItemClick}>
          {appState.selectedScenes.size > 0
            ? `선택한 씬 예약 추가 (${appState.selectedScenes.size})`
            : '모든 씬 예약 추가'}
        </Item>
        <Item id="queue-remove-all-or-selected" onClick={handleSceneItemClick}>
          {appState.selectedScenes.size > 0
            ? `선택한 씬 예약 제거 (${appState.selectedScenes.size})`
            : '모든 씬 예약 제거'}
        </Item>
        <Separator />
        <Item id="duplicate" onClick={handleSceneItemClick}>
          해당 씬 복제
        </Item>
        <Item id="copy-to-project" onClick={handleSceneItemClick}>
          {appState.selectedScenes.size > 1
            ? `선택한 씬(${appState.selectedScenes.size}) 복사`
            : '다른 프로젝트로 씬 복사'}
        </Item>
        <Item id="move-front" onClick={handleSceneItemClick}>
          해당 씬 맨 위로
        </Item>
        <Item id="move-back" onClick={handleSceneItemClick}>
          해당 씬 맨 뒤로
        </Item>
        <Item id="delete" onClick={handleSceneItemClick}>
          {appState.selectedScenes.size > 1
            ? `선택한 씬(${appState.selectedScenes.size}) 삭제`
            : '해당 씬 삭제'}
        </Item>
        <Separator />
        <Item id="delete-all-selected-images" onClick={handleSceneItemClick}>
          선택한 씬 이미지 모두 삭제
        </Item>
        <Item id="delete-all-selected-images-except-fav" onClick={handleSceneItemClick}>
          선택한 씬 이미지 모두 삭제 (즐겨찾기 제외)
        </Item>
      </Menu>
      <Menu id={ContextMenuType.GallaryImage}>
        <Item id="download" onClick={handleImageItemClick2}>
          이미지 다운로드
        </Item>
        <Item id="fav" onClick={handleImageItemClick2}>
          즐겨찾기 토글
        </Item>
        <Item id="transform" onClick={handleImageItemClick2}>
          이미지 변형
        </Item>
        <Item id="delete" onClick={handleImageItemClick2}>
          해당 이미지 삭제
        </Item>
        <Item id="duplicate" onClick={handleImageItemClick2}>
          해당 이미지 복제
        </Item>
        <Item id="copy" onClick={handleImageItemClick2}>
          다른 씬으로 이미지 복사
        </Item>
        {!isMobile && (
          <Item id="clipboard" onClick={handleImageItemClick2}>
            클립보드로 이미지 복사
          </Item>
        )}
        <Separator />
        <Item id="save-global" onClick={handleImageItemClick2}>
          글로벌 프리셋으로 저장
        </Item>
        <Item id="save-artist" onClick={handleImageItemClick2}>
          작가 라이브러리에 저장
        </Item>
      </Menu>
      <Menu id={ContextMenuType.Image}>
        <Item id="download" onClick={handleImageItemClick}>
          이미지 다운로드
        </Item>
        <Item id="fav" onClick={handleImageItemClick}>
          즐겨찾기 토글
        </Item>
        <Item id="duplicate" onClick={handleImageItemClick}>
          해당 이미지 복제
        </Item>
        <Item id="copy" onClick={handleImageItemClick}>
          다른 씬으로 이미지 복사
        </Item>
        {!isMobile && (
          <Item id="clipboard" onClick={handleImageItemClick}>
            클립보드로 이미지 복사
          </Item>
        )}
        <Separator />
        <Item id="save-global" onClick={handleImageItemClick}>
          글로벌 프리셋으로 저장
        </Item>
        <Item id="save-artist" onClick={handleImageItemClick}>
          작가 라이브러리에 저장
        </Item>
      </Menu>
      <Menu id={ContextMenuType.Style}>
        <Item id="export" onClick={handleStyleItemClick}>
          해당 그림체 내보내기
        </Item>
        <Item id="to-global" onClick={handleStyleItemClick}>
          글로벌 프리셋으로 저장
        </Item>
        <Item id="edit" onClick={handleStyleItemClick}>
          해당 그림체 편집
        </Item>
        <Item id="delete" onClick={handleStyleItemClick}>
          해당 그림체 삭제
        </Item>
      </Menu>
    </>
  );
});
