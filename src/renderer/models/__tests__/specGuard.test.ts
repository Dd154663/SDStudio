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
      'models/TrashService.ts': 5,
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
