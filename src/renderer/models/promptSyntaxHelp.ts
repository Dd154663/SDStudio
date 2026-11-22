// 프롬프트 문법 설명 패널의 내용(2026-11-19 UI 정돈 시범 ① — 종전 PreSetEdtior 의 PROMPT_SYNTAX_HELP 한 덩어리 문자열 대체).
// 그리기는 componenets/PromptSyntaxHelp.tsx. 여기는 순수 데이터라 jest 가 서비스 없이 읽는다.
// 근거(종전 문자열 주석 그대로): PromptService(조각 <그룹.조각>, ##주석## 제거, {a|b} 인라인 랜덤 expandInlineRandom,
// 줄바꿈=쉼표), highlightPrompt(가중치·예시 칩의 .syntax-* 클래스), PromptEditTextArea(자동완성 트리거, Ctrl+↑↓ 0.05),
// artistTags(artist: 접두), 모바일 키보드 위 칩(가중치·# 주석 칩).
// 「.6 처럼 0 생략 가능」은 사용자 지시로 설명에서 뺐다(문법 자체는 그대로 동작).

// 예시 칩·줄·묶음 모양은 공용 도움말 패널(models/helpPanel.ts)과 같다 — 예전 이름을 그대로 남긴다.
import type { HelpChip, HelpChipPart, HelpPanelData } from './helpPanel';

export type SyntaxPart = HelpChipPart;
export type SyntaxExample = HelpChip;

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
        ...(mobile
          ? [
              {
                id: 'mobile-chips',
                example: { kind: 'label', text: '키보드 칩' },
                desc: '키보드 위 칩으로 세기 조절, # 칩으로 주석 감싸기와 풀기',
              } as SyntaxHelpRow,
            ]
          : [
              {
                id: 'weight-keys',
                example: { kind: 'keys', keys: ['Ctrl', '↑', '↓'] },
                desc: '커서가 있는 구획의 세기를 0.05 씩',
              } as SyntaxHelpRow,
              // 2026-11-22 — 편집기 안 Ctrl+3(PromptEditTextArea, promptTransforms.isPromptCommentToggleKey).
              {
                id: 'comment-keys',
                example: { kind: 'keys', keys: ['Ctrl', '3'] },
                desc: '주석 켜기/끄기. 고른 글자, 없으면 커서가 있는 구획',
              } as SyntaxHelpRow,
              // 2026-11-22 — 칸 오른쪽 위 돋보기(PromptEditTextArea → PromptFindBar). 단축키는 없다(사용자 결정).
              {
                id: 'find-in-field',
                example: { kind: 'label', text: '돋보기' },
                desc: '칸 오른쪽 위 돋보기로 이 칸에서 찾기·바꾸기',
              } as SyntaxHelpRow,
            ]),
      ],
    },
  ];
}

// 패널 한 벌(제목 + 묶음) — 공용 HelpPanelButton 에 넘기는 모양.
export function promptSyntaxHelpData(mobile: boolean): HelpPanelData {
  return { title: PROMPT_SYNTAX_HELP_TEXT.title, groups: promptSyntaxHelpGroups(mobile) };
}

// 위치 계산은 공용 모듈로 옮겼다(2026-11-20 그룹 1-b) — 예전 import 경로 유지용 재export.
export { placeAnchoredPanel } from './helpPanel';
