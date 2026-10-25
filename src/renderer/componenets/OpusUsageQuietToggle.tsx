import React, { useEffect, useState } from 'react';
import { opusUsageService } from '../models';
import { appState } from '../models/AppService';
import { OPUS_USAGE_TEXT } from '../models/opusUsageRules';

/**
 * 「할당량 경고 하지 않음」 토글(2026-10-25) — 환경설정 → 로그인 탭과 할당량 상세 창 양쪽에 같은 컴포넌트를 쓴다.
 * 값은 config `opusUsageQuiet` 하나이며 바꾸는 즉시 저장한다(환경설정의 「저장」 버튼과 무관 — 저장은 매번
 * 최신 config 를 읽어 합치므로 덮어쓰지 않는다). OpusUsageService 의 change 이벤트로 두 곳이 같은 값을 보인다.
 */
export default function OpusUsageQuietToggle({ id }: { id: string }) {
  const [, redraw] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onChange = () => redraw((n) => n + 1);
    opusUsageService.addEventListener('change', onChange);
    if (!opusUsageService.quietLoaded) {
      opusUsageService.loadQuiet().catch(() => {});
    }
    return () => opusUsageService.removeEventListener('change', onChange);
  }, []);

  const change = async (checked: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await opusUsageService.setQuiet(checked);
    } catch (e: any) {
      appState.pushMessage(
        `설정을 저장하지 못했습니다: ${e?.message || '알 수 없는 오류'}`,
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 flex-none"
        checked={opusUsageService.quiet}
        disabled={busy || !opusUsageService.quietLoaded}
        onChange={(e) => void change(e.target.checked)}
      />
      <label htmlFor={id} className="min-w-0 text-xs">
        <span className="font-medium text-default">{OPUS_USAGE_TEXT.quietLabel}</span>
        <span className="block text-muted leading-relaxed">
          {OPUS_USAGE_TEXT.quietDescription}
        </span>
      </label>
    </div>
  );
}
