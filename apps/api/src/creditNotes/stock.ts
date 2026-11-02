/**
 * Spec 019d R19, Q99: stock is deferred. Spec 021 (inventory and stock movements) fills this in:
 * returned goods go back into stock against the original line's item. Until then nothing moves.
 */
export function creditNoteStockMovements(_lines: { inventoryItemId: string | null }[]): { itemId: string; weightMg: number }[] {
  return [];
}
