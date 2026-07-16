import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaPlus,
  FaPen,
  FaCopy,
  FaTrashAlt,
  FaTimes,
  FaCloudDownloadAlt,
  FaSlidersH,
} from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import Tooltip from './Tooltip';
import PromptEditTextArea from './PromptEditTextArea';
import { PresetEditModal } from './PresetEditModal';
import { CharacterPresetInnerEditor } from './CharacterPresetInnerEditor';
import { PresetImageBackend } from './CharacterPresetCards';
import {
  globalCharacterPresetService,
  globalPresetService,
  projectTemplateService,
  templateService,
} from '../models';
import { appState } from '../models/AppService';
import { CharacterPreset } from '../models/types';

// "템플릿 관리" 오버레이 (프로젝트 상속 v2 — 2026-07-16 워크플로우형 재설계).
//
// 템플릿 = "모든 걸 미리 세팅/수정 가능한 하나의 완전한 프리셋 워크플로우".
// 세 영역 모두 우상단 [불러오기] + 수동 편집 가능:
//  - 프롬프트(스타일 프리셋 1벌): 상위/하위/네거티브 인라인 직접 편집,
//    글로벌 프리셋 불러오기 = 프롬프트·샘플링 1회성 덮어쓰기
//  - 캐릭터 프리셋: 목록형, 불러오기 = 추가(선적용), 새로 만들기/편집 가능
//  - 씬 구성: 씬 템플릿/프로젝트에서 불러오기 = 전체 교체(일괄 적용)
// 새 프로젝트에 적용은 "불러오기"일 뿐 — 생성 후 프로젝트에서 자유 조정.
//
// 편집기 본체(TemplateWorkflowEditor)는 폴더 기본 템플릿 모달과 공유한다
// (폴더 템플릿 = 동일 화면 + 상단 "전역 템플릿 불러오기").

// 템플릿 이미지 디렉터리 기반 캐릭터 편집기 백엔드
const templateImageBackend: PresetImageBackend = {
  storeVibe: (b) => projectTemplateService.storeImageForEditor(b),
  storeReference: (b) => projectTemplateService.storeImageForEditor(b),
  vibePath: (t) => projectTemplateService.getImagePath(t),
  referencePath: (t) => projectTemplateService.getImagePath(t),
};

const sectionCls =
  'p-3 rounded-lg border line-color bg-[var(--c-surface)] flex flex-col gap-2';
const rowCls =
  'flex items-center gap-2 px-2 py-1.5 rounded-md bg-[var(--c-surface-2)] border line-color';
const addBtnCls =
  'px-2 py-1 rounded-md text-xs btn-neutral text-body whitespace-nowrap';
const iconBtnCls = 'btn-ghost p-1.5 rounded-md text-faint';

// ===== 템플릿 워크플로우 편집기 (프롬프트/캐릭터/씬 3영역 + [저장]) =====
//
// 전역 "템플릿 관리"와 폴더 기본 템플릿 모달이 완전히 동일한 화면을 공유하는
// 단일 출처. key={templateId} 로 마운트해 템플릿 전환 시 상태를 초기화하고,
// 언마운트 시(창 닫기·전환 포함) 프롬프트 로컬 편집을 자동 커밋한다.
export const TemplateWorkflowEditor = observer(
  ({
    templateId,
    syncSignal = 0,
    commitRef,
    onEditingCharChange,
  }: {
    templateId: string;
    // 부모가 엔티티를 통째로 바꾼 뒤(전역 템플릿 불러오기 등) 재동기화 신호
    syncSignal?: number;
    // 부모가 언마운트 전에 강제 커밋해야 할 때(복제·닫기 처리) 쓰는 훅
    commitRef?: React.MutableRefObject<() => void>;
    // 캐릭터 프리셋 편집(전체 영역 전환) 중 여부 통지 — 부모 상단 UI 숨김용
    onEditingCharChange?: (editing: boolean) => void;
  }) => {
    // 프롬프트 영역 인라인 편집 상태 — 명시적 커밋([저장]·창 닫기·전환)
    // 전까지는 로컬에만 존재한다. 에디터 onChange 클로저가 마운트 시점에
    // 고정되므로(PromptEditTextArea 내부 EditorModel), 최신 값은 ref 로 추적.
    const [frontPrompt, setFrontPrompt] = useState('');
    const [backPrompt, setBackPrompt] = useState('');
    const [uc, setUc] = useState('');
    const promptRef = useRef({ frontPrompt: '', backPrompt: '', uc: '' });
    // 외부 변경(불러오기·세부 설정·비우기) 후 인라인 필드 재동기화 트리거
    const [syncKey, setSyncKey] = useState(0);
    // 스타일 프리셋 세부 설정 모달 (대표이미지·샘플링)
    const [presetDetailOpen, setPresetDetailOpen] = useState(false);
    // 캐릭터 프리셋 편집 (CharacterPresetInnerEditor 인라인 전환)
    const [editChar, setEditChar] = useState<{
      index: number | null; // null = 새로 만들기
      preset: CharacterPreset;
    } | null>(null);

    const entry = projectTemplateService.get(templateId);

    const asStr = (v: any) => (typeof v === 'string' ? v : '');

    // 프롬프트 인라인 필드 동기화 — 마운트/불러오기/세부 설정 후에만
    // (타이핑 중에는 로컬 상태가 진실이므로 매 렌더 동기화 금지)
    useEffect(() => {
      const p = projectTemplateService.get(templateId)?.preset;
      const next = {
        frontPrompt: asStr(p?.frontPrompt),
        backPrompt: asStr(p?.backPrompt),
        uc: asStr(p?.uc),
      };
      setFrontPrompt(next.frontPrompt);
      setBackPrompt(next.backPrompt);
      setUc(next.uc);
      promptRef.current = next;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [templateId, syncKey, syncSignal]);

    // 프롬프트 로컬 편집값을 템플릿에 반영 — [저장]·언마운트 등 명시적
    // 시점에만 호출한다 (타이핑 중 자동 저장 없음).
    const commitPrompts = () => {
      const e = projectTemplateService.get(templateId);
      if (!e) return;
      const v = promptRef.current;
      // 빈 템플릿에 빈 값 커밋 → 불필요한 골격 생성 방지
      if (!e.preset && !v.frontPrompt && !v.backPrompt && !v.uc) return;
      if (
        e.preset &&
        asStr(e.preset.frontPrompt) === v.frontPrompt &&
        asStr(e.preset.backPrompt) === v.backPrompt &&
        asStr(e.preset.uc) === v.uc
      ) {
        return; // 변경 없음
      }
      projectTemplateService.patchPreset(templateId, { ...v }).catch(() => {});
    };
    const commitPromptsRef = useRef(commitPrompts);
    commitPromptsRef.current = commitPrompts;
    if (commitRef) commitRef.current = commitPrompts;

    // 언마운트(창 닫기·템플릿 전환) 시 자동 커밋 — "닫으면 저장되나?"
    // 불확실성 제거. 엔티티가 이미 삭제됐으면 커밋은 스킵된다.
    useEffect(
      () => () => {
        commitPromptsRef.current();
        projectTemplateService.flushSave().catch(() => {});
      },
      [],
    );

    useEffect(() => {
      onEditingCharChange?.(!!editChar);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editChar]);

    // 명시적 [저장] — 프롬프트 커밋 + 디스크 즉시 반영 + 확인 토스트
    const saveTemplate = async () => {
      if (!entry) return;
      commitPrompts();
      await projectTemplateService.flushSave();
      appState.pushMessage(`템플릿 "${entry.name}"이(가) 저장되었습니다.`);
    };

    // ----- 불러오기 -----

    // 프롬프트 영역 덮어쓰기 (글로벌 프리셋 / 현재 프로젝트)
    const importStylePreset = async () => {
      if (!entry) return;
      const source = await appState.pushDialogAsync({
        type: 'select',
        text: '어디서 불러올까요? (프롬프트·샘플링 설정을 1회 덮어씁니다)',
        items: [
          { text: '🌐 글로벌 프리셋에서', value: 'global' },
          { text: '📁 현재 프로젝트에서', value: 'session' },
        ],
      });
      if (!source) return;
      try {
        if (source === 'global') {
          if (!globalPresetService.loaded) await globalPresetService.load();
          const items = globalPresetService.presets.map((p) => ({
            text: p.name,
            value: p.id,
          }));
          if (items.length === 0) {
            appState.pushMessage('글로벌 프리셋이 없습니다.');
            return;
          }
          const id = await appState.pushDialogAsync({
            type: 'select',
            text: '불러올 글로벌 프리셋',
            items,
          });
          if (!id) return;
          await projectTemplateService.importGlobalPreset(entry.id, id);
        } else {
          const session = appState.curSession;
          if (!session) {
            appState.pushMessage('열려 있는 프로젝트가 없습니다.');
            return;
          }
          const flat: Array<{ text: string; value: string }> = [];
          const lookup: Record<string, any> = {};
          for (const [type, list] of session.presets.entries()) {
            for (const p of list) {
              const key = `${type} ${p.name}`;
              flat.push({ text: `${p.name} (${type})`, value: key });
              lookup[key] = p;
            }
          }
          if (flat.length === 0) {
            appState.pushMessage('현재 프로젝트에 프리셋이 없습니다.');
            return;
          }
          const key = await appState.pushDialogAsync({
            type: 'select',
            text: '불러올 프리셋',
            items: flat,
          });
          if (!key) return;
          await projectTemplateService.importSessionPreset(
            entry.id,
            lookup[key],
          );
        }
        setSyncKey((k) => k + 1);
        appState.pushMessage('프롬프트·샘플링 설정을 덮어썼습니다.');
      } catch (e: any) {
        appState.pushMessage(e.message || '불러오기에 실패했습니다.');
      }
    };

    const clearStylePreset = () => {
      if (!entry || !entry.preset) return;
      appState.pushDialog({
        type: 'confirm',
        text: '프롬프트 영역(프리셋 1벌)을 비우시겠습니까?',
        callback: async () => {
          await projectTemplateService.removePreset(entry.id);
          setSyncKey((k) => k + 1);
        },
      });
    };

    // 캐릭터 프리셋 불러오기 = 목록에 추가 (여러 캐릭터 선적용 가능)
    const importCharacterPreset = async () => {
      if (!entry) return;
      const source = await appState.pushDialogAsync({
        type: 'select',
        text: '어디서 불러올까요? (목록에 추가됩니다)',
        items: [
          { text: '🌐 글로벌 캐릭터 프리셋에서', value: 'global' },
          { text: '📁 현재 프로젝트에서', value: 'session' },
        ],
      });
      if (!source) return;
      try {
        if (source === 'global') {
          if (!globalCharacterPresetService.loaded)
            await globalCharacterPresetService.load();
          const items = globalCharacterPresetService.list().map((p) => ({
            text: p.name,
            value: p.id,
          }));
          if (items.length === 0) {
            appState.pushMessage('글로벌 캐릭터 프리셋이 없습니다.');
            return;
          }
          const id = await appState.pushDialogAsync({
            type: 'select',
            text: '불러올 캐릭터 프리셋',
            items,
          });
          if (!id) return;
          await projectTemplateService.importGlobalCharacterPreset(
            entry.id,
            id,
          );
        } else {
          const session = appState.curSession;
          if (!session) {
            appState.pushMessage('열려 있는 프로젝트가 없습니다.');
            return;
          }
          const names = Array.from(session.characterPresets.keys());
          if (names.length === 0) {
            appState.pushMessage('현재 프로젝트에 캐릭터 프리셋이 없습니다.');
            return;
          }
          const name = await appState.pushDialogAsync({
            type: 'select',
            text: '불러올 캐릭터 프리셋',
            items: names.map((n) => ({ text: n, value: n })),
          });
          if (!name) return;
          const preset = session.characterPresets.get(name);
          if (!preset) return;
          await projectTemplateService.importSessionCharacterPreset(
            entry.id,
            session,
            preset,
          );
        }
        appState.pushMessage('캐릭터 프리셋을 추가했습니다.');
      } catch (e: any) {
        appState.pushMessage(e.message || '불러오기에 실패했습니다.');
      }
    };

    // 씬 불러오기 = 씬 구성 전체 교체 (일괄 적용)
    const importScenes = async () => {
      if (!entry) return;
      const sceneTemplates = templateService.listSceneTemplates();
      const items: Array<{ text: string; value: string }> = sceneTemplates.map(
        (n) => ({ text: `🧩 씬 프리셋: ${n}`, value: n }),
      );
      if (appState.curSession) {
        items.push({
          text: `📁 현재 프로젝트: ${appState.curSession.name}`,
          value: appState.curSession.name,
        });
      }
      if (items.length === 0) {
        appState.pushMessage(
          '불러올 소스가 없습니다. 씬 프리셋(씬 템플릿)을 만들거나 프로젝트를 열어주세요.',
        );
        return;
      }
      const src = await appState.pushDialogAsync({
        type: 'select',
        text: '어느 프로젝트의 씬으로 교체할까요? (전체 씬, 이미지 제외)',
        items,
      });
      if (!src) return;
      const run = async () => {
        try {
          const added = await projectTemplateService.importScenesFromProject(
            entry.id,
            src,
          );
          appState.pushMessage(
            added > 0
              ? `씬 구성을 ${added}개 씬으로 교체했습니다.`
              : '불러올 씬이 없어 기존 구성을 유지합니다.',
          );
        } catch (e: any) {
          appState.pushMessage(e.message || '불러오기에 실패했습니다.');
        }
      };
      if (entry.scenes.length > 0) {
        appState.pushDialog({
          type: 'confirm',
          text: `기존 씬 구성 ${entry.scenes.length}개를 새 구성으로 교체합니다. 계속할까요?`,
          callback: run,
        });
      } else {
        await run();
      }
    };

    // ----- 캐릭터 프리셋 편집 -----
    const startNewCharPreset = () => {
      const p = new CharacterPreset();
      p.name = '새 캐릭터 프리셋';
      setEditChar({ index: null, preset: p });
    };

    const startEditCharPreset = (index: number) => {
      if (!entry) return;
      const p = CharacterPreset.fromJSON(
        JSON.parse(JSON.stringify(entry.characterPresets[index])),
      );
      setEditChar({ index, preset: p });
    };

    const saveCharPreset = async (preset: CharacterPreset) => {
      if (!entry || !editChar) return;
      await projectTemplateService.putCharacterPreset(
        entry.id,
        preset.toJSON(),
        editChar.index ?? undefined,
      );
      setEditChar(null);
    };

    if (!entry) return null;

    return (
      <>
        {editChar ? (
          <CharacterPresetInnerEditor
            preset={editChar.preset}
            onSave={(p) => {
              saveCharPreset(p);
            }}
            onCancel={() => setEditChar(null)}
            isNew={editChar.index === null}
            imageBackend={templateImageBackend}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* 프롬프트 영역 (스타일 프리셋 1벌) */}
            <div className={sectionCls}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-default flex-1">
                  프롬프트
                </span>
                <Tooltip content="세부 설정 (대표이미지·샘플링)">
                  <button
                    className={addBtnCls}
                    onClick={() => {
                      commitPrompts();
                      setPresetDetailOpen(true);
                    }}
                  >
                    <FaSlidersH className="inline mr-1" size={10} />
                    세부 설정
                  </button>
                </Tooltip>
                {entry.preset && (
                  <Tooltip content="프롬프트 영역 비우기">
                    <button
                      className={iconBtnCls + ' hover:text-red-500'}
                      onClick={clearStylePreset}
                    >
                      <FaTimes size={13} />
                    </button>
                  </Tooltip>
                )}
                <button className={addBtnCls} onClick={importStylePreset}>
                  <FaCloudDownloadAlt className="inline mr-1" size={11} />
                  불러오기
                </button>
              </div>
              {!entry.preset && (
                <div className="text-xs text-faint">
                  아래에 직접 입력하거나 글로벌 프리셋을 불러오세요. 비워 두면
                  새 프로젝트는 기본 프리셋으로 시작합니다.
                </div>
              )}
              <div>
                <div className="text-xs font-medium text-muted mb-1">
                  상위 프롬프트
                </div>
                <PromptEditTextArea
                  value={frontPrompt}
                  onChange={(v: string) => {
                    setFrontPrompt(v);
                    promptRef.current = {
                      ...promptRef.current,
                      frontPrompt: v,
                    };
                  }}
                  disabled={false}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-muted mb-1">
                  하위 프롬프트
                </div>
                <PromptEditTextArea
                  value={backPrompt}
                  onChange={(v: string) => {
                    setBackPrompt(v);
                    promptRef.current = {
                      ...promptRef.current,
                      backPrompt: v,
                    };
                  }}
                  disabled={false}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-muted mb-1">
                  네거티브 프롬프트
                </div>
                <PromptEditTextArea
                  value={uc}
                  onChange={(v: string) => {
                    setUc(v);
                    promptRef.current = { ...promptRef.current, uc: v };
                  }}
                  disabled={false}
                />
              </div>
            </div>
            {/* 캐릭터/바이브/레퍼런스 (캐릭터 프리셋 목록) */}
            <div className={sectionCls}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-default flex-1">
                  캐릭터 프리셋 ({entry.characterPresets.length})
                </span>
                <button className={addBtnCls} onClick={startNewCharPreset}>
                  <FaPlus className="inline mr-1" size={10} />
                  새로 만들기
                </button>
                <button className={addBtnCls} onClick={importCharacterPreset}>
                  <FaCloudDownloadAlt className="inline mr-1" size={11} />
                  불러오기
                </button>
              </div>
              {entry.characterPresets.length === 0 && (
                <div className="text-xs text-faint">
                  없음 — 직접 만들거나 불러오면 새 프로젝트에 캐릭터
                  프리셋(바이브·레퍼런스 포함)이 선적용됩니다.
                </div>
              )}
              {entry.characterPresets.map((cp, i) => (
                <div key={i} className={rowCls}>
                  <span className="text-sm text-default truncate flex-1">
                    {cp.name}
                    <span className="text-xs text-faint ml-1.5">
                      {(cp.vibes?.length || 0) > 0 && `V:${cp.vibes.length} `}
                      {(cp.characterReferences?.length || 0) > 0 &&
                        `R:${cp.characterReferences.length}`}
                    </span>
                  </span>
                  <Tooltip content="편집">
                    <button
                      className={iconBtnCls}
                      onClick={() => startEditCharPreset(i)}
                    >
                      <FaPen size={12} />
                    </button>
                  </Tooltip>
                  <Tooltip content="제거">
                    <button
                      className={iconBtnCls + ' hover:text-red-500'}
                      onClick={() =>
                        projectTemplateService.removeCharacterPreset(
                          entry.id,
                          i,
                        )
                      }
                    >
                      <FaTimes size={13} />
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>
            {/* 씬 구성 */}
            <div className={sectionCls}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-default flex-1">
                  씬 구성 ({entry.scenes.length})
                </span>
                <button className={addBtnCls} onClick={importScenes}>
                  <FaCloudDownloadAlt className="inline mr-1" size={11} />
                  불러오기
                </button>
              </div>
              {entry.scenes.length === 0 ? (
                <div className="text-xs text-faint">
                  없음 — 새 프로젝트는 빈 씬 1개로 시작합니다. 불러오기 = 선택한
                  프로젝트/씬 프리셋의 씬 전체로 교체.
                </div>
              ) : (
                <div className="text-xs text-faint">
                  씬 내용 수정은 원본 프로젝트에서 고친 뒤 다시 불러와
                  교체해주세요.
                </div>
              )}
              {entry.scenes.map((s, i) => (
                <div key={i} className={rowCls}>
                  <span className="text-sm text-default truncate flex-1">
                    {s.name}
                  </span>
                  <Tooltip content="제거">
                    <button
                      className={iconBtnCls + ' hover:text-red-500'}
                      onClick={() =>
                        projectTemplateService.removeScene(entry.id, i)
                      }
                    >
                      <FaTimes size={13} />
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>
            {/* 명시적 저장 */}
            <div className="flex justify-end">
              <button
                className="px-5 py-2 rounded-lg text-sm font-medium btn-solid-sky"
                onClick={saveTemplate}
              >
                저장
              </button>
            </div>
          </div>
        )}
        {presetDetailOpen && (
          <PresetEditModal
            title="프리셋 세부 설정"
            initialName={entry.preset?.name ?? entry.name}
            preset={entry.preset ?? {}}
            adapter={{
              fetchProfile: () =>
                entry.preset?.profile
                  ? projectTemplateService.fetchImageData(entry.preset.profile)
                  : Promise.resolve(null),
              save: (nm, patch, newRep) =>
                projectTemplateService.updatePreset(entry.id, nm, patch, newRep),
            }}
            onClose={() => {
              setPresetDetailOpen(false);
              setSyncKey((k) => k + 1);
            }}
          />
        )}
      </>
    );
  },
);

// ===== "템플릿 관리" 오버레이 (전역 템플릿 목록 + CRUD + 편집기) =====
export const TemplateManagerModal = observer(
  ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    const [selectedId, setSelectedId] = useState<string>('');
    // 편집기가 캐릭터 편집 화면으로 전환되면 상단(안내문·CRUD 행)을 숨긴다
    const [charEditing, setCharEditing] = useState(false);
    const commitRef = useRef<() => void>(() => {});

    useEffect(() => {
      if (!isOpen) return;
      (async () => {
        await projectTemplateService.ensureLoaded();
        await templateService.ensureLoaded();
        setCharEditing(false);
        setSelectedId((prev) => {
          const globals = projectTemplateService.listGlobal();
          return prev && globals.some((t) => t.id === prev)
            ? prev
            : (globals[0]?.id ?? '');
        });
      })();
    }, [isOpen]);

    const templates = projectTemplateService.listGlobal();
    const entry = selectedId
      ? projectTemplateService.get(selectedId)
      : undefined;

    // ----- 템플릿 CRUD -----
    // 전환·닫기 시 프롬프트 커밋은 편집기의 언마운트 훅이 담당한다.
    const createTemplate = async () => {
      const name = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '새 템플릿 이름을 입력해주세요',
      });
      if (!name) return;
      const created = await projectTemplateService.create(name);
      setSelectedId(created.id);
    };

    const renameTemplate = async () => {
      if (!entry) return;
      const name = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '새 템플릿 이름을 입력해주세요',
      });
      if (!name) return;
      try {
        await projectTemplateService.rename(entry.id, name);
      } catch (e: any) {
        appState.pushMessage(e.message || '이름 변경에 실패했습니다');
      }
    };

    const duplicateTemplate = async () => {
      if (!entry) return;
      commitRef.current(); // 편집 중 프롬프트까지 포함해 복제
      const clone = await projectTemplateService.duplicate(entry.id);
      setSelectedId(clone.id);
    };

    const deleteTemplate = () => {
      if (!entry) return;
      appState.pushDialog({
        type: 'confirm',
        text: `템플릿 "${entry.name}"을(를) 삭제하시겠습니까?\n(이 템플릿을 쓰는 폴더 자동 적용 지정도 해제됩니다)`,
        callback: async () => {
          await projectTemplateService.delete(entry.id);
          setSelectedId(projectTemplateService.listGlobal()[0]?.id ?? '');
        },
      });
    };

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title="템플릿 관리"
        width="max-w-3xl"
      >
        <div className="flex flex-col gap-4">
          {!charEditing && (
            <>
              <p className="text-sm text-muted">
                템플릿은 새 프로젝트의 시작 구성을 미리 세팅하는
                워크플로우입니다. 모든 영역은 직접 편집할 수 있고, 불러오기는
                설정을 1회 덮어쓰는 편의 기능입니다. 프롬프트 수정은 아래{' '}
                <b>[저장]</b> 버튼 또는 창을 닫을 때 저장되고, 그 외 변경
                (불러오기·캐릭터·씬)은 즉시 저장됩니다.
              </p>
              {/* 템플릿 선택 + CRUD */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <select
                  className="gray-input flex-1 min-w-[140px]"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  {templates.length === 0 && (
                    <option value="">템플릿 없음</option>
                  )}
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <Tooltip content="새 템플릿">
                  <button className={iconBtnCls} onClick={createTemplate}>
                    <FaPlus size={14} />
                  </button>
                </Tooltip>
                {entry && (
                  <>
                    <Tooltip content="이름 변경">
                      <button className={iconBtnCls} onClick={renameTemplate}>
                        <FaPen size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="복제">
                      <button
                        className={iconBtnCls}
                        onClick={duplicateTemplate}
                      >
                        <FaCopy size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="삭제">
                      <button
                        className={iconBtnCls + ' hover:text-red-500'}
                        onClick={deleteTemplate}
                      >
                        <FaTrashAlt size={14} />
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
            </>
          )}
          {!entry ? (
            <div className="text-sm text-default py-6 text-center">
              템플릿이 없습니다. <b>+</b> 버튼으로 새 템플릿을 만들어주세요.
            </div>
          ) : (
            <TemplateWorkflowEditor
              key={entry.id}
              templateId={entry.id}
              commitRef={commitRef}
              onEditingCharChange={setCharEditing}
            />
          )}
        </div>
      </ModalOverlay>
    );
  },
);
