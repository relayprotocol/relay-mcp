import { describe, it, expect, vi, afterEach } from "vitest";
import { getCurrencies } from "./relay-api.js";

describe("getCurrencies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the request to /currencies/v2 and returns the flat list", async () => {
    const entries = [
      { chainId: 1, address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", name: "USD Coin", decimals: 6, vmType: "evm" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(entries), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getCurrencies({ chainIds: [1], term: "USDC", limit: 5 });

    expect(result).toEqual(entries);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/currencies\/v2$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ chainIds: [1], term: "USDC", limit: 5 });
  });
});
