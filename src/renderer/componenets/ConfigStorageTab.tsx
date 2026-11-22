// 설정 화면 탭: 저장경로(key 'storage', 라벨 「저장경로」, PC) + 복구(key 'recovery', 라벨 「복구」, 모바일) — StorageImageTab(ImageEditTab·StorageTab)·RecoveryTab
import {
  backend,
  localAIService,
} from '../models';
import { platform } from '../models/platform';
import { appState } from '../models/AppService';
import { StorageDiagnosticsSection } from './StorageDiagnostics';
import { observer } from 'mobx-react-lite';
import { SAVE_LOCATION_CHANGE_TEXT } from '../../shared/saveLocationChange';
import { SaveLocationRestartButton } from './SaveLocationPendingBar';
import { DownloadSettingsSection } from './DownloadSettingsSection';
import { SettingCheckRow, SettingField, SettingGroup } from './SettingControls';

/* 「사용자 지정」 이미지 편집기(Windows 전용, 2026-11-22) — 문구·화면 값 해석 단일 출처(ConfigScreen 이 load·dirty 에 쓴다). */
export const CUSTOM_IMAGE_EDITOR_TEXT = {
  option: '사용자 지정',
  pathMissing: '이미지 편집기의 실행 파일(.exe)을 선택해 주세요.',
  pickButton: '실행 파일 선택',
  pickerFilterName: '실행 파일',
};

// 저장값 → 화면에 보일 선택지. 'custom' 인데 지원하지 않는 플랫폼(mac·linux·모바일)이면 기본값(포토샵)으로 보인다.
export function resolveImageEditorChoice(
  value: string | undefined,
  supportsCustom: boolean = platform.supportsCustomImageEditor,
): string {
  const v = value ?? 'photoshop';
  if (v === 'custom' && !supportsCustom) return 'photoshop';
  return v;
}

/* ── 탭 2: 이미지 편집 및 배경 제거 ── */
// 묶음 상자(2026-11-20 UI 정돈 그룹 1-a): 선호 이미지 편집기 / 배경 제거. 체크 = SettingCheckRow(「저장」 반영),
// 선택 칸 = .app-select(종전 기본 모양은 다크에서 흰 바탕). 항목·순서·문구·id 그대로.
// 「사용자 지정」(2026-11-22, Windows 전용): 고르면 아래에 지금 경로(없으면 안내)와 「실행 파일 선택」 버튼.
const ImageEditTab = ({
  imageEditor, setImageEditor,
  customImageEditorPath, selectCustomImageEditor,
  useLocalBgRemoval, setUseLocalBgRemoval,
  ready, stage, progress, stageTexts,
  useGPU, setUseGPU, quality, setQuality,
}: any) => (
  <div className="space-y-4">
    <SettingGroup title="선호 이미지 편집기">
     <SettingField>
      <select className="app-select block w-full sm:text-sm" aria-label="선호 이미지 편집기"
        value={imageEditor} onChange={(e) => setImageEditor(e.target.value)}>
        <option value="photoshop">포토샵</option>
        <option value="gimp">GIMP</option>
        <option value="mspaint">그림판</option>
        {platform.supportsCustomImageEditor && (
          <option value="custom">{CUSTOM_IMAGE_EDITOR_TEXT.option}</option>
        )}
      </select>
      {platform.isLinux && (
        <p className="text-xs text-muted mt-1">
          리눅스에서는 GIMP만 지원됩니다 (PATH 의 gimp 실행).
        </p>
      )}
     </SettingField>
     {platform.supportsCustomImageEditor && imageEditor === 'custom' && (
      <SettingField>
       <div data-custom-image-editor-path
         className="text-sm text-muted bg-gray-100 dark:bg-slate-700 rounded px-3 py-2 break-all">
         {customImageEditorPath || CUSTOM_IMAGE_EDITOR_TEXT.pathMissing}
       </div>
       <button type="button" className="btn w-full back-green py-2 rounded mt-2"
         onClick={selectCustomImageEditor}>
         {CUSTOM_IMAGE_EDITOR_TEXT.pickButton}
       </button>
      </SettingField>
     )}
    </SettingGroup>
    <SettingGroup title="배경 제거">
      <SettingCheckRow
        id="cfgLocalBg"
        checked={useLocalBgRemoval}
        disabled={!platform.supportsRemoveBg}
        onChange={setUseLocalBgRemoval}
        label="로컬 배경 제거 모델 사용"
        description={
          !platform.supportsRemoveBg
            ? '이 플랫폼(리눅스)용 로컬 배경 제거 모델은 배포되지 않아 사용할 수 없습니다. 배경 제거는 NAI 서버 방식으로 동작합니다.'
            : undefined
        }
      />
      {platform.supportsRemoveBg && !ready && (
        <SettingField>
          <button className="btn w-full back-green py-2 rounded"
            onClick={() => { if (!localAIService.downloading) localAIService.download(); }}>
            {!localAIService.downloading
              ? '로컬 배경 제거 모델 설치'
              : stageTexts[stage] + ` (${(progress * 100).toFixed(2)}%)`}
          </button>
        </SettingField>
      )}
      {ready && (
        <>
          {/* CUDA 안내 링크는 종전처럼 제목 안(링크를 눌러도 줄이 토글되는 것은 종전과 같음) */}
          <SettingCheckRow
            id="cfgGpu"
            checked={useGPU}
            onChange={setUseGPU}
            label={
              <>
                배경 제거 시 GPU 사용{' '}
                <a onClick={() => backend.openWebPage('https://developer.nvidia.com/cuda-11-8-0-download-archive')}
                  className="underline text-blue-500 cursor-pointer">(CUDA를 설치 해야함)</a>
              </>
            }
          />
          <SettingField className="pt-1">
            <label htmlFor="cfgBgQuality" className="block text-sm gray-label mb-1">배경 제거 퀄리티</label>
            <select id="cfgBgQuality" className="app-select block w-full sm:text-sm"
              value={quality} onChange={(e) => setQuality(e.target.value)}>
              <option value="low">낮음</option>
              <option value="normal">보통</option>
              <option value="high">높음</option>
              <option value="veryhigh">매우높음</option>
              <option value="veryveryhigh">최고 (메모리 최소 8기가)</option>
            </select>
          </SettingField>
        </>
      )}
    </SettingGroup>
  </div>
);

/* 저장 경로 변경 보류 표시(2026-11-04) — 「나중에 재시작」 뒤 재시작 전까지. 위 「현재 저장경로」는 실제 루트
   (getDataRoot) 그대로 두고, 새 경로는 「다음 부팅부터 쓸 위치」로 구분해 보인다. observer 라 보류 상태 변화에
   바로 반응한다(문구 단일 출처 shared/saveLocationChange.ts). */
const SaveLocationPendingNotice = observer(() => {
  const pending = appState.saveLocationPending;
  if (!pending) return null;
  return (
    <div
      data-save-location-pending
      className="mt-2 rounded px-3 py-2 text-sm bg-[var(--c-yellow-bg)] text-[color:var(--c-yellow-fg)] space-y-2"
    >
      <div className="whitespace-pre-line">
        {SAVE_LOCATION_CHANGE_TEXT.pendingNotice(pending.previousRoot)}
      </div>
      <div className="text-xs break-all">
        {SAVE_LOCATION_CHANGE_TEXT.pendingNextRootLabel}: {pending.nextRoot}
      </div>
      <SaveLocationRestartButton />
    </div>
  );
});

/* ── 탭 3: 이미지 및 데이터 저장경로 ── */
// 묶음 상자(2026-11-20 UI 정돈 그룹 1-a): 현재 저장경로 / 기본 내보내기 폴더 / 이미지 다운로드(DownloadSettingsSection 이 스스로 그림) /
// 이미지 캐시 / 외부 편집 반영(종전 「폴더 변경 감지」, 2026-11-21 문구 정정) / WebP 자동 변환 / 이미지 복구. 구분선(hr) 대신 상자, 항목·순서·문구·id 그대로.
const StorageTab = ({
  saveLocation, dataRoot, selectFolder, clearImageCache,
  refreshImage, setRefreshImage,
  defaultExportFolder, setDefaultExportFolder, selectDefaultExportFolder,
  autoConvertWebp, setAutoConvertWebp, autoWebpQuality, setAutoWebpQuality,
}: any) => (
  <div className="space-y-4">
    <SettingGroup title="현재 저장경로">
     <SettingField>
      <div className="text-sm text-muted bg-gray-100 dark:bg-slate-700 rounded px-3 py-2 break-all">
        {dataRoot || saveLocation || '경로 확인 중…'}
      </div>
      <div className="text-xs text-muted mt-1">
        {appState.saveLocationFallback
          ? '지정 위치 접근 실패로 기본 위치를 임시 사용 중'
          : appState.saveLocationPending
            ? '지금 실제로 저장되는 위치'
            : saveLocation
            ? '사용자 지정 위치'
            : '기본 위치'}
      </div>
      {/* 보류 안내는 한 번만(2026-11-20 — c5bbcbf 에서 상태 문구 안·밖 두 곳에 그려지던 것을 밖 한 곳으로) */}
      <SaveLocationPendingNotice />
     </SettingField>
     <SettingField>
      <button className="btn w-full back-green py-2 rounded"
        onClick={selectFolder}>
        이미지 및 데이터 저장 위치 변경
      </button>
     </SettingField>
    </SettingGroup>
    <SettingGroup title="기본 내보내기 폴더">
     <SettingField>
      <p className="text-xs text-muted mb-2">
        내보내기 프리셋에 폴더가 지정되지 않았을 때 사용합니다. 비워 두면 OS 다운로드 폴더에 저장됩니다.
      </p>
      <div className="text-sm text-muted bg-gray-100 dark:bg-slate-700 rounded px-3 py-2 break-all">
        {defaultExportFolder || '미설정 (다운로드 폴더 사용)'}
      </div>
     </SettingField>
     <SettingField className="flex gap-2">
      <button className="btn flex-1 back-green py-2 rounded"
        onClick={selectDefaultExportFolder}>
        기본 내보내기 폴더 지정
      </button>
      {defaultExportFolder && (
        <button className="btn px-3 back-gray py-2 rounded"
          onClick={() => setDefaultExportFolder('')}>
          지우기
        </button>
      )}
     </SettingField>
    </SettingGroup>
    {/* 이미지 다운로드(저장 폴더·파일명 규칙) — 종전 다운로드 창에서 이전, 즉시 저장(2026-11-19). 묶음 상자는 이 부품이 그린다. */}
    <DownloadSettingsSection />
    {/* 드라이브 동기화 폴더(syncFolder)는 「드라이브」 탭의 「고급: 로컬 동기화 폴더」로 옮겼다(드라이브 API ⑤). */}
    <SettingGroup title="이미지 캐시">
     <SettingField>
      <button className="btn w-full back-red py-2 rounded"
        onClick={clearImageCache}>
        이미지 캐시 초기화
      </button>
     </SettingField>
    </SettingGroup>
    {/* 설정 키는 refreshImage 그대로 — 실제로는 이미 있던 이미지의 내용 변경만 반영(main image-changed → invalidateCache) */}
    <SettingGroup title="외부 편집 반영">
      <SettingCheckRow
        id="cfgRefresh"
        checked={refreshImage}
        onChange={setRefreshImage}
        label="밖에서 고친 이미지 자동 반영"
        description="탐색기나 외부 편집기로 이미 있는 이미지를 고쳐 저장하면 화면에 다시 반영합니다. 파일을 넣거나 지우거나 이름을 바꾼 것, 폴더를 옮긴 것은 감지하지 않습니다. 켜거나 끈 뒤 앱을 다시 시작해야 적용됩니다."
      />
    </SettingGroup>
    <SettingGroup title="WebP 자동 변환">
      <SettingCheckRow
        id="cfgAutoWebp"
        checked={autoConvertWebp}
        onChange={setAutoConvertWebp}
        label="새로 생성되는 이미지를 WebP로 자동 변환"
        description="생성 직후 PNG를 WebP로 재인코딩해 저장 용량을 줄입니다. 프롬프트 메타데이터와 NAI 인식(스텔스 워터마크)은 유지되며, 기존 이미지에는 영향이 없습니다. 변환에 실패하면 원본 PNG가 그대로 저장됩니다."
      />
      {autoConvertWebp && (
        <SettingField className="flex items-center gap-2">
          <label htmlFor="cfgAutoWebpQ" className="text-sm gray-label">변환 품질 (1~100)</label>
          <input
            type="number"
            id="cfgAutoWebpQ"
            min={1}
            max={100}
            value={autoWebpQuality}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              setAutoWebpQuality(isNaN(v) ? 80 : Math.min(100, Math.max(1, v)));
            }}
            className="w-16 text-sm text-center border rounded px-1 py-1 back-gray"
          />
        </SettingField>
      )}
    </SettingGroup>
    <SettingGroup title="이미지 복구 (실험적 기능)">
     <SettingField>
      <p className="text-xs text-muted mb-2">
        이미지 파일은 존재하지만 프로그램에서 보이지 않는 경우, 파일시스템을 스캔하여 누락된 씬과 이미지를 재연결합니다.
      </p>
      <button
        className="px-4 py-2 rounded-lg btn-solid-orange text-sm font-medium transition-colors"
        onClick={() => appState.recoverProjectImages()}
      >
        현재 프로젝트 이미지 복구
      </button>
     </SettingField>
    </SettingGroup>
  </div>
);

/* ── 탭: 저장경로 (저장경로 + 이미지 편집 병합, 2026-10-01 라벨 「저장/이미지」→「저장경로」) ──
   두 부분 사이 구분선은 묶음 상자로 대신한다(2026-11-20). */
const StorageImageTab = (props: any) => (
  <div className="space-y-4">
    <StorageTab {...props} />
    <ImageEditTab {...props} />
  </div>
);

/* ── 탭(모바일 전용): 이미지 복구 ──
   데스크탑은 '저장경로' 탭에 같은 기능이 있으나, 모바일은 그 탭을 숨기므로
   복구 기능만 떼어 별도 탭으로 제공한다. recoverProjectImages()는 백엔드 공용
   메서드(listFiles/refreshBatch)만 사용하므로 모바일에서도 그대로 동작한다. */
const RecoveryTab = () => (
  <div className="space-y-4">
    {/* 저장소 진단 — 권한/데이터 인식 실측 (증발처럼 보이는 증상 원인 안내) */}
    <StorageDiagnosticsSection />
    <hr className="line-color" />
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">
        이미지 복구 (실험적 기능)
      </label>
      <p className="text-xs text-muted mb-2">
        이미지 파일은 존재하지만 프로그램에서 보이지 않는 경우(씬에 이미지 개수만
        뜨고 썸네일이 비어 있는 등), 파일시스템을 다시 스캔하여 누락된 씬과
        이미지를 재연결합니다.
      </p>
      <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
        ⚠️ 저장소 접근이 안정된 상태에서 실행하세요. 파일을 읽지 못하는 순간에는
        복구가 동작하지 않을 수 있습니다. 이 기능은 파일을 삭제하지 않습니다.
      </p>
      <button
        className="px-4 py-2 rounded-lg btn-solid-orange text-sm font-medium transition-colors"
        onClick={() => appState.recoverProjectImages()}
      >
        현재 프로젝트 이미지 복구
      </button>
    </div>
  </div>
);

export default StorageImageTab;
export { RecoveryTab };
