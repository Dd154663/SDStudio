// 설정 화면 탭: 저장경로(key 'storage', 라벨 「저장경로」, PC) + 복구(key 'recovery', 라벨 「복구」, 모바일) — StorageImageTab(ImageEditTab·StorageTab)·RecoveryTab
import {
  backend,
  localAIService,
} from '../models';
import { platform } from '../models/platform';
import { appState } from '../models/AppService';
import { StorageDiagnosticsSection } from './StorageDiagnostics';

/* ── 탭 2: 이미지 편집 및 배경 제거 ── */
const ImageEditTab = ({
  imageEditor, setImageEditor,
  useLocalBgRemoval, setUseLocalBgRemoval,
  ready, stage, progress, stageTexts,
  useGPU, setUseGPU, quality, setQuality,
}: any) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">선호 이미지 편집기</label>
      <select className="mt-1 block w-full rounded-md line-color shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        value={imageEditor} onChange={(e) => setImageEditor(e.target.value)}>
        <option value="photoshop">포토샵</option>
        <option value="gimp">GIMP</option>
        <option value="mspaint">그림판</option>
      </select>
      {platform.isLinux && (
        <p className="text-xs text-muted mt-1">
          리눅스에서는 GIMP만 지원됩니다 (PATH 의 gimp 실행).
        </p>
      )}
    </div>
    <hr className="line-color" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgLocalBg" checked={useLocalBgRemoval}
        disabled={!platform.supportsRemoveBg}
        onChange={(e) => setUseLocalBgRemoval(e.target.checked)} />
      <label htmlFor="cfgLocalBg" className="text-sm gray-label">로컬 배경 제거 모델 사용</label>
    </div>
    {!platform.supportsRemoveBg && (
      <p className="text-xs text-muted">
        이 플랫폼(리눅스)용 로컬 배경 제거 모델은 배포되지 않아 사용할 수
        없습니다. 배경 제거는 NAI 서버 방식으로 동작합니다.
      </p>
    )}
    {platform.supportsRemoveBg && !ready && (
      <button className="btn w-full back-green py-2 rounded"
        onClick={() => { if (!localAIService.downloading) localAIService.download(); }}>
        {!localAIService.downloading
          ? '로컬 배경 제거 모델 설치'
          : stageTexts[stage] + ` (${(progress * 100).toFixed(2)}%)`}
      </button>
    )}
    {ready && (
      <>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="cfgGpu" checked={useGPU}
            onChange={(e) => setUseGPU(e.target.checked)} />
          <label htmlFor="cfgGpu" className="text-sm gray-label">
            배경 제거 시 GPU 사용{' '}
            <a onClick={() => backend.openWebPage('https://developer.nvidia.com/cuda-11-8-0-download-archive')}
              className="underline text-blue-500 cursor-pointer">(CUDA를 설치 해야함)</a>
          </label>
        </div>
        <div>
          <label className="block text-sm gray-label mb-1">배경 제거 퀄리티</label>
          <select className="mt-1 block w-full rounded-md line-color shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            value={quality} onChange={(e) => setQuality(e.target.value)}>
            <option value="low">낮음</option>
            <option value="normal">보통</option>
            <option value="high">높음</option>
            <option value="veryhigh">매우높음</option>
            <option value="veryveryhigh">최고 (메모리 최소 8기가)</option>
          </select>
        </div>
      </>
    )}
  </div>
);

/* ── 탭 3: 이미지 및 데이터 저장경로 ── */
const StorageTab = ({
  saveLocation, dataRoot, selectFolder, clearImageCache,
  refreshImage, setRefreshImage,
  defaultExportFolder, setDefaultExportFolder, selectDefaultExportFolder,
  autoConvertWebp, setAutoConvertWebp, autoWebpQuality, setAutoWebpQuality,
}: any) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">현재 저장경로</label>
      <div className="text-sm text-muted bg-gray-100 dark:bg-slate-700 rounded px-3 py-2 break-all">
        {dataRoot || saveLocation || '경로 확인 중…'}
      </div>
      <div className="text-xs text-muted mt-1">
        {appState.saveLocationFallback
          ? '지정 위치 접근 실패로 기본 위치를 임시 사용 중'
          : saveLocation
            ? '사용자 지정 위치'
            : '기본 위치'}
      </div>
    </div>
    <button className="btn w-full back-green py-2 rounded"
      onClick={selectFolder}>
      이미지 및 데이터 저장 위치 변경
    </button>
    <hr className="line-color" />
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">기본 내보내기 폴더</label>
      <p className="text-xs text-muted mb-2">
        내보내기 프리셋에 폴더가 지정되지 않았을 때 사용합니다. 비워 두면 OS 다운로드 폴더에 저장됩니다.
      </p>
      <div className="text-sm text-muted bg-gray-100 dark:bg-slate-700 rounded px-3 py-2 break-all">
        {defaultExportFolder || '미설정 (다운로드 폴더 사용)'}
      </div>
    </div>
    <div className="flex gap-2">
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
    </div>
    {/* 드라이브 동기화 폴더(syncFolder)는 「드라이브」 탭의 「고급: 로컬 동기화 폴더」로 옮겼다(드라이브 API ⑤). */}
    <hr className="line-color" />
    <button className="btn w-full back-red py-2 rounded"
      onClick={clearImageCache}>
      이미지 캐시 초기화
    </button>
    <hr className="line-color" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgRefresh" checked={refreshImage}
        onChange={(e) => setRefreshImage(e.target.checked)} />
      <label htmlFor="cfgRefresh" className="text-sm gray-label">이미지 폴더 직접 편집 감지</label>
    </div>
    <hr className="line-color" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgAutoWebp" checked={autoConvertWebp}
        onChange={(e) => setAutoConvertWebp(e.target.checked)} />
      <label htmlFor="cfgAutoWebp" className="text-sm gray-label">새로 생성되는 이미지를 WebP로 자동 변환</label>
    </div>
    <p className="text-xs text-muted">
      생성 직후 PNG를 WebP로 재인코딩해 저장 용량을 줄입니다. 프롬프트
      메타데이터와 NAI 인식(스텔스 워터마크)은 유지되며, 기존 이미지에는 영향이
      없습니다. 변환에 실패하면 원본 PNG가 그대로 저장됩니다.
    </p>
    {autoConvertWebp && (
      <div className="flex items-center gap-2">
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
      </div>
    )}
    <hr className="line-color" />
    <div>
      <label className="block text-sm font-semibold gray-label mb-1">이미지 복구 (실험적 기능)</label>
      <p className="text-xs text-muted mb-2">
        이미지 파일은 존재하지만 프로그램에서 보이지 않는 경우, 파일시스템을 스캔하여 누락된 씬과 이미지를 재연결합니다.
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

/* ── 탭: 저장경로 (저장경로 + 이미지 편집 병합, 2026-10-01 라벨 「저장/이미지」→「저장경로」) ── */
const StorageImageTab = (props: any) => (
  <div className="space-y-4">
    <StorageTab {...props} />
    <hr className="line-color" />
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
