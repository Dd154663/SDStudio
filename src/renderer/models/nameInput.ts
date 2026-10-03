// 이름 입력 규칙 — 단일 출처(2026-10-03 D2, SPEC_GUIDE §5 「이름 입력 규칙」, jest nameInput.test.ts).
//
// - 이름을 묻는 확인 창은 promptName 하나로 띄운다(type: 'input-confirm' 직접 호출 금지 — specGuard).
//   검증은 창 안에서 한다: 실패면 창을 닫지 않고 입력칸 아래에 오류를 보이며 입력을 보존한다(ConfirmWindow validate).
// - 규칙(validateName): 앞뒤 공백 제거 → 빈 값 거부 → 이름 변경에서 현재 이름과 같으면 통과(변경 없음) →
//   길이 상한(기존 규칙이 있는 곳만) → 경로 안전(pathSafe: 파일·폴더 이름으로 쓰이는 프로젝트·씬·폴더·템플릿) →
//   중복 거부. 문구는 이 파일 한 곳.
// - 이름 변경 로직(서비스 호출·관문)은 옮기지 않는다 — 여기는 묻기와 검증만.
// - 서비스가 던지는 영문 오류('Resource already exists' 등)는 nameErrorMessage 로 한국어로 바꿔 보인다.
import { getAppState } from './appStateRef';

/** 이름 종류 라벨 — 문구의 {종류} 자리. */
export const NAME_KIND_LABEL = {
  project: '프로젝트',
  folder: '폴더',
  scene: '씬',
  piece: '조각',
  pieceGroup: '조각그룹',
  style: '그림체',
  preset: '사전 세팅',
  globalPreset: '글로벌 프리셋',
  characterPreset: '캐릭터 프리셋',
  artist: '작가',
  template: '템플릿',
  sceneTemplate: '씬 템플릿',
  themePreset: '테마 프리셋',
  exportPreset: '내보내기 프리셋',
  token: '토큰',
} as const;

export type NameKind = keyof typeof NAME_KIND_LABEL;

/** 받침 유무로 이/가 고르기. 한글 음절이 아니면 「이(가)」. */
export function josaIGa(word: string): string {
  const last = word.trim().slice(-1);
  if (!last) return '이(가)';
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code >= 11172) return '이(가)';
  return code % 28 === 0 ? '가' : '이';
}

export const NAME_INPUT_TEXT = {
  empty: '이름을 입력해 주세요.',
  tooLong: (max: number) => `이름은 ${max}자 이하로 입력해 주세요.`,
  dotStart: '이름은 .으로 시작할 수 없습니다.',
  badChars: (chars: string) => `이름에 쓸 수 없는 글자가 있습니다: ${chars}`,
  emptySegment: '폴더 경로에 빈 단계가 있습니다(/ 앞뒤를 확인해 주세요).',
  reserved: (name: string) => `"${name}"은(는) 시스템 예약 이름이라 쓸 수 없습니다.`,
  duplicate: (kind: NameKind, name?: string, where?: string) => {
    const label = NAME_KIND_LABEL[kind];
    const head = `같은 이름의 ${label}${josaIGa(label)} 이미 있습니다`;
    if (!name) return head + '.';
    return `${head}: ${name}${where ? ` (${where})` : ''}`;
  },
  repeated: (name: string) => `같은 이름을 두 번 입력했습니다: ${name}`,
  line: (n: number, message: string) => `${n}번째 줄 — ${message}`,
  notFound: '대상을 찾을 수 없습니다.',
} as const;

// 파일·폴더 이름에 쓸 수 없는 글자(Windows 기준, 경로 구분자 포함 — storageLayout 의 금지 문자와 같음).
// 제어 문자는 charCode 로 거른다(소스에 리터럴 제어 문자를 두지 않는다).
const FORBIDDEN_NAME_CHARS = '<>:"/\\|?*';
// Windows 예약 장치 이름(확장자가 붙어도 예약)
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export interface NameRules {
  kind: NameKind;
  /** 이미 있는 이름 — 목록이나 판정 함수(대소문자 무시 등 서비스 규칙이 다르면 함수로). */
  existing?: readonly string[] | ((name: string) => boolean);
  /** 이름 변경의 현재 이름 — 같으면 「변경 없음」으로 통과(promptName 은 undefined 를 돌려준다). */
  current?: string;
  /** 파일·폴더 이름으로 쓰이는 이름(프로젝트·씬·폴더·템플릿·씬 템플릿) — 금지 글자·점 시작·예약 이름 거부. */
  pathSafe?: boolean;
  /** pathSafe 폴더 경로 입력(「상위/하위」) — '/' 로 나눈 단계마다 검사한다. */
  allowSlash?: boolean;
  /** 길이 상한 — 기존 규칙이 있는 곳만(토큰 40자). */
  maxLength?: number;
  /** 빈 값 허용(선택 입력) — 빈 값이면 검증 없이 통과, promptName 은 '' 를 돌려준다. */
  allowEmpty?: boolean;
  /** 중복일 때 덧붙일 위치 설명(예: 「"폴더" 폴더에 있음」). */
  where?: (name: string) => string | undefined;
}

function isTaken(existing: NameRules['existing'], name: string): boolean {
  if (!existing) return false;
  return typeof existing === 'function' ? existing(name) : existing.includes(name);
}

/** 경로 안전 검사 — 한 단계(세그먼트) 기준. 문제가 없으면 null. */
function pathSegmentProblem(seg: string): string | null {
  if (seg.startsWith('.')) return NAME_INPUT_TEXT.dotStart;
  const bad: string[] = [];
  let control = false;
  for (const ch of seg) {
    if (ch.charCodeAt(0) < 32) control = true;
    else if (FORBIDDEN_NAME_CHARS.includes(ch) && !bad.includes(ch)) bad.push(ch);
  }
  if (bad.length > 0 || control) {
    return NAME_INPUT_TEXT.badChars([...bad, ...(control ? ['제어 문자'] : [])].join(' '));
  }
  if (RESERVED_NAME.test(seg)) return NAME_INPUT_TEXT.reserved(seg);
  return null;
}

/**
 * 이름 검증 — 오류 문구 또는 null(통과). 앞뒤 공백은 잘라서 판단한다.
 * current 와 같으면(이름 변경에서 바꾸지 않음) null — 「변경 없음」 처리는 호출부(promptName)가 한다.
 */
export function validateName(value: string, rules: NameRules): string | null {
  const name = (value ?? '').trim();
  if (!name) return rules.allowEmpty ? null : NAME_INPUT_TEXT.empty;
  if (rules.current !== undefined && name === rules.current) return null;
  if (rules.maxLength !== undefined && name.length > rules.maxLength) {
    return NAME_INPUT_TEXT.tooLong(rules.maxLength);
  }
  if (rules.pathSafe) {
    if (rules.allowSlash) {
      const segments = name.split('/');
      if (segments.some((s) => !s.trim())) return NAME_INPUT_TEXT.emptySegment;
      for (const seg of segments) {
        const problem = pathSegmentProblem(seg.trim());
        if (problem) return problem;
      }
    } else {
      const problem = pathSegmentProblem(name);
      if (problem) return problem;
    }
  }
  if (isTaken(rules.existing, name)) {
    return NAME_INPUT_TEXT.duplicate(rules.kind, name, rules.where?.(name));
  }
  return null;
}

/**
 * 여러 줄 이름 입력(새 씬 여러 개 등) 검증 — 빈 줄은 건너뛰고 줄마다 validateName, 입력 안의 중복도 거부.
 * 오류면 「N번째 줄 — 사유」, 이름이 하나도 없으면 빈 값 문구.
 */
export function validateNameLines(value: string, rules: NameRules): string | null {
  const lines = (value ?? '').split('\n');
  const seen = new Set<string>();
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i].trim();
    if (!name) continue;
    count++;
    const problem = validateName(name, { ...rules, current: undefined, allowEmpty: false });
    if (problem) return lines.length > 1 ? NAME_INPUT_TEXT.line(i + 1, problem) : problem;
    if (seen.has(name)) return NAME_INPUT_TEXT.repeated(name);
    seen.add(name);
  }
  return count === 0 ? NAME_INPUT_TEXT.empty : null;
}

/** 여러 줄 입력을 이름 목록으로(앞뒤 공백 제거·빈 줄 제외). */
export function splitNameLines(value: string): string[] {
  return (value ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 서비스 오류를 이름 입력 안내 문구로 — 영문 내부 오류는 한국어로, 그 밖은 원래 문구(없으면 fallback).
 */
export function nameErrorMessage(
  e: unknown,
  kind: NameKind,
  name?: string,
  fallback = '처리하지 못했습니다.',
): string {
  const msg =
    typeof e === 'string' ? e : e && typeof (e as any).message === 'string' ? (e as any).message : '';
  if (msg === 'Resource already exists') return NAME_INPUT_TEXT.duplicate(kind, name);
  if (msg === 'Resource not found') return NAME_INPUT_TEXT.notFound;
  return msg || fallback;
}

/** 복제 제안값 — 「이름 복사본」, 겹치면 「이름 복사본 (2)」·(3)… 중 빈 첫 이름. */
export function suggestFolderCopyName(base: string, taken: (name: string) => boolean): string {
  const first = `${base} 복사본`;
  if (!taken(first)) return first;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${first} (${i})`;
    if (!taken(candidate)) return candidate;
  }
  return first;
}

/** 프로젝트 이름 규칙 —경로 안전 + 활성 프로젝트 이름 중복(어느 폴더에 있는지 함께). */
export function projectNameRules(svc: {
  list(): string[];
  getFolderOf(name: string): string | null | undefined;
}): Pick<NameRules, 'kind' | 'pathSafe' | 'existing' | 'where'> {
  return {
    kind: 'project',
    pathSafe: true,
    existing: (n) => svc.list().includes(n),
    where: (n) => {
      const folder = svc.getFolderOf(n);
      return folder ? `"${folder}" 폴더에 있음` : undefined;
    },
  };
}

export interface PromptNameOptions extends NameRules {
  /** 창 문구 */
  title: string;
  /** 처음 채울 값(제안값) — 없으면 current */
  initial?: string;
  /** 공통 규칙 뒤에 더 볼 검사(통과한 trim 값으로 호출) */
  validate?: (name: string) => string | null | Promise<string | null>;
}

/**
 * 이름 입력 창 — 확인하면 trim 한 이름, 취소·Esc·뒤로 가기·변경 없음(current 와 같음)은 undefined.
 * allowEmpty 면 빈 값은 ''.
 */
export async function promptName(opts: PromptNameOptions): Promise<string | undefined> {
  const value = await getAppState().pushDialogAsync({
    type: 'input-confirm',
    text: opts.title,
    inputValue: opts.initial ?? opts.current,
    validate: async (raw: string) => {
      const problem = validateName(raw, opts);
      if (problem) return problem;
      const name = (raw ?? '').trim();
      if (!name) return null; // allowEmpty
      if (opts.current !== undefined && name === opts.current) return null;
      return opts.validate ? await opts.validate(name) : null;
    },
  });
  if (value === undefined) return undefined;
  const name = value.trim();
  if (opts.current !== undefined && name === opts.current) return undefined;
  if (!name) return opts.allowEmpty ? '' : undefined;
  return name;
}
