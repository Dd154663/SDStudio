import * as React from 'react';
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FaTimes } from 'react-icons/fa';
import { appState } from '../models/AppService';
import { Sampling, NoiseSchedule } from '../backends/imageGen';
import PromptEditTextArea from './PromptEditTextArea';
import { FileUploadBase64 } from './UtilComponents';

// 스타일 프리셋 편집 모달 — 이름/대표이미지/프롬프트/샘플링 설정 수정.
// GlobalPresetTab 의 편집 모달을 어댑터 기반으로 추출한 단일 출처:
// 글로벌 프리셋과 템플릿 관리(프로젝트 상속 v2)가 공유한다.
// 저장/이미지 조회만 어댑터로 위임하므로 저장소가 달라도 동일 UI.

export interface PresetEditAdapter {
  // 현재 대표 이미지 (data URI, 없으면 null)
  fetchProfile: () => Promise<string | null>;
  // 저장 — name(트림됨)+프리셋 패치+새 대표 이미지(raw base64, 미변경 시 null).
  // 이름 충돌 등 실패는 throw (메시지 토스트는 호출측 공통 처리).
  save: (
    name: string,
    patch: Record<string, any>,
    newRepImage: string | null,
  ) => Promise<void>;
}

// 어댑터 기반 대표 이미지 미리보기
const AdapterProfileImage = ({
  adapter,
  className,
}: {
  adapter: PresetEditAdapter;
  className: string;
}) => {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    adapter
      .fetchProfile()
      .then((d) => {
        if (alive) setImage(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [adapter]);
  if (!image)
    return (
      <div
        className={
          className + ' flex items-center justify-center text-xs text-faint'
        }
      >
        없음
      </div>
    );
  return <img src={image} className={className} draggable={false} />;
};

export const PresetEditModal = observer(
  ({
    title,
    initialName,
    preset,
    adapter,
    onClose,
  }: {
    title: string;
    initialName: string;
    preset: any; // frontPrompt/backPrompt/uc/샘플링 필드를 읽는 프리셋 JSON
    adapter: PresetEditAdapter;
    onClose: () => void;
  }) => {
    const p: any = preset || {};
    const asStr = (v: any) => (typeof v === 'string' ? v : '');
    const [name, setName] = useState(initialName);
    const [frontPrompt, setFrontPrompt] = useState(asStr(p.frontPrompt));
    const [backPrompt, setBackPrompt] = useState(asStr(p.backPrompt));
    const [uc, setUc] = useState(asStr(p.uc));
    const [steps, setSteps] = useState<number>(
      typeof p.steps === 'number' ? p.steps : 28,
    );
    const [promptGuidance, setPromptGuidance] = useState<number>(
      typeof p.promptGuidance === 'number' ? p.promptGuidance : 5,
    );
    const [cfgRescale, setCfgRescale] = useState<number>(
      typeof p.cfgRescale === 'number' ? p.cfgRescale : 0,
    );
    const [sampling, setSampling] = useState<string>(
      p.sampling ?? Sampling.KEulerAncestral,
    );
    const [noiseSchedule, setNoiseSchedule] = useState<string>(
      p.noiseSchedule ?? NoiseSchedule.Karras,
    );
    const [newRepImage, setNewRepImage] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const save = async () => {
      if (saving) return;
      const nm = name.trim();
      if (!nm) {
        appState.pushMessage('이름을 입력해 주세요');
        return;
      }
      setSaving(true);
      try {
        await adapter.save(
          nm,
          {
            frontPrompt,
            backPrompt,
            uc,
            steps,
            promptGuidance,
            cfgRescale,
            sampling,
            noiseSchedule,
          },
          newRepImage,
        );
        appState.pushMessage('저장되었습니다.');
        onClose();
      } catch (e: any) {
        appState.pushMessage(e.message || '저장 실패');
      } finally {
        setSaving(false);
      }
    };

    const numCls =
      'mt-1 w-full px-2 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default';

    return (
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[var(--z-modal)]"
        onClick={onClose}
      >
        <div
          className="bg-[var(--c-zone)] rounded-lg r-modal p-5 max-w-2xl w-11/12 max-h-[88vh] flex flex-col shadow-2xl text-default"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3 flex-none">
            <h2 className="text-lg font-bold">{title}</h2>
            <button className="icon-button p-2 text-default" onClick={onClose}>
              <FaTimes size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-auto pr-1 flex flex-col gap-4">
            {/* 이름 */}
            <div>
              <label className="text-sm font-medium mb-1 block">이름 *</label>
              <input
                className="w-full px-3 py-2 rounded-lg border line-color bg-[var(--c-input-bg)] text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 text-default"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {/* 대표 이미지 */}
            <div className="p-3 border line-color rounded-lg">
              <div className="text-sm font-medium mb-2">대표 이미지</div>
              <div className="flex items-center gap-3">
                <AdapterProfileImage
                  adapter={adapter}
                  className="w-20 h-28 object-cover rounded-lg flex-none border line-color"
                />
                <div className="flex flex-col gap-1.5">
                  <div className="w-40">
                    <FileUploadBase64
                      notext
                      onFileSelect={(b) => setNewRepImage(b)}
                    />
                  </div>
                  {newRepImage && (
                    <span className="text-xs text-green-600 dark:text-green-400">
                      새 이미지 선택됨 (저장 시 적용)
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* 프롬프트 */}
            <div>
              <div className="text-sm font-medium mb-1">상위 프롬프트</div>
              <PromptEditTextArea
                value={frontPrompt}
                onChange={setFrontPrompt}
                disabled={false}
              />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">하위 프롬프트</div>
              <PromptEditTextArea
                value={backPrompt}
                onChange={setBackPrompt}
                disabled={false}
              />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">네거티브 프롬프트</div>
              <PromptEditTextArea value={uc} onChange={setUc} disabled={false} />
            </div>
            {/* 샘플링 설정 */}
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                스탭 수
                <input
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={steps}
                  onChange={(e) => setSteps(Number(e.target.value))}
                  className={numCls}
                />
              </label>
              <label className="text-sm">
                프롬프트 가이던스
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={promptGuidance}
                  onChange={(e) => setPromptGuidance(Number(e.target.value))}
                  className={numCls}
                />
              </label>
              <label className="text-sm">
                CFG 리스케일
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={cfgRescale}
                  onChange={(e) => setCfgRescale(Number(e.target.value))}
                  className={numCls}
                />
              </label>
              <label className="text-sm">
                샘플링
                <select
                  value={sampling}
                  onChange={(e) => setSampling(e.target.value)}
                  className={numCls}
                >
                  {Object.values(Sampling).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                노이즈 스케줄
                <select
                  value={noiseSchedule}
                  onChange={(e) => setNoiseSchedule(e.target.value)}
                  className={numCls}
                >
                  {Object.values(NoiseSchedule).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4 flex-none">
            <button className="round-button back-gray px-4 py-2" onClick={onClose}>
              취소
            </button>
            <button
              className="round-button back-sky px-4 py-2"
              onClick={save}
              disabled={saving}
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    );
  },
);
