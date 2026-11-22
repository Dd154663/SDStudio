// 그림체(사전 세팅) 삭제 확인 — 「이번 세션에서 다시 묻지 않음」(2026-11-22).
//
// 호출부(사전 세팅 줄의 삭제 버튼·우클릭 「그림체 삭제」·일괄 삭제 창)는 차단 검사(마지막 하나 등)를 먼저 하고
// 삭제 본체(run — editPresetList 기록 포함)를 넘긴다. 이번 실행에서 체크하고 확인한 적이 있으면 창 없이 run,
// 아니면 deleteConfirmText('undoable') 확인 창 + 체크(confirmCheck). 체크한 채 [삭제]일 때만 플래그를 켠다
// (취소·Esc·뒤로 가기 = 플래그 불변). 플래그 = appState.skipPresetDeleteConfirm(저장하지 않음, 이미지 삭제 플래그와 별개).

import { appState } from './AppService';
import {
  deleteConfirmText,
  shouldSkipPresetDeleteConfirm,
  SKIP_DELETE_CONFIRM_LABEL,
} from './deleteFlowRules';

export interface PresetDeleteTarget {
  /** 확인 문구의 종류 — 단건 = 'style'(「그림체 "이름"」), 일괄 = 'preset'(「사전 세팅 N개」) */
  kind: 'style' | 'preset';
  name?: string;
  count?: number;
}

export function confirmPresetDelete(
  target: PresetDeleteTarget,
  run: () => void | Promise<void>,
): void {
  const count = target.count ?? 1;
  if (shouldSkipPresetDeleteConfirm(appState.skipPresetDeleteConfirm, count)) {
    void run();
    return;
  }
  let checked = false;
  appState.pushDialog({
    type: 'confirm',
    // 휴지통이 없다 — 파일을 지우지 않고 editPresetList 기록으로 되돌리기 가능(빨강·Enter 무시, 2026-11-15)
    ...deleteConfirmText({
      kind: target.kind,
      name: target.name,
      count: target.count,
      outcome: 'undoable',
    }),
    confirmCheck: {
      label: SKIP_DELETE_CONFIRM_LABEL,
      onChange: (c) => {
        checked = c;
      },
    },
    callback: () => {
      if (checked) appState.skipPresetDeleteConfirm = true;
      return run();
    },
  });
}
