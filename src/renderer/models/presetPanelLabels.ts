// 사전 세팅 패널 버튼 짧은 글자 — 단일 출처(2026-11-10 아이콘 직관화 묶음 2, SPEC_GUIDE §6 「사전 세팅 패널 라벨」).
// 툴팁 전체 이름은 각 버튼의 Tooltip 그대로 두고, 여기 글자는 아이콘 옆(또는 아래)에 상시 보이는 짧은 이름만 맡는다.
// 공간이 모자라면 아이콘만 단계로 떨어진다(측정·판정은 묶음 1 의 projectBarStage / useProjectBarStage 재사용).

// 동작 버튼(아이콘 옆 글자) — 공백 뺀 글자 수 상한.
export const PRESET_ACTION_LABEL_MAX_CHARS = 6;

export const PRESET_ACTION_LABELS = {
  // 사전세팅선택 아래 줄(PreSetSelect)
  newPreset: '새 세팅',
  copyFromGlobal: '글로벌에서',
  bulkDelete: '일괄 삭제',
  // 그림체 카드 줄 오른쪽 세로 버튼(ProfilePreSetSelect)
  newStyle: '새 그림체',
  importFiles: '파일',
  // 캐릭터 프롬프트 카드의 프리셋 해제 ✕
  releasePreset: '해제',
} as const;

export type PresetActionLabelKey = keyof typeof PRESET_ACTION_LABELS;

// 하단 아이콘 행(uiPresetIconRow) 세로형 라벨 — 아이콘 위·이름 아래. 공백 뺀 글자 수 상한.
export const PRESET_ICON_ROW_LABEL_MAX_CHARS = 4;

// 키 = wfiElementKey(배포 후 불변 계약, PreSetEdtior PRESET_ICON_ROW_KEYS 와 같은 집합).
export const PRESET_ICON_ROW_LABELS: Readonly<Record<string, string>> = {
  characterPrompts: '캐릭터',
  'sampling-group': '샘플링',
  vibes: '바이브',
  characterReferences: '레퍼런스',
};

// 표에 없는 키(새 그룹 등)는 그룹 제목의 첫 토막(「/」·공백 앞)을 상한까지 잘라 쓴다.
export function presetIconRowLabelOf(key: string | undefined, title?: string): string {
  const found = key ? PRESET_ICON_ROW_LABELS[key] : undefined;
  if (found) return found;
  const head = (title ?? '').split(/[\/\s]/).find((s) => s.length > 0) ?? '';
  return Array.from(head).slice(0, PRESET_ICON_ROW_LABEL_MAX_CHARS).join('');
}
