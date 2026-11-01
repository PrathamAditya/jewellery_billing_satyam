import { describe, expect, it } from "vitest";
import { indiaDate } from "./dates";

describe("indiaDate", () => {
  it.each([
    ["2026-03-31T18:29:59Z", "2026-03-31"], // 23:59:59 in India
    ["2026-03-31T18:30:00Z", "2026-04-01"], // midnight in India
    ["2026-03-31T20:00:00Z", "2026-04-01"],
    ["2026-12-31T12:00:00Z", "2026-12-31"],
  ])("%s -> %s", (iso, expected) => {
    expect(indiaDate(new Date(iso))).toBe(expected);
  });
});
