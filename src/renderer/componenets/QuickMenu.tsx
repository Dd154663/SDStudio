// QuickMenu — 퀵 메뉴: 전역 액션(globalActions) 플로팅 진입 버튼 + 오버레이 (트랙2 ① P3)
//
// 진입점(D2 결정) = 우하단 플로팅 버튼(양 플랫폼) + PC 단축키(기본 Ctrl+K, 키 바인딩
// 탭에서 변경 가능 — App.tsx 'quick-menu' 케이스가 토글). 구성은 config.quickMenu
// (환경설정 → 툴바에서 편집), 미설정이면 추천 기본(DEFAULT_QUICK_MENU).
// PC = 버튼 위 팝오버 카드 / 모바일 = ModalOverlay 시트(그리드).
import { observer } from 'mobx-react-lite';
import {
  CSSProperties,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  FaBolt,
  FaBroom,
  FaExchangeAlt,
  FaFileExport,
  FaFileImage,
  FaFolderMinus,
  FaPaintBrush,
  FaPlus,
  FaPuzzlePiece,
  FaQuestion,
  FaShare,
  FaThLarge,
  FaTrash,
  FaTrashRestore,
  FaUsers,
  FaWindowRestore,
} from 'react-icons/fa';
import { appState } from '../models/AppService';
import { isMobile } from '../models';
import {
  GlobalAction,
  globalActionMeta,
  resolveQuickMenu,
} from '../models/globalActions';
import ModalOverlay from './ModalOverlay';
import Tooltip from './Tooltip';

// id → 아이콘 (툴바 공유 JSX 와 같은 아이콘 정체성 유지 — 라벨은 uiLayout name 단일 출처)
const ACTION_ICONS: Record<string, ReactNode> = {
  'piece-editor': <FaPuzzlePiece size={18} />,
  'find-replace': <FaExchangeAlt size={18} />,
  'backup-export': <FaShare size={18} />,
  'empty-image-trash': <FaBroom size={18} />,
  'quick-export': <span className="text-base leading-none">⚡</span>,
  'export-images': <FaFileExport size={18} />,
  'scene-template': <FaThLarge size={18} />,
  'import-image': <FaFileImage size={18} />,
  'shortcut-help': <FaQuestion size={18} />,
  'project-browser': <FaThLarge size={18} />,
  'character-presets': <FaUsers size={18} />,
  'project-trash': <FaTrashRestore size={18} />,
  'add-session': <FaPlus size={18} />,
  'delete-session': <FaFolderMinus size={18} />,
  'artist-tag': <FaPaintBrush size={18} />,
  'scene-trash': <FaTrash size={18} />,
  'new-window': <FaWindowRestore size={18} />,
};

const EMPTY_GUIDE = '퀵 메뉴가 비어 있습니다 — 환경설정 → 툴바에서 구성하세요';

// 플로팅 버튼 위치 기억(기기 개인화 — 키 바인딩과 같은 localStorage 저장).
// 저장 형식 = 버튼 중심의 뷰포트 비율 {xr, yr} (0~1) — 창 크기 변화에도 상대 위치 유지.
const POS_KEY = 'sdstudio-quick-menu-pos';
const FAB_SIZE = 44; // w-11/h-11
const loadFabPos = (): { xr: number; yr: number } | null => {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.xr === 'number' && typeof p?.yr === 'number') return p;
  } catch {}
  return null;
};
const clamp01m = (v: number, margin: number) =>
  Math.min(1 - margin, Math.max(margin, v));

export const QuickMenu = observer(() => {
  const open = appState.quickMenuOpen;
  const close = () => {
    appState.quickMenuOpen = false;
  };

  // PC 팝오버 Escape 닫기(모바일은 ModalOverlay 가 자체 처리)
  useEffect(() => {
    if (isMobile || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // 전체화면 오버레이(뷰어·환경설정 등 FloatView)·편집 모드 중에는 진입 버튼 숨김
  // (버튼 z 가 FloatView 보다 높아 떠 보이는 부자연 방지). 열림 상태는 유지.
  const fabHidden =
    appState.floatViewCount > 0 || appState.configScreenOpen || appState.editMode;

  const actions = resolveQuickMenu(appState.quickMenu, isMobile);

  const runAction = (a: GlobalAction) => {
    close();
    a.run();
  };

  const itemRow = (a: GlobalAction) => {
    const meta = globalActionMeta(a.id);
    const enabled = a.available ? a.available() : true;
    return { name: meta?.name ?? a.id, enabled };
  };

  // ── 플로팅 버튼: 롱 프레스 드래그 이동(위치 기억) ──
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [fabPos, setFabPos] = useState<{ xr: number; yr: number } | null>(
    loadFabPos,
  );
  const [dragging, setDragging] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const draggedRef = useRef(false); // 드래그 직후 click 억제

  const posFromEvent = (e: { clientX: number; clientY: number }) => ({
    xr: clamp01m(e.clientX / window.innerWidth, FAB_SIZE / 2 / window.innerWidth),
    yr: clamp01m(e.clientY / window.innerHeight, FAB_SIZE / 2 / window.innerHeight),
  });
  const onFabPointerDown = (e: React.PointerEvent) => {
    draggedRef.current = false;
    const el = e.currentTarget as HTMLButtonElement;
    const pointerId = e.pointerId;
    pressTimer.current = setTimeout(() => {
      setDragging(true);
      try {
        el.setPointerCapture(pointerId);
      } catch {}
    }, 400);
  };
  const onFabPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    draggedRef.current = true;
    setFabPos(posFromEvent(e));
  };
  const endFabPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = undefined;
    if (dragging) {
      setDragging(false);
      if (fabPos) {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(fabPos));
        } catch {}
      }
    }
  };
  const fabStyle: CSSProperties = fabPos
    ? {
        left: `calc(${(fabPos.xr * 100).toFixed(2)}% - ${FAB_SIZE / 2}px)`,
        top: `calc(${(fabPos.yr * 100).toFixed(2)}% - ${FAB_SIZE / 2}px)`,
      }
    : {};

  // PC 팝오버 열림 방향 적응: 버튼이 화면 하단이면 위로, 상단이면 아래로,
  // 우측이면 오른쪽 정렬, 좌측이면 왼쪽 정렬. (모바일은 ModalOverlay 시트라 무관)
  const panelStyle = (): CSSProperties => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return { right: '1rem', bottom: '7rem' };
    const s: CSSProperties = {};
    const openUp = rect.top + rect.height / 2 > window.innerHeight / 2;
    const alignRight = rect.left + rect.width / 2 > window.innerWidth / 2;
    if (openUp) s.bottom = window.innerHeight - rect.top + 8;
    else s.top = rect.bottom + 8;
    if (alignRight) s.right = Math.max(8, window.innerWidth - rect.right);
    else s.left = Math.max(8, rect.left);
    return s;
  };

  return (
    <>
      {!fabHidden && (
        <Tooltip content={isMobile ? '퀵 메뉴' : '퀵 메뉴 (Ctrl+K) — 길게 눌러 이동'}>
          <button
            ref={btnRef}
            className={
              // 노란 반투명(존재감) — btn 의 brightness hover·포커스 링 사용.
              'btn fixed z-[var(--z-widget)] w-11 h-11 rounded-full shadow-lg select-none ' +
              'flex items-center justify-center border border-amber-500/70 ' +
              'bg-amber-400/75 text-amber-950 ' +
              (dragging ? 'scale-110 cursor-grabbing ' : '') +
              // 기본 위치(저장 위치 없을 때): 하단바·생성 위젯과 겹치지 않게 위로.
              (fabPos ? '' : isMobile ? 'right-3 bottom-28' : 'right-4 bottom-24')
            }
            style={{ ...fabStyle, touchAction: 'none' }}
            onPointerDown={onFabPointerDown}
            onPointerMove={onFabPointerMove}
            onPointerUp={endFabPress}
            onPointerCancel={endFabPress}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => {
              if (draggedRef.current) {
                // 드래그로 끝난 프레스 — 클릭(토글)으로 취급하지 않음
                draggedRef.current = false;
                return;
              }
              appState.quickMenuOpen = !appState.quickMenuOpen;
            }}
          >
            <FaBolt size={16} />
          </button>
        </Tooltip>
      )}
      {isMobile ? (
        <ModalOverlay isOpen={open} onClose={close} title="⚡ 퀵 메뉴">
          {actions.length === 0 ? (
            <div className="text-sm text-muted p-4 text-center">{EMPTY_GUIDE}</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 p-1">
              {actions.map((a) => {
                const { name, enabled } = itemRow(a);
                return (
                  <button
                    key={a.id}
                    className="btn rounded-lg border line-color bg-[var(--c-input-bg)] flex flex-col items-center gap-1.5 py-3 px-1 text-default"
                    disabled={!enabled}
                    onClick={() => runAction(a)}
                  >
                    {ACTION_ICONS[a.id] ?? <FaBolt size={18} />}
                    <span className="text-xs text-center leading-tight">{name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </ModalOverlay>
      ) : (
        open && (
          <>
            {/* 투명 백드롭 — 바깥 클릭 닫기 */}
            <div
              className="fixed inset-0 z-[var(--z-widget)]"
              onClick={close}
            />
            <div
              className="fixed z-[var(--z-widget)] w-64 max-h-[60vh] overflow-y-auto rounded-lg border line-color bg-[var(--c-surface-2)] shadow-xl p-1.5"
              style={panelStyle()}
            >
              {actions.length === 0 ? (
                <div className="text-sm text-muted p-3 text-center">
                  {EMPTY_GUIDE}
                </div>
              ) : (
                actions.map((a) => {
                  const { name, enabled } = itemRow(a);
                  return (
                    <button
                      key={a.id}
                      className="btn-ghost w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-default text-left"
                      disabled={!enabled}
                      onClick={() => runAction(a)}
                    >
                      <span className="flex-none w-5 flex justify-center">
                        {ACTION_ICONS[a.id] ?? <FaBolt size={18} />}
                      </span>
                      <span className="flex-1 truncate">{name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )
      )}
    </>
  );
});
