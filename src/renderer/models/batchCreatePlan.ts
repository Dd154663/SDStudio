// 프로젝트 일괄 생성(배치 생성 R2, 2026-07-16 합의)의 조합·이름 순수 로직.
// UI/IO 무의존 리프 모듈 — 단위 테스트 대상(batchCreatePlan.test.ts).
//
// 의미 모델 = "베이스 × 축" (플랜 문서 §설계 제안):
//  베이스 = 폴더 템플릿의 프롬프트·샘플링·캐릭터 프롬프트·수동 바이브/레퍼런스
//  축 1 = 전역 캐릭터 프리셋 다중 선택 / 축 2 = 씬 템플릿 다중 선택
//  자식 1개 = 베이스 + 캐릭터 1 + 씬 템플릿 1벌 (데카르트 곱)

// 캐릭터 축 항목 (전역 캐릭터 프리셋의 id·이름)
export interface IBatchAxisChar {
  id: string;
  name: string;
}

// 배치 항목 1건 — name 은 충돌 해소 전 기본명
export interface IBatchPlanItem {
  name: string;
  charPresetId?: string;
  sceneTemplateName?: string;
  subfolder?: string;
}

// 이름 규칙 (스펙 4항): `{캐릭터}_{씬템플릿}`, 한 축뿐이면 그 축 이름.
export function buildBatchItemName(
  charName?: string,
  sceneName?: string,
): string {
  if (charName && sceneName) return `${charName}_${sceneName}`;
  return charName ?? sceneName ?? '';
}

// 축의 데카르트 곱으로 배치 항목 목록을 만든다. 양 축 모두 비면 빈 배열
// (실행 버튼 비활성 조건). subfolderByChar = "캐릭터별 서브폴더로 묶기"
// (스펙 5항 — 서브폴더명 = 캐릭터 프리셋 이름, 캐릭터 축 있을 때만 의미).
export function buildBatchCombinations(
  chars: IBatchAxisChar[],
  sceneTemplateNames: string[],
  subfolderByChar: boolean,
): IBatchPlanItem[] {
  if (chars.length === 0 && sceneTemplateNames.length === 0) return [];
  if (chars.length === 0) {
    // 씬 축만: 1×M
    return sceneTemplateNames.map((s) => ({
      name: buildBatchItemName(undefined, s),
      sceneTemplateName: s,
    }));
  }
  const out: IBatchPlanItem[] = [];
  for (const c of chars) {
    const subfolder = subfolderByChar ? c.name : undefined;
    if (sceneTemplateNames.length === 0) {
      // 캐릭터 축만: N×1
      out.push({ name: c.name, charPresetId: c.id, subfolder });
    } else {
      for (const s of sceneTemplateNames) {
        out.push({
          name: buildBatchItemName(c.name, s),
          charPresetId: c.id,
          sceneTemplateName: s,
          subfolder,
        });
      }
    }
  }
  return out;
}

// 이름 충돌 해소 — 기존 프로젝트와 이번 배치 내 중복을 모두 taken 으로 받아
// `_n` 접미(기존 씬 임포트 관례)를 붙인다. 확정된 이름은 taken 에 추가된다.
export function resolveBatchName(base: string, taken: Set<string>): string {
  let name = base;
  if (taken.has(name)) {
    let n = 1;
    while (taken.has(`${base}_${n}`)) n++;
    name = `${base}_${n}`;
  }
  taken.add(name);
  return name;
}
