import { backend, isMobile, promptService, globalPieceService } from '.';
import { NoiseSchedule, Sampling } from '../backends/imageGen';
import {
  InpaintScene,
  PARR,
  PromptGroupNode,
  PromptNode,
  PromptPiece,
  PromptRandomNode,
  Scene,
  Session,
} from './types';

export function cleanPARR(parr: PARR): PARR {
  return parr.map((p) => p.trim());
}

/**
 * ##주석## 블록 제거.
 * - 여러 줄, 콤마 포함 가능 (non-greedy)
 * - 짝이 맞지 않는 단일 `##` 는 리터럴로 유지
 * - API 송신 직전에만 제거. 저장 데이터는 원문 유지.
 */
export function stripPromptComments(str: string): string {
  return str.replace(/##[\s\S]*?##/g, '');
}

export function toPARR(str: string) {
  return cleanPARR(
    stripPromptComments(str).replace(/\r\n?|\n/g, ',').split(','),
  ).filter((x) => x !== '');
}

/**
 * Expands inline alternatives such as `{jeans|black pants}`.
 * Braces without a top-level pipe remain untouched so NovelAI emphasis syntax
 * such as `{artist:name}` keeps its original meaning.
 */
export function expandInlineRandom(text: string): string {
  const expand = (value: string): string => {
    let result = '';
    for (let index = 0; index < value.length; index++) {
      if (value[index] !== '{') {
        result += value[index];
        continue;
      }

      let depth = 1;
      let closeIndex = -1;
      const separators: number[] = [];
      let cursor = index + 1;
      for (; cursor < value.length; cursor++) {
        const char = value[cursor];
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            closeIndex = cursor;
            break;
          }
        } else if (char === '|' && depth === 1) {
          separators.push(cursor);
        }
      }

      if (closeIndex < 0) {
        result += value.slice(index);
        break;
      }

      const inner = value.slice(index + 1, closeIndex);
      if (separators.length === 0) {
        result += `{${expand(inner)}}`;
      } else {
        const options: string[] = [];
        let optionStart = index + 1;
        for (const separator of separators) {
          options.push(value.slice(optionStart, separator));
          optionStart = separator + 1;
        }
        options.push(value.slice(optionStart, closeIndex));
        result += expand(pickRandom(options).trim());
      }
      index = closeIndex;
    }
    return result;
  };

  return expand(text);
}

/**
 * 프롬프트 문자열에 포함된 `<group.name>` 조각 참조를 전개하고 주석을 제거한
 * 최종 문자열 반환. UC(네거티브 프롬프트)처럼 toPARR/parseWord 파이프라인을
 * 직접 거치지 않는 필드에 사용.
 *
 * 조각 참조가 잘못됐거나 사이클이 있으면 예외 발생 — 긍정 프롬프트와 동일한 동작.
 */
// 중첩 조각(조각 안에서 다른 조각 참조) 안전장치.
// - 순환(A→…→A)은 경로 기반 visited 로 차단 (무한 재귀 방지)
// - 아래 두 값은 순환이 아닌 병적 케이스(깊은 사슬/조합 폭발)에 대한 보수적 상한.
//   정상 사용은 보통 몇 단계뿐이라 한참 못 미친다.
const MAX_PIECE_DEPTH = 50; // 조각 중첩 최대 깊이(사슬 길이)
const MAX_PIECE_EXPANSIONS = 10000; // 한 단어 확장에서 펼친 총 조각 수(조합 폭발 방지)

export function expandPieces(
  text: string,
  session: Session | undefined,
  scene: Scene | InpaintScene | undefined,
): string {
  if (!text) return '';
  const tokens = toPARR(text); // 내부에서 stripPromptComments 처리됨
  if (tokens.length === 0) return '';
  const node: PromptNode = {
    type: 'group',
    children: tokens.map((w) => promptService.parseWord(w, session, scene)),
  };
  return lowerPromptNode(node);
}

export class PromptService extends EventTarget {
  running: boolean;
  constructor() {
    super();
    this.running = true;
  }

  tryExpandPiece(
    p: string,
    session: Session,
    scene: InpaintScene | Scene | undefined = undefined,
  ) {
    const errorInfo =
      'project:' +
      (session?.name ?? '') +
      ', scene:' +
      (scene?.name ?? '') +
      '[' +
      (scene?.type === 'inpaint' ? 'inpaint' : '') +
      ']';
    if (p.charAt(0) === '<' && p.charAt(p.length - 1) === '>') {
      p = p.substring(1, p.length - 1);
      const parts = p.split('.');
      if (parts.length !== 2) {
        throw new Error(
          '올바르지 않은 조각 문법 "' + p + '" (' + errorInfo + ')',
        );
      }
      const localLib = session.library.get(parts[0]);
      const globalLib = globalPieceService.library.get(parts[0]);
      // 로컬 우선, 로컬에 조각이 없으면 전역 폴백
      const piece = localLib?.pieces.find((x) => x.name === parts[1])
        ?? globalLib?.pieces.find((x) => x.name === parts[1]);
      if (!localLib && !globalLib) {
        throw new Error(
          '존재하지 않는 조각 모음 "' + p + '" (' + errorInfo + ')',
        );
      }
      if (!piece) {
        throw new Error('존재하지 않는 조각 "' + p + '" (' + errorInfo + ')');
      }
      return piece.prompt;
    }
    throw new Error('조각이 아닙니다 "' + p + '" (' + errorInfo + ')');
  }

  findMissingPieces(session: Session, scene: Scene | InpaintScene): { library: string; piece: string }[] {
    const missing: { library: string; piece: string }[] = [];
    const seen = new Set<string>();
    const pieceRegex = /<([^<>]+\.[^<>]+)>/g;

    // 씬의 모든 슬롯 프롬프트에서 <lib.piece> 패턴 수집
    const prompts: string[] = [];
    if (scene.type === 'scene') {
      for (const slot of (scene as Scene).slots) {
        for (const piece of slot) {
          if (piece.prompt) prompts.push(piece.prompt);
        }
      }
    }
    if ('preset' in scene && scene.preset?.prompt) {
      prompts.push(scene.preset.prompt);
    }

    for (const text of prompts) {
      let match;
      while ((match = pieceRegex.exec(text)) !== null) {
        const inner = match[1];
        const parts = inner.split('.');
        if (parts.length !== 2) continue;
        const key = parts[0] + '.' + parts[1];
        if (seen.has(key)) continue;
        seen.add(key);

        const localLib = session.library.get(parts[0]);
        const globalLib = globalPieceService.library.get(parts[0]);
        const piece = localLib?.pieces.find((x) => x.name === parts[1])
          ?? globalLib?.pieces.find((x) => x.name === parts[1]);
        if (!localLib && !globalLib) {
          missing.push({ library: parts[0], piece: parts[1] });
        } else if (!piece) {
          missing.push({ library: parts[0], piece: parts[1] });
        }
      }
    }
    return missing;
  }

  isGlobal(p: string, session: Session): boolean {
    if (p.charAt(0) !== '<' || p.charAt(p.length - 1) !== '>') {
      return false;
    }
    const inner = p.substring(1, p.length - 1);
    const parts = inner.split('.');
    if (parts.length !== 2) return false;
    const localLib = session.library.get(parts[0]);
    // 로컬 라이브러리에 해당 조각이 있으면 로컬 → global 아님
    if (localLib?.pieces.find((x) => x.name === parts[1])) return false;
    // 전역에 해당 조각이 있으면 global
    const globalLib = globalPieceService.library.get(parts[0]);
    return !!globalLib?.pieces.find((x) => x.name === parts[1]);
  }

  isMulti(p: string, session: Session) {
    if (p.charAt(0) !== '<' || p.charAt(p.length - 1) !== '>') {
      return false;
    }
    p = p.substring(1, p.length - 1);
    const parts = p.split('.');
    if (parts.length !== 2) {
      return false;
    }
    const localLib = session.library.get(parts[0]);
    const globalLib = globalPieceService.library.get(parts[0]);
    const piece = localLib?.pieces.find((x) => x.name === parts[1])
      ?? globalLib?.pieces.find((x) => x.name === parts[1]);
    return piece?.multi ?? false;
  }

  parseWord(
    word: string,
    session: Session | undefined = undefined,
    scene: InpaintScene | Scene | undefined = undefined,
    visited: { [key: string]: boolean } | undefined = undefined,
    depth: number = 0,
    counter: { count: number } | undefined = undefined,
  ): PromptNode {
    if (!visited) {
      visited = {};
    }
    if (!counter) {
      counter = { count: 0 };
    }
    if (word.charAt(0) === '<' && word.charAt(word.length - 1) === '>') {
      if (!session) {
        throw new Error('그림체에서는 조각을 사용할 수 없습니다');
      }
      const res: PromptGroupNode = {
        type: 'group',
        children: [],
      };
      // 순환 차단: 현재 확장 경로(조상)에 이미 있는 조각이면 무한 재귀 → 차단.
      // visited 는 진입 시 표시하고 종료 시 해제(백트래킹)하므로, 순환이 아닌
      // 형제/재사용 위치에서 같은 조각을 다시 쓰는 것은 허용된다.
      if (visited[word]) {
        throw new Error('순환 조각 참조 감지: ' + word);
      }
      // 보수적 상한: 깊은 사슬 / 조합 폭발로부터 보호
      if (depth >= MAX_PIECE_DEPTH) {
        throw new Error(
          `조각 중첩이 너무 깊습니다 (최대 ${MAX_PIECE_DEPTH}단계): ${word}`,
        );
      }
      if (++counter.count > MAX_PIECE_EXPANSIONS) {
        throw new Error(
          `조각 확장이 너무 많습니다 (순환·과도한 중첩 의심): ${word}`,
        );
      }
      visited[word] = true;
      try {
        if (this.isMulti(word, session)) {
          const expanded = this.tryExpandPiece(word, session, scene);
          const lines = expanded.split(/\r\n?|\n/);
          const randNode: PromptRandomNode = {
            type: 'random',
            options: [],
          };
          for (const line of lines) {
            const parr = toPARR(line);
            const newNode: PromptGroupNode = {
              type: 'group',
              children: [],
            };
            for (const p of parr) {
              newNode.children.push(
                this.parseWord(p, session, scene, visited, depth + 1, counter),
              );
            }
            randNode.options.push(newNode);
          }
          res.children.push(randNode);
        } else {
          let newp = toPARR(this.tryExpandPiece(word, session, scene));
          for (const p of newp) {
            res.children.push(
              this.parseWord(p, session, scene, visited, depth + 1, counter),
            );
          }
        }
      } finally {
        // 백트래킹: 이 조각을 떠나면 경로에서 제거해 재사용을 허용
        delete visited[word];
      }
      return res;
    } else {
      return {
        type: 'text',
        text: word,
      };
    }
  }

  showPromptTooltip(piece: string, e: any) {
    try {
      let txt = '';
      if (piece !== '|') {
        const expanded = this.tryExpandPiece(piece, window.curSession!);
        if (this.isMulti(piece, window.curSession!)) {
          txt =
            '이 중 한 줄 랜덤 선택:\n' +
            expanded.split(/\r\n?|\n/).slice(0, 32).join('\n');
        } else {
          txt = expanded;
        }
      } else {
        txt =
          '프롬프트를 교차합니다.\n예시:\n상위 프롬프트: 1girl, |, 캐릭터 \n중위 프롬프트: 그림체, |, 포즈\n이렇게 세팅되어 있으면 1girl, 캐릭터, 그림체, 포즈 순으로 교차됩니다.';
      }
      this.dispatchEvent(
        new CustomEvent('prompt-tooltip', {
          detail: { text: txt, x: e.clientX, y: e.clientY },
        }),
      );
    } catch (e: any) {
      console.error(e);
    }
  }

  clearPromptTooltip() {
    this.dispatchEvent(
      new CustomEvent('prompt-tooltip', { detail: { text: '' } }),
    );
  }
}

/**
 * Generic DFS traversal for prompt combinations
 * @param session Current session
 * @param scene Current scene
 * @param collectFn Function to collect data from each slot piece
 * @param processFn Function to process completed combinations
 * @returns Result from the processFn
 */
async function dfsPrompts<T, R>(
  session: Session,
  scene: Scene,
  collectFn: (piece: PromptPiece | null) => T,
  processFn: (combinations: T[]) => Promise<R>,
): Promise<R[]> {
  const combinations: T[] = [];
  const results: R[] = [];

  const traverse = async () => {
    if (combinations.length === scene.slots.length) {
      results.push(await processFn([...combinations]));
      return;
    }

    const level = combinations.length;
    let hasEnabled = false;

    for (const piece of scene.slots[level]) {
      if (piece.enabled === undefined || piece.enabled) {
        hasEnabled = true;
        combinations.push(collectFn(piece));
        await traverse();
        combinations.pop();
      }
    }

    // If specified by returning null/undefined from collectFn, handle empty slots
    if (!hasEnabled && collectFn(null) !== undefined) {
      combinations.push(collectFn(null));
      await traverse();
      combinations.pop();
    }
  };

  await traverse();
  return results;
}

// 조합 미리보기용 세그먼트 — 어느 열에서 온 어떤 조각인지.
export interface CombinationSegment {
  columnIndex: number;
  piece: PromptPiece;
}
export type Combination = CombinationSegment[];

/**
 * 조합 에디터 미리보기용 조합 열거.
 *
 * 생성 경로(createSDPrompts → dfsPrompts, collectFn = piece?.prompt)와 **동일 규칙**으로
 * 각 열에서 활성 조각 하나씩 고르는 데카르트 곱을 만든다:
 *  - enabled === false 인 조각은 제외.
 *  - 어떤 열에 활성 조각이 0개면 그 열에서 고를 게 없으므로 전체 조합 0종(dfsPrompts 의
 *    collectFn(null)===undefined 로 빈 열 분기를 타지 않는 동작과 일치).
 *  - 세그먼트 순서 = 열 순서(0..N-1). 최종 중간 프롬프트 = 세그먼트 prompt 를 빈 것 제외 ', ' join.
 *
 * 순수 함수(관찰만, 부작용 없음). 생성 경로를 건드리지 않고 파리티는 단위 테스트로 고정한다.
 */
export function enumerateCombinations(scene: Scene, limit?: number): Combination[] {
  const results: Combination[] = [];
  const current: CombinationSegment[] = [];
  const traverse = (level: number) => {
    if (limit !== undefined && results.length >= limit) return;
    if (level === scene.slots.length) {
      results.push([...current]);
      return;
    }
    for (const piece of scene.slots[level]) {
      if (limit !== undefined && results.length >= limit) return;
      if (piece.enabled === undefined || piece.enabled) {
        current.push({ columnIndex: level, piece });
        traverse(level + 1);
        current.pop();
      }
    }
    // 활성 조각이 없는 열이면 아무 것도 push 하지 않음 → 하위 미완성 → 이 갈래는 0종.
  };
  traverse(0);
  return results;
}

/**
 * 조합 총 개수만 저비용으로 계산(전체 열거 없이 ∏ 활성 수). 대량 조합에서 미리보기가
 * 수백만 항목을 만들지 않도록 개수 표시·상한 판정에 사용. enumerateCombinations 와 동일 규칙.
 */
export function combinationCount(scene: Scene): number {
  if (scene.slots.length === 0) return 1;
  let total = 1;
  for (const slot of scene.slots) {
    const enabled = slot.filter(
      (p) => p.enabled === undefined || p.enabled,
    ).length;
    total *= enabled;
    if (total === 0) return 0; // 활성 0인 열이 있으면 전체 0종.
  }
  return total;
}

/** 한 조합의 최종 중간 프롬프트(생성 시 만들어지는 조합 프롬프트와 동일한 문자열). */
export function combinationMiddlePrompt(combo: Combination): string {
  return combo
    .map((seg) => seg.piece.prompt)
    .filter((p) => p && p.trim() !== '')
    .join(', ');
}

export const createSDPrompts = async (
  session: Session,
  preset: any,
  shared: any,
  scene: Scene,
) => {
  return await dfsPrompts(
    session,
    scene,
    (piece) => piece?.prompt,
    async (promptComb) => {
      let front = toPARR(preset.frontPrompt);
      if (shared.type === 'SDImageGenEasy') {
        front = front.concat(toPARR(shared.characterPrompt));
        const newFront = [];
        const rest = [];
        const regex = /^\d+(boy|girl|other)s?$/;
        for (const word of front) {
          if (
            regex.test(word) ||
            word === 'multiple girls' ||
            word === 'multiple boys' ||
            word === 'multiple others'
          ) {
            newFront.push(word);
          } else {
            const tag = await backend.lookupTag(word);
            if (tag && tag.category === 4) {
              newFront.push(word);
            } else {
              rest.push(word);
            }
          }
        }
        front = newFront.concat(rest);
      }

      // 추가 프롬프트 (2026-07-18): 상위(및 이지 모드 캐릭터 태그 재배열) 뒤,
      // 중위(씬 전용) 앞에 삽입 — 조합 순서 = 상위→추가→중위→하위.
      // 세션(프로젝트) 귀속 필드로 프리셋 구조에는 저장되지 않는다.
      front = front.concat(toPARR(session.extraPrompt || ''));

      let middle: string[] = [];
      for (const comb of promptComb) {
        middle = middle.concat(toPARR(comb ?? ''));
      }

      let left = 0,
        right = 0;
      let cur: string[] = [];
      let currentInsert = 0;

      while (left < front.length && right < middle.length) {
        if (currentInsert === 0) {
          if (front[left] === '|') {
            currentInsert = 1;
            left++;
            continue;
          }
          cur.push(front[left]);
          left++;
        } else {
          if (middle[right] === '|') {
            currentInsert = 0;
            right++;
            continue;
          }
          cur.push(middle[right]);
          right++;
        }
      }
      while (left < front.length) {
        if (front[left] !== '|') cur.push(front[left]);
        left++;
      }
      while (right < middle.length) {
        if (middle[right] !== '|') cur.push(middle[right]);
        right++;
      }

      if (shared.type === 'SDImageGenEasy') {
        cur = cur.concat(toPARR(shared.backgroundPrompt));
      }
      cur = cur.concat(toPARR(preset.backPrompt));

      const newNode: PromptNode = {
        type: 'group',
        children: [],
      };
      for (const word of cur) {
        newNode.children.push(promptService.parseWord(word, session, scene));
      }
      return newNode;
    },
  );
};

export const createSDCharacterPrompts = async (
  session: Session,
  preset: any,
  shared: any,
  scene: Scene,
) => {
  // 씬 전용 캐릭터 프롬프트가 활성화된 경우 씬 전용 + shared 병합
  const useSceneCP = scene.useSceneCharacterPrompts &&
    scene.sceneCharacterPrompts &&
    scene.sceneCharacterPrompts.length > 0;
  const sharedCPs = shared.characterPrompts || [];
  const characterPrompts = useSceneCP
    ? [...(scene.sceneCharacterPrompts || []), ...sharedCPs]
    : [...(preset.characterPrompts || []), ...sharedCPs];
  if (!characterPrompts || characterPrompts.length === 0) return [];

  return await dfsPrompts(
    session,
    scene,
    (piece) => piece?.characterPrompts || [],
    async (promptComb) => {
      const characterPromptsResult: PromptNode[] = [];

      for (let i = 0; i < characterPrompts.length; i++) {
        const characterPrompt = characterPrompts[i];
        const front = toPARR(characterPrompt.prompt);

        // Collect all character prompts from the selected pieces
        let middle: string[] = [];
        for (const comb of promptComb) {
          middle = middle.concat(toPARR(comb[i] ?? ''));
        }

        // Merge prompts with | separator
        let left = 0,
          right = 0;
        let cur: string[] = [];
        let currentInsert = 0;

        while (left < front.length && right < middle.length) {
          if (currentInsert === 0) {
            if (front[left] === '|') {
              currentInsert = 1;
              left++;
              continue;
            }
            cur.push(front[left]);
            left++;
          } else {
            if (middle[right] === '|') {
              currentInsert = 0;
              right++;
              continue;
            }
            cur.push(middle[right]);
            right++;
          }
        }
        while (left < front.length) {
          if (front[left] !== '|') cur.push(front[left]);
          left++;
        }
        while (right < middle.length) {
          if (middle[right] !== '|') cur.push(middle[right]);
          right++;
        }

        const newNode: PromptNode = {
          type: 'group',
          children: [],
        };
        for (const word of cur) {
          newNode.children.push(promptService.parseWord(word, session, scene));
        }
        characterPromptsResult.push(newNode);
      }
      return characterPromptsResult;
    },
  );
};

const mouth = ['<', '>', '(', ')', '{', '}', ')', '('];
const eyes = [':', ';'];
const expressions = mouth.map((m) => eyes.map((e) => e + m)).flat();
expressions.push('><');

function trimUntouch(word: string) {
  let leftTrimPos = 0;
  while (leftTrimPos < word.length && isWhitespace(word[leftTrimPos])) {
    leftTrimPos++;
  }
  let rightTrimPos = word.length - 1;
  while (rightTrimPos >= 0 && isWhitespace(word[rightTrimPos])) {
    rightTrimPos--;
  }
  if (leftTrimPos > rightTrimPos) {
    return undefined;
  }
  return [leftTrimPos, rightTrimPos];
}

function parenCheck(str: string): [boolean, number] {
  str = str
    .split(',')
    .map((x) => {
      const trimmed = trimUntouch(x);
      if (trimmed) {
        const [leftTirmPos, rightTrimPos] = trimmed;
        const y = x.substring(leftTirmPos, rightTrimPos + 1);
        for (const exp of expressions) {
          if (y === exp) {
            return (
              x.substring(0, leftTirmPos) +
              'xx' +
              x.substring(rightTrimPos + 1, x.length)
            );
          }
        }
        return x;
      } else {
        return x;
      }
    })
    .join(',');
  const stack = [];
  const parens = ['(', ')', '[', ']', '{', '}', '<', '>'];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (parens.includes(c)) {
      if (parens.indexOf(c) % 2 === 0) {
        stack.push([c, i]);
      } else {
        if (stack.length === 0) {
          return [false, i];
        }
        const last = stack.pop()!;
        if (parens.indexOf(c) - 1 !== parens.indexOf(last[0] as string)) {
          return [false, last[1] as number];
        }
      }
    }
  }
  if (stack.length > 0) {
    return [false, stack.pop()![1] as number];
  }
  return [true, -1];
}

const nbsp = String.fromCharCode(160);
const isWhitespace = (c: string) => {
  return c === ' ' || nbsp === c;
};

export const highlightPrompt = (
  session: Session,
  text: string,
  lineHighlight: boolean = false,
) => {
  // 주석 범위 수집 (원본 text 기준 절대 오프셋)
  const commentRanges: Array<[number, number]> = [];
  const commentRegex = /##[\s\S]*?##/g;
  let commentMatch: RegExpExecArray | null;
  while ((commentMatch = commentRegex.exec(text)) !== null) {
    commentRanges.push([
      commentMatch.index,
      commentMatch.index + commentMatch[0].length,
    ]);
  }
  const overlapsComment = (wordStart: number, wordEnd: number): boolean =>
    commentRanges.some(([s, e]) => s < wordEnd && e > wordStart);

  // ── 가중치 하이라이트용: 각 문자 위치의 bracket depth 계산 ──
  // {}: +1 depth, []: -1 depth per pair
  const weightDepth = new Int8Array(text.length); // 양수=강조, 음수=약화
  {
    let curly = 0;  // {} depth
    let square = 0; // [] depth
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '{') curly++;
      else if (c === '}') curly = Math.max(0, curly - 1);
      else if (c === '[') square++;
      else if (c === ']') square = Math.max(0, square - 1);
      weightDepth[i] = curly - square;
    }
  }
  // (number)::tag:: 패턴의 범위와 가중치
  const explicitWeightRanges: Array<{ start: number; end: number; weight: number }> = [];
  const ewRegex = /(-?\d+(?:\.\d+)?)::[\s\S]*?::/g;
  let ewMatch: RegExpExecArray | null;
  while ((ewMatch = ewRegex.exec(text)) !== null) {
    explicitWeightRanges.push({
      start: ewMatch.index,
      end: ewMatch.index + ewMatch[0].length,
      weight: parseFloat(ewMatch[1]),
    });
  }
  /** 해당 offset 범위의 가중치 상태 반환: 'emphasis' | 'deemphasis' | 'negative' | null */
  const getWeightClass = (wordStart: number, wordEnd: number): string | null => {
    // 주석 영역 내부면 가중치 무시
    if (overlapsComment(wordStart, wordEnd)) return null;
    // (number)::tag:: 명시적 가중치 우선 (overlap 판정 — 앞뒤 공백 포함 가능)
    for (const ew of explicitWeightRanges) {
      if (ew.start < wordEnd && ew.end > wordStart) {
        if (ew.weight < 0) return 'syntax-weight-negative';
        if (ew.weight < 1) return 'syntax-weight-deemphasis';
        if (ew.weight > 1) return 'syntax-weight-emphasis';
        return null; // weight === 1
      }
    }
    // bracket depth 기반 (단어 첫 비공백 문자 위치)
    let samplePos = wordStart;
    for (let i = wordStart; i < wordEnd; i++) {
      const c = text[i];
      if (c !== ' ' && c !== '{' && c !== '}' && c !== '[' && c !== ']') {
        samplePos = i;
        break;
      }
    }
    if (samplePos < text.length) {
      const depth = weightDepth[samplePos];
      if (depth > 0) return 'syntax-weight-emphasis';
      if (depth < 0) return 'syntax-weight-deemphasis';
    }
    return null;
  };

  // 괄호 검사는 주석 영역을 공백으로 대체한 텍스트에서 수행
  // (주석 내부 괄호가 오류로 집계되지 않도록)
  const parenCheckText = commentRanges.length === 0
    ? text
    : text.split('').map((c, i) =>
        commentRanges.some(([s, e]) => i >= s && i < e) ? ' ' : c,
      ).join('');
  let [parenFine, lastPos] = parenCheck(parenCheckText);
  let offset = 0;
  const words = text
    .split('\n')
    .map((x) => {
      const word = x
        .split(/([,])/)
        .map((word: string, index) => {
          if (word === '\n') {
            return word;
          }
          if (word === ',') {
            // 콤마가 주석 영역 내부면 주석 스타일
            const isInComment = overlapsComment(offset, offset + 1);
            offset += 0; // 기존 로직과 맞춤 (콤마는 offset 증가 안 함 — 다음 단어의 +1에 포함)
            if (isInComment) {
              return '<span class="syntax-comment">,</span>';
            }
            // 콤마가 가중치 영역 내부면 가중치 배경 적용
            const commaWeight = getWeightClass(offset, offset + 1);
            if (commaWeight) {
              return `<span class="${commaWeight}">,</span>`;
            }
            return word;
          }
          // 단어가 주석 영역과 겹치면 주석 부분만 정확히 주석 스타일 적용
          const wordStart = offset;
          const wordEnd = offset + word.length;
          if (overlapsComment(wordStart, wordEnd)) {
            let result = '';
            let i = 0;
            while (i < word.length) {
              const absPos = wordStart + i;
              const inComment = commentRanges.some(([s, e]) => absPos >= s && absPos < e);
              let j = i + 1;
              while (j < word.length) {
                const nextInComment = commentRanges.some(([s, e]) => (wordStart + j) >= s && (wordStart + j) < e);
                if (nextInComment !== inComment) break;
                j++;
              }
              const segment = word.slice(i, j)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
              if (inComment) {
                result += `<span class="syntax-comment">${segment}</span>`;
              } else {
                result += segment;
              }
              i = j;
            }
            offset += word.length + 1;
            return result;
          }
          const classNames = [];
          let leftTrimPos = 0;
          while (leftTrimPos < word.length && isWhitespace(word[leftTrimPos])) {
            leftTrimPos++;
          }
          let rightTrimPos = word.length - 1;
          while (rightTrimPos >= 0 && isWhitespace(word[rightTrimPos])) {
            rightTrimPos--;
          }
          if (leftTrimPos > rightTrimPos) {
            let res = ``;
            res += ' '.repeat(word.length) + '';
            offset += word.length + 1;
            return res;
          }
          if (
            !parenFine &&
            offset <= lastPos &&
            lastPos < offset + word.length
          ) {
            const originalWordLength = word.length;
            const left = word
              .substring(0, lastPos - offset)
              .replace('<', '&lt;')
              .replace('>', '&gt');
            const mid = word[lastPos - offset]
              .replace('<', '&lt;')
              .replace('>', '&gt');
            const right = word
              .substring(lastPos - offset + 1, word.length)
              .replace('<', '&lt;')
              .replace('>', '&gt');
            word = `${left}<span class="syntax-error">${mid}</span>${right}`;
            let res = `<span class="syntax-word">`;
            res += word + '</span>';
            offset += originalWordLength + 1;
            return res;
          }
          let js = '';
          let pword = word.substring(leftTrimPos, rightTrimPos + 1);
          if (pword === '|') {
            classNames.push('syntax-split');
            if (!isMobile)
              js =
                'onmousemove="window.promptService.showPromptTooltip(\'' +
                pword +
                '\', event)" onmouseout="window.promptService.clearPromptTooltip()"';
          }
          // 가중치 하이라이트 (배경색만, 폰트 변경 없음)
          const wClass = getWeightClass(wordStart + leftTrimPos, wordStart + rightTrimPos + 1);
          if (wClass) {
            classNames.push(wClass);
          }
          if (pword.startsWith('[') && pword.endsWith(']')) {
            classNames.push('syntax-weak');
          }
          if (pword.startsWith('{') && pword.endsWith('}')) {
            classNames.push('syntax-strong');
          }

          if (pword.startsWith('<') && pword.endsWith('>')) {
            try {
              promptService.tryExpandPiece(pword, session);
              const isGlobal = promptService.isGlobal(pword, session);
              if (promptService.isMulti(pword, session))
                classNames.push(isGlobal ? 'syntax-global-multi-wildcard' : 'syntax-multi-wildcard');
              else
                classNames.push(isGlobal ? 'syntax-global-wildcard' : 'syntax-wildcard');

              js =
                'onmousemove="window.promptService.showPromptTooltip(\'' +
                pword +
                '\', event)" onmouseout="window.promptService.clearPromptTooltip()"';
            } catch (e: any) {
              classNames.push('syntax-error');
            }
          }
          pword = pword.replace('<', '&lt;').replace('>', '&gt');
          const leading = word.substring(0, leftTrimPos);
          const trailing = word.substring(rightTrimPos + 1, word.length);
          // 가중치 범위 내 공백은 하이라이트에 포함 (연속된 시각 피드백)
          const leadingInWeight = wClass && leftTrimPos > 0 && getWeightClass(wordStart, wordStart + leftTrimPos) !== null;
          let res: string;
          if (classNames.length === 0) {
            res = `${leading}${pword}${trailing}`;
          } else if (leadingInWeight) {
            res = `<span ${js} class="${classNames.join(' ')}">${leading}${pword}</span>${trailing}`;
          } else {
            res = `${leading}<span ${js} class="${classNames.join(' ')}">${pword}</span>${trailing}`;
          }
          offset += word.length + 1;
          return res;
        })
        .join('');
      return '<span class="syntax-line">' + word + '</span>';
    })
    .join('\n');
  return `${words}`;
};

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function reformat(text: string) {
  return toPARR(text).join(', ');
}

export function lowerPromptNode(node: PromptNode): string {
  if (node.type === 'text') {
    return expandInlineRandom(node.text);
  }
  if (node.type === 'random') {
    return lowerPromptNode(pickRandom(node.options));
  }
  return reformat(node.children.map(lowerPromptNode).join(','));
}

export const defaultFPrompt = `1girl, {artist:ixy}`;
export const defaultBPrompt = `{best quality, amazing quality, very aesthetic, highres, incredibly absurdres}`;
export const defaultUC = `worst quality, bad quality, displeasing, very displeasing, lowres, bad anatomy, bad perspective, bad proportions, bad aspect ratio, bad face, long face, bad teeth, bad neck, long neck, bad arm, bad hands, bad ass, bad leg, bad feet, bad reflection, bad shadow, bad link, bad source, wrong hand, wrong feet, missing limb, missing eye, missing tooth, missing ear, missing finger, extra faces, extra eyes, extra eyebrows, extra mouth, extra tongue, extra teeth, extra ears, extra breasts, extra arms, extra hands, extra legs, extra digits, fewer digits, cropped head, cropped torso, cropped shoulders, cropped arms, cropped legs, mutation, deformed, disfigured, unfinished, chromatic aberration, text, error, jpeg artifacts, watermark, scan, scan artifacts`;
