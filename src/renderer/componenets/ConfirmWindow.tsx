import { useEffect, useRef, useState } from 'react';
import { DropdownSelect } from './UtilComponents';
import { appState } from '../models/AppService';
import { backStackService } from '../models/BackStackService';
import { confirmEnterAction } from '../models/confirmKeys';
import { isImeComposing } from '../models/escapeGate';
import { observer } from 'mobx-react-lite';
import { FaChevronDown, FaChevronRight } from 'react-icons/fa';
import {
  groupPreview,
  loadOpenGroups,
  saveOpenGroups,
  sectionsOf,
} from '../models/selectDialogGroups';

export interface Dialog {
  text: string;
  callback?:
    | ((value?: string, text?: string) => void)
    | ((value?: string, text?: string) => Promise<void>);
  onCancel?: () => void;
  type: 'confirm' | 'yes-only' | 'input-confirm' | 'textarea-confirm' | 'select' | 'dropdown' | 'checkbox';
  inputValue?: string;
  green?: boolean;
  graySelect?: boolean;
  // select: group 이 있으면 같은 이름끼리 접이식 폴더로 묶인다. groupFoldKey 가 있으면 접힘 상태를 기억한다.
  items?: { text: string; value: string; group?: string }[];
  groupFoldKey?: string;
  showSkipConfirm?: boolean;
  // confirm 타입의 버튼 라벨 교체 (미지정 시 확인/취소)
  confirmText?: string;
  cancelText?: string;
}

const ConfirmWindow = observer(() => {
  const [inputValue, setInputValue] = useState<string>('');
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [dropdownMenuOpen, setDropdownMenuOpen] = useState(false);
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

  const handleConfirm = () => {
    const currentDialog = appState.dialogs[appState.dialogs.length - 1];
    // 드롭다운은 값을 고르기 전에는 확인하지 않는다(버튼도 비활성)
    if (currentDialog?.type === 'dropdown' && !inputValue) return;
    if (appState.dialogs.length > 0) appState.dialogs.pop();
    if (currentDialog && currentDialog.callback) {
      if (currentDialog.showSkipConfirm && skipConfirm) {
        appState.skipImageDeleteConfirm = true;
      }
      if (currentDialog.type === 'checkbox') {
        currentDialog.callback(
          JSON.stringify(Array.from(checkedItems)),
        );
      } else {
        currentDialog.callback(
          currentDialog.type === 'input-confirm' ||
            currentDialog.type === 'textarea-confirm' ||
            currentDialog.type === 'dropdown'
            ? inputValue
            : undefined,
          currentDialog.text,
        );
      }
    }
    setInputValue('');
    setCheckedItems(new Set());
    setSkipConfirm(false);
  };

  const curDialog = appState.dialogs[appState.dialogs.length - 1];
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
                onChange={(e) => setInputValue(e.target.value)}
                className={`gray-input mt-4 mb-4`}
              />
            )}
            {curDialog.type === 'textarea-confirm' && (
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className={`gray-input mt-4 mb-4 resize-none`}
                rows={6}
                placeholder={curDialog.inputValue}
              />
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
                  <button
                    className={
                      'mr-2 px-4 py-2 rounded clickable ' +
                      (curDialog.green ? 'back-sky' : 'back-red')
                    }
                    onClick={handleConfirm}
                  >
                    {curDialog.confirmText ?? '확인'}
                  </button>
                   <button
                    className="px-4 py-2 rounded back-gray clickable "
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
                      const itemButton = (
                        item: { text: string; value: string },
                        key: string,
                      ) => (
                        <button
                          key={key}
                          className={
                            'w-full px-4 py-2 rounded clickable shrink-0 ' +
                            (curDialog.graySelect ? 'back-lgray' : 'back-sky')
                          }
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
                      return sectionsOf(curDialog.items!).map((sec, idx) => {
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
                  <button
                    className="w-full px-4 py-2 clickable rounded back-gray shrink-0"
                    onClick={cancelTop}
                  >
                    취소
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
                      options={curDialog.items!.map((item: any) => ({
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
                      취소
                    </button>
                  </div>
                </>
              )}
              {curDialog.type === 'checkbox' && (
                <>
                  <div className="flex flex-col gap-1 mt-2 mb-2 w-full max-h-[50vh] overflow-y-auto">
                    {curDialog.items!.map((item, idx) => (
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
                        <span className="text-default">{item.text}</span>
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
                      취소
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
