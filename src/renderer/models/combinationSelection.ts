import { Scene } from './types';

export type CombinationPieceSelection = Set<string>;

export function combinationPieceKey(columnIndex: number, rowIndex: number): string {
  return `${columnIndex}:${rowIndex}`;
}

export function allCombinationPieceKeys(scene: Scene): CombinationPieceSelection {
  const keys = new Set<string>();
  scene.slots.forEach((slot, columnIndex) => {
    slot.forEach((_, rowIndex) => {
      keys.add(combinationPieceKey(columnIndex, rowIndex));
    });
  });
  return keys;
}

export function activeCombinationPieceKeys(
  scene: Scene,
): CombinationPieceSelection {
  const keys = new Set<string>();
  scene.slots.forEach((slot, columnIndex) => {
    slot.forEach((piece, rowIndex) => {
      if (piece.enabled !== false) {
        keys.add(combinationPieceKey(columnIndex, rowIndex));
      }
    });
  });
  return keys;
}

export function combinationCountForSelection(
  scene: Scene,
  selected: ReadonlySet<string>,
): number {
  if (scene.slots.length === 0) return 1;
  let total = 1;
  scene.slots.forEach((slot, columnIndex) => {
    let enabled = 0;
    slot.forEach((_, rowIndex) => {
      if (selected.has(combinationPieceKey(columnIndex, rowIndex))) enabled++;
    });
    total *= enabled;
  });
  return total;
}

export function selectionHasEveryCombinationColumn(
  scene: Scene,
  selected: ReadonlySet<string>,
): boolean {
  return scene.slots.every((slot, columnIndex) =>
    slot.some((_, rowIndex) =>
      selected.has(combinationPieceKey(columnIndex, rowIndex)),
    ),
  );
}

export function applyCombinationPieceSelection(
  scene: Scene,
  selected: ReadonlySet<string>,
): number {
  let changed = 0;
  scene.slots.forEach((slot, columnIndex) => {
    slot.forEach((piece, rowIndex) => {
      const enabled = selected.has(
        combinationPieceKey(columnIndex, rowIndex),
      );
      if ((piece.enabled !== false) !== enabled) changed++;
      piece.enabled = enabled;
    });
  });
  return changed;
}
