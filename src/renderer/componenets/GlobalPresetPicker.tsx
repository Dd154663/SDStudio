import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ModalOverlay from './ModalOverlay';
import { ActionIcon } from './ActionIcon';
import { GlobalVibeImage } from './GlobalPresetTab';
import { globalPresetService, isMobile } from '../models';
import { appState } from '../models/AppService';
import {
  filterSortGlobalPresets,
  GlobalPresetSortBy,
} from '../models/globalPresetListView';

// ===== 공용 글로벌 프리셋 고르기 창(2026-11-14 M3) =====
//
// 두 진입점이 같은 창을 쓴다:
//  - 템플릿 관리 「불러오기 → 글로벌 프리셋에서」(템플릿 프롬프트·샘플링 1회 덮어쓰기 — danger 확인)
//  - 사전 세팅 「글로벌에서 가져오기」(appState.globalPresetPicker 호스트 — 고르면 바로 프로젝트로 복사)
// 창 = ModalOverlay size xl. 도구줄 = 이름 검색·정렬·개수, 본문 = 대표 이미지 카드 그리드(버튼 — 키보드 선택 가능).
// 검색·정렬 규칙은 글로벌 프리셋 탭과 같은 단일 출처 models/globalPresetListView.ts.

export interface GlobalPresetPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onPick: (globalId: string) => void | Promise<void>;
  title: ReactNode;
  // 본문 첫 줄 안내(선택)
  description?: ReactNode;
  // 고르면 덮어쓰기 확인(2버튼)을 거친다 — 확인했을 때만 onPick. 안내 줄도 빨강
  danger?: boolean;
  zIndex?: string;
}

const SORT_OPTIONS: { value: GlobalPresetSortBy; label: string }[] = [
  { value: 'default', label: '기본 우선' },
  { value: 'recent', label: '최근' },
  { value: 'name', label: '이름' },
];

export const GlobalPresetPicker = observer(
  ({
    isOpen,
    onClose,
    onPick,
    title,
    description,
    danger,
    zIndex,
  }: GlobalPresetPickerProps) => {
    const [query, setQuery] = useState('');
    const [sortBy, setSortBy] = useState<GlobalPresetSortBy>('default');
    // 덮어쓰기 확인 창이 떠 있는 동안 다른 카드 선택을 막는다(확인 창 중복 방지)
    const confirming = useRef(false);

    useEffect(() => {
      if (!isOpen) return;
      setQuery('');
      if (!globalPresetService.loaded) globalPresetService.load();
    }, [isOpen]);

    const all = globalPresetService.presets;
    const visible = filterSortGlobalPresets(all, query, sortBy);

    const pick = async (id: string, name: string) => {
      if (!danger) {
        await onPick(id);
        return;
      }
      if (confirming.current) return;
      confirming.current = true;
      try {
        const ok = await appState.confirmAsync({
          text: `「${name}」의 프롬프트·샘플링 설정으로 이 템플릿을 덮어쓸까요?`,
          confirmText: '덮어쓰기',
          danger: true,
        });
        if (ok) await onPick(id);
      } finally {
        confirming.current = false;
      }
    };

    const toolbar = (
      <>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 검색"
          aria-label="이름 검색"
          autoFocus={!isMobile}
          data-global-picker-search=""
          className="flex-1 min-w-0 h-8 px-2.5 text-sm rounded border line-color bg-[var(--c-input-bg)] text-default focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as GlobalPresetSortBy)}
          aria-label="정렬"
          data-global-picker-sort=""
          className="h-8 px-1.5 text-sm rounded border line-color bg-[var(--c-input-bg)] text-default flex-none"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div
          className="text-xs text-muted whitespace-nowrap flex-none"
          data-global-picker-count=""
        >
          {`${visible.length} / 전체 ${all.length}`}
        </div>
      </>
    );

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title={title}
        size="xl"
        toolbar={toolbar}
        zIndex={zIndex}
      >
        <div className="flex flex-col gap-3">
          {description != null && (
            <p
              className={
                'text-sm ' +
                (danger ? 'text-red-500 dark:text-red-400' : 'text-muted')
              }
              data-global-picker-description=""
            >
              {description}
            </p>
          )}
          {all.length === 0 ? (
            <div className="text-sm text-muted py-6 text-center">
              글로벌 프리셋이 없습니다.
            </div>
          ) : visible.length === 0 ? (
            <div className="text-sm text-muted py-6 text-center">
              검색 결과가 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {visible.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-global-picker-card=""
                  aria-label={p.name}
                  className="btn relative rounded-lg overflow-hidden border-2 line-color hover:border-sky-500 flex flex-col text-left bg-[var(--c-surface-2)]"
                  onClick={() => pick(p.id, p.name)}
                >
                  <GlobalVibeImage
                    profile={p.profile}
                    className="w-full aspect-[3/4] object-cover"
                  />
                  <div className="px-2 py-1.5 w-full">
                    <div className="text-sm text-default truncate">
                      {p.name}
                    </div>
                    <div className="text-xs text-faint truncate">
                      {p.workflowType}
                    </div>
                  </div>
                  {p.isDefault && (
                    <div
                      className="absolute top-2 left-2 bg-orange-500 text-white rounded-full p-2 shadow-lg"
                      data-global-picker-default=""
                    >
                      <ActionIcon id="pin-default" size={14} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </ModalOverlay>
    );
  },
);
