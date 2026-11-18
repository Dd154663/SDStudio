// 전체 백업 복원 때 씬 템플릿 지정 목록(templates.json)을 받는 쪽 상태에 합치는 계획(2026-11-18 T1, 플랜
// guides/plans/2026-11-18-scene-template-safety.md 「T1 설계」, 조사 2026-11-17-scene-template-stability-findings.md 경로 1·2).
//
// 순수 함수만 둔다(UI·서비스·backend 를 import 하지 않음 — 형식 타입만). 반영은 TemplateService.restoreFromFullBackup 이
// 이 계획의 결과를 메모리에 넣고 저장 1회로 한다. 「받는 쪽」 = 복원을 실행하는 기기의 현재 상태.
//
// 규칙(판단이 갈리면 덜 쓰고·덜 지우고·덜 숨긴다):
//  · full·noimg — 이번 복원에서 실제로 들어온 프로젝트만, 복원된 최종 이름 기준. 건너뛴·실패한 프로젝트는 손대지 않는다.
//    백업에 지정 정보가 있으면 들어온 프로젝트의 지정·숨김은 백업 상태를 따른다(씬 템플릿이면 지정, 아니면 일반 프로젝트).
//    지정만 있고 숨김이 없는 구형 씬 템플릿 상태도 그대로 옮긴다. 숨김만 있는(지정도 퀵 생성도 아닌) 백업 항목은 숨기지 않는다.
//    지정 정보가 없는(예전) 백업이면 덮어쓴 프로젝트만 덮어쓰기 전 받는 쪽 상태를 되살리고 나머지는 그대로 둔다.
//  · 퀵 생성 — 받는 쪽 quickGenName 이 비어 있을 때만 백업의 퀵 생성 프로젝트(최종 이름)를 지정+숨김. 이미 있으면 들어온 것은
//    일반 프로젝트로 보이게 둔다(숨김 고아를 만들지 않음).
//  · 폴더 기본 템플릿·적용 기록 — 받는 쪽에 값이 없는 곳만 채운다. 가리키는 프로젝트 템플릿 id 가 받는 쪽에 있을 때만.
//    폴더 기본 템플릿은 받는 쪽에 있는 폴더만, 적용 기록은 full·noimg 에선 이번에 들어온 프로젝트(최종 이름)만.
//  · settings — 프로젝트를 들이지 않는다. 지정·숨김·퀵 생성은 받는 쪽이 셋 다 비어 있을 때만, 받는 쪽에 있는 프로젝트 이름만.
//    적용 기록은 받는 쪽에 있는 프로젝트 중 기록이 하나도 없는 것만.

import type {
  ITemplateApplicationRecord,
  IFolderTemplateEntry,
  TemplatesSidecarData,
} from './TemplateService';

export type FullBackupRestoreMode = 'full' | 'noimg' | 'settings';

/** 이번 복원에서 실제로 들어온 프로젝트 — 원래 이름(백업 안)과 받는 쪽에 들어간 최종 이름 */
export interface FullBackupIncomingProject {
  origName: string;
  finalName: string;
  /** added = 같은 이름이 없었음 · renamed = 이름 충돌로 「(2)」 · overwritten = 기존 같은 이름 프로젝트를 지우고 들어옴 */
  kind: 'added' | 'renamed' | 'overwritten';
}

/** 덮어쓰기 직전 받는 쪽의 지정 상태(예전 백업 덮어쓰기에서 되살릴 값) */
export interface PreOverwriteDesignation {
  sceneTemplate: boolean;
  hidden: boolean;
  quickGen: boolean;
}

export interface FullBackupTemplatePlanInput {
  mode: FullBackupRestoreMode;
  /** 백업의 templates.json 을 parseTemplatesSidecar 로 읽은 것. 없거나 손상이면 null */
  backup: TemplatesSidecarData | null;
  /** 받는 쪽 현재 지정 목록(덮어쓰기 과정의 지정 해제가 반영된 뒤) */
  current: TemplatesSidecarData;
  /** full·noimg 에서 실제로 들어온 프로젝트(settings 는 빈 배열) */
  incoming: FullBackupIncomingProject[];
  /** 덮어쓴 프로젝트의 덮어쓰기 전 지정 상태 — 키 = 이름(덮어쓰기는 원래 이름 = 최종 이름) */
  preOverwrite: Record<string, PreOverwriteDesignation>;
  /** 받는 쪽 프로젝트 이름(복원 뒤) */
  existingProjects: readonly string[];
  /** 받는 쪽 폴더 경로(복원 뒤) */
  existingFolders: readonly string[];
  /** 받는 쪽 프로젝트 템플릿 id(백업 채택 뒤). 읽지 못했으면 빈 배열 = 아무것도 연결하지 않음 */
  templateIds: readonly string[];
}

export interface FullBackupTemplatePlanCounts {
  /** 씬 템플릿으로 지정된 프로젝트 수(들어온 것·settings 채택분) */
  sceneTemplates: number;
  /** 퀵 생성 프로젝트를 지정했는가 */
  quickGen: boolean;
  /** 채운 폴더 기본 템플릿 수 */
  folderTemplates: number;
  /** 채운 적용 기록 수(프로젝트 단위) */
  applications: number;
}

export interface FullBackupTemplatePlan {
  next: TemplatesSidecarData;
  changed: boolean;
  counts: FullBackupTemplatePlanCounts;
}

function cloneData(d: TemplatesSidecarData): TemplatesSidecarData {
  return {
    sceneNames: [...d.sceneNames],
    hiddenNames: [...d.hiddenNames],
    quickGenName: d.quickGenName,
    folderTemplates: { ...d.folderTemplates },
    templateApplications: { ...d.templateApplications },
  };
}

function sameData(a: TemplatesSidecarData, b: TemplatesSidecarData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const addName = (list: string[], name: string) => {
  if (!list.includes(name)) list.push(name);
};
const removeName = (list: string[], name: string): string[] => list.filter((n) => n !== name);

/** 적용 기록 한 프로젝트분에서 받는 쪽에 있는 템플릿 id 만 남긴 사본(없으면 null) */
function keepKnownTemplates(
  byTpl: Record<string, ITemplateApplicationRecord> | undefined,
  ids: ReadonlySet<string>,
): Record<string, ITemplateApplicationRecord> | null {
  if (!byTpl) return null;
  const out: Record<string, ITemplateApplicationRecord> = {};
  for (const [id, rec] of Object.entries(byTpl)) {
    if (ids.has(id)) out[id] = JSON.parse(JSON.stringify(rec));
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function planFullBackupTemplates(input: FullBackupTemplatePlanInput): FullBackupTemplatePlan {
  const { mode, backup, current } = input;
  const next = cloneData(current);
  const counts: FullBackupTemplatePlanCounts = {
    sceneTemplates: 0,
    quickGen: false,
    folderTemplates: 0,
    applications: 0,
  };
  const ids = new Set(input.templateIds);
  const folders = new Set(input.existingFolders);
  const projects = new Set(input.existingProjects);

  if (mode === 'settings') {
    if (backup) {
      // 지정·숨김·퀵 생성 — 받는 쪽이 셋 다 비어 있을 때만, 받는 쪽에 있는 프로젝트 이름만
      const allEmpty =
        current.sceneNames.length === 0 && current.hiddenNames.length === 0 && !current.quickGenName;
      if (allEmpty) {
        for (const n of backup.sceneNames) {
          if (!projects.has(n) || next.sceneNames.includes(n)) continue;
          next.sceneNames.push(n);
          counts.sceneTemplates++;
          if (backup.hiddenNames.includes(n)) addName(next.hiddenNames, n);
        }
        const q = backup.quickGenName;
        if (q && projects.has(q) && !next.sceneNames.includes(q)) {
          next.quickGenName = q;
          addName(next.hiddenNames, q);
          counts.quickGen = true;
        }
      }
      // 적용 기록 — 받는 쪽에 있는 프로젝트 중 기록이 하나도 없는 것만
      for (const [project, byTpl] of Object.entries(backup.templateApplications)) {
        if (!projects.has(project) || next.templateApplications[project]) continue;
        const kept = keepKnownTemplates(byTpl, ids);
        if (!kept) continue;
        next.templateApplications[project] = kept;
        counts.applications++;
      }
    }
  } else {
    for (const p of input.incoming) {
      const F = p.finalName;
      if (backup) {
        // 백업 상태를 따른다(들어온 프로젝트는 백업이 정본)
        const isScene = backup.sceneNames.includes(p.origName);
        const isHidden = backup.hiddenNames.includes(p.origName);
        const isQuick = backup.quickGenName === p.origName;
        // 받는 쪽에 같은 이름의 지정이 남아 있으면(휴지통 템플릿 이름 등) 먼저 비운다 — 백업이 일반 프로젝트면 보이게
        next.sceneNames = removeName(next.sceneNames, F);
        next.hiddenNames = removeName(next.hiddenNames, F);
        if (next.quickGenName === F && !isQuick) {
          // 퀵 생성 지정이 목록에 없던 이름(들어오기 전엔 이 이름의 프로젝트가 없었다)을 가리키던 것 — 일반 프로젝트가
          // 퀵 생성 전용으로 쓰이며 숨겨지지 않게 푼다(다음 퀵 생성 때 새로 만든다)
          next.quickGenName = null;
        }
        if (isScene) {
          addName(next.sceneNames, F);
          counts.sceneTemplates++;
          if (isHidden) addName(next.hiddenNames, F);
        }
        if (isQuick && !isScene && (!next.quickGenName || next.quickGenName === F)) {
          next.quickGenName = F;
          addName(next.hiddenNames, F);
          counts.quickGen = true;
        }
      } else if (p.kind === 'overwritten') {
        // 예전 백업(지정 정보 없음) 덮어쓰기 — 덮어쓰기 전 받는 쪽 상태를 되살린다(지금은 조용히 일반 프로젝트가 됐다)
        const pre = input.preOverwrite[F];
        if (!pre) continue;
        if (pre.sceneTemplate) {
          addName(next.sceneNames, F);
          counts.sceneTemplates++;
          if (pre.hidden) addName(next.hiddenNames, F);
        } else if (pre.quickGen && (!next.quickGenName || next.quickGenName === F)) {
          next.quickGenName = F;
          addName(next.hiddenNames, F);
          counts.quickGen = true;
        }
      }
    }
    if (backup) {
      // 적용 기록 — 이번에 들어온 프로젝트(최종 이름) 중 기록이 없는 것만
      for (const p of input.incoming) {
        if (next.templateApplications[p.finalName]) continue;
        const kept = keepKnownTemplates(backup.templateApplications[p.origName], ids);
        if (!kept) continue;
        next.templateApplications[p.finalName] = kept;
        counts.applications++;
      }
    }
  }

  // 폴더 기본 템플릿 — 받는 쪽에 있는 폴더 중 값이 없는 곳만, 템플릿 id 가 있을 때만(세 모드 공통)
  if (backup) {
    for (const [folder, entry] of Object.entries(backup.folderTemplates)) {
      if (!folders.has(folder) || next.folderTemplates[folder]) continue;
      if (!ids.has(entry.templateId)) continue;
      const filled: IFolderTemplateEntry = { templateId: entry.templateId };
      next.folderTemplates[folder] = filled;
      counts.folderTemplates++;
    }
  }

  return { next, changed: !sameData(next, current), counts };
}

/** 전체 백업 복원 완료 창에 덧붙이는 문구(되살린 것·건너뛴 것이 있을 때만) */
export const FULL_BACKUP_TEMPLATE_TEXT = {
  restored: (parts: string[]) => `${parts.join('·')}도 되살렸습니다.`,
  sceneTemplates: (n: number) => `씬 템플릿 ${n}개`,
  projectTemplates: (n: number) => `프로젝트 템플릿 ${n}개`,
  designationSkipped:
    '씬 템플릿 지정 목록을 읽지 못해 씬 템플릿·폴더 기본 템플릿 연결은 되살리지 않았습니다.',
  projectTemplatesSkipped: '프로젝트 템플릿 파일을 읽지 못해 프로젝트 템플릿은 되살리지 않았습니다.',
} as const;

export interface FullBackupTemplateNoteInput {
  /** 씬 템플릿으로 다시 지정한 수 */
  sceneTemplates: number;
  /** 채택한 프로젝트 템플릿 수 */
  projectTemplates: number;
  /** 지정 목록이 막혀 건너뜀 */
  designationSkipped: boolean;
  /** 프로젝트 템플릿 파일이 막혀 건너뜀 */
  projectTemplatesSkipped: boolean;
}

/** 덧붙일 줄들(없으면 빈 배열) */
export function fullBackupTemplateNote(n: FullBackupTemplateNoteInput): string[] {
  const lines: string[] = [];
  const parts: string[] = [];
  if (n.sceneTemplates > 0) parts.push(FULL_BACKUP_TEMPLATE_TEXT.sceneTemplates(n.sceneTemplates));
  if (n.projectTemplates > 0) parts.push(FULL_BACKUP_TEMPLATE_TEXT.projectTemplates(n.projectTemplates));
  if (parts.length > 0) lines.push(FULL_BACKUP_TEMPLATE_TEXT.restored(parts));
  if (n.designationSkipped) lines.push(FULL_BACKUP_TEMPLATE_TEXT.designationSkipped);
  if (n.projectTemplatesSkipped) lines.push(FULL_BACKUP_TEMPLATE_TEXT.projectTemplatesSkipped);
  return lines;
}
