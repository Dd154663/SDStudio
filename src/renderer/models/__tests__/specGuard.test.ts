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

const RENDERER_ROOT = path.resolve(__dirname, '..', '..');

interface Rule {
  name: string;
  guide: string; // SPEC_GUIDE.md 섹션
  dir: string; // RENDERER_ROOT 기준 스캔 시작점 ('' = 전체)
  exts: string[];
  exclude: string[]; // renderer 상대 posix 경로
  count: (content: string) => number;
  allow: Record<string, number>; // renderer 상대 posix 경로 → 허용 건수
}

const countMatches = (content: string, re: RegExp) =>
  (content.match(re) || []).length;

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
      'componenets/ExportPresetManager.tsx': 1,
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
      'models/TaskHandlers.ts': 3,
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
    // 아래 allowlist 는 이름이 아닌 입력(숫자·프롬프트·캐릭터 접두·대체 문자·찾을 씬 검색어) 16곳으로 동결 — 늘리지 않는다.
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
  for (const rule of RULES) {
    test(rule.name, () => {
      const files = listFiles(path.join(RENDERER_ROOT, rule.dir), rule.exts);
      const actual: Record<string, number> = {};
      for (const f of files) {
        const rel = toRel(f);
        if (rule.exclude.includes(rel)) continue;
        const n = rule.count(fs.readFileSync(f, 'utf8'));
        if (n > 0) actual[rel] = n;
      }
      const problems: string[] = [];
      const keys = new Set([...Object.keys(actual), ...Object.keys(rule.allow)]);
      for (const k of keys) {
        const a = actual[k] || 0;
        const allowed = rule.allow[k] || 0;
        if (a > allowed)
          problems.push(
            `[초과] ${k}: ${a}건(허용 ${allowed}) — SPEC_GUIDE.md ${rule.guide} 의 스펙을 사용할 것`,
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
