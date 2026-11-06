import React, { useEffect, useState } from 'react';
import { backend, sessionService } from '../models';
import { appState } from '../models/AppService';
import { ModelVersion } from '../backends/imageGen';
import {
  MODEL_FAMILY_LABEL,
  MODEL_FAMILY_NAME,
  MODEL_SAMPLING_FAMILIES,
  modelVersionForSamplingFamily,
  nextModelFamily,
  samplingFamilyForModel,
  switchSessionSamplingFamily,
  type ModelSamplingFamily,
} from '../models/modelSamplingProfiles';
import { normalizeModelVersion } from '../backends/genVendors/naiModelCapabilities';

/**
 * NAI 모델 계열(v4.5 / v5 / v5 medium) 퀵 전환 — 2026-11-06 V5M(Medium Effort) 칸 추가로 3택(세그먼트 세 칸, 토글은 4.5→5→V5M 순환) — PC 상단 바(TobBar)와 모바일 V2 프롬프트 시트 손잡이 줄이 같은 부품을 쓴다(2026-09-26).
 * 값은 config.modelVersion 의 계열. 전환 = 현재 세션의 샘플링 프로필 교체 + config 저장 + config-changed 알림(예전 TobBar 로직 그대로).
 * compact: 모바일용(높이 28px·칸 최소 34px, .touch-hit 로 판정 36px).
 * variant 'toggle': 현재 계열만 적힌 버튼 하나(탭하면 다른 계열로). 클래식 모바일 상단 1줄째 우상단용 —
 *   세그먼트(70px)를 두면 프로젝트 선택이 360 폭에서 약 122px 로 줄어 단일 토글(36px)로 절충(2026-09-26 사용자 결정).
 */
const FAMILIES = MODEL_SAMPLING_FAMILIES;
const FAMILY_LABEL = MODEL_FAMILY_LABEL;
const FAMILY_NAME = MODEL_FAMILY_NAME;

export function useModelFamilySwitch() {
  const [modelVersion, setModelVersion] = useState<ModelVersion>(ModelVersion.V4_5);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      backend
        .getConfig()
        .then((config) => {
          if (!cancelled) setModelVersion(normalizeModelVersion(config.modelVersion));
        })
        .catch(() => {});
    };
    load();
    sessionService.addEventListener('config-changed', load);
    return () => {
      cancelled = true;
      sessionService.removeEventListener('config-changed', load);
    };
  }, []);

  const family = samplingFamilyForModel(modelVersion);
  const switchFamily = async (next: ModelSamplingFamily) => {
    if (switching || family === next) return;
    const previousFamily = family;
    const nextVersion = modelVersionForSamplingFamily(next, modelVersion);
    setSwitching(true);
    try {
      switchSessionSamplingFamily(appState.curSession, next);
      const config = await backend.getConfig();
      await backend.setConfig({ ...config, modelVersion: nextVersion });
      setModelVersion(nextVersion);
      sessionService.configChanged();
    } catch (e) {
      if (previousFamily) switchSessionSamplingFamily(appState.curSession, previousFamily);
      appState.pushMessage('모델 전환에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setSwitching(false);
    }
  };
  return { family, switching, switchFamily };
}

export default function ModelFamilySwitch({
  compact,
  className,
  variant = 'segment',
}: {
  compact?: boolean;
  className?: string;
  variant?: 'segment' | 'toggle';
}) {
  const { family, switching, switchFamily } = useModelFamilySwitch();
  if (variant === 'toggle') {
    const cur = family ?? 'v4_5';
    const next = nextModelFamily(cur);
    return (
      <button
        type="button"
        data-model-family-switch="toggle"
        className={
          'btn touch-hit relative h-7 min-w-[36px] px-2 rounded-md border line-color bg-[var(--c-input-bg)] text-sm font-semibold text-default' +
          (className ? ' ' + className : '')
        }
        aria-label={`NAI 모델 전환: 현재 ${FAMILY_NAME[cur]}, 탭하면 ${FAMILY_NAME[next]}`}
        title={`NAI 모델 ${FAMILY_NAME[cur]} → ${FAMILY_NAME[next]}`}
        disabled={switching}
        onClick={() => void switchFamily(next)}
      >
        {FAMILY_LABEL[cur]}
      </button>
    );
  }
  const btn = compact
    ? 'btn touch-hit relative h-7 min-w-[34px] rounded-none px-2 text-sm'
    : 'btn h-9 min-w-[48px] rounded-none px-3 text-base';
  return (
    <div
      className={
        'flex items-center overflow-hidden rounded-md border line-color bg-[var(--c-input-bg)]' +
        (className ? ' ' + className : '')
      }
      role="group"
      aria-label="NAI 모델 퀵 전환"
      data-model-family-switch={compact ? 'compact' : 'full'}
    >
      {FAMILIES.map((f) => {
        const selected = family === f;
        return (
          <button
            key={f}
            type="button"
            className={`${btn} ${selected ? 'back-sky' : 'btn-ghost text-default'}`}
            aria-pressed={selected}
            aria-label={`NAI 모델 ${FAMILY_NAME[f]}`}
            disabled={switching}
            onClick={() => void switchFamily(f)}
          >
            {FAMILY_LABEL[f]}
          </button>
        );
      })}
    </div>
  );
}
