import { observer } from 'mobx-react-lite';
import { Scene, PromptPiece } from '../models/types';
import { combinationPieceKey } from '../models/combinationSelection';
import { columnColor, pieceLabel } from './CombinationList';
import Tooltip from './Tooltip';

// 퀵 토글과 프롬프트 퀵 수정에서 같은 열 배치·라벨·호버 미리보기를 사용한다.
const CompactCombinationPieces = observer(({ scene, selected, onSelect }: {
  scene: Scene;
  selected: ReadonlySet<string>;
  onSelect: (key: string, piece: PromptPiece) => void;
}) => (
  <div className="space-y-2">
    {scene.slots.length === 0 ? (
      <div className="py-4 text-center text-sm text-muted">선택할 조각이 없습니다.</div>
    ) : scene.slots.map((slot, columnIndex) => (
      <div key={columnIndex} className="rounded-md r-card border line-color p-2">
        <div className="mb-1.5 text-xs font-bold text-muted">열 {columnIndex + 1}</div>
        <div className="flex flex-wrap gap-1.5">
          {slot.map((piece, rowIndex) => {
            const key = combinationPieceKey(columnIndex, rowIndex);
            const checked = selected.has(key);
            return <Tooltip key={key} content={piece.prompt || '(빈 프롬프트)'}>
              <button type="button"
                className={`btn rounded px-2 py-1 text-xs ${checked ? 'text-white shadow-sm' : 'btn-neutral text-muted opacity-60'}`}
                style={checked ? { backgroundColor: columnColor(columnIndex) } : undefined}
                aria-pressed={checked} onClick={() => onSelect(key, piece)}>
                {pieceLabel(piece, columnIndex, rowIndex)}
              </button>
            </Tooltip>;
          })}
        </div>
      </div>
    ))}
  </div>
));

export default CompactCombinationPieces;
