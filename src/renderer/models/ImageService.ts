import { cast } from 'mobx-state-tree';
import {
  backend,
  isMobile,
  gameService,
  imageService,
  taskQueueService,
  trashService,
} from '.';
import { platform } from './platform';
import { getAppState } from './appStateRef';
import { GenericScene, InpaintScene, Scene, Session } from './types';
import { assert } from './util';
import { isOutputImageFile } from './imageFormats';
import {
  projectPath,
  PROJECT_IMAGE_ROOTS,
  PROJECT_SCENE_IMAGE_ROOTS,
  PROJECT_SCENE_MASK_ROOTS,
  ProjectImageRoot,
} from './projectPaths';
import { v4 } from 'uuid';

export const supportedImageSizes = [200, 400, 500];
const imageDirList = [...PROJECT_SCENE_IMAGE_ROOTS];
const maskDirList = [...PROJECT_SCENE_MASK_ROOTS];

const naturalSort = (a: string, b: string) => {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

class LRUCache<K, V> {
  limit: number;
  // 개수와 별개로 총 용량(문자 수 ≈ base64 바이트)도 제한한다.
  // 썸네일(수십 KB)과 원본(수 MB)이 한 캐시에 섞여 있어, 개수 제한만으로는
  // 원본이 몰릴 때 메모리가 수백 MB 까지 커질 수 있기 때문.
  byteLimit?: number;
  totalBytes = 0;
  cache: Map<K, V>;

  constructor(limit: number, byteLimit?: number) {
    this.limit = limit;
    this.byteLimit = byteLimit;
    this.cache = new Map<K, V>();
  }

  private sizeOf(value: V): number {
    return typeof value === 'string' ? value.length : 1;
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
      this.totalBytes -= this.sizeOf(this.cache.get(key)!);
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    this.totalBytes += this.sizeOf(value);
    // 개수 또는 용량 초과 시 오래된 것부터 축출.
    // (size > 1 조건: 방금 넣은 항목 하나가 용량을 넘어도 그것만은 유지)
    while (
      this.cache.size > this.limit ||
      (this.byteLimit !== undefined &&
        this.totalBytes > this.byteLimit &&
        this.cache.size > 1)
    ) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;
      this.totalBytes -= this.sizeOf(this.cache.get(firstKey)!);
      this.cache.delete(firstKey);
    }
  }

  delete(key: K): void {
    if (this.cache.has(key)) {
      this.totalBytes -= this.sizeOf(this.cache.get(key)!);
    }
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
    this.cache = new LRUCache(platform.imageCacheSize, platform.imageCacheBytes);
    this.mutexes = {};
    this.encodedVibeExistsCache = new LRUCache(platform.encodedVibeCacheSize);
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
    if (!name) return null;
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
    // projectPath 경유 — 신 배치 활성 시 workspace/<물리폴더>/<root>/<씬> 로 분기.
    // 캐시 키도 projectPath 로 생성되므로 접두 매칭이 양 배치에서 일치한다.
    const cache = this.cache.cache;
    const toDelete = [];
    for (const key of cache.keys()) {
      for (const imgDir of imageDirList.concat(maskDirList)) {
        if (key.startsWith(projectPath(imgDir, session.name, oldName))) {
          toDelete.push(key);
        }
      }
    }
    for (const key of toDelete) {
      this.cache.delete(key); // 외부 delete 사용 (용량 회계 유지)
    }
    for (const imgDir of imageDirList) {
      const oldPath = projectPath(imgDir, session.name, oldName);
      const newPath = projectPath(imgDir, session.name, newName);
      try {
        await backend.renameDir(oldPath, newPath);
      } catch (e) {
        console.error('rename scene error:', e);
      }
    }
    for (const imgDir of maskDirList) {
      const oldPath = projectPath(imgDir, session.name, oldName + '.png');
      const newPath = projectPath(imgDir, session.name, newName + '.png');
      try {
        await backend.renameFile(oldPath, newPath);
      } catch (e) {
        console.error('rename scene error:', e);
      }
    }
  }

  // 씬 병합: sourceName 씬 폴더의 이미지를 targetName 씬 폴더로 옮긴다.
  // - 파일명이 충돌하면 접미사를 붙여 재지정하므로 이미지 손실은 없다.
  // - 복사에 성공한 원본 파일만 삭제하므로, 일부 실패해도 원본이 보존된다.
  // 반환값: 옮긴 이미지 수
  async mergeSceneImages(
    session: Session,
    sourceName: string,
    targetName: string,
  ): Promise<number> {
    let moved = 0;
    for (const imgDir of imageDirList) {
      const srcDir = projectPath(imgDir, session.name, sourceName);
      const dstDir = projectPath(imgDir, session.name, targetName);

      let files: string[];
      try {
        files = (await backend.listFiles(srcDir)).filter(isOutputImageFile);
      } catch (e) {
        continue; // source 폴더가 없으면 건너뜀
      }
      if (files.length === 0) continue;

      // 대상 폴더의 기존 파일명(충돌 검사용)
      const taken = new Set<string>();
      try {
        for (const f of await backend.listFiles(dstDir)) {
          if (isOutputImageFile(f)) taken.add(f);
        }
      } catch (e) {
        /* 대상 폴더가 아직 없을 수 있음 */
      }

      for (const file of files) {
        // 파일명 충돌 시 "_merged{n}" 접미사로 회피
        let dstName = file;
        if (taken.has(dstName)) {
          const dot = file.lastIndexOf('.');
          const base = dot >= 0 ? file.slice(0, dot) : file;
          const ext = dot >= 0 ? file.slice(dot) : '';
          let i = 1;
          while (taken.has(`${base}_merged${i}${ext}`)) i++;
          dstName = `${base}_merged${i}${ext}`;
        }
        try {
          await backend.copyFile(srcDir + '/' + file, dstDir + '/' + dstName);
          taken.add(dstName);
          moved++;
          // 복사 성공한 원본만 삭제 (실패분은 보존)
          try {
            await backend.deleteFile(srcDir + '/' + file);
          } catch (e) {
            /* 원본 삭제 실패는 무시 */
          }
        } catch (e) {
          console.error('씬 병합 이미지 복사 실패:', file, e);
        }
      }

      // 비워진 source 폴더 정리 (남은 파일이 있으면 deleteDir가 실패할 수 있음 → 무시)
      try {
        await backend.deleteDir(srcDir);
      } catch (e) {
        /* 무시 */
      }
    }

    // source 씬 관련 캐시 무효화
    const cache = this.cache.cache;
    const toDelete: string[] = [];
    for (const key of cache.keys()) {
      for (const imgDir of imageDirList.concat(maskDirList)) {
        if (key.startsWith(projectPath(imgDir, session.name, sourceName))) {
          toDelete.push(key);
        }
      }
    }
    for (const key of toDelete) this.cache.delete(key); // 용량 회계 유지

    return moved;
  }

  async onRenameSession(oldName: string, newName: string) {
    const cache = this.cache.cache;
    const toDelete = [];
    for (const key of cache.keys()) {
      if (key.includes('/' + oldName + '/')) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this.cache.delete(key); // 외부 delete 사용 (용량 회계 유지)
    }
    // 6루트 순차 이동. 과거에는 루트별 실패를 조용히 삼켜(catch 무시) 일부만
    // 새 이름으로 이동한 "갈라진 상태"가 은폐됐다(트랙1 조사 §1-2). 이제
    // ①없는 폴더는 실패가 아니므로 사전 확인 후 건너뛰고 ②실제 이동 실패 시
    // 이미 옮긴 루트를 되돌린(롤백) 뒤 throw 해 원 상태를 보존한다.
    const moved: ProjectImageRoot[] = [];
    for (const dir of PROJECT_IMAGE_ROOTS) {
      let exists = true;
      try {
        await backend.listFiles(projectPath(dir, oldName));
      } catch (e) {
        exists = false; // 해당 타입 이미지 없음 — 정상
      }
      if (!exists) continue;
      try {
        await backend.renameDir(projectPath(dir, oldName), projectPath(dir, newName));
        moved.push(dir);
      } catch (e) {
        for (const back of moved) {
          try {
            await backend.renameDir(projectPath(back, newName), projectPath(back, oldName));
          } catch (e2) {
            console.error('이름변경 롤백 실패 — 수동 확인 필요:', back, e2);
          }
        }
        throw new Error(
          `이미지 폴더(${dir}) 이동에 실패해 이름변경을 취소했습니다. ` +
            `앱 외부에서 해당 폴더를 사용 중인지 확인해주세요.`,
        );
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
    // NAI Precise Reference 스펙: 3채널 RGB 필요. HTML Canvas는 항상 RGBA이므로
    // alpha 채널을 포함하지 않는 JPEG 0.95로 인코딩하여 RGBA→RGB 변환.
    // 참고: sunanakgo/NAIS2 processCharacterImage, DNT-LAB/NAIA _letterbox
    return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
  }

  /**
   * 이미 저장된 레퍼런스 이미지(base64)를 NAI API 전송용 JPEG 3채널로 재인코딩.
   * 기존 사용자가 업로드한 RGBA PNG 레퍼런스를 재업로드 없이 호환시키기 위해
   * 생성 시점에 호출. letterbox는 수행하지 않음 (저장 시점에 이미 완료됨).
   */
  async reencodeReferenceForApi(data: string): Promise<string> {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return data;
      const img = new Image();
      img.src = base64ToDataUri(data);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      canvas.width = img.width;
      canvas.height = img.height;
      // alpha 픽셀이 투명한 경우를 대비해 검정 배경 채움 (letterbox 색상과 일치).
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
    } catch (e) {
      console.warn('Failed to re-encode reference image as JPEG:', e);
      return data;
    }
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
    return projectPath('outs', session.name, scene.name);
  }

  getInPaintDir(session: Session, scene: InpaintScene) {
    return projectPath('inpaints', session.name, scene.name);
  }

  getVibesDir(session: Session) {
    return projectPath('vibes', session.name);
  }

  getEncodedVibesDir(session: Session) {
    return projectPath('vibes', session.name, 'encoded');
  }

  getReferenceDir(session: Session) {
    return projectPath('references', session.name);
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

  // 반환값(트랙1 B4 이슈① 진단용): 'guarded'=디스크 0장인데 기존 목록을 방어
  // 유지 / 'files'=파일을 정상적으로 읽음(≥1장) / 'empty'=0장을 그대로 반영.
  // refreshBatch 가 'files'(저장소 접근 정상 증거)와 'guarded'를 대조해
  // 영구 소실 확정 씬을 자동 화해한다. 개별 호출부는 반환값을 무시해도 된다.
  async refresh(
    session: Session,
    scene: GenericScene,
    emitEvent: boolean = true,
    guardEmpty: boolean = false,
  ): Promise<'guarded' | 'files' | 'empty'> {
    const target = scene.type === 'scene' ? this.images : this.inpaints;
    if (!(session.name in target)) {
      target[session.name] = {};
    }
    const fileSet: any = {};
    let files = await backend.listFiles(this.getOutputDir(session, scene));
    files = files.filter(isOutputImageFile);
    files.sort(naturalSort);

    // 방어 (refreshBatch 전용): 기존 imageMap에 항목이 있었는데 파일시스템에서
    // 0개가 반환된 경우, 디렉토리 일시 접근 불가일 가능성이 높으므로 기존 상태 유지.
    // 개별 refresh(삭제 후 등)에서는 guardEmpty=false로 호출하여 정상 반영.
    if (guardEmpty && files.length === 0 && scene.imageMap.length > 0) {
      target[session.name][scene.name] = [...scene.imageMap];
      // 읽기 실패/접근 불가 의심: 디스크 0개인데 기존 목록은 N개 → 로그로 남겨 진단 가능하게.
      try {
        taskQueueService.addLog(
          'warn',
          '저장소',
          `"${session.name}/${scene.name}" 이미지 폴더를 읽지 못해 기존 목록(${scene.imageMap.length}장)을 유지했습니다. 저장소 접근을 확인하세요.`,
        );
      } catch (e) {}
      if (emitEvent)
        this.dispatchEvent(
          new CustomEvent('updated', {
            detail: { batch: false, session, scene },
          }),
        );
      return 'guarded';
    }

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
    // 랭킹 죽은 참조 정리(트랙1 B4 이슈②): 부분 소실 시 imageMap/mains 는 위에서
    // 화해되지만 game/round 는 남아 nextRound 가 소실 이미지를 대진에 올렸다.
    // 랭크는 결번이 생기므로 cleanGame 으로 정규화(대진 로직의 전제).
    if (scene.game && scene.game.some((p) => !(p.path in fileSet))) {
      const alive = scene.game.filter((p) => p.path in fileSet);
      if (alive.length > 0) {
        gameService.cleanGame(alive);
        scene.game = alive;
      } else {
        scene.game = undefined;
      }
    }
    if (scene.round && scene.round.players.some((p) => !(p in fileSet))) {
      scene.round = undefined;
    }
    if (emitEvent)
      this.dispatchEvent(
        new CustomEvent('updated', {
          detail: { batch: false, session, scene },
        }),
      );
    return files.length > 0 ? 'files' : 'empty';
  }

  async refreshBatch(session: Session) {
    const allScenes: GenericScene[] = [
      ...session.scenes.values(),
      ...session.inpaints.values(),
    ];
    const results = await Promise.allSettled(
      allScenes.map((scene) => this.refresh(session, scene, false, true)),
    );
    // 유령 참조 자동 화해(트랙1 B4 이슈①): guardEmpty 가 목록을 방어 유지한
    // 씬('guarded')이 있는데 같은 프로젝트의 다른 씬이 파일을 정상적으로
    // 읽었다면('files' = 저장소 루트 접근 정상 증거), 해당 씬 폴더는 "일시
    // 접근 불가"가 아니라 영구 소실 — 실제(0장)로 화해해 무한 경고를 끊는다.
    // 증거가 없으면(전 씬 0장 = 루트/드라이브 미접근 가능성) 절대 정리하지
    // 않고 종전대로 방어 유지한다. 씬 자체는 제거하지 않는다(목록 화해만).
    const guarded: GenericScene[] = [];
    let evidence = false;
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      if (r.value === 'guarded') guarded.push(allScenes[i]);
      else if (r.value === 'files') evidence = true;
    });
    if (evidence && guarded.length > 0) {
      await Promise.allSettled(
        guarded.map(async (scene) => {
          await this.refresh(session, scene, false, false);
          try {
            taskQueueService.addLog(
              'warn',
              '저장소',
              `"${session.name}/${scene.name}" 이미지 폴더가 영구 소실된 것으로 확인되어 목록을 정리했습니다 (같은 프로젝트의 다른 씬은 정상 접근됨).`,
            );
          } catch (e) {}
        }),
      );
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
      for (const size of platform.pregenThumbSizes) this.fetchImageSmall(path, size);
    // 생성 히스토리 수집용 — 새로 추가된 이미지의 경로까지 전달('updated'에는 없음)
    this.dispatchEvent(
      new CustomEvent('image-added', {
        detail: {
          session,
          sceneType: 'scene',
          sceneName: scene,
          filename: path.split('/').pop()!,
          path,
        },
      }),
    );
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
      for (const size of platform.pregenThumbSizes) this.fetchImageSmall(path, size);
    this.dispatchEvent(
      new CustomEvent('image-added', {
        detail: {
          session,
          sceneType: 'inpaint',
          sceneName: scene,
          filename: path.split('/').pop()!,
          path,
        },
      }),
    );
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

// ── 이미지 즐겨찾기(mains) 중앙 헬퍼 (읽기 전용 미러 / 창 간 동기화) ──
// scene.mains 를 로컬에 반영하고, 같은 프로젝트를 연 다른 창에 op 를 전파한다.
// 소유 창은 자기 큐가 저장하고(=위임의 실체), 미러 창은 P0 가드가 디스크 쓰기를
// 드롭한다. 단일 창/모바일은 notifySessionOp 가 no-op 이라 종전 동작과 동일하다.
// filename 은 확장자 포함 파일명(경로 아님) — 호출부에서 path.split('/').pop() 처리.
export function setImageMain(
  session: Session,
  scene: GenericScene,
  filename: string,
  on: boolean,
) {
  const has = scene.mains.includes(filename);
  // 절대값 의미론 + 중복 push 방지
  if (on && !has) scene.mains.push(filename);
  else if (!on && has) scene.mains.splice(scene.mains.indexOf(filename), 1);
  // 창 간 위임: 같은 프로젝트를 연 다른 창에 절대값 op 를 전파(실패 무시).
  backend
    .notifySessionOp({
      project: session.name,
      sceneType: scene.type === 'inpaint' ? 'inpaint' : 'scene',
      sceneName: scene.name,
      filename,
      op: 'set-main',
      on,
    })
    .catch(() => {});
}

// 현재 상태를 반전(토글) — 기존 splice/push 토글 호출부를 이 헬퍼로 치환한다.
export function toggleImageMain(
  session: Session,
  scene: GenericScene,
  filename: string,
) {
  setImageMain(session, scene, filename, !scene.mains.includes(filename));
}

// 반환값: 삭제(휴지통 이동)에 실패한 파일 수.
// 실패 통지는 여기서 직접 한다 — 호출부 10여 곳이 반환값을 버려 실패가 무통지로
// 삼켜지던 문제(2026-07-26). appState 는 순환 import 회피를 위해 getAppState() 경유.
export const deleteImageFiles = async (
  curSession: Session,
  paths: string[],
  scene?: GenericScene,
): Promise<number> => {
  if (scene) {
    let failed = 0;
    try {
      // 휴지통으로 이동
      failed = await trashService.moveImagesToTrash(curSession, scene, paths);
      for (const path of paths) {
        try {
          await imageService.invalidateCache(path);
        } catch (e) {
          console.error('이미지 캐시 무효화 실패:', path, e);
        }
      }
    } finally {
      // 중간에 예외가 나도 목록 재로딩은 반드시 수행 — 안 하면 삭제된
      // 이미지가 화면에 그대로 남는다.
      await imageService.refresh(curSession, scene);
    }
    if (failed > 0) {
      try {
        getAppState().pushMessage(
          failed + '장의 이미지를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.',
        );
      } catch (e) {}
    }
    return failed;
  } else {
    // scene이 없는 경우 기존 동작 유지 (OS 휴지통)
    for (const path of paths) {
      try {
        await backend.trashFile(path);
      } catch (e) {}
      await imageService.invalidateCache(path);
    }
    await imageService.refreshBatch(curSession);
    return 0;
  }
};

export const renameImage = async (oldPath: string, newPath: string) => {
  await imageService.renameImage(oldPath, newPath);
};

export function cropMirrorResultFromDataUri(dataUri: string, mirrorCropX?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      // mirrorCropX가 유효하면 정확한 위치 사용, 해상도 불일치 시 폴백
      const half = Math.floor(w / 2);
      const cropX = (mirrorCropX && Math.abs(mirrorCropX - half) < 64)
        ? mirrorCropX
        : (half + 48);
      const cropW = w - cropX;
      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, cropX, 0, cropW, h, 0, 0, cropW, h);
      resolve(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''));
    };
    img.onerror = reject;
    img.src = dataUri;
  });
}
