import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { FaCheckCircle, FaExclamationCircle, FaInfoCircle, FaTimes } from 'react-icons/fa';
import { appState } from '../models/AppService';
import type { ToastKind } from '../models/toastKind';

// 표시 시간 — App.css .toast-rise 의 사라짐 페이드(toast-out, 끝나기 0.2초 전 시작)와 짝. 토스트 요소에 --toast-duration 으로
// 넘겨 CSS 지연값이 이 상수 하나에서 정해진다(CSS 대체값 5000ms 도 같은 값 — 바꾸면 함께).
const TOAST_DURATION = 5000;
const TOAST_STYLE = { '--toast-duration': `${TOAST_DURATION}ms` } as CSSProperties;

// 종류별 색(2026-10-03 U1·X7 — 예전엔 항상 빨강이라 성공 알림도 오류처럼 보였다).
// error = 종전 빨강(토스트 리터럴 예외, SPEC §1). success·info = 상태색 토큰(back-green / back-gray).
// 다크·트루다크의 back-* 배경은 반투명이라 바깥 껍데기를 불투명 --c-zone 으로 깔고 그 위에 색층을 얹는다
// (화면 위에 떠도 아래 내용이 비치지 않게). 닫기 버튼 hover 는 색과 무관한 흑색 반투명 덧칠.
const TONE: Record<ToastKind, { layer: string; close: string }> = {
  error: { layer: 'bg-red-600 text-white', close: 'hover:bg-red-700 active:bg-red-800' },
  success: { layer: 'back-green', close: 'hover:bg-black/10 active:bg-black/20' },
  info: { layer: 'back-gray', close: 'hover:bg-black/10 active:bg-black/20' },
};

// 종류 아이콘(UI 정돈 그룹 2-d) — 색만으로 종류를 가르지 않게 글자 앞에 작은 원형 아이콘. 색은 글자색(currentColor) 그대로.
export const TOAST_ICON: Record<ToastKind, typeof FaInfoCircle> = {
  error: FaExclamationCircle,
  success: FaCheckCircle,
  info: FaInfoCircle,
};

// 개별 토스트: 자기 자신의 자동 제거 타이머를 가진다(id 기준).
// 표시되는 순간부터 항상 TOAST_DURATION 만큼 노출 → 전역 인터벌의 위상 문제로
// "깜빡"하고 사라지던 버그 해결.
const Toast = observer(
  ({ id, text, kind }: { id: number; text: string; kind: ToastKind }) => {
    useEffect(() => {
      const t = setTimeout(() => appState.removeMessage(id), TOAST_DURATION);
      return () => clearTimeout(t);
    }, [id]);

    const tone = TONE[kind] ?? TONE.error;
    const Icon = TOAST_ICON[kind] ?? TOAST_ICON.error;
    return (
      <div
        className="toast-rise titlebar-no-drag mb-2 rounded-md r-popover shadow-xl bg-[var(--c-zone)] w-full pointer-events-auto overflow-hidden"
        style={TOAST_STYLE}
        data-toast-kind={kind}
        role={kind === 'error' ? 'alert' : 'status'}
      >
        <div
          className={
            'flex items-center justify-between gap-3 pl-4 pr-2 py-3 ' + tone.layer
          }
        >
          {/* 아이콘은 첫 줄 높이(24px) 상자 안 가운데 — 여러 줄이어도 첫 줄 옆에 붙는다 */}
          <div className="flex-1 min-w-0 flex items-start gap-2">
            <span className="flex-none h-6 flex items-center" data-toast-icon={kind} aria-hidden>
              <Icon size={15} />
            </span>
            <div className="flex-1 min-w-0 break-words">{text}</div>
          </div>
          <button
            className={
              'flex-none p-2 rounded-md transition-colors ' + tone.close
            }
            aria-label="닫기"
            onClick={() => appState.removeMessage(id)}
          >
            <FaTimes size={16} />
          </button>
        </div>
      </div>
    );
  },
);

const AlertWindow = observer(() => {
  const { messages } = appState;
  return (
    <div className="fixed flex justify-center w-full alert-window pointer-events-none">
      <div className="w-3/4 max-w-2xl m-4 flex flex-col">
        {messages.map((m) => (
          <Toast key={m.id} id={m.id} text={m.text} kind={m.kind} />
        ))}
      </div>
    </div>
  );
});

export default AlertWindow;
