import { backend, isMobile } from '.';
import { appState } from './AppService';

/**
 * 모바일 기본 배치 = 모바일 V2 (2026-09-27 사용자 결정, 5.4.0 부터).
 *  · 새 설치(저장소 판정 'fresh'): 조용히 V2 로 시작하고 완료 표식만 남긴다(초기 권한 안내와 겹치지 않게 안내 창 없음).
 *  · 기존 사용자(그 외): 이 기능이 든 버전에 처음 들어올 때 한 번만 V2 로 바꾸고 안내 창(확인 / 클래식으로 되돌리기)을 띄운다.
 *    이미 V2 를 쓰고 있었으면 표식만 남기고 안내하지 않는다.
 *  · 표식 `config.mobileV2IntroDone` 이 있으면 어떤 경로로도 다시 하지 않는다(이후 업데이트에 재노출 없음).
 *  · PC 는 해당 없음. 첫 전환 규칙(환경설정과 동일)으로 프리셋 하단 아이콘 행도 켠다.
 * 순수 판단은 planMobileV2Default, 실제 적용은 applyMobileV2Default(bootstrap 1.7 단계).
 */
export const MOBILE_V2_TEMPLATE_ID = 'mobile-v2';

export type StorageDetectKind = 'fresh' | 'none' | 'legacy' | 'unknown';

export interface MobileV2DefaultInput {
  uiLayoutTemplate?: string;
  uiPresetIconRow?: boolean;
  mobileV2IntroDone?: boolean;
}

export interface MobileV2DefaultPlan {
  patch: Partial<MobileV2DefaultInput>;
  showIntro: boolean;
}

export function planMobileV2Default(
  config: MobileV2DefaultInput,
  detect: StorageDetectKind,
  mobile: boolean,
): MobileV2DefaultPlan {
  if (!mobile) return { patch: {}, showIntro: false };
  if (config.mobileV2IntroDone) return { patch: {}, showIntro: false };
  const alreadyV2 = config.uiLayoutTemplate === MOBILE_V2_TEMPLATE_ID;
  const patch: Partial<MobileV2DefaultInput> = { mobileV2IntroDone: true };
  if (!alreadyV2) {
    patch.uiLayoutTemplate = MOBILE_V2_TEMPLATE_ID;
    patch.uiPresetIconRow = true;
  }
  // 새 설치는 안내 없이 V2 시작. 기존 사용자는 실제로 배치가 바뀔 때만 안내.
  const showIntro = detect !== 'fresh' && !alreadyV2;
  return { patch, showIntro };
}

export async function applyMobileV2Default(detect: StorageDetectKind): Promise<void> {
  const config = await backend.getConfig();
  const plan = planMobileV2Default(config, detect, isMobile);
  if (Object.keys(plan.patch).length === 0) return;
  Object.assign(config, plan.patch);
  await backend.setConfig(config);
  if (plan.patch.uiLayoutTemplate) appState.uiLayoutTemplate = plan.patch.uiLayoutTemplate;
  if (plan.patch.uiPresetIconRow !== undefined) appState.uiPresetIconRow = plan.patch.uiPresetIconRow;
  if (plan.showIntro) appState.mobileV2IntroPending = true;
}

/** 안내 창의 「클래식으로 되돌리기」 — 템플릿만 되돌린다(아이콘 행 등 다른 값은 사용자 값 존중). */
export async function revertMobileV2ToClassic(): Promise<void> {
  const config = await backend.getConfig();
  config.uiLayoutTemplate = 'classic';
  await backend.setConfig(config);
  appState.uiLayoutTemplate = 'classic';
}

export const MOBILE_V2_INTRO_TEXT =
  '이번 업데이트부터 모바일 기본 배치가 「모바일 V2」로 바뀌었습니다.\n' +
  '프롬프트는 화면 아래 시트에서 열고, 생성 바·메인 줄·이미지 그리드와 상세의 버튼도 아래쪽에 놓입니다.\n' +
  '환경설정 → 레이아웃에서 언제든 클래식으로 돌아가거나, 부위별로 켜고 끌 수 있습니다.';
