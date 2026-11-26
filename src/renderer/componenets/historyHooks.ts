// 히스토리 목록·크게 보기·뷰어가 같이 쓰는 훅(2026-11-26 히스토리 확대).
// 상태 전이·크기 계산은 models/progressiveImage.ts·models/historyLayout.ts(순수) — 여기는 읽기·측정만 잇는다.
import { RefObject, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import ResizeObserver from 'resize-observer-polyfill';
import { imageService } from '../models';
import { AspectMemo } from '../models/historyLayout';
import {
  initialProgressiveImageState,
  progressiveImageReducer,
  ProgressiveImageState,
} from '../models/progressiveImage';

/** 경로 → 잰 비율(앱 실행 동안만). 패널 목록·크게 보기·세로 보기 공용 */
export const historyAspectMemo = new AspectMemo();
/** 「세션/종류/씬」 → 씬 해상도 비율(세로 보기의 읽기 전 추정용) */
export const historySceneAspectMemo = new AspectMemo();

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * 요소 크기(ResizeObserver). 0 이면(아직 배치 전·테스트 환경) fallback 을 쓴다 —
 * 가상 목록이 0 크기로 아무것도 그리지 않는 일이 없게.
 */
export function useElementSize(ref: RefObject<HTMLElement>, fallback: ElementSize): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setSize({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return {
    width: size.width > 0 ? size.width : fallback.width,
    height: size.height > 0 ? size.height : fallback.height,
  };
}

/**
 * 작은 그림(thumbSize 썸네일) 먼저 → 원본으로 바꿔 끼우기. wantFull 이 거짓이면 썸네일만 읽고, 참이 되면 그때 원본을 읽는다.
 * 경로가 바뀌면 새 읽기를 시작하고, 늦게 도착한 이전 경로의 응답은 리듀서가 무시한다.
 * 파일이 없으면(썸네일·원본 읽기 결과 null) onMissing 을 지금 경로에 대해 한 번 부른다.
 */
export function useProgressiveImage(
  path: string | undefined,
  wantFull: boolean,
  opts: { thumbSize?: number; onMissing?: () => void } = {},
): ProgressiveImageState {
  const [state, dispatch] = useReducer(progressiveImageReducer, initialProgressiveImageState);
  const keyRef = useRef(0);
  const fullAskedRef = useRef(-1);
  const missingReportedRef = useRef(-1);
  const wantFullRef = useRef(wantFull);
  wantFullRef.current = wantFull;
  const onMissingRef = useRef(opts.onMissing);
  onMissingRef.current = opts.onMissing;
  const thumbSize = opts.thumbSize ?? 400;

  const reportMissing = (key: number) => {
    dispatch({ type: 'missing', key });
    if (key !== keyRef.current || missingReportedRef.current === key) return;
    missingReportedRef.current = key;
    onMissingRef.current?.();
  };

  const requestFull = (key: number, p: string) => {
    fullAskedRef.current = key;
    imageService
      .fetchImage(p)
      .then((data) => {
        if (!data) reportMissing(key);
        else dispatch({ type: 'full', key, src: data });
      })
      .catch(() => dispatch({ type: 'fail', key }));
  };

  useEffect(() => {
    if (!path) return;
    const key = ++keyRef.current;
    dispatch({ type: 'start', key });
    imageService
      .fetchImageSmall(path, thumbSize)
      .then((data) => {
        if (data) dispatch({ type: 'thumb', key, src: data });
        else reportMissing(key);
      })
      .catch(() => dispatch({ type: 'fail', key }));
    if (wantFullRef.current) requestFull(key, path);
  }, [path, thumbSize]);

  useEffect(() => {
    if (!path || !wantFull) return;
    if (fullAskedRef.current === keyRef.current) return;
    requestFull(keyRef.current, path);
  }, [wantFull, path]);

  return state;
}
