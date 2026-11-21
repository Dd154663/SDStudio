import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ActionIcon } from './ActionIcon';
import ModalOverlay, { DIALOG_DANGER_BTN, DIALOG_PRIMARY_BTN, DIALOG_SECONDARY_BTN } from './ModalOverlay';
import { useTemplateWorkflowPanel } from './TemplateManagerModal';
import { FOLDER_COLORS } from './folderColors';
import {
  isMobile,
  projectTemplateService,
  sessionService,
  templateService,
} from '../models';
import { appState } from '../models/AppService';
import { deleteConfirmText } from '../models/deleteFlowRules';
import { HelpPanelButton } from './HelpPanel';
import { FOLDER_TEMPLATE_HELP, TEMPLATE_BADGE_HELP } from '../models/helpPanelTexts';
import { setTemplateBadgeColorRecorded } from '../models/globalLibraryUndo';
import { previewReapply, reapplyTemplateToProject, reapplyUndoState } from '../models/templateReapplyFlow';
import { REAPPLY_TEXT, reapplyPreviewLines } from '../models/templateReapplyPreview';

// 프로젝트 상속 v2 (2026-07-16 합의) — 폴더 기본 템플릿 / 수동 재적용 모달.
// 2026-11-15 오버레이 묶음 C-2: 폴더 기본 템플릿 = size l(고정 760), aside 없음. 도구줄 = 탭 + [전역 템플릿에서 복사] +
// 배지 색 줄, 바닥줄 왼쪽 = [지정 해제](위험), 오른쪽 = 공용 훅의 [저장]/[N개 생성]. PC·모바일 같은 슬롯(규약 ⑧).

// ===== 폴더 기본 템플릿 모달 =====
//
// 폴더 기본 템플릿 = "폴더 전용 로컬 템플릿"(folderLocal 엔티티). 설정 화면은
// 전역 템플릿 관리와 완전히 동일(useTemplateWorkflowPanel 공유)하되, 상단에
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
    const commitRef = useRef<() => void>(() => {});
    // 열 때의 updatedAt — 닫을 때 변경 여부(=전파 확인 트리거) 판정용
    const updatedAtOnOpenRef = useRef<number>(0);

    // 열 때 폴더 전용 로컬 템플릿을 확보한다:
    //  - 기존 지정이 로컬 템플릿이면 그대로 편집
    //  - (구형) 전역 템플릿을 참조하던 지정은 편집 가능한 로컬 사본으로 승격
    //  - 지정이 없으면 빈 로컬 템플릿 생성 (빈 채로 닫으면 자동 해제)
    useEffect(() => {
      if (!isOpen) return;
      setLocalId('');
      (async () => {
        // 창 열기 = 명시적 진입점 — 지정 목록(templates.json)을 읽지 못해 막혀 있으면 한 번 다시 읽는다(2026-11-18 T3)
        try {
          await templateService.reloadIfFailed();
        } catch (e) {
          console.error('템플릿 지정 목록 다시 읽기 실패:', e);
        }
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
          // 지정을 저장할 수 없으면(읽기 실패·쓰기 충돌) 폴더 전용 템플릿을 만들지 않고 닫는다 — 막힌 동안은 기존 지정이
          // 비어 보이므로 그대로 만들면 지정 없는 템플릿이 쌓인다(안내는 confirmWritable 의 토스트·확인 창)
          if (!(await templateService.confirmWritable())) {
            onClose();
            return;
          }
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
        updatedAtOnOpenRef.current =
          projectTemplateService.get(id)?.updatedAt ?? 0;
        setLocalId(id);
        setSyncSignal((s) => s + 1);
      })();
    }, [isOpen, folder]);

    const entry = localId ? projectTemplateService.get(localId) : undefined;

    // 공용 편집기 슬롯(탭·본문·바닥줄) — 캐릭터 편집 중(charEditing)·일괄 생성 실행 중(batchRunning, 닫기 차단)
    const panel = useTemplateWorkflowPanel(entry?.id, {
      syncSignal,
      commitRef,
      batchFolder: folder,
      onBatchCompleted: () => {
        // 일괄 생성 직후에는 자식이 이미 최신 구성이다 — 전파 확인
        // 기준(updatedAt)을 리셋해, 닫을 때 방금 만든 자식에게
        // "덮어쓸까요?"가 뜨는 비직관 동작을 막는다 (2026-07-16 실기).
        updatedAtOnOpenRef.current =
          projectTemplateService.get(localId)?.updatedAt ?? 0;
      },
    });
    const { charEditing, batchRunning } = panel;

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
        text: '어떤 전역 템플릿에서 복사해 올까요? (현재 구성 전체를 1회 덮어씁니다)',
        // 고르는 즉시 현재 구성 전체를 덮어쓴다 — 선택지 모두 빨강(D1)
        items: globals.map((t) => ({ text: t.name, value: t.id, danger: true })),
      });
      if (!id) return;
      try {
        await projectTemplateService.overwriteFromTemplate(entry.id, id);
        setSyncSignal((s) => s + 1);
        appState.pushMessage(
          '전역 템플릿 구성을 복사해 왔습니다. 이 폴더 전용으로 자유롭게 세부 조정할 수 있습니다.',
        );
      } catch (e: any) {
        appState.pushMessage(e.message || '복사하지 못했습니다.');
      }
    };

    const clearDesignation = () => {
      if (!localId) return;
      appState.pushDialog({
        type: 'confirm',
        // 이 폴더 전용 템플릿 구성이 지워진다(휴지통 없음) — 영구 삭제(Enter 무시, 2026-10-03 E1)
        ...deleteConfirmText({
          kind: 'template',
          outcome: 'permanent',
          extra: `"${folder}" 폴더 전용 템플릿 구성이며, 폴더의 기본 템플릿 지정도 해제됩니다.`,
        }),
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

    // 닫기: 프롬프트 커밋 후,
    //  - 아무것도 세팅되지 않은 템플릿이면 지정 자동 해제 (빈 템플릿 잔존 방지)
    //  - 수정이 있었고 상속 중인 자식이 있으면 전파(덮어쓰기) 확인
    const handleClose = () => {
      // 일괄 생성 실행 중엔 닫지 않는다 — 진행률·취소 수단 유실 방지 (배치 R3)
      if (batchRunning) {
        appState.pushMessage(
          '일괄 생성이 진행 중입니다 — [취소] 버튼으로 중단한 뒤 닫을 수 있습니다.',
        );
        return;
      }
      if (localId) {
        commitRef.current();
        const e = projectTemplateService.get(localId);
        if (e && projectTemplateService.isEmptyTemplate(e)) {
          // 적용 기록(일괄 생성 자식 등)이 있으면 빈 템플릿이라도 삭제하지
          // 않는다 — 삭제가 기록 정리를 동반해 자식 ♟/보호가 사라진다
          // (2026-07-16 엣지 가드).
          if (!templateService.hasApplications(e.id)) {
            projectTemplateService.delete(localId).catch(() => {});
          }
          onClose();
          return;
        }
        // 전파 확인 — updatedAt 이 변했고(=수정) 상속 자식이 있을 때만
        if (e && e.updatedAt !== updatedAtOnOpenRef.current) {
          const children = templateService.listInheritedChildren(localId);
          if (children.length > 0) {
            const tplId = localId;
            appState.pushDialog({
              type: 'confirm',
              danger: true,
              // 여러 프로젝트에 걸친 교체라 되돌리기 기록이 없다(2026-11-18) — 교체·되돌릴 수 없음을 문구로
              text: REAPPLY_TEXT.propagateConfirm(children.length),
              callback: async () => {
                await projectTemplateService.flushSave();
                const failed: string[] = [];
                for (const child of children) {
                  try {
                    // inherited 플래그는 유지 (opts 미지정 → 기존 기록 값)
                    await sessionService.applyProjectTemplateToSession(
                      tplId,
                      child,
                    );
                  } catch (err) {
                    failed.push(child);
                  }
                }
                if (failed.length > 0) {
                  appState.pushMessage(
                    `일부 프로젝트에 전파하지 못했습니다: ${failed.join(', ')}`,
                  );
                } else {
                  appState.pushMessage(
                    `자식 프로젝트 ${children.length}개에 변경 내용을 전파했습니다.`,
                  );
                }
              },
            });
          }
        }
      }
      onClose();
    };

    // 배치 실행 중·캐릭터 편집 중엔 상단 조작(불러오기·지정 해제·배지 색)을 숨긴다 —
    // 실행 대상 템플릿을 도중에 바꾸거나 지우는 사고 방지 (배치 R3)
    const controlsShown = !!entry && !charEditing && !batchRunning;

    const toolbar =
      panel.tabs || controlsShown ? (
        <>
          {panel.tabs}
          {controlsShown && (
            <button
              className="ml-auto px-3 py-1.5 rounded-lg text-sm btn-solid-sky"
              data-folder-template-import=""
              onClick={importGlobalTemplate}
            >
              <ActionIcon id="copy-to-project" className="inline mr-1.5" size={12} />
              전역 템플릿에서 복사
            </button>
          )}
          {/* 배지 매직 컬러 — ♚(이 폴더)·♟(상속 자식) 배지를 이 색으로
              표시해 어느 부모의 자식인지 구분한다. 선택 즉시 저장. */}
          {controlsShown && entry && (
            <div
              className="w-full flex items-center gap-2 flex-wrap"
              data-folder-template-badge=""
            >
              <span className="text-sm text-muted flex-none inline-flex items-center gap-1.5">
                배지 색 (♚/♟)
                {/* 2026-11-20 그룹 1-b: 기호 설명 툴팁 → 「기호 칩 + 뜻」 짧은 패널(문구 = models/helpPanelTexts.ts) */}
                <HelpPanelButton data={TEMPLATE_BADGE_HELP} width={320} exampleWidth={28} />
              </span>
              {FOLDER_COLORS.map((c) => {
                const selected = entry.badgeColor === c;
                return (
                  <button
                    key={c}
                    title={c}
                    onClick={() =>
                      setTemplateBadgeColorRecorded(entry.id, c).catch(() => {})
                    }
                    className="w-6 h-6 rounded-full flex-none transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      boxShadow: selected
                        ? `0 0 0 2px #fff, 0 0 0 4px ${c}`
                        : 'none',
                    }}
                  />
                );
              })}
              <button
                onClick={() =>
                  setTemplateBadgeColorRecorded(entry.id, null).catch(() => {})
                }
                className="px-2 h-6 rounded-md text-xs flex-none btn-neutral text-gray-600 dark:text-gray-200"
              >
                기본
              </button>
            </div>
          )}
        </>
      ) : undefined;

    // 바닥줄 왼쪽 = [지정 해제](위험) + 일괄 생성 진행·결과. 편집 중·실행 중엔 [지정 해제]를 숨긴다(종전 상단 줄과 같은 조건)
    const footerStart =
      controlsShown || panel.footerStart ? (
        <>
          {controlsShown && (
            <button
              className={DIALOG_DANGER_BTN}
              data-folder-template-clear=""
              onClick={clearDesignation}
            >
              지정 해제
            </button>
          )}
          {panel.footerStart}
        </>
      ) : undefined;

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={handleClose}
        title={
          <span className="inline-flex items-center gap-1.5">
            {`폴더 기본 템플릿 — ${folder}`}
            {/* 2026-11-20 그룹 1-b: 2줄 툴팁 → 누르면 열리는 짧은 패널(문구 = models/helpPanelTexts.ts) */}
            <HelpPanelButton data={FOLDER_TEMPLATE_HELP} width={400} />
          </span>
        }
        size="l"
        toolbar={toolbar}
        footer={panel.footer ?? undefined}
        footerStart={footerStart}
        // 캐릭터 편집(PC) = 안쪽 편집기 layout="frame" 이 창 본문을 채우고 자체 바닥줄을 그린다(2026-11-15 C-3b)
        bodyPadding={panel.charEditing && !isMobile ? 'none' : 'normal'}
      >
        {entry ? (
          panel.body
        ) : (
          <div className="text-sm text-muted py-6 text-center">
            불러오는 중...
          </div>
        )}
      </ModalOverlay>
    );
  },
);

// ===== 템플릿 수동 재적용 모달 =====
//
// 템플릿의 프리셋·캐릭터 프리셋·바이브/레퍼런스를 기존 프로젝트에 적용한다. 이 템플릿으로 이전에 적용한 적이 있으면 적용 기록에
// 적힌 **이름**의 항목을 지우고 다시 만든다(교체 — 그 이름이면 사용자가 고친 것도 교체, 비파괴 아님). 씬·생성 이미지는 건드리지
// 않는다(씬은 씬 템플릿 가져오기 기능이 담당). 대상이 지금 열린 프로젝트면 되돌리기(Ctrl+Z) 한 항목(2026-11-18,
// templateReapplyFlow) — 창 본문이 교체될 이름과 되돌리기 가능 여부를 보여 준다(templateReapplyPreview).
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
        // 창 열기 = 명시적 진입점 — 막혀 있으면 지정 목록을 한 번 다시 읽는다(적용 기록·폴더 기본 템플릿 판정용)
        try {
          await templateService.reloadIfFailed();
        } catch (e) {
          console.error('템플릿 지정 목록 다시 읽기 실패:', e);
        }
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
    // 교체될 이름·되돌리기 가능 여부(2026-11-18) — 미리보기를 못 만들면(읽기 전 등) 줄 없이
    let previewLines: string[] = [];
    if (entry) {
      try {
        const preview = previewReapply(entry.id, target);
        if (preview) previewLines = reapplyPreviewLines(preview, reapplyUndoState(target));
      } catch (e) {
        previewLines = [];
      }
    }

    const apply = async () => {
      if (!selected || busy) return;
      setBusy(true);
      try {
        const { recorded } = await reapplyTemplateToProject(selected, target);
        appState.pushMessage(
          `"${target}"에 템플릿 "${entry?.name ?? ''}" 구성을 적용했습니다.` +
            (recorded ? ` ${REAPPLY_TEXT.undoable}` : ''),
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
        size="s"
        // 2026-11-12 오버레이 묶음 A: 바닥줄 [적용][취소]([확인][취소] 순서, 규격은 내보내기 프리셋 관리와 같다).
        // [취소] = 닫기(onClose 그대로 — 미저장 가드 없음). 템플릿이 하나도 없으면 고를 것이 없어 [닫기] 하나.
        footer={
          <>
            {hasAny && (
              <button
                className={DIALOG_PRIMARY_BTN + ' disabled:opacity-50 disabled:cursor-not-allowed'}
                disabled={!selected || busy}
                onClick={apply}
              >
                {busy ? '적용 중...' : '적용'}
              </button>
            )}
            <button
              className={DIALOG_SECONDARY_BTN}
              onClick={onClose}
            >
              {hasAny ? '취소' : '닫기'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{REAPPLY_TEXT.intro}</p>
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
                  className="app-select w-full"
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
                    {entry.characterPresets.length}개 · 바이브{' '}
                    {entry.vibes?.length ?? 0} · 레퍼런스{' '}
                    {entry.characterReferences?.length ?? 0}
                  </span>
                )}
              </div>
              {previewLines.length > 0 && (
                <div
                  className="flex flex-col gap-1 text-sm text-default break-words"
                  data-reapply-preview=""
                >
                  {previewLines.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </ModalOverlay>
    );
  },
);
