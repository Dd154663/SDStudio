// 이미지 그리드 「번호로 골라서 다운로드」 창(2026-11-23 — 2026-11-19 에 없어진 옛 DownloadDialog 의 번호 고르기만 정돈해서 되살림).
// 틀 = ModalOverlay size m(사전 세팅 일괄 삭제 PreSetBulkManageModal 을 본뜸 — 도구줄에 개수+전체 선택/해제, 본문 = 고르는 목록,
// 바닥줄 = [확정][…][취소]). Esc·뒤로 가기·바깥 누르기·✕ = 취소(래퍼의 backStack·바깥 누름 규칙). 등장 움직임 없음.
// 고르기 규칙·문구 = models/gridDownloadPick.ts. 저장·내보내기는 호출부(ResultViewer)가 선택 창과 같은 경로로 한다.
// 번호 격자 아래 붙박이 구역(2026-11-23 사용자): 다운로드 저장 폴더(PC — 설정 값의 복사본, 바꾸면 이번 다운로드에만)·파일명 미리보기.
// ModalOverlay 에 본문과 바닥줄 사이 고정 자리가 없어 본문(스크롤 하나) 맨 아래에 sticky bottom-0 으로 붙인다(bodyPadding none).
import React, { useState } from 'react';
import { FaStar } from 'react-icons/fa';
import { imageDownloadService, isMobile } from '../models';
import type { DownloadTargetOptions } from '../models/ImageDownloadService';
import type { CharacterPreset, GenericScene } from '../models/types';
import ModalOverlay, { DIALOG_SECONDARY_BTN, DIALOG_SOLID_BTN } from './ModalOverlay';
import {
  GRID_PICK_TEXT,
  gridPickSavePathOverride,
  initialGridPick,
  pickAllGrid,
  pickedInGridOrder,
  pickNoneGrid,
  toggleGridPick,
} from '../models/gridDownloadPick';

export interface GridDownloadPickerProps {
  sceneName: string;
  /** 그리드 보기 순서의 전체 경로(번호 = 이 순서, 1부터) — 창을 연 때의 목록 */
  paths: readonly string[];
  /** 그리드 선택 모드에서 이미 고른 경로(없으면 전부 켜짐으로 시작) */
  preselected: readonly string[];
  isFavorite?: (path: string) => boolean;
  /** 「프리셋으로 내보내기…」 버튼을 둘지(선택 창의 canExport 와 같은 값) */
  canExport: boolean;
  /** 파일명 미리보기용 — 저장과 같은 씬·캐릭터 프리셋(접두사·접미사)을 넘긴다 */
  scene: GenericScene;
  characterPreset?: CharacterPreset;
  /**
   * 고른 경로(그리드 순서) — 창은 호출부가 닫는다. opts.savePath = 창에서 바꾼 이번에만 쓰는 저장 폴더
   * (바꾸지 않았으면 opts 없음 = 평소 다운로드와 완전히 같음)
   */
  onDownload: (paths: string[], opts?: DownloadTargetOptions) => void;
  onExport: (paths: string[]) => void;
  onClose: () => void;
}

// 번호 칸 최소 폭 — 모바일은 손가락으로 누를 크기(높이도 모바일 h-11 · PC h-8)
const CELL_MIN_PX = { mobile: 48, pc: 40 };

const GridDownloadPicker = ({
  sceneName,
  paths,
  preselected,
  isFavorite,
  canExport,
  scene,
  characterPreset,
  onDownload,
  onExport,
  onClose,
}: GridDownloadPickerProps) => {
  const [picked, setPicked] = useState<Set<string>>(() => initialGridPick(paths, preselected));
  const ordered = pickedInGridOrder(paths, picked);
  const n = ordered.length;
  // 저장 폴더 — 창을 연 때의 설정 값(lastSavePath)을 복사해 들고, [바꾸기]는 이 창의 값만 바꾼다(설정·config 불변,
  // 창이 닫히면 사라짐). 폴더를 고를 수 없는 플랫폼(모바일)은 칸을 그리지 않는다 — 판정은 서비스 한 곳.
  const showFolder = imageDownloadService.supportsSaveFolder;
  const [defaultPath] = useState<string | undefined>(() => imageDownloadService.settings.lastSavePath);
  const [savePath, setSavePath] = useState<string | undefined>(defaultPath);
  const override = gridPickSavePathOverride(savePath, defaultPath);
  const changeFolder = async () => {
    const p = await imageDownloadService.pickFolderOnce();
    if (p) setSavePath(p);
  };
  // 파일명 미리보기 — 저장과 같은 규칙 함수(ImageDownloadService.buildDownloadNamePreview), 고른 것이 바뀌면 바로 따라 바뀐다
  const preview = imageDownloadService.previewDownloadNames(scene, ordered, characterPreset);

  const toolbar = (
    <>
      <span className="text-sm text-muted" data-grid-pick-count>
        {GRID_PICK_TEXT.count(n, paths.length)}
      </span>
      <div className="ml-auto flex items-center gap-3">
        <button type="button" className="text-xs btn-link" onClick={() => setPicked(pickAllGrid(paths))}>
          {GRID_PICK_TEXT.selectAll}
        </button>
        <button type="button" className="text-xs btn-link" onClick={() => setPicked(pickNoneGrid())}>
          {GRID_PICK_TEXT.clearAll}
        </button>
      </div>
    </>
  );

  // 한 자리에 색 있는 버튼은 주 동작 하나만 — 다운로드 = 초록(다운로드 색 규약), 나머지 회색
  const footer = (
    <>
      <button
        type="button"
        className={`${DIALOG_SOLID_BTN} btn-solid-green`}
        disabled={n === 0}
        onClick={() => (override ? onDownload(ordered, { savePath: override }) : onDownload(ordered))}
        data-grid-pick-download
      >
        {GRID_PICK_TEXT.download(n)}
      </button>
      {canExport && (
        <button
          type="button"
          className={DIALOG_SECONDARY_BTN}
          disabled={n === 0}
          onClick={() => onExport(ordered)}
          data-grid-pick-export
        >
          {GRID_PICK_TEXT.exportPicked}
        </button>
      )}
      <button type="button" className={DIALOG_SECONDARY_BTN} onClick={onClose}>
        {GRID_PICK_TEXT.cancel}
      </button>
    </>
  );

  return (
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      title={GRID_PICK_TEXT.title(sceneName)}
      size="m"
      toolbar={toolbar}
      footer={footer}
      bodyPadding="none"
    >
      {/* 번호 격자는 창 본문이 스크롤한다(안쪽 스크롤 없음 — 스크롤 안 스크롤 방지). 여백은 본문 대신 여기서(p-5) */}
      <div
        className="grid gap-2 p-5"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? CELL_MIN_PX.mobile : CELL_MIN_PX.pc}px, 1fr))`,
        }}
        data-grid-pick-list
      >
        {paths.map((path, i) => {
          const on = picked.has(path);
          const fav = !!isFavorite?.(path);
          return (
            <button
              key={path}
              type="button"
              aria-pressed={on}
              aria-label={GRID_PICK_TEXT.numberLabel(i + 1, fav)}
              title={GRID_PICK_TEXT.numberLabel(i + 1, fav)}
              className={
                'round-button relative justify-center tabular-nums text-sm ' +
                (isMobile ? 'h-11 ' : 'h-8 ') +
                // 켜짐 = 바탕색만(back-sky) — 수백 개가 한꺼번에 켜지는 목록이라 .toggle-on 의 링은 두지 않는다(2026-11-23 사용자: 어수선함)
                (on ? 'back-sky' : 'back-gray')
              }
              onClick={() => setPicked((prev) => toggleGridPick(prev, path))}
            >
              {i + 1}
              {fav && (
                // 즐겨찾기 표시 = 그리드 칸과 같은 노란 별(ResultViewer 칸 왼쪽 위 FaStar text-yellow-400)
                <FaStar
                  aria-hidden
                  className="absolute top-0.5 right-0.5 text-yellow-400"
                  size={9}
                  data-grid-pick-fav
                />
              )}
            </button>
          );
        })}
      </div>
      {/* 붙박이 아래 구역 — 본문 스크롤의 맨 아래에 sticky(격자가 길어도 늘 보임), 바탕 = 창과 같은 --c-zone */}
      <div
        className="sticky bottom-0 px-5 py-3 border-t line-color bg-[var(--c-zone)] space-y-2 text-xs"
        data-grid-pick-info
      >
        {showFolder ? (
          <div data-grid-pick-folder>
            <div className="flex items-center gap-2">
              <span className="flex-none gray-label">{GRID_PICK_TEXT.folderLabel}</span>
              <span
                className="flex-1 min-w-0 truncate rounded px-2 py-1 bg-[var(--c-surface-2)] text-body"
                title={savePath || GRID_PICK_TEXT.folderUnset}
                data-grid-pick-folder-path
              >
                {savePath || GRID_PICK_TEXT.folderUnset}
              </span>
              <button
                type="button"
                className="flex-none round-button back-gray text-xs h-7"
                onClick={() => void changeFolder()}
                data-grid-pick-folder-change
              >
                {GRID_PICK_TEXT.folderChange}
              </button>
            </div>
            {override && (
              <div className="mt-1 flex items-center gap-3" data-grid-pick-folder-temp>
                <span className="text-muted">{GRID_PICK_TEXT.folderTemporary}</span>
                <button
                  type="button"
                  className="ml-auto flex-none text-xs btn-link"
                  onClick={() => setSavePath(defaultPath)}
                  data-grid-pick-folder-reset
                >
                  {GRID_PICK_TEXT.folderReset}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-muted" data-grid-pick-mobile-folder>
            {GRID_PICK_TEXT.mobileFolder}
          </div>
        )}
        <div data-grid-pick-preview>
          <div className="gray-label mb-0.5">{GRID_PICK_TEXT.previewLabel}</div>
          {preview.names.length === 0 ? (
            <div className="text-muted">{GRID_PICK_TEXT.previewEmpty}</div>
          ) : (
            <ul className="text-body">
              {preview.names.map((name, i) => (
                <li key={i} className="truncate" title={name} data-grid-pick-preview-name>
                  {name}
                </li>
              ))}
              {preview.rest > 0 && (
                <li className="text-muted" data-grid-pick-preview-rest>
                  {GRID_PICK_TEXT.previewRest(preview.rest)}
                </li>
              )}
            </ul>
          )}
          {preview.timestampMark && (
            <div className="text-faint mt-0.5" data-grid-pick-preview-ts>
              {GRID_PICK_TEXT.previewTimestampNote(preview.timestampMark)}
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
};

export default GridDownloadPicker;
