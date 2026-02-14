import { cast } from 'mobx-state-tree';
import { backend, isMobile, gameService, imageService } from '.';
import { GenericScene, InpaintScene, Scene, Session } from './types';
import { assert } from './util';
import { v4 } from 'uuid';

export const supportedImageSizes = [200, 400, 500];
const imageDirList = ['outs', 'inpaints'];
const maskDirList = ['inpaint_masks', 'inpaint_orgs'];

const IMAGE_CACHE_SIZE = 256;
const ENCODED_VIBE_CACHE_SIZE = 128;

const naturalSort = (a: string, b: string) => {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

class LRUCache<K, V> {
  limit: number;
  cache: Map<K, V>;

  constructor(limit: number) {
    this.limit = limit;
    this.cache = new Map<K, V>();
  }

  get(key: K): V | null {
    if (!this.cache.has(key)) {
      return null;
    }
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.limit) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  delete(key: K): void {
    this.cache.delete(key);
  }
}

export class ImageService extends EventTarget {
  images: { [key: string]: { [key: string]: string[] } };
  inpaints: { [key: string]: { [key: string]: string[] } };
  cache: LRUCache<string, string>;
  mutexes: { [key: string]: Promise<void> };
  // 인코딩된 바이브 이미지 존재 여부 캐시 (성능 최적화)
  encodedVibeExistsCache: LRUCache<string, boolean>;

  constructor() {
    super();
    this.images = {};
    this.inpaints = {};
    this.cache = new LRUCache(IMAGE_CACHE_SIZE);
    this.mutexes = {};
    this.encodedVibeExistsCache = new LRUCache(ENCODED_VIBE_CACHE_SIZE);
  }

  private async acquireMutex(path: string) {
    while (this.mutexes[path]) {
      await this.mutexes[path];
    }

    let resolve: () => void = () => {};
    this.mutexes[path] = new Promise((r) => (resolve = r));
    (this.mutexes[path] as any).resolve = resolve;
  }

  private releaseMutex(path: string) {
    const resolve = (this.mutexes[path] as any).resolve;
    delete this.mutexes[path];
    if (resolve) resolve();
  }

  async renameImage(oldPath: string, newPath: string) {
    try {
      await this.acquireMutex(oldPath);
      await this.acquireMutex(newPath);
      await backend.renameFile(oldPath, newPath);
      await this.onRenameFile(oldPath, newPath);
    } finally {
      this.releaseMutex(newPath);
      this.releaseMutex(oldPath);
    }
  }

  async onRenameFile(oldPath: string, newPath: string) {
    const oldPathParts = oldPath.split('/');
    const newPathParts = newPath.split('/');
    const oldDir = oldPathParts[oldPathParts.length - 2];
    const newDir = newPathParts[newPathParts.length - 2];
    assert(oldDir !== 'fastcache' && newDir !== 'fastcache');
    const oldPaths = [];
    const newPaths = [];
    for (const imageSize of supportedImageSizes) {
      oldPaths.push(this.getSmallImagePath(oldPath, imageSize));
      newPaths.push(this.getSmallImagePath(newPath, imageSize));
    }
    for (const path of oldPaths) {
      await this.acquireMutex(path);
    }
    for (const path of newPaths) {
      await this.acquireMutex(path);
    }
    try {
      for (let i = 0; i < oldPaths.length; i++) {
        const oldPath = oldPaths[i];
        const newPath = newPaths[i];
        try {
          await backend.renameFile(oldPath, newPath);
        } catch (e) {}
      }
      if (this.cache.cache.get(oldPath)) {
        this.cache.cache.set(newPath, this.cache.cache.get(oldPath)!);
        this.cache.cache.delete(oldPath);
      }
      for (const imageSize of supportedImageSizes) {
        const oldSmallPath = this.getSmallImagePath(oldPath, imageSize);
        const newSmallPath = this.getSmallImagePath(newPath, imageSize);
        if (this.cache.cache.get(oldSmallPath)) {
          this.cache.cache.set(
            newSmallPath,
            this.cache.cache.get(oldSmallPath)!,
          );
          this.cache.cache.delete(oldSmallPath);
        }
      }
    } finally {
      for (const path of oldPaths) {
        this.releaseMutex(path);
      }
      for (const path of newPaths) {
        this.releaseMutex(path);
      }
    }
  }

  async invalidateCache(path: string) {
    if (path.includes('fastcache')) {
      return;
    }
    await this.acquireMutex(path);
    for (const imageSize of supportedImageSizes) {
      const smallPath = this.getSmallImagePath(path, imageSize);
      await this.acquireMutex(smallPath);
    }
    try {
      this.cache.delete(path);
      for (const imageSize of supportedImageSizes) {
        const smallPath = this.getSmallImagePath(path, imageSize);
        this.cache.delete(smallPath);
        try {
          await backend.deleteFile(smallPath);
        } catch (e) {}
      }
    } finally {
      for (const imageSize of supportedImageSizes) {
        const smallPath = this.getSmallImagePath(path, imageSize);
        this.releaseMutex(smallPath);
      }
      this.releaseMutex(path);
    }
    this.dispatchEvent(
      new CustomEvent('image-cache-invalidated', { detail: { path } }),
    );
  }

  async fetchVibeImage(session: Session, name: string) {
    const path =
      imageService.getVibesDir(session) + '/' + name.split('/').pop()!;
    return await this.fetchImage(path);
  }

  async fetchEncodedVibeImage(session: Session, name: string, info: number) {
    const path =
      imageService.getEncodedVibesDir(session) +
      '/' +
      name.split('/').pop()! +
      '&info=' +
      info;
    return await this.fetchImage(path);
  }

  async writeVibeImage(session: Session, name: string, data: string) {
    const path =
      imageService.getVibesDir(session) + '/' + name.split('/').pop()!;
    await backend.writeDataFile(path, data);
    await imageService.invalidateCache(path);
  }

  async fetchReferenceImage(session: Session, name: string) {
    const path =
      imageService.getReferenceDir(session) + '/' + name.split('/').pop()!;
    return await this.fetchImage(path);
  }

  async writeReferenceImage(session: Session, name: string, data: string) {
    const resized = await this.normalizeReferenceImage(data);
    const path =
      imageService.getReferenceDir(session) + '/' + name.split('/').pop()!;
    await backend.writeDataFile(path, resized);
    await imageService.invalidateCache(path);
  }

  async fetchImage(path: string, holdMutex = true) {
    if (holdMutex) await this.acquireMutex(path);
    try {
      if (this.cache.get(path)) {
        const res = this.cache.get(path);
        return res;
      }
      // 파일 존재 여부 먼저 확인하여 불필요한 오류 로그 방지
      const exists = await backend.existFile(path);
      if (!exists) {
        return null;
      }
      const data = await backend.readDataFile(path);
      this.cache.set(path, data);
      return data;
    } finally {
      if (holdMutex) this.releaseMutex(path);
    }
  }

  async fetchImageSmall(path: string, size: number) {
    if (size === -1 || (isMobile && size === 500)) {
      return this.fetchImage(path);
    }
    const smallImagePath = this.getSmallImagePath(path, size);
    await this.acquireMutex(smallImagePath);
    try {
      // 캐시된 작은 이미지가 있는지 확인
      const resizedImageData = await this.fetchImage(smallImagePath, false);
      if (resizedImageData) {
        return resizedImageData;
      }
      // 캐시된 작은 이미지가 없음 - 원본 파일 존재 여부 확인 후 리사이즈 시도
      const originalExists = await backend.existFile(path);
      if (!originalExists) {
        // 원본 파일이 없으면 null 반환 (오류 로그 방지)
        return null;
      }
      try {
        await this.resizeImage(path, smallImagePath, size, size);
        const data = await this.fetchImage(smallImagePath, false);
        if (data) {
          this.cache.set(smallImagePath, data);
          return data;
        }
      } catch (e) {
        // 리사이즈 실패 시 원본 이미지 반환
        console.error('Failed to resize image, returning original:', path, e);
      }
      // 리사이즈 실패 시 원본 이미지 반환
      return this.fetchImage(path, false);
    } finally {
      this.releaseMutex(smallImagePath);
    }
  }

  getSmallImagePath(originalPath: string, size: number) {
    const pathParts = originalPath.split('/');
    const fileName = size.toString() + '_' + pathParts.pop();
    pathParts.push('fastcache');
    pathParts.push(fileName!);
    return pathParts.join('/');
  }

  async resizeImage(
    inputPath: string,
    outputPath: string,
    maxWidth: number,
    maxHeight: number,
  ) {
    let scale = maxWidth <= 200 ? 1.25 : 1.1;
    if (isMobile) {
      scale = 1.0;
    }
    maxWidth = Math.ceil(scale * maxWidth);
    maxHeight = Math.ceil(scale * maxHeight);
    await backend.resizeImage({
      inputPath,
      outputPath,
      maxWidth,
      maxHeight,
    });
  }

  // NOTE there is race condition here
  // when deleted resource is being loaded up by somebody
  // we can end up with invalid cache
  // trikcy to handle without global lock
  // but only happens when "swap of scene names" is the case
  // let's just keep it simple; this is probably not common use case
  async onRenameScene(session: Session, oldName: string, newName: string) {
    const cache = this.cache.cache;
    const toDelete = [];
    for (const key of cache.keys()) {
      for (const imgDir of imageDirList.concat(maskDirList)) {
        if (key.startsWith(imgDir + '/' + session.name + '/' + oldName)) {
          toDelete.push(key);
        }
      }
    }
    for (const key of toDelete) {
      cache.delete(key);
    }
    for (const imgDir of imageDirList) {
      const oldPath = imgDir + '/' + session.name + '/' + oldName;
      const newPath = imgDir + '/' + session.name + '/' + newName;
      try {
        await backend.renameDir(oldPath, newPath);
      } catch (e) {
        console.error('rename scene error:', e);
      }
    }
    for (const imgDir of maskDirList) {
      const oldPath = imgDir + '/' + session.name + '/' + oldName + '.png';
      const newPath = imgDir + '/' + session.name + '/' + newName + '.png';
      try {
        await backend.renameFile(oldPath, newPath);
      } catch (e) {
        console.error('rename scene error:', e);
      }
    }
  }

  async resizeImageBrowser(
    dataUrl: string,
    maxWidth: number,
    maxHeight: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = dataUrl;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        let scale = Math.max(maxWidth / img.width, maxHeight / img.height);

        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
    });
  }

  async normalizeReferenceImage(data: string): Promise<string> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return data;
    const img = new Image();
    img.src = base64ToDataUri(data);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const { canvasWidth, canvasHeight } = this.chooseReferenceResolution(img.width, img.height);
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const scale = Math.min(canvasWidth / img.width, canvasHeight / img.height);
    const w = Math.floor(scale * img.width);
    const h = Math.floor(scale * img.height);
    const x = Math.floor((canvasWidth - w) / 2);
    const y = Math.floor((canvasHeight - h) / 2);
  
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(img, x, y, w, h);
    return canvas.toDataURL('image/png').split(',')[1];
  }

  chooseReferenceResolution(width: number, height: number) {
    const ratio = width / height;
    if (ratio >= 0.9 && ratio <= 1.1) 
      return { canvasWidth: 1472, canvasHeight: 1472 };
    else if (ratio < 1) 
      return { canvasWidth: 1024, canvasHeight: 1536 };
    else return { canvasWidth: 1536, canvasHeight: 1024 };
  }

  getOutputs(session: Session, scene: GenericScene) {
    if (scene.type === 'scene') {
      return this.getImages(session, scene);
    }
    return this.getInPaints(session, scene);
  }

  getImages(session: Session, scene: Scene) {
    if (!(session.name in this.images)) {
      return [];
    }
    if (!(scene.name in this.images[session.name])) {
      return [];
    }
    return this.images[session.name][scene.name];
  }

  getInPaints(session: Session, scene: InpaintScene) {
    if (!(session.name in this.inpaints)) {
      return [];
    }
    if (!(scene.name in this.inpaints[session.name])) {
      return [];
    }
    return this.inpaints[session.name][scene.name];
  }

  getOutputDir(session: Session, scene: GenericScene) {
    if (scene.type === 'scene') {
      return this.getImageDir(session, scene);
    }
    return this.getInPaintDir(session, scene);
  }

  getImageDir(session: Session, scene: Scene) {
    return 'outs/' + session.name + '/' + scene.name;
  }

  getInPaintDir(session: Session, scene: InpaintScene) {
    return 'inpaints/' + session.name + '/' + scene.name;
  }

  getVibesDir(session: Session) {
    return 'vibes/' + session.name;
  }

  getEncodedVibesDir(session: Session) {
    return 'vibes/' + session.name + '/encoded';
  }

  getReferenceDir(session: Session) {
    return 'references/' + session.name;
  }

  async storeVibeImage(session: Session, data: string) {
    const path = imageService.getVibesDir(session) + '/' + v4() + '.png';
    await backend.writeDataFile(path, data);
    return path.split('/').pop()!;
  }

  async storeEncodedVibeImage(
    session: Session,
    name: string,
    data: string,
    info: number,
  ) {
    const path =
      imageService.getEncodedVibesDir(session) + '/' + name + '&info=' + info;
    await backend.writeDataFile(path, data);
    return path.split('/').pop()!;
  }

  async storeReferenceImage(session: Session, data: string) {
    const resized = await this.normalizeReferenceImage(data);
    const path = imageService.getReferenceDir(session) + '/' + v4() + '.png';
    await backend.writeDataFile(path, resized);
    return path.split('/').pop()!;
  }

  getVibeImagePath(session: Session, name: string) {
    return imageService.getVibesDir(session) + '/' + name.split('/').pop()!;
  }

  getEncodedVibeImagePath(session: Session, name: string, info: number) {
    return (
      imageService.getEncodedVibesDir(session) +
      '/' +
      name.split('/').pop()! +
      '&info=' +
      info
    );
  }

  getReferenceImagePath(session: Session, name: string) {
    return imageService.getReferenceDir(session) + '/' + name.split('/').pop()!;
  }

  async refresh(
    session: Session,
    scene: GenericScene,
    emitEvent: boolean = true,
  ) {
    const target = scene.type === 'scene' ? this.images : this.inpaints;
    if (!(session.name in target)) {
      target[session.name] = {};
    }
    const fileSet: any = {};
    let files = await backend.listFiles(this.getOutputDir(session, scene));
    files = files.filter((x: string) => x.endsWith('.png'));
    files.sort(naturalSort);
    for (const file of files) {
      fileSet[file] = true;
    }
    const invImageMap: any = {};
    for (let i = 0; i < scene.imageMap.length; i++) {
      invImageMap[scene.imageMap[i]] = i;
    }
    let newImageMap = scene.imageMap.filter((x: string) => x in fileSet);
    for (const file of files) {
      if (!(file in invImageMap)) {
        newImageMap.push(file);
      }
    }
    scene.imageMap = newImageMap;
    target[session.name][scene.name] = [...scene.imageMap];
    if (scene.type === 'scene') {
      scene.mains = scene.mains.filter((x: string) => x in fileSet);
    }
    if (emitEvent)
      this.dispatchEvent(
        new CustomEvent('updated', {
          detail: { batch: false, session, scene },
        }),
      );
  }

  async refreshBatch(session: Session) {
    for (const scene of session.scenes.values()) {
      try {
        await this.refresh(session, scene, false);
      } catch (e) {}
    }
    for (const scene of session.inpaints.values()) {
      try {
        await this.refresh(session, scene, false);
      } catch (e) {}
    }
    this.dispatchEvent(
      new CustomEvent('updated', { detail: { batch: true, session } }),
    );
  }

  onAddImage(session: Session, scene: string, path: string) {
    if (!(session.name in this.images)) {
      this.images[session.name] = {};
    }
    if (!(scene in this.images[session.name])) {
      this.images[session.name][scene] = [];
    }
    this.images[session.name][scene] = this.images[session.name][scene].concat([
      path.split('/').pop()!,
    ]);
    session.scenes.get(scene)?.imageMap.push(path.split('/').pop()!);
    if (isMobile)
      for (const size of supportedImageSizes) this.fetchImageSmall(path, size);
    this.dispatchEvent(
      new CustomEvent('updated', {
        detail: { batch: false, session, scene: session.scenes.get(scene) },
      }),
    );
  }

  onAddInPaint(session: Session, scene: string, path: string) {
    if (!(session.name in this.inpaints)) {
      this.inpaints[session.name] = {};
    }
    if (!(scene in this.inpaints[session.name])) {
      this.inpaints[session.name][scene] = [];
    }
    this.inpaints[session.name][scene] = this.inpaints[session.name][
      scene
    ].concat([path.split('/').pop()!]);
    session.inpaints.get(scene)?.imageMap.push(path.split('/').pop()!);
    if (isMobile)
      for (const size of supportedImageSizes) this.fetchImageSmall(path, size);
    this.dispatchEvent(
      new CustomEvent('updated', {
        detail: { batch: false, session, scene: session.inpaints.get(scene) },
      }),
    );
  }

  async encodeVibeImage(session: Session, path: string, info: number) {
    const vibePath = this.getVibeImagePath(session, path);
    const data = await this.fetchVibeImage(session, vibePath);
    if (!data) return;
    const encoded = await backend.encodeVibeImage({
      image: dataUriToBase64(data),
      info: info,
    });
    await this.storeEncodedVibeImage(session, path, encoded, info);
    
    // 인코딩 완료 후 캐시 업데이트
    const cacheKey = this.getEncodedVibeImagePath(session, path, info);
    this.encodedVibeExistsCache.set(cacheKey, true);
    
    this.dispatchEvent(new CustomEvent('encode-vibe', {}));
    return encoded;
  }

  async checkEncodedVibeImage(session: Session, path: string, info: number) {
    const vibePath = this.getEncodedVibeImagePath(session, path, info);
    
    // 캐시에서 먼저 확인 (성능 최적화)
    const cached = this.encodedVibeExistsCache.get(vibePath);
    if (cached !== null) {
      return cached;
    }
    
    // 캐시에 없으면 파일 시스템 확인
    const exists = await backend.existFile(vibePath);
    this.encodedVibeExistsCache.set(vibePath, exists);
    return exists;
  }
}

export function base64ToDataUri(data: string) {
  return 'data:image/png;base64,' + data;
}

export function dataUriToBase64(dataUri: string) {
  return dataUri.split(',')[1];
}

export function getMainImagePath(session: Session, scene: Scene) {
  if (scene.mains.length) {
    return imageService.getImageDir(session, scene) + '/' + scene.mains[0];
  }
  const images = gameService.getOutputs(session, scene);
  if (images.length) {
    return imageService.getImageDir(session, scene) + '/' + images[0];
  }
  return undefined;
}

export async function getMainImage(
  session: Session,
  scene: GenericScene,
  size: number,
) {
  if (scene.mains.length) {
    const path =
      imageService.getOutputDir(session, scene) + '/' + scene.mains[0];
    const base64 = await imageService.fetchImageSmall(path, size);
    return base64;
  }
  const images = gameService.getOutputs(session, scene);
  if (images.length) {
    const path = imageService.getOutputDir(session, scene) + '/' + images[0];
    return await imageService.fetchImageSmall(path, size);
  }
  return undefined;
}

export const deleteImageFiles = async (
  curSession: Session,
  paths: string[],
  scene?: GenericScene,
) => {
  for (const path of paths) {
    try {
      await backend.trashFile(path);
    } catch (e) {}
    await imageService.invalidateCache(path);
  }
  if (scene) {
    await imageService.refresh(curSession, scene);
  } else {
    await imageService.refreshBatch(curSession);
  }
};

export const renameImage = async (oldPath: string, newPath: string) => {
  await imageService.renameImage(oldPath, newPath);
};
