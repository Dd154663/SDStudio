import React, { useEffect, useRef, useState } from 'react';
import { CharacterPosition } from '../models/types';
import { imageService } from '../models';

/**
 * 캐릭터 위치 지정 오버레이(2026-09-26, PC·모바일 공통). NovelAI 웹 V5 의 위치 지정 모드를 참고.
 *  · 위: 캐릭터 탭 줄(번호·라벨·색). 탭=선택.
 *  · 가운데: 최근 생성작 또는 빈 캔버스 위에 번호 마커. 마커 끌기=이동, 빈 곳 탭=선택한 캐릭터를 그 자리로.
 *  · 아래: 안내선 [없음|삼등분|황금비|격자](기기에 기억) · 배경 출처·좌표 · 「위치 지정 완료」.
 * 위치는 0~1 실수 그대로 저장한다(데이터·NAI 전송 형식 불변). FloatView 안에서 그린다.
 */
export interface PositionMarker {
  id: string;
  label: string;
  color: string;
  position: CharacterPosition;
  enabled: boolean;
}

export type PositionGuide = 'none' | 'thirds' | 'phi' | 'grid';
export const POSITION_GUIDE_KEY = 'sdstudio-char-pos-guide';
export const POSITION_GUIDES: { key: PositionGuide; label: string }[] = [
  { key: 'none', label: '없음' },
  { key: 'thirds', label: '삼등분' },
  { key: 'phi', label: '황금비' },
  { key: 'grid', label: '격자' },
];
/** 안내선 위치(0~1). 격자는 NAI V4 의 5×5 칸 경계. */
export const POSITION_GUIDE_LINES: Record<PositionGuide, number[]> = {
  none: [],
  thirds: [1 / 3, 2 / 3],
  phi: [0.382, 0.618],
  grid: [0.2, 0.4, 0.6, 0.8],
};

export const clampPosition = (x: number, y: number): CharacterPosition => ({
  x: Math.max(0, Math.min(1, x)),
  y: Math.max(0, Math.min(1, y)),
});

/** 상자(boxW×boxH) 안에 비율 ratio(=w/h)를 유지하며 꽉 채우는 크기. */
export const fitFrame = (
  boxW: number,
  boxH: number,
  ratio: number,
): { width: number; height: number } => {
  if (boxW <= 0 || boxH <= 0 || !(ratio > 0)) return { width: 0, height: 0 };
  if (boxW / boxH > ratio) return { width: Math.floor(boxH * ratio), height: Math.floor(boxH) };
  return { width: Math.floor(boxW), height: Math.floor(boxW / ratio) };
};

const loadGuide = (): PositionGuide => {
  try {
    const v = localStorage.getItem(POSITION_GUIDE_KEY);
    if (v && POSITION_GUIDES.some((g) => g.key === v)) return v as PositionGuide;
  } catch (e) {}
  return 'thirds';
};
const saveGuide = (g: PositionGuide) => {
  try {
    localStorage.setItem(POSITION_GUIDE_KEY, g);
  } catch (e) {}
};

interface Props {
  markers: PositionMarker[];
  onMove: (id: string, position: CharacterPosition) => void;
  onDone: () => void;
  initialSelectedId?: string;
  /** 배경 이미지 경로(없으면 빈 캔버스). */
  backgroundPath?: string;
  /** 이미지가 없을 때의 캔버스 비율. 이미지가 있으면 이미지 실제 크기를 쓴다. */
  fallbackAspect: { width: number; height: number };
  caption?: string;
}

export const CharacterPositionOverlay = ({
  markers,
  onMove,
  onDone,
  initialSelectedId,
  backgroundPath,
  fallbackAspect,
  caption,
}: Props) => {
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialSelectedId ?? markers[0]?.id,
  );
  const [guide, setGuide] = useState<PositionGuide>(loadGuide);
  const [image, setImage] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const draggingRef = useRef<string | null>(null);

  // 선택한 캐릭터가 목록에서 사라지면(삭제) 첫 캐릭터로
  useEffect(() => {
    if (selectedId && markers.some((m) => m.id === selectedId)) return;
    setSelectedId(markers[0]?.id);
  }, [markers, selectedId]);

  // 배경 이미지 로드(없거나 실패하면 빈 캔버스)
  useEffect(() => {
    let canceled = false;
    setImage(null);
    setNatural(null);
    if (!backgroundPath) return undefined;
    imageService
      .fetchImage(backgroundPath)
      .then((data) => {
        if (!canceled && data) setImage(data);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [backgroundPath]);

  // 상자 크기 추적 → 프레임을 비율대로 맞춘다
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);

  const aspect = natural ?? fallbackAspect;
  const frame = fitFrame(box.width - 8, box.height - 8, aspect.width / aspect.height);
  const selected = markers.find((m) => m.id === selectedId);

  const posFromEvent = (e: React.PointerEvent): CharacterPosition | null => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return clampPosition((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  const onFramePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const markerEl = (e.target as HTMLElement).closest('[data-char-pos-marker]') as HTMLElement | null;
    const id = markerEl?.dataset.charPosMarker || selectedId;
    if (!id) return;
    e.preventDefault();
    setSelectedId(id);
    draggingRef.current = id;
    try {
      frameRef.current?.setPointerCapture(e.pointerId);
    } catch (err) {}
    if (!markerEl) {
      // 빈 곳 탭: 선택한 캐릭터를 그 자리로
      const p = posFromEvent(e);
      if (p) onMove(id, p);
    }
  };
  const onFramePointerMove = (e: React.PointerEvent) => {
    const id = draggingRef.current;
    if (!id) return;
    const p = posFromEvent(e);
    if (p) onMove(id, p);
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    try {
      frameRef.current?.releasePointerCapture(e.pointerId);
    } catch (err) {}
  };

  const lines = POSITION_GUIDE_LINES[guide];
  // 이미지 위에서는 어두운 밑줄(3px) + 흰 선(1.2px) 두 겹으로 그려 밝은 배경에서도 보이게 한다(2026-09-26 실기 지적: 너무 희미).
  const lineStroke = image ? 'rgba(255,255,255,0.95)' : 'currentColor';
  const lineWidth = image ? 1.2 : 1;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" data-char-pos-overlay="">
      {/* 캐릭터 탭 줄 */}
      <div className="flex-none flex gap-1.5 px-3 py-2 overflow-x-auto no-scrollbar" data-char-pos-tabs="">
        {markers.map((m, i) => {
          const active = m.id === selectedId;
          return (
            <button
              key={m.id}
              type="button"
              data-pos-tab={m.id}
              aria-pressed={active}
              className={
                'flex-none flex items-center gap-1.5 rounded-lg px-2.5 h-9 text-sm btn ' +
                (active ? 'bg-[var(--c-surface-2)] text-default' : 'text-sub')
              }
              style={{
                borderBottom: `3px solid ${m.color}`,
                opacity: m.enabled ? 1 : 0.5,
              }}
              onClick={() => setSelectedId(m.id)}
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-none"
                style={{ backgroundColor: m.color }}
              >
                {i + 1}
              </span>
              <span className="max-w-[9rem] truncate">{m.label || '(빈 프롬프트)'}</span>
            </button>
          );
        })}
      </div>

      {/* 캔버스 */}
      <div ref={boxRef} className="flex-1 min-h-0 flex items-center justify-center bg-[var(--c-zone)] p-1">
        <div
          ref={frameRef}
          data-char-pos-frame=""
          data-no-scene-drag=""
          data-edge-swipe-ignore=""
          className="relative select-none overflow-hidden rounded border line-color text-faint"
          style={{
            width: frame.width || undefined,
            height: frame.height || undefined,
            touchAction: 'none',
            backgroundColor: image ? '#000' : 'var(--c-surface)',
          }}
          onPointerDown={onFramePointerDown}
          onPointerMove={onFramePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {image && (
            <img
              src={image}
              alt=""
              draggable={false}
              className="absolute inset-0 w-full h-full object-fill pointer-events-none"
              onLoad={(e) => {
                const el = e.currentTarget;
                if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                  setNatural({ width: el.naturalWidth, height: el.naturalHeight });
                }
              }}
            />
          )}
          {/* 안내선 */}
          {lines.length > 0 && (
            <svg
              data-char-pos-guide={guide}
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {image &&
                lines.map((v) => (
                  <React.Fragment key={`s${v}`}>
                    <line x1={v * 100} y1={0} x2={v * 100} y2={100} stroke="rgba(0,0,0,0.6)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                    <line x1={0} y1={v * 100} x2={100} y2={v * 100} stroke="rgba(0,0,0,0.6)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                  </React.Fragment>
                ))}
              {lines.map((v) => (
                <React.Fragment key={v}>
                  <line x1={v * 100} y1={0} x2={v * 100} y2={100} stroke={lineStroke} strokeWidth={lineWidth} vectorEffect="non-scaling-stroke" />
                  <line x1={0} y1={v * 100} x2={100} y2={v * 100} stroke={lineStroke} strokeWidth={lineWidth} vectorEffect="non-scaling-stroke" />
                </React.Fragment>
              ))}
            </svg>
          )}
          {/* 마커 */}
          {markers.map((m, i) => {
            const active = m.id === selectedId;
            return (
              <div
                key={m.id}
                data-char-pos-marker={m.id}
                className="absolute"
                style={{
                  left: `${(m.position?.x ?? 0.5) * 100}%`,
                  top: `${(m.position?.y ?? 0.5) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  cursor: 'grab',
                  zIndex: active ? 2 : 1,
                  padding: 6, // 터치 판정 여유(보이는 원은 32px)
                }}
              >
                <div
                  className={
                    'w-8 h-8 rounded-full border-2 shadow-lg flex items-center justify-center text-xs font-bold text-white ' +
                    (active ? 'border-white ring-2 ring-sky-400 scale-110' : 'border-white/80')
                  }
                  style={{ backgroundColor: m.color, opacity: m.enabled ? 1 : 0.4 }}
                >
                  {i + 1}
                </div>
              </div>
            );
          })}
          {!image && (
            <div className="absolute inset-x-0 bottom-1 text-center text-xs text-faint pointer-events-none">
              빈 화면 · {aspect.width}×{aspect.height}
            </div>
          )}
        </div>
      </div>

      {/* 설명 줄: 배경 출처 · 선택 캐릭터 좌표(아래 줄에 넣으면 좁은 폭에서 잘려 따로 둔다) */}
      <div className="flex-none px-3 pt-1 text-xs text-faint truncate" data-char-pos-caption="">
        {caption}
        {selected && (
          <span className="ml-2 text-sub">
            {selected.label ? `${selected.label.slice(0, 16)} ` : ''}
            ({(selected.position?.x ?? 0.5).toFixed(2)}, {(selected.position?.y ?? 0.5).toFixed(2)})
          </span>
        )}
      </div>
      {/* 아래 줄 */}
      <div className="flex-none flex items-center gap-2 px-3 py-2" data-char-pos-bar="">
        <div className="tab-seg flex gap-0.5 flex-none">
          {POSITION_GUIDES.map((g) => (
            <button
              key={g.key}
              type="button"
              data-char-pos-guide-btn={g.key}
              aria-pressed={guide === g.key}
              className={`round-button h-8 text-xs !px-2.5 ${guide === g.key ? 'back-sky' : 'back-llgray tab-seg-off'}`}
              onClick={() => {
                setGuide(g.key);
                saveGuide(g.key);
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button type="button" className="round-button back-sky h-9 text-sm flex-none" onClick={onDone} data-char-pos-done="">
          위치 지정 완료
        </button>
      </div>
    </div>
  );
};

export default CharacterPositionOverlay;
