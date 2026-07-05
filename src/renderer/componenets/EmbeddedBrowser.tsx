import React, { useRef, useState, useEffect, useCallback } from 'react';
import { FaArrowLeft, FaArrowRight, FaRedo, FaStar, FaPlus, FaTimes, FaPen, FaTrash } from 'react-icons/fa';

interface Bookmark {
  id: string;
  label: string;
  url: string;
}

const BOOKMARKS_KEY = 'sdstudio-browser-bookmarks';

const DEFAULT_BOOKMARKS: Bookmark[] = [
  { id: 'default-1', label: 'Danbooru', url: 'https://hijiribe.donmai.us/' },
  { id: 'default-2', label: 'Danbooru 태그 검색', url: 'https://hijiribe.donmai.us/tags' },
  { id: 'default-3', label: 'Danbooru 위키', url: 'https://hijiribe.donmai.us/wiki_pages/help:home' },
];

function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [...DEFAULT_BOOKMARKS];
}

function saveBookmarks(bookmarks: Bookmark[]) {
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
}

function generateId() {
  return 'bm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

// Electron 기본 UA에는 "Electron/..."·앱이름 토큰이 박혀 있어 Cloudflare 봇 차단이
// 인증 챌린지를 무한 리다이렉트시킨다. 이 토큰들을 제거한 정상 Chrome UA를 쓴다.
const CLEAN_USER_AGENT = (() => {
  const fallback =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';
  try {
    const ua = navigator.userAgent
      .replace(/\s*Electron\/[^\s]+/i, '')
      .replace(/\s*sdstudio\/[^\s]+/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return ua && /Chrome\//.test(ua) ? ua : fallback;
  } catch {
    return fallback;
  }
})();

// 짧은 시간에 과도한 네비게이션 = Cloudflare 챌린지 루프로 간주
const LOOP_WINDOW_MS = 2000;
const LOOP_THRESHOLD = 5;

interface BookmarkDialogProps {
  mode: 'add' | 'edit';
  initialLabel: string;
  initialUrl: string;
  onConfirm: (label: string, url: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const BookmarkDialog: React.FC<BookmarkDialogProps> = ({ mode, initialLabel, initialUrl, onConfirm, onDelete, onClose }) => {
  const [label, setLabel] = useState(initialLabel);
  const [url, setUrl] = useState(initialUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-[var(--c-zone)] rounded-lg p-4 w-80 flex flex-col gap-3 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-default">
          {mode === 'add' ? '즐겨찾기 추가' : '즐겨찾기 편집'}
        </h3>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">이름</label>
          <input
            className="border rounded px-2 py-1 text-sm bg-[var(--c-input-bg)] line-color text-[var(--c-input-text)]"
            placeholder="표시할 이름"
            value={label}
            onChange={e => setLabel(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">URL</label>
          <input
            className="border rounded px-2 py-1 text-sm bg-[var(--c-input-bg)] line-color text-[var(--c-input-text)]"
            placeholder="https://..."
            value={url}
            onChange={e => setUrl(e.target.value)}
          />
        </div>
        <div className="flex gap-2 justify-end items-center">
          {mode === 'edit' && onDelete && (
            <button
              className="px-3 py-1 text-sm rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 mr-auto flex items-center gap-1"
              onClick={onDelete}
            >
              <FaTrash size={10} />
              삭제
            </button>
          )}
          <button className="px-3 py-1 text-sm back-llgray rounded" onClick={onClose}>취소</button>
          <button
            className="px-3 py-1 text-sm back-sky rounded"
            onClick={() => { if (label.trim() && url.trim()) onConfirm(label.trim(), url.trim()); }}
          >
            {mode === 'add' ? '추가' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
};

// webview 태그 타입은 @types/react 내장(WebViewHTMLAttributes)을 사용한다.
// 단 allowpopups 는 boolean 으로 선언돼 있지만 React 런타임은 unknown 속성에
// boolean true 를 주면 attribute 를 아예 렌더하지 않으므로, Electron 이 인식하는
// 빈 문자열 attribute 형태를 유지하기 위해 아래 캐스트를 공용으로 쓴다.
export const WEBVIEW_ALLOWPOPUPS = { allowpopups: '' } as unknown as { allowpopups?: boolean };

const DesktopBrowser: React.FC = () => {
  const webviewRef = useRef<any>(null);
  const [url, setUrl] = useState('about:blank');
  const [inputUrl, setInputUrl] = useState('about:blank');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks);
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; bookmark?: Bookmark } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; bookmark: Bookmark } | null>(null);
  const [loopBlocked, setLoopBlocked] = useState(false);
  const navTimesRef = useRef<number[]>([]);

  const updateNavState = useCallback(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    try {
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
    } catch {}
  }, []);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onNavigate = (e: any) => {
      setUrl(e.url);
      setInputUrl(e.url);
      updateNavState();
      // Cloudflare 챌린지 무한 루프 감지: 3초 내 과도한 네비게이션이면 로딩 중단 + 안내
      const now = Date.now();
      const times = navTimesRef.current.filter((t) => now - t < LOOP_WINDOW_MS);
      times.push(now);
      navTimesRef.current = times;
      if (times.length >= LOOP_THRESHOLD) {
        navTimesRef.current = [];
        try {
          wv.stop();
        } catch {}
        setLoading(false);
        setLoopBlocked(true);
      }
    };

    const onStartLoading = () => setLoading(true);
    const onStopLoading = () => {
      setLoading(false);
      updateNavState();
    };

    const onNewWindow = (e: any) => {
      if (e.url) {
        wv.loadURL(e.url);
      }
    };

    const onFailLoad = (e: any) => {
      if (e.errorCode === -3) return;
      const now = Date.now();
      const times = navTimesRef.current.filter((t) => now - t < LOOP_WINDOW_MS);
      times.push(now);
      navTimesRef.current = times;
      if (times.length >= LOOP_THRESHOLD) {
        navTimesRef.current = [];
        try { wv.stop(); } catch {}
        setLoading(false);
        setLoopBlocked(true);
      }
    };

    wv.addEventListener('did-navigate', onNavigate);
    wv.addEventListener('did-navigate-in-page', onNavigate);
    wv.addEventListener('did-start-loading', onStartLoading);
    wv.addEventListener('did-stop-loading', onStopLoading);
    wv.addEventListener('new-window', onNewWindow);
    wv.addEventListener('did-fail-load', onFailLoad);

    return () => {
      wv.removeEventListener('did-navigate', onNavigate);
      wv.removeEventListener('did-navigate-in-page', onNavigate);
      wv.removeEventListener('did-start-loading', onStartLoading);
      wv.removeEventListener('did-stop-loading', onStopLoading);
      wv.removeEventListener('new-window', onNewWindow);
      wv.removeEventListener('did-fail-load', onFailLoad);
    };
  }, [updateNavState]);

  // 외부(텍스트 드래그 → Danbooru로 검색)에서 navigate 요청 수신
  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent).detail?.url;
      if (url) navigate(url);
    };
    window.addEventListener('danbooru-navigate', handler);
    return () => window.removeEventListener('danbooru-navigate', handler);
  }, []);

  // 컨텍스트 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  const navigate = (targetUrl: string) => {
    let finalUrl = targetUrl.trim();
    if (!finalUrl) return;
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }
    const wv = webviewRef.current;
    if (wv) {
      navTimesRef.current = [];
      setLoopBlocked(false);
      wv.loadURL(finalUrl);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      navigate(inputUrl);
    }
  };

  const updateBookmarks = (updated: Bookmark[]) => {
    setBookmarks(updated);
    saveBookmarks(updated);
  };

  const handleAddBookmark = (label: string, bmUrl: string) => {
    updateBookmarks([...bookmarks, { id: generateId(), label, url: bmUrl }]);
    setDialog(null);
  };

  const handleEditBookmark = (id: string, label: string, bmUrl: string) => {
    updateBookmarks(bookmarks.map(b => b.id === id ? { ...b, label, url: bmUrl } : b));
    setDialog(null);
  };

  const handleDeleteBookmark = (id: string) => {
    updateBookmarks(bookmarks.filter(b => b.id !== id));
    setDialog(null);
    setContextMenu(null);
  };

  const handleBookmarkContextMenu = (e: React.MouseEvent, bm: Bookmark) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, bookmark: bm });
  };

  return (
    <div className="h-full flex flex-col">
      {/* 즐겨찾기 바 */}
      <div className="flex-none flex items-center gap-1 px-2 py-1 border-b line-color overflow-x-auto">
        <FaStar className="text-yellow-500 flex-none" size={14} />
        {bookmarks.map(bm => (
          <button
            key={bm.id}
            className="flex-none text-xs px-2 py-1 rounded btn-ghost whitespace-nowrap max-w-[120px] truncate text-gray-700 dark:text-gray-300"
            onClick={() => navigate(bm.url)}
            onContextMenu={(e) => handleBookmarkContextMenu(e, bm)}
            title={bm.url}
          >
            {bm.label}
          </button>
        ))}
        <button
          className="flex-none text-xs px-2 py-1 rounded btn-ghost text-muted"
          onClick={() => setDialog({ mode: 'add' })}
          title="즐겨찾기 추가"
        >
          <FaPlus size={10} />
        </button>
      </div>

      {/* 네비게이션 바 */}
      <div className="flex-none flex items-center gap-1 px-2 py-1 border-b line-color">
        <button
          className="p-1.5 rounded btn-ghost disabled:opacity-30 text-gray-700 dark:text-gray-300"
          disabled={!canGoBack}
          onClick={() => webviewRef.current?.goBack()}
        >
          <FaArrowLeft size={12} />
        </button>
        <button
          className="p-1.5 rounded btn-ghost disabled:opacity-30 text-gray-700 dark:text-gray-300"
          disabled={!canGoForward}
          onClick={() => webviewRef.current?.goForward()}
        >
          <FaArrowRight size={12} />
        </button>
        <button
          className="p-1.5 rounded btn-ghost text-gray-700 dark:text-gray-300"
          onClick={() => loading ? webviewRef.current?.stop() : webviewRef.current?.reload()}
        >
          <FaRedo size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        <input
          className="flex-1 text-sm px-2 py-1 border rounded bg-[var(--c-input-bg)] line-color text-[var(--c-input-text)]"
          value={inputUrl}
          onChange={e => setInputUrl(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="px-2 py-1 text-xs back-sky rounded"
          onClick={() => navigate(inputUrl)}
        >
          이동
        </button>
      </div>

      {/* webview */}
      <div className="flex-1 relative">
        <webview
          ref={webviewRef}
          src={url}
          partition="persist:browser"
          {...WEBVIEW_ALLOWPOPUPS}
          useragent={CLEAN_USER_AGENT}
          style={{ width: '100%', height: '100%' }}
        />
        {/* Cloudflare 인증 루프 감지 시 안내 배너 */}
        {loopBlocked && (
          <div className="absolute top-0 left-0 right-0 z-10 m-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 shadow-lg flex items-start gap-3">
            <div className="flex-1 text-sm text-amber-800 dark:text-amber-200 leading-snug">
              인증(Cloudflare) 페이지가 반복 새로고침되어 로딩을 멈췄습니다.
              잠시 후 다시 시도하거나, 다른 주소로 이동해 보세요.
            </div>
            <button
              className="flex-none px-3 py-1.5 text-sm back-sky rounded"
              onClick={() => {
                navTimesRef.current = [];
                setLoopBlocked(false);
                webviewRef.current?.reload();
              }}
            >
              다시 시도
            </button>
          </div>
        )}
      </div>

      {/* 우클릭 컨텍스트 메뉴 */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[var(--c-surface-2)] border line-color rounded-lg shadow-xl py-1 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-sm btn-ghost text-gray-700 dark:text-gray-300 flex items-center gap-2"
            onClick={() => { setDialog({ mode: 'edit', bookmark: contextMenu.bookmark }); setContextMenu(null); }}
          >
            <FaPen size={10} /> 편집
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-sm btn-ghost text-red-500 flex items-center gap-2"
            onClick={() => handleDeleteBookmark(contextMenu.bookmark.id)}
          >
            <FaTrash size={10} /> 삭제
          </button>
        </div>
      )}

      {/* 즐겨찾기 추가/편집 다이얼로그 */}
      {dialog && (
        <BookmarkDialog
          mode={dialog.mode}
          initialLabel={dialog.bookmark?.label ?? ''}
          initialUrl={dialog.bookmark?.url ?? url}
          onConfirm={(label, bmUrl) => {
            if (dialog.mode === 'add') handleAddBookmark(label, bmUrl);
            else if (dialog.bookmark) handleEditBookmark(dialog.bookmark.id, label, bmUrl);
          }}
          onDelete={dialog.bookmark ? () => handleDeleteBookmark(dialog.bookmark!.id) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};

export default DesktopBrowser;
