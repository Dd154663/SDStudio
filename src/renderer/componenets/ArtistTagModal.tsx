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

// 태그 결과 텍스트 영역 (드래그로 일부/전체 자유 복사 + 모두 복사 + 신뢰도 목록)
const TagTextSection = ({
  title,
  items,
  rows = 3,
  prefix = '',
}: {
  title?: string;
  items: TagScore[];
  rows?: number;
  prefix?: string; // 각 태그 앞에 붙일 접두어 (예: NAI 작가 명시 문법 'artist:')
}) => {
  const text = items.map((x) => prefix + toPromptTag(x.tag)).join(', ');
  return (
    <div className="space-y-1">
      {title && (
        <div className="text-sm font-semibold gray-label">{title}</div>
      )}
      {items.length === 0 ? (
        <div className="text-xs text-faint">(없음)</div>
      ) : (
        <div className="space-y-2">
          <textarea
            readOnly
            value={text}
            rows={rows}
            className="w-full gray-input text-sm rounded p-2 resize-y"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex items-start gap-2">
            <button
              className="text-xs btn back-gray px-2 py-0.5 rounded flex-none"
              onClick={() => {
                navigator.clipboard.writeText(text);
                appState.pushMessage(`${items.length}개 태그 복사됨`);
              }}
            >
              모두 복사
            </button>
            <div className="text-[11px] text-faint leading-relaxed">
              {items
                .map(
                  (x) =>
                    `${toPromptTag(x.tag)} ${(x.score * 100).toFixed(
                      x.score >= 0.1 ? 0 : 1,
                    )}%`,
                )
                .join(' · ')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 결과 영역 공통 래퍼 (제목 + 우측 부가 컨트롤 + 내용)
const ResultPanel = ({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="rounded-lg border line-color p-3 space-y-2">
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="text-sm font-semibold gray-label">{title}</div>
      {extra}
    </div>
    {children}
  </div>
);

// 미설치 모델 설치 카드
const ModelInstallCard = observer(({ model }: { model: ArtistModelKey }) => {
  const def = ARTIST_MODELS[model];
  const busy = artistTagService.downloading === model;
  const otherBusy = artistTagService.downloading !== null && !busy;
  return (
    <div className="space-y-2">
      <div className="text-xs text-faint">
        이 분석을 사용하려면 모델 설치가 필요합니다. (다운로드 {def.sizeText})
      </div>
      {busy && (
        <div className="h-1.5 rounded bg-gray-200 dark:bg-slate-600 overflow-hidden">
          <div
            className="h-full bg-sky-500 transition-all"
            style={{ width: `${artistTagService.downloadPercent}%` }}
          />
        </div>
      )}
      <button
        className="text-sm btn back-sky px-3 py-1.5 rounded disabled:opacity-50"
        disabled={busy || otherBusy}
        onClick={() => {
          artistTagService.download(model).catch((e: any) => {
            appState.pushMessage('모델 다운로드 실패: ' + (e?.message || e));
          });
        }}
      >
        {busy ? `다운로드 중... ${artistTagService.downloadPercent}%` : '설치'}
      </button>
    </div>
  );
});

/**
 * 아티스트 태깅 모달 (데스크톱 전용)
 *
 * 좌측: 결과 영역 (상단 작가 태그 — 드래그 복사 가능한 텍스트 영역 / 하단 WD 태그)
 * 우측: 이미지 첨부(파일 선택/드래그&드롭/클립보드 붙여넣기) + 분석 버튼
 * 미설치 모델의 결과 영역에는 설치 안내가 표시된다.
 */
const ArtistTagModal = observer(
  ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    const [imageUri, setImageUri] = useState<string | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [artistResult, setArtistResult] = useState<TagScore[] | null>(null);
    const [wdResult, setWdResult] = useState<WdResult | null>(null);
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
    const wdKey = artistTagService.wdModel;
    const anyInstalled = installed.kaloscope || installed[wdKey];

    const analyze = async () => {
      if (!imageUri || analyzing) return;
      setAnalyzing(true);
      setError(null);
      try {
        if (installed.kaloscope) {
          const artists = await artistTagService.analyzeArtists(imageUri);
          setArtistResult(artists.slice(0, 10));
        }
        if (installed[artistTagService.wdModel]) {
          setWdResult(await artistTagService.analyzeWd(imageUri));
        }
      } catch (e: any) {
        setError('분석 실패: ' + (e?.message || e));
      }
      setAnalyzing(false);
    };

    const placeholder = (
      <div className="text-xs text-faint">
        이미지를 첨부하고 [분석]을 누르면 결과가 표시됩니다.
      </div>
    );

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title="아티스트 태깅"
        width="max-w-4xl"
      >
        <div className="flex flex-col-reverse md:flex-row gap-4">
          {/* 좌측: 결과 영역 (상: 작가 태그 / 하: WD 태그) */}
          <div className="flex-1 min-w-0 space-y-3">
            <ResultPanel title="작가 태그 (Kaloscope)">
              {!installed.kaloscope ? (
                <ModelInstallCard model="kaloscope" />
              ) : artistResult ? (
                <TagTextSection items={artistResult} rows={3} prefix="artist:" />
              ) : (
                placeholder
              )}
            </ResultPanel>

            <ResultPanel
              title="WD 태그 분석"
              extra={
                <div className="flex rounded-md overflow-hidden border line-color">
                  {(
                    [
                      { key: 'wd-swinv2', label: 'SwinV2 (권장)' },
                      { key: 'wd-eva02', label: 'EVA02 (정밀)' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.key}
                      className={
                        'px-2.5 py-1 text-xs transition-colors ' +
                        (wdKey === m.key
                          ? 'bg-sky-500 text-white'
                          : 'bg-transparent text-muted hover:bg-gray-100 dark:hover:bg-slate-700')
                      }
                      onClick={() => {
                        if (wdKey !== m.key) {
                          artistTagService.setWdModel(m.key);
                          setWdResult(null);
                        }
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              }
            >
              {!installed[wdKey] ? (
                <ModelInstallCard model={wdKey} />
              ) : wdResult ? (
                <div className="space-y-3">
                  <TagTextSection
                    title="캐릭터 태그"
                    items={wdResult.character}
                    rows={2}
                  />
                  <TagTextSection
                    title="일반 태그"
                    items={wdResult.general}
                    rows={5}
                  />
                </div>
              ) : (
                placeholder
              )}
            </ResultPanel>
          </div>

          {/* 우측: 이미지 첨부 + 분석 */}
          <div className="w-full md:w-72 flex-none space-y-3">
            <div
              className={`relative rounded-lg border-2 border-dashed transition-colors cursor-pointer flex items-center justify-center min-h-[180px] ${
                dragOver
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30'
                  : 'line-color hover:border-sky-400'
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
                  className="max-h-72 max-w-full object-contain rounded-md py-2"
                />
              ) : (
                <div className="text-center text-sm text-faint px-4 py-6">
                  이미지를 클릭해 선택하거나,
                  <br />
                  끌어다 놓거나, Ctrl+V로
                  <br />
                  붙여넣으세요
                </div>
              )}
            </div>

            <button
              className="w-full btn back-sky py-2 rounded-lg disabled:opacity-50 font-medium"
              disabled={!imageUri || analyzing || !anyInstalled}
              onClick={analyze}
            >
              {analyzing ? '분석 중... (수 초 소요)' : '분석'}
            </button>

            {error && (
              <div className="text-sm text-red-500 dark:text-red-400">
                {error}
              </div>
            )}
          </div>
        </div>
      </ModalOverlay>
    );
  },
);

export default ArtistTagModal;
