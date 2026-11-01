import { describe, expect, it } from "vitest";
import { copyOrder, formatRoundOffPrint, formatWeightPrint, metalLine, paginate } from "./print";

describe("formatWeightPrint (spec 014 R5)", () => {
  it.each([
    [12_020, "12.02"],
    [9_800, "9.80"],
    [12_345, "12.345"],
    [1_202, "1.202"],
    [1_000, "1.00"],
    [0, "0.00"],
    [1, "0.001"],
    [100, "0.10"],
  ])("%i mg -> %s g", (mg, text) => {
    expect(formatWeightPrint(mg)).toBe(text);
  });
  it("rejects fractions and negatives", () => {
    expect(() => formatWeightPrint(1.5)).toThrow(RangeError);
    expect(() => formatWeightPrint(-1)).toThrow(RangeError);
  });
});

describe("round-off and metal line", () => {
  it.each([
    [30, "+ ₹ 0.30"],
    [-6, "- ₹ 0.06"],
    [0, "₹ 0.00"],
    [-29, "- ₹ 0.29"],
  ])("%i paise prints as %s", (paise, text) => {
    expect(formatRoundOffPrint(paise)).toBe(text);
  });
  it("metal line from purity and HSN", () => {
    expect(metalLine("22K916", "7113")).toBe("Gold");
    expect(metalLine("silver", "7113")).toBe("Silver");
    expect(metalLine("22K916", "9988")).toBe("Job work");
  });
});

describe("paginate (spec 014 R7)", () => {
  it("splits 15 rows as 14 and 1, 28 as 14 and 14, empty as one page", () => {
    expect(paginate(Array.from({ length: 15 }, (_, i) => i)).map((p) => p.length)).toEqual([14, 1]);
    expect(paginate(Array.from({ length: 28 }, (_, i) => i)).map((p) => p.length)).toEqual([14, 14]);
    expect(paginate([])).toEqual([[]]);
  });
});

describe("copyOrder (spec 014 R8)", () => {
  it("both prints shop then customer", () => {
    expect(copyOrder(["SHOP COPY", "CUSTOMER COPY"], "both")).toEqual(["SHOP COPY", "CUSTOMER COPY"]);
    expect(copyOrder(["SHOP COPY", "CUSTOMER COPY"], "second")).toEqual(["CUSTOMER COPY"]);
  });
});
