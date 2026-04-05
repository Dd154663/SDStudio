import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { ImportableMetadata, VibeItem, ReferenceItem } from '../models/types';
import { base64ToDataUri } from './BrushTool';
import { PromptHighlighter } from './SceneEditor';
import { extractPromptDataFromBase64 } from '../models/util';
import { appState } from '../models/AppService';
import { imageService, workFlowService } from '../models';
import { Sampling } from '../backends/imageGen';
import { runInAction } from 'mobx';
import { FaTimes } from 'react-icons/fa';
import { v4 } from 'uuid';

interface ImportOptions {
  prompt: boolean;
  uc: boolean;
  characters: boolean;
  charactersAppend: boolean;
  vibes: boolean;
  vibesAppend: boolean;
  settings: boolean;
  seed: boolean;
  resolution: boolean;
}

interface ExternalImageViewProps {
  image: string;
  onClose: () => void;
}

export const ExternalImageView = observer(
  ({ image, onClose }: ExternalImageViewProps) => {
    const [job, setJob] = useState<ImportableMetadata | undefined>(undefined);
    const [target, setTarget] = useState<string>('new-normal');
    const [importing, setImporting] = useState(false);
    const [options, setOptions] = useState<ImportOptions>({
      prompt: true,
      uc: true,
      characters: true,
      charactersAppend: false,
      vibes: true,
      vibesAppend: false,
      settings: true,
      seed: true,
      resolution: true,
    });

    useEffect(() => {
      (async () => {
        if (!image) return;
        const newJob = await extractPromptDataFromBase64(image);
        if (!newJob) return;
        newJob.prompt = newJob.prompt ?? '';
        newJob.uc = newJob.uc ?? '';
        newJob.characterPrompts = newJob.characterPrompts ?? [];
        setJob(newJob);
        setOptions((prev) => ({
          ...prev,
          characters: (newJob.characterPrompts?.length ?? 0) > 0,
          vibes: (newJob.vibes?.length ?? 0) > 0,
          resolution: !!newJob.resolution,
        }));
      })();
    }, [image]);

    const setOpt = (key: keyof ImportOptions, value: boolean) => {
      setOptions((prev) => ({ ...prev, [key]: value }));
    };

    const hasCharacters = (job?.characterPrompts?.length ?? 0) > 0;
    const hasVibes = (job?.vibes?.length ?? 0) > 0;
    const hasVibeImages = (job?.vibeImageData?.length ?? 0) > 0;
    const hasRefImages = (job?.referenceImageData?.length ?? 0) > 0;
    const hasCharRefs = (job?.characterReferences?.length ?? 0) > 0;
    const hasResolution = !!job?.resolution;

    const applyImport = async () => {
      if (!job || !appState.curSession) return;
      setImporting(true);

      try {
        const session = appState.curSession;
        const isNew = target.startsWith('new-');
        let presetType = target === 'new-easy' ? 'SDImageGenEasy' : 'SDImageGen';

        let preset: any;
        if (isNew) {
          preset = workFlowService.buildPreset(presetType);
          preset.name = 'external image';
        } else if (target === 'current') {
          const wf = session.selectedWorkflow;
          if (!wf) { setImporting(false); return; }
          presetType = wf.workflowType;
          const presets = session.presets.get(presetType);
          preset = presets?.find((p: any) => p.name === wf.presetName);
          if (!preset) { setImporting(false); return; }
        }

        runInAction(() => {
          if (options.prompt) {
            preset.frontPrompt = job.prompt ?? '';
            if (isNew) preset.backPrompt = '';
          }
          if (options.uc) {
            preset.uc = job.uc ?? '';
          }
          if (options.characters && hasCharacters) {
            if (options.charactersAppend && !isNew) {
              preset.characterPrompts = [
                ...(preset.characterPrompts || []),
                ...job.characterPrompts.map((cp, i) => ({
                  ...cp,
                  id: `imported_${Date.now()}_${i}`,
                })),
              ];
            } else {
              preset.characterPrompts = job.characterPrompts ?? [];
            }
          }
          if (options.settings) {
            preset.sampling = job.sampling ?? Sampling.KEulerAncestral;
            preset.steps = job.steps ?? 28;
            preset.noiseSchedule = job.noiseSchedule ?? 'karras';
            preset.promptGuidance = job.promptGuidance ?? 5;
            preset.cfgRescale = job.cfgRescale ?? 0;
            preset.useCoords = job.useCoords ?? false;
            preset.varietyPlus = job.varietyPlus ?? false;
            preset.legacyPromptConditioning = job.legacyPromptConditioning ?? false;
          }
        });

        // 시드는 presetShared에 저장
        if (options.seed && job.seed != null) {
          let shared = session.presetShareds.get(presetType);
          if (!shared) {
            shared = workFlowService.buildShared(presetType);
            session.presetShareds.set(presetType, shared);
          }
          runInAction(() => {
            shared.seed = job.seed;
          });
        }

        if (options.vibes && hasVibes) {
          let shared = session.presetShareds.get(presetType);
          if (!shared) {
            shared = workFlowService.buildShared(presetType);
            session.presetShareds.set(presetType, shared);
          }
          const newVibes: VibeItem[] = [];
          for (let i = 0; i < job.vibes.length; i++) {
            const vibe = job.vibes[i];
            // 더미 파일명 생성 (인코딩된 데이터의 키로 사용)
            const dummyName = v4() + '.png';
            if (job.vibeImageData?.[i]) {
              // 메타데이터의 바이브 데이터는 이미 인코딩된 상태
              // storeVibeImage (raw 이미지 저장) 대신 storeEncodedVibeImage로 직접 저장
              await imageService.storeEncodedVibeImage(
                session, dummyName, job.vibeImageData[i], vibe.info,
              );
            }
            const item = new VibeItem();
            item.path = dummyName;
            item.strength = vibe.strength;
            item.info = vibe.info;
            newVibes.push(item);
          }
          runInAction(() => {
            if (options.vibesAppend && !isNew) {
              shared.vibes = [...(shared.vibes || []), ...newVibes];
            } else {
              shared.vibes = newVibes;
            }
            shared.normalizeStrength = job.normalizeStrength ?? true;
          });
        }

        if (hasCharRefs) {
          let shared = session.presetShareds.get(presetType);
          if (!shared) {
            shared = workFlowService.buildShared(presetType);
            session.presetShareds.set(presetType, shared);
          }
          const newRefs: ReferenceItem[] = [];
          for (let i = 0; i < job.characterReferences.length; i++) {
            const ref = job.characterReferences[i];
            let path = '';
            if (job.referenceImageData?.[i]) {
              path = await imageService.storeReferenceImage(session, job.referenceImageData[i]);
            }
            const item = new ReferenceItem();
            item.path = path;
            item.strength = ref.strength;
            item.fidelity = ref.fidelity;
            item.info = ref.info;
            item.referenceType = ref.referenceType;
            item.enabled = true;
            newRefs.push(item);
          }
          runInAction(() => {
            shared.characterReferences = newRefs;
          });
        }

        if (isNew) {
          session.addPreset(preset);
          session.selectedWorkflow = {
            workflowType: preset.type,
            presetName: preset.name,
          };
        }
        onClose();
      } finally {
        setImporting(false);
      }
    };

    const CheckboxRow = ({
      label,
      checked,
      onChange,
      disabled,
      children,
      right,
    }: {
      label: string;
      checked: boolean;
      onChange: (v: boolean) => void;
      disabled?: boolean;
      children?: React.ReactNode;
      right?: React.ReactNode;
    }) => (
      <div className={'mb-2.5 rounded-lg border border-gray-200 dark:border-slate-600 p-3' + (disabled ? ' opacity-40' : '')}>
        <div className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="w-4 h-4 accent-sky-500 flex-none"
          />
          <span className="font-semibold text-sm text-gray-800 dark:text-gray-100 flex-1">{label}</span>
          {right}
        </div>
        {checked && !disabled && children && (
          <div className="mt-2">{children}</div>
        )}
      </div>
    );

    return (
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
        onClick={onClose}
      >
        <div
          className="w-[95vw] max-w-5xl max-h-[90vh] bg-white dark:bg-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-slate-600"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-slate-600 flex-none">
            <div>
              <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">메타데이터 불러오기</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                이미지에서 생성 설정을 추출하여 프리셋에 적용합니다.
              </p>
            </div>
            <button
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-500 dark:text-gray-400 transition-colors"
              onClick={onClose}
            >
              <FaTimes size={16} />
            </button>
          </div>

          {/* 본문 */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden" style={{ minHeight: 0 }}>
            {/* 왼쪽: 설정 패널 */}
            <div className="flex-1 overflow-y-auto p-4 md:p-5">
              {!job && (
                <div className="text-gray-500 dark:text-gray-400 text-sm py-8 text-center">
                  메타데이터를 추출하는 중...
                </div>
              )}

              {job && (
                <>
                  {/* 적용 대상 */}
                  <div className="mb-4">
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">적용할 프리셋</label>
                    <select
                      className="gray-input text-sm py-1.5 px-2 w-full"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="new-normal">새 일반 사전설정</option>
                      <option value="new-easy">새 이지모드 사전설정</option>
                      {appState.curSession?.selectedWorkflow && (
                        <option value="current">현재 사전설정에 적용</option>
                      )}
                    </select>
                  </div>

                  {/* 프롬프트 */}
                  <CheckboxRow
                    label="프롬프트"
                    checked={options.prompt}
                    onChange={(v) => setOpt('prompt', v)}
                  >
                    <PromptHighlighter
                      text={job.prompt}
                      className="w-full max-h-28 overflow-auto text-sm p-2 rounded"
                    />
                  </CheckboxRow>

                  {/* 네거티브 */}
                  <CheckboxRow
                    label="네거티브 프롬프트"
                    checked={options.uc}
                    onChange={(v) => setOpt('uc', v)}
                  >
                    <PromptHighlighter
                      text={job.uc}
                      className="w-full max-h-28 overflow-auto text-sm p-2 rounded"
                    />
                  </CheckboxRow>

                  {/* 캐릭터 프롬프트 */}
                  <CheckboxRow
                    label="캐릭터 프롬프트"
                    checked={options.characters}
                    onChange={(v) => setOpt('characters', v)}
                    disabled={!hasCharacters}
                    right={
                      hasCharacters && options.characters && !target.startsWith('new-') ? (
                        <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <input
                            type="checkbox"
                            checked={options.charactersAppend}
                            onChange={(e) => setOpt('charactersAppend', e.target.checked)}
                            className="w-3.5 h-3.5 accent-sky-500"
                          />
                          추가 모드
                        </label>
                      ) : undefined
                    }
                  >
                    {job.characterPrompts.map((cp) => (
                      <div key={cp.id} className="mb-2 p-2.5 bg-gray-100 dark:bg-slate-700 rounded-lg text-sm">
                        <div className="text-gray-500 dark:text-gray-400 text-xs mb-1">
                          Pos: ({cp.position?.[0]?.toFixed(2) ?? '-'}, {cp.position?.[1]?.toFixed(2) ?? '-'})
                        </div>
                        <div className="text-gray-800 dark:text-gray-200 break-words">{cp.prompt}</div>
                        {cp.uc && (
                          <div className="text-gray-500 dark:text-gray-400 mt-1 break-words text-xs">UC: {cp.uc}</div>
                        )}
                      </div>
                    ))}
                  </CheckboxRow>

                  {/* 바이브 트랜스퍼 */}
                  <CheckboxRow
                    label={`바이브 트랜스퍼${hasVibes ? ` (${job.vibes.length}개)` : ''}`}
                    checked={options.vibes}
                    onChange={(v) => setOpt('vibes', v)}
                    disabled={!hasVibes}
                    right={
                      hasVibes && options.vibes && !target.startsWith('new-') ? (
                        <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <input
                            type="checkbox"
                            checked={options.vibesAppend}
                            onChange={(e) => setOpt('vibesAppend', e.target.checked)}
                            className="w-3.5 h-3.5 accent-sky-500"
                          />
                          추가 모드
                        </label>
                      ) : undefined
                    }
                  >
                    {hasVibeImages ? (
                      <div className="flex gap-2 flex-wrap">
                        {job.vibeImageData!.map((img, i) => (
                          <div key={i} className="text-center">
                            <img
                              src={`data:image/png;base64,${img}`}
                              className="w-16 h-16 object-cover rounded-md border border-gray-200 dark:border-slate-600"
                            />
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              S:{job.vibes[i]?.strength?.toFixed(2)} I:{job.vibes[i]?.info?.toFixed(2)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : hasVibes ? (
                      <div className="text-sm text-gray-600 dark:text-gray-300">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                          원본 이미지는 없지만, 인코딩된 바이브 데이터를 복원합니다.
                        </p>
                        {job.vibes.map((v, i) => (
                          <div key={i} className="flex items-center gap-3 py-1.5 px-2.5 bg-gray-100 dark:bg-slate-700 rounded-lg mb-1.5">
                            <div className="w-10 h-10 rounded bg-gray-300 dark:bg-slate-600 flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 flex-none">
                              데이터
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-300">
                              <div>강도 (RS): {v.strength?.toFixed(2)}</div>
                              <div>정보 (IS): {v.info?.toFixed(2)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </CheckboxRow>

                  {/* 캐릭터 레퍼런스 */}
                  {hasCharRefs && (
                    <div className="mb-2.5 rounded-lg border border-gray-200 dark:border-slate-600 p-3">
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">
                          캐릭터 레퍼런스 ({job.characterReferences.length}개)
                        </span>
                      </div>
                      <div className="mt-2">
                        {hasRefImages ? (
                          <div className="flex gap-2 flex-wrap">
                            {job.referenceImageData!.map((img, i) => (
                              <div key={i} className="text-center">
                                <img
                                  src={`data:image/png;base64,${img}`}
                                  className="w-16 h-16 object-cover rounded-md border border-gray-200 dark:border-slate-600"
                                />
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                  S:{job.characterReferences[i]?.strength?.toFixed(2)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            원본 이미지는 없지만, 인코딩된 레퍼런스 데이터를 복원합니다.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 파라미터 */}
                  <CheckboxRow
                    label="파라미터"
                    checked={options.settings}
                    onChange={(v) => setOpt('settings', v)}
                  >
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      <div><span className="text-gray-500 dark:text-gray-400">Steps:</span> <span className="text-gray-800 dark:text-gray-200">{job.steps}</span></div>
                      <div><span className="text-gray-500 dark:text-gray-400">CFG:</span> <span className="text-gray-800 dark:text-gray-200">{job.promptGuidance}</span></div>
                      <div><span className="text-gray-500 dark:text-gray-400">Rescale:</span> <span className="text-gray-800 dark:text-gray-200">{job.cfgRescale}</span></div>
                      <div><span className="text-gray-500 dark:text-gray-400">Sampler:</span> <span className="text-gray-800 dark:text-gray-200">{job.sampling}</span></div>
                      <div><span className="text-gray-500 dark:text-gray-400">Noise:</span> <span className="text-gray-800 dark:text-gray-200">{job.noiseSchedule}</span></div>
                      <div><span className="text-gray-500 dark:text-gray-400">Variety+:</span> <span className="text-gray-800 dark:text-gray-200">{job.varietyPlus ? 'ON' : 'OFF'}</span></div>
                      <div><span className="text-gray-500 dark:text-gray-400">Coords:</span> <span className="text-gray-800 dark:text-gray-200">{job.useCoords ? 'ON' : 'OFF'}</span></div>
                      <div><span className="text-gray-500 dark:text-gray-400">Legacy UC:</span> <span className="text-gray-800 dark:text-gray-200">{job.legacyPromptConditioning ? 'ON' : 'OFF'}</span></div>
                    </div>
                  </CheckboxRow>

                  {/* 시드 */}
                  <CheckboxRow
                    label={`시드${job.seed != null ? ': ' + job.seed : ''}`}
                    checked={options.seed}
                    onChange={(v) => setOpt('seed', v)}
                    disabled={job.seed == null}
                  />

                  {/* 해상도 */}
                  <CheckboxRow
                    label={`해상도${hasResolution ? `: ${job.resolution!.width} × ${job.resolution!.height}` : ''}`}
                    checked={options.resolution}
                    onChange={(v) => setOpt('resolution', v)}
                    disabled={!hasResolution}
                  />
                </>
              )}
            </div>

            {/* 오른쪽: 이미지 프리뷰 */}
            <div className="hidden md:flex flex-none w-72 lg:w-80 border-l border-gray-200 dark:border-slate-600 items-center justify-center bg-gray-50 dark:bg-slate-900 p-3">
              {image && (
                <img
                  src={base64ToDataUri(image)}
                  draggable={false}
                  className="max-w-full max-h-full object-contain rounded-lg"
                />
              )}
            </div>
          </div>

          {/* 하단 버튼 */}
          <div className="flex-none p-4 border-t border-gray-200 dark:border-slate-600">
            <button
              className="w-full back-sky py-2.5 rounded-lg hover:brightness-95 active:brightness-90 font-medium"
              onClick={applyImport}
              disabled={importing || !job}
            >
              {importing ? '적용 중...' : '적용'}
            </button>
          </div>
        </div>
      </div>
    );
  },
);
