// 크기 슬라이더(2026-11-23 사용자 결정 — 「스몰뷰/미디엄뷰/라지뷰」 같은 단계 버튼 대신 축소~확대를 슬라이더로).
// 씬 도구줄 「씬 카드 크기」와 PC 이미지 그리드 「이미지 크기」가 같이 쓴다. % → 실제 크기 규칙은 models/sizeSlider.ts.
//
// · 모양 = 앱의 다른 슬라이더(인페인트 붓 크기·환경설정)와 같은 기본 <input type="range"> — 새 색·새 CSS 없음.
// · 값 0~100, 50 = 가운데(종전 미디엄). 끄는 동안 손잡이는 바로 움직이고, 바깥(onChange)에는 화면 그리기 한 번에
//   한 번만 알린다(requestAnimationFrame 으로 묶음 — 그리드가 끄는 동안 과하게 다시 계산되지 않게).
// · 두 번 누르면 50 으로. 좌우 화살표는 슬라이더에 포커스가 있을 때만(기본 range 동작) — input 이라
//   전역 단축키(KeyboardShortcutService·씬 목록 키 처리 = keyTargetGuard 「글자 입력 대상」)가 이때는 동작하지 않는다.
// · 등장·전환 움직임 없음.
import { useCallback, useEffect, useRef, useState } from 'react';
import Tooltip from './Tooltip';
import {
  SIZE_PERCENT_DEFAULT,
  SIZE_PERCENT_MAX,
  SIZE_PERCENT_MIN,
  SIZE_SLIDER_TEXT,
  normalizeSizePercent,
} from '../models/sizeSlider';

interface SizeSliderProps {
  /** 지금 값(0~100) */
  value: number;
  /** 바뀐 값 — 끄는 동안은 화면 그리기마다 최대 한 번 */
  onChange: (percent: number) => void;
  /** 접근성 이름·툴팁 이름(「씬 카드 크기」「이미지 크기」) */
  label: string;
  className?: string;
}

export const SizeSlider = ({ value, onChange, label, className }: SizeSliderProps) => {
  const [draft, setDraft] = useState(() => normalizeSizePercent(value));
  const pendingRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 바깥 값이 바뀌면(다른 화면에서 바꿈·처음 읽기) 따라간다 — 끄는 중이 아닐 때
  useEffect(() => {
    if (pendingRef.current == null) setDraft(normalizeSizePercent(value));
  }, [value]);

  const flush = useCallback(() => {
    frameRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next != null) onChangeRef.current(next);
  }, []);

  const schedule = useCallback(
    (next: number) => {
      pendingRef.current = next;
      if (frameRef.current != null) return;
      if (typeof requestAnimationFrame === 'undefined') {
        flush();
        return;
      }
      frameRef.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  // 사라질 때 아직 알리지 않은 값은 바로 알린다(마지막 값을 잃지 않게)
  useEffect(
    () => () => {
      if (frameRef.current != null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(frameRef.current);
      }
      if (frameRef.current != null || pendingRef.current != null) flush();
    },
    [flush],
  );

  const set = (next: number) => {
    const v = normalizeSizePercent(next);
    setDraft(v);
    schedule(v);
  };

  return (
    <Tooltip content={SIZE_SLIDER_TEXT.tooltip(label, draft)}>
      <input
        type="range"
        min={SIZE_PERCENT_MIN}
        max={SIZE_PERCENT_MAX}
        step={1}
        value={draft}
        aria-label={label}
        aria-valuetext={SIZE_SLIDER_TEXT.valueText(draft)}
        data-size-slider=""
        className={'flex-none w-28 h-8 cursor-pointer ' + (className ?? '')}
        onChange={(e) => set(Number(e.target.value))}
        onDoubleClick={() => set(SIZE_PERCENT_DEFAULT)}
      />
    </Tooltip>
  );
};

export default SizeSlider;
