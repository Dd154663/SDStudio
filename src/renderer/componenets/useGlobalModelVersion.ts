import { useEffect, useState } from 'react';
import { backend, sessionService } from '../models';
import { ModelVersion } from '../backends/imageGen';
import { normalizeModelVersion } from '../backends/genVendors/naiModelCapabilities';

/**
 * 전역 생성 모델(config.modelVersion) — PreSetEdtior 의 편집기 문맥 공급과 같은 방식(backend.getConfig() +
 * `config-changed` 구독). 읽기 전에는 V4.5(종전 기본). 편집기 문맥(WFElementContext)이 없는 창(캐릭터 프리셋 편집기)용.
 */
export function useGlobalModelVersion(): ModelVersion {
  const [modelVersion, setModelVersion] = useState<ModelVersion>(ModelVersion.V4_5);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const config = await backend.getConfig();
        if (alive) setModelVersion(normalizeModelVersion(config.modelVersion));
      } catch {
        // 설정을 못 읽으면 기본(V4.5) 규칙 그대로
      }
    };
    void load();
    sessionService.addEventListener('config-changed', load);
    return () => {
      alive = false;
      sessionService.removeEventListener('config-changed', load);
    };
  }, []);
  return modelVersion;
}
