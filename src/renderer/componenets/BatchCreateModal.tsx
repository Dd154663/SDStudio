import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FaPlay, FaPlus, FaStop, FaUserAlt } from 'react-icons/fa';
import {
  GlobalFolderFilterChips,
  globalImageBackend,
} from './CharacterPresetCards';
import { CharacterPresetInnerEditor } from './CharacterPresetInnerEditor';
import { CharacterPreset } from '../models/types';
import {
  globalCharacterPresetService,
  projectTemplateService,
  sessionService,
  templateService,
} from '../models';
import type { IGlobalCharacterPresetEntry } from '../models/GlobalCharacterPresetService';
import { appState } from '../models/AppService';
import {
  buildBatchCombinations,
  resolveBatchName,
} from '../models/batchCreatePlan';

// 프로젝트 일괄 생성 패널 (배치 R3 — 2026-07-17 탭 통합 스펙).
//
// 구 BatchCreateModal(오버레이 중첩)을 폐지하고 TemplateWorkflowEditor 의
// [일괄 생성] 탭 본문으로 렌더되는 비모달 패널로 개조했다. 프롬프트(+샘플링)
// 섹션은 편집 탭과 같은 JSX 를 render prop 으로 공유받아 그대로 노출한다
// (같은 화면에서 즉시 수정 가능 — JSX 중복 금지). 캐릭터 프롬프트·수동
// 바이브/레퍼런스 영역은 배치 탭에서 노출하지 않는다 — 수동 삽입이 자식에
// 끼칠 영향이 불확실해 캐릭터 프리셋(축) 사용으로 유도한다(2026-07-17 결정,
// 대신 축 섹션에 전역 프리셋 즉석 생성 버튼 제공). 템플릿 탭에서 이미 세팅된
// 값은 기존 R2 의미론대로 자식 베이스에 포함된다.
// 축 선택·대상 폴더 입력은 비영속(1회성 — 탭을 벗어나면 초기화).
//
// 템플릿의 캐릭터 프리셋·씬 구성은 배치에서 무시된다 (R2 스펙 2항).

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

export const BatchCreatePanel = observer(
  ({
    templateId,
    batchFolder,
    onCompleted,
    onRunningChange,
    isPromptFilled,
    beforeExecute,
    renderPromptSection,
    onEditingChange,
  }: {
    templateId: string;
    // 폴더 호스트(FolderTemplateModal)의 폴더 경로. 없으면 전역 템플릿 호스트 —
    // "대상 폴더 — 새로 생성" 입력 섹션이 뜨고, 실행 시 폴더+로컬 사본을
    // 만들어 지정한 뒤 배치한다 (R3 스펙 3항).
    batchFolder?: string;
    // 실행 완료(성공/부분 실패/취소 무관) 통지 — 폴더 호스트가 전파 확인
    // 기준(updatedAt)을 리셋하는 데 쓴다.
    onCompleted?: () => void;
    // 실행 중 여부 통지 — 편집기(탭 전환 비활성)·호스트 모달(닫기 차단)용
    onRunningChange?: (running: boolean) => void;
    // 빈 프롬프트 판정 — 편집 중 로컬 값 기준 (커밋 전 타이핑 포함)
    isPromptFilled: () => boolean;
    // 실행 직전 편집 중 프롬프트를 템플릿에 반영 (commitPrompts)
    beforeExecute: () => void;
    // 편집 탭과 공유하는 실물 섹션 (같은 상태·커밋 로직 — 단일 출처):
    //  프롬프트(+샘플링)
    renderPromptSection: () => React.ReactNode;
    // 전역 프리셋 즉석 생성(전체 영역 전환) 중 여부 통지 — 편집기가 탭
    // 헤더를, 호스트가 상단 조작을 숨기는 데 쓴다 (편집 탭의 캐릭터 프리셋
    // 편집과 같은 UX).
    onEditingChange?: (editing: boolean) => void;
  }) => {
    const [selectedChars, setSelectedChars] = useState<Set<string>>(new Set());
    const [selectedScenes, setSelectedScenes] = useState<Set<string>>(
      new Set(),
    );
    // "캐릭터별 서브폴더로 묶기" (R2 스펙 5항 — 기본 ON)
    const [subfolderByChar, setSubfolderByChar] = useState(true);
    const [folderFilter, setFolderFilter] = useState('__all__');
    // 전역 호스트: 새로 만들 대상 폴더 이름 (비영속)
    const [targetFolderName, setTargetFolderName] = useState('');
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
    // 전역 캐릭터 프리셋 즉석 생성 (패널 내부 전환 — 축 선택 상태는 유지)
    const [creatingPreset, setCreatingPreset] = useState<CharacterPreset | null>(
      null,
    );

    // 마운트(배치 탭 진입) 시 데이터 로드 — 상태는 마운트마다 초기(1회성)
    useEffect(() => {
      (async () => {
        if (!globalCharacterPresetService.loaded)
          await globalCharacterPresetService.load();
        await templateService.ensureLoaded();
      })();
    }, []);

    const setRunningNotify = (r: boolean) => {
      setRunning(r);
      onRunningChange?.(r);
    };

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
    // 표시용 대상 폴더 (전역 호스트는 입력 중인 이름)
    const displayFolder = batchFolder ?? (targetFolderName.trim() || '대상 폴더');
    // 전역 호스트에서 폴더명이 비면 실행 불가 (R3 가드)
    const folderNameMissing = !batchFolder && !targetFolderName.trim();

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
      setRunningNotify(true);
      setResult(null);
      cancelRef.current = false;
      setProgress({ done: 0, total: combos.length, current: '' });
      try {
        // 편집 중 프롬프트를 템플릿에 먼저 반영 — 전역 호스트는 이 상태로
        // 사본을 뜨고, 폴더 호스트는 이 상태로 자식을 만든다.
        beforeExecute();
        // 실행 대상 확정: 폴더 호스트 = 그대로 / 전역 호스트 = 폴더 생성 +
        // folderLocal 사본 승격 + 폴더 기본 템플릿 지정 (R3 스펙 3항 —
        // FolderTemplateModal 의 승격 로직과 동일 패턴. 자식은 사본의 ♟).
        let runTemplateId = templateId;
        let runFolder = batchFolder ?? '';
        if (!batchFolder) {
          const name = targetFolderName.trim();
          await sessionService.createFolder(name);
          const copy = await projectTemplateService.create(
            `폴더 기본 (${name})`,
            { folderLocal: true },
          );
          await projectTemplateService.overwriteFromTemplate(
            copy.id,
            templateId,
          );
          await templateService.setFolderTemplate(name, copy.id);
          runTemplateId = copy.id;
          runFolder = name;
        }
        const res = await sessionService.batchCreateFromTemplate({
          templateId: runTemplateId,
          folder: runFolder,
          items: combos,
          onProgress: (done, total, current) =>
            setProgress({ done, total, current }),
          shouldCancel: () => cancelRef.current,
        });
        setResult(res);
        // 방금 만든 자식은 현재 템플릿 구성 그대로다 — 폴더 호스트의 전파
        // 확인 기준을 리셋해 닫을 때 불필요한 "덮어쓸까요?"를 막는다.
        onCompleted?.();
        const parts = [`성공 ${res.created.length}개`];
        if (res.failed.length > 0) parts.push(`실패 ${res.failed.length}개`);
        if (res.cancelled) parts.push('취소됨');
        appState.pushMessage(`일괄 생성 완료 — ${parts.join(' · ')}`);
      } catch (e: any) {
        appState.pushMessage(e?.message || '일괄 생성에 실패했습니다.');
      } finally {
        setRunningNotify(false);
        setProgress(null);
      }
    };

    // ----- 전역 캐릭터 프리셋 즉석 생성 (축 섹션의 [+ 새 프리셋]) -----
    const startCreatePreset = () => {
      const p = new CharacterPreset();
      p.name = '새 캐릭터 프리셋';
      setCreatingPreset(p);
      onEditingChange?.(true);
    };
    const finishCreatePreset = async (preset: CharacterPreset) => {
      try {
        const entry = await globalCharacterPresetService.addPresetObject(preset);
        // 방금 만든 프리셋을 축에서 바로 쓸 수 있게 자동 선택
        setSelectedChars((prev) => new Set(prev).add(entry.id));
        appState.pushMessage(
          `전역 프리셋 "${entry.name}"을(를) 만들어 축에 선택했습니다.`,
        );
      } catch (e: any) {
        appState.pushMessage(e?.message || '프리셋 생성에 실패했습니다.');
      }
      setCreatingPreset(null);
      onEditingChange?.(false);
    };
    const cancelCreatePreset = () => {
      setCreatingPreset(null);
      onEditingChange?.(false);
    };

    const execute = () => {
      if (combos.length === 0 || running) return;
      // 전역 호스트 가드: 폴더명 필수 + 기존 폴더와 충돌 거부 (R3 스펙 3항)
      if (!batchFolder) {
        const name = targetFolderName.trim();
        if (!name) {
          appState.pushMessage('대상 폴더 이름을 입력해주세요.');
          return;
        }
        if (sessionService.folderList.includes(name)) {
          appState.pushMessage(
            `"${name}" 폴더가 이미 있습니다 — 해당 폴더의 기본 템플릿에서 일괄 생성을 사용해주세요.`,
          );
          return;
        }
      }
      // 조합 50개 이상이면 확인 1회 (차단 아님 — R2 스펙 8항)
      const confirmCount = () => {
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
      // 빈 프롬프트 가드 — 같은 화면의 프롬프트 섹션에서 바로 채울 수 있다.
      // 판정은 편집 중 로컬 값 기준 (커밋 전 타이핑 포함).
      if (!isPromptFilled()) {
        appState.pushDialog({
          type: 'confirm',
          text: '프롬프트(상위/하위)가 비어 있습니다.\n자식 프로젝트가 프롬프트 없이 생성됩니다 — 그래도 계속할까요?\n(위 프롬프트 섹션에서 바로 채울 수 있습니다)',
          callback: confirmCount,
        });
      } else {
        confirmCount();
      }
    };

    // 전역 프리셋 즉석 생성 중 — 패널 전체를 프리셋 에디터로 전환
    // (패널은 마운트 유지라 축 선택·폴더 입력은 보존된다)
    if (creatingPreset) {
      return (
        <CharacterPresetInnerEditor
          preset={creatingPreset}
          isNew
          onSave={finishCreatePreset}
          onCancel={cancelCreatePreset}
          imageBackend={globalImageBackend}
        />
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          선택한 <b>캐릭터 프리셋 × 씬 템플릿</b> 조합마다 자식 프로젝트를
          만듭니다. 아래 프롬프트가 모든 자식의 공통 베이스가 되고(여기서 바로
          수정 가능), 캐릭터 세팅(바이브·레퍼런스 포함)은{' '}
          <span className="font-medium text-default">
            캐릭터 축의 전역 프리셋으로
          </span>{' '}
          지정합니다. 템플릿의 캐릭터 프리셋·씬 구성은 배치에서 무시되며,
          생성된 자식의 캐릭터·씬 영역은 이후 재적용·전파에서 보호됩니다.
        </p>

        {/* 대상 폴더 — 전역 템플릿 호스트 전용 (새 폴더+폴더 템플릿 사본 생성) */}
        {!batchFolder && (
          <div className={sectionCls}>
            <span className="text-sm font-semibold text-default">
              대상 폴더 — 새로 생성
            </span>
            <input
              type="text"
              placeholder="새 폴더 이름 (예: 캐릭터CG)"
              value={targetFolderName}
              onChange={(e) => setTargetFolderName(e.target.value)}
              disabled={running}
              className="w-full px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
            <div className="text-xs text-faint">
              실행하면 이 이름의 폴더를 만들고, 현재 템플릿의 사본을 폴더 기본
              템플릿으로 지정한 뒤 그 안에 생성합니다(전역 원본과는 무관).
              이미 있는 폴더에는 만들 수 없습니다 — 해당 폴더의 기본 템플릿에서
              일괄 생성을 사용해주세요.
            </div>
          </div>
        )}

        {/* 프롬프트(+샘플링) — 편집 탭과 같은 실물 섹션 */}
        {renderPromptSection()}

        {/* 캐릭터 축 (편집 탭의 캐릭터 프리셋 자리) */}
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
            {/* 전역 프리셋 즉석 생성 — 수동 바이브/레퍼런스 영역 제거의
                대체 동선 (프리셋에 담아 축으로 지정) */}
            <button
              className="px-2.5 py-1 rounded-lg text-xs font-medium btn-neutral text-body flex items-center gap-1 flex-none"
              disabled={running}
              onClick={startCreatePreset}
            >
              <FaPlus size={9} />새 프리셋
            </button>
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

        {/* 씬 축 (편집 탭의 씬 구성 자리) */}
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
              지정된 씬 템플릿이 없습니다 — 선택하지 않으면 자식은 기본 빈 씬
              1개로 시작합니다.
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

        {/* 폴더 규칙 (캐릭터 축 있을 때만 — R2 스펙 5항) */}
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
                {displayFolder}/&#123;캐릭터 프리셋 이름&#125; 아래에
                생성됩니다.
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
            disabled={combos.length === 0 || running || folderNameMissing}
            onClick={execute}
          >
            <FaPlay size={10} />
            {running ? '생성 중...' : `${combos.length}개 생성`}
          </button>
        </div>
      </div>
    );
  },
);
