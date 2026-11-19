// 프롬프트 문법 설명 — 누르면 열려 떠 있는 패널(2026-11-19 UI 정돈 시범 ①). 상위 프롬프트 라벨 옆 (?) 자리.
// · 열기·닫기: (?) 를 누르면 열림/닫힘(aria-expanded), 바깥을 누르면 닫힘, Esc·Android 뒤로 가기는 닫기 관문
//   (backStackService.push 표준 연결 — 창별 Esc 리스너를 달지 않는다, SPEC §5).
// · 위치: 버튼 아래 왼쪽 맞춤, 아래가 모자라면 위로, 가로는 화면 안(placeAnchoredPanel). 높이가 넘치면 패널 안 스크롤.
//   스크롤·창 크기 변경 때 다시 잰다. body 포털 + --z-tooltip(치트시트 층).
// · 내용은 models/promptSyntaxHelp.ts 데이터. 예시 칩은 편집 칸과 같은 .syntax-* 클래스(테마별 색 짝을 그대로 따름).
// 다른 곳의 짧은 도움말은 HelpIcon(마우스 올림 툴팁) 그대로.
import { themePortalRoot } from './themePortal';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { FaQuestionCircle } from 'react-icons/fa';
import { backStackService } from '../models/BackStackService';
import {
  PROMPT_SYNTAX_HELP_TEXT,
  placeAnchoredPanel,
  promptSyntaxHelpGroups,
  SyntaxExample,
} from '../models/promptSyntaxHelp';

function ExampleChip({ example }: { example: SyntaxExample }) {
  if (example.kind === 'keys') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {example.keys.map((k) => (
          <kbd key={k} className="prompt-syntax-kbd">
            {k}
          </kbd>
        ))}
      </span>
    );
  }
  if (example.kind === 'label') {
    return <span className="prompt-syntax-chip prompt-syntax-chip-label">{example.text}</span>;
  }
  return (
    <code className="prompt-syntax-chip">
      <span className="syntax-line">
        {example.parts.map((p, i) =>
          p.cls ? (
            <span key={i} className={p.cls}>
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </span>
    </code>
  );
}

function SyntaxPanel({
  id,
  anchor,
  mobile,
  onClose,
}: {
  id: string;
  anchor: HTMLElement;
  mobile: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = `${id}-title`;
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setPos(
      placeAnchoredPanel(
        { left: a.left, top: a.top, bottom: a.bottom },
        // scrollHeight = 줄이기 전 내용 높이(이미 maxHeight 로 줄었어도 본래 높이로 다시 잰다)
        { width: r.width, height: Math.max(r.height, el.scrollHeight) },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchor]);
  useLayoutEffect(() => {
    measure();
  }, [measure]);
  useEffect(() => {
    const onMove = () => measure();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [measure]);
  // 바깥 누름 = 닫힘. 캡처 단계라 다른 요소의 stopPropagation 과 무관. (?) 버튼 자신은 제외(버튼이 토글한다).
  useEffect(() => {
    const onDown = (e: Event) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
    };
  }, [anchor, onClose]);
  const groups = promptSyntaxHelpGroups(mobile);
  return ReactDOM.createPortal(
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      data-prompt-syntax-panel=""
      className="prompt-syntax-panel ui-pop-in fixed overflow-y-auto"
      style={{
        zIndex: 'var(--z-tooltip)',
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : -9999,
        maxHeight: pos ? pos.maxHeight : undefined,
        visibility: pos ? undefined : 'hidden',
      }}
      // 포털이어도 React 이벤트는 부모(편집 칸 머리 줄·창)로 거슬러 오르므로 패널 안 누름은 여기서 멈춘다
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 id={titleId} className="text-sm font-semibold text-default">
        {PROMPT_SYNTAX_HELP_TEXT.title}
      </h3>
      {groups.map((g) => (
        <section key={g.id} data-syntax-group={g.id} className="flex flex-col gap-1.5">
          <div className="prompt-syntax-caption">{g.title}</div>
          {g.rows.map((r) => (
            <div key={r.id} data-syntax-row={r.id} className="prompt-syntax-row">
              <span className="min-w-0">
                <ExampleChip example={r.example} />
              </span>
              <span className="text-body">{r.desc}</span>
            </div>
          ))}
        </section>
      ))}
    </div>,
    // 앱 테마 루트 안에 붙인다 — body 에 붙이면 다크 테마에서도 라이트 색으로 그려진다
    themePortalRoot(anchor),
  );
}

export function PromptSyntaxHelpButton({
  mobile,
  size = 15,
}: {
  mobile: boolean;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelId = `prompt-syntax-${useId().replace(/:/g, '')}`;
  const close = useCallback(() => setOpen(false), []);
  // 닫기 관문(SPEC §5 표준 연결 패턴) — 열려 있는 동안만 한 겹. Esc·Android 뒤로 가기 = 닫기.
  useEffect(() => {
    if (!open) return undefined;
    const handle = backStackService.push(() => setOpen(false));
    return () => handle.remove();
  }, [open]);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="prompt-syntax-help-btn ui-press text-yellow-500 dark:text-yellow-400 inline-flex items-center align-middle"
        aria-label={PROMPT_SYNTAX_HELP_TEXT.buttonLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        // 라벨 줄(접기 토글)·끌기로 번지지 않게(HelpIcon 과 같은 처리)
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <FaQuestionCircle size={size} />
      </button>
      {open && btnRef.current && (
        <SyntaxPanel id={panelId} anchor={btnRef.current} mobile={mobile} onClose={close} />
      )}
    </>
  );
}

export default PromptSyntaxHelpButton;
