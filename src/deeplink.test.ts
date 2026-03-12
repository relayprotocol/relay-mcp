import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock relay-api before importing deeplink
vi.mock("./relay-api.js", () => ({
  getChains: vi.fn(),
}));

import { buildRelayAppUrl } from "./deeplink.js";
import { getChains } from "./relay-api.js";

const MOCK_CHAINS = {
  chains: [
    { id: 1, name: "Ethereum" },
    { id: 8453, name: "Base" },
    { id: 10, name: "OP Mainnet" },
    { id: 42161, name: "Arbitrum" },
  ],
};

beforeEach(() => {
  vi.mocked(getChains).mockResolvedValue(MOCK_CHAINS as any);
});

describe("buildRelayAppUrl", () => {
  it("builds URL with chain name slug for destination", async () => {
    const url = await buildRelayAppUrl({ destinationChainId: 8453 });
    expect(url).toBe("https://relay.link/bridge/base");
  });

  it("lowercases and hyphenates multi-word chain names", async () => {
    const url = await buildRelayAppUrl({ destinationChainId: 10 });
    expect(url).toBe("https://relay.link/bridge/op-mainnet");
  });

  it("returns null for unknown chain ID", async () => {
    const url = await buildRelayAppUrl({ destinationChainId: 999999 });
    expect(url).toBeNull();
  });

  it("includes fromChainId as query param", async () => {
    const url = await buildRelayAppUrl({
      destinationChainId: 8453,
      fromChainId: 1,
    });
    expect(url).toContain("fromChainId=1");
  });

  it("includes fromCurrency as query param", async () => {
    const url = await buildRelayAppUrl({
      destinationChainId: 8453,
      fromCurrency: "0x0000000000000000000000000000000000000000",
    });
    expect(url).toContain("fromCurrency=0x0000000000000000000000000000000000000000");
  });

  it("includes toCurrency as query param", async () => {
    const url = await buildRelayAppUrl({
      destinationChainId: 8453,
      toCurrency: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    });
    expect(url).toContain("toCurrency=");
  });

  it("includes amount as query param", async () => {
    const url = await buildRelayAppUrl({
      destinationChainId: 8453,
      amount: "1.5",
    });
    expect(url).toContain("amount=1.5");
  });

  it("includes toAddress as query param", async () => {
    const url = await buildRelayAppUrl({
      destinationChainId: 8453,
      toAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    expect(url).toContain("toAddress=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  });

  it("includes tradeType as query param", async () => {
    const url = await buildRelayAppUrl({
      destinationChainId: 8453,
      tradeType: "EXACT_INPUT",
    });
    expect(url).toContain("tradeType=EXACT_INPUT");
  });

  it("builds URL with all params combined", async () => {
    const url = await buildRelayAppUrl({
      destinationChainId: 8453,
      fromChainId: 1,
      fromCurrency: "0x0000000000000000000000000000000000000000",
      toCurrency: "0x0000000000000000000000000000000000000000",
      amount: "1.0",
      toAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.pathname).toBe("/bridge/base");
    expect(parsed.searchParams.get("fromChainId")).toBe("1");
    expect(parsed.searchParams.get("amount")).toBe("1.0");
    expect(parsed.searchParams.get("toAddress")).toBe(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    );
  });

  it("omits optional params when not provided", async () => {
    const url = await buildRelayAppUrl({ destinationChainId: 1 });
    expect(url).toBe("https://relay.link/bridge/ethereum");
    // No query params at all
    expect(url).not.toContain("?");
  });
});
