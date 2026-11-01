import { divRoundHalfUp, roundOffPaise } from "./round";

/**
 * Spec 018 R3, R4: old gold amount = net weight x purity % x rate, rounded once to the paisa.
 * No melting loss or other deduction (owner answer 27). Round-off to the rupee on the total.
 * Pure: integers only (mg, basis points of purity, paise per kg).
 */
export type OldGoldRowInput = { netMg: number; purityBps: number; rateKgPaise: number };
export type OldGoldResult = {
  rows: { netMg: number; amountPaise: number }[];
  originalPaise: number;
  roundOffPaise: number;
  finalPaise: number;
};
export type OldGoldOutcome = { ok: true; result: OldGoldResult } | { ok: false; error: string };

export const OLD_GOLD_LIMITS = { maxRows: 10, maxPurityBps: 10000 } as const;

export function calculateOldGold(rows: OldGoldRowInput[]): OldGoldOutcome {
  if (rows.length === 0) return { ok: false, error: "Add at least one old gold row" };
  if (rows.length > OLD_GOLD_LIMITS.maxRows) return { ok: false, error: `A receipt can have at most ${OLD_GOLD_LIMITS.maxRows} rows` };
  for (const [i, r] of rows.entries()) {
    const n = i + 1;
    if (!Number.isSafeInteger(r.netMg) || r.netMg <= 0) return { ok: false, error: `Row ${n}: net weight must be more than 0` };
    if (!Number.isSafeInteger(r.purityBps) || r.purityBps < 1 || r.purityBps > OLD_GOLD_LIMITS.maxPurityBps) {
      return { ok: false, error: `Row ${n}: purity must be more than 0% and at most 100%` };
    }
    if (!Number.isSafeInteger(r.rateKgPaise) || r.rateKgPaise <= 0) return { ok: false, error: `Row ${n}: rate must be more than 0` };
  }
  const amounts = rows.map((r) => ({
    netMg: r.netMg,
    amountPaise: Number(divRoundHalfUp(BigInt(r.netMg) * BigInt(r.purityBps) * BigInt(r.rateKgPaise), 10_000n * 1_000_000n)),
  }));
  const originalPaise = amounts.reduce((s, a) => s + a.amountPaise, 0);
  const finalPaise = roundOffPaise(originalPaise);
  return { ok: true, result: { rows: amounts, originalPaise, roundOffPaise: finalPaise - originalPaise, finalPaise } };
}
