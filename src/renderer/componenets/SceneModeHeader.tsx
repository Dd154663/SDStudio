// 씬 화면 머리(2026-11-25 사용자 스케치) — 이미지 그리드·씬 편집 창(일반 씬 SceneEditor / 변형 씬 InPaintEditor) 세 창의
// FloatView 머리줄(✕ 오른쪽 headerSlot)에 그리는 공용 내용: [씬 종류 아이콘 + 씬 이름] [이미지 | 편집] [이전/다음 씬(그리드만)].
// PC(md 이상) = 이름(flex-1) · 택일(가운데) · 화살표(flex-1, 오른쪽 정렬), 택일 칸은 아이콘 + 글자.
// 좁은 폭(모바일) = 이름(줄어듦) · 택일 · 화살표를 오른쪽에 붙임, 택일 칸은 아이콘만(글자는 aria-label·title).
// 전환 판정은 models/sceneModeSwitch.ts, 상태 주인은 QueueControl. 색은 기존 .seg-group·round-button 그대로(등장 움직임 없음).
import React from 'react';
import { createPortal } from 'react-dom';
import { FaImages } from 'react-icons/fa';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa6';
import { ActionIcon } from './ActionIcon';
import Tooltip from './Tooltip';
import { useFloatViewHeaderSlot } from './FloatView';
import type { SceneScreenMode } from '../models/sceneModeSwitch';

export const SCENE_MODE_TEXT = {
  group: '씬 화면 모드',
  images: '이미지',
  edit: '편집',
  selectModeOn: '이미지 선택 모드 ON',
  prevScene: '이전 씬 그리드 (Ctrl+←)',
  nextScene: '다음 씬 그리드 (Ctrl+→)',
} as const;

export interface SceneModeNav {
  hasPrev: boolean;
  hasNext: boolean;
  go: (delta: number) => void;
}

export interface SceneModeHeaderProps {
  /** 씬 종류 아이콘(일반 씬 🖼️ / 변형 씬 = 워크플로 이모지 — 종전 그리드 제목 그대로) */
  kindIcon: React.ReactNode;
  name: string;
  mode: SceneScreenMode;
  onMode: (mode: SceneScreenMode) => void;
  /** 그리드가 이미지 선택 모드면 이름 자리에 「이미지 선택 모드 ON」(종전 제목 자리 표시 그대로) */
  selectMode?: boolean;
  /** 이전/다음 씬 — 그리드 모드에서만 그린다(편집 창의 이전/다음은 범위 밖) */
  sceneNav?: SceneModeNav;
}

const MODES: { mode: SceneScreenMode; label: string; icon: React.ReactNode }[] = [
  { mode: 'images', label: SCENE_MODE_TEXT.images, icon: <FaImages aria-hidden="true" /> },
  { mode: 'edit', label: SCENE_MODE_TEXT.edit, icon: <ActionIcon id="edit" aria-hidden="true" /> },
];

export const SceneModeHeader = ({
  kindIcon,
  name,
  mode,
  onMode,
  selectMode,
  sceneNav,
}: SceneModeHeaderProps) => {
  const nav = mode === 'images' ? sceneNav : undefined;
  return (
    <div
      className="titlebar-no-drag flex items-center gap-2 w-full min-w-0 pr-2"
      data-scene-mode-header=""
    >
      <span
        className="flex-1 min-w-0 inline-flex items-center gap-1 font-semibold text-default"
        data-scene-mode-title=""
      >
        {selectMode ? (
          <span className="min-w-0 truncate">{SCENE_MODE_TEXT.selectModeOn}</span>
        ) : (
          <>
            <span className="flex-none" aria-hidden="true">
              {kindIcon}
            </span>
            <span className="min-w-0 truncate" title={name}>
              {name}
            </span>
          </>
        )}
      </span>
      <div
        className="seg-group seg-sm flex flex-none"
        role="group"
        aria-label={SCENE_MODE_TEXT.group}
        data-scene-mode-switch=""
      >
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            className={'seg-item text-sm' + (mode === m.mode ? ' seg-on' : '')}
            aria-pressed={mode === m.mode}
            aria-label={m.label}
            title={m.label}
            data-mode={m.mode}
            onClick={() => {
              if (mode !== m.mode) onMode(m.mode);
            }}
          >
            {m.icon}
            <span className="hidden md:inline">{m.label}</span>
          </button>
        ))}
      </div>
      {/* PC 는 이름과 같은 flex-1 로 택일을 가운데에 둔다(편집 모드처럼 화살표가 없어도 자리는 남김) */}
      <div className="flex-none md:flex-1 min-w-0 flex justify-end items-center gap-1 md:gap-2" data-scene-mode-nav="">
        {nav && (
          <>
            <Tooltip content={SCENE_MODE_TEXT.prevScene}>
              <button
                className={`round-button icon-only back-gray ${!nav.hasPrev ? 'opacity-40' : ''}`}
                disabled={!nav.hasPrev}
                aria-label="이전 씬"
                onClick={() => nav.go(-1)}
              >
                <FaChevronLeft />
              </button>
            </Tooltip>
            <Tooltip content={SCENE_MODE_TEXT.nextScene}>
              <button
                className={`round-button icon-only back-gray ${!nav.hasNext ? 'opacity-40' : ''}`}
                disabled={!nav.hasNext}
                aria-label="다음 씬"
                onClick={() => nav.go(1)}
              >
                <FaChevronRight />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
};

/** FloatView 머리줄 자리(headerSlot 을 켠 창)로 포털 — 자리가 아직 없으면(마운트 직전) 아무것도 그리지 않는다. */
export const SceneModeHeaderPortal = (props: SceneModeHeaderProps) => {
  const slot = useFloatViewHeaderSlot();
  if (!slot) return null;
  return createPortal(<SceneModeHeader {...props} />, slot);
};
