// 이미지 그리드 「선택한 이미지 내보내기」(2026-11-22) — 고른 이미지만 기존 내보내기 흐름(ExportPresetService.exportPackage)에
// 태울 때 쓰는 순수 규칙. 씬 전체 내보내기는 이 모듈을 거치지 않는다(동작 불변). jest pickedImageExport.test.ts.

/** 고른 이미지 — 한 씬의 파일 이름들(그리드 선택). 씬은 객체 그대로 비교한다 */
export interface ExportImagePick<S = unknown> {
  scene: S;
  /** 파일 이름(경로가 섞여 와도 끝 이름으로 맞춘다) */
  files: readonly string[];
}

export const PICKED_EXPORT_TEXT = {
  chooser: (n: number) => `선택한 이미지 ${n}장을 내보냅니다.\n내보내기 방법을 선택해주세요`,
  summary: (projectName: string, n: number) => `${projectName} · 선택한 이미지 ${n}장`,
  note: '원본 이미지는 변경하지 않습니다.',
  empty: '내보낼 이미지가 없습니다',
};

const baseNameOf = (x: string) => x.split('/').pop() ?? x;

/** 경로·이름 목록 → 파일 이름 목록(중복 제거, 처음 나온 순서) */
export function pickFileNames(paths: readonly string[]): string[] {
  return Array.from(new Set(paths.map(baseNameOf)));
}

/**
 * 씬의 지금 출력 목록(그리드 표시 순서) 중 고른 것만 — 프리셋의 이미지 범위(즐겨찾기만 등)는 보지 않는다.
 * 그사이 지워진 파일은 빠진다(빈 배열이면 호출부가 「내보낼 이미지가 없습니다」).
 */
export function pickedOutputs(cands: readonly string[], picked: readonly string[]): string[] {
  const set = new Set(picked.map(baseNameOf));
  return cands.filter((c) => set.has(c));
}

/**
 * 결과 안 이름이 겹치면(대소문자 무시) 확장자 앞에 「구분자+번호」(2부터)를 붙여 구분한다 — 덮어쓰지 않는다.
 * 처음 나온 이름은 그대로, 붙인 이름도 다시 겹치지 않을 때까지 번호를 올린다. 하위 경로(「a/b.png」)는 전체로 비교.
 */
export function dedupeExportNames<T extends { name: string }>(items: readonly T[], separator: string): T[] {
  const used = new Set<string>();
  return items.map((item) => {
    let name = item.name;
    if (used.has(name.toLowerCase())) {
      const slash = name.lastIndexOf('/');
      const dot = name.lastIndexOf('.');
      const hasExt = dot > slash + 1;
      const stem = hasExt ? name.slice(0, dot) : name;
      const ext = hasExt ? name.slice(dot) : '';
      let n = 2;
      do {
        name = `${stem}${separator}${n}${ext}`;
        n++;
      } while (used.has(name.toLowerCase()));
    }
    used.add(name.toLowerCase());
    return name === item.name ? item : { ...item, name };
  });
}
