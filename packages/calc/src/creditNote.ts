import { divRoundHalfUp, roundOffPaise } from "./round";
import type { GroupResult, TaxMode } from "./invoice";

/**
 * Spec 019d R2, R3: a credit note's figures follow the original invoice's tax rules.
 * Each returned line carries the taxable value credited and the GST rate of that original line.
 * Tax is worked per rate group exactly like the invoice engine (spec 012 R9, R10), and the total
 * is rounded to the rupee like an invoice (spec 012 R12). Pure: integers only (paise, basis points).
 */
export type CreditNoteLineInput = { taxablePaise: number; gstRateBps: number };
export type CreditNoteInput = { taxMode: TaxMode; lines: CreditNoteLineInput[] };
export type CreditNoteResult = {
  taxMode: TaxMode;
  groups: GroupResult[];
  taxablePaise: number;
  taxPaise: number;
  totalBeforeRoundOffPaise: number;
  roundOffPaise: number;
  amountPaise: number;
};
export type CreditNoteOutcome = { ok: true; result: CreditNoteResult } | { ok: false; error: string };

export const CREDIT_NOTE_LIMITS = { maxLines: 50 } as const;

export function calculateCreditNote(input: CreditNoteInput): CreditNoteOutcome {
  if (input.lines.length === 0) return { ok: false, error: "Add at least one returned line" };
  if (input.lines.length > CREDIT_NOTE_LIMITS.maxLines) return { ok: false, error: `A credit note can have at most ${CREDIT_NOTE_LIMITS.maxLines} lines` };
  for (const [i, l] of input.lines.entries()) {
    const n = i + 1;
    if (!Number.isSafeInteger(l.taxablePaise) || l.taxablePaise <= 0) return { ok: false, error: `Line ${n}: the returned value must be more than 0` };
    if (!Number.isSafeInteger(l.gstRateBps) || l.gstRateBps < 0 || l.gstRateBps > 10_000) return { ok: false, error: `Line ${n}: GST rate is not valid` };
  }

  const byRate = new Map<number, number>();
  for (const l of input.lines) byRate.set(l.gstRateBps, (byRate.get(l.gstRateBps) ?? 0) + l.taxablePaise);

  const groups: GroupResult[] = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([gstRateBps, taxablePaise]) => {
      const t = BigInt(taxablePaise);
      const bps = BigInt(gstRateBps);
      if (input.taxMode === "intra") {
        const half = Number(divRoundHalfUp(t * bps, 20_000n));
        return { gstRateBps, taxablePaise, cgstPaise: half, sgstPaise: half, igstPaise: 0 };
      }
      return { gstRateBps, taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: Number(divRoundHalfUp(t * bps, 10_000n)) };
    });

  const taxablePaise = groups.reduce((s, g) => s + g.taxablePaise, 0);
  const taxPaise = groups.reduce((s, g) => s + g.cgstPaise + g.sgstPaise + g.igstPaise, 0);
  const totalBeforeRoundOffPaise = taxablePaise + taxPaise;
  const amountPaise = roundOffPaise(totalBeforeRoundOffPaise);
  return {
    ok: true,
    result: {
      taxMode: input.taxMode,
      groups,
      taxablePaise,
      taxPaise,
      totalBeforeRoundOffPaise,
      roundOffPaise: amountPaise - totalBeforeRoundOffPaise,
      amountPaise,
    },
  };
}
