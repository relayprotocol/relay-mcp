/**
 * Integration smoke tests against the live Relay API.
 *
 * These tests make REAL HTTP requests. They verify that:
 * 1. The relay-api.ts functions work against the real API
 * 2. Chain resolver works with real chain data
 * 3. Deeplink builder works with real chain names
 * 4. The full tool pipeline (validation → resolve → API → format) works end-to-end
 *
 * Skipped in CI. Run manually with:
 *   npx vitest run src/integration.test.ts
 */

import { describe, it, expect } from "vitest";
import { getChains, getCurrencies, getQuote, getRequests } from "./relay-api.js";
import { resolveChainId } from "./utils/chain-resolver.js";
import { buildRelayAppUrl } from "./deeplink.js";

// Use a well-known address for read-only queries
const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

describe("Relay API - live smoke tests", () => {
  // ─── /chains ────────────────────────────────────────────────────

  it("GET /chains returns a non-empty list of chains", async () => {
    const { chains } = await getChains();
    expect(chains.length).toBeGreaterThan(0);

    const ethereum = chains.find((c) => c.id === 1);
    expect(ethereum).toBeDefined();
    expect(ethereum!.name.toLowerCase()).toContain("ethereum");

    const base = chains.find((c) => c.id === 8453);
    expect(base).toBeDefined();
  });

  it("each chain has required fields", async () => {
    const { chains } = await getChains();
    for (const chain of chains.slice(0, 5)) {
      expect(chain.id).toBeTypeOf("number");
      expect(chain.name).toBeTypeOf("string");
      expect(chain.displayName).toBeTypeOf("string");
      expect(chain.vmType).toBeTypeOf("string");
      expect(chain.currency).toBeDefined();
      expect(chain.currency.symbol).toBeTypeOf("string");
    }
  });

  // ─── Chain resolver with real data ──────────────────────────────

  it("resolveChainId('ethereum') → 1", async () => {
    expect(await resolveChainId("ethereum")).toBe(1);
  });

  it("resolveChainId('base') → 8453", async () => {
    expect(await resolveChainId("base")).toBe(8453);
  });

  it("resolveChainId('eth') → 1 (alias)", async () => {
    expect(await resolveChainId("eth")).toBe(1);
  });

  it("resolveChainId('arb') → 42161 (alias)", async () => {
    expect(await resolveChainId("arb")).toBe(42161);
  });

  it("resolveChainId(8453) → 8453 (passthrough)", async () => {
    expect(await resolveChainId(8453)).toBe(8453);
  });

  it("resolveChainId('fakechain') throws with suggestions", async () => {
    await expect(resolveChainId("fakechain")).rejects.toThrow(/unknown chain/i);
  });

  // ─── /currencies/v1 ─────────────────────────────────────────────

  it("POST /currencies/v1 returns tokens for Ethereum", async () => {
    const result = await getCurrencies({ chainIds: [1], limit: 5 });
    expect(result.length).toBeGreaterThan(0);
    // First group is chain 1 results
    expect(result[0].length).toBeGreaterThan(0);
    expect(result[0][0].chainId).toBe(1);
    expect(result[0][0].symbol).toBeTypeOf("string");
  });

  it("POST /currencies/v1 can search by term", async () => {
    const result = await getCurrencies({ chainIds: [1], term: "USDC", limit: 5 });
    expect(result.length).toBeGreaterThan(0);
    const usdcFound = result[0].some((c) => c.symbol === "USDC");
    expect(usdcFound).toBe(true);
  });

  // ─── /quote/v2 ──────────────────────────────────────────────────

  it("POST /quote/v2 returns a valid bridge quote (ETH Ethereum→Base)", async () => {
    const quote = await getQuote({
      user: VITALIK,
      originChainId: 1,
      destinationChainId: 8453,
      originCurrency: ZERO_ADDR,
      destinationCurrency: ZERO_ADDR,
      amount: "10000000000000000", // 0.01 ETH
      tradeType: "EXACT_INPUT",
    });

    // Verify structure
    expect(quote.details).toBeDefined();
    expect(quote.fees).toBeDefined();
    expect(quote.details.currencyIn.amountFormatted).toBeTypeOf("string");
    expect(quote.details.currencyOut.amountFormatted).toBeTypeOf("string");
    expect(quote.details.timeEstimate).toBeTypeOf("number");
    expect(quote.fees.gas.amountUsd).toBeTypeOf("string");
    expect(quote.fees.relayer.amountUsd).toBeTypeOf("string");

    // Sanity: output should be > 0
    expect(parseFloat(quote.details.currencyOut.amountFormatted)).toBeGreaterThan(0);
  });

  // ─── /requests ──────────────────────────────────────────────────

  it("GET /requests returns (possibly empty) result for Vitalik", async () => {
    const result = await getRequests(VITALIK, 5);
    expect(result).toBeDefined();
    expect(Array.isArray(result.requests)).toBe(true);
    // We can't guarantee Vitalik has Relay transactions, but the API should not error
  });

  // ─── Deeplink builder with real chain data ──────────────────────

  it("builds deeplink URL for Base", async () => {
    const url = await buildRelayAppUrl({
      destinationChainId: 8453,
      fromChainId: 1,
      fromCurrency: ZERO_ADDR,
      toCurrency: ZERO_ADDR,
      amount: "0.01",
    });

    expect(url).not.toBeNull();
    expect(url).toContain("relay.link/bridge/");
    expect(url).toContain("fromChainId=1");
  });

  it("returns null for nonexistent chain", async () => {
    const url = await buildRelayAppUrl({ destinationChainId: 999999999 });
    expect(url).toBeNull();
  });
});
