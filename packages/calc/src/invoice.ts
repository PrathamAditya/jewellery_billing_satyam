import { MAX_PRICE_PAISE_PER_KG, RATE_UNIT_MG } from "@jewellery/shared";
import { divRoundHalfUp, roundOffPaise } from "./round";

/** Spec 012, extended by spec 012c. Pure: no database, no clock. Money is integer paise, weight integer mg, rates paise per kg. */

export type TaxMode = "intra" | "inter";

/** Spec 012c R1. `weight` is the default and gives exactly the spec 012 and 012b results. */
export type PricingMode = "weight" | "separate" | "combined";
export const PRICING_MODES = ["weight", "separate", "combined"] as const;

export type InvoiceLineInput = {
  description?: string;
  hsn: string;
  grossWeightMg: number;
  netWeightMg: number;
  polishMg: number;
  goldRatePaisePerKg: number;
  labourRatePaisePerKg: number;
  /** Basis points: 3% is 300. */
  gstRateBps: number;
  /** Spec 012c R1. Missing means `weight`. */
  pricingMode?: PricingMode;
  /** `separate` only: part of the gross weight, not of the net weight (information, Q69 default). */
  stoneWeightMg?: number;
  /** `separate` only: typed fixed stone amount, 0 allowed. */
  stoneAmountPaise?: number;
  /** `combined` only: the one typed amount for the line, more than 0. */
  totalAmountPaise?: number;
};

/** Spec 012b R2. Percentage is basis points (2% is 200). */
export function polishWeightMg(netWeightMg: number, polishBps: number): number {
  return Number(divRoundHalfUp(BigInt(netWeightMg) * BigInt(polishBps), 10_000n));
}

/** Spec 012c R4. Fixed is whole paise; percent is basis points (100% is 10,000). */
export type DiscountInput = { kind: "fixed" | "percent"; value: number };
export type DiscountTarget = "gold" | "labour" | "total";
export type DiscountsInput = Partial<Record<DiscountTarget, DiscountInput>>;

export type InvoiceInput = { lines: InvoiceLineInput[]; taxMode: TaxMode; discounts?: DiscountsInput };

export type LineResult = {
  pricingMode: PricingMode;
  chargeableWeightMg: number;
  internalRatePaisePerKg: number;
  goldAmountPaise: number;
  labourAmountPaise: number;
  /** Spec 012c R8: the typed stone amount (0 unless `separate`). */
  stoneAmountPaise: number;
  /** Line amount before discount: gold + labour + stone, or the typed total for `combined`. */
  amountPaise: number;
  /** Spec 012c R8: the three discount shares added together. */
  discountPaise: number;
  /** Spec 012c R8: the amount after discount, the base for tax. */
  taxablePaise: number;
  /** For printing only (R8): paise per gram. */
  displayRatePaisePerGram: number;
  gstRateBps: number;
};

export type GroupResult = {
  gstRateBps: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
};

export type InvoiceResult = {
  taxMode: TaxMode;
  lines: LineResult[];
  groups: GroupResult[];
  /** Spec 012c R8: sum of line amounts before discount (`Total value`). */
  totalValuePaise: number;
  discountGoldPaise: number;
  discountLabourPaise: number;
  discountTotalPaise: number;
  /** The three discounts added together (`Less: discount`). */
  discountPaise: number;
  /** After discount (`Taxable value`). For invoices without discounts this equals the sum of line amounts (spec 012 R11). */
  taxablePaise: number;
  taxPaise: number;
  totalBeforeRoundOffPaise: number;
  /** Can be negative (R12). */
  roundOffPaise: number;
  payablePaise: number;
};

export type InvoiceError = {
  /** 1-based line number, or null when the problem is with the invoice as a whole. */
  line: number | null;
  field: string;
  code: string;
  message: string;
};

export type CalculateOutcome = { ok: true; result: InvoiceResult } | { ok: false; errors: InvoiceError[] };

export const LIMITS = {
  maxLines: 50,
  maxNetWeightMg: 100_000_000, // 100 kg
  maxGstRateBps: 2800,
  maxStoneAmountPaise: 10_00_00_000 * 100, // the same ceiling as a price
} as const;

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

const TARGET_LABEL: Record<DiscountTarget, string> = { gold: "Gold", labour: "Labour", total: "Total" };

function validate(input: InvoiceInput): InvoiceError[] {
  const errors: InvoiceError[] = [];
  const bad = (line: number | null, field: string, code: string, message: string) => errors.push({ line, field, code, message });

  if (input.taxMode !== "intra" && input.taxMode !== "inter") bad(null, "taxMode", "invalid_tax_mode", "Tax mode must be intra or inter");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    bad(null, "lines", "no_lines", "Add at least one line");
    return errors;
  }
  if (input.lines.length > LIMITS.maxLines) bad(null, "lines", "too_many_lines", `An invoice can have at most ${LIMITS.maxLines} lines`);

  input.lines.forEach((l, i) => {
    const n = i + 1;
    const mode = l.pricingMode ?? "weight";
    if (typeof l.hsn !== "string" || !["7113", "9988"].includes(l.hsn.trim())) bad(n, "hsn", "invalid_hsn", `Line ${n}: Choose 7113 or 9988`);
    if (!PRICING_MODES.includes(mode)) bad(n, "pricingMode", "invalid_pricing_mode", `Line ${n}: pricing must be weight, separate or combined`);
    if (!isInt(l.netWeightMg) || l.netWeightMg <= 0) bad(n, "netWeightMg", "invalid_net_weight", `Line ${n}: net weight must be more than 0`);
    else if (l.netWeightMg > LIMITS.maxNetWeightMg) bad(n, "netWeightMg", "net_weight_too_large", `Line ${n}: net weight is above 100 kg`);
    if (!isInt(l.grossWeightMg) || l.grossWeightMg < 0) bad(n, "grossWeightMg", "invalid_gross_weight", `Line ${n}: gross weight is not valid`);
    else if (isInt(l.netWeightMg) && l.grossWeightMg < l.netWeightMg) bad(n, "grossWeightMg", "gross_below_net", `Line ${n}: gross weight cannot be less than net weight`);
    if (!isInt(l.polishMg) || l.polishMg < 0) bad(n, "polishMg", "invalid_polish", `Line ${n}: polish cannot be negative`);

    // Spec 012c R1: a combined line does not use its rates, so they are not checked (test E).
    if (mode !== "combined") {
      if (!isInt(l.goldRatePaisePerKg) || l.goldRatePaisePerKg <= 0) bad(n, "goldRatePaisePerKg", "invalid_gold_rate", `Line ${n}: gold rate must be more than 0`);
      else if (l.goldRatePaisePerKg > MAX_PRICE_PAISE_PER_KG) bad(n, "goldRatePaisePerKg", "gold_rate_too_large", `Line ${n}: gold rate is too large`);
      if (!isInt(l.labourRatePaisePerKg) || l.labourRatePaisePerKg < 0) bad(n, "labourRatePaisePerKg", "invalid_labour_rate", `Line ${n}: labour rate cannot be negative`);
      else if (l.labourRatePaisePerKg > MAX_PRICE_PAISE_PER_KG) bad(n, "labourRatePaisePerKg", "labour_rate_too_large", `Line ${n}: labour rate is too large`);
    }
    if (mode === "separate") {
      if (!isInt(l.stoneAmountPaise) || l.stoneAmountPaise < 0) bad(n, "stoneAmountPaise", "invalid_stone_amount", `Line ${n}: stone amount cannot be negative`);
      else if (l.stoneAmountPaise > LIMITS.maxStoneAmountPaise) bad(n, "stoneAmountPaise", "stone_amount_too_large", `Line ${n}: stone amount is too large`);
      // The stone weight is information only, so a missing one counts as 0.
      if (l.stoneWeightMg !== undefined && (!isInt(l.stoneWeightMg) || l.stoneWeightMg < 0)) bad(n, "stoneWeightMg", "invalid_stone_weight", `Line ${n}: stone weight is not valid`);
      else if (isInt(l.grossWeightMg) && isInt(l.netWeightMg) && (l.stoneWeightMg ?? 0) > l.grossWeightMg - l.netWeightMg) bad(n, "stoneWeightMg", "stone_above_gross", `Line ${n}: stone weight is part of the gross weight, so it cannot be more than gross minus net`);
    }
    if (mode === "combined") {
      if (!isInt(l.totalAmountPaise) || l.totalAmountPaise <= 0) bad(n, "totalAmountPaise", "invalid_total", `Line ${n}: the total must be more than 0`);
      else if (l.totalAmountPaise > LIMITS.maxStoneAmountPaise) bad(n, "totalAmountPaise", "total_too_large", `Line ${n}: the total is too large`);
    }
    // The API derives this from HSN. Keeping the pure engine's rate argument
    // validates historical frozen documents and calculator fixtures too.
    if (!isInt(l.gstRateBps) || l.gstRateBps < 0 || l.gstRateBps > LIMITS.maxGstRateBps) bad(n, "gstRateBps", "invalid_gst_rate", `Line ${n}: GST rate must be from 0% to 28%`);
  });

  // Spec 012c R4: a discount is fixed paise or percent in basis points, whole numbers only.
  const discounts = input.discounts ?? {};
  for (const key of Object.keys(discounts)) {
    if (!(key in TARGET_LABEL)) {
      bad(null, `discounts.${key}`, "invalid_discount_target", `Unknown discount "${key}": use gold, labour or total`);
      continue;
    }
    const target = key as DiscountTarget;
    const d = discounts[target];
    if (d === undefined) continue;
    const label = TARGET_LABEL[target];
    const field = `discounts.${target}`;
    if (d.kind !== "fixed" && d.kind !== "percent") {
      bad(null, field, "invalid_discount_kind", `${label} discount must be fixed or percent`);
    } else if (!isInt(d.value) || d.value < 0) {
      bad(null, field, "invalid_discount_value", `${label} discount must be a whole number, not negative (${d.kind === "percent" ? "basis points" : "paise"})`);
    } else if (d.kind === "percent" && d.value > 10_000) {
      bad(null, field, "discount_over_100_percent", `${label} discount cannot be more than 100%`);
    }
  }
  return errors;
}

/** weight (mg) x rate (paise per kg) / 1 kg in mg, rounded half up to a paisa (R6, R7). */
const amountFor = (weightMg: number, ratePaisePerKg: number): number =>
  Number(divRoundHalfUp(BigInt(weightMg) * BigInt(ratePaisePerKg), BigInt(RATE_UNIT_MG)));

/**
 * Spec 012c R6. Shares of `total` in proportion to `weights`, by the largest-remainder method on whole paise,
 * so the shares add up to `total` exactly. Ties go to the earlier line. A weight of 0 never gets a share.
 */
export function shareProportionally(weights: bigint[], total: bigint): bigint[] {
  const sum = weights.reduce((s, w) => s + w, 0n);
  if (total === 0n || sum === 0n) return weights.map(() => 0n);
  const shares = weights.map((w) => (total * w) / sum);
  let left = total - shares.reduce((s, x) => s + x, 0n);
  const order = weights
    .map((w, i) => ({ i, rem: (total * w) % sum }))
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (let k = 0; left > 0n; k++) {
    shares[order[k]!.i]! += 1n;
    left -= 1n;
  }
  return shares;
}

/** A discount amount on a base (spec 012c R5, R6). Errors name the target. */
function discountAmount(d: DiscountInput, base: bigint, target: DiscountTarget, errors: InvoiceError[]): bigint {
  const label = TARGET_LABEL[target];
  const field = `discounts.${target}`;
  const amount = d.kind === "percent" ? divRoundHalfUp(base * BigInt(d.value), 10_000n) : BigInt(d.value);
  if (amount === 0n) return 0n;
  if (base === 0n) {
    errors.push({ line: null, field, code: "nothing_to_discount", message: `${label} discount: there is nothing to discount` });
    return 0n;
  }
  if (amount > base) {
    errors.push({ line: null, field, code: "discount_exceeds_base", message: `${label} discount is more than the ${label.toLowerCase()} amount on the invoice` });
    return 0n;
  }
  return amount;
}

/** Spec 012, 012b and 012c: works out every figure on the bill. Returns errors instead of throwing for bad input. */
export function calculateInvoice(input: InvoiceInput): CalculateOutcome {
  const errors = validate(input);
  if (errors.length) return { ok: false, errors };

  // Step 1: each line's own parts (R1, R3).
  const parts = input.lines.map((l) => {
    const mode: PricingMode = l.pricingMode ?? "weight";
    if (mode === "combined") {
      const amountPaise = l.totalAmountPaise!;
      const chargeableWeightMg = l.netWeightMg; // polish is not charged on a combined line (R1)
      return {
        mode,
        chargeableWeightMg,
        internalRatePaisePerKg: 0,
        goldAmountPaise: 0,
        labourAmountPaise: 0,
        stoneAmountPaise: 0,
        amountPaise,
        displayRatePaisePerGram: Number(divRoundHalfUp(BigInt(amountPaise) * 1000n, BigInt(chargeableWeightMg))),
        gstRateBps: l.gstRateBps,
      };
    }
    const chargeableWeightMg = l.netWeightMg + l.polishMg; // R5
    const internalRatePaisePerKg = l.goldRatePaisePerKg + l.labourRatePaisePerKg; // R4
    const jobWork = l.hsn.trim() === "9988";
    // Job work is the single expression from D13; do not round its parts first.
    const metalAmountPaise = jobWork
      ? Number(divRoundHalfUp(BigInt(chargeableWeightMg) * BigInt(internalRatePaisePerKg) - BigInt(l.netWeightMg) * BigInt(l.goldRatePaisePerKg), BigInt(RATE_UNIT_MG)))
      : amountFor(chargeableWeightMg, internalRatePaisePerKg);
    const goldAmountPaise = jobWork
      ? amountFor(chargeableWeightMg, l.goldRatePaisePerKg) - amountFor(l.netWeightMg, l.goldRatePaisePerKg)
      : amountFor(chargeableWeightMg, l.goldRatePaisePerKg);
    const stoneAmountPaise = mode === "separate" ? l.stoneAmountPaise! : 0; // R1, R3
    return {
      mode,
      chargeableWeightMg,
      internalRatePaisePerKg,
      goldAmountPaise,
      labourAmountPaise: metalAmountPaise - goldAmountPaise,
      stoneAmountPaise,
      amountPaise: metalAmountPaise + stoneAmountPaise,
      // paise per gram = amount / weight in mg x 1000 mg per gram (R8)
      displayRatePaisePerGram: Number(divRoundHalfUp(BigInt(metalAmountPaise + stoneAmountPaise) * 1000n, BigInt(chargeableWeightMg))),
      gstRateBps: l.gstRateBps,
    };
  });

  // Step 2 to 4: gold, labour, then total discounts, each shared by largest remainder (R5, R6).
  const discounts = input.discounts ?? {};
  const goldWeights = parts.map((p) => BigInt(p.goldAmountPaise));
  const goldDiscount = discounts.gold ? discountAmount(discounts.gold, goldWeights.reduce((s, w) => s + w, 0n), "gold", errors) : 0n;
  const goldShares = shareProportionally(goldWeights, goldDiscount);

  const labourWeights = parts.map((p) => BigInt(p.labourAmountPaise));
  const labourDiscount = discounts.labour ? discountAmount(discounts.labour, labourWeights.reduce((s, w) => s + w, 0n), "labour", errors) : 0n;
  const labourShares = shareProportionally(labourWeights, labourDiscount);

  const remaining = parts.map((p, i) => BigInt(p.amountPaise) - goldShares[i]! - labourShares[i]!);
  const totalDiscount = discounts.total ? discountAmount(discounts.total, remaining.reduce((s, w) => s + w, 0n), "total", errors) : 0n;
  const totalShares = shareProportionally(remaining, totalDiscount);
  if (errors.length) return { ok: false, errors };

  const lines: LineResult[] = parts.map((p, i) => {
    const discountPaise = goldShares[i]! + labourShares[i]! + totalShares[i]!;
    return {
      pricingMode: p.mode,
      chargeableWeightMg: p.chargeableWeightMg,
      internalRatePaisePerKg: p.internalRatePaisePerKg,
      goldAmountPaise: p.goldAmountPaise,
      labourAmountPaise: p.labourAmountPaise,
      stoneAmountPaise: p.stoneAmountPaise,
      amountPaise: p.amountPaise,
      discountPaise: Number(discountPaise),
      taxablePaise: Number(remaining[i]! - totalShares[i]!),
      displayRatePaisePerGram: p.displayRatePaisePerGram,
      gstRateBps: p.gstRateBps,
    };
  });

  // R9: tax once per rate group, on the sum of that group's taxable amounts (after discount).
  const taxableByRate = new Map<number, number>();
  for (const l of lines) taxableByRate.set(l.gstRateBps, (taxableByRate.get(l.gstRateBps) ?? 0) + l.taxablePaise);

  const groups: GroupResult[] = [...taxableByRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([gstRateBps, taxablePaise]) => {
      const t = BigInt(taxablePaise);
      const bps = BigInt(gstRateBps);
      if (input.taxMode === "intra") {
        const half = Number(divRoundHalfUp(t * bps, 20_000n)); // R10: each half is rate / 2
        return { gstRateBps, taxablePaise, cgstPaise: half, sgstPaise: half, igstPaise: 0 };
      }
      return { gstRateBps, taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: Number(divRoundHalfUp(t * bps, 10_000n)) };
    });

  const totalValuePaise = lines.reduce((s, l) => s + l.amountPaise, 0); // R8: before discount
  const discountGoldPaise = Number(goldDiscount);
  const discountLabourPaise = Number(labourDiscount);
  const discountTotalPaise = Number(totalDiscount);
  const taxablePaise = lines.reduce((s, l) => s + l.taxablePaise, 0); // R11, after discount
  const taxPaise = groups.reduce((s, g) => s + g.cgstPaise + g.sgstPaise + g.igstPaise, 0);
  const totalBeforeRoundOffPaise = taxablePaise + taxPaise;
  const payablePaise = roundOffPaise(totalBeforeRoundOffPaise); // R12

  return {
    ok: true,
    result: {
      taxMode: input.taxMode,
      lines,
      groups,
      totalValuePaise,
      discountGoldPaise,
      discountLabourPaise,
      discountTotalPaise,
      discountPaise: discountGoldPaise + discountLabourPaise + discountTotalPaise,
      taxablePaise,
      taxPaise,
      totalBeforeRoundOffPaise,
      roundOffPaise: payablePaise - totalBeforeRoundOffPaise,
      payablePaise,
    },
  };
}
