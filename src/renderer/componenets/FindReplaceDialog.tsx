import React, { useState, useCallback, useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import ModalOverlay from './ModalOverlay';
import { FaSearch, FaExchangeAlt } from 'react-icons/fa';
import { Scene, CharacterPreset } from '../models/types';

/** 검색 결과 한 건 */
interface SearchResult {
  /** 표시용 위치 라벨 (예: "[씬이름] 프롬프트 슬롯 1-2") */
  location: string;
  /** 현재 필드 전체 텍스트를 가져오는 getter */
  getText: () => string;
  /** 필드 텍스트를 교체하는 setter (MobX observable 직접 수정) */
  setText: (v: string) => void;
}

type SearchScope = 'scene' | 'character';

/**
 * 현재 세션의 텍스트 필드를 순회하여 검색 결과를 수집한다.
 */
function collectResults(
  query: string,
  scopes: Record<SearchScope, boolean>,
): SearchResult[] {
  const session = appState.curSession;
  if (!session || !query) return [];

  const results: SearchResult[] = [];
  const q = query; // 대소문자 구분 검색

  // ── 씬 프롬프트 ──
  if (scopes.scene) {
    for (const scene of session.scenes.values()) {
      const sceneName = scene.name;

      // 슬롯 내 프롬프트 조각
      scene.slots.forEach((slot, si) => {
        slot.forEach((piece, pi) => {
          if (piece.prompt.includes(q)) {
            results.push({
              location: `[${sceneName}] 프롬프트 슬롯 ${si + 1}-${pi + 1}`,
              getText: () => piece.prompt,
              setText: (v) => { piece.prompt = v; },
            });
          }
          // 조합 에디터의 캐릭터 프롬프트 항목
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

  // ── 캐릭터 프롬프트 ──
  if (scopes.character) {
    // 씬별 전용 캐릭터 프롬프트
    for (const scene of session.scenes.values()) {
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
      // 씬 전용 캐릭터 UC
      if (scene.sceneCharacterUC && scene.sceneCharacterUC.includes(q)) {
        results.push({
          location: `[${sceneName}] 씬 캐릭터 UC`,
          getText: () => scene.sceneCharacterUC,
          setText: (v) => { scene.sceneCharacterUC = v; },
        });
      }
    }

    // 캐릭터 프리셋
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

/** 매치 텍스트 주변 컨텍스트를 잘라서 하이라이트 JSX 반환 */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  const idx = text.indexOf(query);
  if (idx === -1) return <span className="text-gray-500 dark:text-gray-400 text-xs truncate">{text}</span>;

  // 매치 전후 최대 20글자씩
  const ctxLen = 20;
  const start = Math.max(0, idx - ctxLen);
  const end = Math.min(text.length, idx + query.length + ctxLen);

  const before = (start > 0 ? '…' : '') + text.slice(start, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length, end) + (end < text.length ? '…' : '');

  return (
    <span className="text-xs break-all">
      <span className="text-gray-500 dark:text-gray-400">{before}</span>
      <span className="bg-yellow-200 dark:bg-yellow-700 text-gray-900 dark:text-gray-100 font-semibold rounded px-0.5">{match}</span>
      <span className="text-gray-500 dark:text-gray-400">{after}</span>
    </span>
  );
}

const FindReplaceDialog = observer(() => {
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [scopes, setScopes] = useState<Record<SearchScope, boolean>>({
    scene: true,
    character: true,
  });
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [replaceComplete, setReplaceComplete] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 다이얼로그 열릴 때 포커스 + 상태 초기화
  useEffect(() => {
    if (appState.findReplaceOpen) {
      setSearchText('');
      setReplaceText('');
      setResults([]);
      setSearched(false);
      setReplaceComplete(null);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [appState.findReplaceOpen]);

  const doSearch = useCallback(() => {
    if (!searchText.trim()) return;
    const r = collectResults(searchText, scopes);
    setResults(r);
    setSearched(true);
    setReplaceComplete(null);
  }, [searchText, scopes]);

  const doReplaceAll = useCallback(() => {
    if (results.length === 0) return;

    // 빈 replaceText = 삭제
    let replaced = 0;
    for (const r of results) {
      const cur = r.getText();
      const next = cur.replaceAll(searchText, replaceText);
      if (cur !== next) {
        r.setText(next);
        replaced++;
      }
    }
    setReplaceComplete(replaced);
    // 결과 새로고침
    const fresh = collectResults(searchText, scopes);
    setResults(fresh);
    setSearched(true);
  }, [results, searchText, replaceText, scopes]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSearch();
    }
  };

  const toggleScope = (scope: SearchScope) => {
    setScopes((prev) => ({ ...prev, [scope]: !prev[scope] }));
    setSearched(false);
    setResults([]);
    setReplaceComplete(null);
  };

  const close = () => appState.closeFindReplace();

  if (!appState.findReplaceOpen) return null;

  return (
    <ModalOverlay isOpen={true} onClose={close} title="찾기 및 변환" width="max-w-2xl">
      <div className="flex flex-col gap-4">
        {/* 검색 범위 */}
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-none">검색 범위:</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={scopes.scene}
              onChange={() => toggleScope('scene')}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">씬 프롬프트</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={scopes.character}
              onChange={() => toggleScope('character')}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">캐릭터 프롬프트</span>
          </label>
        </div>

        {/* 검색어 입력 */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="검색어 입력..."
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                setSearched(false);
                setReplaceComplete(null);
              }}
              onKeyDown={handleSearchKeyDown}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
          <button
            onClick={doSearch}
            disabled={!searchText.trim()}
            className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white text-sm font-medium transition-colors flex-none"
          >
            검색
          </button>
        </div>

        {/* 검색 결과 */}
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

        {/* 변환 입력 — 검색 결과가 있을 때만 표시 */}
        {searched && results.length > 0 && (
          <div className="flex flex-col gap-2 pt-2 border-t border-gray-200 dark:border-gray-600">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <FaExchangeAlt className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input
                  type="text"
                  placeholder="변환할 텍스트 (빈칸 = 삭제)"
                  value={replaceText}
                  onChange={(e) => {
                    setReplaceText(e.target.value);
                    setReplaceComplete(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      doReplaceAll();
                    }
                  }}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
              <button
                onClick={doReplaceAll}
                className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors flex-none"
              >
                모두 변환
              </button>
            </div>

            {replaceComplete !== null && (
              <div className="text-sm text-green-600 dark:text-green-400 font-medium">
                ✓ {replaceComplete}개 항목이 변환되었습니다
                {results.length > 0 && ` (잔여 ${results.length}개)`}
              </div>
            )}
          </div>
        )}

        {/* 안내 */}
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          프로젝트 내 모든 씬의 텍스트를 검색하고 일괄 변환합니다.
          조각 이름(&lt;그룹.이름&gt;)도 리터럴 텍스트로 검색 가능합니다.
        </div>
      </div>
    </ModalOverlay>
  );
});

export default FindReplaceDialog;
