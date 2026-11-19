// PC 화면 배율(시험 기능, 2026-11-19) — main·renderer 공용 허용 목록·정규화·문구.
//
// config.uiZoomPercent 를 Electron 창 배율(webContents.setZoomFactor)로 적용한다. 적용은 main 이
// 맡는다(창을 만들 때 webPreferences.zoomFactor + 문서를 읽을 때마다 명시 재적용, set-config 때 모든 창).
// Android·모바일은 이 값을 읽지도 쓰지도 않는다(환경설정 항목도 PC 에서만 보인다).
// 저장값이 없거나 허용 목록 밖이면 100%(종전 그대로). 100% 는 키를 비워 저장한다.

export const UI_ZOOM_PERCENT_OPTIONS = [100, 95, 90, 85, 80, 75] as const;
export type UiZoomPercent = (typeof UI_ZOOM_PERCENT_OPTIONS)[number];
export const DEFAULT_UI_ZOOM_PERCENT: UiZoomPercent = 100;

export function normalizeUiZoomPercent(value: unknown): UiZoomPercent {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return (UI_ZOOM_PERCENT_OPTIONS as readonly unknown[]).includes(n)
    ? (n as UiZoomPercent)
    : DEFAULT_UI_ZOOM_PERCENT;
}

/** Electron setZoomFactor 에 넘길 배율(1 = 100%). */
export function uiZoomFactorOf(value: unknown): number {
  return normalizeUiZoomPercent(value) / 100;
}

/** 저장할 값 — 기본값(100)은 키를 비운다(저장값 없음 = 100% 와 같은 뜻). */
export function uiZoomPercentForSave(value: unknown): UiZoomPercent | undefined {
  const p = normalizeUiZoomPercent(value);
  return p === DEFAULT_UI_ZOOM_PERCENT ? undefined : p;
}

export const UI_ZOOM_TEXT = {
  label: '화면 배율',
  description: '글자와 버튼을 함께 줄입니다. 시험 기능입니다. 저장 시 반영됩니다.',
  option: (p: UiZoomPercent) => (p === DEFAULT_UI_ZOOM_PERCENT ? `${p}% (기본)` : `${p}%`),
};
