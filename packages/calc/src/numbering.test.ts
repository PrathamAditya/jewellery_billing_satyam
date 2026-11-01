import { describe, expect, it } from "vitest";
import { financialYearOf, formatDocumentNumber } from "./numbering";

describe("financialYearOf", () => {
  it.each([
    ["2026-03-31", "2025-26"],
    ["2026-04-01", "2026-27"],
    ["2027-03-31", "2026-27"],
    ["2027-04-01", "2027-28"],
    ["2099-04-01", "2099-00"],
  ])("%s -> %s", (date, fy) => {
    expect(financialYearOf(date)).toBe(fy);
  });

  it.each(["2026-02-30", "abc", "2026-4-1", "2026-13-01", ""])("throws for %j", (date) => {
    expect(() => financialYearOf(date)).toThrow(RangeError);
  });
});

describe("formatDocumentNumber", () => {
  it.each([
    [1, "INV-0001"],
    [42, "INV-0042"],
    [9999, "INV-9999"],
    [10000, "INV-10000"],
  ])("%i -> %s", (n, expected) => {
    expect(formatDocumentNumber("INV", "2026-27", n)).toBe(expected);
  });

  it("adds the financial year only when fyInNumber is on (spec 003 R6)", () => {
    expect(formatDocumentNumber("INV", "2026-27", 2, true)).toBe("INV-2026-27-0002");
    expect(formatDocumentNumber("PAY", "2026-27", 1)).toBe("PAY-0001");
    expect(formatDocumentNumber("OGP", "2026-27", 1)).toBe("OGP-0001");
  });

  it.each([0, -1, 1.5, Number.NaN])("throws for %s", (n) => {
    expect(() => formatDocumentNumber("INV", "2026-27", n)).toThrow(RangeError);
  });
});
