import { useEffect, useRef, useState } from 'react';
import { DropdownSelect } from './UtilComponents';
import { appState } from '../models/AppService';
import { backStackService } from '../models/BackStackService';
import {
  ConfirmDanger,
  confirmEnterAction,
  isCancelLikeItem,
  withoutCancelLikeItems,
} from '../models/confirmKeys';
import { isImeComposing } from '../models/escapeGate';
import { observer } from 'mobx-react-lite';
import { FaChevronDown, FaChevronRight } from 'react-icons/fa';
import {
  groupPreview,
  loadOpenGroups,
  saveOpenGroups,
  sectionsOf,
} from '../models/selectDialogGroups';

/** select·dropdown·checkbox 의 선택지. danger 면 그 항목만 빨강(파괴적 선택지 — 2026-10-03 D1). */
export interface DialogItem {
  text: string;
  value: string;
  group?: string;
  danger?: boolean;
}

export interface Dialog {
  text: string;
  callback?:
    | ((value?: string, text?: string) => void)
    | ((value?: string, text?: string) => Promise<void>);
  onCancel?: () => void;
  type: 'confirm' | 'yes-only' | 'input-confirm' | 'textarea-confirm' | 'select' | 'dropdown' | 'checkbox';
  inputValue?: string;
  // confirm 위험도(models/confirmKeys.ConfirmDanger): 없음=파랑 [확인]·Enter 확인, true=빨강·Enter 확인,
  // 'permanent'=빨강·Enter 무시(되돌릴 수 없는 영구 삭제·덮어쓰기). 예전 green 옵션은 없앴다(기본이 파랑).
  danger?: ConfirmDanger;
  // 버튼 클릭·탭 필수(위험도·색과 별개) — confirm 의 Enter 를 무시한다. 생성 도중 비동기로 뜨는 과금 확인용.
  requireClick?: boolean;
  graySelect?: boolean;
  // select: group 이 있으면 같은 이름끼리 접이식 폴더로 묶인다. groupFoldKey 가 있으면 접힘 상태를 기억한다.
  // 「취소」류 항목은 넣지 않는다 — 창이 내장 취소 하나를 그린다(넣으면 걸러짐, specGuard 차단).
  items?: DialogItem[];
  groupFoldKey?: string;
  showSkipConfirm?: boolean;
  // confirmText = confirm 의 [확인] 라벨(미지정 시 「확인」).
  // cancelText = confirm·select·dropdown·checkbox 의 내장 취소 라벨(미지정 시 「취소」, 예: 「나중에」).
  confirmText?: string;
  cancelText?: string;
  // input-confirm·textarea-confirm 의 입력 검증(2026-10-03 D2 이름 입력 규칙). [확인]·Enter 때 값 계산 뒤·닫기 전에
  // 부른다 — 오류 문구를 돌려주면 창을 닫지 않고 입력칸 아래에 표시(입력 보존·포커스 유지), null 이면 닫고 콜백.
  // Promise 를 돌려주면 끝날 때까지 [확인]·Enter 를 막는다. 이름 입력은 models/nameInput.promptName 이 채운다.
  validate?: (value: string) => string | null | Promise<string | null>;
}

const ConfirmWindow = observer(() => {
  const [inputValue, setInputValue] = useState<string>('');
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [dropdownMenuOpen, setDropdownMenuOpen] = useState(false);
  // 입력 검증(validate) 오류 문구 — 입력칸 아래 표시, 입력을 고치면 지운다.
  const [inputError, setInputError] = useState<string | null>(null);
  // 검증 중인 창(없으면 null) — 그동안 [확인]·Enter 중복 차단, 입력칸 읽기 전용.
  const validatingRef = useRef<Dialog | null>(null);
  const [validating, setValidating] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const topDialog = appState.dialogs[appState.dialogs.length - 1];
  const foldKey = topDialog?.type === 'select' ? topDialog.groupFoldKey : undefined;
  // 대화상자가 열릴 때 저장된 펼침 상태를 읽는다(foldKey 가 없으면 전부 접힘에서 시작)
  useEffect(() => {
    setOpenGroups(foldKey ? loadOpenGroups(foldKey) : new Set());
  }, [foldKey, topDialog]);
  // 맨 위 대화상자가 바뀔 때마다 입력 상태를 새로 시작한다(뒤로 가기·Esc 로 닫힌 앞 창의 값이 남지 않게).
  // input-confirm 은 inputValue 가 있으면 그 값을 처음 값으로 채운다(없으면 빈 칸 —
  // 기존 동작). textarea-confirm 의 inputValue 는 종전대로 placeholder 로만 쓴다.
  // 입력칸은 열릴 때 포커스(미리 채운 값은 전체 선택) — PC·모바일 공통(창이 화면 위쪽이라 키보드에 가리지 않고,
  // 인라인 이름 편집 칸들도 양 플랫폼 autoFocus 관례). 2026-10-03 U1·X1.
  useEffect(() => {
    setInputValue(
      topDialog?.type === 'input-confirm' ? topDialog.inputValue ?? '' : '',
    );
    setCheckedItems(new Set());
    setSkipConfirm(false);
    setDropdownMenuOpen(false);
    setInputError(null);
    validatingRef.current = null;
    setValidating(false);
    if (topDialog?.type !== 'input-confirm' && topDialog?.type !== 'textarea-confirm') {
      return undefined;
    }
    const t = window.setTimeout(() => {
      const el = topDialog.type === 'input-confirm' ? inputRef.current : textareaRef.current;
      if (!el) return;
      el.focus();
      if (el.value) el.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [topDialog]);

  // 런타임 가드(2026-10-03 D3): select·dropdown·checkbox 의 「취소」류 항목은 그리지 않는다(내장 취소 하나만).
  // 걸러내기는 렌더에서, 경고는 창이 바뀔 때 한 번만(개발 빌드).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const dropped = (topDialog?.items ?? []).filter(isCancelLikeItem);
    if (dropped.length > 0) {
      console.warn(
        '[ConfirmWindow] 「취소」류 선택지는 내장 취소와 중복이라 걸러냈습니다 — cancelText 를 쓰세요:',
        dropped.map((it) => it.text),
      );
    }
  }, [topDialog]);

  // 맨 위 대화상자를 취소로 닫는다(취소 버튼·Esc·뒤로 가기 공용).
  const cancelTop = () => {
    const top = appState.dialogs[appState.dialogs.length - 1];
    if (!top) return;
    if (top.onCancel) top.onCancel();
    appState.dialogs.pop();
    setInputValue('');
    setCheckedItems(new Set());
    setSkipConfirm(false);
  };

  // [확인] 으로 넘길 값 — checkbox 는 고른 값 목록(JSON), 입력·드롭다운은 입력값, 그 밖은 없음.
  const confirmValue = (dialog: Dialog): string | undefined => {
    if (dialog.type === 'checkbox') return JSON.stringify(Array.from(checkedItems));
    return dialog.type === 'input-confirm' ||
      dialog.type === 'textarea-confirm' ||
      dialog.type === 'dropdown'
      ? inputValue
      : undefined;
  };

  // 맨 위 창을 닫고(pop) 콜백을 부른다 — 순서 고정(콜백이 새 창을 쌓아도 그 창이 맨 위에 남는다).
  const finishConfirm = (dialog: Dialog | undefined, value: string | undefined) => {
    if (appState.dialogs.length > 0) appState.dialogs.pop();
    if (dialog && dialog.callback) {
      if (dialog.showSkipConfirm && skipConfirm) {
        appState.skipImageDeleteConfirm = true;
      }
      if (dialog.type === 'checkbox') {
        dialog.callback(value);
      } else {
        dialog.callback(value, dialog.text);
      }
    }
    setInputValue('');
    setCheckedItems(new Set());
    setSkipConfirm(false);
  };

  // 검증 실패 뒤 입력칸으로 포커스를 되돌린다(입력은 그대로).
  const refocusInput = (dialog: Dialog) => {
    const el = dialog.type === 'input-confirm' ? inputRef.current : textareaRef.current;
    if (el) el.focus();
  };

  const handleConfirm = async () => {
    // 검증 중에는 [확인]·Enter 를 다시 받지 않는다(중복 확정 차단)
    if (validatingRef.current) return;
    const currentDialog = appState.dialogs[appState.dialogs.length - 1];
    // 드롭다운은 값을 고르기 전에는 확인하지 않는다(버튼도 비활성)
    if (currentDialog?.type === 'dropdown' && !inputValue) return;
    const value = currentDialog ? confirmValue(currentDialog) : undefined;
    // 입력 검증(D2) — 값 계산 뒤·닫기 전. 실패면 창을 유지하고 오류를 입력칸 아래에 보인다.
    // 검증이 없으면 아래로 바로 내려가 동기적으로 닫는다(기존 동작 그대로).
    if (
      currentDialog?.validate &&
      (currentDialog.type === 'input-confirm' || currentDialog.type === 'textarea-confirm')
    ) {
      validatingRef.current = currentDialog;
      setValidating(true);
      let error: string | null;
      try {
        error = await currentDialog.validate(value ?? '');
      } catch (e: any) {
        error = (e && e.message) || '입력을 확인하지 못했습니다.';
      }
      if (validatingRef.current === currentDialog) {
        validatingRef.current = null;
        setValidating(false);
      }
      // 검증하는 동안 창이 닫혔거나(Esc·취소) 다른 창이 위에 쌓였으면 아무것도 하지 않는다
      if (appState.dialogs[appState.dialogs.length - 1] !== currentDialog) return;
      if (error) {
        setInputError(error);
        refocusInput(currentDialog);
        return;
      }
    }
    finishConfirm(currentDialog, value);
  };

  const curDialog = appState.dialogs[appState.dialogs.length - 1];
  // 선택지(select·dropdown·checkbox) — 「취소」류 항목은 걸러낸다(내장 취소 하나만, D3 런타임 가드)
  const visibleItems = withoutCancelLikeItems(curDialog?.items);
  // Enter 규칙(models/confirmKeys.ts): 타입별 확인/무시, IME 조합·창 안 버튼·textarea·펼친 드롭다운은 양보.
  // 캡처 단계에서 받아 확인 창이 떠 있는 동안 Enter 가 아래 화면(입력칸의 Enter 동작 등)으로 새지 않게 한다.
  const handleConfirmRef = useRef(handleConfirm);
  handleConfirmRef.current = handleConfirm;
  const enterCtxRef = useRef({ dropdownMenuOpen, dropdownChosen: !!inputValue });
  enterCtxRef.current = { dropdownMenuOpen, dropdownChosen: !!inputValue };
  const hasDialog = appState.dialogs.length > 0;
  useEffect(() => {
    if (!hasDialog) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const top = appState.dialogs[appState.dialogs.length - 1];
      if (!top) return;
      const target = e.target as HTMLElement | null;
      const inDialog = !!target && !!rootRef.current?.contains(target);
      const action = confirmEnterAction(top.type, {
        composing: isImeComposing(e),
        inTextarea: inDialog && target!.tagName === 'TEXTAREA',
        onDialogButton: inDialog && target!.tagName === 'BUTTON',
        danger: top.danger,
        requireClick: top.requireClick,
        ...enterCtxRef.current,
      });
      if (action === 'pass') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (action === 'confirm') handleConfirmRef.current();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [hasDialog]);

  // 안드로이드 뒤로가기·PC Esc(닫기 관문)로 최상단 다이얼로그를 취소한다. 다이얼로그는
  // appState.dialogs 배열로 쌓이므로 length 가 바뀔 때마다 백스택 항목을
  // 최상단으로 갱신하고, onClose 는 호출 시점의 top 을 취소한다(취소 콜백 포함).
  // preempt: 확인 창은 화면 맨 위 층(--z-confirm)이라 나중에 열린 모달·편집 모드보다도 먼저 Esc 를 받는다.
  const cancelTopRef = useRef(cancelTop);
  cancelTopRef.current = cancelTop;
  useEffect(() => {
    if (appState.dialogs.length === 0) return;
    const handle = backStackService.push(() => cancelTopRef.current(), {
      preempt: true,
    });
    return () => handle.remove();
  }, [appState.dialogs.length]);

  return (
    <>
      {appState.dialogs.length > 0 && (
        <div className="fixed flex justify-center w-full confirm-window">
          <div
            ref={rootRef}
            className="flex flex-col justify-between m-4 p-4 rounded-md r-modal shadow-xl bg-[var(--c-zone)] text-default w-96 max-w-[90vw]"
          >
            <div className="break-keep text-center text-default whitespace-pre-wrap">
              {curDialog.text}
            </div>
            {curDialog.type === 'input-confirm' && (
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                readOnly={validating}
                aria-invalid={inputError ? true : undefined}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setInputError(null);
                }}
                className={`gray-input mt-4 mb-4`}
              />
            )}
            {curDialog.type === 'textarea-confirm' && (
              <textarea
                ref={textareaRef}
                value={inputValue}
                readOnly={validating}
                aria-invalid={inputError ? true : undefined}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setInputError(null);
                }}
                className={`gray-input mt-4 mb-4 resize-none`}
                rows={6}
                placeholder={curDialog.inputValue}
              />
            )}
            {inputError &&
              (curDialog.type === 'input-confirm' || curDialog.type === 'textarea-confirm') && (
                <div
                  role="alert"
                  data-input-error=""
                  className="-mt-2 mb-2 text-sm break-keep whitespace-pre-wrap text-red-500 dark:text-red-400"
                >
                  {inputError}
                </div>
              )}
            <div
              className={
                'justify-end mt-4 ' +
                (curDialog.type === 'select' || curDialog.type === 'dropdown' || curDialog.type === 'checkbox'
                  ? 'flex flex-col gap-2'
                  : 'flex')
              }
            >
              {curDialog.type === 'confirm' && (
                <>
                  {curDialog.showSkipConfirm && (
                    <label className="flex items-center gap-2 mt-3 text-sm text-muted cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={skipConfirm}
                        onChange={(e) => setSkipConfirm(e.target.checked)}
                        className="w-4 h-4 rounded accent-sky-500"
                      />
                      이번 세션에서 다시 묻지 않음
                    </label>
                  )}
                  {/* [확인][취소] 순서 고정. 색은 위험도로만 — 중립 파랑, 파괴적(danger) 빨강 */}
                  <button
                    className={
                      'mr-2 px-4 py-2 rounded clickable ' +
                      (curDialog.danger ? 'back-red' : 'back-sky')
                    }
                    data-danger={curDialog.danger ? String(curDialog.danger) : undefined}
                    onClick={handleConfirm}
                  >
                    {curDialog.confirmText ?? '확인'}
                  </button>
                  <button
                    className="px-4 py-2 rounded back-gray clickable"
                    onClick={cancelTop}
                  >
                    {curDialog.cancelText ?? '취소'}
                  </button>
                </>
              )}
              {curDialog.type === 'yes-only' && (
                <button
                  className="px-4 py-2 rounded back-sky clickable"
                  onClick={handleConfirm}
                >
                  확인
                </button>
              )}
              {(curDialog.type === 'input-confirm' || curDialog.type === 'textarea-confirm') && (
                <>
                  <button
                    className="mr-2 px-4 py-2 rounded back-sky clickable"
                    onClick={handleConfirm}
                    disabled={validating}
                  >
                    확인
                  </button>
                  <button
                    className="px-4 py-2 rounded back-gray clickable"
                    onClick={cancelTop}
                  >
                    취소
                  </button>
                </>
              )}
              {curDialog.type === 'select' && (
                <>
                  {/* 항목이 많아지면 화면 밖으로 잘리지 않도록 스크롤 영역으로 감싼다 */}
                  <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto">
                    {(() => {
                      const itemButton = (item: DialogItem, key: string) => (
                        <button
                          key={key}
                          className={
                            'w-full px-4 py-2 rounded clickable shrink-0 ' +
                            (item.danger
                              ? 'back-red'
                              : curDialog.graySelect
                                ? 'back-lgray'
                                : 'back-sky')
                          }
                          data-danger={item.danger ? 'true' : undefined}
                          onClick={() => {
                            appState.dialogs.pop();
                            if (curDialog.callback) {
                              curDialog.callback!(item.value, item.text);
                            }
                          }}
                        >
                          {item.text}
                        </button>
                      );
                      return sectionsOf(visibleItems).map((sec, idx) => {
                        if (sec.kind === 'item') {
                          return itemButton(sec.item, 'i' + idx);
                        }
                        const open = openGroups.has(sec.name);
                        return (
                          <div
                            key={'g' + sec.name}
                            className="shrink-0 rounded border line-color"
                            data-select-group={sec.name}
                          >
                            <button
                              type="button"
                              aria-expanded={open}
                              className="w-full px-3 py-2 flex items-center gap-2 text-left clickable rounded"
                              onClick={() => {
                                const next = new Set(openGroups);
                                if (open) next.delete(sec.name);
                                else next.add(sec.name);
                                setOpenGroups(next);
                                if (curDialog.groupFoldKey) {
                                  saveOpenGroups(curDialog.groupFoldKey, next);
                                }
                              }}
                            >
                              <span className="flex-none text-faint">
                                {open ? (
                                  <FaChevronDown size={10} />
                                ) : (
                                  <FaChevronRight size={10} />
                                )}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-default font-semibold">
                                  {sec.name}
                                  <span className="ml-1.5 text-faint font-normal text-xs">
                                    {sec.items.length}
                                  </span>
                                </span>
                                {!open && (
                                  <span className="block text-faint text-xs truncate">
                                    {groupPreview(sec.items)}
                                  </span>
                                )}
                              </span>
                            </button>
                            {open && (
                              <div className="flex flex-col gap-2 px-2 pb-2">
                                {sec.items.map((item, i) =>
                                  itemButton(item, sec.name + i),
                                )}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                  {/* 내장 취소 — select 의 유일한 취소(items 에 「취소」를 넣지 않는다) */}
                  <button
                    className="w-full px-4 py-2 clickable rounded back-gray shrink-0"
                    onClick={cancelTop}
                  >
                    {curDialog.cancelText ?? '취소'}
                  </button>
                </>
              )}
              {curDialog.type === 'dropdown' && (
                <>
                  {/* 목록이 펼쳐진 동안 Esc 는 목록 닫기(창 취소 아님) — data-esc-cancel(닫기 관문 규칙) */}
                  <div
                    className="w-full mt-4"
                    data-esc-cancel={dropdownMenuOpen ? 'true' : 'false'}
                  >
                    <DropdownSelect
                      className="z-20 w-full"
                      // 선택값은 value 문자열로 넘긴다(예전엔 항목 객체를 넘겨 고른 값이 칸에 표시되지 않았다)
                      selectedOption={inputValue || undefined}
                      menuPlacement="bottom"
                      placeholder="선택하세요"
                      onMenuOpenChange={setDropdownMenuOpen}
                      options={visibleItems.map((item) => ({
                        label: item.text,
                        value: item.value,
                      }))}
                      onSelect={(opt: any) => {
                        setInputValue(opt.value);
                      }}
                    />
                  </div>
                  <div className="flex gap-2 ml-auto mt-5">
                    <button
                      className="flex-1 px-4 py-2 block rounded back-sky clickable"
                      onClick={handleConfirm}
                      disabled={!inputValue}
                    >
                      확인
                    </button>
                    <button
                      className="flex-1 px-4 py-2 block rounded back-gray clickable"
                      onClick={cancelTop}
                    >
                      {curDialog.cancelText ?? '취소'}
                    </button>
                  </div>
                </>
              )}
              {curDialog.type === 'checkbox' && (
                <>
                  <div className="flex flex-col gap-1 mt-2 mb-2 w-full max-h-[50vh] overflow-y-auto">
                    {visibleItems.map((item, idx) => (
                      <label
                        key={idx}
                        className="flex items-center gap-2 px-3 py-2 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 shrink-0"
                      >
                        <input
                          type="checkbox"
                          checked={checkedItems.has(item.value)}
                          onChange={(e) => {
                            const next = new Set(checkedItems);
                            if (e.target.checked) next.add(item.value);
                            else next.delete(item.value);
                            setCheckedItems(next);
                          }}
                          className="w-4 h-4 flex-shrink-0"
                        />
                        <span
                          className={item.danger ? 'text-red-500 dark:text-red-400' : 'text-default'}
                        >
                          {item.text}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2 w-full">
                    <button
                      className="flex-1 px-4 py-2 rounded back-sky clickable"
                      onClick={handleConfirm}
                    >
                      확인
                    </button>
                    <button
                      className="flex-1 px-4 py-2 rounded back-gray clickable"
                      onClick={cancelTop}
                    >
                      {curDialog.cancelText ?? '취소'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default ConfirmWindow;
