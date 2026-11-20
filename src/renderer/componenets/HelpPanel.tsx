// 도움말 패널 — 누르면 열려 떠 있는 패널(2026-11-20 UI 정돈 그룹 1-b: 문법 패널 PromptSyntaxHelp 를 공용으로 뽑음).
// 긴 설명을 한 덩어리 툴팁 대신 「제목 + 묶음 제목 + 예시 칩·설명 2열」로 보인다. 짧은 도움말은 HelpIcon(툴팁) 그대로.
// · 열기·닫기: (?) 를 누르면 열림/닫힘(aria-expanded), 바깥을 누르면 닫힘, Esc·Android 뒤로 가기는 닫기 관문
//   (backStackService.push 표준 연결 — 창별 Esc 리스너를 달지 않는다, SPEC §5). 모바일도 짧게 눌러 열린다.
// · 위치: 버튼 아래 왼쪽 맞춤, 아래가 모자라면 위로, 가로는 화면 안(placeAnchoredPanel). 높이가 넘치면 패널 안 스크롤.
//   스크롤·창 크기 변경 때 다시 잰다. 앱 테마 루트 포털(themePortalRoot) + --z-tooltip(치트시트 층, 모달 위).
// · 내용은 models/ 의 데이터(HelpPanelData, models/helpPanel.ts). 칩 없는 줄은 설명이 줄 전체 폭,
//   묶음 제목이 없으면 제목 줄 없이 줄만. 예시 칩의 code 조각은 편집 칸과 같은 .syntax-* 클래스.
import { themePortalRoot } from './themePortal';
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { FaQuestionCircle } from 'react-icons/fa';
import { backStackService } from '../models/BackStackService';
import {
  HelpChip,
  helpChipsOf,
  HelpPanelData,
  helpPanelButtonLabel,
  placeAnchoredPanel,
} from '../models/helpPanel';

function ExampleChip({ chip }: { chip: HelpChip }) {
  if (chip.kind === 'keys') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {chip.keys.map((k) => (
          <kbd key={k} className="help-panel-kbd">
            {k}
          </kbd>
        ))}
      </span>
    );
  }
  if (chip.kind === 'label') {
    return <span className="help-panel-chip help-panel-chip-label">{chip.text}</span>;
  }
  return (
    <code className="help-panel-chip">
      <span className="syntax-line">
        {chip.parts.map((p, i) =>
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

function HelpPanel({
  id,
  anchor,
  data,
  width,
  exampleWidth,
  marker,
  onClose,
}: {
  id: string;
  anchor: HTMLElement;
  data: HelpPanelData;
  width?: number;
  exampleWidth?: number;
  marker?: string;
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
  const style: React.CSSProperties & Record<string, string | number | undefined> = {
    zIndex: 'var(--z-tooltip)',
    left: pos ? pos.left : -9999,
    top: pos ? pos.top : -9999,
    maxHeight: pos ? pos.maxHeight : undefined,
    visibility: pos ? undefined : 'hidden',
    // 폭은 내용에 맞춰 좁힐 수 있다(기본 460px = 문법 패널). 화면 폭 상한은 CSS max-width.
    width: width ?? undefined,
    '--help-panel-example-w': exampleWidth != null ? `${exampleWidth}px` : undefined,
  };
  const markerAttr = marker ? { [`data-${marker}`]: '' } : {};
  return ReactDOM.createPortal(
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      data-help-panel=""
      {...markerAttr}
      className="help-panel ui-pop-in fixed overflow-y-auto"
      style={style}
      // 포털이어도 React 이벤트는 부모(편집 칸 머리 줄·창)로 거슬러 오르므로 패널 안 누름은 여기서 멈춘다
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 id={titleId} className="text-sm font-semibold text-default">
        {data.title}
      </h3>
      {data.groups.map((g) => (
        <section key={g.id} data-help-group={g.id} className="flex flex-col gap-1.5">
          {g.title && <div className="help-panel-caption">{g.title}</div>}
          {g.rows.map((r) => {
            const chips = helpChipsOf(r.example);
            if (chips.length === 0) {
              return (
                <div key={r.id} data-help-row={r.id} className="help-panel-row help-panel-row-full">
                  <span className="text-body">{r.desc}</span>
                </div>
              );
            }
            return (
              <div key={r.id} data-help-row={r.id} className="help-panel-row">
                <span className="help-panel-examples min-w-0">
                  {chips.map((c, i) => (
                    <ExampleChip key={i} chip={c} />
                  ))}
                </span>
                <span className="text-body">{r.desc}</span>
              </div>
            );
          })}
        </section>
      ))}
    </div>,
    // 앱 테마 루트 안에 붙인다 — body 에 붙이면 다크 테마에서도 라이트 색으로 그려진다
    themePortalRoot(anchor),
  );
}

export interface HelpPanelButtonProps {
  data: HelpPanelData;
  // 접근성 이름 — 없으면 「제목 도움말」
  label?: string;
  // 아이콘 크기 — HelpIcon 과 같은 자리·같은 기본값(15)
  size?: number;
  // 패널 폭(px) — 없으면 460px. 화면 폭(양옆 8px)을 넘지 않는다.
  width?: number;
  // 예시 칸 폭(px) — 없으면 150px
  exampleWidth?: number;
  // 패널 뿌리에 더 붙일 표식 이름(data-<marker>) — 예: 문법 패널 'prompt-syntax-panel'
  marker?: string;
}

// 여는 단추는 HelpIcon 과 같은 노랑 (?) 아이콘·같은 정렬(inline-flex align-middle)이라 같은 자리에 넣어도 줄 높이가 같다.
export function HelpPanelButton({ data, label, size = 15, width, exampleWidth, marker }: HelpPanelButtonProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelId = `help-panel-${useId().replace(/:/g, '')}`;
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
        className="help-panel-btn ui-press text-yellow-500 dark:text-yellow-400 inline-flex items-center align-middle"
        aria-label={label ?? helpPanelButtonLabel(data.title)}
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
        <HelpPanel
          id={panelId}
          anchor={btnRef.current}
          data={data}
          width={width}
          exampleWidth={exampleWidth}
          marker={marker}
          onClose={close}
        />
      )}
    </>
  );
}

export default HelpPanelButton;
