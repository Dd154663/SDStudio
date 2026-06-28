import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 as uuidv4 } from 'uuid';
import { appState } from '../models/AppService';
import { backend } from '../models';
import ModalOverlay from './ModalOverlay';
import { FaSearch, FaExchangeAlt, FaPlus } from 'react-icons/fa';
import { Scene, CharacterPreset, PromptPiece } from '../models/types';

/** 검색 결과 한 건 */
interface SearchResult {
  location: string;
  getText: () => string;
  setText: (v: string) => void;
}

type SearchScope = 'scene' | 'character' | 'preset';

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
            });
          }
          piece.characterPrompts.forEach((cp, ci) => {
            if (cp.includes(q)) {
              results.push({
                location: `[${sceneName}] 슬롯 ${si + 1}-${pi + 1} 캐릭터란 ${ci + 1}`,
                getText: () => piece.characterPrompts[ci],
                setText: (v) => { piece.characterPrompts[ci] = v; },
              });
            }
          });
        });
      });
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
          });
        }
        if (cp.uc && cp.uc.includes(q)) {
          results.push({
            location: `[${sceneName}] 씬 캐릭터 ${i + 1} UC`,
            getText: () => cp.uc,
            setText: (v) => { cp.uc = v; },
          });
        }
      });
      if (scene.sceneCharacterUC && scene.sceneCharacterUC.includes(q)) {
        results.push({
          location: `[${sceneName}] 씬 캐릭터 UC`,
          getText: () => scene.sceneCharacterUC,
          setText: (v) => { scene.sceneCharacterUC = v; },
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
        });
      }
      if (preset.characterUC && preset.characterUC.includes(q)) {
        results.push({
          location: `[프리셋: ${pName}] 캐릭터 UC`,
          getText: () => preset.characterUC,
          setText: (v) => { preset.characterUC = v; },
        });
      }
      if (preset.backgroundPrompt && preset.backgroundPrompt.includes(q)) {
        results.push({
          location: `[프리셋: ${pName}] 배경 프롬프트`,
          getText: () => preset.backgroundPrompt,
          setText: (v) => { preset.backgroundPrompt = v; },
        });
      }
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

/* ═══════════════════════════════════════════════════════════════════
   찾기/변환 탭
   ═══════════════════════════════════════════════════════════════════ */
const FindTab = ({ searchInputRef }: { searchInputRef: React.RefObject<HTMLInputElement> }) => {
  const session = appState.curSession;
  const sceneList = useMemo(() => {
    if (!session) return [];
    return Array.from(session.scenes.values()).map((s) => s.name);
  }, [session, session?.scenes.size]);

  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [scopes, setScopes] = useState<Record<SearchScope, boolean>>({ scene: true, character: true, preset: false });
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [replaceComplete, setReplaceComplete] = useState<number | null>(null);
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(() => new Set(sceneList));
  const [sceneFilter, setSceneFilter] = useState('');

  // 씬 리스트가 변경되면 전체 선택으로 초기화
  useEffect(() => {
    setSelectedScenes(new Set(sceneList));
  }, [sceneList.length]);

  const filteredSceneList = useMemo(() => {
    if (!sceneFilter.trim()) return sceneList;
    const q = sceneFilter.toLowerCase();
    return sceneList.filter((name) => name.toLowerCase().includes(q));
  }, [sceneList, sceneFilter]);

  const toggleScene = (name: string) => {
    setSelectedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
    setSearched(false); setResults([]); setReplaceComplete(null);
  };

  const toggleAll = () => {
    const target = filteredSceneList;
    const allSelected = target.every((name) => selectedScenes.has(name));
    setSelectedScenes((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        target.forEach((name) => next.delete(name));
      } else {
        target.forEach((name) => next.add(name));
      }
      return next;
    });
    setSearched(false); setResults([]); setReplaceComplete(null);
  };

  const doSearch = useCallback(() => {
    if (!searchText.trim()) return;
    setResults(collectResults(searchText, scopes, selectedScenes));
    setSearched(true);
    setReplaceComplete(null);
  }, [searchText, scopes, selectedScenes]);

  const doReplaceAll = useCallback(() => {
    if (results.length === 0) return;
    let replaced = 0;
    for (const r of results) {
      const cur = r.getText();
      const next = cur.replaceAll(searchText, replaceText);
      if (cur !== next) { r.setText(next); replaced++; }
    }
    setReplaceComplete(replaced);
    setResults(collectResults(searchText, scopes, selectedScenes));
    setSearched(true);
  }, [results, searchText, replaceText, scopes, selectedScenes]);

  const toggleScope = (scope: SearchScope) => {
    setScopes((prev) => ({ ...prev, [scope]: !prev[scope] }));
    setSearched(false); setResults([]); setReplaceComplete(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-none">검색 범위:</span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={scopes.scene} onChange={() => toggleScope('scene')} className="rounded border-gray-300 dark:border-gray-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300">씬 프롬프트</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={scopes.character} onChange={() => toggleScope('character')} className="rounded border-gray-300 dark:border-gray-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300">캐릭터 프롬프트</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={scopes.preset} onChange={() => toggleScope('preset')} className="rounded border-gray-300 dark:border-gray-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300">캐릭터 프리셋</span>
        </label>
      </div>

      {/* 씬 선택 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">씬 선택</span>
          <button onClick={toggleAll} className="text-xs text-sky-500 hover:text-sky-600">
            {filteredSceneList.every((n) => selectedScenes.has(n)) ? '전체 해제' : '전체 선택'}
            {sceneFilter.trim() && ` (${filteredSceneList.length}개)`}
          </button>
        </div>
        <input type="text" placeholder="씬 이름 검색..." value={sceneFilter}
          onChange={(e) => setSceneFilter(e.target.value)}
          className="w-full mb-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
        <div className="max-h-36 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg p-2 space-y-1">
          {filteredSceneList.map((name) => (
            <label key={name} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 rounded px-1 py-0.5">
              <input type="checkbox" checked={selectedScenes.has(name)} onChange={() => toggleScene(name)}
                className="rounded border-gray-300 dark:border-gray-600" />
              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{name}</span>
            </label>
          ))}
          {filteredSceneList.length === 0 && (
            <div className="text-xs text-gray-400 py-1">일치하는 씬이 없습니다</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input ref={searchInputRef} type="text" placeholder="검색어 입력..." value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setSearched(false); setReplaceComplete(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
        </div>
        <button onClick={doSearch} disabled={!searchText.trim()}
          className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white text-sm font-medium transition-colors flex-none">검색</button>
      </div>

      {searched && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {results.length > 0
              ? <><span className="text-sky-500 font-bold">{results.length}</span>개 검색됨</>
              : <span className="text-gray-400">검색 결과가 없습니다</span>}
          </div>
          {results.length > 0 && (
            <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
              {results.map((r, i) => (
                <div key={i} className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-700/50 flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-sky-600 dark:text-sky-400">{r.location}</span>
                  <HighlightMatch text={r.getText()} query={searchText} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {searched && results.length > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <FaExchangeAlt className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              <input type="text" placeholder="변환할 텍스트 (빈칸 = 삭제)" value={replaceText}
                onChange={(e) => { setReplaceText(e.target.value); setReplaceComplete(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doReplaceAll(); } }}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
            <button onClick={doReplaceAll}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors flex-none">모두 변환</button>
          </div>
          {replaceComplete !== null && (
            <div className="text-sm text-green-600 dark:text-green-400 font-medium">
              ✓ {replaceComplete}개 항목이 변환되었습니다{results.length > 0 && ` (잔여 ${results.length}개)`}
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-faint mt-1">
        선택한 씬의 텍스트를 검색하고 일괄 변환합니다.
        캐릭터 프리셋은 씬 선택과 무관하며, '캐릭터 프리셋' 검색 범위를 끄면 제외됩니다.
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   일괄 삽입 탭
   ═══════════════════════════════════════════════════════════════════ */
const InsertTab = () => {
  const session = appState.curSession;
  const sceneList = useMemo(() => {
    if (!session) return [];
    return Array.from(session.scenes.values()).map((s) => s.name);
  }, [session, session?.scenes.size]);

  const [insertText, setInsertText] = useState('');
  const [position, setPosition] = useState<'prepend' | 'append'>('append');
  const [slotTarget, setSlotTarget] = useState<'all' | 'new-column' | number>(0);
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(new Set());
  const [insertComplete, setInsertComplete] = useState<number | null>(null);
  const [sceneFilter, setSceneFilter] = useState('');

  // 태그 자동완성
  const [acTags, setAcTags] = useState<any[]>([]);
  const [acSelected, setAcSelected] = useState(0);
  const acCntRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeAc = () => { setAcTags([]); setAcSelected(0); };

  const handleInsertInput = (value: string) => {
    setInsertText(value);
    setInsertComplete(null);
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
      if (e.key === 'Escape') { e.preventDefault(); closeAc(); return; }
    }
  };

  // 씬 리스트가 변경되면 선택 초기화
  useEffect(() => {
    setSelectedScenes(new Set());
  }, [sceneList.length]);

  const maxSlotRow = useMemo(() => {
    if (!session) return 0;
    let max = 0;
    for (const scene of session.scenes.values()) {
      if (scene.slots.length > max) max = scene.slots.length;
    }
    return max;
  }, [session]);

  const affectedCount = useMemo(() => {
    if (!session || !insertText.trim()) return 0;
    let count = 0;
    for (const scene of session.scenes.values()) {
      if (!selectedScenes.has(scene.name)) continue;
      if (slotTarget === 'new-column') {
        count++; // 씬당 새 열 1개
      } else if (slotTarget === 'all') {
        for (const slot of scene.slots) {
          count += slot.length;
        }
      } else {
        const row = slotTarget as number;
        if (row < scene.slots.length) {
          count += scene.slots[row].length;
        }
      }
    }
    return count;
  }, [session, insertText, selectedScenes, slotTarget]);

  const toggleScene = (name: string) => {
    setSelectedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
    setInsertComplete(null);
  };

  const filteredSceneList = useMemo(() => {
    if (!sceneFilter.trim()) return sceneList;
    const q = sceneFilter.toLowerCase();
    return sceneList.filter((name) => name.toLowerCase().includes(q));
  }, [sceneList, sceneFilter]);

  const toggleAll = () => {
    // 필터가 있으면 필터된 씬만 대상
    const target = filteredSceneList;
    const allSelected = target.every((name) => selectedScenes.has(name));
    setSelectedScenes((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        target.forEach((name) => next.delete(name));
      } else {
        target.forEach((name) => next.add(name));
      }
      return next;
    });
    setInsertComplete(null);
  };

  const doInsert = () => {
    if (!session || !insertText.trim()) return;
    let applied = 0;

    for (const scene of session.scenes.values()) {
      if (!selectedScenes.has(scene.name)) continue;

      if (slotTarget === 'new-column') {
        // 새 열(슬롯)을 맨 뒤에 추가
        const newPiece = PromptPiece.fromJSON({
          prompt: insertText.trim(),
          characterPrompts: [],
          enabled: true,
          id: uuidv4(),
        });
        scene.slots.push([newPiece]);
        applied++;
        continue;
      }

      const targetSlots = slotTarget === 'all'
        ? scene.slots
        : (slotTarget < scene.slots.length ? [scene.slots[slotTarget as number]] : []);

      for (const slot of targetSlots) {
        for (const piece of slot) {
          if (position === 'append') {
            piece.prompt = piece.prompt
              ? piece.prompt + ', ' + insertText.trim()
              : insertText.trim();
          } else {
            piece.prompt = piece.prompt
              ? insertText.trim() + ', ' + piece.prompt
              : insertText.trim();
          }
          applied++;
        }
      }
    }

    setInsertComplete(applied);
  };

  if (!session || sceneList.length === 0) {
    return <div className="text-sm text-gray-400">씬이 없습니다.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 삽입 텍스트 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">삽입할 텍스트</label>
        <div className="relative">
          <FaPlus className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={12} />
          <input ref={inputRef} type="text" placeholder="태그 입력 (예: 1girl, masterpiece)" value={insertText}
            onChange={(e) => handleInsertInput(e.target.value)}
            onKeyDown={handleInsertKeyDown}
            onBlur={() => setTimeout(closeAc, 150)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
          {acTags.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white dark:bg-slate-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              {acTags.map((tag, i) => (
                <div key={tag.word + i}
                  onMouseDown={(e) => { e.preventDefault(); acceptAcTag(i); }}
                  className={`px-3 py-1.5 text-sm cursor-pointer flex justify-between ${
                    i === acSelected
                      ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-600'
                  }`}>
                  <span className="truncate">{tag.word}</span>
                  {tag.count != null && <span className="text-xs text-gray-400 ml-2 flex-none">{tag.count}</span>}
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
            <input type="radio" name="insertPos" checked={position === 'prepend'} onChange={() => setPosition('prepend')} />
            <span className="text-sm text-gray-700 dark:text-gray-300">앞에 추가</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="insertPos" checked={position === 'append'} onChange={() => setPosition('append')} />
            <span className="text-sm text-gray-700 dark:text-gray-300">뒤에 추가</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">대상:</span>
          <select
            value={slotTarget === 'all' ? 'all' : slotTarget === 'new-column' ? 'new-column' : String(slotTarget)}
            onChange={(e) => {
              const v = e.target.value;
              setSlotTarget(v === 'all' ? 'all' : v === 'new-column' ? 'new-column' : Number(v));
              setInsertComplete(null);
            }}
            className="text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-default px-2 py-1"
          >
            <option value="all">모든 슬롯</option>
            {Array.from({ length: maxSlotRow }, (_, i) => (
              <option key={i} value={i}>열 {i + 1}만</option>
            ))}
            <option value="new-column">새 열로 추가</option>
          </select>
        </div>
      </div>

      {/* 씬 선택 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">씬 선택</span>
          <button onClick={toggleAll} className="text-xs text-sky-500 hover:text-sky-600">
            {filteredSceneList.every((n) => selectedScenes.has(n)) ? '전체 해제' : '전체 선택'}
            {sceneFilter.trim() && ` (${filteredSceneList.length}개)`}
          </button>
        </div>
        <input type="text" placeholder="씬 이름 검색..." value={sceneFilter}
          onChange={(e) => setSceneFilter(e.target.value)}
          className="w-full mb-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
        <div className="max-h-36 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg p-2 space-y-1">
          {filteredSceneList.map((name) => (
            <label key={name} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 rounded px-1 py-0.5">
              <input type="checkbox" checked={selectedScenes.has(name)} onChange={() => toggleScene(name)}
                className="rounded border-gray-300 dark:border-gray-600" />
              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{name}</span>
            </label>
          ))}
          {filteredSceneList.length === 0 && (
            <div className="text-xs text-gray-400 py-1">일치하는 씬이 없습니다</div>
          )}
        </div>
      </div>

      {/* 미리보기 + 적용 */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-600">
        <span className="text-sm text-muted">
          {insertText.trim()
            ? slotTarget === 'new-column'
              ? <><span className="text-sky-500 font-bold">{affectedCount}</span>개 씬에 새 열 추가 예정</>
              : <><span className="text-sky-500 font-bold">{affectedCount}</span>개 슬롯에 적용 예정</>
            : '삽입할 텍스트를 입력하세요'}
        </span>
        <button onClick={doInsert} disabled={!insertText.trim() || affectedCount === 0}
          className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white text-sm font-medium transition-colors">
          적용
        </button>
      </div>

      {insertComplete !== null && (
        <div className="text-sm text-green-600 dark:text-green-400 font-medium">
          ✓ {slotTarget === 'new-column'
            ? `${insertComplete}개 씬에 새 열이 추가되었습니다`
            : `${insertComplete}개 슬롯에 텍스트가 삽입되었습니다`}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   메인 다이얼로그
   ═══════════════════════════════════════════════════════════════════ */
const FindReplaceDialog = observer(() => {
  const [activeTab, setActiveTab] = useState<'find' | 'insert'>('find');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (appState.findReplaceOpen) {
      setActiveTab('find');
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [appState.findReplaceOpen]);

  if (!appState.findReplaceOpen) return null;

  return (
    <ModalOverlay isOpen={true} onClose={() => appState.closeFindReplace()} title="찾기 및 변환" width="max-w-2xl">
      <div className="flex flex-col gap-4">
        {/* 탭 헤더 */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-600">
          <button
            onClick={() => setActiveTab('find')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'find'
                ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 border-b-2 border-sky-500'
                : 'text-muted hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            찾기 / 변환
          </button>
          <button
            onClick={() => setActiveTab('insert')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'insert'
                ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 border-b-2 border-sky-500'
                : 'text-muted hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            일괄 삽입
          </button>
        </div>

        {/* 탭 내용 */}
        {activeTab === 'find' && <FindTab searchInputRef={searchInputRef} />}
        {activeTab === 'insert' && <InsertTab />}
      </div>
    </ModalOverlay>
  );
});

export default FindReplaceDialog;
