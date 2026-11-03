import * as React from 'react';
import { WFIGroup, WFIInlineInput } from '../models/workflows/WorkFlow';
import { ModelVersion } from '../backends/imageGen';

// 워크플로우 에디터 요소 공용 컨텍스트.
// PreSetEdtior 본체가 Provider 를 제공하고, VibeEditor/CharacterReferenceEditor 등
// 분리된 편집기 컴포넌트들이 소비한다. (파일 분리 시 순환 import 방지용 독립 모듈)
export interface IWFElementContext {
  preset: any;
  shared: any;
  meta?: any;
  type: string;
  middlePromptMode: boolean;
  editVibe: WFIInlineInput | undefined;
  setEditVibe: (vibe: WFIInlineInput | undefined) => void;
  editCharacterReference: WFIInlineInput | undefined;
  setEditCharacterReference: (reference: WFIInlineInput | undefined) => void;
  editCharacters: string | undefined;
  setEditCharacters: (field: string | undefined) => void;
  showGroup?: string;
  setShowGroup: (group: string | undefined) => void;
  showGroupOverlay?: string;
  setShowGroupOverlay: (group: string | undefined) => void;
  groupElement?: WFIGroup;
  getMiddlePrompt?: () => string;
  onMiddlePromptChange?: (txt: string) => void;
  getCharacterMiddlePrompt?: (index: number) => string;
  onCharacterMiddlePromptChange?: (index: number, txt: string) => void;
  /** 이미지 입력칸(ImageSelect) 업로드 완료 알림 — 변형 씬 편집 창이 씬 해상도를 맞출 때 쓴다(R-res). */
  onImageUploaded?: (field: string, base64: string) => void | Promise<void>;
  modelVersion: ModelVersion;
  /** 호출부가 그려 넣는 칸(`wfiCustomSlot` id → 렌더 함수) — 조합 계열 변형 씬 편집 창(SPEC §7-4). 없으면 빈 칸. */
  customSlots?: Record<string, (() => React.ReactNode) | undefined>;
  /**
   * 프롬프트 칸 머리 줄 오른쪽 끝 요소(필드명 → 렌더 함수, EditorField headerEnd) — 단일 I2I·인페인트 편집 창의
   * 「조합 모드 켜기」(SPEC §7-4, 2026-11-03). 없으면 머리 줄 그대로.
   */
  fieldHeaderEnds?: Record<string, (() => React.ReactNode) | undefined>;
}

export const WFElementContext = React.createContext<IWFElementContext | null>(null);

// 프리셋 패널 하단 아이콘 행(uiPresetIconRow) 내부 렌더 표시.
// PresetRootRender 의 하단 행 컨테이너가 true 로 제공하고, 대상 버튼 컴포넌트
// (CharacterButton/WFRGroup/VibeButton/CharacterReferenceButton)가 읽어
// 넓은(w-full) 형태 대신 아이콘 압축 형태로 렌더한다. 기본 false = 현행 렌더.
export const PresetIconRowContext = React.createContext<boolean>(false);
