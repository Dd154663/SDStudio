import { Config } from '../main/config';
import {
  EncodeVibeImageInput,
  ImageAugmentInput,
  ImageGenInput,
  LoginValidity,
} from './backends/imageGen';

export interface FileEntry {
  name: string;
  path: string;
}

export enum ImageOptimizeMethod {
  LOSSY = 1,
  LOSSLESS = 2,
  AVIF = 3,
}

export interface ResizeImageInput {
  inputPath: string;
  outputPath: string;
  maxWidth: number;
  maxHeight: number;
  optimize?: ImageOptimizeMethod;
  // 최적화 품질(1~100). 미지정 시 종전 기본값(webp 80·avif 50). lossless 는 무시.
  // 데스크톱 전용 — Android 리사이저는 리사이즈만 하고 이 값을 사용하지 않는다.
  quality?: number;
  // NAI 알파 stealth 워터마크 보존(webp 전용, 데스크톱 전용). 리사이즈로 파괴되는
  // 워터마크를 추출→재삽입해 NAI 인스펙터 인식을 유지한다. raw 재인코딩으로 느려짐.
  preserveStealth?: boolean;
}

export interface FileStatEntry {
  name: string;
  size: number;
  mtime: number;
}

export abstract class Backend {
  abstract getConfig(): Promise<Config>;
  abstract setConfig(newConfig: Config): Promise<void>;
  abstract getVersion(): Promise<string>;
  abstract openWebPage(url: string): Promise<void>;
  abstract generateImage(arg: ImageGenInput): Promise<void>;
  abstract augmentImage(arg: ImageAugmentInput): Promise<void>;
  abstract login(email: string, password: string): Promise<void>;
  abstract loginWithToken(token: string): Promise<void>;
  // 저장된 토큰이 실제로 유효한지 NovelAI API로 검증 (단순 파일 존재 확인이 아님)
  abstract validateLogin(): Promise<LoginValidity>;
  abstract encodeVibeImage(arg: EncodeVibeImageInput): Promise<string>;
  abstract showFile(arg: string): Promise<void>;
  abstract copyToDownloads(path: string): Promise<void>;
  abstract zipFiles(files: FileEntry[], outPath: string): Promise<void>;
  abstract unzipFiles(tarPath: string, outPath: string): Promise<void>;
  // 데이터 루트가 위치한 볼륨의 여유 공간(bytes). 조회 불가/미지원이면 null
  // (= "알 수 없음"). 트랙1 (b) 마이그레이션 백업 게이트의 공간 판정용.
  abstract getFreeSpace(): Promise<number | null>;
  // 런타임 진단(감지 코어 수·실효 libuv 스레드풀 크기). 데스크톱 전용 — 모바일은
  // libuv 스레드풀 개념이 없어 null(="해당 없음"). 이미지 병렬 상한 확인용.
  abstract getRuntimeDiag(): Promise<{ cpus: number; uvThreadpool: number } | null>;
  // 부팅 경고 조회 — 사용자 지정 저장 경로 접근 실패로 기본 경로로 폴백했는지 등을
  // 렌더러가 부팅 후 1회 조회해 사용자에게 안내한다. 데스크톱 전용(모바일은 null).
  abstract getBootWarnings(): Promise<{
    saveLocationFallback: { attempted: string; code: string } | null;
  } | null>;
  // 폴더가 실제 쓰기 가능한지 사전 검증(저장 경로 지정 전). 권한 없는 드라이브를
  // 저장 경로로 지정해 다음 부팅이 벽돌화되는 것을 예방. 데스크톱 전용(모바일은 항상 ok).
  abstract checkWritable(absolutePath: string): Promise<{ ok: boolean; code?: string }>;
  abstract searchTags(word: string): Promise<any>;
  abstract lookupTag(word: string): Promise<any>;
  abstract loadPiecesDB(pieces: string[]): Promise<void>;
  abstract searchPieces(word: string): Promise<any>;
  abstract listFiles(arg: string): Promise<string[]>;
  abstract listFilesWithStats(arg: string): Promise<FileStatEntry[]>;
  abstract readFile(filename: string): Promise<string>;
  abstract writeFile(filename: string, data: string): Promise<void>;
  abstract copyFile(src: string, dest: string): Promise<void>;
  // src(APP_DIR 상대경로)를 절대경로 dest 로 복사. 데스크톱 export 목표 폴더용.
  abstract copyFileToAbsolute(src: string, absoluteDest: string): Promise<void>;
  // 생성 이미지 PNG(src) → WebP(dest) 변환. NAI 프롬프트 메타데이터를 EXIF 로 이월. 데스크톱 전용.
  abstract convertToWebp(src: string, dest: string, quality: number): Promise<void>;
  abstract readDataFile(arg: string): Promise<string>;
  abstract writeDataFile(filename: string, data: string): Promise<void>;
  abstract writeDataFileAbsolute(absolutePath: string, data: string): Promise<void>;
  abstract existFileAbsolute(absolutePath: string): Promise<boolean>;
  abstract renameFile(oldfile: string, newfile: string): Promise<void>;
  abstract renameDir(oldfile: string, newfile: string): Promise<void>;
  abstract deleteFile(filename: string): Promise<void>;
  abstract deleteDir(filename: string): Promise<void>;
  abstract trashFile(filename: string): Promise<void>;
  abstract selectDir(): Promise<string | undefined>;
  abstract selectFile(): Promise<string | undefined>;
  abstract selectFiles(options?: { filters?: { name: string; extensions: string[] }[] }): Promise<string[]>;
  abstract readBinaryFile(filePath: string): Promise<string>;
  abstract close(): Promise<void>;
  // 앱 재시작 — 저장소 마이그레이션 재개 버튼용. 데스크톱=정상 종료 경로(close
  // 인터셉트의 종료 시 저장 보장) 후 자동 재실행, 모바일=WebView reload(부트스트랩 재실행).
  abstract restartApp(): Promise<void>;
  abstract existFile(filename: string): Promise<boolean>;
  abstract download(url: string, dest: string, filename: string): Promise<void>;
  abstract resizeImage(input: ResizeImageInput): Promise<void>;
  abstract openImageEditor(inputPath: string): Promise<void>;
  abstract watchImage(inputPath: string): Promise<void>;
  abstract unwatchImage(inputPath: string): Promise<void>;
  abstract loadModel(modelPath: string): Promise<void>;
  abstract extractZip(zipPath: string, outPath: string): Promise<void>;
  abstract copyImageToClipboard(imagePath: string): Promise<void>;
  abstract spawnLocalAI(): Promise<void>;
  abstract isLocalAIRunning(): Promise<boolean>;
  abstract getRemainCredits(): Promise<number>;
  abstract removeBackground(
    inputImageBase64: string,
    outputPath: string,
  ): Promise<void>;
  // 아티스트 태깅 (로컬 ONNX 추론, 데스크톱 전용)
  abstract analyzeArtistTags(arg: {
    imageBase64: string;
    model: 'kaloscope' | 'wd-swinv2' | 'wd-eva02';
  }): Promise<any>;
  abstract onDownloadProgress(callback: (progress: any) => void): () => void;
  abstract onZipProgress(callback: (progress: any) => void): () => void;
  abstract onImageChanged(callback: (path: string) => void): () => void;
  abstract onClose(callback: () => void): () => void;
  // 텍스트 드래그 후 우클릭 → "Danbooru로 검색" (데스크톱 전용, 모바일은 no-op)
  abstract onDanbooruSearch(callback: (text: string) => void): () => void;

  // 모바일 백그라운드(포그라운드 서비스) 알림 내용 갱신.
  // 기본은 no-op이며 안드로이드 백엔드에서만 실제 구현한다.
  async updateBackgroundNotification(
    _title: string,
    _text: string,
  ): Promise<void> {}

  // 새 창 열기 — 데스크톱(Electron)에서 보조 창(멀티 윈도우, W6)을 연다.
  // projectName 을 주면 새 창이 부팅 후 그 프로젝트를 연다("새 창에서 열기").
  // 기본은 no-op(모바일은 단일 WebView라 창 개념 없음) — 데스크톱 백엔드에서만 구현.
  async openNewWindow(_projectName?: string): Promise<void> {}

  // ─── 프로젝트 배타 락 (W6 P1) ───
  // 데스크톱 멀티 윈도우에서 같은 프로젝트의 이중 열기를 차단한다.
  // 모바일/단일 창은 락 개념이 없으므로 기본 구현은 "항상 성공" no-op.
  async acquireProjectLock(_name: string): Promise<boolean> {
    return true;
  }
  async releaseProjectLock(_name: string): Promise<void> {}
  async queryProjectLock(
    _name: string,
  ): Promise<{ locked: boolean; mine: boolean }> {
    return { locked: false, mine: false };
  }
  // notice 를 주면 안내 토스트가 요청 창이 아닌 **소유 창**에 표시된다
  // (포커스가 소유 창으로 넘어가므로 안내도 도착한 창에서 보이는 게 자연스럽다).
  async focusProjectLockOwner(_name: string, _notice?: string): Promise<void> {}
  // 락 소유 창으로 전달된 안내 수신 — 기본 no-op(모바일/단일 창).
  onLockOwnerNotice(_callback: (message: string) => void): () => void {
    return () => {};
  }

  // "새 창에서 열기"로 이 창에 예치된 초기 프로젝트 이름(1회성) — 없으면 null.
  async takeInitialProject(): Promise<string | null> {
    return null;
  }

  // ─── 전역 저장소 동기화 (W6 P2) ───
  // 창 공유 저장소(글로벌 캐릭터 프리셋·휴지통·세션 메타 등)를 저장한 뒤 다른
  // 창들에 알린다(낙관적 쓰기 + 브로드캐스트). 기본 no-op(모바일/단일 창).
  async notifyGlobalStoreChanged(_key: string): Promise<void> {}
  // 다른 창의 전역 저장소 변경 수신 — 수신 창은 해당 저장소를 디스크에서 재로드.
  onGlobalStoreChanged(_callback: (key: string) => void): () => void {
    return () => {};
  }

  // ─── 생성 위임: 단일 생성 호스트 (W6 P3) ───
  // 데스크톱 멀티 윈도우에서 모든 창의 생성을 "호스트 창" 큐 하나로 일원화한다.
  // 기본 구현은 "항상 자기 창이 호스트" — 단일 창·모바일은 위임 경로를 아예 타지
  // 않으므로 종전 동작과 100% 동일하다(최우선 회귀 기준). payload/snapshot 은 IPC
  // 구조적 복제로 넘어가는 순수 JSON 이라 여기선 느슨한 타입(any)으로 둔다.
  async isGenerationHost(): Promise<boolean> {
    return true;
  }
  onGenerationHostChanged(_callback: (isHost: boolean) => void): () => void {
    return () => {};
  }
  onGenerationPeerCount(_callback: (count: number) => void): () => void {
    return () => {};
  }
  // 보조 창 → 호스트
  async delegateTask(_payload: any): Promise<void> {}
  async delegateCancel(_payload: any): Promise<void> {}
  async delegateRun(): Promise<void> {}
  async delegateStop(): Promise<void> {}
  onDelegateTask(_callback: (payload: any) => void): () => void {
    return () => {};
  }
  onDelegateCancel(_callback: (payload: any) => void): () => void {
    return () => {};
  }
  onDelegateRun(_callback: () => void): () => void {
    return () => {};
  }
  onDelegateStop(_callback: () => void): () => void {
    return () => {};
  }
  // 호스트 → 원 창(완료·실패) / 호스트 → 보조 창들(상태 미러)
  async delegateComplete(_payload: any): Promise<void> {}
  async delegateQueueSnapshot(_snapshot: any): Promise<void> {}
  onDelegateComplete(_callback: (payload: any) => void): () => void {
    return () => {};
  }
  onDelegateQueueSnapshot(_callback: (snapshot: any) => void): () => void {
    return () => {};
  }
}
