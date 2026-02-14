import * as React from 'react';
import { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaDownload,
  FaFolder,
  FaTimes,
  FaCheck,
  FaCog,
  FaEye,
} from 'react-icons/fa';
import { appState } from '../models/AppService';
import { imageDownloadService } from '../models';
import { GenericScene, Session, CharacterPreset } from '../models/types';
import { FloatView } from './FloatView';
import {
  generateFilename,
  sanitizeFilename,
} from '../models/ImageDownloadService';
import { DownloadSettings } from '../../main/config';

interface DownloadDialogProps {
  session: Session;
  scene: GenericScene;
  imagePaths: string[];
  characterPreset?: CharacterPreset;
  onClose: () => void;
  onDownloadComplete?: () => void;
}

/**
 * 다운로드 다이얼로그 컴포넌트
 * - 파일명 미리보기
 * - 저장 경로 선택
 * - 일괄 다운로드 옵션
 * - 중복 처리 옵션
 */
export const DownloadDialog = observer(
  ({
    session,
    scene,
    imagePaths,
    characterPreset,
    onClose,
    onDownloadComplete,
  }: DownloadDialogProps) => {
    const [settings, setSettings] = useState<DownloadSettings>({
      ...imageDownloadService.settings,
    });
    const [customFilename, setCustomFilename] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [selectedImages, setSelectedImages] = useState<Set<number>>(
      new Set(imagePaths.map((_, i) => i)),
    );
    const [isDownloading, setIsDownloading] = useState(false);

    // 설정 변경 시 서비스에 반영
    useEffect(() => {
      imageDownloadService.updateSettings(settings);
    }, [settings]);

    // 파일명 미리보기 생성
    const getFilenamePreview = (index?: number): string => {
      const prefix =
        characterPreset?.filenamePrefix || settings.defaultPrefix || '';
      const suffix =
        characterPreset?.filenameSuffix || settings.defaultSuffix || '';

      if (customFilename) {
        return sanitizeFilename(customFilename) + '.png';
      }

      return (
        generateFilename({
          sceneName: scene.name,
          prefix,
          suffix,
          includeTimestamp: settings.includeTimestamp,
          includeIndex: imagePaths.length > 1 && index !== undefined,
          index: index !== undefined ? index + 1 : undefined,
        }) + '.png'
      );
    };

    // 단일 이미지 다운로드
    const handleSingleDownload = async () => {
      if (imagePaths.length === 0) return;

      setIsDownloading(true);
      try {
        const success = await imageDownloadService.downloadSingleImage(
          session,
          scene,
          imagePaths[0],
          characterPreset,
          customFilename || undefined,
        );
        if (success) {
          onDownloadComplete?.();
          onClose();
        }
      } finally {
        setIsDownloading(false);
      }
    };

    // 일괄 다운로드
    const handleBatchDownload = async () => {
      const selectedPaths = imagePaths.filter((_, i) => selectedImages.has(i));
      if (selectedPaths.length === 0) {
        appState.pushMessage('다운로드할 이미지를 선택해주세요');
        return;
      }

      setIsDownloading(true);
      try {
        const result = await imageDownloadService.downloadMultipleImages(
          session,
          scene,
          selectedPaths,
          characterPreset,
        );
        if (result.success > 0) {
          onDownloadComplete?.();
          onClose();
        }
      } finally {
        setIsDownloading(false);
      }
    };

    // 저장 경로 변경
    const handleChangePath = async () => {
      const newPath = await imageDownloadService.changeSavePath();
      if (newPath) {
        setSettings({ ...settings, lastSavePath: newPath });
      }
    };

    // 이미지 선택 토글
    const toggleImageSelection = (index: number) => {
      const newSelected = new Set(selectedImages);
      if (newSelected.has(index)) {
        newSelected.delete(index);
      } else {
        newSelected.add(index);
      }
      setSelectedImages(newSelected);
    };

    // 전체 선택/해제
    const toggleSelectAll = () => {
      if (selectedImages.size === imagePaths.length) {
        setSelectedImages(new Set());
      } else {
        setSelectedImages(new Set(imagePaths.map((_, i) => i)));
      }
    };

    const isSingleImage = imagePaths.length === 1;

    return (
      <FloatView priority={2} onEscape={onClose}>
        <div className="w-full max-w-lg mx-auto bg-white dark:bg-slate-800 rounded-lg shadow-xl overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center justify-between p-4 border-b dark:border-slate-700">
            <div className="flex items-center gap-2">
              <FaDownload className="text-sky-500" />
              <span className="font-medium text-default">
                {isSingleImage ? '이미지 다운로드' : '일괄 다운로드'}
              </span>
            </div>
            <button
              className="icon-button back-gray"
              onClick={onClose}
              disabled={isDownloading}
            >
              <FaTimes />
            </button>
          </div>

          {/* 본문 */}
          <div className="p-4 max-h-96 overflow-y-auto">
            {/* 저장 경로 */}
            <div className="mb-4">
              <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
                저장 경로:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="gray-input flex-1"
                  value={settings.lastSavePath || '(선택되지 않음)'}
                  readOnly
                />
                <button
                  className="round-button back-sky h-9"
                  onClick={handleChangePath}
                  disabled={isDownloading}
                >
                  <FaFolder className="mr-1" />
                  변경
                </button>
              </div>
            </div>

            {/* 파일명 (단일 이미지인 경우) */}
            {isSingleImage && (
              <div className="mb-4">
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
                  파일명 (비워두면 자동 생성):
                </label>
                <input
                  type="text"
                  className="gray-input w-full"
                  value={customFilename}
                  onChange={(e) => setCustomFilename(e.target.value)}
                  placeholder={scene.name}
                  disabled={isDownloading}
                />
              </div>
            )}

            {/* 파일명 미리보기 */}
            <div className="mb-4 p-3 bg-gray-100 dark:bg-slate-700 rounded">
              <div className="flex items-center gap-2 mb-2">
                <FaEye className="text-gray-500" />
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  파일명 미리보기:
                </span>
              </div>
              {isSingleImage ? (
                <code className="text-sky-600 dark:text-sky-400 text-sm break-all">
                  {getFilenamePreview()}
                </code>
              ) : (
                <div className="space-y-1">
                  {imagePaths.slice(0, 3).map((_, i) => (
                    <code
                      key={i}
                      className="block text-sky-600 dark:text-sky-400 text-sm break-all"
                    >
                      {getFilenamePreview(i)}
                    </code>
                  ))}
                  {imagePaths.length > 3 && (
                    <span className="text-gray-500 text-sm">
                      ... 외 {imagePaths.length - 3}개
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 일괄 다운로드 이미지 선택 */}
            {!isSingleImage && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    다운로드할 이미지 선택 ({selectedImages.size}/
                    {imagePaths.length}):
                  </span>
                  <button
                    className="text-sm text-sky-500 hover:text-sky-600"
                    onClick={toggleSelectAll}
                    disabled={isDownloading}
                  >
                    {selectedImages.size === imagePaths.length
                      ? '전체 해제'
                      : '전체 선택'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border rounded dark:border-slate-600">
                  {imagePaths.map((_, i) => (
                    <button
                      key={i}
                      className={`w-8 h-8 rounded flex items-center justify-center text-sm ${
                        selectedImages.has(i)
                          ? 'bg-sky-500 text-white'
                          : 'bg-gray-200 dark:bg-slate-600 text-gray-600 dark:text-gray-300'
                      }`}
                      onClick={() => toggleImageSelection(i)}
                      disabled={isDownloading}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 설정 토글 */}
            <div className="mb-4">
              <button
                className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                onClick={() => setShowSettings(!showSettings)}
              >
                <FaCog />
                <span>고급 설정</span>
                <span>{showSettings ? '▼' : '▶'}</span>
              </button>

              {showSettings && (
                <div className="mt-3 p-3 border rounded dark:border-slate-600 space-y-3">
                  {/* 자동 넘버링 */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.autoNumbering}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          autoNumbering: e.target.checked,
                        })
                      }
                      disabled={isDownloading}
                    />
                    <span className="text-sm text-default">
                      파일명 중복 시 자동 넘버링
                    </span>
                  </label>

                  {/* 덮어쓰기 */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.overwriteExisting}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          overwriteExisting: e.target.checked,
                        })
                      }
                      disabled={isDownloading || settings.autoNumbering}
                    />
                    <span className="text-sm text-default">
                      기존 파일 덮어쓰기
                    </span>
                  </label>

                  {/* 타임스탬프 포함 */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.includeTimestamp}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          includeTimestamp: e.target.checked,
                        })
                      }
                      disabled={isDownloading}
                    />
                    <span className="text-sm text-default">
                      파일명에 타임스탬프 포함
                    </span>
                  </label>

                  {/* 기본 접두사 */}
                  <div>
                    <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
                      기본 접두사:
                    </label>
                    <input
                      type="text"
                      className="gray-input w-full"
                      value={settings.defaultPrefix || ''}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          defaultPrefix: e.target.value,
                        })
                      }
                      placeholder="예: project"
                      disabled={isDownloading}
                    />
                  </div>

                  {/* 기본 접미사 */}
                  <div>
                    <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
                      기본 접미사:
                    </label>
                    <input
                      type="text"
                      className="gray-input w-full"
                      value={settings.defaultSuffix || ''}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          defaultSuffix: e.target.value,
                        })
                      }
                      placeholder="예: final"
                      disabled={isDownloading}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 다운로드 진행률 */}
            {isDownloading && imageDownloadService.isDownloading && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    다운로드 중...
                  </span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {Math.round(imageDownloadService.downloadProgress)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-200 dark:bg-slate-600 rounded overflow-hidden">
                  <div
                    className="h-full bg-sky-500 transition-all duration-300"
                    style={{
                      width: `${imageDownloadService.downloadProgress}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 푸터 */}
          <div className="flex gap-2 p-4 border-t dark:border-slate-700">
            <button
              className="round-button back-green flex-1 h-10"
              onClick={isSingleImage ? handleSingleDownload : handleBatchDownload}
              disabled={
                isDownloading ||
                (!isSingleImage && selectedImages.size === 0)
              }
            >
              <FaCheck className="mr-2" />
              {isDownloading
                ? '다운로드 중...'
                : isSingleImage
                  ? '다운로드'
                  : `${selectedImages.size}개 다운로드`}
            </button>
            <button
              className="round-button back-gray flex-1 h-10"
              onClick={onClose}
              disabled={isDownloading}
            >
              <FaTimes className="mr-2" />
              취소
            </button>
          </div>
        </div>
      </FloatView>
    );
  },
);

export default DownloadDialog;