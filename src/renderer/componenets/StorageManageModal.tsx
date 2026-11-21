import { EmptyState } from './EmptyState';
import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ModalOverlay from './ModalOverlay';
import {
  projectSizeService,
  sessionService,
  templateService,
} from '../models';
import { appState } from '../models/AppService';
import { platform } from '../models/platform';
import Tooltip from './Tooltip';
import { ActionIcon } from './ActionIcon';

// 고용량 하이라이트 기준 (3GB)
const HIGHLIGHT_BYTES = 3 * 1024 * 1024 * 1024;

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatAgo = (at: number) => {
  const d = Date.now() - at;
  if (d < 60 * 1000) return '방금';
  if (d < 60 * 60 * 1000) return Math.floor(d / (60 * 1000)) + '분 전';
  if (d < 24 * 60 * 60 * 1000) return Math.floor(d / (60 * 60 * 1000)) + '시간 전';
  return Math.floor(d / (24 * 60 * 60 * 1000)) + '일 전';
};

/**
 * 프로젝트 저장 공간 관리 모달 (드로어 상단 "관리" 버튼에서 열림)
 *
 * - 프로젝트별 용량 수동 계산 + 캐시 표시 (projectSizeService)
 * - 3GB 이상 프로젝트 하이라이트
 * - [이동] 버튼으로 해당 프로젝트로 전환
 */
const StorageManageModal = observer(
  ({
    isOpen,
    onClose,
    onJump,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onJump: (name: string) => void;
  }) => {
    const [names, setNames] = useState<string[]>([]);
    // 숨김 목록이 바뀌면(다른 창 저장 재로드 등 — 2026-11-18 T4) 다시 거른다. observer 렌더에서 읽어 의존성으로 쓴다
    const hiddenNames = templateService.hiddenNames;

    useEffect(() => {
      if (!isOpen) return;
      projectSizeService.ensureLoaded();
      try {
        // 숨김 씬 템플릿 제외 (씬 템플릿 개편 2026-07-18) — 관리는 씬 툴바
        // ⋯ → 씬 템플릿 → 템플릿 관리에서 한다
        setNames(
          templateService.filterVisibleProjects(sessionService.list()),
        );
      } catch {
        setNames([]);
      }
    }, [isOpen, hiddenNames]);

    const entries = projectSizeService.entries;
    const calced = names.filter((n) => entries[n]);
    const uncalced = names.filter((n) => !entries[n]);
    calced.sort((a, b) => entries[b].bytes - entries[a].bytes);
    uncalced.sort((a, b) => a.localeCompare(b));
    const sorted = [...calced, ...uncalced];
    const maxBytes = calced.length ? entries[calced[0]].bytes : 0;
    const total = calced.reduce((s, n) => s + entries[n].bytes, 0);
    const bulk = projectSizeService.bulkProgress;

    // 도구줄(2026-11-14 오버레이 묶음 B) — 계산 단추·진행·합계. 종전 붙박이 머리(음수 위 여백·surface-2 배경)는
    // ModalOverlay toolbar 슬롯(스크롤 밖 고정)으로 옮겼다. 계산 동작은 그대로(projectSizeService).
    const toolbar = (
      <div className="flex items-center gap-2 flex-wrap" data-storage-toolbar>
        {bulk ? (
          <>
            <span className="text-sm gray-label">
              계산 중... {bulk.done}/{bulk.total}
            </span>
            <button
              className="text-sm btn back-red px-3 py-1 rounded"
              onClick={() => projectSizeService.cancelBulk()}
            >
              중단
            </button>
          </>
        ) : (
          <button
            className="text-sm btn back-sky px-3 py-1 rounded disabled:opacity-50"
            onClick={() => projectSizeService.calculateAll(sorted)}
            disabled={names.length === 0}
          >
            전체 계산
          </button>
        )}
        {calced.length > 0 && (
          <span className="text-sm gray-label">
            계산됨 {calced.length}/{names.length}개 · 총 {formatBytes(total)}
          </span>
        )}
      </div>
    );

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title="프로젝트 저장 공간 관리"
        size="m"
        toolbar={toolbar}
      >
        <div className="space-y-3">
          {/* 안내 — 본문 첫 줄(스크롤과 함께 움직임) */}
          <div className="text-xs text-faint">
            프로젝트별 차지 용량(이미지 포함)을 계산합니다. 부하를 피하기 위해
            자동으로 계산하지 않으며, 계산 결과는 저장되어 다음에도 표시됩니다.
            3GB 이상 프로젝트는 붉게 강조됩니다.
            {platform.supportsWebpConvert && (
              <>
                {' '}
                [최적화]는 해당 프로젝트의 모든 PNG 이미지를 WebP로 변환해
                용량을 줄입니다.
              </>
            )}
          </div>

          {/* 목록 */}
          <div className="space-y-0.5">
            {sorted.map((n) => {
              const e = entries[n];
              const busy = projectSizeService.calculating.includes(n);
              const heavy = !!e && e.bytes >= HIGHLIGHT_BYTES;
              return (
                <div
                  key={n}
                  className={`flex items-center gap-2 px-1.5 py-1.5 rounded ${
                    heavy ? 'bg-red-500/5 dark:bg-red-400/10' : ''
                  }`}
                >
                  <span
                    className={`text-sm truncate flex-1 min-w-0 ${
                      heavy
                        ? 'text-red-500 dark:text-red-400 font-medium'
                        : 'gray-label'
                    }`}
                  >
                    {n}
                  </span>
                  {e ? (
                    <>
                      <div className="hidden sm:block w-24 h-1.5 rounded bg-gray-200 dark:bg-slate-600 flex-none overflow-hidden">
                        <div
                          className={`h-full ${
                            heavy
                              ? 'bg-red-500 dark:bg-red-400'
                              : 'bg-sky-500 dark:bg-sky-400'
                          }`}
                          style={{
                            width: maxBytes
                              ? `${Math.max(2, (e.bytes / maxBytes) * 100)}%`
                              : '0%',
                          }}
                        />
                      </div>
                      <span
                        className={`text-xs flex-none w-16 text-right ${
                          heavy
                            ? 'text-red-500 dark:text-red-400 font-medium'
                            : 'gray-label'
                        }`}
                      >
                        {formatBytes(e.bytes)}
                      </span>
                      <span className="text-[11px] text-faint flex-none w-12 text-right hidden sm:block">
                        {formatAgo(e.at)}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-faint flex-none">
                      계산 안 됨
                    </span>
                  )}
                  <Tooltip content={busy ? '계산 중' : e ? '다시 계산' : '계산'}>
                    <button
                      className="text-xs btn back-gray px-2 py-1 rounded flex-none disabled:opacity-50"
                      disabled={busy || !!bulk}
                      onClick={() => projectSizeService.calculate(n)}
                      aria-label={busy ? '계산 중' : e ? '다시 계산' : '계산'}
                    >
                      {/* 「다시 계산」 = 사전 refresh 아이콘(2026-11-20 그룹 1-c, 종전 기호 글자 ↻) — 버튼 모양·이름표는 그대로 */}
                      {busy ? '...' : e ? <ActionIcon id="refresh" size={14} className="block my-px" /> : '계산'}
                    </button>
                  </Tooltip>
                  {platform.supportsWebpConvert && (
                    <button
                      className="text-xs btn back-green px-2 py-1 rounded flex-none"
                      disabled={busy || !!bulk}
                      onClick={() => appState.openProjectWebpOptimize(n)}
                    >
                      최적화
                    </button>
                  )}
                  <button
                    className="text-xs btn back-sky px-2 py-1 rounded flex-none"
                    onClick={() => onJump(n)}
                  >
                    이동
                  </button>
                </div>
              );
            })}
            {names.length === 0 && (
              <EmptyState className="py-6">
                프로젝트가 없습니다.
              </EmptyState>
            )}
          </div>
        </div>
      </ModalOverlay>
    );
  },
);

export default StorageManageModal;
