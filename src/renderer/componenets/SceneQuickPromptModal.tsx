import CompactCombinationPieces from './CompactCombinationPieces';
import { combinationPieceKey } from '../models/combinationSelection';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 as uuidv4 } from 'uuid';
import { FaExpand, FaPuzzlePiece, FaTimes } from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import PromptEditTextArea from './PromptEditTextArea';
import { FloatView } from './FloatView';
import { SlotEditor } from './SceneEditor';
import Tooltip from './Tooltip';
import { isMobile } from '../models';
import { PromptPiece, Scene } from '../models/types';

interface SceneQuickPromptModalProps {
  scene: Scene;
  onClose: () => void;
  // 씬 카드 사각형 — 지정되면(데스크톱) 카드 위에 경량 팝오버로 띄워
  // 인라인 편집 느낌을 준다. 미지정/모바일은 중앙 모달 폴백.
  anchor?: DOMRect;
}

// 씬 프롬프트 퀵 수정(W2): 씬 카드의 우상단 버튼에서 열리는 경량 편집 창.
// 처음에는 1-1 조각을 열고 컴팩트 목록에서 다른 조각으로 전환한다.
// 전체 조합 에디터(SlotEditor)는 별도 확장 버튼으로 접근한다.
const SceneQuickPromptModal = observer(
  ({ scene, onClose, anchor }: SceneQuickPromptModalProps) => {
    const [showFull, setShowFull] = useState(false);
    const [showPieces, setShowPieces] = useState(false);
    const [selectedPiece, setSelectedPiece] = useState<PromptPiece>();
    useEffect(() => { setSelectedPiece(undefined); setShowPieces(false); }, [scene]);
    const usePopover = !isMobile && !!anchor;

    // 단순 씬 에디터와 동일한 보장: slots 가 비어 있으면 첫 조각을 만든다
    useEffect(() => {
      if (scene.slots.length === 0 || scene.slots[0].length === 0) {
        const first = PromptPiece.fromJSON({ prompt: '', characterPrompts: [], id: uuidv4() });
        if (scene.slots.length === 0) scene.slots.push([first]);
        else scene.slots[0].push(first);
      }
    }, [scene]);

    // 팝오버 배치: 패널 크기 측정 후 카드 상단·가로 중앙에 놓고
    // 뷰포트 여백 8px 안으로 클램프. 측정 전 한 프레임은 숨긴다.
    const panelRef = useRef<HTMLDivElement>(null);
    const mouseDownOnBackdrop = useRef(false);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
    useLayoutEffect(() => {
      if (!usePopover || showFull) return;
      const el = panelRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let left = anchor!.left + anchor!.width / 2 - r.width / 2;
      let top = anchor!.top;
      left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - r.height - 8));
      setPos({ left, top });
    }, [usePopover, showFull, showPieces, anchor]);

    // 팝오버 모드 ESC 닫기 (중앙 모달은 ModalOverlay가, 조합 에디터는 FloatView가 처리)
    useEffect(() => {
      if (!usePopover || showFull) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      };
      window.addEventListener('keydown', handler, true);
      return () => window.removeEventListener('keydown', handler, true);
    }, [usePopover, showFull, onClose]);

    const piece = selectedPiece && scene.slots.some((slot) => slot.includes(selectedPiece))
      ? selectedPiece : scene.slots[0]?.[0];
    const columnIndex = scene.slots.findIndex((slot) => !!piece && slot.includes(piece));
    const rowIndex = columnIndex < 0 ? -1 : scene.slots[columnIndex].indexOf(piece!);
    const location = `${columnIndex + 1}-${rowIndex + 1}`;
    const picker = <div className="max-h-[50vh] overflow-auto p-2">
      <CompactCombinationPieces scene={scene}
        selected={new Set([combinationPieceKey(columnIndex, rowIndex)])}
        onSelect={(_key, nextPiece) => { setSelectedPiece(nextPiece); setShowPieces(false); }} />
    </div>;
    const pieceCount = scene.slots.reduce((acc, slot) => acc + slot.length, 0);

    if (showFull) {
      return (
        <FloatView priority={2} onEscape={() => setShowFull(false)}>
          <div className="w-full h-full flex flex-col overflow-hidden">
            <div className="flex-none px-3 py-2 border-b line-color font-bold text-default">
              🧩 씬 {scene.name} — 조합 에디터
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SlotEditor scene={scene} big />
            </div>
          </div>
        </FloatView>
      );
    }

    const editor = piece && (
      <PromptEditTextArea key={piece.id}
        value={piece.prompt}
        onChange={(v: string) => {
          piece.prompt = v;
        }}
      />
    );

    if (usePopover) {
      return (
        <div
          className="fixed inset-0"
          style={{ zIndex: 'var(--z-modal)' }}
          onMouseDown={(e) => {
            mouseDownOnBackdrop.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && mouseDownOnBackdrop.current) {
              onClose();
            }
            mouseDownOnBackdrop.current = false;
          }}
        >
          <div
            ref={panelRef}
            className="absolute w-[26rem] max-w-[90vw] bg-[var(--c-zone)] rounded-lg shadow-xl border line-color flex flex-col overflow-hidden"
            style={{
              left: pos?.left ?? anchor!.left,
              top: pos?.top ?? anchor!.top,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            <div className="flex-none flex items-center gap-1 px-2.5 py-1.5 border-b line-color">
              <span className="text-sm font-semibold text-default truncate">
                ✏️ {scene.name} — {location}
              </span>
              <span className="ml-auto flex-none flex items-center gap-0.5">
                <Tooltip content={"조합 펼치기 (조각 " + pieceCount + "개)"}>
                  <button
                    className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-muted transition-colors"
                    aria-label="조합 펼치기" aria-expanded={showPieces} onClick={() => setShowPieces(!showPieces)}
                  >
                    <FaPuzzlePiece size={13} />
                  </button>
                </Tooltip>
                <Tooltip content="전체 조합 에디터 열기">
                  <button type="button" className="btn-ghost p-1.5 text-muted" aria-label="전체 조합 에디터 열기" onClick={() => setShowFull(true)}><FaExpand size={13} /></button>
                </Tooltip>
                <Tooltip content="닫기 (ESC)">
                  <button
                    className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-muted transition-colors"
                    onClick={onClose}
                  >
                    <FaTimes size={13} />
                  </button>
                </Tooltip>
              </span>
            </div>
            {showPieces ? picker : <div className="h-36 p-1.5 overflow-hidden">{editor}</div>}
          </div>
        </div>
      );
    }

    // 중앙 모달 폴백 (모바일 / 앵커 미지정)
    return (
      <ModalOverlay
        isOpen
        onClose={onClose}
        title={`✏️ ${scene.name} — 중간 프롬프트 (${location})`}
      >
        <div className="flex flex-col gap-3">
          {showPieces ? picker : <div className="h-40 md:h-52 overflow-hidden">{editor}</div>}
          <div className="flex justify-end gap-2 flex-wrap">
            <button type="button" className="round-button back-gray" aria-label="조합 펼치기" aria-expanded={showPieces} onClick={() => setShowPieces(!showPieces)}>
              <FaPuzzlePiece /> 조합 펼치기
            </button>
            <button
              className="round-button back-gray"
              onClick={() => setShowFull(true)}
            >
              자세히 보기 (조합 에디터)
            </button>
            <button className="round-button back-sky" onClick={onClose}>
              완료
            </button>
          </div>
        </div>
      </ModalOverlay>
    );
  },
);

export default SceneQuickPromptModal;
