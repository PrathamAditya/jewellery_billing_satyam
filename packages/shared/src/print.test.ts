import { describe, expect, it } from "vitest";
import { copyOrder, formatRoundOffPrint, formatWeightPrint, metalLine, paginate, paginateByUnits, rowUnits } from "./print";

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

describe("rowUnits and paginateByUnits (feedback point 8)", () => {
  it("a one-line description is 1 unit, longer or multi-line ones are more", () => {
    expect(rowUnits("Gold Chain")).toBe(1);
    expect(rowUnits("")).toBe(1);
    expect(rowUnits("Gold Bangle\nwith stone work")).toBe(1.5);
    expect(rowUnits("x".repeat(100))).toBe(2.5); // 4 lines of 26 characters
    expect(rowUnits("a\nb\nc\nd\ne\nf\ng\nh\ni\nj")).toBe(4.5); // capped at 8 lines
  });

  const rows = Array.from({ length: 20 }, (_, i) => i + 1);
  const one = () => 1;
  it("keeps every row, in order, whatever the caps", () => {
    for (const [c, l] of [[14, 9], [5, 3], [1, 1], [30, 30]] as const) {
      expect(paginateByUnits(rows, one, c, l).flat()).toEqual(rows);
    }
  });
  it("no page holds more than its cap (the last page is held to the smaller one)", () => {
    const pages = paginateByUnits(rows, one, 12, 7);
    pages.slice(0, -1).forEach((p) => expect(p.length).toBeLessThanOrEqual(12));
    expect(pages[pages.length - 1]!.length).toBeLessThanOrEqual(7);
  });
  it("20 one-line rows with caps 12 and 7 are 12 + 1 + 7: the last page carries only what the totals leave room for", () => {
    expect(paginateByUnits(rows, one, 12, 7).map((p) => p.length)).toEqual([12, 1, 7]);
  });
  it("a few rows stay on one page", () => {
    expect(paginateByUnits([1, 2, 3], one, 12, 7)).toEqual([[1, 2, 3]]);
  });
  it("tall rows count for more: three 3-unit rows (9 units) do not fit a 7-unit last page, so one moves to the page before", () => {
    expect(paginateByUnits([1, 2, 3], () => 3, 12, 7)).toEqual([[1], [2, 3]]);
  });
  it("one row too tall for the last page still gets a page of its own, never lost", () => {
    expect(paginateByUnits([1], () => 99, 12, 7)).toEqual([[1]]);
  });
  it("no rows is one empty page, like paginate", () => {
    expect(paginateByUnits([], one, 12, 7)).toEqual([[]]);
  });
});
