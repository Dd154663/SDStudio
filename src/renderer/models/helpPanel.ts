// 도움말 패널 공용 모양(2026-11-20 UI 정돈 그룹 1-b — 문법 패널(2026-11-19 시범 ①)을 다른 긴 도움말에도 쓰도록 뽑음).
// 그리기는 componenets/HelpPanel.tsx(HelpPanelButton). 여기는 순수 데이터 모양과 위치 계산이라 jest 가 서비스 없이 읽는다.
// 내용 데이터: 프롬프트 문법 = models/promptSyntaxHelp.ts, 그 밖의 자리 = models/helpPanelTexts.ts.

// 예시 칩의 한 조각 — cls 는 편집 칸 하이라이트(highlightPrompt)가 같은 글자에 붙이는 .syntax-* 클래스.
export interface HelpChipPart {
  text: string;
  cls?: string;
}

export type HelpChip =
  // 프롬프트에 그대로 적는 글자(고정폭 칩, 편집 칸과 같은 문법 색)
  | { kind: 'code'; parts: HelpChipPart[] }
  // 키 표시(PC 단축키)
  | { kind: 'keys'; keys: string[] }
  // 적는 글자가 아닌 이름(「줄바꿈」·화면의 범위 이름·버튼 이름 등) — 칩 모양만, 고정폭 아님
  | { kind: 'label'; text: string };

// 줄의 예시 — 칩 하나, 글자(= 이름 칩), 또는 한 줄에 나란히 놓는 여러 칩. 없으면 설명이 줄 전체 폭.
export type HelpExample = HelpChip | string | (HelpChip | string)[];

export interface HelpRow {
  id: string;
  example?: HelpExample;
  desc: string;
}

export interface HelpGroup {
  id: string;
  // 없으면 묶음 제목 줄 없이 줄만(묶음 하나짜리 짧은 패널)
  title?: string;
  rows: HelpRow[];
}

export interface HelpPanelData {
  title: string;
  groups: HelpGroup[];
}

// 예시를 칩 목록으로 펴기 — 글자는 이름 칩.
export function helpChipsOf(example: HelpExample | undefined): HelpChip[] {
  if (example == null) return [];
  const list = Array.isArray(example) ? example : [example];
  return list.map((c) => (typeof c === 'string' ? { kind: 'label', text: c } : c));
}

// 여는 단추의 접근성 이름 기본값 — 「대상 이름 도움말」.
export function helpPanelButtonLabel(title: string): string {
  return `${title} 도움말`;
}

// 앵커(버튼) 아래 왼쪽 맞춤으로 펼치고, 아래가 모자라면 위로(위가 더 넓을 때), 가로는 화면 안으로 당긴다.
// 둘 다 모자라면 넓은 쪽에 붙이고 maxHeight 로 줄여 패널 안에서 스크롤한다. ContextMenuList.placeContextMenu 는
// 누른 점 기준(위로 올릴 때 점 위에 붙임)이라 버튼을 가리게 돼 버튼 기준 계산을 따로 둔다.
export function placeAnchoredPanel(
  anchor: { left: number; top: number; bottom: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 6,
  margin = 8,
): { left: number; top: number; maxHeight: number } {
  const width = Math.min(size.width, viewport.width - margin * 2);
  let left = anchor.left;
  if (left + width > viewport.width - margin) left = viewport.width - margin - width;
  if (left < margin) left = margin;
  const below = viewport.height - margin - (anchor.bottom + gap);
  const above = anchor.top - gap - margin;
  if (size.height <= below || below >= above) {
    return { left, top: anchor.bottom + gap, maxHeight: Math.max(0, below) };
  }
  const h = Math.min(size.height, above);
  return { left, top: anchor.top - gap - h, maxHeight: Math.max(0, above) };
}
