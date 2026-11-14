import React, { useState, useCallback, useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import {
  isMobile,
  sessionService,
  globalPresetService,
  globalCharacterPresetService,
} from '../models';
import { renameScene } from '../models/SessionService';
import ModalOverlay from './ModalOverlay';
import { SceneSelectAside, useSceneSelection, variantKey } from './SceneSelectAside';
import HelpIcon from './HelpIcon';
import { FaSearch, FaExchangeAlt } from 'react-icons/fa';
import type { InpaintScene } from '../models/types';
import { variantComboMode } from '../models/comboMode';
import { UNDO_TEXT } from '../models/undoService';
import { replaceAllRecorded, unrecordedScopesOf } from '../models/findReplaceUndo';
import type { FindReplaceItem } from '../models/findReplaceUndo';

/**
 * 검색 결과 한 건. setText 가 false 를 반환하면 "건너뜀"(이름 충돌·차단 등).
 * target = 결과가 쓰는 대상의 종류·씬(되돌리기 기록 분기용 — 2026-11-03 2차 P3, 화면 표시와 무관).
 */
type SearchResult = FindReplaceItem;

type SearchScope = 'scene' | 'character' | 'preset' | 'global' | 'sceneNames' | 'projectName';

// 씬 선택 목록의 변형 씬 키(`inpaint:` 접두)는 공용 부품 SceneSelectAside 가 정한다.
// 단일 프롬프트(preset.prompt)를 검색하는 변형 워크플로우(조합 모드가 아닐 때) — models/batchInsert.ts 의 같은 이름 상수와 같은 값
const SINGLE_PROMPT_VARIANTS = new Set(['SDI2I', 'SDInpaint']);

/**
 * 변형 씬의 「씬 프롬프트」 검색 대상(2026-10-04 B4 C6, SPEC §7-4) — 미러·I2I 조합 모드는 조합 슬롯(조각·조각 캐릭터란,
 * 슬롯이 없으면 preset.prompt)과 「복사 시점 1회 복제」의 상위·하위, 단일 프롬프트 I2I·인페인트는 preset.prompt.
 */
function collectVariantResults(scene: InpaintScene, q: string, results: SearchResult[]) {
  const head = `[변형: ${scene.name}]`;
  const preset = scene.preset;
  const mode = variantComboMode(scene);
  const pushPresetField = (key: string, label: string) => {
    if (typeof preset?.[key] === 'string' && preset[key].includes(q)) {
      results.push({
        location: `${head} ${label}`,
        getText: () => preset[key],
        setText: (v) => { preset[key] = v; },
        target: { kind: 'variant', scene },
      });
    }
  };
  if (!mode) {
    if (SINGLE_PROMPT_VARIANTS.has(scene.workflowType)) pushPresetField('prompt', '프롬프트');
    return;
  }
  if (scene.slots.length === 0) pushPresetField('prompt', '중간 프롬프트');
  scene.slots.forEach((slot, si) => {
    slot.forEach((piece, pi) => {
      if (piece.prompt.includes(q)) {
        results.push({
          location: `${head} 프롬프트 슬롯 ${si + 1}-${pi + 1}`,
          getText: () => piece.prompt,
          setText: (v) => {
            // 첫 조각은 preset.prompt 와 이중 보관(편집 창 중간 프롬프트) — 함께 맞춘다
            if (si === 0 && pi === 0 && preset && preset.prompt === piece.prompt) preset.prompt = v;
            piece.prompt = v;
          },
          target: { kind: 'variant', scene },
        });
      }
      piece.characterPrompts.forEach((cp, ci) => {
        if (cp.includes(q)) {
          results.push({
            location: `${head} 슬롯 ${si + 1}-${pi + 1} 캐릭터란 ${ci + 1}`,
            getText: () => piece.characterPrompts[ci],
            setText: (v) => { piece.characterPrompts[ci] = v; },
            target: { kind: 'variant', scene },
          });
        }
      });
    });
  });
  if (mode === 'snapshot') {
    pushPresetField('frontPrompt', '상위 프롬프트(고정)');
    pushPresetField('backPrompt', '하위 프롬프트(고정)');
  }
}

function collectResults(
  query: string,
  scopes: Record<SearchScope, boolean>,
  selectedScenes?: Set<string>,
): SearchResult[] {
  const session = appState.curSession;
  if (!session || !query) return [];

  const results: SearchResult[] = [];
  const q = query;
  const hasFilter = selectedScenes != null && selectedScenes.size > 0;

  if (scopes.scene) {
    for (const scene of session.scenes.values()) {
      if (hasFilter && !selectedScenes!.has(scene.name)) continue;
      const sceneName = scene.name;
      scene.slots.forEach((slot, si) => {
        slot.forEach((piece, pi) => {
          if (piece.prompt.includes(q)) {
            results.push({
              location: `[${sceneName}] 프롬프트 슬롯 ${si + 1}-${pi + 1}`,
              getText: () => piece.prompt,
              setText: (v) => { piece.prompt = v; },
              target: { kind: 'sceneSlots', scene },
            });
          }
          piece.characterPrompts.forEach((cp, ci) => {
            if (cp.includes(q)) {
              results.push({
                location: `[${sceneName}] 슬롯 ${si + 1}-${pi + 1} 캐릭터란 ${ci + 1}`,
                getText: () => piece.characterPrompts[ci],
                setText: (v) => { piece.characterPrompts[ci] = v; },
                target: { kind: 'sceneSlots', scene },
              });
            }
          });
        });
      });
    }
    for (const scene of session.inpaints.values()) {
      if (hasFilter && !selectedScenes!.has(variantKey(scene.name))) continue;
      collectVariantResults(scene, q, results);
    }
  }

  if (scopes.character) {
    for (const scene of session.scenes.values()) {
      if (hasFilter && !selectedScenes!.has(scene.name)) continue;
      if (!scene.sceneCharacterPrompts?.length) continue;
      const sceneName = scene.name;
      scene.sceneCharacterPrompts.forEach((cp, i) => {
        if (cp.prompt.includes(q)) {
          results.push({
            location: `[${sceneName}] 씬 캐릭터 ${i + 1} 프롬프트`,
            getText: () => cp.prompt,
            setText: (v) => { cp.prompt = v; },
            target: { kind: 'sceneCharacter', scene },
          });
        }
        if (cp.uc && cp.uc.includes(q)) {
          results.push({
            location: `[${sceneName}] 씬 캐릭터 ${i + 1} UC`,
            getText: () => cp.uc,
            setText: (v) => { cp.uc = v; },
            target: { kind: 'sceneCharacter', scene },
          });
        }
      });
      if (scene.sceneCharacterUC && scene.sceneCharacterUC.includes(q)) {
        results.push({
          location: `[${sceneName}] 씬 캐릭터 UC`,
          getText: () => scene.sceneCharacterUC,
          setText: (v) => { scene.sceneCharacterUC = v; },
          target: { kind: 'sceneCharacter', scene },
        });
      }
    }
  }

  if (scopes.preset) {
    // 캐릭터 프리셋은 씬에 소속되지 않으므로 씬 필터와 무관하게 항상 검색
    for (const preset of session.characterPresets.values()) {
      const pName = preset.name;
      if (preset.characterPrompt.includes(q)) {
        results.push({
          location: `[프리셋: ${pName}] 캐릭터 프롬프트`,
          getText: () => preset.characterPrompt,
          setText: (v) => { preset.characterPrompt = v; },
          target: { kind: 'characterPreset' },
        });
      }
      if (preset.characterUC && preset.characterUC.includes(q)) {
        results.push({
          location: `[프리셋: ${pName}] 캐릭터 UC`,
          getText: () => preset.characterUC,
          setText: (v) => { preset.characterUC = v; },
          target: { kind: 'characterPreset' },
        });
      }
      if (preset.backgroundPrompt && preset.backgroundPrompt.includes(q)) {
        results.push({
          location: `[프리셋: ${pName}] 배경 프롬프트`,
          getText: () => preset.backgroundPrompt,
          setText: (v) => { preset.backgroundPrompt = v; },
          target: { kind: 'characterPreset' },
        });
      }
    }
  }

  // 글로벌 프리셋(그림체) + 글로벌 캐릭터 프리셋 — 프로젝트(씬 선택)와 무관.
  // 변환 시 updatedAt 을 올리고 저장을 예약한다(글로벌은 세션 자동 저장 밖의
  // 별도 스토어). updatedAt 갱신으로 링크된 로컬 사본도 다음 적용 때 동기화된다.
  if (scopes.global) {
    for (const entry of globalCharacterPresetService.presets) {
      const p = entry.preset as any;
      const touch = () => {
        entry.updatedAt = Date.now();
        globalCharacterPresetService.presets = [
          ...globalCharacterPresetService.presets,
        ];
        globalCharacterPresetService.scheduleSave();
        globalCharacterPresetService.dispatchEvent(new CustomEvent('changed', {}));
      };
      const fields: [string, string][] = [
        ['characterPrompt', '캐릭터 프롬프트'],
        ['characterUC', '캐릭터 UC'],
        ['backgroundPrompt', '배경 프롬프트'],
      ];
      for (const [key, label] of fields) {
        if (typeof p[key] === 'string' && p[key].includes(q)) {
          results.push({
            location: `[글로벌 캐릭터: ${entry.name}] ${label}`,
            getText: () => p[key],
            setText: (v) => { p[key] = v; touch(); },
            target: { kind: 'global' },
          });
        }
      }
    }
    for (const entry of globalPresetService.presets) {
      const p = (entry.preset || {}) as any;
      const touch = () => {
        entry.updatedAt = Date.now();
        globalPresetService.presets = [...globalPresetService.presets];
        globalPresetService.scheduleSave();
        globalPresetService.dispatchEvent(new CustomEvent('changed', {}));
      };
      const fields: [string, string][] = [
        ['frontPrompt', '상위 프롬프트'],
        ['backPrompt', '하위 프롬프트'],
        ['uc', '네거티브 프롬프트'],
      ];
      for (const [key, label] of fields) {
        if (typeof p[key] === 'string' && p[key].includes(q)) {
          results.push({
            location: `[글로벌 프리셋: ${entry.name}] ${label}`,
            getText: () => p[key],
            setText: (v) => { p[key] = v; touch(); },
            target: { kind: 'global' },
          });
        }
      }
    }
  }

  // 이름 검색 — 씬 이름들 먼저, 프로젝트 이름은 맨 마지막(내용 변환이 모두 끝난
  // 뒤에 프로젝트 rename 이 실행되도록 순서 보장). 변환 = 실제 이름변경이라
  // 빈 이름/동명 충돌/창 간 잠금이면 건너뛴다(setText 가 false 반환).
  if (scopes.sceneNames) {
    for (const scene of session.scenes.values()) {
      if (hasFilter && !selectedScenes!.has(scene.name)) continue;
      const sceneName = scene.name;
      if (!sceneName.includes(q)) continue;
      results.push({
        location: `[씬 이름] ${sceneName}`,
        getText: () => sceneName,
        setText: async (v) => {
          const nm = v.trim();
          if (!nm || nm === sceneName) return false;
          if (session.scenes.has(nm)) return false; // 동명 충돌 — 건너뜀
          await renameScene(session, sceneName, nm);
          return session.scenes.has(nm); // 창 간 잠금 차단 시 false
        },
        target: { kind: 'sceneName', scene },
      });
    }
  }
  if (scopes.projectName) {
    const projName = session.name;
    if (projName.includes(q)) {
      results.push({
        location: `[프로젝트 이름] ${projName}`,
        getText: () => projName,
        setText: async (v) => {
          const nm = v.trim();
          if (!nm || nm === projName) return false;
          if (sessionService.list().includes(nm)) return false; // 동명 충돌
          await sessionService.get(projName);
          try {
            await sessionService.renameProject(projName, nm);
          } catch (e) {
            console.error('프로젝트 이름 변환 실패:', e);
            return false;
          }
          // 이름 변경은 세션 인스턴스를 그대로 새 이름으로 옮긴다(되돌리기 스택 유지). 다른 창 잠금(구 배치 rename 은
          // 조용히 돌아옴)으로 바뀌지 않았으면 건너뜀으로 센다(종전엔 성공으로 셌다 — 2026-11-03 2차 P3 안내 판정용).
          const sess = sessionService.getLoaded(nm);
          if (sess) sess.name = nm;
          return !!sess;
        },
        target: { kind: 'projectName' },
      });
    }
  }

  return results;
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const idx = text.indexOf(query);
  if (idx === -1) return <span className="text-muted text-xs truncate">{text}</span>;

  const ctxLen = 20;
  const start = Math.max(0, idx - ctxLen);
  const end = Math.min(text.length, idx + query.length + ctxLen);

  const before = (start > 0 ? '…' : '') + text.slice(start, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length, end) + (end < text.length ? '…' : '');

  return (
    <span className="text-xs break-all">
      <span className="text-muted">{before}</span>
      <span className="bg-yellow-200 dark:bg-yellow-700 text-default font-semibold rounded px-0.5">{match}</span>
      <span className="text-muted">{after}</span>
    </span>
  );
}

interface PanelParts {
  body: React.ReactNode;
  footer: React.ReactNode;
  status: React.ReactNode;
}

const CLOSE_BUTTON = 'px-4 py-2 rounded-lg btn-neutral text-body text-sm transition-colors';

/* ═══════════════════════════════════════════════════════════════════
   찾기/변환 — 본문·바닥줄·상태 문구를 함께 돌려주는 훅
   ═══════════════════════════════════════════════════════════════════ */
const FIND_HELP =
  '선택한 씬의 텍스트를 검색하고 일괄 변환합니다.\n' +
  '캐릭터 프리셋·글로벌 프리셋은 씬 선택과 무관하며, 해당 검색 범위를 끄면 제외됩니다.\n' +
  "'씬 이름'/'프로젝트 이름' 범위의 변환은 실제 이름변경으로 실행되며, 동명 충돌 항목은 건너뜁니다.\n" +
  '공백 검색: 검색어의 공백을 그대로 사용합니다(공백만 검색해 다른 문자로 일괄 변환 가능).';

function useFindPanel(
  searchInputRef: React.RefObject<HTMLInputElement>,
  selectedScenes: Set<string>,
): PanelParts {
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [scopes, setScopes] = useState<Record<SearchScope, boolean>>({ scene: true, character: true, preset: false, global: false, sceneNames: false, projectName: false });
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [replaceComplete, setReplaceComplete] = useState<number | null>(null);
  const [replaceSkipped, setReplaceSkipped] = useState(0);
  // 바뀌었지만 되돌리기에 담지 않은 범위 안내(글로벌 프리셋·프로젝트 이름 — 2차 P3)
  const [replaceNotice, setReplaceNotice] = useState<string | null>(null);
  // 공백 검색: 검색어를 trim 하지 않고 그대로 사용 — 공백만으로도 검색/변환 가능
  // (예: 공백 → 언더스코어 일괄 치환)
  const [wsSearch, setWsSearch] = useState(false);

  // 씬 선택(씬·종류 칩)이 바뀌면 종전 toggleScene/toggleAll 처럼 결과를 비운다
  const firstSel = useRef(true);
  useEffect(() => {
    if (firstSel.current) { firstSel.current = false; return; }
    setSearched(false); setResults([]); setReplaceComplete(null);
  }, [selectedScenes]);

  // 공백 검색 모드면 공백만으로도 검색 허용(trim 가드 해제)
  const canSearch = wsSearch ? searchText.length > 0 : !!searchText.trim();

  const doSearch = useCallback(() => {
    if (!(wsSearch ? searchText.length > 0 : searchText.trim())) return;
    setResults(collectResults(searchText, scopes, selectedScenes));
    setSearched(true);
    setReplaceComplete(null);
    setReplaceSkipped(0);
  }, [searchText, scopes, selectedScenes, wsSearch]);

  const doReplaceAll = useCallback(async () => {
    if (results.length === 0) return;
    // 되돌리기(2026-11-03 2차 P3): 한 번의 「모두 변환」 = 1항목(프로젝트 범위 — 씬 조합·씬 캐릭터·변형 씬·캐릭터 프리셋·씬 이름).
    // 글로벌 프리셋·프로젝트 이름은 기록하지 않고(사용자 결정 D4), 실제로 바뀌었으면 결과 문구에 안내한다.
    // 이름 변환(씬/프로젝트 rename)은 비동기 — 안에서 순차 await.
    const out = await replaceAllRecorded(appState.curSession, results, searchText, replaceText);
    setReplaceComplete(out.replaced);
    setReplaceSkipped(out.skipped);
    setReplaceNotice(out.notUndone.length > 0 ? UNDO_TEXT.findReplaceNotUndone(out.notUndone) : null);
    setResults(collectResults(searchText, scopes, selectedScenes));
    setSearched(true);
  }, [results, searchText, replaceText, scopes, selectedScenes]);

  // 「모두 변환」 확인 1회 — Enter·버튼 공용(발견 A11: 버튼은 확인 없이 즉시였다). 글로벌 프리셋·프로젝트 이름 변경은
  // 되돌릴 수 없음을 결과에 그 범위가 있을 때만 알린다(프로젝트 범위는 되돌리기 가능).
  const confirmReplaceAll = useCallback(() => {
    if (results.length === 0) return;
    void appState
      .confirmAsync({
        text: UNDO_TEXT.findReplaceConfirm(results.length, searchText, replaceText, unrecordedScopesOf(results)),
        confirmText: UNDO_TEXT.findReplaceConfirmButton,
        danger: true,
      })
      .then((ok) => {
        if (ok) void doReplaceAll();
      });
  }, [results, searchText, replaceText, doReplaceAll]);

  const toggleScope = (scope: SearchScope) => {
    setScopes((prev) => ({ ...prev, [scope]: !prev[scope] }));
    setSearched(false); setResults([]); setReplaceComplete(null);
  };

  const scopeBoxes: [SearchScope, string][] = [
    ['scene', '씬 프롬프트'],
    ['character', '캐릭터 프롬프트'],
    ['preset', '캐릭터 프리셋'],
    ['global', '글로벌 프리셋'],
    ['sceneNames', '씬 이름'],
    ['projectName', '프로젝트 이름'],
  ];
  const hasResults = searched && results.length > 0;

  const body = (
    <div className={isMobile ? 'flex flex-col gap-4' : 'flex-1 min-h-0 flex flex-col gap-4'} data-find-panel="find">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 flex-none">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-none">검색 범위:</span>
        {scopeBoxes.map(([scope, label]) => (
          <label key={scope} className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={scopes[scope]} onChange={() => toggleScope(scope)} className="rounded line-color" />
            <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-none">
        <div className="relative flex-1">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" size={14} />
          <input ref={searchInputRef} type="text" placeholder={wsSearch ? '검색어 입력 (공백 그대로 검색됨)...' : '검색어 입력...'} value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setSearched(false); setReplaceComplete(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
        </div>
        <button onClick={doSearch} disabled={!canSearch}
          className="px-4 py-2 rounded-lg btn-solid-sky disabled:bg-gray-300 dark:disabled:bg-gray-600 text-sm font-medium transition-colors flex-none">검색</button>
      </div>

      <div className="flex items-center gap-2 -mt-2 flex-none">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={wsSearch}
            onChange={() => { setWsSearch(!wsSearch); setSearched(false); setResults([]); setReplaceComplete(null); }}
            className="rounded line-color" />
          <span className="text-sm text-gray-700 dark:text-gray-300">공백 검색</span>
        </label>
        <HelpIcon content={FIND_HELP} size={13} />
      </div>

      {/* 바꿀 말 — 결과가 있을 때만(종전과 같음). [모두 변환] 은 바닥줄 */}
      {hasResults && (
        <div className="relative flex-none">
          <FaExchangeAlt className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" size={14} />
          <input type="text" placeholder="변환할 텍스트 (빈칸 = 삭제)" value={replaceText}
            onChange={(e) => { setReplaceText(e.target.value); setReplaceComplete(null); }}
            // Enter·[모두 변환] 버튼 모두 확인 1회(2026-10-03 U1·X14, 버튼은 2026-11-03 A11). 프로젝트 범위는 되돌리기로
            // 되돌릴 수 있고, 글로벌 프리셋·프로젝트 이름 변경은 되돌릴 수 없다(확인 창에 표시).
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              confirmReplaceAll();
            }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
        </div>
      )}

      {/* 결과 — PC 는 남은 높이 전부, 모바일은 종전 max-h-48 */}
      <div className={isMobile ? 'flex flex-col gap-2' : 'flex-1 min-h-0 flex flex-col gap-2'}>
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-none" data-find-results-head="">
          검색 결과{searched && <> · <span className="text-sky-500 font-bold">{results.length}</span>건</>}
        </div>
        <div
          className={
            (isMobile ? 'max-h-48' : 'flex-1 min-h-[6rem]') +
            ' overflow-y-auto border line-color rounded-lg divide-y divide-[color:var(--c-line)]'
          }
          data-find-results=""
        >
          {results.map((r, i) => (
            <div key={i} className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-700/50 flex flex-col gap-0.5">
              <span className="text-xs font-medium text-sky-600 dark:text-sky-400">{r.location}</span>
              <HighlightMatch text={r.getText()} query={searchText} />
            </div>
          ))}
          {results.length === 0 && (
            <div className="px-3 py-2 text-xs text-faint">
              {searched ? '검색 결과가 없습니다' : '검색어를 입력하고 [검색]을 누르세요'}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const unrecorded = hasResults ? unrecordedScopesOf(results) : [];
  const status =
    replaceComplete !== null ? (
      <div className="text-sm text-green-600 dark:text-green-400 font-medium" data-find-status="">
        ✓ {replaceComplete}개 항목이 변환되었습니다{results.length > 0 && ` (잔여 ${results.length}개)`}
        {replaceSkipped > 0 && (
          <span className="text-amber-600 dark:text-amber-400"> — {replaceSkipped}개 건너뜀 (이름 충돌/빈 이름 등)</span>
        )}
        {replaceNotice && (
          <div className="text-xs text-amber-600 dark:text-amber-400 font-normal mt-0.5">{replaceNotice}</div>
        )}
      </div>
    ) : hasResults ? (
      <div className="text-sm text-muted" data-find-status="">
        <span className="text-sky-500 font-bold">{results.length}</span>건 발견
        {unrecorded.length > 0 && (
          <div className="text-xs text-amber-600 dark:text-amber-400">{unrecorded.join('·')} 변경은 되돌릴 수 없습니다</div>
        )}
      </div>
    ) : null;

  const footer = (
    <button onClick={confirmReplaceAll} disabled={!hasResults}
      className="px-4 py-2 rounded-lg btn-solid-orange disabled:bg-gray-300 dark:disabled:bg-gray-600 text-sm font-medium transition-colors">
      모두 변환
    </button>
  );

  return { body, footer, status };
}

/* ═══════════════════════════════════════════════════════════════════
   메인 다이얼로그 — l 등급, aside = 공용 씬 선택(componenets/SceneSelectAside, 처음 = 전체 선택), 본문 = 찾기 폼(결과가 남은
   높이 전부), 바닥줄 = [모두 변환] + [닫기], 왼쪽 = 상태 문구. 일괄 삽입은 2026-11-14 A-3 에서 독립 창(BatchInsertDialog)으로
   분리돼 탭이 없다. 열려 있는 동안만 마운트(닫았다 열면 입력·결과 초기화 — 종전과 같음)
   ═══════════════════════════════════════════════════════════════════ */
const FindReplaceBody = observer(() => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sel = useSceneSelection({ initial: 'all' });
  const find = useFindPanel(searchInputRef, sel.selectedScenes);

  useEffect(() => {
    const t = setTimeout(() => searchInputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  const close = () => appState.closeFindReplace();

  return (
    // aside 는 PC·l 에서 왼쪽 열, 모바일은 본문 위에 쌓인다.
    <ModalOverlay
      isOpen={true}
      onClose={close}
      title="찾기 및 변환"
      size="l"
      aside={<SceneSelectAside sel={sel} />}
      footerStart={find.status}
      footer={
        <>
          {find.footer}
          <button onClick={close} className={CLOSE_BUTTON}>닫기</button>
        </>
      }
    >
      {find.body}
    </ModalOverlay>
  );
});

const FindReplaceDialog = observer(() => {
  if (!appState.findReplaceOpen) return null;
  return <FindReplaceBody />;
});

export default FindReplaceDialog;
