import { divRoundHalfUp } from "./round";

/**
 * Spec 023: karigar job work. Pure arithmetic, no I/O. Money is integer paise, weight is integer milligrams,
 * and every rounding is half up through `divRoundHalfUp` (CLAUDE.md rule 2). Basis points: 10000 = 100%.
 */

export const KARIGAR_LIMITS = {
  /** K3: the wastage allowance is 0.00% to 10.00% of the issued metal. */
  WASTAGE_BPS_MAX: 1000,
  /** Default allowance for a new job (Q200): 2.00%. */
  WASTAGE_BPS_DEFAULT: 200,
} as const;

export type LabourBasis = "gram" | "piece";

export type KarigarOutcome<T> = { ok: true; result: T } | { ok: false; error: string };

/**
 * K7: labour on one finished line. Per gram: weight in mg x rate per gram / 1000, rounded to the paisa half up.
 * Per piece: pieces x rate per piece.
 */
export function labourPaise(input: { basis: LabourBasis; weightMg: number; pieces: number; ratePaise: number }): KarigarOutcome<number> {
  const { basis, weightMg, pieces, ratePaise } = input;
  if (!Number.isSafeInteger(ratePaise) || ratePaise < 0) return { ok: false, error: "The labour rate cannot be negative" };
  if (basis === "gram") {
    if (!Number.isSafeInteger(weightMg) || weightMg < 1) return { ok: false, error: "Labour per gram needs a weight of at least 1 mg" };
    return { ok: true, result: Number(divRoundHalfUp(BigInt(weightMg) * BigInt(ratePaise), 1000n)) };
  }
  if (basis === "piece") {
    if (!Number.isSafeInteger(pieces) || pieces < 1) return { ok: false, error: "Labour per piece needs at least 1 piece" };
    return { ok: true, result: Number(BigInt(pieces) * BigInt(ratePaise)) };
  }
  return { ok: false, error: "The labour basis is gram or piece" };
}

/** K10: the wastage allowance on an issued weight, in whole milligrams, rounded half up. */
export function allowanceMg(issuedMg: number, wastageBps: number): number {
  if (!Number.isSafeInteger(issuedMg) || issuedMg < 0) throw new RangeError(`Invalid issued weight: ${issuedMg}`);
  if (!Number.isSafeInteger(wastageBps) || wastageBps < 0 || wastageBps > KARIGAR_LIMITS.WASTAGE_BPS_MAX) {
    throw new RangeError(`Invalid wastage allowance: ${wastageBps}`);
  }
  return Number(divRoundHalfUp(BigInt(issuedMg) * BigInt(wastageBps), 10000n));
}

/** K9: wastage = issued - finished returned - remainder returned. Negative means more came back than was issued. */
export function wastageMg(issuedMg: number, finishedMg: number, remainderMg: number): number {
  return issuedMg - finishedMg - remainderMg;
}

/** K10: the held metal of a purity at close is written off only when it is within the allowance (equal is within). */
export function checkWastageAllowance(input: { heldMg: number; issuedMg: number; wastageBps: number }): KarigarOutcome<{ wastageMg: number; allowanceMg: number }> {
  const allowance = allowanceMg(input.issuedMg, input.wastageBps);
  if (!Number.isSafeInteger(input.heldMg) || input.heldMg < 0) return { ok: false, error: "The held metal cannot be negative" };
  if (input.heldMg > allowance) {
    return { ok: false, error: `${input.heldMg} mg is still held and more than the ${allowance} mg allowed` };
  }
  return { ok: true, result: { wastageMg: input.heldMg, allowanceMg: allowance } };
}

/** K16: labour still owed = labour accrued - payouts (paise). */
export function labourPayable(accruedPaise: number, paidPaise: number): number {
  return accruedPaise - paidPaise;
}

/** K13: a payout must be more than 0 and no more than the labour still owed. */
export function checkPayout(input: { amountPaise: number; payableBeforePaise: number }): KarigarOutcome<number> {
  const { amountPaise, payableBeforePaise } = input;
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 1) return { ok: false, error: "The payout must be more than ₹0" };
  if (amountPaise > payableBeforePaise) {
    const rupees = Math.floor(payableBeforePaise / 100);
    const paise = String(payableBeforePaise % 100).padStart(2, "0");
    return { ok: false, error: `Only ₹${rupees}.${paise} is owed to this karigar` };
  }
  return { ok: true, result: payableBeforePaise - amountPaise };
}

/** K15: metal still held on a job for one purity = issued - finished - remainder - wastage. */
export function heldMg(input: { issuedMg: number; finishedMg: number; remainderMg: number; wastageWrittenMg: number }): number {
  return input.issuedMg - input.finishedMg - input.remainderMg - input.wastageWrittenMg;
}

/** K7 and K6: a return may not be more than the metal still held on the job for that purity. */
export function checkReturnWeight(input: { weightMg: number; heldBeforeMg: number }): KarigarOutcome<number> {
  if (!Number.isSafeInteger(input.weightMg) || input.weightMg < 1) return { ok: false, error: "The weight must be more than 0" };
  if (input.weightMg > input.heldBeforeMg) {
    return { ok: false, error: `Only ${input.heldBeforeMg} mg is with the karigar on this job for this purity` };
  }
  return { ok: true, result: input.heldBeforeMg - input.weightMg };
}
