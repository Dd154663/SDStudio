// 이미지 상세 보기의 「정보 칸」(2026-11-22 상세 보기 개편). 내용 규칙은 models/imageDetailInfo(순수 함수)가 정하고,
// 여기서는 그리기만 한다. PC 넓은 폭·좁은 폭 클래식·모바일 V2 시트가 같은 컴포넌트를 쓴다(내용 공용).
// · part(2026-11-23 열 배치): 'prompt' = 요약 칩·안내·프롬프트·네거티브·캐릭터(PC 프롬프트 열),
//   'detail' = 생성 설정·참조 이미지·파일·프롬프트 구획(PC 상세 열), 'all'(기본) = 한 열에 같은 순서로 전부
//   (좁은 폭 클래식·V2·PC 에서 본문이 좁아 합친 경우). 묶음 내용·순서·숨김은 models/imageDetailInfo 그대로.
// · 스크롤은 바깥(정보 칸)이 맡는다 — 이 컴포넌트는 세로 스크롤을 만들지 않는다(프롬프트 상자의 상한 넘침만 상자 안 스크롤).
// · 복사 = navigator.clipboard.writeText + 기존 토스트(작가 라이브러리의 「프롬프트 복사」와 같은 방식).
import React, { useState } from 'react';
import { FaChevronRight } from 'react-icons/fa';
import { PromptHighlighter } from './SceneEditor';
import { ActionIcon } from './ActionIcon';
import { appState } from '../models/AppService';
import type { ImportableMetadata } from '../models/types';
import {
  DETAIL_INFO_TEXT,
  type DetailReference,
  type DetailRow,
  type ImageDetailInfoModel,
} from '../models/imageDetailInfo';
import { detailPromptChips } from '../models/imageDetailInfoOpen';

/** 프롬프트 상자 — 내용만큼 자라고 상한(max-h-60 = 240px)을 넘으면 상자 안 스크롤 */
export const DETAIL_PROMPT_BOX = 'w-full max-h-60 overflow-auto p-2 rounded-md text-sm';

export async function copyDetailText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    appState.pushMessage(message, 'success');
  } catch (e) {
    appState.pushMessage('복사하지 못했습니다.', 'error');
  }
}

const CopyButton = ({ text, label, message }: { text: string; label: string; message: string }) => (
  <button
    type="button"
    className="icon-button icon-only text-xs"
    title={label}
    aria-label={label}
    onClick={() => void copyDetailText(text, message)}
  >
    <ActionIcon id="copy" size={12} />
  </button>
);

const GroupHead = ({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-2 mb-1 min-h-6">
    <span className="gray-label text-sm font-semibold">{title}</span>
    {right}
  </div>
);

const RowTable = ({ rows, attr }: { rows: DetailRow[]; attr: string }) => (
  <dl
    {...{ [attr]: '' }}
    className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1 text-sm"
  >
    {rows.map((r) => (
      <React.Fragment key={r.key}>
        <dt className="text-sub">{r.label}</dt>
        <dd className="text-default min-w-0 break-all tabular-nums flex items-center gap-1">
          {r.key === 'filename' ? <span className="break-all">{r.value}</span> : <span>{r.value}</span>}
          {r.copy && (
            <CopyButton text={r.copy} label={`${r.label} 복사`} message={`${r.label}을(를) 복사했습니다`} />
          )}
        </dd>
      </React.Fragment>
    ))}
  </dl>
);

const RefList = ({
  items,
  images,
}: {
  items: DetailReference[];
  images?: string[];
}) => (
  <div className="flex flex-col gap-1.5">
    {items.map((it) => (
      <div key={it.index} className="flex items-center gap-2 text-sm">
        {it.hasImage && images?.[it.index] && (
          <img
            src={`data:image/png;base64,${images[it.index]}`}
            alt=""
            draggable={false}
            className="w-10 h-10 flex-none object-cover rounded border line-color"
          />
        )}
        <span className="text-faint tabular-nums flex-none">{it.index + 1}</span>
        <span className="text-default min-w-0 tabular-nums">{it.text}</span>
      </div>
    ))}
  </div>
);

export interface ImageDetailInfoProps {
  info: ImageDetailInfoModel;
  /** 참조 이미지 작은 그림용(메타에 든 base64 를 그대로 읽는다 — 복사본을 만들지 않음) */
  job?: ImportableMetadata;
  /** 어느 쪽을 그릴지 — 'prompt'(PC 프롬프트 열)·'detail'(PC 상세 열)·'all'(한 열 전부, 기본) */
  part?: ImageDetailInfoPart;
  /** 이미지 읽기 실패 — 「생성 정보가 없습니다」 안내를 띄우지 않는다(정보가 없는 게 아니라 못 읽은 것) */
  loadFailed?: boolean;
}

export type ImageDetailInfoPart = 'all' | 'prompt' | 'detail';

export const ImageDetailInfo = ({ info, job, part = 'all', loadFailed }: ImageDetailInfoProps) => {
  const [partsOpen, setPartsOpen] = useState(false);
  const showPromptSide = part !== 'detail';
  const showDetailSide = part !== 'prompt';
  // 프롬프트 열만 그릴 때는 메타가 없어도 해상도 칩을 올린다(상세 열이 접혀 있어도 해상도가 보이게).
  // 한 열 전부('all')는 종전대로 — 해상도는 파일 묶음에 있다.
  const chips = part === 'prompt' ? detailPromptChips(info) : info.chips;

  const left: React.ReactNode[] = [];
  const right: React.ReactNode[] = [];
  if (info.prompt) {
    left.push(
      <section key="prompt" data-detail-group="prompt" className="min-w-0">
        <GroupHead
          title="프롬프트"
          right={<CopyButton text={info.prompt} label="프롬프트 복사" message="프롬프트를 복사했습니다" />}
        />
        <PromptHighlighter text={info.prompt} className={DETAIL_PROMPT_BOX} />
      </section>,
    );
  }
  if (info.uc) {
    left.push(
      <section key="uc" data-detail-group="uc" className="min-w-0">
        <GroupHead
          title="네거티브 프롬프트"
          right={<CopyButton text={info.uc} label="네거티브 프롬프트 복사" message="네거티브 프롬프트를 복사했습니다" />}
        />
        <PromptHighlighter text={info.uc} className={DETAIL_PROMPT_BOX} />
      </section>,
    );
  }
  info.characters.forEach((c) => {
    const name = `캐릭터 ${c.index + 1}`;
    left.push(
      <section
        key={`char-${c.index}`}
        data-detail-group="character"
        className="min-w-0 border line-color rounded-md r-card p-2"
      >
        <GroupHead
          title={
            <>
              {name}
              {c.position && (
                <span className="ml-2 font-normal text-faint tabular-nums" data-detail-char-position="">
                  위치 {c.position}
                </span>
              )}
            </>
          }
          right={
            c.prompt ? (
              <CopyButton text={c.prompt} label={`${name} 프롬프트 복사`} message={`${name} 프롬프트를 복사했습니다`} />
            ) : undefined
          }
        />
        {c.prompt && <PromptHighlighter text={c.prompt} className={DETAIL_PROMPT_BOX} />}
        {c.uc && (
          <>
            <GroupHead
              title={<span className="font-normal">네거티브</span>}
              right={
                <CopyButton text={c.uc} label={`${name} 네거티브 복사`} message={`${name} 네거티브를 복사했습니다`} />
              }
            />
            <PromptHighlighter text={c.uc} className={DETAIL_PROMPT_BOX} />
          </>
        )}
      </section>,
    );
  });
  if (info.settings.length) {
    right.push(
      <section key="settings" data-detail-group="settings" className="min-w-0">
        <GroupHead title="생성 설정" />
        <RowTable rows={info.settings} attr="data-detail-settings" />
      </section>,
    );
  }
  if (info.vibes.length || info.charRefs.length) {
    right.push(
      <section key="refs" data-detail-group="references" className="min-w-0 flex flex-col gap-2">
        <GroupHead title="참조 이미지" />
        {info.vibes.length > 0 && (
          <div>
            <div className="text-sub text-sm mb-1">바이브 전송 · {info.vibes.length}개</div>
            <RefList items={info.vibes} images={job?.vibeImageData} />
          </div>
        )}
        {info.charRefs.length > 0 && (
          <div>
            <div className="text-sub text-sm mb-1">캐릭터 레퍼런스 · {info.charRefs.length}개</div>
            <RefList items={info.charRefs} images={job?.referenceImageData} />
          </div>
        )}
      </section>,
    );
  }
  if (info.file.length) {
    right.push(
      <section key="file" data-detail-group="file" className="min-w-0">
        <GroupHead title="파일" />
        <RowTable rows={info.file} attr="data-detail-file" />
      </section>,
    );
  }
  if (info.promptParts.length) {
    right.push(
      <section key="parts" data-detail-group="prompt-parts" className="min-w-0">
        <button
          type="button"
          className="btn-ghost w-full flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left"
          aria-expanded={partsOpen}
          onClick={() => setPartsOpen((v) => !v)}
        >
          <FaChevronRight
            size={10}
            className="flex-none text-faint"
            style={{ transform: partsOpen ? 'rotate(90deg)' : undefined }}
          />
          <span className="gray-label text-sm font-semibold">프롬프트 구획</span>
          <span className="text-faint text-xs">SDStudio 생성 정보</span>
        </button>
        {partsOpen && (
          <div className="mt-1 flex flex-col gap-2">
            {info.promptParts.map((p) =>
              p.key === 'workflow' ? (
                <div key={p.key} className="text-sm">
                  <span className="text-sub">{p.label}</span>
                  <span className="ml-3 text-default">{p.text}</span>
                </div>
              ) : (
                <div key={p.key} className="min-w-0">
                  <GroupHead
                    title={<span className="font-normal">{p.label}</span>}
                    right={<CopyButton text={p.text} label={`${p.label} 복사`} message={`${p.label}을(를) 복사했습니다`} />}
                  />
                  <PromptHighlighter text={p.text} className={DETAIL_PROMPT_BOX} />
                </div>
              ),
            )}
          </div>
        )}
      </section>,
    );
  }

  return (
    <div className="w-full min-w-0 flex flex-col gap-3" data-detail-info={part}>
      {showPromptSide && chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-detail-chips="">
          {chips.map((c) => {
            const body = (
              <>
                <span className="text-faint">{c.label}</span>
                <span className="text-default tabular-nums">{c.value}</span>
                {c.copy && <ActionIcon id="copy" size={10} className="text-faint" />}
              </>
            );
            const cls =
              'inline-flex items-center gap-1.5 rounded-md border line-color bg-[var(--c-input-bg)] px-2 py-0.5 text-xs max-w-full';
            return c.copy ? (
              <button
                key={c.key}
                type="button"
                className={cls + ' btn'}
                title={`${c.label} 복사`}
                aria-label={`${c.label} ${c.value} 복사`}
                onClick={() => void copyDetailText(c.copy!, `${c.label}을(를) 복사했습니다`)}
              >
                {body}
              </button>
            ) : (
              <span key={c.key} className={cls}>
                {body}
              </span>
            );
          })}
        </div>
      )}
      {showPromptSide && !info.hasMeta && !loadFailed && (
        <div className="text-sub text-sm" data-detail-no-meta="">
          {DETAIL_INFO_TEXT.noMeta}
        </div>
      )}
      <div className="flex flex-col gap-3 min-w-0">
        {showPromptSide && left}
        {showDetailSide && right}
      </div>
    </div>
  );
};
