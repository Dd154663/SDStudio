import { backend } from '.';
import { platform } from './platform';
import { getPlatform } from './util';

async function getLocalAIDownloadLink() {
  const platform = await getPlatform();
  const version = await backend.getVersion();
  return `https://huggingface.co/mathneko/localai/resolve/main/LocalAI-${platform}.zip?download=true`;
}
const QUALITY_DOWNLOAD_LINK =
  'https://github.com/sunho/BiRefNet/releases/download/sdstudio/quality';

export class LocalAIService extends EventTarget {
  downloading: boolean;
  modelLoaded: boolean;
  ready: boolean;
  constructor() {
    super();
    this.downloading = false;
    this.modelLoaded = false;
    this.ready = false;
  }

  notifyDownloadProgress(percent: number) {
    this.dispatchEvent(new CustomEvent('progress', { detail: { percent } }));
  }

  modelChanged() {
    this.modelLoaded = false;
  }

  async download() {
    // 리눅스용 LocalAI 바이너리는 배포되지 않는다 — UI 에서도 막지만 이중 방어.
    if (!platform.supportsRemoveBg) {
      console.error('LocalAI is not supported on this platform.');
      return;
    }
    this.downloading = true;
    try {
      await backend.deleteFile('tmp/localai.zip');
    } catch (e) {}
    try {
      await backend.deleteDir('localai');
    } catch (e) {}
    try {
      await backend.deleteDir('models');
    } catch (e) {}
    try {
      let ldl = await getLocalAIDownloadLink();
      this.dispatchEvent(new CustomEvent('stage', { detail: { stage: 0 } }));
      await backend.download(ldl, 'tmp', 'localai.zip');
      this.dispatchEvent(new CustomEvent('stage', { detail: { stage: 1 } }));
      await backend.download(QUALITY_DOWNLOAD_LINK, 'models', 'quality');
      this.dispatchEvent(new CustomEvent('stage', { detail: { stage: 2 } }));
      await backend.extractZip('tmp/localai.zip', '');
      await this.statsModels();
    } catch (e: any) {
      console.error(e);
    } finally {
      this.downloading = false;
    }
  }

  async spawnLocalAI() {
    const running = await backend.isLocalAIRunning();
    if (running) {
      return;
    }
    await backend.spawnLocalAI();
  }

  async statsModels() {
    const avail: any = {
      fast: false,
      quality: false,
    };
    let availExec = false;
    try {
      availExec = await backend.existFile('localai');
    } catch (e: any) {
      console.error(e);
    }
    for (const model of ['fast', 'quality']) {
      try {
        avail[model] = await backend.existFile('models/' + model);
      } catch (e: any) {
        console.error(e);
      }
    }
    if (availExec && avail.quality) {
      this.ready = true;
      this.spawnLocalAI();
    } else {
      this.ready = false;
    }
    this.dispatchEvent(new CustomEvent('updated', {}));
  }

  async loadModel() {
    const running = await backend.isLocalAIRunning();
    if (!this.ready || !running) throw new Error('Local AI not ready');
    const modelType = 'quality';
    this.modelLoaded = false;
    await backend.loadModel('models/' + modelType);
    this.modelLoaded = true;
  }

  async removeBg(image: string, outputFilePath: string) {
    if (!this.modelLoaded) await this.loadModel();
    await backend.removeBackground(image, outputFilePath);
  }
}
