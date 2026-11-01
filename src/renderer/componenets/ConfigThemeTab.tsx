// 설정 화면 탭: 테마(key 'customization', 라벨 「테마」) — CustomizationTab(+ColorField·TemplateVariantChip·MyThemePresetChip)
import React, { useState } from 'react';
import {
  isMobile,
} from '../models';
import { Config, UiThemeConfig } from '../../main/config';
import { buildThemeVars, isHex6 } from '../models/uiTheme';
import { themeTemplates } from '../models/themeTemplates';
import { appState } from '../models/AppService';
import { promptName } from '../models/nameInput';
import { deleteConfirmText } from '../models/deleteFlowRules';
import MobileColorPicker from './MobileColorPicker';

/* ── 메인 ConfigScreen ── */
// 색 한 칸 선택 UI: 데스크톱=네이티브 색 피커, 모바일=MobileColorPicker(상위에서 띄움).
const ColorField = ({
  label,
  value,
  def,
  onChange,
  onMobilePick,
}: {
  label: string;
  value?: string;
  def: string; // 미설정 시 스와치에 보일 기본색(피커 시작점)
  onChange: (hex: string | undefined) => void;
  onMobilePick: (initial: string, onChange: (hex: string) => void) => void;
}) => {
  const isSet = isHex6(value);
  const shown = isSet ? (value as string) : def;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm gray-label flex-1">{label}</span>
      {isSet && <span className="text-xs text-faint">{value}</span>}
      {!isMobile ? (
        <label
          className="relative w-7 h-7 rounded-full flex-none cursor-pointer overflow-hidden border line-color"
          style={{ backgroundColor: shown }}
        >
          <input
            type="color"
            defaultValue={shown}
            onInput={(e) => onChange(e.currentTarget.value)}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>
      ) : (
        <button
          className="w-7 h-7 rounded-full flex-none border line-color"
          style={{ backgroundColor: shown }}
          onClick={() => onMobilePick(shown, onChange)}
        />
      )}
      {isSet && (
        <button
          className="round-button back-gray btn-sm flex-none"
          onClick={() => onChange(undefined)}
        >
          초기화
        </button>
      )}
    </div>
  );
};

// 테마 템플릿의 라이트/다크 변형 1개 = 클릭 칩. 칩 자체를 변형의 배경색으로 칠하고
// 대표색 점(패널/강조/일반/위험)을 함께 보여, 적용 전에 색감을 예상할 수 있게 한다.
const TemplateVariantChip = ({
  variant,
  label,
  onApply,
}: {
  variant: UiThemeConfig;
  label: string;
  onApply: () => void;
}) => (
  <button
    className="flex items-center justify-center gap-1.5 flex-1 rounded-[var(--r-btn)] border line-color px-2.5 py-1.5 clickable"
    style={{ backgroundColor: variant.surface }}
    onClick={onApply}
  >
    <span
      className="text-xs font-medium"
      style={{ color: variant.textPattern === 'light' ? '#000000' : '#ffffff' }}
    >
      {label}
    </span>
    <span className="flex gap-1">
      {[variant.surface2, variant.accent, variant.neutral, variant.danger].map(
        (c, i) => (
          <span
            key={i}
            className="w-3 h-3 rounded-full flex-none"
            style={{
              backgroundColor: c,
              boxShadow: 'inset 0 0 0 1px rgba(128,128,128,.4)',
            }}
          />
        ),
      )}
    </span>
  </button>
);

// 내 프리셋 칩(릴리스 준비 ③) — 저장된 스냅샷의 배경/대표색으로 칠해 색감을 예상.
// 클릭 = 복원 적용, ✕ = 삭제. 라벨 색은 textPattern, 미설정 시 기본 모드로 추정.
const MyThemePresetChip = ({
  preset,
  onApply,
  onDelete,
}: {
  preset: { name: string; whiteMode: boolean; trueDark?: boolean; theme: UiThemeConfig };
  onApply: () => void;
  onDelete: () => void;
}) => {
  const labelColor = preset.theme.textPattern
    ? preset.theme.textPattern === 'light'
      ? '#000000'
      : '#ffffff'
    : preset.whiteMode
      ? '#000000'
      : '#ffffff';
  return (
    <div
      className="flex items-center gap-1 rounded-full border line-color pl-2.5 pr-1.5 py-1"
      style={{ backgroundColor: preset.theme.surface }}
    >
      <button className="flex items-center gap-1.5 clickable min-w-0" onClick={onApply}>
        <span
          className="text-xs font-medium truncate max-w-[9rem]"
          style={{ color: labelColor }}
        >
          {preset.name}
        </span>
        <span className="flex gap-1 flex-none">
          {[
            preset.theme.surface2,
            preset.theme.accent,
            preset.theme.neutral,
            preset.theme.danger,
          ].map((c, i) => (
            <span
              key={i}
              className="w-3 h-3 rounded-full flex-none"
              style={{
                backgroundColor: c,
                boxShadow: 'inset 0 0 0 1px rgba(128,128,128,.4)',
              }}
            />
          ))}
        </span>
      </button>
      <button
        className="clickable text-xs px-1 flex-none"
        style={{ color: labelColor }}
        onClick={onDelete}
        title="프리셋 삭제"
      >
        ✕
      </button>
    </div>
  );
};

const CustomizationTab = ({
  uiTheme,
  setUiTheme,
  whiteMode, setWhiteMode,
  trueDark, setTrueDark,
  uiThemePresets, setUiThemePresets,
}: any) => {
  const [mobilePicker, setMobilePicker] = useState<{
    initial: string;
    onChange: (hex: string) => void;
  } | null>(null);

  const patch = (p: Partial<UiThemeConfig>) =>
    setUiTheme((prev: UiThemeConfig) => ({ ...prev, ...p }));
  const patchBtn = (p: Partial<NonNullable<UiThemeConfig['buttons']>>) =>
    setUiTheme((prev: UiThemeConfig) => ({ ...prev, buttons: { ...prev.buttons, ...p } }));
  const onMobilePick = (initial: string, onChange: (hex: string) => void) =>
    setMobilePicker({ initial, onChange });

  // 저장 전 실시간 미리보기용 CSS 변수(실제 적용과 동일한 파생 함수).
  const previewVars = buildThemeVars(uiTheme, whiteMode);
  const unify = !!uiTheme.unifyButtons;

  // 템플릿 적용: 색 설정을 통째로 교체하고, 미설정 토큰의 폴백이 어긋나지 않도록
  // 기본 테마(라이트=화이트/다크=다크)도 변형에 맞춘다. 저장 전이라 되돌리기 자유.
  // 버튼 통합 토글은 사용자 선택을 유지한다 — 템플릿은 역할 3색만 채워 두므로
  // 나중에 토글을 켜도 테마에 맞는 버튼 색이 적용된다.
  const applyTemplate = (v: UiThemeConfig, mode: 'light' | 'dark') => {
    setUiTheme((prev: UiThemeConfig) => ({
      ...v,
      unifyButtons: prev.unifyButtons,
    }));
    setWhiteMode(mode === 'light');
    setTrueDark(false);
  };

  // 내 프리셋(릴리스 준비 ③): 현재 색 구성+기본 모드 스냅샷을 이름 붙여 저장.
  // 같은 이름 = 덮어쓰기 확인. 적용은 스냅샷 그대로 복원(저장 전이라 되돌리기 자유).
  const presets: NonNullable<Config['uiThemePresets']> = uiThemePresets ?? [];
  const saveCurrentAsPreset = async () => {
    // 같은 이름이면 아래에서 덮어쓰기를 묻는다(기존 동작) — 빈 값만 창 안에서 거부, 앞뒤 공백 제거(D2)
    const name = await promptName({
      title: '프리셋 이름을 입력하세요',
      kind: 'themePreset',
    });
    if (!name) return;
    const snapshot = {
      name,
      whiteMode,
      trueDark: trueDark || undefined,
      theme: JSON.parse(JSON.stringify(uiTheme)) as UiThemeConfig,
    };
    if (presets.some((p: { name: string }) => p.name === name)) {
      appState.pushDialog({
        type: 'confirm',
        danger: true,
        text: `"${name}" 프리셋이 이미 있습니다. 덮어쓸까요?`,
        callback: () => {
          setUiThemePresets(
            presets.map((p: { name: string }) => (p.name === name ? snapshot : p)),
          );
        },
      });
      return;
    }
    setUiThemePresets([...presets, snapshot]);
  };
  const applyPreset = (p: (typeof presets)[number]) => {
    setUiTheme(JSON.parse(JSON.stringify(p.theme)));
    setWhiteMode(p.whiteMode);
    setTrueDark(p.trueDark ?? false);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm gray-label">
        UI 색을 직접 지정합니다. 지정하지 않은 항목은 기본 테마(다크/라이트)를 따릅니다.
        아래 미리보기로 즉시 확인하고, <b>저장</b>하면 앱 전체에 적용됩니다.
      </div>

      {/* ── 기본 테마 (base 모드) ── */}
      <div>
        <label className="block text-sm gray-label mb-2">기본 테마</label>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="themeMode" checked={!whiteMode && !trueDark}
              onChange={() => { setWhiteMode(false); setTrueDark(false); }} />
            <span className="text-sm gray-label">다크 모드</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="themeMode" checked={trueDark && !whiteMode}
              onChange={() => { setWhiteMode(false); setTrueDark(true); }} />
            <span className="text-sm gray-label">트루 다크 모드</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="themeMode" checked={whiteMode}
              onChange={() => { setWhiteMode(true); setTrueDark(false); }} />
            <span className="text-sm gray-label">화이트 모드</span>
          </label>
        </div>
      </div>
      <hr className="line-color" />

      {/* ── 테마 템플릿 ── */}
      <div>
        <label className="block text-sm gray-label mb-1">테마 템플릿</label>
        <p className="text-xs text-muted mb-2">
          누르면 아래 색 설정 전체가 템플릿 값으로 바뀝니다(기존 커스텀 색은 덮어씀).
          미리보기로 확인 후 <b>저장</b>해야 적용됩니다.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {themeTemplates.map((tpl) => (
            <div key={tpl.name} className="rounded-md r-card border line-color p-2">
              <div className="text-sm text-default mb-1.5">
                {tpl.emoji} {tpl.name}
              </div>
              <div className="flex gap-2">
                {tpl.light && (
                  <TemplateVariantChip
                    variant={tpl.light}
                    label="라이트"
                    onApply={() => applyTemplate(tpl.light!, 'light')}
                  />
                )}
                {tpl.dark && (
                  <TemplateVariantChip
                    variant={tpl.dark}
                    label="다크"
                    onApply={() => applyTemplate(tpl.dark!, 'dark')}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <hr className="line-color" />

      {/* ── 내 프리셋 (릴리스 준비 ③) ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm gray-label">내 프리셋</label>
          <button
            className="round-button back-sky btn-sm flex-none"
            onClick={saveCurrentAsPreset}
          >
            현재 구성 저장
          </button>
        </div>
        <p className="text-xs text-muted mb-2">
          현재 색 구성과 기본 테마(다크/화이트)를 스냅샷으로 저장합니다. 칩을
          누르면 저장 당시 구성이 그대로 적용되고, <b>저장</b>해야 앱에 반영됩니다.
        </p>
        {presets.length === 0 ? (
          <div className="text-xs text-faint">
            저장된 프리셋이 없습니다 — 색을 꾸민 뒤 "현재 구성 저장"을 누르세요.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {presets.map((p: (typeof presets)[number]) => (
              <MyThemePresetChip
                key={p.name}
                preset={p}
                onApply={() => applyPreset(p)}
                onDelete={() => {
                  appState.pushDialog({
                    type: 'confirm',
                    ...deleteConfirmText({
                      kind: 'themePreset',
                      name: p.name,
                      outcome: 'permanent',
                    }),
                    callback: () => {
                      setUiThemePresets(
                        presets.filter(
                          (x: { name: string }) => x.name !== p.name,
                        ),
                      );
                    },
                  });
                }}
              />
            ))}
          </div>
        )}
      </div>
      <hr className="line-color" />

      {/* ── 실시간 미리보기 ── */}
      <div>
        <label className="block text-sm gray-label mb-2">미리보기</label>
        <div
          className="rounded-lg border line-color p-4 space-y-3"
          style={
            { ...previewVars, backgroundColor: 'var(--c-surface)' } as React.CSSProperties
          }
        >
          <div className="text-default text-sm font-semibold">제목 텍스트</div>
          <div className="text-sub text-xs">부가 설명 텍스트입니다.</div>
          <input
            className="gray-input w-full rounded px-2 py-1.5 text-sm"
            placeholder="테스트 입력창"
            readOnly
          />
          <div
            className="rounded-md r-card border line-color p-2"
            style={{ backgroundColor: 'var(--c-surface-2)' }}
          >
            <span className="gray-label text-xs">패널 / 카드 샘플</span>
          </div>
          <div
            className="rounded-md p-2"
            style={{ backgroundColor: 'var(--c-zone)' }}
          >
            <div
              className="rounded p-1.5"
              style={{
                borderLeft: '3px solid #facc15',
                backgroundColor: '#facc1512',
              }}
            >
              <span className="text-body text-xs">구분 구역(드로어) + 폴더 샘플</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {unify ? (
              <>
                <button className="round-button back-sky btn-sm">강조</button>
                <button className="round-button back-gray btn-sm">일반</button>
                <button className="round-button back-red btn-sm">삭제</button>
              </>
            ) : (
              <>
                <button className="round-button back-green btn-sm">추가</button>
                <button className="round-button back-sky btn-sm">강조</button>
                <button className="round-button back-orange btn-sm">편집</button>
                <button className="round-button back-gray btn-sm">일반</button>
                <button className="round-button back-red btn-sm">삭제</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── 테마(배경/입력/텍스트) ── */}
      <div className="space-y-3">
        <div className="text-sm font-semibold gray-label">테마</div>
        <ColorField
          label="배경색"
          value={uiTheme.surface}
          def="#ffffff"
          onChange={(v) => patch({ surface: v })}
          onMobilePick={onMobilePick}
        />
        <ColorField
          label="패널/카드 배경"
          value={uiTheme.surface2}
          def="#ffffff"
          onChange={(v) => patch({ surface2: v })}
          onMobilePick={onMobilePick}
        />
        <ColorField
          label="입력창 배경"
          value={uiTheme.inputBg}
          def="#e5e7eb"
          onChange={(v) => patch({ inputBg: v })}
          onMobilePick={onMobilePick}
        />
        <div>
          <ColorField
            label="구분 구역 배경 (드로어 등)"
            value={uiTheme.zoneBg}
            def="#eceff4"
            onChange={(v) => patch({ zoneBg: v })}
            onMobilePick={onMobilePick}
          />
          <p className="text-xs text-muted mt-1">
            프로젝트 드로어처럼 색 강조(폴더 등)가 올라가는 바탕. 미설정 시 배경 색조를
            따르지 않고 기본 테마로 고정돼, 폴더 색과 텍스트가 항상 잘 보입니다.
          </p>
        </div>
        <div>
          <ColorField
            label="테두리/구분선 색"
            value={uiTheme.lineColor}
            def="#cbd5e1"
            onChange={(v) => patch({ lineColor: v })}
            onMobilePick={onMobilePick}
          />
          <p className="text-xs text-muted mt-1">
            입력창·패널·목록 사이의 얇은 선. 미설정 시 텍스트 패턴과 배경색에 맞춰
            자동으로 옅게 파생됩니다.
          </p>
        </div>
        <div>
          <label className="block text-sm gray-label mb-2">텍스트 패턴</label>
          <div className="flex flex-wrap gap-2">
            <button
              className={`round-button btn-sm ${uiTheme.textPattern === 'light' ? 'back-sky' : 'back-gray'}`}
              onClick={() => patch({ textPattern: 'light' })}
            >
              밝은 배경용 (검은 텍스트)
            </button>
            <button
              className={`round-button btn-sm ${uiTheme.textPattern === 'dark' ? 'back-sky' : 'back-gray'}`}
              onClick={() => patch({ textPattern: 'dark' })}
            >
              어두운 배경용 (흰 텍스트)
            </button>
            {uiTheme.textPattern && (
              <button
                className="round-button back-gray btn-sm"
                onClick={() => patch({ textPattern: undefined })}
              >
                초기화
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── 버튼 색 ── */}
      <div className="space-y-3">
        <div className="text-sm font-semibold gray-label">버튼 색</div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={unify}
            onChange={(e) => patch({ unifyButtons: e.target.checked })}
          />
          <span className="text-sm gray-label">
            버튼 색 통합 — 강조 / 일반 / 위험 3색으로 단순화
          </span>
        </label>
        <div className="text-xs text-faint">
          {unify
            ? '여러 색으로 흩어진 버튼을 3가지 역할 색으로 합칩니다. (삭제는 위험색 유지)'
            : '색별로 따로 지정합니다. 미설정 시 기본 테마 색을 씁니다.'}
        </div>

        {unify ? (
          <div className="flex flex-col gap-2">
            <ColorField
              label="강조색 (추가·주요·편집 버튼)"
              value={uiTheme.accent}
              def="#0ea5e9"
              onChange={(v) => patch({ accent: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="일반색 (보조 버튼)"
              value={uiTheme.neutral}
              def="#6b7280"
              onChange={(v) => patch({ neutral: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="위험색 (삭제 버튼)"
              value={uiTheme.danger}
              def="#ef4444"
              onChange={(v) => patch({ danger: v })}
              onMobilePick={onMobilePick}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <ColorField
              label="추가 버튼 (초록)"
              value={uiTheme.buttons?.green}
              def="#22c55e"
              onChange={(v) => patchBtn({ green: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="강조 버튼 (하늘)"
              value={uiTheme.buttons?.sky}
              def="#0ea5e9"
              onChange={(v) => patchBtn({ sky: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="편집 버튼 (주황)"
              value={uiTheme.buttons?.orange}
              def="#f97316"
              onChange={(v) => patchBtn({ orange: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="일반 버튼 (회색)"
              value={uiTheme.buttons?.gray}
              def="#6b7280"
              onChange={(v) => patchBtn({ gray: v })}
              onMobilePick={onMobilePick}
            />
            <ColorField
              label="삭제 버튼 (빨강)"
              value={uiTheme.buttons?.red}
              def="#ef4444"
              onChange={(v) => patchBtn({ red: v })}
              onMobilePick={onMobilePick}
            />
          </div>
        )}
      </div>

      {isMobile && mobilePicker && (
        <MobileColorPicker
          initial={mobilePicker.initial}
          onChange={mobilePicker.onChange}
          onClose={() => setMobilePicker(null)}
        />
      )}

      <div className="pt-2 border-t line-color">
        <button
          className="round-button back-red btn-sm"
          onClick={() => setUiTheme({})}
        >
          전체 초기화
        </button>
      </div>
    </div>
  );
};

export default CustomizationTab;
