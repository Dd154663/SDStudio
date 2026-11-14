// 일괄 삽입 창(2026-11-14 A-3 사용자 결정 — 종전 「찾기 및 변환」 창의 탭을 독립 창으로).
// SPEC_GUIDE 「오버레이 창 크기 체계」 창별 배정표 「일괄 삽입」, jest overlayBatchInsert.test.tsx.
//
// · 창 = ModalOverlay l. aside = 공용 씬 선택(SceneSelectAside — 빈 선택에서 시작, 「생성 n」「변형 n」 칩, 이 창만의 선택),
//   본문 = 삽입할 텍스트(태그 자동완성) + 위치 + 대상(모든 슬롯·열 n만·새 열), 바닥줄 = [적용][닫기], 왼쪽 = 상태 문구.
// · 대상·되돌리기 규칙은 models/batchInsert.ts(이미지생성 씬·조합 변형 = slots, 단일 프롬프트 변형 = preset.prompt, [적용] 1회 = 1항목).
// · 열려 있는 동안만 마운트(닫았다 열면 입력·선택 초기화).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FaPlus } from 'react-icons/fa';
import { appState } from '../models/AppService';
import { backend } from '../models';
import ModalOverlay from './ModalOverlay';
import { SceneSelectAside, useSceneSelection, variantKey } from './SceneSelectAside';
import type { GenericScene } from '../models/types';
import {
  applyBatchInsertRecorded,
  batchInsertSummary,
  batchInsertTotal,
  countBatchInsert,
  hasSlotTargets,
  isInsertableVariant,
  maxSlotRowOf,
} from '../models/batchInsert';
import type { BatchInsertCounts, InsertPosition, InsertSlotTarget } from '../models/batchInsert';

const PRIMARY_BUTTON =
  'px-4 py-2 rounded-lg btn-solid-sky disabled:bg-gray-300 dark:disabled:bg-gray-600 text-sm font-medium transition-colors';
const CLOSE_BUTTON = 'px-4 py-2 rounded-lg btn-neutral text-body text-sm transition-colors';

const BatchInsertBody = observer(() => {
  const session = appState.curSession;
  const sel = useSceneSelection({ initial: 'none', includeVariant: isInsertableVariant });
  const { selectedScenes } = sel;

  const [insertText, setInsertText] = useState('');
  const [position, setPosition] = useState<InsertPosition>('append');
  const [slotTarget, setSlotTarget] = useState<InsertSlotTarget>(0);
  const [done, setDone] = useState<{ counts: BatchInsertCounts; target: InsertSlotTarget; position: InsertPosition } | null>(null);

  // 태그 자동완성
  const [acTags, setAcTags] = useState<any[]>([]);
  const [acSelected, setAcSelected] = useState(0);
  const acCntRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // 씬 선택이 바뀌면 완료 문구를 지운다(종전 toggleScene/toggleAll)
  const firstSel = useRef(true);
  useEffect(() => {
    if (firstSel.current) { firstSel.current = false; return; }
    setDone(null);
  }, [selectedScenes]);

  // 선택한 씬 객체(이미지생성 → 변형 순, 세션 순서)
  const targets = useMemo<GenericScene[]>(() => {
    if (!session) return [];
    return [
      ...Array.from(session.scenes.values()).filter((s) => selectedScenes.has(s.name)),
      ...Array.from(session.inpaints.values()).filter((s) => selectedScenes.has(variantKey(s.name))),
    ];
  }, [session, selectedScenes]);

  // 「열 n만」 선택지 = 목록의 slots 처리 대상 전체 기준(선택에 따라 선택지가 늘고 줄지 않게 — 종전 규칙)
  const maxSlotRow = useMemo(() => {
    if (!session) return 0;
    return maxSlotRowOf([...session.scenes.values(), ...Array.from(session.inpaints.values()).filter(isInsertableVariant)]);
  }, [session, session?.scenes.size, session?.inpaints.size]);
  const slotUsable = hasSlotTargets(targets);
  const onlySingle = targets.length > 0 && !slotUsable;
  // 없는 열 번호(열이 하나도 없는 프로젝트의 기본값 「열 1만」 등)는 「모든 슬롯」으로 본다 — 보이는 값 = 실제 동작
  // 단일 프롬프트 변형만 고르면 「모든 슬롯」(열 지정 불가 — models/batchInsert.effectiveSlotTarget 과 같은 규칙, 선택 전에는 그대로)
  const effTarget: InsertSlotTarget = onlySingle
    ? 'all'
    : typeof slotTarget === 'number' && slotTarget >= maxSlotRow
      ? 'all'
      : slotTarget;
  const opts = { text: insertText, position, slotTarget: effTarget };
  const counts = countBatchInsert(targets, opts);
  const total = batchInsertTotal(counts);

  const closeAc = () => { setAcTags([]); setAcSelected(0); };

  const handleInsertInput = (value: string) => {
    setInsertText(value);
    setDone(null);
    // 마지막 콤마 이후의 현재 단어 추출
    const lastComma = value.lastIndexOf(',');
    const curWord = value.substring(lastComma + 1).trim();
    if (!curWord) { closeAc(); return; }
    acCntRef.current++;
    const myId = acCntRef.current;
    backend.searchTags(curWord).then((tags: any[]) => {
      if (myId !== acCntRef.current) return;
      if (tags.length > 0) { setAcTags(tags.slice(0, 8)); setAcSelected(0); }
      else closeAc();
    });
  };

  const acceptAcTag = (idx: number) => {
    const tag = acTags[idx];
    const tagWord = tag.redirect?.trim() !== 'null' ? tag.redirect?.trim() : tag.word;
    // 마지막 콤마 이후를 교체
    const lastComma = insertText.lastIndexOf(',');
    const before = lastComma >= 0 ? insertText.substring(0, lastComma + 1) + ' ' : '';
    setInsertText(before + tagWord);
    closeAc();
    inputRef.current?.focus();
  };

  const handleInsertKeyDown = (e: React.KeyboardEvent) => {
    if (acTags.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcSelected((s) => (s + 1) % acTags.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcSelected((s) => (s - 1 + acTags.length) % acTags.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptAcTag(acSelected); return; }
      // 자동완성만 닫는다 — 전파를 멈춰 닫기 관문이 창까지 닫지 않게(2026-10-03 U1·X2)
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAc(); return; }
    }
  };

  const noScenes = sel.sceneList.length === 0;
  const canApply = !noScenes && selectedScenes.size > 0 && !!insertText.trim() && total > 0;

  const doInsert = () => {
    if (!canApply) return;
    // 되돌리기: [적용] 1회 = 1항목(이미지생성·변형 씬 묶음, 바뀐 씬만) — models/batchInsert.applyBatchInsertRecorded
    const out = applyBatchInsertRecorded(session, targets, opts);
    setDone({ counts: out, target: effTarget, position });
  };

  const close = () => appState.closeBatchInsert();

  const body = noScenes ? (
    <div className="text-sm text-faint" data-batch-insert-panel="">씬이 없습니다.</div>
  ) : (
    <div className="flex flex-col gap-4" data-batch-insert-panel="">
      {/* 삽입 텍스트 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">삽입할 텍스트</label>
        <div className="relative">
          <FaPlus className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" size={12} />
          <input ref={inputRef} type="text" placeholder="태그 입력 (예: 1girl, masterpiece)" value={insertText}
            onChange={(e) => handleInsertInput(e.target.value)}
            onKeyDown={handleInsertKeyDown}
            onBlur={() => setTimeout(closeAc, 150)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
          {acTags.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[var(--c-zone)] border line-color rounded-lg shadow-lg overflow-hidden">
              {acTags.map((tag, i) => (
                <div key={tag.word + i}
                  onMouseDown={(e) => { e.preventDefault(); acceptAcTag(i); }}
                  className={`px-3 py-1.5 text-sm cursor-pointer flex justify-between ${
                    i === acSelected
                      ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10'
                  }`}>
                  <span className="truncate">{tag.word}</span>
                  {tag.count != null && <span className="text-xs text-faint ml-2 flex-none">{tag.count}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="text-xs text-faint mt-1">
          태그 삽입 시 구분자(,)는 삽입 위치에 맞게 자동으로 추가됩니다.
        </div>
      </div>

      {/* 삽입 위치 + 대상 슬롯 */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">위치:</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="batchInsertPos" checked={position === 'prepend'} onChange={() => { setPosition('prepend'); setDone(null); }} />
            <span className="text-sm text-gray-700 dark:text-gray-300">앞에 추가</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="batchInsertPos" checked={position === 'append'} onChange={() => { setPosition('append'); setDone(null); }} />
            <span className="text-sm text-gray-700 dark:text-gray-300">뒤에 추가</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">대상:</span>
          <select
            data-batch-insert-target=""
            value={effTarget === 'all' ? 'all' : effTarget === 'new-column' ? 'new-column' : String(effTarget)}
            onChange={(e) => {
              const v = e.target.value;
              setSlotTarget(v === 'all' ? 'all' : v === 'new-column' ? 'new-column' : Number(v));
              setDone(null);
            }}
            className="text-sm rounded border line-color bg-[var(--c-input-bg)] text-default px-2 py-1"
          >
            <option value="all">모든 슬롯</option>
            {/* 「열 n만」「새 열」은 slots 가 있는 씬(이미지생성·조합 변형)에만 — 단일 프롬프트 변형만 고르면 비활성 */}
            {Array.from({ length: maxSlotRow }, (_, i) => (
              <option key={i} value={i} disabled={onlySingle}>열 {i + 1}만</option>
            ))}
            <option value="new-column" disabled={onlySingle}>새 열로 추가</option>
          </select>
        </div>
      </div>
      {onlySingle && (
        <div className="text-xs text-faint" data-batch-insert-single-note="">
          고른 씬이 모두 단일 프롬프트 변형이라 「열 n만」「새 열로 추가」는 쓸 수 없습니다 — 프롬프트 앞/뒤에 삽입합니다.
        </div>
      )}
      {!onlySingle && counts.singlePrompt > 0 && (
        <div className="text-xs text-faint" data-batch-insert-single-note="">
          단일 프롬프트 변형(조합 모드가 아닌 I2I·인페인트)은 열 지정과 관계없이 프롬프트 앞/뒤에 삽입합니다.
        </div>
      )}
    </div>
  );

  // 상태 문구 — 선택 없음 → 완료 → 미리보기 순
  const status = noScenes ? null : selectedScenes.size === 0 ? (
    <span className="text-sm text-muted" data-batch-insert-status="">씬을 선택하세요</span>
  ) : done !== null ? (
    <div className="text-sm text-green-600 dark:text-green-400 font-medium" data-batch-insert-status="">
      ✓ {batchInsertSummary(done.counts, done.target, done.position, 'done')}
    </div>
  ) : (
    <span className="text-sm text-muted" data-batch-insert-status="">
      {insertText.trim() ? batchInsertSummary(counts, effTarget, position, 'preview') : '삽입할 텍스트를 입력하세요'}
    </span>
  );

  return (
    <ModalOverlay
      isOpen={true}
      onClose={close}
      title="일괄 삽입"
      size="l"
      aside={<SceneSelectAside sel={sel} />}
      footerStart={status}
      footer={
        <>
          <button onClick={doInsert} disabled={!canApply} className={PRIMARY_BUTTON}>
            적용
          </button>
          <button onClick={close} className={CLOSE_BUTTON}>닫기</button>
        </>
      }
    >
      {body}
    </ModalOverlay>
  );
});

const BatchInsertDialog = observer(() => {
  if (!appState.batchInsertOpen) return null;
  return <BatchInsertBody />;
});

export default BatchInsertDialog;
