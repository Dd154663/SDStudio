import { useBackLayer } from '../models/BackStackService';

export interface ProgressDialog {
  text: string;
  done: number;
  total: number;
  // 내보내기 완료 표시(우하단 위젯을 "완료"로 전환). 진행 중에는 미설정.
  completed?: boolean;
  // 설정 시 [취소] 버튼 노출 — 호출부가 취소 플래그를 세우고 진행분을 마무리한다.
  // 취소 접수 후에는 onCancel 없이 다이얼로그를 갱신해 버튼을 숨길 것.
  onCancel?: () => void;
  // 막대 안 숫자 대신 보일 문구(예: 「42% · 1.2 GB / 3 GB」). 미설정이면 done/total.
  countText?: string;
}

interface Props {
  dialog: ProgressDialog;
}

const NOOP = () => {};

const ProgressWindow = ({ dialog }: Props) => {
  // 진행 중에는 Esc·Android 뒤로 가기를 삼키기만 한다 — 아래 창이 대신 닫히거나 앱이 최소화되지 않게
  // (닫기 관문, 2026-10-03 U1·X2·X6). 취소는 [취소] 버튼으로만. 확인 창 층이라 선점.
  useBackLayer(true, NOOP, { escape: 'consume', back: 'consume', preempt: true });
  return (
    <div className="fixed flex justify-center w-full confirm-window">
      <div className="flex flex-col justify-between m-4 p-4 rounded-md r-modal shadow-xl bg-[var(--c-zone)] text-default w-96 max-w-[90vw]">
        <div className="break-keep text-center text-default">{dialog.text}</div>
        <div className="relative w-full h-8 bg-gray-500 dark:bg-slate-700 mt-4 flex justify-center text-white font-medium bg-clip-border">
          <div className="z-10">
            {dialog.countText ?? `${dialog.done}/${dialog.total}`}
          </div>
          <div
            className="absolute top-0 left-0 h-8 bg-sky-500 dark:bg-indigo-400"
            style={{
              width: ((dialog.done / dialog.total) * 100).toString() + '%',
            }}
          ></div>
        </div>
        {dialog.onCancel && (
          <button
            className="mt-3 self-center px-4 py-1.5 text-sm rounded btn back-red"
            onClick={dialog.onCancel}
          >
            {/* 진행 중인 작업 중단 — 창 닫기(취소)와 구분해 「중단」(2026-10-03 D3) */}
            중단
          </button>
        )}
      </div>
    </div>
  );
};

export default ProgressWindow;
