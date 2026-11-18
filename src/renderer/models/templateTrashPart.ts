// 씬 템플릿 지정의 휴지통 몫(2026-11-18 T2) — 순수 함수만(가져오기 순환 없음: 타입만 TemplateService 에서).
//
// 프로젝트를 휴지통으로 보낼 때 templates.json 의 그 이름 몫(씬 템플릿 지정·숨김·퀵 생성 지정·적용 기록)을 휴지통 기록의
// 사이드카 스냅숏(TrashService.ProjectSidecarSnapshot.template)으로 옮기고, 복원할 때 최종 이름으로 되살린다.
// 적용 기록 형식 검사는 templates.json 로드(TemplateService.parseTemplatesSidecar)와 같은 규칙 — 여기 한 곳에 둔다.
import type { ITemplateApplicationRecord, TemplateProtectArea } from './TemplateService';

/**
 * 한 프로젝트의 적용 기록 묶음(템플릿 id → 기록) 정규화. 형식이 어긋난 항목은 걸러내고 필드 기본값을 채운다
 * (구버전 데이터는 필드가 없어 빈 객체 → 무해). templates.json 로드와 휴지통 스냅숏이 함께 쓴다.
 */
export function sanitizeProjectApplications(
  byTpl: unknown,
): Record<string, ITemplateApplicationRecord> {
  const inner: Record<string, ITemplateApplicationRecord> = {};
  if (!byTpl || typeof byTpl !== 'object') return inner;
  for (const [tplId, rec] of Object.entries(byTpl as any)) {
    if (!tplId || !rec || typeof rec !== 'object') continue;
    const r = rec as any;
    // 보호 영역: 알려진 값만 통과 (빈 배열이면 필드 생략)
    const protect = Array.isArray(r.protectAreas)
      ? (r.protectAreas.filter(
          (x: any) => x === 'characterPresets' || x === 'scenes',
        ) as TemplateProtectArea[])
      : [];
    inner[tplId] = {
      ...(protect.length > 0 ? { protectAreas: protect } : {}),
      inherited: !!r.inherited,
      presets: Array.isArray(r.presets)
        ? r.presets.filter(
            (p: any) => p && typeof p.type === 'string' && typeof p.name === 'string',
          )
        : [],
      characterPresetNames: Array.isArray(r.characterPresetNames)
        ? r.characterPresetNames.filter((n: any) => typeof n === 'string')
        : [],
      vibePaths: Array.isArray(r.vibePaths)
        ? r.vibePaths.filter((n: any) => typeof n === 'string')
        : [],
      referencePaths: Array.isArray(r.referencePaths)
        ? r.referencePaths.filter((n: any) => typeof n === 'string')
        : [],
    };
  }
  return inner;
}

/**
 * 휴지통 기록에 실리는 템플릿 몫(trash.json 사이드카의 선택 필드 `template` — 구버전은 모르는 키라 무시한다).
 * 값은 true 일 때만 둔다. 이름은 담지 않는다(복원 때 최종 이름으로 다시 붙인다).
 */
export interface ProjectTemplateTrashPart {
  /** 씬 템플릿 지정(sceneTemplates)에 있었다 */
  sceneTemplate?: true;
  /** 숨김(hiddenSceneTemplates)에도 있었다 — 지정(씬 템플릿 또는 퀵 생성)과 함께일 때만 의미가 있다 */
  hidden?: true;
  /** 퀵 생성 전용 프로젝트(quickGenProject)였다 */
  quickGen?: true;
  /** 그 이름의 적용 기록(템플릿 id → 기록) */
  applications?: Record<string, ITemplateApplicationRecord>;
}

/**
 * 템플릿 몫 정규화(trash.json 손상·수동 편집 대비) — 정상 모양만 통과. 되살릴 것이 없으면 undefined.
 * 숨김만 있고 지정이 없는 값은 버린다(숨김에 넣을 때는 반드시 지정과 함께 — 고아 숨김을 만들지 않음).
 */
export function normalizeProjectTemplatePart(raw: unknown): ProjectTemplateTrashPart | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as any;
  const out: ProjectTemplateTrashPart = {};
  if (r.sceneTemplate === true) out.sceneTemplate = true;
  if (r.quickGen === true) out.quickGen = true;
  if (r.hidden === true && (out.sceneTemplate || out.quickGen)) out.hidden = true;
  if (r.applications && typeof r.applications === 'object' && !Array.isArray(r.applications)) {
    const apps = sanitizeProjectApplications(r.applications);
    if (Object.keys(apps).length > 0) out.applications = apps;
  }
  if (!out.sceneTemplate && !out.quickGen && !out.applications) return undefined;
  return out;
}
