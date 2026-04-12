import { useContext, useEffect, useState } from 'react';
import { DropdownSelect } from './UtilComponents';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';

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
  items?: { text: string; value: string }[];
}

const ConfirmWindow = observer(() => {
  const [inputValue, setInputValue] = useState<string>('');
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const handleConfirm = () => {
    const currentDialog = appState.dialogs[appState.dialogs.length - 1];
    if (appState.dialogs.length > 0) appState.dialogs.pop();
    if (currentDialog && currentDialog.callback) {
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
  };

  const curDialog = appState.dialogs[appState.dialogs.length - 1];
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (curDialog?.type === 'textarea-confirm') return;
        if (curDialog) e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [inputValue, checkedItems, appState.dialogs]);

  return (
    <>
      {appState.dialogs.length > 0 && (
        <div className="fixed flex justify-center w-full confirm-window">
          <div className="flex flex-col justify-between m-4 p-4 rounded-md shadow-xl bg-white dark:bg-slate-800 text-black w-96">
            <div className="break-keep text-center text-default whitespace-pre-wrap">
              {curDialog.text}
            </div>
            {curDialog.type === 'input-confirm' && (
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className={`gray-input mt-4 mb-4`}
              />
            )}
            {curDialog.type === 'textarea-confirm' && (
              <textarea
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
                  <button
                    className={
                      'mr-2 px-4 py-2 rounded clickable ' +
                      (curDialog.green ? 'back-sky' : 'back-red')
                    }
                    onClick={handleConfirm}
                  >
                    확인
                  </button>
                  <button
                    className="px-4 py-2 rounded back-gray clickable "
                    onClick={() => {
                      if (curDialog.onCancel) curDialog.onCancel();
                      appState.dialogs.pop();
                      setInputValue('');
                    }}
                  >
                    취소
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
                    onClick={() => {
                      if (curDialog.onCancel) curDialog.onCancel();
                      appState.dialogs.pop();
                      setInputValue('');
                    }}
                  >
                    취소
                  </button>
                </>
              )}
              {curDialog.type === 'select' && (
                <>
                  {curDialog.items!.map((item, idx) => (
                    <button
                      key={idx}
                      className={
                        'w-full px-4 py-2 rounded mr-2 clickable ' +
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
                  ))}
                  <button
                    className="w-full px-4 py-2 clickable rounded back-gray"
                    onClick={() => {
                      if (curDialog.onCancel) curDialog.onCancel();
                      appState.dialogs.pop();
                    }}
                  >
                    취소
                  </button>
                </>
              )}
              {curDialog.type === 'dropdown' && (
                <>
                  <div className="w-full mt-4">
                    <DropdownSelect
                      className="z-20 w-full"
                      selectedOption={curDialog.items!.find(
                        (item) => item.value === inputValue,
                      )}
                      menuPlacement="bottom"
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
                    >
                      확인
                    </button>
                    <button
                      className="flex-1 px-4 py-2 block rounded back-gray clickable"
                      onClick={() => {
                        if (curDialog.onCancel) curDialog.onCancel();
                        appState.dialogs.pop();
                        setInputValue('');
                        setCheckedItems(new Set());
                      }}
                    >
                      취소
                    </button>
                  </div>
                </>
              )}
              {curDialog.type === 'checkbox' && (
                <>
                  <div className="flex flex-col gap-1 mt-2 mb-2 w-full">
                    {curDialog.items!.map((item, idx) => (
                      <label
                        key={idx}
                        className="flex items-center gap-2 px-3 py-2 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
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
                      onClick={() => {
                        if (curDialog.onCancel) curDialog.onCancel();
                        appState.dialogs.pop();
                        setInputValue('');
                        setCheckedItems(new Set());
                      }}
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
