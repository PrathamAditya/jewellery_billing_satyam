/**
 * Safe-retry create (spec 001 R5, first used by spec 010 R7).
 * The client picks the id. If the id already exists with the same content, the first save
 * already worked and the retry just returns it. If the content differs, it is a real conflict.
 */
export type ReplayCheck<T> = { kind: "new" } | { kind: "replay"; row: T } | { kind: "conflict" };

export function classifyReplay<T>(existing: T | null, sameContent: (row: T) => boolean): ReplayCheck<T> {
  if (!existing) return { kind: "new" };
  return sameContent(existing) ? { kind: "replay", row: existing } : { kind: "conflict" };
}
