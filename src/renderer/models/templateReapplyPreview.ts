// 템플릿 재적용 확인 창의 「무엇이 교체되는가」 판단과 문구(2026-11-18 프리셋 유실 조사 경로 10·11). 순수 모듈 — jest
// undoTemplateReapply.test.ts.
//
// 재적용 규칙(SessionService.applyProjectTemplateToSession · ProjectTemplateService.removeRecordedInstances)을 그대로 읽는다:
//  · 템플릿에 내용이 있는 영역만 「적용 기록에 적힌 **이름**의 항목을 지우고 템플릿 내용으로 다시 만든다」 — 그 이름의 프리셋이면
//    사용자가 고쳤거나 같은 이름으로 직접 만든 것도 교체된다. 비어 있는 영역은 건너뛴다(기존 것 유지).
//  · 보호 영역(일괄 생성 자식의 캐릭터 프리셋)은 지우지도 더하지도 않는다. 씬·생성 이미지는 건드리지 않는다.

export interface ReapplyTemplateLike {
  preset?: unknown | null;
  characterPresets: unknown[];
  vibes?: unknown[];
  characterReferences?: unknown[];
}

export interface ReapplyRecordLike {
  presets?: { type: string; name: string }[];
  characterPresetNames?: string[];
  vibePaths?: string[];
  referencePaths?: string[];
  protectAreas?: string[];
}

/** 대상 프로젝트(열려 있을 때만) — 실제로 지금 있는 이름만 「교체」로 보이려고 */
export interface ReapplyTargetLike {
  hasPreset(type: string, name: string): boolean;
  hasCharacterPreset(name: string): boolean;
  /** 공용 설정 바이브·레퍼런스 경로 */
  sharedPaths(): { vibes: Set<string>; references: Set<string> };
}

export interface ReapplyPreview {
  /** 이 템플릿을 이 프로젝트에 처음 적용(적용 기록 없음) — 지워지는 것이 없다 */
  first: boolean;
  /** 지웠다가 다시 만드는 그림체 프리셋 이름 */
  presets: string[];
  /** 지웠다가 다시 만드는 캐릭터 프리셋 이름 */
  characterPresets: string[];
  /** 교체되는 공용 설정 바이브·레퍼런스 개수 */
  vibes: number;
  references: number;
  /** 보호 영역이라 건너뛰는 캐릭터 프리셋 */
  charactersProtected: boolean;
  /** 대상 프로젝트를 보고 지금 있는 것만 골랐는가(false = 적용 기록 그대로) */
  checkedTarget: boolean;
}

export function planReapplyPreview(
  template: ReapplyTemplateLike,
  record: ReapplyRecordLike | undefined,
  target?: ReapplyTargetLike,
): ReapplyPreview {
  const hasPreset = !!template.preset;
  const hasChars = template.characterPresets.length > 0;
  const hasVibes = (template.vibes?.length ?? 0) > 0;
  const hasRefs = (template.characterReferences?.length ?? 0) > 0;
  const charactersProtected = !!record?.protectAreas?.includes('characterPresets');
  if (!record) {
    return {
      first: true,
      presets: [],
      characterPresets: [],
      vibes: 0,
      references: 0,
      charactersProtected,
      checkedTarget: !!target,
    };
  }
  const uniq = (xs: string[]) => [...new Set(xs)];
  const presets = hasPreset
    ? uniq((record.presets ?? []).filter((p) => !target || target.hasPreset(p.type, p.name)).map((p) => p.name))
    : [];
  const characterPresets =
    hasChars && !charactersProtected
      ? uniq((record.characterPresetNames ?? []).filter((n) => !target || target.hasCharacterPreset(n)))
      : [];
  const paths = target?.sharedPaths();
  const vibes = hasVibes ? (record.vibePaths ?? []).filter((p) => !paths || paths.vibes.has(p)).length : 0;
  const references = hasRefs
    ? (record.referencePaths ?? []).filter((p) => !paths || paths.references.has(p)).length
    : 0;
  return { first: false, presets, characterPresets, vibes, references, charactersProtected, checkedTarget: !!target };
}

/** 이름 목록 — 많으면 앞 max 개 + 「외 N개」 */
export function namesLine(names: readonly string[], max = 3): string {
  const shown = names.slice(0, max).map((n) => `「${n}」`).join(' ');
  return names.length > max ? `${shown} 외 ${names.length - max}개` : shown;
}

export const REAPPLY_TEXT = {
  intro:
    '템플릿의 프리셋·캐릭터 프리셋·바이브/레퍼런스를 이 프로젝트에 적용합니다. 템플릿에서 비어 있는 영역은 건너뛰고, 씬·생성 이미지는 건드리지 않습니다.',
  first: '이 템플릿을 이 프로젝트에 처음 적용합니다 — 지워지는 항목은 없고 새로 추가만 됩니다.',
  replaceHead: '다음 항목은 지워진 뒤 템플릿 내용으로 다시 만들어집니다(교체):',
  // 대상 프로젝트가 열려 있지 않아 지금 남아 있는지 모를 때
  replaceHeadRecorded: '이전 적용 때 이 템플릿이 넣은 다음 항목은(남아 있으면) 지워진 뒤 템플릿 내용으로 다시 만들어집니다(교체):',
  presets: (names: readonly string[]) => `그림체 프리셋 ${names.length}개: ${namesLine(names)}`,
  characterPresets: (names: readonly string[]) => `캐릭터 프리셋 ${names.length}개: ${namesLine(names)}`,
  sharedImages: (vibes: number, refs: number) =>
    [vibes > 0 ? `공용 바이브 ${vibes}개` : '', refs > 0 ? `공용 캐릭터 레퍼런스 ${refs}개` : ''].filter(Boolean).join(' · '),
  nothingReplaced: '지금 이 프로젝트에 남아 있는 교체 대상은 없습니다 — 새로 추가만 됩니다.',
  sameNameWarning:
    '이전 적용 때 기록된 이름으로 찾아 교체하므로, 그 이름의 프리셋은 직접 고쳤거나 같은 이름으로 직접 만든 것이어도 교체됩니다.',
  charactersProtected: '일괄 생성으로 만든 프로젝트라 캐릭터 프리셋은 건드리지 않습니다.',
  undoable: '되돌리기(Ctrl+Z)로 적용 전 상태로 되돌릴 수 있습니다.',
  notUndoableOther: '지금 열려 있는 프로젝트가 아니어서 되돌릴 수 없습니다. 되돌리려면 이 프로젝트를 연 뒤 적용해 주세요.',
  notUndoableMirror: '이 창에서는 이 프로젝트를 읽기 전용으로 보고 있어 되돌릴 수 없습니다.',
  /** 폴더 기본 템플릿 → 상속 자식 전파 확인(되돌리기 없음 — 여러 프로젝트에 걸침) */
  propagateConfirm: (count: number) =>
    `변경 내용을 상속 중인 자식 프로젝트 ${count}개에 덮어쓸까요?\n` +
    '각 프로젝트에서 이전에 이 템플릿이 넣은 프리셋·캐릭터 프리셋·바이브/레퍼런스가 지워지고 새 구성으로 다시 만들어집니다' +
    '(같은 이름이면 직접 고친 것도 교체). 템플릿에서 비어 있는 영역은 건너뛰고, 씬·생성 이미지는 건드리지 않습니다.\n' +
    '이 작업은 되돌릴 수 없습니다.',
} as const;

/** 확인 창 본문 줄(문단 순서대로). undoState = 되돌리기 가능 여부 */
export function reapplyPreviewLines(
  preview: ReapplyPreview,
  undoState: 'undoable' | 'other' | 'mirror',
): string[] {
  const lines: string[] = [];
  if (preview.first) {
    lines.push(REAPPLY_TEXT.first);
  } else {
    const items: string[] = [];
    if (preview.presets.length > 0) items.push(REAPPLY_TEXT.presets(preview.presets));
    if (preview.characterPresets.length > 0) items.push(REAPPLY_TEXT.characterPresets(preview.characterPresets));
    const shared = REAPPLY_TEXT.sharedImages(preview.vibes, preview.references);
    if (shared) items.push(shared);
    if (items.length > 0) {
      lines.push(
        preview.checkedTarget ? REAPPLY_TEXT.replaceHead : REAPPLY_TEXT.replaceHeadRecorded,
        ...items.map((x) => `· ${x}`),
      );
      if (preview.presets.length + preview.characterPresets.length > 0) lines.push(REAPPLY_TEXT.sameNameWarning);
    } else {
      lines.push(REAPPLY_TEXT.nothingReplaced);
    }
  }
  if (preview.charactersProtected) lines.push(REAPPLY_TEXT.charactersProtected);
  lines.push(
    undoState === 'undoable'
      ? REAPPLY_TEXT.undoable
      : undoState === 'mirror'
        ? REAPPLY_TEXT.notUndoableMirror
        : REAPPLY_TEXT.notUndoableOther,
  );
  return lines;
}
