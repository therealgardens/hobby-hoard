import { describe, it, expect } from "vitest";
import { extractSetCode, classifyVariant, parseCode, canonicalKey, printingKey } from "@/lib/printings";

describe("extractSetCode", () => {
  it.each([
    ["OP01-001", "OP01"],
    ["op01-001", "OP01"],
    ["OP10-061_p1", "OP10"],
    ["EB01-001", "EB01"],
    ["ST01-001", "ST01"],
    ["P-001", null], // non valido (manca prefisso lettere+numero)
    ["", null],
    [null, null],
    [undefined, null],
  ])("extractSetCode(%s) = %s", (input, expected) => {
    expect(extractSetCode(input as string | null)).toBe(expected);
  });
});

describe("classifyVariant", () => {
  it("riconosce parallel da suffisso _p1", () => {
    expect(classifyVariant("OP01-001_p1")).toBe("parallel");
    expect(classifyVariant("OP01-001_p2")).toBe("parallel");
  });
  it("riconosce alt_art da rarity AA", () => {
    expect(classifyVariant("OP01-001", "AA")).toBe("alt_art");
    expect(classifyVariant("OP01-001", "alternate art")).toBe("alt_art");
  });
  it("riconosce promo / secret", () => {
    expect(classifyVariant("OP01-001", "Promo")).toBe("promo");
    expect(classifyVariant("OP01-001", "SEC")).toBe("secret");
  });
  it("default = base", () => {
    expect(classifyVariant("OP01-001", "C")).toBe("base");
    expect(classifyVariant("OP01-001")).toBe("base");
  });
  it("parallel ha priorità sulla rarity", () => {
    expect(classifyVariant("OP01-001_p1", "C")).toBe("parallel");
  });
});

describe("parseCode", () => {
  it("parsa code completo con variante", () => {
    const r = parseCode("OP10-061_p1", "C");
    expect(r).toEqual({
      raw: "OP10-061_p1",
      setCode: "OP10",
      number: "061",
      variantMarker: "p1",
      variantType: "parallel",
    });
  });
  it("parsa code senza variante", () => {
    const r = parseCode("OP01-001");
    expect(r.setCode).toBe("OP01");
    expect(r.number).toBe("001");
    expect(r.variantMarker).toBeNull();
    expect(r.variantType).toBe("base");
  });
  it("gestisce input vuoto senza crash", () => {
    expect(parseCode(null).setCode).toBeNull();
    expect(parseCode("").setCode).toBeNull();
  });
});

describe("canonicalKey / printingKey", () => {
  it("canonicalKey collassa varianti sulla stessa carta", () => {
    expect(canonicalKey("OP10-061")).toBe("OP10-061");
    expect(canonicalKey("OP10-061_p1")).toBe("OP10-061");
    expect(canonicalKey("OP10-061_p2")).toBe("OP10-061");
  });
  it("printingKey distingue varianti", () => {
    expect(printingKey("OP10-061")).toBe("OP10-061");
    expect(printingKey("OP10-061_p1")).toBe("OP10-061_p1");
    expect(printingKey("OP10-061", "AA")).toBe("OP10-061_alt_art");
  });
  it("ritorna null su code malformato", () => {
    expect(canonicalKey("invalid")).toBeNull();
    expect(printingKey("")).toBeNull();
  });
});
