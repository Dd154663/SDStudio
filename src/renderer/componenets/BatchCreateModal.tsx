import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FaPlay, FaStop, FaUserAlt } from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import { GlobalFolderFilterChips } from './CharacterPresetCards';
import {
  globalCharacterPresetService,
  sessionService,
  templateService,
} from '../models';
import type { IGlobalCharacterPresetEntry } from '../models/GlobalCharacterPresetService';
import { appState } from '../models/AppService';
import {
  buildBatchCombinations,
  resolveBatchName,
} from '../models/batchCreatePlan';

// 프로젝트 일괄 생성 위저드 (배치 생성 R2, 2026-07-16 확정 스펙).
//
// 진입점 = 폴더 템플릿(FolderTemplateModal → TemplateWorkflowEditor)의
// [일괄 생성] 버튼. 1회성 위저드 — 설정은 저장하지 않는다 (스펙 3항).
// 베이스 = 이 폴더 템플릿의 프롬프트·샘플링·캐릭터 프롬프트·수동 바이브/
// 레퍼런스이고, 템플릿의 캐릭터 프리셋·씬 구성은 배치에서 무시된다 (스펙 2항).

// 캐릭터 축 선택 행의 소형 썸네일 — 대표이미지→레퍼런스→바이브 순 폴백
// (GlobalCardImage 와 같은 규칙의 목록용 소형 변형)
const CharThumb = ({ entry }: { entry: IGlobalCharacterPresetEntry }) => {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p: any = entry.preset;
      const file =
        p.representativeImage ||
        p.characterReferences?.[0]?.path ||
        p.vibes?.[0]?.path;
      if (!file) {
        if (!cancelled) setImg(null);
        return;
      }
      const data = await globalCharacterPresetService.fetchImageData(file);
      if (!cancelled) setImg(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [entry]);
  if (img) {
    return (
      <img
        src={img}
        className="w-9 h-9 object-cover rounded flex-none"
        draggable={false}
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded flex-none flex items-center justify-center bg-purple-50 dark:bg-purple-900/20">
      <FaUserAlt size={14} className="text-purple-300 dark:text-purple-500" />
    </div>
  );
};

const sectionCls =
  'p-3 rounded-lg border line-color bg-[var(--c-surface)] flex flex-col gap-2';

export const BatchCreateModal = observer(
  ({
    isOpen,
    onClose,
    templateId,
    folder,
    onCompleted,
  }: {
    isOpen: boolean;
    onClose: () => void;
    templateId: string;
    folder: string; // 부모 폴더 (폴더 템플릿의 폴더 — 진입점에서 자동 확정)
    // 실행 완료(성공/부분 실패/취소 무관) 통지 — 부모가 전파 확인 기준 리셋용
    onCompleted?: () => void;
  }) => {
    const [selectedChars, setSelectedChars] = useState<Set<string>>(new Set());
    const [selectedScenes, setSelectedScenes] = useState<Set<string>>(
      new Set(),
    );
    // "캐릭터별 서브폴더로 묶기" (스펙 5항 — 기본 ON)
    const [subfolderByChar, setSubfolderByChar] = useState(true);
    const [folderFilter, setFolderFilter] = useState('__all__');
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<{
      done: number;
      total: number;
      current: string;
    } | null>(null);
    const [result, setResult] = useState<{
      created: string[];
      failed: { name: string; error: string }[];
      cancelled: boolean;
    } | null>(null);
    const cancelRef = useRef(false);

    useEffect(() => {
      if (!isOpen) return;
      (async () => {
        if (!globalCharacterPresetService.loaded)
          await globalCharacterPresetService.load();
        await templateService.ensureLoaded();
      })();
      setSelectedChars(new Set());
      setSelectedScenes(new Set());
      setSubfolderByChar(true);
      setFolderFilter('__all__');
      setRunning(false);
      setProgress(null);
      setResult(null);
      cancelRef.current = false;
    }, [isOpen]);

    const entries = globalCharacterPresetService.list();
    const folders = globalCharacterPresetService.listFolders();
    const effectiveFilter =
      folderFilter === '__all__' ||
      folderFilter === '__unfiled__' ||
      folders.includes(folderFilter)
        ? folderFilter
        : '__all__';
    const visibleChars =
      effectiveFilter === '__all__'
        ? entries
        : entries.filter((e) =>
            effectiveFilter === '__unfiled__'
              ? !e.folder
              : e.folder === effectiveFilter,
          );
    const sceneTemplates = templateService.listSceneTemplates();

    const chars = entries
      .filter((e) => selectedChars.has(e.id))
      .map((e) => ({ id: e.id, name: e.name }));
    const sceneList = sceneTemplates.filter((s) => selectedScenes.has(s));
    const combos = buildBatchCombinations(
      chars,
      sceneList,
      subfolderByChar && chars.length > 0,
    );
    // 미리보기: 실제 실행과 같은 규칙으로 충돌 해소된 이름 (실행 시점에 다른
    // 프로젝트가 생기면 달라질 수 있음)
    const previewNames = (() => {
      const taken = new Set<string>(sessionService.list());
      return combos.map((c) => resolveBatchName(c.name, taken));
    })();

    const toggleChar = (id: string) => {
      setSelectedChars((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };
    const toggleScene = (name: string) => {
      setSelectedScenes((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    };
    // 전체 선택/해제 — 폴더 필터 중엔 보이는 항목만 토글(다른 폴더 선택 유지)
    const toggleAllChars = () => {
      const all =
        visibleChars.length > 0 &&
        visibleChars.every((e) => selectedChars.has(e.id));
      setSelectedChars((prev) => {
        const next = new Set(prev);
        visibleChars.forEach((e) => (all ? next.delete(e.id) : next.add(e.id)));
        return next;
      });
    };
    const toggleAllScenes = () => {
      const all =
        sceneTemplates.length > 0 &&
        sceneTemplates.every((s) => selectedScenes.has(s));
      setSelectedScenes(new Set<string>(all ? [] : sceneTemplates));
    };

    const run = async () => {
      setRunning(true);
      setResult(null);
      cancelRef.current = false;
      setProgress({ done: 0, total: combos.length, current: '' });
      try {
        const res = await sessionService.batchCreateFromTemplate({
          templateId,
          folder,
          items: combos,
          onProgress: (done, total, current) =>
            setProgress({ done, total, current }),
          shouldCancel: () => cancelRef.current,
        });
        setResult(res);
        // 방금 만든 자식은 현재 템플릿 구성 그대로다 — 부모(폴더 모달)의
        // 전파 확인 기준을 리셋해 닫을 때 불필요한 "덮어쓸까요?"를 막는다.
        onCompleted?.();
        const parts = [`성공 ${res.created.length}개`];
        if (res.failed.length > 0) parts.push(`실패 ${res.failed.length}개`);
        if (res.cancelled) parts.push('취소됨');
        appState.pushMessage(`일괄 생성 완료 — ${parts.join(' · ')}`);
      } catch (e: any) {
        appState.pushMessage(e?.message || '일괄 생성에 실패했습니다.');
      } finally {
        setRunning(false);
        setProgress(null);
      }
    };

    const execute = () => {
      if (combos.length === 0 || running) return;
      // 조합 50개 이상이면 확인 1회 (차단 아님 — 스펙 8항)
      if (combos.length >= 50) {
        appState.pushDialog({
          type: 'confirm',
          text: `${combos.length}개 프로젝트를 생성합니다. 계속할까요?`,
          callback: run,
        });
      } else {
        run();
      }
    };

    // 실행 중 닫기 방지 — 엔진 루프가 이 컴포넌트 수명에 묶여 있어, 닫으면
    // 진행률·취소 수단을 잃는다. [취소] 버튼으로만 중단하게 안내.
    const handleClose = () => {
      if (running) {
        appState.pushMessage(
          '일괄 생성이 진행 중입니다 — [취소] 버튼으로 중단할 수 있습니다.',
        );
        return;
      }
      onClose();
    };

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={handleClose}
        title={`일괄 생성 — ${folder}`}
        width="max-w-2xl"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            선택한 <b>캐릭터 프리셋 × 씬 템플릿</b> 조합마다 자식 프로젝트를
            만듭니다. 베이스 = 이 폴더 템플릿의 프롬프트·샘플링·캐릭터
            프롬프트·바이브/레퍼런스이며,{' '}
            <span className="font-medium text-default">
              템플릿의 캐릭터 프리셋·씬 구성은 배치에서 무시
            </span>
            됩니다. 생성된 자식의 캐릭터·씬 영역은 이후 재적용·전파에서
            보호됩니다.
          </p>

          {/* 캐릭터 축 */}
          <div className={sectionCls}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-default flex-1">
                캐릭터 축 — 전역 캐릭터 프리셋 ({selectedChars.size}개 선택)
              </span>
              {visibleChars.length > 0 && (
                <button className="text-xs btn-link" onClick={toggleAllChars}>
                  {visibleChars.every((e) => selectedChars.has(e.id))
                    ? '전체 해제'
                    : '전체 선택'}
                </button>
              )}
            </div>
            <GlobalFolderFilterChips
              value={effectiveFilter}
              onChange={setFolderFilter}
            />
            {entries.length === 0 ? (
              <div className="text-xs text-faint">
                전역 캐릭터 프리셋이 없습니다 — 캐릭터 축 없이 씬 축만으로도
                생성할 수 있습니다.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto flex flex-col gap-1 pr-1">
                {visibleChars.map((e) => (
                  <label
                    key={e.id}
                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 rounded px-1 py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChars.has(e.id)}
                      onChange={() => toggleChar(e.id)}
                      className="rounded line-color flex-none"
                    />
                    <CharThumb entry={e} />
                    <span className="text-sm text-default truncate flex-1">
                      {e.name}
                      {e.folder && (
                        <span className="text-xs text-faint ml-1.5">
                          📁{e.folder}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
                {visibleChars.length === 0 && (
                  <div className="text-xs text-faint py-1">
                    이 폴더에 프리셋이 없습니다
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 씬 축 */}
          <div className={sectionCls}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-default flex-1">
                씬 축 — 씬 템플릿 ({selectedScenes.size}개 선택)
              </span>
              {sceneTemplates.length > 0 && (
                <button className="text-xs btn-link" onClick={toggleAllScenes}>
                  {sceneTemplates.every((s) => selectedScenes.has(s))
                    ? '전체 해제'
                    : '전체 선택'}
                </button>
              )}
            </div>
            {sceneTemplates.length === 0 ? (
              <div className="text-xs text-faint">
                지정된 씬 템플릿이 없습니다 — 선택하지 않으면 자식은 기본 빈
                씬 1개로 시작합니다.
              </div>
            ) : (
              <div className="max-h-36 overflow-y-auto flex flex-col gap-1 pr-1">
                {sceneTemplates.map((s) => (
                  <label
                    key={s}
                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 rounded px-1 py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={selectedScenes.has(s)}
                      onChange={() => toggleScene(s)}
                      className="rounded line-color flex-none"
                    />
                    <span className="text-sm text-default truncate">{s}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 폴더 규칙 (캐릭터 축 있을 때만 — 스펙 5항) */}
          {selectedChars.size > 0 && (
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={subfolderByChar}
                onChange={(e) => setSubfolderByChar(e.target.checked)}
                className="mt-0.5 rounded line-color"
              />
              <span className="text-sm text-default">
                캐릭터별 서브폴더로 묶기
                <span className="block text-xs text-muted">
                  {folder}/&#123;캐릭터 프리셋 이름&#125; 아래에 생성됩니다.
                </span>
              </span>
            </label>
          )}

          {/* 미리보기 */}
          <div className={sectionCls}>
            <span className="text-sm font-semibold text-default">
              미리보기 — {combos.length}개 생성
              <span className="text-xs text-muted font-normal ml-1.5">
                (이름 규칙: &#123;캐릭터&#125;_&#123;씬템플릿&#125;, 중복 시 _n)
              </span>
            </span>
            {combos.length === 0 ? (
              <div className="text-xs text-faint">
                캐릭터 축 또는 씬 축을 하나 이상 선택해주세요.
              </div>
            ) : (
              <div className="max-h-32 overflow-y-auto text-xs text-muted pr-1">
                {previewNames.map((n, i) => (
                  <div key={i} className="truncate">
                    {combos[i].subfolder ? `${combos[i].subfolder}/` : ''}
                    {n}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 진행률 / 결과 */}
          {running && progress && (
            <div className={sectionCls}>
              <div className="text-sm text-default">
                생성 중... {progress.done}/{progress.total}
                {progress.current && (
                  <span className="text-muted"> — {progress.current}</span>
                )}
              </div>
              <div className="w-full h-2 bg-[var(--c-surface-2)] rounded-full">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all"
                  style={{
                    width: `${(progress.done / Math.max(1, progress.total)) * 100}%`,
                  }}
                />
              </div>
              <div className="flex justify-end">
                <button
                  className="px-4 py-1.5 rounded-lg text-sm font-medium btn-solid-red flex items-center gap-1.5"
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  <FaStop size={10} />
                  취소 (현재 항목 완료 후 중단)
                </button>
              </div>
            </div>
          )}
          {result && !running && (
            <div className={sectionCls}>
              <div className="text-sm text-default">
                완료 — 성공 {result.created.length}개
                {result.cancelled && ' (취소로 중단됨)'}
              </div>
              {result.failed.length > 0 && (
                <div className="max-h-24 overflow-y-auto text-xs text-red-500 dark:text-red-400 pr-1">
                  {result.failed.map((f, i) => (
                    <div key={i} className="truncate">
                      실패: {f.name} — {f.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 실행 */}
          <div className="flex justify-end gap-2">
            <button
              className="px-5 py-2 rounded-lg text-sm font-medium btn-solid-purple flex items-center gap-1.5"
              disabled={combos.length === 0 || running}
              onClick={execute}
            >
              <FaPlay size={10} />
              {running ? '생성 중...' : `${combos.length}개 생성`}
            </button>
          </div>
        </div>
      </ModalOverlay>
    );
  },
);
