import { describe, expect, it } from "vitest";
import {
  cleanAadhaar,
  cleanMobile,
  cleanName,
  cleanPan,
  createCustomerSchema,
  formatCustomerNumber,
  maskAadhaar,
  updateCustomerSchema,
} from "./customer";

describe("cleanMobile (spec 010 R3)", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["+91 98765-43210", "9876543210"],
    ["098765 43210", "9876543210"],
    ["919876543210", "9876543210"],
    ["(98765) 43210", "9876543210"],
    ["1234567890", "1234567890"],
    ["9123456789", "9123456789"], // a 10-digit number that starts with 91 is kept whole
    ["98765", null],
    ["98765432100", null],
    ["98765abc10", null],
    ["", null],
  ])("%j -> %j", (input, expected) => {
    expect(cleanMobile(input)).toBe(expected);
  });
});

describe("other cleaners (R3, R4)", () => {
  it("name: trims and collapses spaces, keeps case", () => {
    expect(cleanName("  Ramesh   Kumar \n")).toBe("Ramesh Kumar");
  });
  it("PAN: uppercases and validates", () => {
    expect(cleanPan("abcde1234f")).toBe("ABCDE1234F");
    expect(cleanPan("ABCDE12345")).toBeNull();
    expect(cleanPan("ABCD1234F")).toBeNull();
  });
  it("Aadhaar: 12 digits, spaces allowed, masked on output", () => {
    expect(cleanAadhaar("1234 5678 9012")).toBe("123456789012");
    expect(cleanAadhaar("1234 5678 901")).toBeNull();
    expect(maskAadhaar("123456789012")).toBe("XXXX XXXX 9012");
  });
  it("customer number pads to 4 digits and grows", () => {
    expect(formatCustomerNumber(1)).toBe("C0001");
    expect(formatCustomerNumber(12345)).toBe("C12345");
    expect(() => formatCustomerNumber(0)).toThrow(RangeError);
  });
});

describe("createCustomerSchema (R1, R3, R4)", () => {
  it("only the name is required; blanks become null", () => {
    const r = createCustomerSchema.parse({ name: "  ramesh   kumar ", mobile: "", pan: "  ", address: "" });
    expect(r).toMatchObject({ name: "ramesh kumar", mobile: null, pan: null, address: null, aadhaar: null });
  });

  it("cleans every field", () => {
    const r = createCustomerSchema.parse({
      name: "Asha",
      mobile: "+91 98765-43210",
      altMobile: "098765 43211",
      pan: "abcde1234f",
      aadhaar: "1234 5678 9012",
      pincode: "143 001",
    });
    expect(r).toMatchObject({ mobile: "9876543210", altMobile: "9876543211", pan: "ABCDE1234F", aadhaar: "123456789012", pincode: "143001" });
  });

  it("reports a clear message per bad field", () => {
    const r = createCustomerSchema.safeParse({ name: "A", mobile: "98765", pan: "ABCDE12345", aadhaar: "1", pincode: "12" });
    expect(r.success).toBe(false);
    const byField = Object.fromEntries(r.error!.issues.map((i) => [String(i.path[0]), i.message]));
    expect(byField).toEqual({
      name: "Name must be 2 to 100 characters",
      mobile: "Mobile must be 10 digits",
      pan: "PAN must look like ABCDE1234F",
      aadhaar: "Aadhaar must be 12 digits",
      pincode: "PIN code must be 6 digits",
    });
  });

  it("missing name and over-long name are rejected", () => {
    expect(createCustomerSchema.safeParse({}).success).toBe(false);
    expect(createCustomerSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
  });

  it("a client id must be a UUID", () => {
    expect(createCustomerSchema.safeParse({ id: "nope", name: "Asha" }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ id: "01a19634-c496-7000-88d6-820592c037a6", name: "Asha" }).success).toBe(true);
  });
});

describe("updateCustomerSchema", () => {
  it("only sent fields appear in the output", () => {
    const r = updateCustomerSchema.parse({ address: " 12 Mall Road " });
    expect(r).toEqual({ address: "12 Mall Road" });
  });
  it("blank clears an optional field, but a name cannot be cleared", () => {
    expect(updateCustomerSchema.parse({ mobile: "" })).toEqual({ mobile: null });
    expect(updateCustomerSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
