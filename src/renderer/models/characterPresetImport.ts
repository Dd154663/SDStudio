// 글로벌 캐릭터 프리셋 파일 불러오기 — 텍스트 단계 (드라이브 API ③에서 CharacterPresetEditor 밖으로 분리, 2026-09-28)
//
// 파일(<input type=file>)과 Google 드라이브에서 받은 파일이 같은 흐름을 쓴다. 동작은 분리 전과 같다:
// JSON 형식 검사 → (이름이 같은 항목이 있으면) 정책 선택 → 덮어쓰기면 확인 1회(id 유지·내용만 교체,
// 프로젝트 연결 보존) → 적용 → 「추가 · 갱신 · 건너뜀」 안내. 파일 형식은 로컬 내보내기(ExportedPresetData v1)
// 와 같아 로컬 파일도 불러올 수 있다(GlobalCharacterPresetService.importFromFileData).
// 프로젝트 로컬 캐릭터 프리셋 불러오기는 드라이브 대상이 아니라 CharacterPresetEditor 에 그대로 둔다.

import { globalCharacterPresetService } from '.';
import { appState } from './AppService';
import { askImportPolicyWithConfirm, IMPORT_FLOW_TEXT, notifyImportDone } from './importFlow';

export const CHARACTER_PRESET_IMPORT_TEXT = {
  label: '캐릭터 프리셋',
  invalid: '올바른 캐릭터 프리셋 파일이 아닙니다',
  failed: '불러오기에 실패했습니다',
};

export async function importGlobalCharacterPresetsText(text: string): Promise<void> {
  let data: any;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    appState.pushMessage(CHARACTER_PRESET_IMPORT_TEXT.invalid);
    return;
  }
  if (!data || !Array.isArray(data.presets)) {
    appState.pushMessage(CHARACTER_PRESET_IMPORT_TEXT.invalid);
    return;
  }
  // 공용 불러오기 흐름(드라이브 동기화 ② B2): 이름이 같은 항목이 있으면 정책 선택 →
  // 덮어쓰기면 확인 1회. 덮어쓰기는 id 를 유지한 채 내용만 교체(프로젝트 연결 보존).
  const policy = await askImportPolicyWithConfirm({
    label: CHARACTER_PRESET_IMPORT_TEXT.label,
    conflictCount: globalCharacterPresetService.countFileConflicts(data),
    protection: IMPORT_FLOW_TEXT.protection.keepLink,
  });
  if (!policy) return;
  try {
    const res = await globalCharacterPresetService.importFromFileData(data, policy);
    notifyImportDone(CHARACTER_PRESET_IMPORT_TEXT.label, res);
  } catch (e: any) {
    appState.pushMessage(e.message || CHARACTER_PRESET_IMPORT_TEXT.failed);
  }
}
