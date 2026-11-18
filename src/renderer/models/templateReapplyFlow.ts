// 템플릿 수동 적용(ReapplyTemplateModal) 흐름(2026-11-18) — 대상이 지금 열린 프로젝트면 재적용 전체를 되돌리기 한 항목으로 기록한다
// (templateReapplyUndo). 다른 프로젝트·미러는 종전처럼 기록 없이 적용(확인 창 문구가 「되돌릴 수 없음」을 알린다).
// 폴더 기본 템플릿의 자식 전파(여러 프로젝트)는 이 흐름을 쓰지 않는다 — 기록 없음.
import { runInAction } from 'mobx';
import { projectTemplateService, sessionService, templateService, workFlowService } from '.';
import { getAppState } from './appStateRef';
import type { Session } from './types';
import { undoService, UNDO_TEXT } from './undoService';
import { beginTemplateReapplyRecord } from './templateReapplyUndo';
import { planReapplyPreview, ReapplyPreview, ReapplyTargetLike } from './templateReapplyPreview';

const DEFAULT_SHARED_TYPE = 'SDImageGenEasy'; // ProjectTemplateService.instantiateIntoSession 과 같은 기본값

function currentSession(): Session | undefined {
  try {
    return getAppState().curSession;
  } catch {
    return undefined;
  }
}

/** 이 프로젝트에 대한 적용을 되돌릴 수 있는가 — 'undoable' · 'other'(열린 프로젝트 아님) · 'mirror'(읽기 전용 미러) */
export function reapplyUndoState(targetName: string): 'undoable' | 'other' | 'mirror' {
  const cur = currentSession();
  if (!cur || cur.name !== targetName) return 'other';
  return undoService.canRecord(cur) ? 'undoable' : 'mirror';
}

function targetView(session: Session): ReapplyTargetLike {
  return {
    hasPreset: (type, name) => !!session.getPreset(type, name),
    hasCharacterPreset: (name) => session.hasCharacterPreset(name),
    sharedPaths: () => {
      const vibes = new Set<string>();
      const references = new Set<string>();
      for (const shared of session.presetShareds.values()) {
        for (const v of shared?.vibes ?? []) if (v?.path) vibes.add(v.path);
        for (const r of shared?.characterReferences ?? []) if (r?.path) references.add(r.path);
      }
      return { vibes, references };
    },
  };
}

/** 확인 창 미리보기 — 대상이 열린 프로젝트면 지금 남아 있는 이름만, 아니면 적용 기록 그대로 */
export function previewReapply(templateId: string, targetName: string): ReapplyPreview | undefined {
  const entry = projectTemplateService.get(templateId);
  if (!entry) return undefined;
  const cur = currentSession();
  const target = cur && cur.name === targetName ? targetView(cur) : undefined;
  return planReapplyPreview(entry, templateService.getApplication(targetName, templateId), target);
}

/**
 * 템플릿을 기존 프로젝트에 적용한다. 대상이 열린 프로젝트(미러 아님)면 Ctrl+Z 한 번으로 적용 전 상태(그림체·캐릭터 프리셋·공용
 * 바이브/레퍼런스·선택·적용 기록)로 돌아간다. 반환 recorded = 되돌리기 기록을 남겼는가.
 */
export async function reapplyTemplateToProject(templateId: string, targetName: string): Promise<{ recorded: boolean }> {
  const cur = currentSession();
  const live = cur && cur.name === targetName ? await sessionService.get(targetName) : undefined;
  if (!cur || live !== cur || !undoService.canRecord(cur)) {
    await sessionService.applyProjectTemplateToSession(templateId, targetName);
    return { recorded: false };
  }
  await projectTemplateService.ensureLoaded();
  const entry = projectTemplateService.get(templateId);
  // 템플릿 바이브/레퍼런스는 공용 설정에 들어간다 — 그 종류의 공용 설정이 아직 없으면 재적용이 새로 만든다. 기록 전에 같은
  // 빈 공용 설정을 먼저 만들어 두어 되돌림이 그 안의 바이브·레퍼런스까지 비우게 한다(빈 공용 설정 자체는 해가 없다).
  if (entry && ((entry.vibes?.length ?? 0) > 0 || (entry.characterReferences?.length ?? 0) > 0)) {
    const type = entry.preset?.type ?? DEFAULT_SHARED_TYPE;
    if (!cur.presetShareds.get(type)) {
      runInAction(() => cur.presetShareds.set(type, workFlowService.buildShared(type)));
    }
  }
  const rec = beginTemplateReapplyRecord(cur, UNDO_TEXT.templateReapply(entry?.name ?? ''), {
    get: () => templateService.getApplication(targetName, templateId),
    restore: (record) => templateService.restoreApplication(targetName, templateId, record),
  });
  let recorded = false;
  try {
    await sessionService.applyProjectTemplateToSession(templateId, targetName);
  } finally {
    // 도중에 실패해도 이미 바뀐 것은 한 항목으로 남긴다(되돌릴 수 있게)
    recorded = rec.commit();
  }
  return { recorded };
}
