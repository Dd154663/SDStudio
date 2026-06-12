import { observable, makeObservable, runInAction } from 'mobx';
import { backend } from '.';

export interface TagScore {
  tag: string;
  score: number;
}

export interface WdResult {
  rating: TagScore[];
  general: TagScore[];
  character: TagScore[];
}

export type WdModelKey = 'wd-swinv2' | 'wd-eva02';
export type ArtistModelKey = 'kaloscope' | WdModelKey;

// 모델 자산 정의. 파일은 APP_DIR/models/ 에 저장된다 (LocalAI 모델과 같은 폴더).
// WD 두 모델은 태그 CSV가 동일(바이트 단위 확인됨)해서 같은 파일을 공유한다.
export const ARTIST_MODELS: Record<
  ArtistModelKey,
  { label: string; sizeText: string; files: { url: string; name: string }[] }
> = {
  kaloscope: {
    label: '작가 분석 모델 (Kaloscope 2.0)',
    sizeText: '약 700MB',
    files: [
      {
        url: 'https://huggingface.co/DraconicDragon/Kaloscope-onnx/resolve/main/v2.0/kaloscope_2-0.onnx?download=true',
        name: 'kaloscope_2-0.onnx',
      },
      {
        url: 'https://huggingface.co/DraconicDragon/Kaloscope-onnx/resolve/main/v2.0/class_mapping.csv?download=true',
        name: 'kaloscope_class_mapping.csv',
      },
    ],
  },
  'wd-swinv2': {
    label: 'WD SwinV2 Tagger v3 (권장 · 빠름)',
    sizeText: '약 450MB',
    files: [
      {
        url: 'https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3/resolve/main/model.onnx?download=true',
        name: 'wd-swinv2-v3.onnx',
      },
      {
        url: 'https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3/resolve/main/selected_tags.csv?download=true',
        name: 'wd_selected_tags.csv',
      },
    ],
  },
  'wd-eva02': {
    label: 'WD EVA02-Large Tagger v3 (정밀 · 무거움)',
    sizeText: '약 1.2GB',
    files: [
      {
        url: 'https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/resolve/main/model.onnx?download=true',
        name: 'wd-eva02-large-v3.onnx',
      },
      {
        url: 'https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/resolve/main/selected_tags.csv?download=true',
        name: 'wd_selected_tags.csv',
      },
    ],
  },
};

/**
 * 아티스트 태깅 서비스 (데스크톱 전용)
 *
 * - 모델 설치 상태 확인/다운로드 (backend.download + 전역 download-progress 이벤트)
 * - WD 태거는 SwinV2(기본)/EVA02-Large 중 선택 가능, 선택은 config에 영구 저장
 * - 분석 호출 (Electron main의 onnxruntime-node 추론)
 * - 시작 시 비용 없음 — statsModels()는 모달이 열릴 때 지연 호출된다.
 */
export class ArtistTagService {
  @observable accessor installed: Record<ArtistModelKey, boolean> = {
    kaloscope: false,
    'wd-swinv2': false,
    'wd-eva02': false,
  };

  @observable accessor downloading: ArtistModelKey | null = null;

  @observable accessor downloadPercent: number = 0;

  // 사용할 WD 태거 모델 (config.wdTaggerModel로 영구 저장, 기본 swinv2)
  @observable accessor wdModel: WdModelKey = 'wd-swinv2';

  private prefLoaded = false;

  constructor() {
    makeObservable(this);
  }

  private async loadPref(): Promise<void> {
    if (this.prefLoaded) return;
    this.prefLoaded = true;
    try {
      const config = await backend.getConfig();
      if (
        config.wdTaggerModel === 'wd-eva02' ||
        config.wdTaggerModel === 'wd-swinv2'
      ) {
        runInAction(() => {
          this.wdModel = config.wdTaggerModel as WdModelKey;
        });
      }
    } catch (e) {}
  }

  async setWdModel(model: WdModelKey): Promise<void> {
    runInAction(() => {
      this.wdModel = model;
    });
    try {
      const config = await backend.getConfig();
      config.wdTaggerModel = model;
      await backend.setConfig(config);
    } catch (e) {
      console.error('WD 태거 모델 설정 저장 실패:', e);
    }
  }

  async statsModels(): Promise<void> {
    await this.loadPref();
    for (const key of Object.keys(ARTIST_MODELS) as ArtistModelKey[]) {
      let ok = true;
      for (const f of ARTIST_MODELS[key].files) {
        try {
          if (!(await backend.existFile('models/' + f.name))) {
            ok = false;
            break;
          }
        } catch {
          ok = false;
          break;
        }
      }
      runInAction(() => {
        this.installed[key] = ok;
      });
    }
  }

  async download(key: ArtistModelKey): Promise<void> {
    if (this.downloading) return;
    runInAction(() => {
      this.downloading = key;
      this.downloadPercent = 0;
    });
    // 전역 download-progress 이벤트 구독 (다운로드 중에만)
    const off = backend.onDownloadProgress((p: any) => {
      runInAction(() => {
        this.downloadPercent = Math.round((p?.percent ?? 0) * 100);
      });
    });
    try {
      for (const f of ARTIST_MODELS[key].files) {
        await backend.download(f.url, 'models', f.name);
      }
      await this.statsModels();
    } finally {
      off();
      runInAction(() => {
        this.downloading = null;
        this.downloadPercent = 0;
      });
    }
  }

  async analyzeArtists(dataUri: string): Promise<TagScore[]> {
    const imageBase64 = dataUri.split(',')[1] ?? dataUri;
    const res = await backend.analyzeArtistTags({
      imageBase64,
      model: 'kaloscope',
    });
    return res.artists ?? [];
  }

  async analyzeWd(dataUri: string): Promise<WdResult> {
    const imageBase64 = dataUri.split(',')[1] ?? dataUri;
    return await backend.analyzeArtistTags({
      imageBase64,
      model: this.wdModel,
    });
  }
}
