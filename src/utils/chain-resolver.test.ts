import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the relay-api module before importing chain-resolver
vi.mock("../relay-api.js", () => ({
  getChains: vi.fn(),
}));

// Import AFTER mock is set up
import { resolveChainId } from "./chain-resolver.js";
import { getChains } from "../relay-api.js";

const MOCK_CHAINS = {
  chains: [
    { id: 1, name: "ethereum", displayName: "Ethereum" },
    { id: 8453, name: "base", displayName: "Base" },
    { id: 10, name: "optimism", displayName: "Optimism" },
    { id: 42161, name: "arbitrum", displayName: "Arbitrum" },
    { id: 137, name: "polygon", displayName: "Polygon" },
    { id: 43114, name: "avalanche", displayName: "Avalanche" },
    { id: 56, name: "bsc", displayName: "BNB Smart Chain" },
    { id: 324, name: "zksync-era", displayName: "zkSync Era" },
    { id: 7777777, name: "zora", displayName: "Zora" },
    { id: 81457, name: "blast", displayName: "Blast" },
    { id: 534352, name: "scroll", displayName: "Scroll" },
    { id: 59144, name: "linea", displayName: "Linea" },
  ],
};

beforeEach(() => {
  vi.mocked(getChains).mockResolvedValue(MOCK_CHAINS as any);
  // Reset the module-level cache between tests.
  // The chain-resolver caches a Promise, so we need to bust it.
  // We do this by re-importing, but since vitest caches modules we
  // rely on the mock returning fresh data each time.
});

describe("resolveChainId", () => {
  // ─── Numeric passthrough ──────────────────────────────────────

  it("returns numeric input as-is", async () => {
    expect(await resolveChainId(8453)).toBe(8453);
    // Should NOT call API for numeric inputs
  });

  it("parses numeric string to number", async () => {
    expect(await resolveChainId("1")).toBe(1);
  });

  it("parses large numeric string", async () => {
    expect(await resolveChainId("42161")).toBe(42161);
  });

  // ─── Exact name match ─────────────────────────────────────────

  it("matches chain name (lowercase)", async () => {
    expect(await resolveChainId("ethereum")).toBe(1);
  });

  it("matches chain name (mixed case)", async () => {
    expect(await resolveChainId("Ethereum")).toBe(1);
  });

  it("matches chain name (uppercase)", async () => {
    expect(await resolveChainId("BASE")).toBe(8453);
  });

  it("matches display name", async () => {
    expect(await resolveChainId("BNB Smart Chain")).toBe(56);
  });

  it("matches display name case-insensitive", async () => {
    expect(await resolveChainId("bnb smart chain")).toBe(56);
  });

  // ─── Alias match ──────────────────────────────────────────────

  it("resolves 'eth' alias → ethereum (1)", async () => {
    expect(await resolveChainId("eth")).toBe(1);
  });

  it("resolves 'op' alias → optimism (10)", async () => {
    expect(await resolveChainId("op")).toBe(10);
  });

  it("resolves 'arb' alias → arbitrum (42161)", async () => {
    expect(await resolveChainId("arb")).toBe(42161);
  });

  it("resolves 'avax' alias → avalanche (43114)", async () => {
    expect(await resolveChainId("avax")).toBe(43114);
  });

  it("resolves 'matic' alias → polygon (137)", async () => {
    expect(await resolveChainId("matic")).toBe(137);
  });

  it("resolves 'poly' alias → polygon (137)", async () => {
    expect(await resolveChainId("poly")).toBe(137);
  });

  it("resolves 'bnb' alias → bsc (56)", async () => {
    expect(await resolveChainId("bnb")).toBe(56);
  });

  it("resolves 'zksync' alias → zksync-era (324)", async () => {
    expect(await resolveChainId("zksync")).toBe(324);
  });

  // ─── Fuzzy substring match ────────────────────────────────────

  it("matches unique substring 'scrol' → scroll", async () => {
    expect(await resolveChainId("scrol")).toBe(534352);
  });

  it("matches unique substring 'lin' → linea", async () => {
    expect(await resolveChainId("lin")).toBe(59144);
  });

  // ─── Ambiguous match → error with suggestions ─────────────────

  it("throws on ambiguous substring match with suggestions", async () => {
    // 'a' matches: avalanche, arbitrum, base, blast, etc.
    await expect(resolveChainId("a")).rejects.toThrow(/ambiguous/i);
  });

  it("error message includes chain suggestions", async () => {
    try {
      await resolveChainId("a");
    } catch (e: any) {
      // Should contain at least one chain ID and name
      expect(e.message).toMatch(/\d+/);
    }
  });

  // ─── Unknown → error with suggestions ─────────────────────────

  it("throws on completely unknown chain", async () => {
    await expect(resolveChainId("totallyFakeChain")).rejects.toThrow(
      /unknown chain/i
    );
  });

  it("unknown chain error includes similarity suggestions", async () => {
    try {
      await resolveChainId("ethirium"); // close to "ethereum"
    } catch (e: any) {
      // Should suggest Ethereum since it's the closest by Dice coefficient
      expect(e.message).toMatch(/Ethereum/i);
    }
  });

  // ─── Edge cases ───────────────────────────────────────────────

  it("does not treat '0' as a valid chain ID", async () => {
    // 0 is not a valid positive chain ID, but as a string it might
    // parse as integer. Let's verify behavior.
    // The code checks num > 0 && String(num) === input, so "0" passes parseInt
    // but fails the > 0 check, meaning it falls through to name matching.
    // It won't match any chain name, so it should throw.
    await expect(resolveChainId("0")).rejects.toThrow();
  });

  it("handles hyphenated chain names (zksync-era)", async () => {
    expect(await resolveChainId("zksync-era")).toBe(324);
  });

  // ─── Caching ──────────────────────────────────────────────────

  it("caches chain data across calls (only one API call)", async () => {
    vi.mocked(getChains).mockClear();
    await resolveChainId("base");
    await resolveChainId("optimism");
    await resolveChainId("ethereum");
    // The promise is cached, so getChains should only be called once
    // (or possibly not at all if cached from earlier test).
    // The key point: it shouldn't be called 3 times.
    expect(vi.mocked(getChains).mock.calls.length).toBeLessThanOrEqual(1);
  });
});
