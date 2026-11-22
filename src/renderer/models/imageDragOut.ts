// 이미지를 끌어서 다른 프로그램(탐색기·메신저·이미지 편집기 등)에 파일로 놓기 — PC 공용 헬퍼(2026-11-22).
//
// 쓰는 법: 이미지 요소에 펼쳐 붙인다. 모바일(그리고 경로가 없을 때)은 빈 객체라 기존 속성이 그대로 남는다.
//   <img src={...} draggable={false} {...imageDragOutProps(path)} />            // 그냥 끌면 밖으로
//   <div ... {...imageDragOutProps(path, { modifier: true })} />                 // 보조 키를 누른 채 끌 때만
//
// - path = 저장소(데이터 루트) 기준 상대 경로(이미지 그리드·히스토리가 쓰는 그 경로). 원본 파일을 끈다 —
//   옮기거나 지우지 않는다(받는 쪽이 복사). main 이 경로를 다시 확인한다(src/main/imageDragOut.ts).
// - 동작: dragstart 를 preventDefault(브라우저 자체 끌기·react-dnd 시작을 막음 — react-dnd HTML5 백엔드는
//   defaultPrevented 인 dragstart 를 무시한다) → backend.startImageDragOut(path) → main 이 webContents.startDrag.
// - modifier: true = 보조 키(Windows·Linux = Ctrl, mac = Option)를 누른 채 끌 때만 밖으로 끈다. 보조 키 없이 끌면
//   이 헬퍼는 아무것도 하지 않는다(그 자리의 기존 끌기 — 예: 이미지 그리드 순서 바꾸기 — 가 그대로 동작).
//   이 모드는 draggable 을 붙이지 않는다(그 자리가 이미 끌 수 있는 요소라는 전제).
//   Ctrl 을 고른 이유: 탐색기에서 Ctrl 을 누른 채 놓으면 「복사」(Alt 는 「바로 가기 만들기」), mac Finder 는 Option 이 복사.
// - 끄는 동안(그리고 끝난 직후 잠깐)은 isImageDragOutActive() 가 true — 앱 전체 「파일을 놓아 불러오기」 안내·처리와
//   끈 칸의 클릭(미리 보기 열기 등)을 건너뛰는 데 쓴다(onClickCapture 를 함께 붙인다).
import type React from 'react';
import { platform } from './platform';
import { backend } from './index';

/** 끌기가 끝난 뒤에도 「끄는 중」으로 보는 시간(ms) — 놓은 직후 같은 칸에 들어오는 클릭을 삼킨다. */
export const DRAG_OUT_GRACE_MS = 400;
/** 끌기 끝 신호(IPC 응답)가 오지 않을 때의 안전 해제 시간(ms). */
export const DRAG_OUT_SAFETY_MS = 60_000;

export interface ImageDragOutOptions {
  /** true = 보조 키(Windows·Linux Ctrl, mac Option)를 누른 채 끌 때만. 기존 끌기가 있는 자리용. */
  modifier?: boolean;
}

export interface ImageDragOutProps {
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLElement>) => void;
  onClickCapture?: (e: React.MouseEvent<HTMLElement>) => void;
}

export interface ImageDragOutDeps {
  enabled: boolean;
  isMac: boolean;
  start: (path: string) => Promise<boolean>;
  now?: () => number;
}

let activeCount = 0;
let lastEndAt = -Infinity;

/** 앱 안에서 시작한 「밖으로 끌기」가 진행 중(또는 막 끝남)인지. */
export function isImageDragOutActive(now: number = Date.now()): boolean {
  return activeCount > 0 || now - lastEndAt < DRAG_OUT_GRACE_MS;
}

/** 테스트 전용 — 상태 초기화. */
export function resetImageDragOutStateForTest(): void {
  activeCount = 0;
  lastEndAt = -Infinity;
}

/** 보조 키 판정 — Windows·Linux = Ctrl, mac = Option(Alt). */
export function isDragOutModifier(
  e: { ctrlKey?: boolean; altKey?: boolean },
  isMac: boolean,
): boolean {
  return isMac ? !!e.altKey : !!e.ctrlKey;
}

/** 의존성을 주입받는 본체(테스트용). 화면에서는 imageDragOutProps 를 쓴다. */
export function makeImageDragOutProps(
  path: string | undefined | null,
  opts: ImageDragOutOptions,
  deps: ImageDragOutDeps,
): ImageDragOutProps {
  if (!deps.enabled || !path) return {};
  const now = deps.now ?? Date.now;
  const onDragStart = (e: React.DragEvent<HTMLElement>) => {
    if (opts.modifier && !isDragOutModifier(e, deps.isMac)) return;
    e.preventDefault();
    e.stopPropagation();
    activeCount++;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      activeCount = Math.max(0, activeCount - 1);
      lastEndAt = now();
      clearTimeout(safety);
    };
    const safety = setTimeout(end, DRAG_OUT_SAFETY_MS);
    let p: Promise<boolean>;
    try {
      p = deps.start(path);
    } catch (err) {
      console.warn('[imageDragOut] 끌기 시작 실패', err);
      end();
      return;
    }
    Promise.resolve(p)
      .catch((err) => {
        console.warn('[imageDragOut] 끌기 시작 실패', err);
        return false;
      })
      .finally(end);
  };
  const onClickCapture = (e: React.MouseEvent<HTMLElement>) => {
    if (!isImageDragOutActive(now())) return;
    e.preventDefault();
    e.stopPropagation();
  };
  return opts.modifier
    ? { onDragStart, onClickCapture }
    : { draggable: true, onDragStart, onClickCapture };
}

/**
 * 이미지 요소에 펼쳐 붙일 끌기 속성. PC 가 아니면(모바일)·경로가 없으면 빈 객체.
 * 기존 `draggable={false}` 뒤에 펼치면 PC 에서만 끌 수 있게 바뀐다.
 */
export function imageDragOutProps(
  path: string | undefined | null,
  opts: ImageDragOutOptions = {},
): ImageDragOutProps {
  return makeImageDragOutProps(path, opts, {
    enabled: platform.supportsImageDragOut,
    isMac: platform.isMac,
    start: (p) => backend.startImageDragOut(p),
  });
}
