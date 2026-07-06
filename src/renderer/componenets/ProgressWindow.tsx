import { useContext, useEffect, useState } from 'react';
import { DropdownSelect } from './UtilComponents';

export interface ProgressDialog {
  text: string;
  done: number;
  total: number;
  // 내보내기 완료 표시(우하단 위젯을 "완료"로 전환). 진행 중에는 미설정.
  completed?: boolean;
}

interface Props {
  dialog: ProgressDialog;
}

const ProgressWindow = ({ dialog }: Props) => {
  return (
    <div className="fixed flex justify-center w-full confirm-window">
      <div className="flex flex-col justify-between m-4 p-4 rounded-md shadow-xl bg-[var(--c-zone)] text-default w-96 max-w-[90vw]">
        <div className="break-keep text-center text-default">{dialog.text}</div>
        <div className="relative w-full h-8 bg-gray-500 dark:bg-slate-700 mt-4 flex justify-center text-white font-medium bg-clip-border">
          <div className="z-10">
            {dialog.done}/{dialog.total}
          </div>
          <div
            className="absolute top-0 left-0 h-8 bg-sky-500 dark:bg-indigo-400"
            style={{
              width: ((dialog.done / dialog.total) * 100).toString() + '%',
            }}
          ></div>
        </div>
      </div>
    </div>
  );
};

export default ProgressWindow;
