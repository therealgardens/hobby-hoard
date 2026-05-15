import { describe, it, expect } from "vitest";
import { canonicalKey, parseCode } from "@/lib/printings";

// Mini-fixture che modella casi reali One Piece visti nel DB.
const ONEPIECE_FIXTURES = [
  { code: "OP01-001", rarity: "L", expectedVariant: "base", expectedSet: "OP01" },
  { code: "OP01-001_p1", rarity: "L", expectedVariant: "parallel", expectedSet: "OP01" },
  { code: "OP10-061_p2", rarity: "C", expectedVariant: "parallel", expectedSet: "OP10" },
  { code: "ST01-012", rarity: "C", expectedVariant: "base", expectedSet: "ST01" },
  { code: "EB01-006", rarity: "SR", expectedVariant: "base", expectedSet: "EB01" },
  { code: "OP07-119", rarity: "AA", expectedVariant: "alt_art", expectedSet: "OP07" },
  { code: "PRB01-001", rarity: "PR", expectedVariant: "promo", expectedSet: "PRB01" },
];

describe("One Piece printings — fixture realistica", () => {
  it.each(ONEPIECE_FIXTURES)("%o → set %s, variant %s", ({ code, rarity, expectedVariant, expectedSet }) => {
    const parsed = parseCode(code, rarity);
    expect(parsed.setCode).toBe(expectedSet);
    expect(parsed.variantType).toBe(expectedVariant);
  });

  it("base e parallel della stessa carta condividono canonicalKey", () => {
    expect(canonicalKey("OP01-001")).toBe(canonicalKey("OP01-001_p1"));
    expect(canonicalKey("OP01-001")).toBe(canonicalKey("OP01-001_p2"));
  });

  it("set diversi non collidono", () => {
    expect(canonicalKey("OP01-001")).not.toBe(canonicalKey("OP02-001"));
    expect(canonicalKey("ST01-001")).not.toBe(canonicalKey("OP01-001"));
  });
});
