import { describe, expect, it } from "vitest";
import { calculateOldGold } from "./oldGold";

describe("calculateOldGold (spec 018 R3, R4)", () => {
  it("the owner's receipt OGP-0001: 22.98 g x 75.26% x ₹14,800/g = ₹2,55,962.27, round-off -0.27, final ₹2,55,962.00", () => {
    const r = calculateOldGold([{ netMg: 22_980, purityBps: 7_526, rateKgPaise: 1_480_000_000 }]);
    expect(r).toEqual({ ok: true, result: { rows: [{ netMg: 22_980, amountPaise: 25_596_227 }], originalPaise: 25_596_227, roundOffPaise: -27, finalPaise: 25_596_200 } });
  });

  it.each([
    [[{ netMg: 10_000, purityBps: 9_160, rateKgPaise: 600_050_000 }, { netMg: 5_250, purityBps: 9_990, rateKgPaise: 650_000_000 }], 5_496_458, 3_409_088, 8_905_546, -46, 8_905_500],
    [[{ netMg: 1_000, purityBps: 10_000, rateKgPaise: 1_000_000_000 }], 1_000_000, 0, 1_000_000, 0, 1_000_000],
  ])("rows %j -> amounts %i and %i, original %i, round-off %i, final %i", (rows, a, b, original, roundOff, final) => {
    const r = calculateOldGold(rows as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (rows.length === 2) expect(r.result.rows.map((x) => x.amountPaise)).toEqual([a, b]);
    expect(r.result).toMatchObject({ originalPaise: original, roundOffPaise: roundOff, finalPaise: final });
  });

  it("rounds 50 paise up to the next rupee and below 50 paise down", () => {
    // 1 g at 100% purity at ₹50,500/kg is exactly 5050 paise: round-off +50 to ₹51.00
    const up = calculateOldGold([{ netMg: 1_000, purityBps: 10_000, rateKgPaise: 5_050_000 }]);
    expect(up).toMatchObject({ ok: true, result: { originalPaise: 5_050, roundOffPaise: 50, finalPaise: 5_100 } });
    // 1 g at ₹50,490/kg is 5049 paise: round-off -49 to ₹50.00
    const down = calculateOldGold([{ netMg: 1_000, purityBps: 10_000, rateKgPaise: 5_049_000 }]);
    expect(down).toMatchObject({ ok: true, result: { originalPaise: 5_049, roundOffPaise: -49, finalPaise: 5_000 } });
  });

  it.each([
    [[], "Add at least one old gold row"],
    [[{ netMg: 0, purityBps: 7526, rateKgPaise: 1 }], "Row 1: net weight must be more than 0"],
    [[{ netMg: 1, purityBps: 0, rateKgPaise: 1 }], "Row 1: purity must be more than 0% and at most 100%"],
    [[{ netMg: 1, purityBps: 10_001, rateKgPaise: 1 }], "Row 1: purity must be more than 0% and at most 100%"],
    [[{ netMg: 1, purityBps: 7526, rateKgPaise: 0 }], "Row 1: rate must be more than 0"],
  ])("rejects %j", (rows, error) => {
    expect(calculateOldGold(rows as never)).toEqual({ ok: false, error });
  });

  it("a receipt is at most 10 rows", () => {
    const row = { netMg: 1_000, purityBps: 9_160, rateKgPaise: 600_000_000 };
    expect(calculateOldGold(Array.from({ length: 11 }, () => row)).ok).toBe(false);
    expect(calculateOldGold(Array.from({ length: 10 }, () => row)).ok).toBe(true);
  });
});
