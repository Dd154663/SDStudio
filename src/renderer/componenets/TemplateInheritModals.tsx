import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ModalOverlay from './ModalOverlay';
import {
  projectTemplateService,
  sessionService,
  templateService,
} from '../models';
import { appState } from '../models/AppService';

// 프로젝트 상속 v2 (2026-07-16 합의) — 폴더 기본 템플릿 지정 / 수동 재적용 모달.
// 템플릿 실체는 ProjectTemplateService 엔티티("템플릿 관리" 오버레이에서 구성).

// ===== 폴더 기본 템플릿 지정 모달 =====
//
// 지정하면 이 폴더(하위 폴더 포함)에서 새 프로젝트를 만들 때 템플릿 선택
// 다이얼로그 없이 자동 적용된다.
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
    // 템플릿이 없을 때 "템플릿 관리 열기" 동선
    onOpenManager?: () => void;
  }) => {
    const [selected, setSelected] = useState<string>('');

    useEffect(() => {
      if (!isOpen) return;
      (async () => {
        await templateService.ensureLoaded();
        await projectTemplateService.ensureLoaded();
        const existing = templateService.getFolderTemplate(folder);
        setSelected(existing?.templateId ?? '');
      })();
    }, [isOpen, folder]);

    const templates = projectTemplateService.list();
    const existing = templateService.getFolderTemplate(folder);

    const save = async () => {
      if (!selected) return;
      const entry = projectTemplateService.get(selected);
      if (!entry) return;
      await templateService.setFolderTemplate(folder, selected);
      appState.pushMessage(
        `"${folder}" 폴더의 기본 템플릿이 "${entry.name}"(으)로 지정되었습니다.`,
      );
      onClose();
    };

    const clear = async () => {
      await templateService.clearFolderTemplate(folder);
      appState.pushMessage(`"${folder}" 폴더의 기본 템플릿을 해제했습니다.`);
      onClose();
    };

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title={`폴더 기본 템플릿 — ${folder}`}
        width="max-w-md"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            지정하면 이 폴더(하위 폴더 포함)에서 새 프로젝트를 만들 때 선택한
            템플릿의 구성(스타일 프리셋·캐릭터 프리셋·씬)이 자동으로
            적용됩니다.
          </p>
          {templates.length === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-default">
                만들어진 템플릿이 없습니다. 먼저 템플릿 관리에서 템플릿을
                만들어주세요.
              </p>
              {onOpenManager && (
                <button
                  className="px-3 py-1.5 rounded-lg text-sm btn-solid-sky self-end"
                  onClick={() => {
                    onClose();
                    onOpenManager();
                  }}
                >
                  템플릿 관리 열기
                </button>
              )}
            </div>
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
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                {existing && (
                  <button
                    className="px-3 py-1.5 rounded-lg text-sm btn-solid-red"
                    onClick={clear}
                  >
                    지정 해제
                  </button>
                )}
                <button
                  className="px-3 py-1.5 rounded-lg text-sm btn-solid-sky disabled:opacity-40"
                  disabled={!selected}
                  onClick={save}
                >
                  저장
                </button>
              </div>
            </>
          )}
        </div>
      </ModalOverlay>
    );
  },
);

// ===== 템플릿 수동 재적용(덮어쓰기) 모달 =====
//
// 기존 프로젝트의 스타일 프리셋·캐릭터 프리셋을 템플릿 구성으로 덮어쓴다.
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
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      if (!isOpen) return;
      (async () => {
        await templateService.ensureLoaded();
        await projectTemplateService.ensureLoaded();
        // 대상이 속한 폴더의 기본 템플릿을 초기 선택으로 제안
        const folder = sessionService.getFolderOf(target);
        const ft = await templateService.resolveFolderTemplate(folder);
        setSelected(ft?.templateId ?? '');
        setBusy(false);
      })();
    }, [isOpen, target]);

    const templates = projectTemplateService.list();
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
          {templates.length === 0 ? (
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
                  {templates.map((t) => (
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
