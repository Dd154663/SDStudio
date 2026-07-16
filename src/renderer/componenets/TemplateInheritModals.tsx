import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FaCloudDownloadAlt } from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import { TemplateWorkflowEditor } from './TemplateManagerModal';
import {
  projectTemplateService,
  sessionService,
  templateService,
} from '../models';
import { appState } from '../models/AppService';

// 프로젝트 상속 v2 (2026-07-16 합의) — 폴더 기본 템플릿 / 수동 재적용 모달.

// ===== 폴더 기본 템플릿 모달 =====
//
// 폴더 기본 템플릿 = "폴더 전용 로컬 템플릿"(folderLocal 엔티티). 설정 화면은
// 전역 템플릿 관리와 완전히 동일(TemplateWorkflowEditor 공유)하되, 상단에
// [전역 템플릿 불러오기] 버튼이 추가된다 — 불러오기는 구성 전체의 1회성
// 덮어쓰기이고, 이후 이 폴더 전용으로 자유롭게 세부 조정할 수 있다
// (전역 원본에는 영향 없음). 지정하면 이 폴더(하위 폴더 포함)에서 새
// 프로젝트를 만들 때 자동 적용된다.
export const FolderTemplateModal = observer(
  ({
    folder,
    isOpen,
    onClose,
    onOpenManager,
  }: {
    folder: string;
    isOpen: boolean;
    onClose: () => void;
    // 전역 템플릿이 없을 때 "템플릿 관리 열기" 동선
    onOpenManager?: () => void;
  }) => {
    const [localId, setLocalId] = useState<string>('');
    // 전역 템플릿 불러오기(엔티티 통째 덮어쓰기) 후 편집기 재동기화 신호
    const [syncSignal, setSyncSignal] = useState(0);
    const [charEditing, setCharEditing] = useState(false);
    const commitRef = useRef<() => void>(() => {});

    // 열 때 폴더 전용 로컬 템플릿을 확보한다:
    //  - 기존 지정이 로컬 템플릿이면 그대로 편집
    //  - (구형) 전역 템플릿을 참조하던 지정은 편집 가능한 로컬 사본으로 승격
    //  - 지정이 없으면 빈 로컬 템플릿 생성 (빈 채로 닫으면 자동 해제)
    useEffect(() => {
      if (!isOpen) return;
      setCharEditing(false);
      setLocalId('');
      (async () => {
        await templateService.ensureLoaded();
        await projectTemplateService.ensureLoaded();
        const existing = templateService.getFolderTemplate(folder);
        const existingEnt = existing
          ? projectTemplateService.get(existing.templateId)
          : undefined;
        let id: string;
        if (existingEnt?.folderLocal) {
          id = existingEnt.id;
        } else {
          const created = await projectTemplateService.create(
            `폴더 기본 (${folder})`,
            { folderLocal: true },
          );
          if (existingEnt) {
            await projectTemplateService.overwriteFromTemplate(
              created.id,
              existingEnt.id,
            );
          }
          await templateService.setFolderTemplate(folder, created.id);
          id = created.id;
        }
        setLocalId(id);
        setSyncSignal((s) => s + 1);
      })();
    }, [isOpen, folder]);

    const entry = localId ? projectTemplateService.get(localId) : undefined;

    // [전역 템플릿 불러오기] = 이 폴더 템플릿의 구성 전체 1회성 덮어쓰기
    const importGlobalTemplate = async () => {
      if (!entry) return;
      const globals = projectTemplateService.listGlobal();
      if (globals.length === 0) {
        if (onOpenManager) {
          appState.pushDialog({
            type: 'confirm',
            text: '전역 템플릿이 없습니다. 템플릿 관리를 열까요?',
            callback: () => {
              onClose();
              onOpenManager();
            },
          });
        } else {
          appState.pushMessage('전역 템플릿이 없습니다.');
        }
        return;
      }
      const id = await appState.pushDialogAsync({
        type: 'select',
        text: '어떤 전역 템플릿을 불러올까요? (현재 구성 전체를 1회 덮어씁니다)',
        items: globals.map((t) => ({ text: t.name, value: t.id })),
      });
      if (!id) return;
      try {
        await projectTemplateService.overwriteFromTemplate(entry.id, id);
        setSyncSignal((s) => s + 1);
        appState.pushMessage(
          '전역 템플릿 구성을 불러왔습니다. 이 폴더 전용으로 자유롭게 세부 조정할 수 있습니다.',
        );
      } catch (e: any) {
        appState.pushMessage(e.message || '불러오기에 실패했습니다.');
      }
    };

    const clearDesignation = () => {
      if (!localId) return;
      appState.pushDialog({
        type: 'confirm',
        text: `"${folder}" 폴더의 기본 템플릿 지정을 해제하시겠습니까?\n(이 폴더 전용 템플릿 구성도 삭제됩니다)`,
        callback: async () => {
          await projectTemplateService.delete(localId);
          appState.pushMessage(
            `"${folder}" 폴더의 기본 템플릿을 해제했습니다.`,
          );
          setLocalId('');
          onClose();
        },
      });
    };

    // 닫기: 프롬프트 커밋 후, 아무것도 세팅되지 않은 템플릿이면 지정 자동
    // 해제 (열어만 보고 닫은 폴더에 빈 템플릿이 남지 않도록)
    const handleClose = () => {
      if (localId) {
        commitRef.current();
        const e = projectTemplateService.get(localId);
        if (e && projectTemplateService.isEmptyTemplate(e)) {
          projectTemplateService.delete(localId).catch(() => {});
        }
      }
      onClose();
    };

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={handleClose}
        title={`폴더 기본 템플릿 — ${folder}`}
        width="max-w-3xl"
      >
        <div className="flex flex-col gap-4">
          {!charEditing && (
            <>
              <p className="text-sm text-muted">
                이 폴더(하위 폴더 포함)에서 새 프로젝트를 만들 때 아래 구성이
                자동 적용됩니다. 전역 템플릿을 불러온 뒤 이 폴더 전용으로 세부
                조정할 수 있고(전역 원본에는 영향 없음), 아무것도 세팅하지 않고
                닫으면 지정이 해제됩니다.
              </p>
              <div className="flex gap-2 justify-end flex-wrap">
                <button
                  className="px-3 py-1.5 rounded-lg text-sm btn-solid-sky"
                  onClick={importGlobalTemplate}
                >
                  <FaCloudDownloadAlt className="inline mr-1.5" size={12} />
                  전역 템플릿 불러오기
                </button>
                <button
                  className="px-3 py-1.5 rounded-lg text-sm btn-solid-red"
                  onClick={clearDesignation}
                >
                  지정 해제
                </button>
              </div>
            </>
          )}
          {entry ? (
            <TemplateWorkflowEditor
              key={entry.id}
              templateId={entry.id}
              syncSignal={syncSignal}
              commitRef={commitRef}
              onEditingCharChange={setCharEditing}
            />
          ) : (
            <div className="text-sm text-muted py-6 text-center">
              불러오는 중...
            </div>
          )}
        </div>
      </ModalOverlay>
    );
  },
);

// ===== 템플릿 수동 재적용 모달 =====
//
// 템플릿의 프리셋·캐릭터 프리셋을 기존 프로젝트에 추가하고 선택한다(비파괴).
// 씬·생성 이미지는 건드리지 않는다 (씬은 씬 템플릿 가져오기 기능이 담당).
export const ReapplyTemplateModal = observer(
  ({
    target,
    isOpen,
    onClose,
  }: {
    target: string; // 대상 프로젝트 이름
    isOpen: boolean;
    onClose: () => void;
  }) => {
    const [selected, setSelected] = useState<string>('');
    // 대상이 속한 폴더의 기본 템플릿 (폴더 전용 로컬 — 선택지에 별도 표기)
    const [folderTpl, setFolderTpl] = useState<{
      templateId: string;
      folder: string;
    } | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      if (!isOpen) return;
      (async () => {
        await templateService.ensureLoaded();
        await projectTemplateService.ensureLoaded();
        // 대상이 속한 폴더의 기본 템플릿을 초기 선택으로 제안
        const folder = sessionService.getFolderOf(target);
        const ft = await templateService.resolveFolderTemplate(folder);
        setFolderTpl(ft ?? null);
        setSelected(ft?.templateId ?? '');
        setBusy(false);
      })();
    }, [isOpen, target]);

    const globals = projectTemplateService.listGlobal();
    // 폴더 전용 로컬 템플릿은 전역 목록에 없으므로 별도 항목으로 노출
    const folderLocalEntry =
      folderTpl && projectTemplateService.get(folderTpl.templateId)?.folderLocal
        ? projectTemplateService.get(folderTpl.templateId)
        : undefined;
    const hasAny = globals.length > 0 || !!folderLocalEntry;
    const entry = selected ? projectTemplateService.get(selected) : undefined;

    const apply = async () => {
      if (!selected || busy) return;
      setBusy(true);
      try {
        await sessionService.applyProjectTemplateToSession(selected, target);
        appState.pushMessage(
          `"${target}"에 템플릿 "${entry?.name ?? ''}" 구성을 적용했습니다.`,
        );
        onClose();
      } catch (e: any) {
        appState.pushMessage(e?.message || '템플릿 적용에 실패했습니다.');
      } finally {
        setBusy(false);
      }
    };

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title={`템플릿 적용 — ${target}`}
        width="max-w-md"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            템플릿의 프리셋(프롬프트 1벌)·캐릭터 프리셋을 이 프로젝트에{' '}
            <span className="font-medium text-default">추가하고 선택</span>
            합니다 — 기존 프리셋·씬·생성 이미지는 지우지 않습니다 (이름이
            겹치면 번호가 붙음).
          </p>
          {!hasAny ? (
            <p className="text-sm text-default">
              만들어진 템플릿이 없습니다. 먼저 템플릿 관리에서 템플릿을
              만들어주세요.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-default">
                  템플릿
                </label>
                <select
                  className="gray-input w-full"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">선택 안 함</option>
                  {folderLocalEntry && (
                    <option value={folderLocalEntry.id}>
                      폴더 기본: {folderTpl!.folder}
                    </option>
                  )}
                  {globals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {entry && (
                  <span className="text-xs text-muted">
                    프리셋 {entry.preset ? 1 : 0}벌 · 캐릭터 프리셋{' '}
                    {entry.characterPresets.length}개
                  </span>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  className="px-3 py-1.5 rounded-lg text-sm btn-solid-sky disabled:opacity-40"
                  disabled={!selected || busy}
                  onClick={apply}
                >
                  {busy ? '적용 중...' : '적용'}
                </button>
              </div>
            </>
          )}
        </div>
      </ModalOverlay>
    );
  },
);
