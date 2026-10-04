import {
  ReactNode,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useInsertionEffect,
  useRef,
  useState,
} from 'react';
import { MaskCanvasInputs, maskCanvasAction } from '../models/maskCanvasSync';

export function base64ToDataUri(data: string) {
  return 'data:image/png;base64,' + data;
}

export function getImageDimensions(
  base64: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.width;
      const height = img.height;
      resolve({ width, height });
    };
    img.onerror = reject;
    img.src = base64ToDataUri(base64);
  });
}

export function maskToBase64(
  image: ImageData,
  width: number,
  height: number,
): string {
  const bitmap = new Uint8ClampedArray(image.data);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  for (let i = 0; i < bitmap.length; i += 4) {
    const r = bitmap[i];
    const g = bitmap[i + 1];
    const b = bitmap[i + 2];

    if (r !== 0 || g !== 0 || b !== 0) {
      bitmap[i] = 255;
      bitmap[i + 1] = 255;
      bitmap[i + 2] = 255;
      bitmap[i + 3] = 255;
    } else {
      bitmap[i] = 0;
      bitmap[i + 1] = 0;
      bitmap[i + 2] = 0;
      bitmap[i + 3] = 255;
    }
  }

  const imageData = new ImageData(bitmap, width, height);

  ctx.putImageData(imageData, 0, 0);

  const dataURL = canvas.toDataURL('image/png');

  const base64String = dataURL.split(',')[1];

  return base64String;
}

interface Props {
  image: string;
  brushSize: number;
  eraserMode?: boolean;
  mask?: string;
  imageWidth: number;
  imageHeight: number;
  onDrawEnd?: () => void;
  /** 캔버스와 같은 상자에 겹칠 레이어(Focused 영역 오버레이, 2026-10-04 S2). 감싸는 칸은 pointer-events 없음. */
  overlay?: ReactNode;
  /** 씬이 바뀌면 달라지는 값 — 바뀌면 캔버스를 mask 로 다시 그린다(이미지만 바뀌면 유지). */
  resetKey?: unknown;
}

export interface BrushToolRef {
  getMaskBase64(): string;
  startBrushing(): void;
  stopBrushing(): void;
  clear(): void;
  undo(): void;
  /** 마우스 위치 미리보기(칠할 칸 테두리)를 지우고 현재 마스크만 남긴다. */
  clearPreview(): void;
}

const CHUNK_SIZE = 8;

// Helper functions for chunk-based drawing
function getChunkCoordinates(x: number, y: number) {
  return {
    chunkX: Math.floor(x / CHUNK_SIZE),
    chunkY: Math.floor(y / CHUNK_SIZE),
  };
}

function drawChunk(
  ctx: CanvasRenderingContext2D,
  chunkX: number,
  chunkY: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillRect(
    chunkX * CHUNK_SIZE,
    chunkY * CHUNK_SIZE,
    CHUNK_SIZE,
    CHUNK_SIZE,
  );
}

function getChunksInBrush(x: number, y: number, brushSize: number) {
  const chunks = new Set<string>();
  const centerChunk = getChunkCoordinates(x, y);
  const brushRadius = brushSize;
  const chunkRadius = Math.ceil(brushRadius / CHUNK_SIZE);

  for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
    for (let dy = -chunkRadius; dy <= chunkRadius; dy++) {
      const chunkX = centerChunk.chunkX + dx;
      const chunkY = centerChunk.chunkY + dy;

      // Calculate distance from brush center to chunk center
      const chunkCenterX = (chunkX + 0.5) * CHUNK_SIZE;
      const chunkCenterY = (chunkY + 0.5) * CHUNK_SIZE;
      const distance = Math.hypot(chunkCenterX - x, chunkCenterY - y);

      if (distance <= brushRadius) {
        chunks.add(`${chunkX},${chunkY}`);
      }
    }
  }

  return Array.from(chunks).map((key) => {
    const [chunkX, chunkY] = key.split(',').map(Number);
    return { chunkX, chunkY };
  });
}

function getChunksBetween(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  brushSize: number,
) {
  const chunks = new Set<string>();
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(dist / (CHUNK_SIZE / 2));

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;

    const brushChunks = getChunksInBrush(x, y, brushSize);
    brushChunks.forEach(({ chunkX, chunkY }) => {
      chunks.add(`${chunkX},${chunkY}`);
    });
  }

  return Array.from(chunks).map((key) => {
    const [chunkX, chunkY] = key.split(',').map(Number);
    return { chunkX, chunkY };
  });
}

const BrushTool = forwardRef<BrushToolRef, Props>(
  (
    {
      image,
      mask,
      imageWidth,
      imageHeight,
      brushSize,
      eraserMode = false,
      onDrawEnd,
      overlay,
      resetKey,
    },
    ref,
  ) => {
    const canvasRef = useRef<any>(null);
    const [loaded, setLoaded] = useState(false);
    const brushingRef = useRef(true);
    const isDrawingRef = useRef(false);
    const lastPosRef = useRef({ x: -1, y: -1 });
    const curPosRef = useRef({ x: -1, y: -1 });
    const onDrawEndRef = useRef(onDrawEnd);
    onDrawEndRef.current = onDrawEnd;
    const historyRef = useRef<any>([]);
    const curImageRef = useRef<any>(undefined);
    const brushColor = 'rgba(0, 0, 255, 1)';

    const undoImpl = () => {
      const canvas = canvasRef.current as any;
      const ctx = canvas.getContext('2d')!;
      if (historyRef.current.length > 1) {
        const imageData = historyRef.current[historyRef.current.length - 1];
        curImageRef.current = imageData;
        ctx.putImageData(imageData, 0, 0);
        historyRef.current.pop();
        onDrawEndRef.current?.();
      }
    };

    useImperativeHandle(ref, () => ({
      getMaskBase64() {
        return maskToBase64(curImageRef.current, imageWidth, imageHeight);
      },
      clear() {
        historyRef.current = [
          new Uint8ClampedArray(imageWidth * imageHeight * 4),
        ];
        const canvas = canvasRef.current as any;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, imageWidth, imageHeight);
        curImageRef.current = ctx.getImageData(0, 0, imageWidth, imageHeight);
      },
      undo() {
        undoImpl();
      },
      startBrushing() {
        brushingRef.current = true;
      },
      stopBrushing() {
        brushingRef.current = false;
      },
      clearPreview() {
        const canvas = canvasRef.current as any;
        if (!canvas || !curImageRef.current) return;
        canvas.getContext('2d').putImageData(curImageRef.current, 0, 0);
      },
    }));

    // 오버레이 칸을 캔버스의 레이아웃 상자(변환 전 크기)에 맞춘다 — 확대·이동은 조상 transform 이 함께 적용.
    const [canvasBox, setCanvasBox] = useState({ w: 0, h: 0 });
    useEffect(() => {
      if (!overlay) return undefined;
      const canvas = canvasRef.current as HTMLCanvasElement | null;
      if (!canvas) return undefined;
      const measure = () => {
        const w = canvas.offsetWidth;
        const h = canvas.offsetHeight;
        setCanvasBox((b) => (b.w === w && b.h === h ? b : { w, h }));
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return undefined;
      const ro = new ResizeObserver(measure);
      ro.observe(canvas);
      return () => ro.disconnect();
    }, [!!overlay, imageWidth, imageHeight]);

    // 마지막으로 캔버스를 다시 그린 기준(마스크·크기·씬) — 표시 이미지만 바뀌면 붓질을 지우지 않는다.
    const appliedRef = useRef<MaskCanvasInputs | undefined>(undefined);
    useEffect(() => {
      const canvas = canvasRef.current as any;
      const ctx = canvas.getContext('2d')!;

      if (imageWidth === 0 || imageHeight === 0) return;

      // 생성 결과 표시·원본 다시 읽기처럼 이미지만 바뀐 경우: 캔버스 크기 재설정(내용 소거)과
      // 열 때 마스크로 되돌리기를 하지 않는다(마스크 롤백·점멸 방지, maskCanvasSync.ts).
      const next: MaskCanvasInputs = {
        mask,
        width: imageWidth,
        height: imageHeight,
        resetKey,
      };
      if (maskCanvasAction(appliedRef.current, next) === 'keep') return;
      appliedRef.current = next;

      canvas.width = imageWidth;
      canvas.height = imageHeight;

      ctx.clearRect(0, 0, imageWidth, imageHeight);
      curImageRef.current = ctx.getImageData(0, 0, imageWidth, imageHeight);
      historyRef.current = [curImageRef.current];

      if (mask) {
        setLoaded(false);
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(
            0,
            0,
            img.naturalWidth,
            img.naturalHeight,
          );
          const bitmap = imageData.data;

          for (let i = 0; i < bitmap.length; i += 4) {
            if (bitmap[i] !== 0 || bitmap[i + 1] !== 0 || bitmap[i + 2] !== 0) {
              bitmap[i] = 0;
              bitmap[i + 1] = 0;
              bitmap[i + 2] = 255;
              bitmap[i + 3] = 255;
            } else {
              bitmap[i] = 0;
              bitmap[i + 1] = 0;
              bitmap[i + 2] = 0;
              bitmap[i + 3] = 0;
            }
          }
          ctx.putImageData(imageData, 0, 0);
          const imageData2 = ctx.getImageData(
            0,
            0,
            img.naturalWidth,
            img.naturalHeight,
          );
          historyRef.current = [imageData2];
          curImageRef.current = imageData2;
          setLoaded(true);
        };
        img.src = mask;
      } else {
        setLoaded(true);
      }
    }, [mask, image, imageHeight, imageWidth, resetKey]);

    useEffect(() => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      const drawBrushChunk = (x: any, y: any) => {
        const chunks = getChunksInBrush(x, y, brushSize);
        chunks.forEach(({ chunkX, chunkY }) => {
          if (eraserMode) {
            ctx.clearRect(
              chunkX * CHUNK_SIZE,
              chunkY * CHUNK_SIZE,
              CHUNK_SIZE,
              CHUNK_SIZE,
            );
          } else {
            drawChunk(ctx, chunkX, chunkY, brushColor);
          }
        });
      };

      const interpolate = (x0: any, y0: any, x1: any, y1: any) => {
        const chunks = getChunksBetween(x0, y0, x1, y1, brushSize);
        chunks.forEach(({ chunkX, chunkY }) => {
          if (eraserMode) {
            ctx.clearRect(
              chunkX * CHUNK_SIZE,
              chunkY * CHUNK_SIZE,
              CHUNK_SIZE,
              CHUNK_SIZE,
            );
          } else {
            drawChunk(ctx, chunkX, chunkY, brushColor);
          }
        });
      };

      const draw = (e: any) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        const x = (clientX - rect.left) * (canvas.width / rect.width);
        const y = (clientY - rect.top) * (canvas.height / rect.height);

        if (isDrawingRef.current) {
          const lastPos = lastPosRef.current;
          if (lastPos.x !== -1) {
            interpolate(lastPos.x, lastPos.y, x, y);
          } else {
            drawBrushChunk(x, y);
          }
        }

        lastPosRef.current = { x, y };
      };

      const undo = (e: any) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
          undoImpl();
        }
      };

      const startDrawing = (e: any) => {
        if (!brushingRef.current) return;
        e.preventDefault();
        ctx.putImageData(curImageRef.current, 0, 0);
        const imageData = curImageRef.current;
        historyRef.current.push(imageData);
        isDrawingRef.current = true;
        draw(e);
      };

      const stopDrawing = () => {
        if (isDrawingRef.current) {
          curImageRef.current = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          onDrawEndRef.current?.();
        }
        isDrawingRef.current = false;
        lastPosRef.current.x = -1;
      };

      const drawIfDrawing = (e: any) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        const x = (clientX - rect.left) * (canvas.width / rect.width);
        const y = (clientY - rect.top) * (canvas.height / rect.height);
        curPosRef.current = { x, y };
        if (isDrawingRef.current) {
          draw(e);
        } else {
          // Show preview of chunks that would be painted
          ctx.putImageData(curImageRef.current, 0, 0);
          const chunks = getChunksInBrush(x, y, brushSize);
          ctx.strokeStyle = eraserMode ? 'white' : 'black';
          ctx.lineWidth = 2;
          chunks.forEach(({ chunkX, chunkY }) => {
            ctx.strokeRect(
              chunkX * CHUNK_SIZE,
              chunkY * CHUNK_SIZE,
              CHUNK_SIZE,
              CHUNK_SIZE,
            );
          });
        }
      };

      canvas.addEventListener('mousedown', startDrawing);
      canvas.addEventListener('mousemove', drawIfDrawing);
      canvas.addEventListener('mouseup', stopDrawing);
      canvas.addEventListener('mouseleave', stopDrawing);
      canvas.addEventListener('touchstart', startDrawing);
      canvas.addEventListener('touchmove', drawIfDrawing);
      canvas.addEventListener('touchend', stopDrawing);
      window.addEventListener('keydown', undo);

      return () => {
        canvas.removeEventListener('mousedown', startDrawing);
        canvas.removeEventListener('mousemove', drawIfDrawing);
        canvas.removeEventListener('mouseup', stopDrawing);
        canvas.removeEventListener('mouseleave', stopDrawing);
        canvas.removeEventListener('touchstart', startDrawing);
        canvas.removeEventListener('touchmove', drawIfDrawing);
        canvas.removeEventListener('touchend', stopDrawing);
        window.removeEventListener('keydown', undo);
      };
    }, [brushSize, eraserMode]);

    return (
      <div className="canvas-container overflow-auto w-full md:w-auto h-auto md:h-full ">
        {loaded && (
          <img src={image} className="canvas-image" draggable={false} />
        )}
        <canvas
          className="canvas"
          ref={canvasRef}
          width={imageWidth}
          height={imageHeight}
        />
        {overlay && (
          <div
            className="absolute top-0 left-0 pointer-events-none"
            style={{ width: canvasBox.w, height: canvasBox.h, zIndex: 3 }}
          >
            {overlay}
          </div>
        )}
      </div>
    );
  },
);

export default BrushTool;
