import { describe, expect, it } from "vitest";
import { amountInWords } from "./words";

describe("amountInWords (spec 015 R13), using the owner's receipts", () => {
  it.each([
    [20_632_300, "Rupees Two Lakh Six Thousand Three Hundred Twenty Three Only."],
    [1_450_000, "Rupees Fourteen Thousand Five Hundred Only."],
    [25_596_200, "Rupees Two Lakh Fifty Five Thousand Nine Hundred Sixty Two Only."],
    [0, "Rupees Zero Only."],
    [100, "Rupees One Only."],
    [10_000, "Rupees One Hundred Only."],
    [15_000, "Rupees One Hundred Fifty Only."],
    [150, "Rupees One and Fifty Paise Only."],
    [1, "Rupees Zero and One Paise Only."],
    [1_000_000_000, "Rupees One Crore Only."],
    [1_234_567_890, "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Paise Only."],
    [1234567890_00, "Rupees One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred Ninety Only."],
  ])("%i paise -> %s", (paise, words) => {
    expect(amountInWords(paise)).toBe(words);
  });

  it("rejects negative and fractional input", () => {
    expect(() => amountInWords(-1)).toThrow(RangeError);
    expect(() => amountInWords(1.5)).toThrow(RangeError);
  });
});
