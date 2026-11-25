// 「캡처」 옵션 창(2026-11-25) — 씬 목록 툴바 「캡처」와 이미지 그리드 「캡처」가 같은 창을 쓴다.
// 틀 = ModalOverlay size m(GridDownloadPicker 를 본뜸 — 본문 = 옵션 묶음, 아래 요약 줄, 바닥줄 [캡처 저장][취소]).
// Esc·뒤로 가기·바깥 누르기·✕ = 취소. 등장 움직임 없음. 택일 = .seg-group, 체크 = SettingCheckRow(.setting-check).
// 씬 목록에서 열면(variant 'scenes') 씬 범위·씬당 이미지·빈 씬 포함이 있고, 그리드에서 열면(variant 'grid') 없다.
// 규칙·문구 = models/captureSheet.ts. 옵션은 localStorage 에 기억(범위는 기억하지 않고 호출부가 열 때마다 기본 규칙으로).
// 한 자리에 색 있는 주 동작은 하나 — [캡처 저장](하늘 솔리드), 나머지 회색.
import React, { useMemo, useState } from 'react';
import { FaMinus, FaPlus } from 'react-icons/fa';
import ModalOverlay, { DIALOG_PRIMARY_BTN, DIALOG_SECONDARY_BTN } from './ModalOverlay';
import { SettingCheckRow } from './SettingControls';
import {
  CaptureFit,
  CaptureOptions,
  CapturePerScene,
  CapturePlan,
  CaptureQuality,
  canRunCapture,
  captureCellSizeChoices,
  captureSummary,
  CAPTURE_COLUMNS_MAX,
  CAPTURE_COLUMNS_MIN,
  CAPTURE_RANDOM_COUNT_MAX,
  CAPTURE_RANDOM_COUNT_MIN,
  CAPTURE_TEXT,
  clampCaptureRandomCount,
  effectiveCaptureCellSize,
  readCaptureOptions,
  writeCaptureOptions,
} from '../models/captureSheet';
import type { CaptureImageFormat } from '../models/imageFormats';

export interface CaptureScopeChoice {
  key: string;
  label: string;
  count: number;
  /** 「랜덤 씬」 — count 는 후보 수이고, 칸 글자는 min(고를 씬 수, 후보 수). 고르면 범위 줄 오른쪽에 씬 수 입력이 나온다 */
  randomPool?: boolean;
}

export interface CaptureDialogProps {
  title: string;
  variant: 'scenes' | 'grid';
  /** 범위 택일 — 칸 글자에 수를 괄호로, 0개는 비활성 */
  scopes: readonly CaptureScopeChoice[];
  initialScope: string;
  /** 고른 범위·옵션 → 계획(요약 줄과 실행이 같은 값) */
  plan: (scope: string, options: CaptureOptions) => CapturePlan;
  /** 실행 — 창은 호출부가 닫는다 */
  onRun: (scope: string, options: CaptureOptions, plan: CapturePlan) => void;
  onClose: () => void;
}

const storage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

function Seg<T extends string | number>({
  label,
  items,
  value,
  onChange,
  name,
  labelExtra,
}: {
  label: string;
  items: readonly { key: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  name: string;
  /** 라벨 줄 오른쪽에 붙는 것(범위의 랜덤 씬 수 입력) — 줄 높이를 고정해 나타나도 아래가 밀리지 않게 */
  labelExtra?: React.ReactNode;
}) {
  return (
    <div className="space-y-1" data-capture-section={name}>
      {labelExtra !== undefined ? (
        <div className="flex items-center justify-between gap-2 h-7">
          <div className="text-sm gray-label">{label}</div>
          {labelExtra}
        </div>
      ) : (
        <div className="text-sm gray-label">{label}</div>
      )}
      <div className="seg-group seg-fill flex text-sm" role="group" aria-label={label}>
        {items.map((it) => (
          <button
            key={String(it.key)}
            type="button"
            className={'seg-item' + (value === it.key ? ' seg-on' : '')}
            aria-pressed={value === it.key}
            disabled={it.disabled}
            onClick={() => onChange(it.key)}
            data-capture-option={`${name}:${it.key}`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const CaptureDialog = ({ title, variant, scopes, initialScope, plan, onRun, onClose }: CaptureDialogProps) => {
  const [options, setOptionsState] = useState<CaptureOptions>(() => readCaptureOptions(storage()));
  const setOptions = (patch: Partial<CaptureOptions>) => {
    setOptionsState((prev) => {
      const next = { ...prev, ...patch };
      writeCaptureOptions(storage(), next);
      return next;
    });
  };
  const [scope, setScope] = useState<string>(initialScope);
  const isScenes = variant === 'scenes';
  const effective = { ...options, cellSize: effectiveCaptureCellSize(options) };
  const current = useMemo(() => plan(scope, effective), [plan, scope, JSON.stringify(effective)]);
  const summary = captureSummary(current);
  const runnable = canRunCapture(current);

  const footer = (
    <>
      <button
        type="button"
        className={DIALOG_PRIMARY_BTN}
        disabled={!runnable}
        onClick={() => onRun(scope, effective, current)}
        data-capture-run
      >
        {CAPTURE_TEXT.run}
      </button>
      <button type="button" className={DIALOG_SECONDARY_BTN} onClick={onClose}>
        {CAPTURE_TEXT.cancel}
      </button>
    </>
  );

  // 「랜덤 씬」을 고른 동안 범위 줄 오른쪽에 씬 수 입력. 랜덤 선택지가 있는 창은 그 줄 높이를 늘 고정한다(입력이 나타나도 아래가 밀리지 않게).
  const hasRandom = scopes.some((s) => s.randomPool);
  const randomActive = scopes.some((s) => s.randomPool && s.key === scope);
  const randomExtra = !hasRandom ? undefined : randomActive ? (
    <label className="flex items-center gap-1.5 text-sm text-muted" data-capture-random-count>
      <span>{CAPTURE_TEXT.randomCount}</span>
      <input
        type="number"
        className="gray-input w-16 h-7 p-1 text-center tabular-nums"
        aria-label={CAPTURE_TEXT.randomCount}
        min={CAPTURE_RANDOM_COUNT_MIN}
        max={CAPTURE_RANDOM_COUNT_MAX}
        value={options.randomCount}
        onChange={(e) =>
          setOptions({ randomCount: clampCaptureRandomCount(e.currentTarget.value, options.randomCount) })
        }
      />
      <span>{CAPTURE_TEXT.randomUnit}</span>
    </label>
  ) : null;

  return (
    <ModalOverlay isOpen={true} onClose={onClose} title={title} size="m" footer={footer}>
      <div className="space-y-3" data-capture-dialog={variant}>
        <Seg
          name="scope"
          label={CAPTURE_TEXT.scope}
          items={scopes.map((s) => ({
            key: s.key,
            label: CAPTURE_TEXT.scopeCount(s.label, s.randomPool ? Math.min(options.randomCount, s.count) : s.count),
            disabled: s.count === 0,
          }))}
          value={scope}
          onChange={setScope}
          labelExtra={randomExtra}
        />
        {isScenes && (
          <div className="space-y-1">
            <Seg<CapturePerScene>
              name="perScene"
              label={CAPTURE_TEXT.perScene}
              items={(['main', 'favorites', 'recent'] as const).map((k) => ({
                key: k,
                label: CAPTURE_TEXT.perSceneLabel[k],
              }))}
              value={options.perScene}
              onChange={(v) => setOptions({ perScene: v })}
            />
            {options.perScene !== 'main' && (
              <div className="text-xs text-muted">{CAPTURE_TEXT.perSceneHint}</div>
            )}
          </div>
        )}
        <Seg<CaptureQuality>
          name="quality"
          label={CAPTURE_TEXT.quality}
          items={(['fast', 'high'] as const).map((k) => ({ key: k, label: CAPTURE_TEXT.qualityLabel[k] }))}
          value={options.quality}
          onChange={(v) => setOptions({ quality: v })}
        />
        {/* 표시 — 체크 상자를 한 줄에 나란히(창 높이를 줄여 본문 스크롤이 생기지 않게, 좁으면 줄 바뀜) */}
        <div className="space-y-1" data-capture-section="show">
          <div className="text-sm gray-label">{CAPTURE_TEXT.show}</div>
          <div className="flex flex-wrap items-center gap-x-4" data-capture-show-row>
            <SettingCheckRow
              id="capture-show-names"
              checked={options.showNames}
              onChange={(v) => setOptions({ showNames: v })}
              label={CAPTURE_TEXT.showNames}
            />
            <SettingCheckRow
              id="capture-gap"
              checked={options.gap}
              onChange={(v) => setOptions({ gap: v })}
              label={CAPTURE_TEXT.gap}
            />
            {isScenes && (
              <SettingCheckRow
                id="capture-include-empty"
                checked={options.includeEmpty}
                onChange={(v) => setOptions({ includeEmpty: v })}
                label={CAPTURE_TEXT.includeEmpty}
              />
            )}
          </div>
        </div>
        <div className="space-y-3" data-capture-section="layout">
          {/* 한 줄의 장수 — 라벨과 스테퍼를 같은 줄에 */}
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm gray-label">{CAPTURE_TEXT.columns}</div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="round-button icon-only back-gray"
                aria-label={CAPTURE_TEXT.columnsDec}
                disabled={options.columns <= CAPTURE_COLUMNS_MIN}
                onClick={() => setOptions({ columns: Math.max(CAPTURE_COLUMNS_MIN, options.columns - 1) })}
                data-capture-columns-dec
              >
                <FaMinus />
              </button>
              <span className="w-6 text-center tabular-nums text-body" data-capture-columns>
                {options.columns}
              </span>
              <button
                type="button"
                className="round-button icon-only back-gray"
                aria-label={CAPTURE_TEXT.columnsInc}
                disabled={options.columns >= CAPTURE_COLUMNS_MAX}
                onClick={() => setOptions({ columns: Math.min(CAPTURE_COLUMNS_MAX, options.columns + 1) })}
                data-capture-columns-inc
              >
                <FaPlus />
              </button>
            </div>
          </div>
          <Seg<number>
            name="cellSize"
            label={CAPTURE_TEXT.cellSize}
            items={captureCellSizeChoices(options.quality).map((s) => ({ key: s.value, label: s.label }))}
            value={effective.cellSize}
            onChange={(v) => setOptions({ cellSize: v })}
          />
          <Seg<CaptureFit>
            name="fit"
            label={CAPTURE_TEXT.fit}
            items={(['cover', 'contain'] as const).map((k) => ({ key: k, label: CAPTURE_TEXT.fitLabel[k] }))}
            value={options.fit}
            onChange={(v) => setOptions({ fit: v })}
          />
        </div>
        <Seg<CaptureImageFormat>
          name="format"
          label={CAPTURE_TEXT.format}
          items={(['jpeg', 'png'] as const).map((k) => ({ key: k, label: CAPTURE_TEXT.formatLabel[k] }))}
          value={options.format}
          onChange={(v) => setOptions({ format: v })}
        />
        {/* 요약 줄 — 항상 표시(장수·줄 수·결과 크기 + 경고·불가·건너뜀·축소) */}
        <div className="border-t line-color pt-3 space-y-0.5 text-sm" data-capture-summary>
          <div className="text-body tabular-nums" data-capture-summary-line>
            {summary.line}
          </div>
          {summary.notes.map((n, i) => (
            <div
              key={i}
              data-capture-note={n.tone}
              className={
                n.tone === 'danger'
                  ? 'text-red-500 dark:text-red-400'
                  : n.tone === 'warn'
                    ? 'text-body font-medium'
                    : 'text-muted text-xs'
              }
            >
              {n.text}
            </div>
          ))}
        </div>
      </div>
    </ModalOverlay>
  );
};

export default CaptureDialog;
