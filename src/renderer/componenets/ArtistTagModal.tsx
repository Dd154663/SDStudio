import React, { useEffect, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import ModalOverlay from './ModalOverlay';
import {
  ARTIST_MODELS,
  TagScore,
  WdResult,
  ArtistModelKey,
} from '../models/ArtistTagService';
import { artistTagService, isMobile } from '../models';
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

// 복사 형식(종전과 같음): 태그를 공백 표기로 바꿔 ', ' 로 잇는다. 작가 태그는 'artist:' 접두어.
const tagsToText = (items: TagScore[], prefix = '') =>
  items.map((x) => prefix + toPromptTag(x.tag)).join(', ');

// 신뢰도 표시 문자열(종전 칩 목록과 같은 형식)
const scoreText = (items: TagScore[]) =>
  items
    .map(
      (x) =>
        `${toPromptTag(x.tag)} ${(x.score * 100).toFixed(x.score >= 0.1 ? 0 : 1)}%`,
    )
    .join(' · ');

// 「모두 복사」 버튼(종전 동작 그대로)
const CopyAllButton = ({
  items,
  prefix = '',
}: {
  items: TagScore[];
  prefix?: string;
}) => (
  <button
    className="text-xs btn back-gray px-2 py-0.5 rounded flex-none"
    onClick={() => {
      navigator.clipboard.writeText(tagsToText(items, prefix));
      appState.pushMessage(`${items.length}개 태그 복사됨`);
    }}
  >
    모두 복사
  </button>
);

// WD 모델 선택 토글(SwinV2/EVA02) — 모델을 바꾸면 이전 WD 결과를 비운다
const WdModelToggle = observer(
  ({
    onChanged,
    stretch = false,
  }: {
    onChanged: () => void;
    stretch?: boolean;
  }) => {
    const wdKey = artistTagService.wdModel;
    return (
      <div
        className="flex rounded-md overflow-hidden border line-color"
        data-wd-model-toggle=""
      >
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
              (stretch ? 'flex-1 ' : '') +
              (wdKey === m.key
                ? 'bg-sky-500 text-white'
                : 'bg-transparent text-muted hover:bg-gray-100 dark:hover:bg-slate-700')
            }
            onClick={() => {
              if (wdKey !== m.key) {
                artistTagService.setWdModel(m.key);
                onChanged();
              }
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
    );
  },
);

// PC 결과 카드(2026-11-12 재배치안 가): 머리 = 제목(+개수) + 「모두 복사」, 본문이 카드 높이를 채우고 넘치면 카드 안에서만 스크롤
const PcResultCard = ({
  title,
  extra,
  grow,
  cardKey,
  children,
}: {
  title: string;
  extra?: React.ReactNode;
  grow: 'flex-1' | 'flex-[2]';
  cardKey: string;
  children: React.ReactNode;
}) => (
  <div
    className={
      grow + ' min-h-0 flex flex-col rounded-lg border line-color p-3 gap-2'
    }
    data-artist-tag-card={cardKey}
  >
    <div className="flex items-center justify-between gap-2 flex-none">
      <div className="text-sm font-semibold gray-label">{title}</div>
      {extra}
    </div>
    <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-auto">
      {children}
    </div>
  </div>
);

// PC 태그 본문: textarea 가 남은 높이를 채움(rows 없음) + 「신뢰도 보기」 접기(기본 접힘)
const PcTagBody = ({
  items,
  prefix = '',
}: {
  items: TagScore[];
  prefix?: string;
}) => (
  <>
    <textarea
      readOnly
      value={tagsToText(items, prefix)}
      className="w-full flex-1 min-h-0 resize-none gray-input text-sm rounded p-2"
      onFocus={(e) => e.currentTarget.select()}
    />
    <details className="flex-none text-xs text-muted" data-artist-tag-scores="">
      <summary className="cursor-pointer select-none">신뢰도 보기</summary>
      <div className="text-[11px] text-faint leading-relaxed mt-1">
        {scoreText(items)}
      </div>
    </details>
  </>
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
 * 아티스트 태깅 모달
 *
 * PC(2026-11-12 재배치안 가):
 *  왼쪽 = 결과 열(창 높이를 채움) — 작가 태그 카드(1) : WD 일반 태그 카드(2, 캐릭터 태그는 있을 때만 한 줄)
 *         카드 머리 = 제목·개수 + 「모두 복사」, 신뢰도 목록은 「신뢰도 보기」로 접힘
 *  오른쪽 = 이미지 첨부 → WD 모델 선택 → [분석] → 요약(개수 + [전체 복사])
 * 모바일: 종전 한 열 그대로(rows 고정·칩 상시·모델 토글은 WD 카드 머리).
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

    const clearWd = () => setWdResult(null);

    // 이미지 첨부 영역(파일 선택·끌어 놓기·붙여넣기). PC 는 오른쪽 열의 남은 높이를 채운다.
    const dropZone = (
      <div
        className={`relative rounded-lg border-2 border-dashed transition-colors cursor-pointer flex items-center justify-center ${
          isMobile ? 'min-h-[180px]' : 'flex-1 min-h-[180px] overflow-hidden'
        } ${
          dragOver
            ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30'
            : 'line-color hover:border-sky-400'
        }`}
        data-artist-tag-drop=""
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
            className={
              isMobile
                ? 'max-h-72 max-w-full object-contain rounded-md py-2'
                : 'w-full h-full min-h-0 object-contain rounded-md p-2'
            }
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
    );

    const analyzeButton = (
      <button
        className="w-full btn back-sky py-2 rounded-lg disabled:opacity-50 font-medium"
        disabled={!imageUri || analyzing || !anyInstalled}
        onClick={analyze}
      >
        {analyzing ? '분석 중... (수 초 소요)' : '분석'}
      </button>
    );

    const errorLine = error ? (
      <div className="text-sm text-red-500 dark:text-red-400">{error}</div>
    ) : null;

    // 모바일: 종전 한 열 그대로(rows 고정·칩 목록 상시·모델 토글은 WD 카드 머리)
    const mobileBody = (
      <div
        className="flex flex-col-reverse md:flex-row gap-4"
        data-artist-tag-columns=""
      >
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
            extra={<WdModelToggle onChanged={clearWd} />}
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
          {dropZone}
          {analyzeButton}
          {errorLine}
        </div>
      </div>
    );

    // PC(2026-11-12 재배치안 가): 왼쪽 = 결과 두 카드가 창 높이를 채움(작가 1 : 일반 2),
    // 오른쪽 = 입력(이미지) → 설정(WD 모델) → 실행([분석]) → 요약(개수 + [전체 복사]).
    const characterTags = wdResult?.character ?? [];
    const generalTags = wdResult?.general ?? [];
    const hasResult = !!artistResult || !!wdResult;
    const artistCount = artistResult?.length ?? 0;
    // 전체 복사 = 작가('artist:' 접두어)·캐릭터·일반을 종전 복사 형식 그대로 ', ' 로 이어 붙임(빈 결과는 건너뜀)
    const copyEverything = () => {
      const parts = [
        tagsToText(artistResult ?? [], 'artist:'),
        tagsToText(characterTags),
        tagsToText(generalTags),
      ].filter((x) => x.length > 0);
      const total = artistCount + characterTags.length + generalTags.length;
      navigator.clipboard.writeText(parts.join(', '));
      appState.pushMessage(`${total}개 태그 복사됨`);
    };

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title="아티스트 태깅"
        size="l"
      >
        {/* 2026-11-12 오버레이 묶음 A: l 등급(PC 고정 높이) — 2열 그대로, 본문을 고정 높이만큼 채운다.
            모바일은 등급 경로에 고정 높이가 없어 종전 한 열 그대로(h-full 미적용). */}
        {isMobile ? (
          mobileBody
        ) : (
          <div
            className={'flex flex-col-reverse md:flex-row gap-4' + (isMobile ? '' : ' h-full min-h-0')}
            data-artist-tag-columns=""
          >
            {/* 왼쪽: 결과 열 — 창 높이를 채우고, 카드가 넘치면 카드 안에서만 스크롤 */}
            <div
              className="flex-1 min-w-0 flex flex-col h-full min-h-0 gap-3"
              data-artist-tag-results=""
            >
              <PcResultCard
                cardKey="artist"
                grow="flex-1"
                title={
                  '작가 태그 (Kaloscope)' +
                  (artistResult ? ` · ${artistCount}` : '')
                }
                extra={
                  installed.kaloscope && artistResult && artistCount > 0 ? (
                    <CopyAllButton items={artistResult} prefix="artist:" />
                  ) : undefined
                }
              >
                {!installed.kaloscope ? (
                  <ModelInstallCard model="kaloscope" />
                ) : artistResult ? (
                  artistCount === 0 ? (
                    <div className="text-xs text-faint">(없음)</div>
                  ) : (
                    <PcTagBody items={artistResult} prefix="artist:" />
                  )
                ) : (
                  placeholder
                )}
              </PcResultCard>

              <PcResultCard
                cardKey="general"
                grow="flex-[2]"
                title={
                  'WD 일반 태그' + (wdResult ? ` · ${generalTags.length}` : '')
                }
                extra={
                  installed[wdKey] && wdResult && generalTags.length > 0 ? (
                    <CopyAllButton items={generalTags} />
                  ) : undefined
                }
              >
                {!installed[wdKey] ? (
                  <ModelInstallCard model={wdKey} />
                ) : wdResult ? (
                  <>
                    {/* 캐릭터 태그: 결과가 있을 때만 한 줄 섹션(없으면 칸을 차지하지 않음) */}
                    {characterTags.length > 0 && (
                      <div
                        className="flex-none flex items-center gap-2 min-w-0"
                        data-artist-tag-character=""
                      >
                        <div className="text-xs font-semibold gray-label flex-none">
                          캐릭터 · {characterTags.length}
                        </div>
                        <input
                          readOnly
                          value={tagsToText(characterTags)}
                          className="flex-1 min-w-0 gray-input text-sm rounded px-2 py-1"
                          onFocus={(e) => e.currentTarget.select()}
                        />
                        <CopyAllButton items={characterTags} />
                      </div>
                    )}
                    {generalTags.length === 0 ? (
                      <div className="text-xs text-faint">(없음)</div>
                    ) : (
                      <PcTagBody items={generalTags} />
                    )}
                  </>
                ) : (
                  placeholder
                )}
              </PcResultCard>
            </div>

            {/* 오른쪽: 입력 → 설정 → 실행 → 요약 */}
            <div
              className="w-full md:w-72 flex-none flex flex-col h-full min-h-0 gap-3"
              data-artist-tag-side=""
            >
              {dropZone}
              <div className="flex-none space-y-1" data-artist-tag-model="">
                <div className="text-xs font-semibold gray-label">WD 모델</div>
                <WdModelToggle onChanged={clearWd} stretch />
              </div>
              <div className="flex-none">{analyzeButton}</div>
              {errorLine && <div className="flex-none">{errorLine}</div>}
              {hasResult && (
                <div
                  className="flex-none flex items-center justify-between gap-2 rounded-lg border line-color px-3 py-2"
                  data-artist-tag-summary=""
                >
                  <div className="text-xs text-muted">
                    작가 {artistCount} · 캐릭터 {characterTags.length} · 일반{' '}
                    {generalTags.length}
                  </div>
                  <button
                    className="text-xs btn back-gray px-2 py-0.5 rounded flex-none"
                    onClick={copyEverything}
                  >
                    전체 복사
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </ModalOverlay>
    );
  },
);

export default ArtistTagModal;
