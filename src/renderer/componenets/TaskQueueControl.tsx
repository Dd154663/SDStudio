import SceneQueueMenu from './SceneQueueMenu';
import { useContext, useEffect, useRef, useState } from 'react';
import { FaSpinner } from 'react-icons/fa';
import { FaPlay, FaRegCalendarPlus, FaRegCalendarTimes, FaStop } from 'react-icons/fa';
import { FaTimes } from 'react-icons/fa';
import { FaRegClock } from 'react-icons/fa';
import { taskQueueService, cyclingSessionService } from '../models';
import { Task } from '../models/TaskQueueService';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { addScenesToQueue } from '../models/sceneQueueActions';

interface ProgressBarProps {
  duration: number;
  isError: boolean;
  text: string;
  key: number;
  // 이미 흘러간 시간(초) — 음수 animation-delay 로 애니메이션을 중간부터 이어
  // 그린다. 컨트롤이 도크↔플로팅 이동으로 재마운트될 때 0부터 다시 차오르는
  // 문제 방지(경과 초과 시에는 fill-mode:forwards 라 꽉 찬 상태로 유지).
  elapsed?: number;
}

const ProgressBar = ({ duration, isError, text, key, elapsed }: ProgressBarProps) => {
  const animStyle = {
    animationDuration: `${duration}s`,
    animationDelay: `-${elapsed ?? 0}s`,
  };
  return (
    <div
      key={key}
      className="relative w-40 lg:w-52 bg-gray-200 dark:bg-slate-700 rounded-full h-8"
    >
      {/* tabular-nums: 남은 개수·예상 시간 숫자가 바뀌어도 폭이 출렁이지 않게 */}
      <div className="top-0 left-0 w-40 lg:w-52 h-8 absolute flex items-center justify-center text-gray-600 dark:text-white gap-2">
        <FaRegClock size={20} />
        <div className="w-28 lg:w-40 text-xs lg:text-sm text-center overflow-hidden text-nowrap tabular-nums">
          {text}
        </div>
      </div>
      <div
        className={
          'top-0 left-0 absolute w-40 lg:w-52 progress-transition rounded-full h-8 progress-clip-animation ' +
          (!isError ? 'bg-sky-500 dark:bg-indigo-400' : 'bg-red-500')
        }
        style={animStyle}
      ></div>
      <div
        className="top-0 left-0 w-40 lg:w-52 h-8 absolute flex items-center justify-center text-white gap-2 progress-clip-animation"
        style={animStyle}
      >
        <FaRegClock size={20} />
        <div className="w-28 lg:w-40 text-xs lg:text-sm text-center overflow-hidden text-nowrap tabular-nums">
          {text}
        </div>
      </div>
    </div>
  );
};

interface TaskProgressBarProps {
  fast?: boolean;
}
export const TaskProgressBar = ({ fast }: TaskProgressBarProps) => {
  const key = useRef<number>(0);
  // 마운트 시점에 이미 실행 중이면(도크↔플로팅 재마운트 등) 진행 중이던 사이클을
  // 이어받는다: 길이는 현재 태스크 예상치, 경과는 서비스의 사이클 시작 시각 기준.
  // (새 사이클이 시작되면 onStart/onComplete 가 elapsed 를 0 으로 되돌린다.)
  const [duration, setDuration] = useState(() =>
    taskQueueService.isRunning()
      ? taskQueueService.estimateTopTaskTime('mean') / 1000
      : 0,
  );
  const [elapsed, setElapsed] = useState(() =>
    taskQueueService.isRunning() && taskQueueService.progressCycleStartedAt > 0
      ? Math.max(
          0,
          (Date.now() - taskQueueService.progressCycleStartedAt) / 1000,
        )
      : 0,
  );
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string>('');
  const [_, rerender] = useState<{}>({});
  const formatTime = (ms: number) => {
    const seconds = ms / 1000;
    const minutes = seconds / 60;
    const hours = minutes / 60;

    if (seconds < 60) {
      return `${Math.round(seconds)}초`;
    } else if (minutes < 60) {
      return `${Math.round(minutes)}분`;
    } else {
      return `${Math.round(hours)}시간`;
    }
  };
  const getProgressText = () => {
    const stats = taskQueueService.statsAllTasks();
    // 표시 방어: 통계가 일시적으로 어긋나도 음수("-1개 남음")는 보여주지 않는다.
    const remain = Math.max(0, stats.total - stats.done);
    const ms = taskQueueService.estimateTime('mean');
    const timeEstimate = formatTime(ms);
    return `${remain}개 남음 (예상 ${timeEstimate})`;
  };

  useEffect(() => {
    const nextKey = () => {
      key.current = key.current + 1;
      rerender({});
    };
    const onChange = () => {
      if (!taskQueueService.isRunning()) {
        nextKey();
        setDuration(0);
        setElapsed(0);
        setIsError(false);
        setError('');
      }
      rerender({});
    };
    const onComplete = () => {
      nextKey();
      setIsError(false);
      setError('');
      setElapsed(0); // 새 사이클 — 처음부터 차오름
      setDuration(taskQueueService.estimateTopTaskTime('mean') / 1000);
      if (!taskQueueService.isRunning()) {
        setDuration(0);
      }
    };
    const onStart = () => {
      nextKey();
      setIsError(false);
      setError('');
      setElapsed(0); // 새 사이클 — 처음부터 차오름
      setDuration(taskQueueService.estimateTopTaskTime('mean') / 1000);
      if (!taskQueueService.isRunning()) {
        setDuration(0);
      }
    };
    const onError = (e: any) => {
      if (e.detail.task.type === 'remove-bg') {
        appState.pushMessage('Error: ' + e.detail.error);
      }
      setError(e.detail.error);
      setIsError(true);
    };
    taskQueueService.addEventListener('start', onStart);
    taskQueueService.addEventListener('stop', onChange);
    taskQueueService.addEventListener('progress', onChange);
    taskQueueService.addEventListener('complete', onComplete);
    taskQueueService.addEventListener('error', onError);
    return () => {
      taskQueueService.removeEventListener('start', onStart);
      taskQueueService.removeEventListener('stop', onChange);
      taskQueueService.removeEventListener('progress', onChange);
      taskQueueService.removeEventListener('complete', onComplete);
      taskQueueService.removeEventListener('error', onError);
    };
  }, []);

  return (
    <div
      onClick={() => {
        if (error !== '') {
          appState.pushMessage('Error: ' + error);
        }
      }}
    >
      <ProgressBar
        key={key.current}
        isError={isError}
        duration={duration}
        elapsed={elapsed}
        text={getProgressText()}
      />
    </div>
  );
};

const TaskQueueList = ({
  onClose,
  dropDown,
}: {
  onClose?: () => void;
  // 컨트롤이 화면 상단에 있을 때(플로팅 위젯) 목록을 아래로 펼침 — 기본은 기존처럼 위로
  dropDown?: boolean;
}) => {
  const [tasks, setTasks] = useState<any[]>([]);
  useEffect(() => {
    const onChange = () => {
      setTasks([...taskQueueService.queue]);
    };
    taskQueueService.addEventListener('start', onChange);
    taskQueueService.addEventListener('stop', onChange);
    taskQueueService.addEventListener('progress', onChange);
    taskQueueService.addEventListener('complete', onChange);
    taskQueueService.addEventListener('error', onChange);
    onChange();
    return () => {
      taskQueueService.removeEventListener('start', onChange);
      taskQueueService.removeEventListener('stop', onChange);
      taskQueueService.removeEventListener('progress', onChange);
      taskQueueService.removeEventListener('complete', onChange);
      taskQueueService.removeEventListener('error', onChange);
    };
  }, []);

  const getEmoji = (task: Task) => {
    return taskQueueService.getTaskInfo(task).emoji;
  };

  const getTaskText = (task: Task) => {
    return taskQueueService.getTaskInfo(task).name;
  };

  return (
    <div
      className={
        'absolute ' +
        (dropDown ? 'top-full mt-2 ' : 'bottom-0 mb-14 md:mb-20 ') +
        'bg-white dark:bg-slate-700 w-60 md:w-96 z-[var(--z-widget)] shadow-lg prog-list flex flex-col overflow-hidden'
      }
    >
      <button
        className="ml-auto mt-2 mr-2 text-muted hover:text-gray-700 flex-none"
        onClick={() => {
          onClose?.();
        }}
      >
        <FaTimes size={20} />
      </button>
      <div className="flex-1 overflow-hidden pb-2">
        <div className="h-full overflow-auto">
          {tasks.map((task, i) => (
            <div
              key={i}
              className="flex mt-2 items-center gap-2 p-2 line-color border mx-2 rounded-lg"
            >
              <div className="flex-none ">{getEmoji(task)}</div>
              <div className="flex-1 truncate text-default">
                {getTaskText(task)}
              </div>
              <div className="flex-none ml-auto p-2 bg-gray-300 dark:bg-slate-500 dark:text-white rounded-lg font-medium text-sm text-gray-500">
                {task!.done}/{task!.total}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const TaskQueueControl = observer(({}) => {
  const [_, rerender] = useState<{}>({});
  const [showList, setShowList] = useState(false);
  // 목록 펼침 방향: 컨트롤(플로팅 위젯 포함)이 화면 위쪽 절반이면 아래로 펼친다
  const [listDropDown, setListDropDown] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onChange = () => {
      rerender({});
    };
    taskQueueService.addEventListener('start', onChange);
    taskQueueService.addEventListener('stop', onChange);
    taskQueueService.addEventListener('progress', onChange);
    taskQueueService.addEventListener('complete', onChange);
    taskQueueService.addEventListener('error', onChange);
    return () => {
      taskQueueService.removeEventListener('start', onChange);
      taskQueueService.removeEventListener('stop', onChange);
      taskQueueService.removeEventListener('progress', onChange);
      taskQueueService.removeEventListener('complete', onChange);
      taskQueueService.removeEventListener('error', onChange);
    };
  }, []);

  const cyclingActive = cyclingSessionService.state === 'running' || cyclingSessionService.state === 'paused';

  return (
    <div ref={rootRef} className="flex gap-0.5 md:gap-2 lg:gap-4 items-center">
      {showList && (
        <TaskQueueList
          dropDown={listDropDown}
          onClose={() => {
            setShowList(false);
          }}
        />
      )}
      {cyclingActive && (
        <div className="hidden md:flex items-center gap-1 px-2 py-1 bg-sky-100 dark:bg-sky-900/30 rounded-lg text-xs whitespace-nowrap">
          <span className="text-sky-600 dark:text-sky-400">🔄</span>
          <span className="text-sky-700 dark:text-sky-300">
            순차 ({cyclingSessionService.completedPresets + 1}/{cyclingSessionService.totalPresets})
          </span>
        </div>
      )}
      <div className="whitespace-nowrap">
        <span className="sr-only md:not-sr-only whitespace-nowrap text-default">개수:</span>
        <input
          aria-label="생성 개수"
          min={1}
          max={99}
          className={'ml-1 md:ml-2 p-1 w-10 md:w-16 text-center gray-input'}
          type="number"
          value={appState.samples}
          onChange={(e: any) => {
            // parseInt 는 비숫자에서 NaN 을 반환하고 ??/Math.min 은 NaN 을 거르지
            // 못한다 — NaN 이 samples 에 들어가면 큐 통계가 영구 오염된다.
            const num = parseInt(e.currentTarget.value, 10);
            appState.samples = Number.isFinite(num)
              ? Math.max(1, Math.min(99, num))
              : 1;
          }}
        />
      </div>
      <div
        className="relative cursor-pointer hover:brightness-95 active:brightness-90"
        onClick={() => {
          if (!showList) {
            const r = rootRef.current?.getBoundingClientRect();
            setListDropDown(!!r && r.top < window.innerHeight / 2);
          }
          setShowList(!showList);
        }}
      >
        <TaskProgressBar />
      </div>
      <SceneQueueMenu session={appState.curSession} type="scene" selectedOnly={appState.selectedScenes.size > 0}>
      <button
        type="button"
        className="round-button back-sky px-2 h-8 lg:px-6 disabled:opacity-50"
        title="씬 일괄 예약 (선택한 씬이 있으면 선택 씬만)"
        aria-label="씬 일괄 예약"
        disabled={!appState.curSession}
        onClick={() => {
          if (appState.curSession) {
            void addScenesToQueue(
              appState.curSession,
              'scene',
              appState.selectedScenes.size > 0,
            );
          }
        }}
      >
        <FaRegCalendarPlus size={18} />
      </button>
      </SceneQueueMenu>
      <button
        className={`round-button back-gray px-2 h-8 lg:px-6`}
        onClick={() => {
          taskQueueService.removeAllTasks();
        }}
      >
        <FaRegCalendarTimes size={18} />
      </button>
      {!taskQueueService.isRunning() ? (
        <button
          className={`round-button back-green px-2 h-8 lg:px-6`}
          onClick={() => {
            (async () => {
              const costs = taskQueueService.calculateCost();
              const message = costs
                .map((x) => `${x.text} (씬: ${x.scene})`)
                .slice(0, 10)
                .join('\n');
              if (costs.length > 0) {
                appState.pushDialog({
                  type: 'confirm',
                  text:
                    'Anals를 소모하는 유료 세팅입니다. 계속합니까?' +
                    '\n' +
                    message,
                  callback: () => {
                    taskQueueService.run();
                  },
                });
              } else {
                taskQueueService.run();
              }
            })();
          }}
        >
          <FaPlay size={15} />
        </button>
      ) : (
        <button
          className={`round-button back-red px-2 h-8 lg:px-6`}
          onClick={() => {
            taskQueueService.stop();
          }}
        >
          <FaStop size={15} />
        </button>
      )}
    </div>
  );
});

export default TaskQueueControl;
