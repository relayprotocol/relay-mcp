import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Relay currencies API so resolution is deterministic and offline.
vi.mock("../relay-api.js", () => ({
  getCurrencies: vi.fn(),
}));

import { resolveTokenAddress } from "./token-resolver.js";
import { getCurrencies } from "../relay-api.js";

const mockGetCurrencies = vi.mocked(getCurrencies);

const NATIVE_EVM = "0x0000000000000000000000000000000000000000";
// Binance-Peg Ethereum Token (ERC-20) on BNB Smart Chain (chainId 56).
const BSC_ETH_ERC20 = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8";

beforeEach(() => {
  mockGetCurrencies.mockReset();
});

describe("resolveTokenAddress — pass-through of real addresses", () => {
  it("passes a full 40-hex EVM address through unchanged", async () => {
    const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    await expect(resolveTokenAddress(usdc, 1)).resolves.toBe(usdc);
    expect(mockGetCurrencies).not.toHaveBeenCalled();
  });
});

describe("resolveTokenAddress — hardcoded stablecoins", () => {
  it("resolves USDC on Ethereum mainnet to the canonical address", async () => {
    await expect(resolveTokenAddress("USDC", 1)).resolves.toBe(
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    );
  });
});

describe("resolveTokenAddress — native gas token", () => {
  it("resolves ETH to the native sentinel on an ETH-native chain (mainnet)", async () => {
    await expect(resolveTokenAddress("ETH", 1)).resolves.toBe(NATIVE_EVM);
  });
});

// ─── RED #1: chain-blind native resolution ──────────────────────────────────
// On BNB Smart Chain (56) the native gas token is BNB; "ETH" is a *bridged
// ERC-20*, not native. Resolving "ETH" to the native sentinel routes a swap to
// the wrong asset. This MUST fall through to real ERC-20 resolution.
describe("resolveTokenAddress — RED: non-ETH-native chains", () => {
  it("does NOT resolve ETH to the native sentinel on BSC (56)", async () => {
    mockGetCurrencies.mockResolvedValue([
      { symbol: "ETH", address: BSC_ETH_ERC20, chainId: 56 } as never,
    ]);
    const resolved = await resolveTokenAddress("ETH", 56);
    expect(resolved).not.toBe(NATIVE_EVM);
    expect(resolved).toBe(BSC_ETH_ERC20);
  });

  it("still resolves the chain's real native symbol (BNB on 56) to native", async () => {
    await expect(resolveTokenAddress("BNB", 56)).resolves.toBe(NATIVE_EVM);
  });
});

// ─── RED #2: unbounded EVM hex regex ────────────────────────────────────────
// looksLikeAddress uses /^0x[0-9a-fA-F]{8,}$/ (no upper bound), so a 0x string
// with 70 hex chars is treated as a valid address and passed straight through
// to the swap/bridge API. validators.validateAddress caps at {1,64}; align.
describe("resolveTokenAddress — RED: over-long 0x value is not an address", () => {
  it("does not pass through a 0x value longer than 64 hex chars", async () => {
    const tooLong = "0x" + "a".repeat(70);
    mockGetCurrencies.mockRejectedValue(new Error("not found"));
    await expect(resolveTokenAddress(tooLong, 1)).rejects.toThrow();
  });
});
