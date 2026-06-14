import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { FaTimes } from 'react-icons/fa';
import { appState } from '../models/AppService';

const TOAST_DURATION = 5000;

// 개별 토스트: 자기 자신의 자동 제거 타이머를 가진다(id 기준).
// 표시되는 순간부터 항상 TOAST_DURATION 만큼 노출 → 전역 인터벌의 위상 문제로
// "깜빡"하고 사라지던 버그 해결.
const Toast = observer(({ id, text }: { id: number; text: string }) => {
  useEffect(() => {
    const t = setTimeout(() => appState.removeMessage(id), TOAST_DURATION);
    return () => clearTimeout(t);
  }, [id]);

  return (
    <div className="toast-rise titlebar-no-drag flex items-center justify-between gap-3 mb-2 pl-4 pr-2 py-3 rounded-md shadow-xl bg-red-600 text-white w-full pointer-events-auto">
      <div className="flex-1 break-words">{text}</div>
      <button
        className="flex-none p-2 rounded-md hover:bg-red-700 active:bg-red-800 transition-colors"
        aria-label="닫기"
        onClick={() => appState.removeMessage(id)}
      >
        <FaTimes size={16} />
      </button>
    </div>
  );
});

const AlertWindow = observer(() => {
  const { messages } = appState;
  return (
    <div className="fixed flex justify-center w-full alert-window pointer-events-none">
      <div className="w-3/4 max-w-2xl m-4 flex flex-col">
        {messages.map((m) => (
          <Toast key={m.id} id={m.id} text={m.text} />
        ))}
      </div>
    </div>
  );
});

export default AlertWindow;
