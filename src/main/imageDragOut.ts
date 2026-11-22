/**
 * 앱 안의 이미지를 끌어서 다른 프로그램(탐색기·메신저·편집기 등)에 파일로 놓기 — PC 전용(2026-11-22).
 *
 * 렌더러가 `dragstart` 를 막고(preventDefault) 저장소 기준 상대 경로를 IPC `start-image-drag-out` 로 보내면
 * main 이 `webContents.startDrag({ file, icon })` 로 OS 파일 끌기(Windows = CF_HDROP)를 시작한다.
 * 원본 파일은 옮기거나 지우지 않는다(받는 쪽이 복사해 간다).
 *
 * 렌더러가 보낸 경로를 그대로 믿지 않는다 — 아래 셋을 모두 만족할 때만 끈다(하나라도 아니면 아무것도 하지 않음).
 *  ① 앱 데이터 루트(APP_DIR) 안으로 해석될 것(`..`·절대 경로·다른 드라이브로 밖을 가리키면 거부, 루트 자체도 거부)
 *  ② 실제로 존재하는 일반 파일일 것(폴더·없는 파일 거부)
 *  ③ 이미지 확장자(`imageFormats.DRAG_OUT_IMAGE_EXTS` — png·webp·jpg·jpeg)일 것
 *
 * 끌기 아이콘 = 그 이미지의 작은 축소본. png·jpg 는 nativeImage 로 바로, webp(nativeImage 가 못 읽음)는 sharp 로
 * 잠깐(제한 시간 안에) 만들고, 실패·빈 그림이면 앱 아이콘. 빈 아이콘은 Electron 이 오류를 내므로 끝내 비면 끌지 않는다.
 *
 * electron 에 의존하지 않는다 — 파일 확인·그림 만들기는 주입한다(jest 는 가짜로만 확인).
 */
import path from 'path';
import { isSameOrInside } from './installDirGuard';
import { isDragOutImageFile } from '../renderer/models/imageFormats';

export const IMAGE_DRAG_OUT_CHANNEL = 'start-image-drag-out';

/** 끌기 아이콘 한 변 최대 크기(px). */
export const DRAG_ICON_SIZE = 96;
/** webp 축소본을 기다리는 최대 시간(ms) — 넘으면 앱 아이콘(끌기가 늦게 시작되지 않게). */
export const DRAG_ICON_TIMEOUT_MS = 150;

export interface DragOutFileDeps {
  /** 일반 파일이면 true. 없음·폴더·읽기 오류는 false(던지지 않음). */
  isFile: (absPath: string) => boolean;
  platform?: NodeJS.Platform;
}

/**
 * 렌더러가 보낸 경로 → 끌어도 되는 절대 경로. 안 되면 null.
 * relPath 는 저장소(데이터 루트) 기준 상대 경로(`outs/…/a.png`, `workspace/…/a.webp`).
 */
export function resolveDragOutFile(
  appDir: string,
  relPath: unknown,
  deps: DragOutFileDeps,
): string | null {
  if (typeof appDir !== 'string' || appDir === '') return null;
  if (typeof relPath !== 'string' || relPath.trim() === '') return null;
  if (relPath.includes('\0')) return null;
  const platform = deps.platform ?? process.platform;
  const p = platform === 'win32' ? path.win32 : path.posix;
  // 상대 경로만 받는다 — 절대 경로(드라이브 문자·UNC·`/` 시작)는 루트 안이어도 거부(렌더러는 항상 상대 경로를 쓴다).
  if (p.isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) return null;
  const abs = p.resolve(appDir, relPath);
  // ① 루트 안(루트 자체는 제외)
  if (!isSameOrInside(abs, appDir, platform)) return null;
  const rootResolved = p.resolve(appDir);
  const same =
    platform === 'win32'
      ? abs.toLowerCase() === rootResolved.toLowerCase()
      : abs === rootResolved;
  if (same) return null;
  // ③ 이미지 확장자
  if (!isDragOutImageFile(p.basename(abs))) return null;
  // ② 실제 일반 파일
  let file = false;
  try {
    file = deps.isFile(abs);
  } catch {
    file = false;
  }
  return file ? abs : null;
}

/** nativeImage 의 필요한 부분만(테스트에서 가짜로 바꾼다). */
export interface DragIconLike {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(opts: { width?: number; height?: number }): DragIconLike;
}

export interface DragIconDeps<T extends DragIconLike> {
  /** nativeImage.createFromPath */
  fromPath: (absPath: string) => T;
  /** nativeImage.createFromBuffer */
  fromBuffer: (buf: Buffer) => T;
  /** webp 등 nativeImage 가 못 읽는 형식의 작은 PNG 축소본(sharp). 없으면 건너뜀. */
  thumbnailPng?: (absPath: string, size: number) => Promise<Buffer>;
  /** 앱 아이콘 등 대체 아이콘 경로. */
  fallbackPath: string;
  timeoutMs?: number;
}

function shrink<T extends DragIconLike>(img: T): T {
  const { width, height } = img.getSize();
  if (width <= DRAG_ICON_SIZE && height <= DRAG_ICON_SIZE) return img;
  const opts = width >= height ? { width: DRAG_ICON_SIZE } : { height: DRAG_ICON_SIZE };
  return img.resize(opts) as T;
}

function usable<T extends DragIconLike>(img: T | undefined | null): img is T {
  try {
    return !!img && !img.isEmpty();
  } catch {
    return false;
  }
}

/**
 * 끌기 아이콘을 만든다. 끝내 빈 그림이면 null(호출부는 끌지 않는다 — 빈 아이콘은 Electron 오류).
 */
export async function buildDragOutIcon<T extends DragIconLike>(
  absPath: string,
  deps: DragIconDeps<T>,
): Promise<T | null> {
  const ext = path.extname(absPath).toLowerCase();
  // 1) png·jpg — nativeImage 가 바로 읽는다(동기, 스레드 풀을 쓰지 않음).
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
    try {
      const img = deps.fromPath(absPath);
      if (usable(img)) {
        const small = shrink(img);
        if (usable(small)) return small;
      }
    } catch {
      /* 대체 아이콘으로 */
    }
  } else if (deps.thumbnailPng) {
    // 2) webp — sharp 축소본. 스레드 풀이 바쁘면(일괄 변환 중) 오래 걸릴 수 있어 제한 시간을 둔다.
    try {
      const timeoutMs = deps.timeoutMs ?? DRAG_ICON_TIMEOUT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const buf = await Promise.race<Buffer | null>([
        deps.thumbnailPng(absPath, DRAG_ICON_SIZE).catch(() => null),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (buf) {
        const img = deps.fromBuffer(buf);
        if (usable(img)) return shrink(img);
      }
    } catch {
      /* 대체 아이콘으로 */
    }
  }
  // 3) 앱 아이콘
  try {
    const fb = deps.fromPath(deps.fallbackPath);
    if (usable(fb)) {
      const small = shrink(fb);
      return usable(small) ? small : fb;
    }
  } catch {
    /* 없음 */
  }
  return null;
}
