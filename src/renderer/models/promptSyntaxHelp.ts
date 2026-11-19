// 프롬프트 문법 설명 패널의 내용(2026-11-19 UI 정돈 시범 ① — 종전 PreSetEdtior 의 PROMPT_SYNTAX_HELP 한 덩어리 문자열 대체).
// 그리기는 componenets/PromptSyntaxHelp.tsx. 여기는 순수 데이터라 jest 가 서비스 없이 읽는다.
// 근거(종전 문자열 주석 그대로): PromptService(조각 <그룹.조각>, ##주석## 제거, {a|b} 인라인 랜덤 expandInlineRandom,
// 줄바꿈=쉼표), highlightPrompt(가중치·예시 칩의 .syntax-* 클래스), PromptEditTextArea(자동완성 트리거, Ctrl+↑↓ 0.05),
// artistTags(artist: 접두), 모바일 키보드 위 칩(가중치·# 주석 칩).
// 「.6 처럼 0 생략 가능」은 사용자 지시로 설명에서 뺐다(문법 자체는 그대로 동작).

// 예시 칩의 한 조각 — cls 는 편집 칸 하이라이트(highlightPrompt)가 같은 글자에 붙이는 .syntax-* 클래스.
export interface SyntaxPart {
  text: string;
  cls?: string;
}

export type SyntaxExample =
  // 프롬프트에 그대로 적는 글자(고정폭 칩, 편집 칸과 같은 문법 색)
  | { kind: 'code'; parts: SyntaxPart[] }
  // 키 표시(PC 단축키)
  | { kind: 'keys'; keys: string[] }
  // 적는 글자가 아닌 이름(「줄바꿈」 등) — 칩 모양만, 고정폭 아님
  | { kind: 'label'; text: string };

export interface SyntaxHelpRow {
  id: string;
  example: SyntaxExample;
  desc: string;
}

export interface SyntaxHelpGroup {
  id: string;
  title: string;
  rows: SyntaxHelpRow[];
}

export const PROMPT_SYNTAX_HELP_TEXT = {
  title: '프롬프트 문법',
  buttonLabel: '프롬프트 문법 설명',
} as const;

const code = (...parts: SyntaxPart[]): SyntaxExample => ({ kind: 'code', parts });

// mobile = 모바일 앱(Capacitor). 「입력 보조」의 마지막 줄만 다르다.
export function promptSyntaxHelpGroups(mobile: boolean): SyntaxHelpGroup[] {
  return [
    {
      id: 'weight',
      title: '세기',
      rows: [
        {
          id: 'emphasis',
          example: code({ text: '{blue hair}', cls: 'syntax-weight-emphasis syntax-strong' }),
          desc: '강조. 겹칠수록 강해집니다',
        },
        {
          id: 'deemphasis',
          example: code({ text: '[blue hair]', cls: 'syntax-weight-deemphasis syntax-weak' }),
          desc: '약화. 겹칠수록 약해집니다',
        },
        {
          id: 'explicit-weight',
          example: code({ text: '1.5::smile::', cls: 'syntax-weight-emphasis' }),
          desc: '숫자로 세기 지정. 음수도 되고, 쉼표로 여러 태그를 묶을 수 있습니다',
        },
      ],
    },
    {
      id: 'insert',
      title: '넣기',
      rows: [
        {
          id: 'piece',
          example: code({ text: '<옷.교복>', cls: 'syntax-wildcard' }),
          desc: '프롬프트조각 넣기. 프로젝트 것이 먼저, 없으면 전역',
        },
        {
          id: 'inline-random',
          // 편집 칸은 { } 로 감싼 한 단어라 강조와 같은 모양으로 그린다(| 가 있어도 별도 색 없음) — 같은 클래스를 쓴다.
          example: code({ text: '{red|blue|green}', cls: 'syntax-weight-emphasis syntax-strong' }),
          desc: '생성할 때마다 하나를 무작위로',
        },
        {
          id: 'artist',
          example: code({ text: 'artist:이름' }),
          desc: '작가 태그. 툴바 버튼으로 붙이기와 떼기 전환',
        },
      ],
    },
    {
      id: 'note',
      title: '적어 두기',
      rows: [
        {
          id: 'comment',
          example: code({ text: '##나중에 수정##', cls: 'syntax-comment' }),
          desc: '주석. 생성에는 빠지고 저장은 됩니다',
        },
        {
          id: 'newline',
          example: { kind: 'label', text: '줄바꿈' },
          desc: '쉼표와 같은 구분으로 칩니다',
        },
      ],
    },
    {
      id: 'assist',
      title: '입력 보조',
      rows: [
        {
          id: 'autocomplete',
          example: code({ text: '<' }),
          desc: '조각 검색. 태그는 입력 중에 자동으로 추천',
        },
        mobile
          ? {
              id: 'mobile-chips',
              example: { kind: 'label', text: '키보드 칩' },
              desc: '키보드 위 칩으로 세기 조절, # 칩으로 주석 감싸기와 풀기',
            }
          : {
              id: 'weight-keys',
              example: { kind: 'keys', keys: ['Ctrl', '↑', '↓'] },
              desc: '커서가 있는 구획의 세기를 0.05 씩',
            },
      ],
    },
  ];
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
