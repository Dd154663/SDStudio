import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ModalOverlay from './ModalOverlay';
import { projectSizeService, sessionService } from '../models';

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

    useEffect(() => {
      if (!isOpen) return;
      projectSizeService.ensureLoaded();
      try {
        setNames(sessionService.list());
      } catch {
        setNames([]);
      }
    }, [isOpen]);

    const entries = projectSizeService.entries;
    const calced = names.filter((n) => entries[n]);
    const uncalced = names.filter((n) => !entries[n]);
    calced.sort((a, b) => entries[b].bytes - entries[a].bytes);
    uncalced.sort((a, b) => a.localeCompare(b));
    const sorted = [...calced, ...uncalced];
    const maxBytes = calced.length ? entries[calced[0]].bytes : 0;
    const total = calced.reduce((s, n) => s + entries[n].bytes, 0);
    const bulk = projectSizeService.bulkProgress;

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title="프로젝트 저장 공간 관리"
        width="max-w-2xl"
      >
        <div className="space-y-3">
          {/* 컨트롤 (모달 콘텐츠 스크롤 시에도 상단 고정) */}
          <div className="sticky -top-5 z-10 bg-[var(--c-surface-2)] pt-1 pb-2 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {bulk ? (
                <>
                  <span className="text-sm gray-label">
                    계산 중... {bulk.done}/{bulk.total}
                  </span>
                  <button
                    className="text-sm back-red px-3 py-1 rounded hover:brightness-95 active:brightness-90"
                    onClick={() => projectSizeService.cancelBulk()}
                  >
                    중지
                  </button>
                </>
              ) : (
                <button
                  className="text-sm back-sky px-3 py-1 rounded hover:brightness-95 active:brightness-90 disabled:opacity-50"
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
            <div className="text-xs text-faint">
              프로젝트별 차지 용량(이미지 포함)을 계산합니다. 부하를 피하기 위해
              자동으로 계산하지 않으며, 계산 결과는 저장되어 다음에도 표시됩니다.
              3GB 이상 프로젝트는 붉게 강조됩니다.
            </div>
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
                  <button
                    className="text-xs back-gray px-2 py-1 rounded flex-none hover:brightness-95 active:brightness-90 disabled:opacity-50"
                    disabled={busy || !!bulk}
                    onClick={() => projectSizeService.calculate(n)}
                  >
                    {busy ? '...' : e ? '↻' : '계산'}
                  </button>
                  <button
                    className="text-xs back-sky px-2 py-1 rounded flex-none hover:brightness-95 active:brightness-90"
                    onClick={() => onJump(n)}
                  >
                    이동
                  </button>
                </div>
              );
            })}
            {names.length === 0 && (
              <div className="text-sm text-faint text-center py-6">
                프로젝트가 없습니다.
              </div>
            )}
          </div>
        </div>
      </ModalOverlay>
    );
  },
);

export default StorageManageModal;
