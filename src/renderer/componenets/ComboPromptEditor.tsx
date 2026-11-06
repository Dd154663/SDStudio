// 조합 계열 변형 씬(조합 모드 I2I·인페인트·미러) 편집 창의 「프롬프트 에디터」 탭 본문(2026-11-03 편집 창 정렬, SPEC §7-4).
// 단일 계열(SDI2IUI·SDInpaintUI)과 같은 순서가 되도록 편집 칸(SDI2IComboUI·SDInpaintComboUI·SDMirrorUI)의 「프롬프트」 자리
// (`wfiCustomSlot` — COMBO_SLOT_IDS)에 아래 칸을 끼워 넣는다. 탭 위에 칸을 따로 쌓지 않는다.
//   중간 프롬프트(이 씬에만 — 머리 줄 = 모드 표시·「조합 모드 끄기」)
//   → [상위·하위 프롬프트 — 레거시 씬 편집기 모드(appState.legacySceneEditor)만]
//   → 전역 네거티브(기본 접힘 + 머리 오른쪽 「사용」 토글 = 씬 프리셋 useGlobalUc)
//   → (편집 칸의 'uc' 행) 씬 전용 네거티브 → 캐릭터 → 샘플링 안내 → 시드 → 바이브 → 캐릭터 레퍼런스.
// 값·저장 경로는 예전 그대로: snapshot = 씬 프리셋 frontPrompt·backPrompt·globalUc, shared(미러 포함) = 현재 사전 세팅
// frontPrompt·backPrompt·uc. 글자 칸은 InPaintEditor 의 setPromptRow·setMiddlePrompt(되돌리기 기록 포함)를 그대로 쓴다.
import { ReactNode, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import {
  COMBO_EDITOR_TEXT,
  COMBO_SLOT_IDS,
  ComboMode,
  comboUsesGlobalUc,
} from '../models/comboMode';
import { setWorkflowField, workflowFieldLabel } from '../models/presetUndo';
import { InpaintScene } from '../models/types';
import { WFIElement } from '../models/workflows/WorkFlow';
import { EditorField, InnerPreSetEditor, V5MediumNegativeNotice } from './PreSetEdtior';
import { useModelFamilySwitch } from './ModelFamilySwitch';
import PromptEditTextArea from './PromptEditTextArea';

// 전역 네거티브 구획 접힘 — 앱 실행 동안만 기억한다(프로젝트·설정에 저장 안 함, InPaintEditor brushSizeSaved 와 같은 방식).
let globalUcFoldedSaved = true;

/** 테스트 전용 — 접힘 기억을 기본(접힘)으로 되돌린다. */
export function resetComboGlobalUcFold() {
  globalUcFoldedSaved = true;
}

interface PromptRow {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

interface Props {
  scene: InpaintScene;
  mode: ComboMode;
  /** shared(미러 포함) 모드의 현재 사전 세팅 preset — snapshot 이면 쓰지 않는다. */
  globalPreset: any | null;
  /** 아래 편집 칸 정의(SDI2IComboUI·SDInpaintComboUI·SDMirrorUI). */
  element: WFIElement;
  /** 「조합 모드 끄기」·모드 표시를 보일지(조합 모드 I2I·인페인트 — 미러는 없음). */
  canTurnOff: boolean;
  /** PC 오른쪽 패널(true)·모바일 FloatView(false). */
  pc: boolean;
  getMiddlePrompt: () => string;
  setMiddlePrompt: (txt: string) => void;
  setPromptRow: (target: any, field: string, rowLabel: string, v: string) => void;
  onTurnOff: () => void;
  onImageUploaded?: (field: string, base64: string) => void | Promise<void>;
}

export const ComboPromptEditor = observer(
  ({
    scene,
    mode,
    globalPreset,
    element,
    canTurnOff,
    pc,
    getMiddlePrompt,
    setMiddlePrompt,
    setPromptRow,
    onTurnOff,
    onImageUploaded,
  }: Props) => {
    const [globalUcFolded, setGlobalUcFolded] = useState(globalUcFoldedSaved);
    // V5 Medium 이면 전역 네거티브 칸 위에도 「쓰이지 않음」 안내(2026-11-06) — 모델은 config 의 현재 값.
    const { family: modelFamily } = useModelFamilySwitch();
    const changeGlobalUcFolded = (folded: boolean) => {
      globalUcFoldedSaved = folded;
      setGlobalUcFolded(folded);
    };
    const preset = scene.preset;
    const snapshot = mode === 'snapshot';
    // 상위·하위·전역 네거티브 칸의 주인 — snapshot = 이 씬 프리셋, shared = 현재 사전 세팅(실시간 공유)
    const owner = snapshot ? preset : globalPreset;

    const frontBackRows = (): PromptRow[] => {
      if (!owner) return [];
      const frontLabel = snapshot ? COMBO_EDITOR_TEXT.snapshotFront : COMBO_EDITOR_TEXT.sharedFront;
      const backLabel = snapshot ? COMBO_EDITOR_TEXT.snapshotBack : COMBO_EDITOR_TEXT.sharedBack;
      return [
        {
          label: frontLabel,
          value: owner.frontPrompt || '',
          onChange: (v) => setPromptRow(owner, 'frontPrompt', frontLabel, v),
        },
        {
          label: backLabel,
          value: owner.backPrompt || '',
          onChange: (v) => setPromptRow(owner, 'backPrompt', backLabel, v),
        },
      ];
    };

    // 전역 네거티브 「사용」 — 씬 프리셋 칸(useGlobalUc) 기록 경로(WFRInline 불 칸과 같은 setWorkflowField 'merge')
    const setUseGlobalUc = (on: boolean) =>
      setWorkflowField(appState.curSession, { preset }, 'preset', 'useGlobalUc', on, {
        label: workflowFieldLabel(
          'preset',
          COMBO_EDITOR_TEXT.useGlobalUcField,
          { preset },
          appState.curSession,
        ),
      });

    const customSlots: Record<string, () => ReactNode> = {
      [COMBO_SLOT_IDS.middle]: () => (
        <EditorField
          label={COMBO_EDITOR_TEXT.middle}
          full
          bold
          headerEnd={
            canTurnOff ? (
              <>
                <span className="text-xs font-normal" data-combo-mode-label="">
                  {snapshot ? COMBO_EDITOR_TEXT.modeSnapshot : COMBO_EDITOR_TEXT.modeShared}
                </span>
                <button
                  className="round-button back-gray btn-sm flex-none"
                  onClick={onTurnOff}
                >
                  {COMBO_EDITOR_TEXT.turnOff}
                </button>
              </>
            ) : undefined
          }
        >
          <PromptEditTextArea
            value={getMiddlePrompt()}
            disabled={false}
            onChange={setMiddlePrompt}
          />
        </EditorField>
      ),
      // 상위·하위 = 레거시 씬 편집기 모드에서만(일반 씬 단순 모드와 같은 기준 — 값·저장 경로는 그대로 남음)
      [COMBO_SLOT_IDS.frontBack]: () =>
        appState.legacySceneEditor ? (
          <>
            {frontBackRows().map((row) => (
              <EditorField key={row.label} label={row.label} full>
                <PromptEditTextArea value={row.value} disabled={false} onChange={row.onChange} />
              </EditorField>
            ))}
          </>
        ) : null,
      [COMBO_SLOT_IDS.globalUc]: () => {
        if (!owner) return null;
        const label = snapshot ? COMBO_EDITOR_TEXT.snapshotUc : COMBO_EDITOR_TEXT.sharedUc;
        const field = snapshot ? 'globalUc' : 'uc';
        const value: string = owner[field] || '';
        const use = comboUsesGlobalUc(preset);
        return (
          <>
          {modelFamily === 'v5m' && <V5MediumNegativeNotice />}
          <EditorField
            label={label}
            full
            folded={globalUcFolded}
            onFoldedChange={changeGlobalUcFolded}
            foldedBadge={value.trim() ? '작성됨' : undefined}
            headerEnd={
              <>
                {!use && (
                  <span className="text-xs font-normal" data-combo-global-uc-excluded="">
                    {COMBO_EDITOR_TEXT.globalUcExcluded}
                  </span>
                )}
                <label className="flex items-center gap-1 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    data-combo-global-uc-toggle=""
                    checked={use}
                    onChange={(e) => setUseGlobalUc(e.target.checked)}
                  />
                  {COMBO_EDITOR_TEXT.useGlobalUc}
                </label>
              </>
            }
          >
            <PromptEditTextArea
              value={value}
              disabled={false}
              onChange={(v) => setPromptRow(owner, field, label, v)}
            />
          </EditorField>
          </>
        );
      },
    };

    const editor = (
      <InnerPreSetEditor
        nopad={pc}
        type={scene.workflowType}
        preset={preset}
        shared={undefined}
        element={element}
        middlePromptMode={false}
        onImageUploaded={onImageUploaded}
        customSlots={customSlots}
      />
    );
    // PC = 단일 계열 오른쪽 패널(nopad InnerPreSetEditor)과 같은 골격, 모바일 = FloatView 단일 경로와 같은 패딩(InnerPreSetEditor 자체 p-2)
    return (
      <div className="flex flex-col h-full overflow-hidden" data-combo-prompt-editor="">
        <div className="flex-1 overflow-hidden min-h-0">{editor}</div>
      </div>
    );
  },
);
