import { describe, it, expect } from "vitest";
import {
  validateAddress,
  validateRequestId,
  validateAmount,
  validateTxHash,
  validationError,
  validateAddresses,
} from "./validators.js";

// ─── validateAddress ──────────────────────────────────────────────

describe("validateAddress", () => {
  const VALID = "0x0000000000000000000000000000000000000000";
  const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  it("accepts a valid zero address", () => {
    expect(validateAddress(VALID)).toBeNull();
  });

  it("accepts a valid checksummed address", () => {
    expect(validateAddress(VITALIK)).toBeNull();
  });

  it("accepts lowercase hex", () => {
    expect(validateAddress(VITALIK.toLowerCase())).toBeNull();
  });

  // Solana addresses
  it("accepts a Solana base58 address", () => {
    expect(validateAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBeNull();
  });

  it("accepts a Solana mint address", () => {
    expect(validateAddress("JAmWYLiv3pGnNz63UTSKSEmJG4pdvvTLCZUcmpSLJA4Q")).toBeNull();
  });

  // Bitcoin addresses
  it("accepts a Bitcoin bech32 address", () => {
    expect(validateAddress("bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8")).toBeNull();
  });

  it("accepts a Bitcoin legacy address", () => {
    expect(validateAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBeNull();
  });

  // Tron addresses
  it("accepts a Tron address", () => {
    expect(validateAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBeNull();
  });

  // Invalid addresses
  it("rejects too-short address", () => {
    const err = validateAddress("0x1234");
    expect(err).not.toBeNull();
    expect(err!.message).toContain("Invalid address format");
  });

  it("rejects too-long address", () => {
    const err = validateAddress("0x" + "a".repeat(41));
    expect(err).not.toBeNull();
    expect(err!.message).toContain("Invalid address format");
  });

  it("rejects non-hex characters in EVM address", () => {
    const err = validateAddress("0xZZZZ000000000000000000000000000000000000");
    expect(err).not.toBeNull();
    expect(err!.message).toContain("Invalid address format");
  });

  it("uses custom param name in error", () => {
    const err = validateAddress("bad", "sender");
    expect(err!.param).toBe("sender");
  });

  it("rejects empty string", () => {
    const err = validateAddress("");
    expect(err).not.toBeNull();
  });
});

// ─── validateRequestId ────────────────────────────────────────────

describe("validateRequestId", () => {
  const VALID = "0x" + "a".repeat(64);

  it("accepts valid 66-char request ID", () => {
    expect(validateRequestId(VALID)).toBeNull();
  });

  it("accepts uppercase hex", () => {
    expect(validateRequestId("0x" + "A".repeat(64))).toBeNull();
  });

  it("accepts mixed case hex", () => {
    expect(validateRequestId("0x" + "aAbBcC".repeat(10) + "aAbB")).toBeNull();
  });

  it("rejects without 0x prefix", () => {
    const err = validateRequestId("a".repeat(64));
    expect(err).not.toBeNull();
    expect(err!.message).toContain("start with 0x");
  });

  it("rejects wrong length", () => {
    const err = validateRequestId("0x" + "a".repeat(32));
    expect(err).not.toBeNull();
    expect(err!.message).toContain("66 characters");
  });

  it("rejects non-hex chars", () => {
    const err = validateRequestId("0x" + "g".repeat(64));
    expect(err).not.toBeNull();
    expect(err!.message).toContain("invalid hex");
  });
});

// ─── validateAmount ───────────────────────────────────────────────

describe("validateAmount", () => {
  it("accepts '0'", () => {
    expect(validateAmount("0")).toBeNull();
  });

  it("accepts a large wei value", () => {
    expect(validateAmount("1000000000000000000")).toBeNull();
  });

  it("rejects negative numbers", () => {
    const err = validateAmount("-100");
    expect(err).not.toBeNull();
    expect(err!.message).toContain("numeric string");
  });

  it("rejects decimals", () => {
    const err = validateAmount("1.5");
    expect(err).not.toBeNull();
  });

  it("rejects letters", () => {
    const err = validateAmount("abc");
    expect(err).not.toBeNull();
  });

  it("rejects empty string", () => {
    const err = validateAmount("");
    expect(err).not.toBeNull();
  });

  it("rejects whitespace", () => {
    const err = validateAmount(" 100 ");
    expect(err).not.toBeNull();
  });

  it("uses custom param name", () => {
    const err = validateAmount("x", "myAmount");
    expect(err!.param).toBe("myAmount");
  });
});

// ─── validateTxHash ───────────────────────────────────────────────

describe("validateTxHash", () => {
  const VALID = "0x" + "a".repeat(64);

  it("accepts valid tx hash", () => {
    expect(validateTxHash(VALID)).toBeNull();
  });

  it("accepts Bitcoin tx hash (64 hex without 0x)", () => {
    expect(validateTxHash("a".repeat(64))).toBeNull();
  });

  it("accepts Solana tx signature (base58)", () => {
    expect(validateTxHash("5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQU")).toBeNull();
  });

  it("rejects wrong length hex", () => {
    const err = validateTxHash("0x" + "a".repeat(10));
    expect(err).not.toBeNull();
    expect(err!.message).toContain("Invalid transaction hash");
  });

  it("rejects non-hex chars", () => {
    const err = validateTxHash("0x" + "z".repeat(64));
    expect(err).not.toBeNull();
  });
});

// ─── validationError (MCP response helper) ────────────────────────

describe("validationError", () => {
  it("wraps a ValidationError into MCP error response", () => {
    const result = validationError({
      param: "sender",
      value: "bad",
      message: "Address must start with 0x",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Validation error");
    expect(result.content[0].text).toContain("Address must start with 0x");
  });
});

// ─── validateAddresses (batch helper) ─────────────────────────────

describe("validateAddresses", () => {
  const VALID = "0x0000000000000000000000000000000000000000";

  it("returns null when all addresses are valid", () => {
    expect(
      validateAddresses([VALID, "sender"], [VALID, "recipient"])
    ).toBeNull();
  });

  it("returns error on first invalid address", () => {
    const result = validateAddresses(
      [VALID, "sender"],
      ["bad", "recipient"],
      [VALID, "currency"]
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBe(true);
    expect(result!.content[0].text).toContain("recipient");
  });

  it("returns error when first address is invalid", () => {
    const result = validateAddresses(["not-an-address", "sender"]);
    expect(result).not.toBeNull();
    expect(result!.content[0].text).toContain("sender");
  });

  it("works with a single pair", () => {
    expect(validateAddresses([VALID, "only"])).toBeNull();
  });
});
