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
  modelVersion: ModelVersion;
}

export const WFElementContext = React.createContext<IWFElementContext | null>(null);
