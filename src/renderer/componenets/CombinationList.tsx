import { observer } from 'mobx-react-lite';
import {
  enumerateCombinations,
  combinationCount,
} from '../models/PromptService';
import { PromptPiece, PromptPieceSlot, Scene } from '../models/types';

// 조합 에디터 열 색상 팔레트 — 씬 캐릭터 팔레트와 공유(단일 출처).
// SceneEditor 가 여기서 import 한다(역방향 import 금지 = 순환 방지).
export const sceneCharColors = [
  '#38bdf8',
  '#f472b6',
  '#a78bfa',
  '#fb923c',
  '#4ade80',
  '#facc15',
  '#f87171',
  '#94a3b8',
];

/** 열 인덱스 → 색(팔레트 순환). */
export const columnColor = (i: number): string =>
  sceneCharColors[i % sceneCharColors.length];

/** 이름 미지정 조각의 기본 표시명 "열-행"(1-기반). */
export const pieceDefaultName = (col: number, row: number): string =>
  `${col + 1}-${row + 1}`;

/** 조각 표시 라벨 — 이름이 있으면 trim 한 이름, 없으면 기본명. */
export const pieceLabel = (
  piece: PromptPiece,
  col: number,
  row: number,
): string => {
  const trimmed = piece.name?.trim();
  return trimmed ? trimmed : pieceDefaultName(col, row);
};

// 미리보기 렌더 상한 — 대량 조합에서 수천 항목을 그리지 않도록 앞 N종만.
export const PREVIEW_RENDER_CAP = 100;

interface CombinationListProps {
  scene: { slots: PromptPieceSlot[] };
  // 간략(false) / 자세히(true) — 상태는 부모가 소유(테스트 단순화).
  detailed: boolean;
}

// 색 배경 칩(흰 글자). 열 색을 배경으로 쓰는 것은 이미지 오버레이류의 의도적 예외.
const ColorChip = ({ color, text }: { color: string; text: string }) => (
  <span
    className="inline-block px-1.5 py-0.5 rounded text-xs text-white"
    style={{ backgroundColor: color }}
  >
    {text}
  </span>
);

// 자세히 모드 하이라이트용 옅은 배경(열 색 + 알파) — 글자색은 테마 기본 유지(양 테마 가독).
const faintBg = (color: string): string => color + '2e'; // ≈18% 알파

/**
 * 조합 미리보기 리스트 — 우측 패널·모바일 오버레이에서 공유.
 *
 * scene.slots 만 관찰하는 경량 컴포넌트(무거운 서비스 import 금지) — SSR 렌더 테스트
 * 대상. 총 개수/0종 경고/상한 안내 + 각 조합을 열 색으로 구분해 표시한다.
 */
export const CombinationList = observer(
  ({ scene, detailed }: CombinationListProps) => {
    const total = combinationCount(scene as unknown as Scene);
    const combos = enumerateCombinations(
      scene as unknown as Scene,
      PREVIEW_RENDER_CAP,
    );

    // 세그먼트의 행 인덱스(기본명 계산용) — 해당 열 슬롯 내 위치.
    const rowOf = (col: number, piece: PromptPiece): number => {
      const slot = scene.slots[col];
      return slot ? slot.indexOf(piece) : 0;
    };

    return (
      <div className="flex flex-col gap-1 text-body">
        <div className="flex-none px-2 pt-1">
          {total === 0 ? (
            <span className="text-xs text-red-500 dark:text-red-400">
              활성 조각이 없는 열이 있어 생성되지 않습니다
            </span>
          ) : (
            <span className="text-sm font-bold">총 {total}종</span>
          )}
        </div>
        {total > PREVIEW_RENDER_CAP && (
          <div className="flex-none px-2 text-xs text-muted">
            조합이 {total}종으로 많아 앞 {PREVIEW_RENDER_CAP}종만 표시합니다.
          </div>
        )}
        <div className="flex flex-col">
          {combos.map((combo, index) => (
            <div
              key={index}
              className="px-2 py-1.5 border-b line-color last:border-b-0"
            >
              {/* 간략 모드 — 라벨(열 색 칩) + "+" 구분 */}
              {!detailed && (
                <div className="flex flex-wrap items-center gap-1">
                  {combo.map((seg, si) => (
                    <span key={si} className="flex items-center gap-1">
                      {si > 0 && (
                        <span className="text-xs text-faint">+</span>
                      )}
                      <ColorChip
                        color={columnColor(seg.columnIndex)}
                        text={pieceLabel(
                          seg.piece,
                          seg.columnIndex,
                          rowOf(seg.columnIndex, seg.piece),
                        )}
                      />
                    </span>
                  ))}
                </div>
              )}
              {/* 자세히 모드 — 조합 프롬프트를 하나의 흐름으로 나열,
                  각 셀 기여분에 열 색 옅은 배경 하이라이트(층 쌓기 대신). */}
              {detailed &&
                (() => {
                  const filled = combo.filter(
                    (seg) => seg.piece.prompt && seg.piece.prompt.trim() !== '',
                  );
                  if (filled.length === 0) {
                    return (
                      <div className="text-xs text-faint">(빈 프롬프트)</div>
                    );
                  }
                  return (
                    <div className="text-xs text-body break-words">
                      {filled.map((seg, si) => (
                        <span key={si}>
                          {si > 0 && <span className="text-faint">, </span>}
                          <span
                            className="rounded px-0.5"
                            style={{
                              backgroundColor: faintBg(
                                columnColor(seg.columnIndex),
                              ),
                            }}
                          >
                            {seg.piece.prompt}
                          </span>
                        </span>
                      ))}
                    </div>
                  );
                })()}
            </div>
          ))}
        </div>
      </div>
    );
  },
);
