import React, { useEffect, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import ModalOverlay from './ModalOverlay';
import {
  ARTIST_MODELS,
  TagScore,
  WdResult,
  ArtistModelKey,
} from '../models/ArtistTagService';
import { artistTagService } from '../models';
import { appState } from '../models/AppService';

// 복사 시 danbooru 언더스코어 표기 → 프롬프트용 공백 표기
const toPromptTag = (tag: string) => tag.replace(/_/g, ' ');

const TagChip = ({ item }: { item: TagScore }) => (
  <button
    className="inline-flex items-center gap-1.5 px-2.5 py-1 m-0.5 rounded-full text-sm bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-gray-100 hover:bg-sky-100 dark:hover:bg-sky-900 transition-colors"
    title="클릭하여 복사"
    onClick={() => {
      navigator.clipboard.writeText(toPromptTag(item.tag));
      appState.pushMessage(`복사됨: ${toPromptTag(item.tag)}`);
    }}
  >
    <span className="break-all">{toPromptTag(item.tag)}</span>
    <span className="text-xs text-gray-400 dark:text-gray-500 flex-none">
      {(item.score * 100).toFixed(item.score >= 0.1 ? 0 : 1)}%
    </span>
  </button>
);

const TagSection = ({
  title,
  items,
}: {
  title: string;
  items: TagScore[];
}) => (
  <div className="space-y-1">
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold gray-label">{title}</span>
      {items.length > 0 && (
        <button
          className="text-xs back-gray px-2 py-0.5 rounded hover:brightness-95 active:brightness-90"
          onClick={() => {
            navigator.clipboard.writeText(
              items.map((x) => toPromptTag(x.tag)).join(', '),
            );
            appState.pushMessage(`${items.length}개 태그 복사됨`);
          }}
        >
          모두 복사
        </button>
      )}
    </div>
    {items.length === 0 ? (
      <div className="text-xs text-gray-400 dark:text-gray-500">(없음)</div>
    ) : (
      <div className="flex flex-wrap -m-0.5">
        {items.map((x) => (
          <TagChip key={x.tag} item={x} />
        ))}
      </div>
    )}
  </div>
);

// 미설치 모델 설치 카드
const ModelInstallCard = observer(({ model }: { model: ArtistModelKey }) => {
  const def = ARTIST_MODELS[model];
  const busy = artistTagService.downloading === model;
  const otherBusy =
    artistTagService.downloading !== null && !busy;
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-600">
      <div className="flex-1 min-w-0">
        <div className="text-sm gray-label">{def.label}</div>
        <div className="text-xs text-gray-400 dark:text-gray-500">
          다운로드 {def.sizeText}
        </div>
        {busy && (
          <div className="mt-1.5 h-1.5 rounded bg-gray-200 dark:bg-slate-600 overflow-hidden">
            <div
              className="h-full bg-sky-500 transition-all"
              style={{ width: `${artistTagService.downloadPercent}%` }}
            />
          </div>
        )}
      </div>
      <button
        className="text-sm back-sky px-3 py-1.5 rounded flex-none hover:brightness-95 active:brightness-90 disabled:opacity-50"
        disabled={busy || otherBusy}
        onClick={() => {
          artistTagService.download(model).catch((e: any) => {
            appState.pushMessage('모델 다운로드 실패: ' + (e?.message || e));
          });
        }}
      >
        {busy ? `${artistTagService.downloadPercent}%` : '설치'}
      </button>
    </div>
  );
});

/**
 * 아티스트 태깅 모달 (데스크톱 전용)
 *
 * 이미지 첨부(파일 선택/드래그&드롭/클립보드 붙여넣기) → 로컬 ONNX 분석 →
 * [작가 태그(Kaloscope)] / [WD 태그] 탭으로 결과 표시.
 */
const ArtistTagModal = observer(
  ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    const [imageUri, setImageUri] = useState<string | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [artistResult, setArtistResult] = useState<TagScore[] | null>(null);
    const [wdResult, setWdResult] = useState<WdResult | null>(null);
    const [activeTab, setActiveTab] = useState<'artist' | 'wd'>('artist');
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (isOpen) {
        setError(null);
        artistTagService.statsModels();
      }
    }, [isOpen]);

    const loadFile = useCallback((file: File) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        setImageUri(reader.result as string);
        setArtistResult(null);
        setWdResult(null);
        setError(null);
      };
      reader.readAsDataURL(file);
    }, []);

    // 모달 열림 중 클립보드 붙여넣기 수신
    useEffect(() => {
      if (!isOpen) return;
      const onPaste = (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            const file = items[i].getAsFile();
            if (file) {
              loadFile(file);
              e.preventDefault();
            }
            break;
          }
        }
      };
      window.addEventListener('paste', onPaste);
      return () => window.removeEventListener('paste', onPaste);
    }, [isOpen, loadFile]);

    const pickFile = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (file) loadFile(file);
      };
      input.click();
    };

    const installed = artistTagService.installed;
    const anyInstalled = installed.kaloscope || installed.wd;

    const analyze = async () => {
      if (!imageUri || analyzing) return;
      setAnalyzing(true);
      setError(null);
      try {
        if (installed.kaloscope) {
          const artists = await artistTagService.analyzeArtists(imageUri);
          setArtistResult(artists.slice(0, 10));
        }
        if (installed.wd) {
          setWdResult(await artistTagService.analyzeWd(imageUri));
        }
        setActiveTab(installed.kaloscope ? 'artist' : 'wd');
      } catch (e: any) {
        setError('분석 실패: ' + (e?.message || e));
      }
      setAnalyzing(false);
    };

    const hasResult = artistResult !== null || wdResult !== null;

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title="아티스트 태깅"
        width="max-w-2xl"
      >
        <div className="space-y-4">
          {/* 이미지 입력 영역 */}
          <div
            className={`relative rounded-lg border-2 border-dashed transition-colors cursor-pointer flex items-center justify-center min-h-[140px] ${
              dragOver
                ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30'
                : 'border-gray-300 dark:border-slate-600 hover:border-sky-400'
            }`}
            onClick={pickFile}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) loadFile(file);
            }}
          >
            {imageUri ? (
              <img
                src={imageUri}
                className="max-h-64 max-w-full object-contain rounded-md py-2"
              />
            ) : (
              <div className="text-center text-sm text-gray-400 dark:text-gray-500 px-4 py-6">
                이미지를 클릭해 선택하거나, 끌어다 놓거나,
                <br />
                Ctrl+V로 붙여넣으세요
              </div>
            )}
          </div>

          {/* 분석 버튼 */}
          <button
            className="w-full back-sky py-2 rounded-lg hover:brightness-95 active:brightness-90 disabled:opacity-50 font-medium"
            disabled={!imageUri || analyzing || !anyInstalled}
            onClick={analyze}
          >
            {analyzing ? '분석 중... (수 초 소요)' : '분석'}
          </button>

          {error && (
            <div className="text-sm text-red-500 dark:text-red-400">{error}</div>
          )}

          {/* 모델 설치 (미설치 항목만) */}
          {(!installed.kaloscope || !installed.wd) && (
            <div className="space-y-2">
              <div className="text-xs text-gray-400 dark:text-gray-500">
                분석에는 로컬 모델 설치가 필요합니다. 각 모델은 독립적으로
                동작합니다 (작가 태그 = Kaloscope, 일반/캐릭터 태그 = WD).
              </div>
              {!installed.kaloscope && <ModelInstallCard model="kaloscope" />}
              {!installed.wd && <ModelInstallCard model="wd" />}
            </div>
          )}

          {/* 결과 탭 */}
          {hasResult && (
            <div>
              <div className="flex border-b border-gray-200 dark:border-slate-600 mb-3">
                {[
                  { key: 'artist' as const, label: '작가 태그' },
                  { key: 'wd' as const, label: 'WD 태그' },
                ].map((t) => (
                  <button
                    key={t.key}
                    className={
                      'px-3 py-2 text-sm font-medium transition-colors border-b-2 ' +
                      (activeTab === t.key
                        ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')
                    }
                    onClick={() => setActiveTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {activeTab === 'artist' ? (
                artistResult ? (
                  <TagSection title="작가 태그 (top 10)" items={artistResult} />
                ) : (
                  <div className="text-sm text-gray-400 dark:text-gray-500">
                    작가 분석 모델(Kaloscope)이 설치되지 않았습니다.
                  </div>
                )
              ) : wdResult ? (
                <div className="space-y-3">
                  <TagSection title="캐릭터 태그" items={wdResult.character} />
                  <TagSection title="일반 태그" items={wdResult.general} />
                </div>
              ) : (
                <div className="text-sm text-gray-400 dark:text-gray-500">
                  태그 분석 모델(WD)이 설치되지 않았습니다.
                </div>
              )}
            </div>
          )}
        </div>
      </ModalOverlay>
    );
  },
);

export default ArtistTagModal;
