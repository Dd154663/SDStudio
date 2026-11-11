/**
 * SPEC_GUIDE 가드 — 단일 출처 스펙을 우회하는 하드코딩의 "신규 유입"을 차단한다.
 *
 * 실패 시: 저장소 루트 SPEC_GUIDE.md 의 해당 섹션(§)을 읽고 스펙을 사용할 것.
 * - 초과 = 신규 하드코딩. 스펙으로 교체하는 것이 원칙. 정당한 예외만 아래
 *   allowlist 건수를 올리고 커밋 메시지에 사유를 남긴다.
 * - 미달 = 하드코딩이 정리됨. allowlist 건수를 내려 동결 상태를 갱신한다.
 * - allowlist 에 이미 있는 항목은 의도적 잔류(P1.5 룰북·#12 잔류 목록)로 동결된
 *   것 — 소급 치환·재논쟁 금지.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TOOLBAR_VIEW_MAIN } from '../uiLayout';

const RENDERER_ROOT = path.resolve(__dirname, '..', '..');

interface Rule {
  name: string;
  guide: string; // SPEC_GUIDE.md 섹션
  dir: string; // RENDERER_ROOT 기준 스캔 시작점 ('' = 전체)
  exts: string[];
  exclude: string[]; // renderer 상대 posix 경로
  include?: string[]; // 있으면 이 파일들만 검사(renderer 상대 posix 경로 — 특정 모듈 전용 규칙)
  count: (content: string) => number;
  /** 있으면 초과 시 위반 행 번호(1부터)를 함께 보인다 */
  locate?: (content: string) => number[];
  allow: Record<string, number>; // renderer 상대 posix 경로 → 허용 건수
}

const countMatches = (content: string, re: RegExp) =>
  (content.match(re) || []).length;

// 툴바 버튼 id 전체(레지스트리 도출) — 아이콘 사전 밖에서 id→아이콘을 다시 정하는 코드 탐지용(§6).
// (id 는 영소문자·하이픈만이라 정규식 이스케이프가 필요 없다.)
const TOOLBAR_IDS_RE = TOOLBAR_VIEW_MAIN.flatMap((a) => a.registry.map((b) => b.id)).join('|');

// 주석을 뺀 코드(주석 속 금지어는 세지 않는 규칙용)
const stripComments = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// 행 번호를 보존하는 주석 제거(블록 주석은 줄바꿈만 남김) — locate 용
const stripCommentsKeepLines = (c: string) =>
  c
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// 일치 위치의 행 번호(1부터) — 여러 줄에 걸친 일치는 시작 행
const matchLines = (content: string, re: RegExp): number[] => {
  const code = stripCommentsKeepLines(content);
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return [...code.matchAll(g)].map((m) => code.slice(0, m.index ?? 0).split('\n').length);
};

// <ModalOverlay …> 여는 태그 중 size= 가 없는 것(옛 width 클래스·기본 max-w-xl·fullscreen 경로)의 시작 위치.
// 속성 안 화살표 함수(`() => …`)의 > 에 속지 않게 중괄호 깊이·따옴표를 따라 태그 끝을 찾는다.
const modalOverlayWithoutSize = (content: string): number[] => {
  const code = stripCommentsKeepLines(content);
  const out: number[] = [];
  const re = /<ModalOverlay\b/g;
  for (const m of code.matchAll(re)) {
    const start = m.index ?? 0;
    let depth = 0;
    let quote: string | null = null;
    let end = code.length;
    for (let i = start + m[0].length; i < code.length; i++) {
      const ch = code[i];
      if (quote) {
        if (ch === quote && code[i - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) {
        end = i;
        break;
      }
    }
    // 속성 이름 자리의 size= 만 센다(중괄호 안 표현식의 size= 는 제외 — 깊이 0 텍스트만 남김)
    let top = '';
    let d = 0;
    for (const ch of code.slice(start, end)) {
      if (ch === '{') d++;
      else if (ch === '}') d--;
      else if (d === 0) top += ch;
    }
    if (!/\ssize=/.test(top)) out.push(code.slice(0, start).split('\n').length);
  }
  return out;
};

// 프로젝트 휴지통 삭제의 직접 호출(sessionService.delete( — 공백·줄바꿈 허용). SessionService 내부의
// super.delete·favorites.delete·Map delete 는 수신자가 sessionService 가 아니라 걸리지 않는다.
const SESSION_DELETE_RE = /\bsessionService\s*\.\s*delete\s*\(/g;

// 되돌리기 계약(2026-11-01 U1)을 지키는 모듈 — 잠금·씬 직접 제거 금지 규칙의 대상
// U2a: 씬 구조(생성·이름·북마크) 계측 모듈 추가 · U2b: 씬 필드·조합·씬 캐릭터·시드 그룹 계측 모듈 추가
// U4: 삭제·휴지통 복원·복제·복사·붙여넣기 계측 모듈 추가 · U5: 변형 씬 필드·일괄 작업, 로컬 조각 계측 모듈 추가
// 2차 P3(2026-11-03): 찾기/바꾸기 「모두 변환」 계측 모듈 추가
// 2차 묶음 2(2026-11-03): 프로젝트·폴더(전역 스택) 계측 모듈 추가 · 2차 묶음 3(2026-11-04): 프로젝트·폴더 삭제류 계측 모듈 추가
// 2차 묶음 4(2026-11-04): 전역 라이브러리(파일 부작용 없는 작업) 계측 모듈 추가
const UNDO_MODULES = [
  'models/undoService.ts',
  'models/sceneOrderUndo.ts',
  'models/sceneStructureUndo.ts',
  'models/sceneFieldUndo.ts',
  'models/imageStateUndo.ts',
  'models/presetUndo.ts',
  'models/deleteUndo.ts',
  'models/variantSceneUndo.ts',
  'models/pieceUndo.ts',
  'models/findReplaceUndo.ts',
  'models/projectFolderUndo.ts',
  'models/projectDeleteUndo.ts',
  'models/globalLibraryUndo.ts',
  'models/sceneImportUndo.ts',
];

const RULES: Rule[] = [
  {
    // 전역 오버레이 z-index 는 --z-* 토큰만. 로컬 경쟁(z-0~z-50)은 허용.
    name: 'z-index 리터럴(51 이상) — --z-* 사다리 사용',
    guide: '§3',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: [],
    count: (c) => {
      let n = 0;
      for (const m of c.matchAll(/z-\[(\d+)\]/g))
        if (parseInt(m[1], 10) > 50) n++;
      for (const m of c.matchAll(/zIndex:\s*['"]?(\d+)/g))
        if (parseInt(m[1], 10) > 50) n++;
      return n;
    },
    allow: {},
  },
  {
    name: '솔리드 버튼 인라인(hover:bg-{액센트색}-600) — .btn-solid-* 사용',
    guide: '§2',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: [],
    // gray/slate 계열 hover(닫기 버튼 등 중립 상태)는 대상 아님 — 액센트색만.
    count: (c) =>
      countMatches(
        c,
        /hover:bg-(sky|green|red|orange|yellow|indigo|purple|blue|rose|emerald|teal|amber|pink|lime|cyan|violet|fuchsia)-600/g,
      ),
    allow: {
      'componenets/CharacterPresetEditor.tsx': 2,
      // ExportPresetManager 1건은 2026-11-11 오버레이 묶음 1 에서 .btn-solid-sky 로 정리
    },
  },
  {
    name: '입력 배경 하드코딩(bg-white dark:bg-slate-7xx) — --c-input-bg 사용',
    guide: '§1',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: [],
    count: (c) => countMatches(c, /bg-white dark:bg-slate-7\d\d/g),
    allow: {
      'componenets/TaskQueueControl.tsx': 1,
    },
  },
  {
    name: "이미지 확장자 리터럴('.png'/'.webp', models/) — imageFormats.ts 사용",
    guide: '§4',
    dir: 'models',
    exts: ['.ts'],
    exclude: ['models/imageFormats.ts'],
    count: (c) => countMatches(c, /\.(png|webp)['"`]/g),
    allow: {
      'models/AppService.ts': 1,
      'models/ArtistLibraryService.ts': 1,
      'models/BackupService.ts': 3,
      'models/BatchProcessService.ts': 2,
      'models/ExportPresetService.ts': 3,
      'models/GlobalCharacterPresetService.ts': 3,
      'models/GlobalPresetService.ts': 2,
      'models/ImageService.ts': 4,
      'models/legacy.ts': 7,
      'models/SessionService.ts': 8,
      // models/TaskHandlers.ts: 0 — 2026-10-29 부스트 B0 에서 outputFileName.nextOutputPngPath(PNG_IMAGE_EXT) 로 정리
      // models/TrashService.ts: 0 — 2026-10-02 S1 에서 sceneMaskFileName(PNG_IMAGE_EXT) 로 정리
      'models/workflows/SDWorkFlow.ts': 1,
    },
  },
  {
    // 프로젝트 데이터 경로는 projectPaths.ts 관문(이름 검증 내장)만 사용.
    // 루트 리터럴 + 문자열 결합은 빈 이름이 루트가 되는 사고 클래스의 근원
    // (2026-07-06 outs 증발 실사고).
    name: "프로젝트 루트 리터럴 결합('outs/' + … 등) — projectPaths.ts 사용",
    guide: '§10',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: ['models/projectPaths.ts'],
    count: (c) =>
      countMatches(
        c,
        /'(outs|inpaints|inpaint_orgs|inpaint_masks|vibes|references|projects|workspace)\/' *\+/g,
      ),
    allow: {
      // 백업 아카이브 내부의 "논리 경로"(물리 배치와 무관한 아카이브 엔트리명,
      // buildSessionDeepEntries 의 name: 필드) — 의도적 잔류. 물리 경로가 아니라
      // projectPath 대상이 아니다 (트랙1 조사 보고서 §1-6).
      'models/SessionService.ts': 6,
    },
  },
  {
    name: 'backButton 직접 등록/removeAllListeners — backStackService 사용',
    guide: '§5',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: ['models/BackStackService.ts'],
    count: (c) =>
      countMatches(c, /addListener\(\s*['"]backButton/g) +
      countMatches(c, /removeAllListeners/g),
    allow: {},
  },
  {
    // 작가 태그(artist:) 접두 판별·제거 정규식은 models/artistTags.ts 가 단일 출처(2026-09-25).
    // 기존 2곳(자동완성 카테고리·편집기)은 의도적 잔류로 동결. 작가 분해(promptTransforms)는 2026-10-02 artistTags 로 이전(2→0).
    name: '작가 접두 정규식 리터럴(artist\\s*:) — models/artistTags.ts 사용',
    guide: '「작가 태그 접두(artist:) 계약」',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: ['models/artistTags.ts'],
    count: (c) => countMatches(c, /artist\\s\*:/g),
    allow: {
      'models/promptAutocomplete.ts': 2,
      'componenets/PromptEditTextArea.tsx': 1,
    },
  },
  {
    // 모바일 키보드 위 칩(--z-kbd-action 층)은 MobileKeyboardChip 하나가 검색·가중치 조정 두 모드를 맡는다(2026-09-26).
    // 같은 층에 칩을 또 띄우면 키보드 위에서 서로 겹친다.
    name: '키보드 위 칩(--z-kbd-action) — componenets/MobileKeyboardChip.tsx 만 사용',
    guide: '「모바일 키보드 위 칩(Danbooru 검색·가중치 퀵 조정) 계약」',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: ['componenets/MobileKeyboardChip.tsx'],
    count: (c) => countMatches(c, /z-kbd-action/g),
    allow: {},
  },
  {
    // 확인 창의 select·checkbox·dropdown 은 내장 취소 하나만 그린다(2026-10-03 D3). items 에 「취소」류 항목·
    // value 'cancel' 을 넣으면 같은 뜻의 버튼이 둘이 된다 — 라벨을 바꾸려면 cancelText 를 쓴다.
    name: "확인 창 선택지의 「취소」류 항목(text: '취소' 등·value: 'cancel') — 내장 취소·cancelText 사용",
    guide: '§5',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: [],
    count: (c) =>
      countMatches(c, /text:\s*['"`](취소|닫기|아니오|아니요|나중에)['"`]/g) +
      countMatches(c, /value:\s*['"`]cancel['"`]/g),
    allow: {},
  },
  {
    // 확인/취소를 구분하는 확인은 appState.confirmAsync 하나(2026-10-03 D3). 콜백/onCancel 로 Promise 를
    // 손으로 푸는 복제 금지. 본체(confirmKeys.confirmViaDialog)는 제외, androidBackend 의 내보내기 선택 2곳은
    // 기존 잔류로 동결.
    name: '손으로 만든 확인 Promise(onCancel: () => resolve(…)) — appState.confirmAsync 사용',
    guide: '§5',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: ['models/confirmKeys.ts'],
    count: (c) => countMatches(c, /onCancel:\s*\(\)\s*=>\s*resolve\(/g),
    allow: {
      'backends/androidBackend.ts': 2,
    },
  },
  {
    // 확인 창의 파랑/빨강은 위험도(danger)로만 정한다 — 예전 green 옵션(빨강 대신 파랑)은 없앴다(2026-10-03 D1).
    name: '확인 창 green 옵션 — danger(없음/true/permanent) 사용',
    guide: '§5',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: [],
    count: (c) => countMatches(c, /^\s*green:\s*(true|false)\s*,/gm),
    allow: {},
  },
  {
    // 이름을 묻는 입력 창은 models/nameInput.promptName 하나(2026-10-03 D2) — 검증·중복 문구·미리 채움·실패 시 창 유지.
    // 아래 allowlist 는 이름이 아닌 입력(숫자·프롬프트·캐릭터 접두·대체 문자·찾을 씬 검색어) 17곳으로 동결 — 늘리지 않는다.
    // (2026-10-04 B1·B2 I2I 일괄의 강도·노이즈 숫자 입력 1곳 추가 — 사용자 사양 「값 입력」, 창 안 0~1 검증 helper 하나)
    name: "input-confirm 직접 호출(type: 'input-confirm') — 이름 입력은 promptName 사용",
    guide: '§5',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: ['models/nameInput.ts'],
    count: (c) => countMatches(c, /type:\s*['"]input-confirm['"]/g),
    allow: {
      'componenets/ResultViewer.tsx': 1, // 몇 등 이하 삭제(숫자)
      'componenets/SceneQueueControl.tsx': 1, // 찾을 씬 검색어
      'models/BackupService.ts': 4, // 캐릭터 이름(파일명 접두) 2·이미지 크기 1·파일명 구분자 1
      'models/BatchProcessService.ts': 5, // 순위 숫자 2·대체 문자 1·WebP 품질 2
      'models/customResolutionPrompt.ts': 2, // 해상도 너비·높이
      'models/ExportPresetService.ts': 1, // 캐릭터 접두
      'models/i2iBatch.ts': 1, // I2I 일괄 강도·노이즈(숫자 0~1, helper 하나를 두 번 호출)
      'models/workflows/OneTimeFlows.ts': 2, // 프롬프트
    },
  },
  {
    // 삭제 확인 문구는 models/deleteFlowRules.deleteConfirmText 하나(2026-10-03 E1) — 대상·휴지통 보존 일수/영구·
    // [삭제]/[영구 삭제] 라벨·위험도를 함께 정한다. 「정말로 삭제…」·「…삭제하시겠습니까?」 직접 작성 금지.
    // 아래 allowlist 는 함수 밖 예외(폴더 삭제 — 프로젝트는 미분류/휴지통, 캐릭터 프리셋 폴더는 미분류 이동)로 동결.
    name: '삭제 확인 문구 직접 작성(삭제하시겠·삭제할까요·정말로 … 삭제) — deleteConfirmText 사용',
    guide: '§8',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: ['models/deleteFlowRules.ts'],
    count: (c) =>
      countMatches(c, /삭제하시겠|삭제할까요|정말로?[^'"`\n]{0,20}삭제/g),
    allow: {
      'componenets/CharacterPresetEditor.tsx': 1, // 캐릭터 프리셋 폴더 삭제(소속 프리셋은 미분류로)
      'models/folderDeleteFlow.ts': 2, // 프로젝트 폴더 삭제(빈 폴더·폴더와 프로젝트 모두)
    },
  },
  {
    // 아이콘 의미 사전(2026-10-04 I1) — 툴바 id 의 아이콘은 models/iconDictionary.ts 한 곳에서만 정한다.
    // 컴포넌트별 id→아이콘 맵(옛 QuickMenu ACTION_ICONS)·「'id': <Fa…」·V2 칸 「key: 'id' … icon: <Fa…」 재정의 금지.
    name: '툴바 id 아이콘 재정의(ACTION_ICONS·id→<Fa…>) — models/iconDictionary.ts 사용',
    guide: '§6',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: ['models/iconDictionary.ts'],
    count: (c) =>
      countMatches(c, /\bACTION_ICONS\b/g) +
      countMatches(c, new RegExp(`['"](${TOOLBAR_IDS_RE})['"]\\s*:\\s*<(Fa|Bi|Md)`, 'g')) +
      countMatches(
        c,
        new RegExp(`key:\\s*'(${TOOLBAR_IDS_RE})',[^}]*?icon:\\s*<(Fa|Bi|Md)`, 'g'),
      ),
    allow: {},
  },
  {
    // 전용 아이콘(§6 아이콘 의미 사전): 구름(FaCloud*)=드라이브·FaCog=환경설정·FaPaintBrush=인페인트.
    // 다른 뜻에는 사전의 뜻별 아이콘을 쓴다. 남은 건수는 그 뜻 그대로의 자리(환경설정 버튼·검수 화면 인페인트).
    name: '전용 아이콘 직접 사용(<FaCloud*·<FaCog·<FaPaintBrush) — 아이콘 의미 사전 사용',
    guide: '§6',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: ['models/iconDictionary.ts'],
    count: (c) => countMatches(c, /<(FaCloud\w*|FaCog|FaPaintBrush)\b/g),
    allow: {
      'componenets/TobBar.tsx': 2,
      'componenets/ImageReview.tsx': 1,
    },
  },
  {
    // 사용자 노출 용어 사전(2026-10-04 E3) — 불러오기=파일·드라이브→앱, 복사=글로벌↔프로젝트, 적용=이미지
    // 메타데이터→설정, 내보내기=앱→파일. 구 동사(임포트·세션으로 가져오기·글로벌 프리셋으로 저장)와 표기
    // (빠른 export·영구삭제·예약 취소)를 새 문구에 쓰지 않는다. 주석은 세지 않는다(식별자는 영문이라 무관).
    name: '구 용어(임포트·빠른 export·영구삭제·예약 취소·세션으로 가져오기·글로벌 프리셋으로 저장) — 용어 사전 사용',
    guide: '§12-3',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: [],
    count: (c) =>
      countMatches(
        c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'),
        /임포트|빠른 export|영구삭제|예약 (일괄 )?취소|예약이 취소|세션으로 (일괄 )?가져오|글로벌 프리셋으로 저장/g,
      ),
    allow: {},
  },
  {
    // PC 씬 툴바 그룹 캡션(2026-10-04 T5) — 그룹 순서·캡션 문구는 models/uiLayout.ts 의 TOOLBAR_GROUPS 한 곳.
    // 캡션 칸(.toolbar-group-caption)에 글자를 직접 쓰거나 「편집 도구」 같은 캡션 문자열을 다시 적지 않는다.
    // (생성·탐색·내보내기는 일반 단어라 세지 않는다 — 고유한 「편집 도구」 문자열과 캡션 칸 직접 글자만.)
    name: '툴바 그룹 캡션 직접 작성 — models/uiLayout.ts TOOLBAR_GROUPS 사용',
    guide: '§6',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: ['models/uiLayout.ts'],
    count: (c) => {
      const code = c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      return (
        countMatches(code, /(['"`])편집 도구\1/g) +
        countMatches(code, /toolbar-group-caption[^>]*>\s*[^\s{<]/g)
      );
    },
    allow: {},
  },
  {
    // .round-button·.icon-button 은 @layer components(2026-10-04 B1) — 사용처 유틸이 이미 이기므로
    // 패딩·최소 크기 덮어쓰기에 ! 를 붙이지 않는다. 버튼 문자열(따옴표·백틱 리터럴) 안의 !p*-·!min-w/h- 를 센다.
    name: '버튼 패딩 ! 덮어쓰기(round-button/icon-button + !px-·!py-·!min-w-0 등) — ! 없이 유틸 사용',
    guide: '§2',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: [],
    count: (c) => {
      let n = 0;
      for (const m of c.matchAll(/`[^`]*`|"[^"\n]*"|'[^'\n]*'/g)) {
        if (!/(^|[^\w-])(round|icon)-button([^\w-]|$)/.test(m[0])) continue;
        n += countMatches(m[0], /(^|[\s'"`])!(p[xytblr]?|min-w|min-h)-/g);
      }
      return n;
    },
    allow: {},
  },
  {
    // 버튼 반경은 토큰(--r-btn 글자 버튼 알약·--r-btn-icon 아이콘만 버튼 모던 8px). 버튼 클래스에 rounded-full 을
    // 직접 붙이면 토큰을 우회한다(아이콘만 버튼이 옵션과 무관하게 알약이 됨).
    // 알약·원 유지 대상(태그·칩·배지·진행바·원형 오버레이·FAB)은 round-button/icon-button 을 쓰지 않는다.
    name: '버튼 클래스에 rounded-full 직접(round-button/icon-button) — --r-btn 토큰 사용',
    guide: '§2',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: [],
    count: (c) => {
      let n = 0;
      for (const m of c.matchAll(/`[^`]*`|"[^"\n]*"|'[^'\n]*'/g)) {
        if (!/(^|[^\w-])(round|icon)-button([^\w-]|$)/.test(m[0])) continue;
        n += countMatches(m[0], /(^|[\s'"`!:])rounded-full([^\w-]|$)/g);
      }
      return n;
    },
    allow: {},
  },
  {
    // Opus 할당량을 무료분(percent)만으로 직접 비교하면 추가 충전분(purchasedPercent)을 놓친다(2026-10-25).
    // 과금 위험·저잔량·전환·순회 판정은 opusUsageRules 헬퍼를 쓴다.
    name: 'Opus 할당량 percent 직접 비교 — opusUsageRules 헬퍼 사용',
    guide: '§14',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: ['models/opusUsageRules.ts'],
    count: (c) => countMatches(c, /\b(usage|status)\??\.percent\s*(<=|>=|<|>)/g),
    allow: {},
  },
  {
    // 되돌리기 모듈은 잠금을 쓰지 않는다(2026-11-01 U1) — 항목은 공개 서비스 메서드만 부르고 그 메서드가 각자 잠근다.
    // 되돌림 실행부가 잠금을 잡으면 같은 이름 withLock 중첩(교착)이 생긴다. 주석은 세지 않는다.
    name: '되돌리기 모듈의 withLock 사용 — 공개 서비스 메서드 경유',
    guide: '「되돌리기 계약」',
    dir: 'models',
    exts: ['.ts'],
    exclude: [],
    include: UNDO_MODULES,
    count: (c) => countMatches(stripComments(c), /withLock/g),
    allow: {},
  },
  {
    // 씬 제거는 TrashService(moveSceneToTrash) 경유(§8 씬 유실 가드) — 되돌리기 항목이 Map 에서 씬을 직접 빼지 않는다.
    name: '되돌리기 모듈의 removeScene( 직접 호출 — TrashService 경유',
    guide: '「되돌리기 계약」·§8',
    dir: 'models',
    exts: ['.ts'],
    exclude: [],
    include: UNDO_MODULES,
    count: (c) => countMatches(stripComments(c), /removeScene\(/g),
    allow: {},
  },
  {
    // 이미지 필드 통째 복원 금지(2026-11-01 U2b, 최우선 원칙 — 생성 중 새로 생긴 이미지를 지운다).
    // 되돌리기 모듈은 imageMap·mains·game·round 에 대입하지 않는다 — 즐겨찾기는 ImageService.setImageMain(절대값),
    // 순서·순위는 GameService.applyImageOrder·applyRanking(병합 복원 전용 공개 메서드)만 부른다(U3a).
    name: '되돌리기 모듈의 이미지 필드 대입 — 필드 단위·병합 복원만',
    guide: '「되돌리기 계약」',
    dir: 'models',
    exts: ['.ts'],
    exclude: [],
    include: UNDO_MODULES,
    count: (c) => countMatches(stripComments(c), /\.(imageMap|mains|game|round)\s*=(?!=)/g),
    allow: {},
  },
  {
    // 휴지통 프로젝트 복원은 SessionService.restoreProjectFromTrash 관문만(2026-11-03 사이드카 보존) —
    // trashService.restoreProject 를 직접 부르면 즐겨찾기·북마크·썸네일 스냅숏이 버려진다.
    name: 'trashService.restoreProject 직접 호출 — restoreProjectFromTrash 경유',
    guide: '§8-3 「프로젝트 휴지통 사이드카 보존」',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: [],
    count: (c) => countMatches(stripComments(c), /\.restoreProject\(/g),
    allow: { 'models/SessionService.ts': 1 },
  },
  {
    // 프로젝트 삭제는 반드시 공용 흐름(projectDeleteFlow)을 거친다(2026-11-07 규약, A10 사고 2026-11-03:
    // 드로어 삭제가 현재 프로젝트를 닫지 않아 「미등록 프로젝트의 경로」 오류). 호출부는
    // runProjectTrashDelete / deleteProjectForFolderFlow / deleteProjectForReplaceFlow 또는 되돌리기 래퍼
    // projectDeleteUndo.deleteProjectRecorded 를 쓴다. 주석은 세지 않는다.
    name: 'sessionService.delete 직접 호출 — projectDeleteFlow 관문 경유',
    guide: '§8 「프로젝트 삭제 관문」(관문 강제)',
    dir: '',
    exts: ['.ts', '.tsx'],
    exclude: [],
    count: (c) => countMatches(stripComments(c), SESSION_DELETE_RE),
    locate: (c) => matchLines(c, SESSION_DELETE_RE),
    allow: { 'models/projectDeleteFlow.ts': 1 },
  },
  {
    // 오버레이 창 크기 체계(2026-11-11 묶음 0) — 새 ModalOverlay 는 size(s|m|l|xl|full) 등급만 쓴다.
    // 옛 width 폭 클래스·기본 max-w-xl·fullscreen 경로(= size 없는 호출)는 아래 allowlist 로 동결하고,
    // 묶음 1 이후 창별로 size 로 옮기며 건수를 내린다(늘리지 않는다).
    // 2026-11-11 묶음 1: 19파일 27곳 → 16파일 23곳(씬 템플릿 관리 m·내보내기 프리셋 l/s·프롬프트조각 l/m·프로젝트 탐색 xl,
    // 환경설정은 직접 만든 창이라 집계 밖이었고 PC 경로를 size l 로 흡수).
    name: 'ModalOverlay size 없는 호출(width 폭 클래스·기본값·fullscreen) — size 등급 사용',
    guide: '「오버레이 창 크기 체계」',
    dir: '',
    exts: ['.tsx'],
    exclude: [],
    count: (c) => modalOverlayWithoutSize(c).length,
    locate: (c) => modalOverlayWithoutSize(c),
    allow: {
      'componenets/App.tsx': 2, // 프로젝트 휴지통·씬 휴지통(프롬프트조각은 묶음 1 에서 PieceEditor 안 size l 로)
      'componenets/ArtistLibraryTab.tsx': 2, // 태그 프리셋 관리·작가 상세
      'componenets/CharacterPresetEditor.tsx': 1, // 캐릭터 프리셋 관리
      'componenets/ConfigSyncSection.tsx': 1, // 환경설정 불러오기 미리보기
      'componenets/ConfigSystemTab.tsx': 1, // 축하 영상
      'componenets/DirectExportDialog.tsx': 1, // 직접 내보내기 설정
      'componenets/DriveBackupManager.tsx': 1, // Google 드라이브 백업
      'componenets/FindReplaceDialog.tsx': 1, // 찾기 및 변환
      'componenets/PreSetEdtior.tsx': 3, // 사전 세팅 일괄 삭제·캐릭터 위치 지정(fullscreen)·샘플링 그룹
      'componenets/QuickMenu.tsx': 1, // 퀵 메뉴(모바일)
      'componenets/SceneEditor.tsx': 1, // 캐릭터 위치 지정(fullscreen)
      'componenets/SceneQuickPromptModal.tsx': 1, // 중간 프롬프트 가운데 폴백(모바일)
      'componenets/StorageManageModal.tsx': 1, // 프로젝트 저장 공간 관리
      'componenets/TemplateInheritModals.tsx': 2, // 폴더 기본 템플릿·템플릿 적용
      'componenets/TemplateManagerModal.tsx': 2, // 글로벌 프리셋에서 복사·템플릿 관리
      'componenets/ToolbarOverflowMenu.tsx': 1, // ⋯ 메뉴(모바일)
    },
  },
];

function listFiles(dirAbs: string, exts: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (exts.includes(path.extname(e.name))) out.push(full);
    }
  };
  walk(dirAbs);
  return out;
}

const toRel = (abs: string) =>
  path.relative(RENDERER_ROOT, abs).split(path.sep).join('/');

describe('SPEC_GUIDE 가드 (하드코딩 신규 유입 차단)', () => {
  test('ModalOverlay size 판정 스캐너 — 화살표 함수 > 와 중괄호 안 size= 에 속지 않는다', () => {
    const src = [
      '<ModalOverlay isOpen onClose={() => close()} title="a" width="max-w-md">',
      '<ModalOverlay isOpen onClose={() => close()} size="m">',
      '<ModalOverlay isOpen onClose={() => f({ size: 1 })} title="b" fullscreen>',
      '<ModalOverlay',
      '  isOpen',
      '  size={big ? "l" : "m"}',
      '>',
    ].join('\n');
    expect(modalOverlayWithoutSize(src)).toEqual([1, 3]);
  });
  test('include 규칙의 대상 파일이 실제로 있다(경로 오타로 조용히 통과하지 않게)', () => {
    for (const rule of RULES) {
      for (const rel of rule.include ?? []) {
        expect(fs.existsSync(path.join(RENDERER_ROOT, rel))).toBe(true);
      }
    }
  });
  for (const rule of RULES) {
    test(rule.name, () => {
      const files = listFiles(path.join(RENDERER_ROOT, rule.dir), rule.exts);
      const actual: Record<string, number> = {};
      const where: Record<string, number[]> = {};
      for (const f of files) {
        const rel = toRel(f);
        if (rule.exclude.includes(rel)) continue;
        if (rule.include && !rule.include.includes(rel)) continue;
        const content = fs.readFileSync(f, 'utf8');
        const n = rule.count(content);
        if (n > 0) {
          actual[rel] = n;
          if (rule.locate) where[rel] = rule.locate(content);
        }
      }
      const problems: string[] = [];
      const keys = new Set([...Object.keys(actual), ...Object.keys(rule.allow)]);
      for (const k of keys) {
        const a = actual[k] || 0;
        const allowed = rule.allow[k] || 0;
        if (a > allowed)
          problems.push(
            `[초과] ${k}${where[k]?.length ? `:${where[k].join(',')}행` : ''}: ${a}건(허용 ${allowed}) — SPEC_GUIDE.md ${rule.guide} 의 스펙을 사용할 것`,
          );
        else if (a < allowed)
          problems.push(
            `[미달] ${k}: ${a}건(허용 ${allowed}) — 정리됐으면 specGuard.test.ts 의 allowlist 를 ${a}건으로 갱신`,
          );
      }
      expect(problems).toEqual([]);
    });
  }
});
