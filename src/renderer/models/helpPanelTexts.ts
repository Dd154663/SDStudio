// 긴 도움말 패널 문구(2026-11-20 UI 정돈 그룹 1-b — 종전 HelpIcon 한 덩어리 툴팁 문자열 대체).
// 원칙: 종전 문구의 뜻을 그대로 나눠 옮긴다(새 사실을 더하지 않음). 그리기는 componenets/HelpPanel.tsx(HelpPanelButton).
// 예시 칩의 범위·버튼 이름은 화면 라벨과 글자까지 같게 둔다(FindReplaceDialog scopeBoxes·「공백 검색」 체크,
// 템플릿 관리 [복사해 오기]·바닥줄 [저장]) — jest helpPanel.test.tsx 가 대조한다.
// 프롬프트 문법 패널 문구는 models/promptSyntaxHelp.ts.
import type { HelpPanelData } from './helpPanel';

// 찾기 및 변환 창 「공백 검색」 옆(FindReplaceDialog) — 문구는 사용자가 목업에서 승인(2026-11-20).
export const FIND_REPLACE_HELP: HelpPanelData = {
  title: '찾기 및 변환',
  groups: [
    {
      id: 'basic',
      title: '기본',
      rows: [{ id: 'selected-scenes', example: '선택한 씬', desc: '선택한 씬의 글자를 찾아 한꺼번에 바꿉니다.' }],
    },
    {
      id: 'preset-scopes',
      title: '씬 선택과 무관한 범위',
      rows: [
        {
          id: 'presets',
          example: ['캐릭터 프리셋', '글로벌 프리셋'],
          desc: '씬을 고르지 않아도 검색됩니다. 범위를 끄면 빠집니다.',
        },
      ],
    },
    {
      id: 'name-scopes',
      title: '이름을 바꾸는 범위',
      rows: [
        {
          id: 'names',
          example: ['씬 이름', '프로젝트 이름'],
          desc: '변환하면 실제 이름이 바뀝니다. 같은 이름이 이미 있으면 건너뜁니다.',
        },
      ],
    },
    {
      id: 'options',
      title: '옵션',
      rows: [
        {
          id: 'whitespace',
          example: '공백 검색',
          desc: '검색어의 공백을 그대로 씁니다. 공백만 찾아 다른 글자로 바꿀 수 있습니다.',
        },
      ],
    },
  ],
};

// 템플릿 관리 창 제목 옆(TemplateManagerModal). 셋째 묶음(저장 시점 두 갈래)이 핵심 규칙.
export const TEMPLATE_MANAGER_HELP: HelpPanelData = {
  title: '템플릿 관리',
  groups: [
    {
      id: 'what',
      title: '무엇인가',
      rows: [
        {
          id: 'purpose',
          desc: '새 프로젝트를 만들 때 시작 구성(프리셋, 캐릭터, 바이브, 레퍼런스, 씬)을 미리 세팅하는 워크플로우입니다.',
        },
        { id: 'editable', desc: '모든 영역은 직접 편집할 수 있습니다.' },
      ],
    },
    {
      id: 'copy',
      title: '복사해 오기',
      rows: [{ id: 'copy-once', example: '복사해 오기', desc: '설정을 한 번 덮어쓰는 편의 기능입니다.' }],
    },
    {
      id: 'save',
      title: '저장되는 때',
      rows: [
        {
          id: 'prompt',
          example: '프롬프트 수정',
          desc: '바닥의 [저장] 버튼을 누르거나 창을 닫을 때 저장됩니다.',
        },
        {
          id: 'others',
          example: '그 밖의 변경',
          desc: '복사해 오기, 캐릭터, 씬 변경은 바로 저장됩니다.',
        },
      ],
    },
  ],
};

// 캐릭터 프리셋 창 도구줄 끝(CharacterPresetEditor) — 묶음 하나, 칩 없는 줄.
export const CHARACTER_PRESET_HELP: HelpPanelData = {
  title: '캐릭터 프리셋',
  groups: [
    {
      id: 'main',
      rows: [
        { id: 'what', desc: '캐릭터 프리셋은 캐릭터 프롬프트, 네거티브, 바이브, 레퍼런스의 묶음입니다.' },
        {
          id: 'apply',
          desc: '카드 버튼으로 현재 프로젝트에 적용하거나 해제합니다. 여러 개를 한꺼번에 적용할 수 있습니다.',
        },
        {
          id: 'global',
          desc: '글로벌 프리셋은 모든 프로젝트에서 공유되며, 적용하면 현재 프로젝트로 사본이 들어갑니다.',
        },
      ],
    },
  ],
};

// 폴더 기본 템플릿 창 제목 옆(TemplateInheritModals) — 묶음 하나, 칩 없는 줄.
export const FOLDER_TEMPLATE_HELP: HelpPanelData = {
  title: '폴더 기본 템플릿',
  groups: [
    {
      id: 'main',
      rows: [
        {
          id: 'auto-apply',
          desc: '이 폴더(하위 폴더 포함)에서 새 프로젝트를 만들 때 아래 구성이 자동 적용됩니다.',
        },
        {
          id: 'adjust',
          desc: '전역 템플릿을 복사해 온 뒤 이 폴더 전용으로 세부 조정할 수 있습니다. 전역 원본에는 영향이 없습니다.',
        },
        { id: 'clear', desc: '아무것도 세팅하지 않고 닫으면 지정이 해제됩니다.' },
      ],
    },
  ],
};

// 폴더 기본 템플릿 창 「배지 색 (♚/♟)」 옆(TemplateInheritModals) — 기호 칩 + 뜻.
export const TEMPLATE_BADGE_HELP: HelpPanelData = {
  title: '배지 색',
  groups: [
    {
      id: 'main',
      rows: [
        { id: 'parent', example: '♚', desc: '이 폴더의 기본 템플릿(부모)' },
        { id: 'child', example: '♟', desc: '그 템플릿을 상속받은 프로젝트' },
        { id: 'color', desc: '배지 색으로 어느 부모의 자식인지 구분합니다.' },
      ],
    },
  ],
};
