import type { CharacterPreset, Session } from './types';

// 프로젝트(세션)별 「적용 중인 캐릭터 프리셋」 판정 — 단일 출처.
// appState.appliedCharacterPreset·getAppliedCharacterPreset(지금 열린 프로젝트)과
// 이미지 내보내기의 캐릭터 파일명 접두/접미사(프로젝트·폴더 일괄 공용, 2026-11-16 M5 묶음 b-2)가 함께 쓴다.
// 규칙 = 그 세션의 선택된 워크플로우 shared 의 `_appliedPresetName`(마지막 적용 이름) → 그 세션의 캐릭터 프리셋.

/** 세션의 적용 캐릭터 프리셋 이름(없으면 undefined) */
export function appliedCharacterPresetNameOf(session: Session | undefined): string | undefined {
  if (!session) return undefined;
  const workflowType = session.selectedWorkflow?.workflowType;
  if (!workflowType) return undefined;
  const shared = session.presetShareds?.get(workflowType);
  return shared?._appliedPresetName || undefined;
}

/** 세션의 적용 캐릭터 프리셋 객체(없으면 undefined) */
export function appliedCharacterPresetOf(session: Session | undefined): CharacterPreset | undefined {
  const name = appliedCharacterPresetNameOf(session);
  if (!session || !name) return undefined;
  return session.getCharacterPreset(name);
}

/** 이미지 내보내기 파일명에 붙는 캐릭터 프리셋 접두/접미사 */
export interface CharacterFilenameAffix {
  filenamePrefix?: string;
  filenameSuffix?: string;
}

/** 세션의 적용 캐릭터 프리셋 기준 파일명 접두/접미사(적용 프리셋이 없으면 둘 다 undefined) */
export function characterFilenameAffixOf(session: Session | undefined): CharacterFilenameAffix {
  const character = appliedCharacterPresetOf(session);
  return { filenamePrefix: character?.filenamePrefix, filenameSuffix: character?.filenameSuffix };
}
