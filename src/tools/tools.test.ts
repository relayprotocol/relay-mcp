/**
 * Integration-style tests for MCP tool handlers.
 *
 * Strategy: Mock relay-api and chain-resolver to test the handler logic
 * (validation, error handling, response shaping) without hitting the network.
 * We register tools on a real McpServer and invoke them through the internal API.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock("../relay-api.js", () => ({
  getChains: vi.fn(),
  getQuote: vi.fn(),
  getIntentStatus: vi.fn(),
  getRequestByHash: vi.fn(),
  getRequests: vi.fn(),
  getOpenApiSpec: vi.fn(),
  getCurrencies: vi.fn(),
  // v0.3.0 API functions
  getChainHealth: vi.fn(),
  getChainLiquidity: vi.fn(),
  getRouteConfig: vi.fn(),
  getTokenPrice: vi.fn(),
  getTokenDetails: vi.fn(),
  getTokenChart: vi.fn(),
  getTrendingTokens: vi.fn(),
  getSwapSources: vi.fn(),
  getAppFeeBalances: vi.fn(),
  getAppFeeClaims: vi.fn(),
  indexTransaction: vi.fn(),
}));

vi.mock("../utils/chain-resolver.js", () => ({
  resolveChainId: vi.fn(),
}));

vi.mock("../deeplink.js", () => ({
  buildRelayAppUrl: vi.fn(),
}));

import {
  getChains,
  getQuote,
  getIntentStatus,
  getRequestByHash,
  getRequests,
  getOpenApiSpec,
  getCurrencies,
  // v0.3.0 API functions
  getChainHealth,
  getChainLiquidity,
  getRouteConfig,
  getTokenPrice,
  getTokenDetails,
  getTokenChart,
  getTrendingTokens,
  getSwapSources,
  getAppFeeBalances,
  getAppFeeClaims,
  indexTransaction,
} from "../relay-api.js";
import { resolveChainId } from "../utils/chain-resolver.js";
import { buildRelayAppUrl } from "../deeplink.js";

// Import tool registration functions
import { register as registerBridgeQuote } from "./get-bridge-quote.js";
import { register as registerSwapQuote } from "./get-swap-quote.js";
import { register as registerEstimateFees } from "./estimate-fees.js";
import { register as registerTransactionStatus } from "./get-transaction-status.js";
import { register as registerTransactionHistory } from "./get-transaction-history.js";
import { register as registerSupportedChains } from "./get-supported-chains.js";
import { register as registerApiSchema } from "./get-api-schema.js";
// v0.3.0 tool imports
import { register as registerCheckChainStatus } from "./check-chain-status.js";
import { register as registerGetTokenPrice } from "./get-token-price.js";
import { register as registerGetTokenDetails } from "./get-token-details.js";
import { register as registerGetTrendingTokens } from "./get-trending-tokens.js";
import { register as registerGetSwapSources } from "./get-swap-sources.js";
import { register as registerGetAppFees } from "./get-app-fees.js";
import { register as registerIndexTransaction } from "./index-transaction.js";

// ─── Helper: extract the handler from McpServer ───────────────────

/**
 * McpServer.tool() doesn't expose handlers directly, but we can
 * capture them by spying on the registration. Instead, we'll test
 * by calling the tool through the server's internal tool list.
 *
 * Simpler approach: just test the handler directly by extracting it.
 */

// We'll use a wrapper that captures the handler during registration.
type ToolHandler = (args: any) => Promise<any>;

function captureToolHandler(
  registerFn: (server: McpServer) => void
): ToolHandler {
  let captured: ToolHandler | null = null;

  const fakeServer = {
    tool: (_name: string, _desc: string, _schema: any, handler: ToolHandler) => {
      captured = handler;
    },
  } as unknown as McpServer;

  registerFn(fakeServer);
  if (!captured) throw new Error("Tool handler was not captured");
  return captured;
}

// ─── Shared test fixtures ─────────────────────────────────────────

const VALID_ADDRESS = "0x0000000000000000000000000000000000000000";
const SENDER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const MOCK_QUOTE = {
  details: {
    operation: "bridge",
    sender: SENDER,
    recipient: SENDER,
    currencyIn: {
      currency: { symbol: "ETH", decimals: 18, chainId: 1 },
      amount: "1000000000000000000",
      amountFormatted: "1.0",
      amountUsd: "3000.00",
    },
    currencyOut: {
      currency: { symbol: "ETH", decimals: 18, chainId: 8453 },
      amount: "999000000000000000",
      amountFormatted: "0.999",
      amountUsd: "2997.00",
    },
    totalImpact: { usd: "3.00", percent: "0.1" },
    rate: "0.999",
    timeEstimate: 15,
  },
  fees: {
    gas: { currency: { symbol: "ETH", decimals: 18, address: VALID_ADDRESS, chainId: 1 }, amount: "100000", amountFormatted: "0.0001", amountUsd: "0.30" },
    relayer: { currency: { symbol: "ETH", decimals: 18, address: VALID_ADDRESS, chainId: 1 }, amount: "1000000", amountFormatted: "0.001", amountUsd: "3.00" },
    relayerGas: { currency: { symbol: "ETH", decimals: 18, address: VALID_ADDRESS, chainId: 1 }, amount: "50000", amountFormatted: "0.00005", amountUsd: "0.15" },
    relayerService: { currency: { symbol: "ETH", decimals: 18, address: VALID_ADDRESS, chainId: 1 }, amount: "950000", amountFormatted: "0.00095", amountUsd: "2.85" },
    app: { currency: { symbol: "ETH", decimals: 18, address: VALID_ADDRESS, chainId: 1 }, amount: "0", amountFormatted: "0", amountUsd: "0" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveChainId).mockImplementation(async (input) => {
    if (typeof input === "number") return input;
    const map: Record<string, number> = {
      ethereum: 1, base: 8453, optimism: 10, eth: 1, arb: 42161,
    };
    const id = map[String(input).toLowerCase()];
    if (id) return id;
    throw new Error(`Unknown chain "${input}"`);
  });
  vi.mocked(buildRelayAppUrl).mockResolvedValue("https://relay.link/bridge/base?fromChainId=1");
  vi.mocked(getQuote).mockResolvedValue(MOCK_QUOTE as any);
});

// ─── get_bridge_quote ─────────────────────────────────────────────

describe("get_bridge_quote", () => {
  const handler = captureToolHandler(registerBridgeQuote);

  it("returns a successful bridge quote", async () => {
    const result = await handler({
      originChainId: "ethereum",
      destinationChainId: "base",
      currency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content.length).toBeGreaterThanOrEqual(2);
    // Summary text
    expect(result.content[0].text).toContain("Bridge");
    expect(result.content[0].text).toContain("ETH");
    // JSON data
    const data = JSON.parse(result.content[1].text);
    expect(data.amountIn).toBe("1.0");
    expect(data.amountOut).toBe("0.999");
    expect(data.fees).toBeDefined();
  });

  it("rejects invalid sender address", async () => {
    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      currency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: "not-an-address",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("rejects invalid currency address", async () => {
    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      currency: "bad-currency",
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("rejects invalid amount (decimal)", async () => {
    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      currency: VALID_ADDRESS,
      amount: "1.5",
      sender: SENDER,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("rejects invalid recipient if provided", async () => {
    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      currency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
      recipient: "bad",
    });

    expect(result.isError).toBe(true);
  });

  it("handles chain resolution errors gracefully", async () => {
    vi.mocked(resolveChainId).mockRejectedValueOnce(
      new Error('Unknown chain "fakechain"')
    );

    const result = await handler({
      originChainId: "fakechain",
      destinationChainId: "base",
      currency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("fakechain");
  });

  it("handles API errors gracefully", async () => {
    vi.mocked(getQuote).mockRejectedValueOnce(
      new Error("Relay API POST /quote/v2 failed (400): insufficient balance")
    );

    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      currency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("[api 400]");
  });

  it("handles rate limit errors", async () => {
    vi.mocked(getQuote).mockRejectedValueOnce(
      new Error("Relay API POST /quote/v2 failed (429): rate limited")
    );

    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      currency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("rate_limit");
    expect(result.content[0].text).toContain("retryable");
  });

  it("accepts numeric chain IDs", async () => {
    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      currency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(resolveChainId)).toHaveBeenCalledWith(1);
    expect(vi.mocked(resolveChainId)).toHaveBeenCalledWith(8453);
  });

  it("accepts string chain names", async () => {
    await handler({
      originChainId: "ethereum",
      destinationChainId: "base",
      currency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(vi.mocked(resolveChainId)).toHaveBeenCalledWith("ethereum");
    expect(vi.mocked(resolveChainId)).toHaveBeenCalledWith("base");
  });

  it("includes deeplink URL in response when available", async () => {
    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      currency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    // Should have resource_link and text with URL
    const resourceLink = result.content.find((c: any) => c.type === "resource_link");
    expect(resourceLink).toBeDefined();
    expect(resourceLink.uri).toContain("relay.link");
  });

  it("omits deeplink when buildRelayAppUrl returns null", async () => {
    vi.mocked(buildRelayAppUrl).mockResolvedValueOnce(null);

    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      currency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    const resourceLink = result.content.find((c: any) => c.type === "resource_link");
    expect(resourceLink).toBeUndefined();
  });
});

// ─── get_swap_quote ───────────────────────────────────────────────

describe("get_swap_quote", () => {
  const handler = captureToolHandler(registerSwapQuote);

  it("returns a successful swap quote", async () => {
    const result = await handler({
      originChainId: "ethereum",
      destinationChainId: "base",
      originCurrency: VALID_ADDRESS,
      destinationCurrency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("swap");
  });

  it("identifies cross-chain swaps in summary", async () => {
    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      originCurrency: VALID_ADDRESS,
      destinationCurrency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(result.content[0].text).toContain("Cross-chain swap");
  });

  it("identifies same-chain swaps in summary", async () => {
    const result = await handler({
      originChainId: 8453,
      destinationChainId: 8453,
      originCurrency: VALID_ADDRESS,
      destinationCurrency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    // Not "Cross-chain swap", just "Swap"
    expect(result.content[0].text).toMatch(/^Swap:/);
  });

  it("validates all three currency addresses", async () => {
    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      originCurrency: "bad",
      destinationCurrency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("originCurrency");
  });

  it("rejects invalid amount", async () => {
    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      originCurrency: VALID_ADDRESS,
      destinationCurrency: VALID_ADDRESS,
      amount: "not-a-number",
      sender: SENDER,
    });

    expect(result.isError).toBe(true);
  });
});

// ─── estimate_fees ────────────────────────────────────────────────

describe("estimate_fees", () => {
  const handler = captureToolHandler(registerEstimateFees);

  it("returns fee breakdown", async () => {
    const result = await handler({
      originChainId: "ethereum",
      destinationChainId: "base",
      originCurrency: VALID_ADDRESS,
      destinationCurrency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Fee estimate");
    const data = JSON.parse(result.content[1].text);
    expect(data.gas).toBeDefined();
    expect(data.relayer).toBeDefined();
    expect(data.relayerGas).toBeDefined();
    expect(data.relayerService).toBeDefined();
    expect(data.totalImpact).toBeDefined();
  });

  it("validates sender address", async () => {
    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      originCurrency: VALID_ADDRESS,
      destinationCurrency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: "invalid",
    });

    expect(result.isError).toBe(true);
  });

  it("validates amount", async () => {
    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      originCurrency: VALID_ADDRESS,
      destinationCurrency: VALID_ADDRESS,
      amount: "-100",
      sender: SENDER,
    });

    expect(result.isError).toBe(true);
  });

  it("handles API 500 gracefully", async () => {
    vi.mocked(getQuote).mockRejectedValueOnce(
      new Error("Relay API POST /quote/v2 failed (500): internal server error")
    );

    const result = await handler({
      originChainId: 1,
      destinationChainId: 8453,
      originCurrency: VALID_ADDRESS,
      destinationCurrency: VALID_ADDRESS,
      amount: "1000000000000000000",
      sender: SENDER,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("[server 500]");
    expect(result.content[0].text).toContain("retryable");
  });
});

// ─── get_transaction_status ───────────────────────────────────────

describe("get_transaction_status", () => {
  const handler = captureToolHandler(registerTransactionStatus);
  const VALID_REQUEST_ID = "0x" + "a".repeat(64);
  const VALID_TX_HASH = "0x" + "b".repeat(64);

  beforeEach(() => {
    vi.mocked(getIntentStatus).mockResolvedValue({
      status: "success",
      txHashes: ["0x" + "c".repeat(64)],
      originChainId: 1,
      destinationChainId: 8453,
    });
    vi.mocked(getRequestByHash).mockResolvedValue({
      requests: [
        {
          id: VALID_REQUEST_ID,
          status: "success",
          user: SENDER,
          recipient: SENDER,
          data: {
            inTxs: [{ hash: VALID_TX_HASH, chainId: 1, timestamp: 1700000000 }],
            outTxs: [{ hash: "0x" + "c".repeat(64), chainId: 8453, timestamp: 1700000015 }],
            currency: "ETH",
            timeEstimate: 15,
          },
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:15Z",
        },
      ],
    });
  });

  it("returns status for a valid requestId", async () => {
    const result = await handler({ requestId: VALID_REQUEST_ID });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("complete");
    expect(vi.mocked(getIntentStatus)).toHaveBeenCalledWith(VALID_REQUEST_ID);
  });

  it("resolves txHash to requestId then gets status", async () => {
    const result = await handler({ txHash: VALID_TX_HASH });

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(getRequestByHash)).toHaveBeenCalledWith(VALID_TX_HASH);
    expect(vi.mocked(getIntentStatus)).toHaveBeenCalledWith(VALID_REQUEST_ID);
  });

  it("requires either requestId or txHash", async () => {
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Provide either");
  });

  it("validates requestId format", async () => {
    const result = await handler({ requestId: "bad-id" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("validates txHash format", async () => {
    const result = await handler({ txHash: "not-a-hash" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("handles txHash not found", async () => {
    vi.mocked(getRequestByHash).mockResolvedValueOnce({ requests: [] } as any);

    const result = await handler({ txHash: VALID_TX_HASH });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No Relay request found");
  });

  it("handles API error on txHash lookup", async () => {
    vi.mocked(getRequestByHash).mockRejectedValueOnce(
      new Error("Relay API GET /requests/v2 failed (500): server error")
    );

    const result = await handler({ txHash: VALID_TX_HASH });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("[server 500]");
  });

  it("handles API error on status lookup", async () => {
    vi.mocked(getIntentStatus).mockRejectedValueOnce(
      new Error("Relay API GET /intents/status/v3 failed (404): not found")
    );

    const result = await handler({ requestId: VALID_REQUEST_ID });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("[api 404]");
  });

  it("describes pending status", async () => {
    vi.mocked(getIntentStatus).mockResolvedValueOnce({ status: "pending" });

    const result = await handler({ requestId: VALID_REQUEST_ID });
    expect(result.content[0].text).toContain("being processed");
  });

  it("describes waiting status", async () => {
    vi.mocked(getIntentStatus).mockResolvedValueOnce({ status: "waiting" });

    const result = await handler({ requestId: VALID_REQUEST_ID });
    expect(result.content[0].text).toContain("waiting");
  });

  it("describes failure status", async () => {
    vi.mocked(getIntentStatus).mockResolvedValueOnce({ status: "failure" });

    const result = await handler({ requestId: VALID_REQUEST_ID });
    expect(result.content[0].text).toContain("failed");
  });

  it("describes refund status", async () => {
    vi.mocked(getIntentStatus).mockResolvedValueOnce({ status: "refund" });

    const result = await handler({ requestId: VALID_REQUEST_ID });
    expect(result.content[0].text).toContain("refunded");
  });
});

// ─── get_transaction_history ──────────────────────────────────────

describe("get_transaction_history", () => {
  const handler = captureToolHandler(registerTransactionHistory);

  beforeEach(() => {
    vi.mocked(getRequests).mockResolvedValue({
      requests: [
        {
          id: "req-1",
          status: "success",
          user: SENDER,
          recipient: SENDER,
          data: {
            inTxs: [{ hash: "0x" + "a".repeat(64), chainId: 1, timestamp: 1700000000 }],
            outTxs: [{ hash: "0x" + "b".repeat(64), chainId: 8453, timestamp: 1700000015 }],
            currency: "ETH",
            timeEstimate: 15,
          },
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:15Z",
        },
      ],
      continuation: undefined,
    });
  });

  it("returns transaction history for valid address", async () => {
    const result = await handler({ user: SENDER, limit: 10 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Found 1 transaction");
    const data = JSON.parse(result.content[1].text);
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0].requestId).toBe("req-1");
    expect(data.transactions[0].status).toBe("success");
  });

  it("rejects invalid address", async () => {
    const result = await handler({ user: "not-an-address", limit: 10 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("handles API errors", async () => {
    vi.mocked(getRequests).mockRejectedValueOnce(
      new Error("Relay API GET /requests failed (429): rate limited")
    );

    const result = await handler({ user: SENDER, limit: 10 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("rate_limit");
  });

  it("includes continuation cursor when available", async () => {
    vi.mocked(getRequests).mockResolvedValueOnce({
      requests: [
        {
          id: "req-1",
          status: "success",
          user: SENDER,
          recipient: SENDER,
          data: { inTxs: [], outTxs: [], currency: "ETH", timeEstimate: 0 },
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
      continuation: "cursor-abc-123",
    });

    const result = await handler({ user: SENDER, limit: 10 });
    expect(result.content[0].text).toContain("More results available");
    const data = JSON.parse(result.content[1].text);
    expect(data.cursor).toBe("cursor-abc-123");
  });

  it("passes cursor to API for pagination", async () => {
    await handler({ user: SENDER, limit: 5, cursor: "page-2" });

    expect(vi.mocked(getRequests)).toHaveBeenCalledWith(SENDER, 5, "page-2");
  });
});

// ─── get_supported_chains ─────────────────────────────────────────

describe("get_supported_chains", () => {
  const handler = captureToolHandler(registerSupportedChains);

  const MOCK_CHAINS = {
    chains: [
      { id: 1, name: "ethereum", displayName: "Ethereum", vmType: "evm", depositEnabled: true, disabled: false, currency: { symbol: "ETH" } },
      { id: 8453, name: "base", displayName: "Base", vmType: "evm", depositEnabled: true, disabled: false, currency: { symbol: "ETH" } },
      { id: 999, name: "dead-chain", displayName: "Dead Chain", vmType: "evm", depositEnabled: false, disabled: true, currency: { symbol: "X" } },
      { id: 101, name: "solana", displayName: "Solana", vmType: "svm", depositEnabled: true, disabled: false, currency: { symbol: "SOL" } },
    ],
  };

  beforeEach(() => {
    vi.mocked(getChains).mockResolvedValue(MOCK_CHAINS as any);
  });

  it("returns all non-disabled chains", async () => {
    const result = await handler({});

    const data = JSON.parse(result.content[1].text);
    expect(data).toHaveLength(3); // excludes disabled "dead-chain"
    expect(data.find((c: any) => c.name === "Dead Chain")).toBeUndefined();
  });

  it("filters by vmType when provided", async () => {
    const result = await handler({ vmType: "svm" });

    const data = JSON.parse(result.content[1].text);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("Solana");
  });

  it("vmType filter is case-insensitive", async () => {
    const result = await handler({ vmType: "EVM" });

    const data = JSON.parse(result.content[1].text);
    expect(data).toHaveLength(2); // ethereum + base (not dead-chain, not solana)
  });

  it("returns slim chain objects (no explorerUrl, httpRpcUrl, etc.)", async () => {
    const result = await handler({});

    const data = JSON.parse(result.content[1].text);
    const chain = data[0];
    expect(chain.chainId).toBeDefined();
    expect(chain.name).toBeDefined();
    expect(chain.nativeCurrency).toBeDefined();
    // Should NOT have heavy fields
    expect(chain.explorerUrl).toBeUndefined();
    expect(chain.httpRpcUrl).toBeUndefined();
    expect(chain.iconUrl).toBeUndefined();
    expect(chain.contracts).toBeUndefined();
  });

  it("includes summary text", async () => {
    const result = await handler({});
    expect(result.content[0].text).toContain("Found 3 supported chain");
  });
});

// ─── get_api_schema ───────────────────────────────────────────────

describe("get_api_schema", () => {
  const handler = captureToolHandler(registerApiSchema);

  const MOCK_SPEC = {
    paths: {
      "/chains": {
        get: { summary: "List supported chains" },
      },
      "/quote/v2": {
        post: {
          summary: "Get a bridge/swap quote",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["user", "originChainId"],
                  properties: {
                    user: { type: "string", description: "Wallet address" },
                    originChainId: { type: "number" },
                    amount: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { fees: { type: "object" } } },
                },
              },
            },
          },
        },
      },
      "/quote": {
        post: { summary: "Legacy quote endpoint" },
      },
      "/admin/test": {
        get: { summary: "Admin endpoint" },
      },
      "/currencies/v1": {
        post: { summary: "Search currencies" },
      },
    },
  };

  beforeEach(() => {
    vi.mocked(getOpenApiSpec).mockResolvedValue(MOCK_SPEC);
  });

  it("lists all public endpoints when no args given", async () => {
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // Should list public endpoints
    expect(text).toContain("/chains");
    expect(text).toContain("/quote/v2");
    expect(text).toContain("/currencies/v1");
    // Should exclude admin
    expect(text).not.toContain("/admin");
    // Should exclude older version (/quote) since /quote/v2 exists
    expect(text).not.toContain("Legacy quote");
  });

  it("returns endpoint detail when endpoint arg provided", async () => {
    const result = await handler({ endpoint: "quote" });

    const data = JSON.parse(result.content[0].text);
    expect(data.path).toBe("/quote/v2");
    expect(data.methods.POST).toBeDefined();
    expect(data.methods.POST.summary).toContain("quote");
    expect(data.methods.POST.requestBody).toBeDefined();
    expect(data.methods.POST.response).toBeDefined();
  });

  it("returns error for unknown endpoint", async () => {
    const result = await handler({ endpoint: "nonexistent" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("handles OpenAPI spec fetch failure", async () => {
    vi.mocked(getOpenApiSpec).mockRejectedValueOnce(
      new Error("Failed to fetch OpenAPI spec (500)")
    );

    const result = await handler({});

    expect(result.isError).toBe(true);
  });

  it("matches endpoint with leading slash", async () => {
    const result = await handler({ endpoint: "/chains" });

    const data = JSON.parse(result.content[0].text);
    expect(data.path).toBe("/chains");
  });

  it("matches endpoint without leading slash", async () => {
    const result = await handler({ endpoint: "chains" });

    const data = JSON.parse(result.content[0].text);
    expect(data.path).toBe("/chains");
  });
});

// ─── check_chain_status ──────────────────────────────────────────

describe("check_chain_status", () => {
  const handler = captureToolHandler(registerCheckChainStatus);

  const MOCK_HEALTH = { healthy: true };
  const MOCK_LIQUIDITY = [
    { symbol: "ETH", balance: "10000000000000000000", amountUsd: "30000.00" },
    { symbol: "USDC", balance: "50000000000", amountUsd: "50000.00" },
  ];
  const MOCK_ROUTE_CONFIG = { enabled: true, maxAmount: "100000000000000000000" };

  beforeEach(() => {
    vi.mocked(getChainHealth).mockResolvedValue(MOCK_HEALTH as any);
    vi.mocked(getChainLiquidity).mockResolvedValue(MOCK_LIQUIDITY as any);
    vi.mocked(getRouteConfig).mockResolvedValue(MOCK_ROUTE_CONFIG as any);
  });

  it("returns health and liquidity for a chain", async () => {
    const result = await handler({ chainId: "base" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Healthy");
    expect(result.content[0].text).toContain("80,000");
    const data = JSON.parse(result.content[1].text);
    expect(data.healthy).toBe(true);
    expect(data.liquidity).toHaveLength(2);
    expect(data.routeConfig).toBeUndefined();
  });

  it("includes route config when destinationChainId provided", async () => {
    const result = await handler({ chainId: "ethereum", destinationChainId: "base" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Route to chain 8453");
    expect(result.content[0].text).toContain("enabled");
    const data = JSON.parse(result.content[1].text);
    expect(data.routeConfig).toBeDefined();
  });

  it("shows unhealthy status", async () => {
    vi.mocked(getChainHealth).mockResolvedValueOnce({ healthy: false } as any);

    const result = await handler({ chainId: 8453 });

    expect(result.content[0].text).toContain("Unhealthy");
    expect(result.content[0].text).toContain("❌");
  });

  it("shows disabled route", async () => {
    vi.mocked(getRouteConfig).mockResolvedValueOnce({ enabled: false } as any);

    const result = await handler({ chainId: 1, destinationChainId: 8453 });

    expect(result.content[0].text).toContain("disabled");
  });

  it("handles chain resolution error", async () => {
    vi.mocked(resolveChainId).mockRejectedValueOnce(
      new Error('Unknown chain "fakechain"')
    );

    const result = await handler({ chainId: "fakechain" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("fakechain");
  });

  it("handles API error on health fetch", async () => {
    vi.mocked(getChainHealth).mockRejectedValueOnce(
      new Error("Relay API GET /chains/status failed (500): server error")
    );

    const result = await handler({ chainId: 8453 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("[server 500]");
  });

  it("slims liquidity to essentials", async () => {
    const result = await handler({ chainId: 8453 });

    const data = JSON.parse(result.content[1].text);
    const liq = data.liquidity[0];
    expect(liq.symbol).toBeDefined();
    expect(liq.amountUsd).toBeDefined();
    // Should not contain raw full objects
    expect(liq.chainId).toBeUndefined();
    expect(liq.address).toBeUndefined();
  });

  it("accepts numeric chain IDs", async () => {
    const result = await handler({ chainId: 8453 });

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(resolveChainId)).toHaveBeenCalledWith(8453);
  });
});

// ─── get_token_price ─────────────────────────────────────────────

describe("get_token_price", () => {
  const handler = captureToolHandler(registerGetTokenPrice);

  beforeEach(() => {
    vi.mocked(getTokenPrice).mockResolvedValue({ price: 3245.67 } as any);
  });

  it("returns token price", async () => {
    const result = await handler({ chainId: "ethereum", address: VALID_ADDRESS });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("$3245.67");
    const data = JSON.parse(result.content[1].text);
    expect(data.price).toBe(3245.67);
  });

  it("rejects invalid address", async () => {
    const result = await handler({ chainId: 1, address: "bad" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("handles chain resolution error", async () => {
    vi.mocked(resolveChainId).mockRejectedValueOnce(
      new Error('Unknown chain "mars"')
    );

    const result = await handler({ chainId: "mars", address: VALID_ADDRESS });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("mars");
  });

  it("handles API error", async () => {
    vi.mocked(getTokenPrice).mockRejectedValueOnce(
      new Error("Relay API GET /currencies/token/price failed (404): not found")
    );

    const result = await handler({ chainId: 1, address: VALID_ADDRESS });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("[api 404]");
  });

  it("accepts native ETH zero address", async () => {
    const result = await handler({
      chainId: 1,
      address: "0x0000000000000000000000000000000000000000",
    });

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(getTokenPrice)).toHaveBeenCalledWith(1, "0x0000000000000000000000000000000000000000");
  });
});

// ─── get_token_details ───────────────────────────────────────────

describe("get_token_details", () => {
  const handler = captureToolHandler(registerGetTokenDetails);

  const MOCK_DETAILS = {
    symbol: "DEGEN",
    name: "Degen",
    decimals: 18,
    price: 0.012,
    marketCap: 150000000,
    fullyDilutedValuation: 200000000,
    liquidity: 5000000,
    volume24h: 8000000,
  };

  const MOCK_CHART = {
    t: [1700000000, 1700003600, 1700007200, 1700010800],
    o: [0.010, 0.011, 0.012, 0.011],
    h: [0.012, 0.013, 0.014, 0.012],
    l: [0.009, 0.010, 0.011, 0.010],
    c: [0.011, 0.012, 0.013, 0.012],
    volume: [1000, 2000, 3000, 1500],
  };

  beforeEach(() => {
    vi.mocked(getTokenDetails).mockResolvedValue(MOCK_DETAILS as any);
    vi.mocked(getTokenChart).mockResolvedValue(MOCK_CHART as any);
  });

  it("returns token details without chart by default", async () => {
    const result = await handler({
      chainId: "base",
      address: VALID_ADDRESS,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DEGEN");
    expect(result.content[0].text).toContain("$0.012");
    const data = JSON.parse(result.content[1].text);
    expect(data.symbol).toBe("DEGEN");
    expect(data.marketCap).toBe(150000000);
    expect(data.chart).toBeUndefined();
    expect(vi.mocked(getTokenChart)).not.toHaveBeenCalled();
  });

  it("includes slimmed chart when requested", async () => {
    const result = await handler({
      chainId: "base",
      address: VALID_ADDRESS,
      includeChart: true,
    });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[1].text);
    expect(data.chart).toBeDefined();
    expect(data.chart.stats).toBeDefined();
    expect(data.chart.stats.dataPoints).toBe(4);
    expect(data.chart.closes).toBeDefined();
    expect(data.chart.volumes).toBeDefined();
    // Should NOT have raw OHLC arrays
    expect(data.chart.o).toBeUndefined();
    expect(data.chart.h).toBeUndefined();
    expect(data.chart.l).toBeUndefined();
  });

  it("rejects invalid address", async () => {
    const result = await handler({
      chainId: 8453,
      address: "not-an-address",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("handles API error", async () => {
    vi.mocked(getTokenDetails).mockRejectedValueOnce(
      new Error("Relay API GET /currencies/token/details failed (500): server error")
    );

    const result = await handler({ chainId: 8453, address: VALID_ADDRESS });

    expect(result.isError).toBe(true);
  });

  it("fetches details and chart in parallel when includeChart=true", async () => {
    await handler({ chainId: 8453, address: VALID_ADDRESS, includeChart: true });

    expect(vi.mocked(getTokenDetails)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getTokenChart)).toHaveBeenCalledTimes(1);
  });

  it("chart stats include change percent", async () => {
    const result = await handler({
      chainId: 8453,
      address: VALID_ADDRESS,
      includeChart: true,
    });

    const data = JSON.parse(result.content[1].text);
    expect(data.chart.stats.changePercent).toBeDefined();
    expect(data.chart.stats.first).toBe(0.011);
    expect(data.chart.stats.latest).toBe(0.012);
  });
});

// ─── get_trending_tokens ─────────────────────────────────────────

describe("get_trending_tokens", () => {
  const handler = captureToolHandler(registerGetTrendingTokens);

  const MOCK_TRENDING = [
    { symbol: "DEGEN", name: "Degen", address: "0xaaa", chainId: 8453 },
    { symbol: "BRETT", name: "Brett", address: "0xbbb", chainId: 8453 },
    { symbol: "PEPE", name: "Pepe", address: "0xccc", chainId: 1 },
  ];

  beforeEach(() => {
    vi.mocked(getTrendingTokens).mockResolvedValue(MOCK_TRENDING as any);
  });

  it("returns all trending tokens", async () => {
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("3 trending token");
    expect(result.content[0].text).toContain("DEGEN");
    const data = JSON.parse(result.content[1].text);
    expect(data).toHaveLength(3);
  });

  it("filters by chain when chainId provided", async () => {
    const result = await handler({ chainId: "base" });

    const data = JSON.parse(result.content[1].text);
    expect(data).toHaveLength(2);
    expect(data.every((t: any) => t.chainId === 8453)).toBe(true);
  });

  it("respects limit parameter", async () => {
    const result = await handler({ limit: 1 });

    const data = JSON.parse(result.content[1].text);
    expect(data).toHaveLength(1);
    expect(data[0].symbol).toBe("DEGEN");
  });

  it("handles chain resolution error", async () => {
    vi.mocked(resolveChainId).mockRejectedValueOnce(
      new Error('Unknown chain "fakechain"')
    );

    const result = await handler({ chainId: "fakechain" });

    expect(result.isError).toBe(true);
  });

  it("handles API error", async () => {
    vi.mocked(getTrendingTokens).mockRejectedValueOnce(
      new Error("Relay API GET /trending/v1 failed (500): server error")
    );

    const result = await handler({});

    expect(result.isError).toBe(true);
  });

  it("notes that prices are not included", async () => {
    const result = await handler({});

    expect(result.content[0].text).toContain("prices not included");
  });
});

// ─── get_swap_sources ────────────────────────────────────────────

describe("get_swap_sources", () => {
  const handler = captureToolHandler(registerGetSwapSources);

  const MOCK_SOURCES = ["Uniswap", "SushiSwap", "1inch", "Jupiter", "Orca", "Raydium", "Curve", "Balancer", "PancakeSwap", "TraderJoe"];

  beforeEach(() => {
    vi.mocked(getSwapSources).mockResolvedValue(MOCK_SOURCES);
  });

  it("returns all swap sources", async () => {
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("10 sources");
    expect(result.content[0].text).toContain("Uniswap");
    const data = JSON.parse(result.content[1].text);
    expect(data).toHaveLength(10);
  });

  it("truncates summary to 8 sources with count", async () => {
    const result = await handler({});

    // Summary shows first 8 + "and 2 more"
    expect(result.content[0].text).toContain("and 2 more");
  });

  it("handles API error", async () => {
    vi.mocked(getSwapSources).mockRejectedValueOnce(
      new Error("Relay API GET /swap-sources failed (500): server error")
    );

    const result = await handler({});

    expect(result.isError).toBe(true);
  });
});

// ─── get_app_fees ────────────────────────────────────────────────

describe("get_app_fees", () => {
  const handler = captureToolHandler(registerGetAppFees);

  const MOCK_BALANCES = {
    balances: [
      { symbol: "ETH", amount: "500000000000000000", amountUsd: "1500.00", chainId: 1 },
      { symbol: "USDC", amount: "1000000000", amountUsd: "1000.00", chainId: 8453 },
    ],
  };
  const MOCK_CLAIMS = {
    claims: [
      { txHash: "0x" + "d".repeat(64), amount: "200000000", amountUsd: "200.00" },
    ],
  };

  beforeEach(() => {
    vi.mocked(getAppFeeBalances).mockResolvedValue(MOCK_BALANCES as any);
    vi.mocked(getAppFeeClaims).mockResolvedValue(MOCK_CLAIMS as any);
  });

  it("returns balances and claims", async () => {
    const result = await handler({ wallet: SENDER });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("$2500.00");
    expect(result.content[0].text).toContain("2 token");
    expect(result.content[0].text).toContain("1 past claim");
    const data = JSON.parse(result.content[1].text);
    expect(data.balances).toHaveLength(2);
    expect(data.claims).toHaveLength(1);
    expect(data.totalClaimableUsd).toBe("2500.00");
  });

  it("shows zero balances message", async () => {
    vi.mocked(getAppFeeBalances).mockResolvedValueOnce({ balances: [] } as any);
    vi.mocked(getAppFeeClaims).mockResolvedValueOnce({ claims: [] } as any);

    const result = await handler({ wallet: SENDER });

    expect(result.content[0].text).toContain("No claimable app fees");
    expect(result.content[0].text).toContain("0 past claims");
  });

  it("rejects invalid wallet address", async () => {
    const result = await handler({ wallet: "bad-wallet" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("handles API error", async () => {
    vi.mocked(getAppFeeBalances).mockRejectedValueOnce(
      new Error("Relay API GET /app-fees/balances failed (429): rate limited")
    );

    const result = await handler({ wallet: SENDER });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("rate_limit");
  });

  it("fetches balances and claims in parallel", async () => {
    await handler({ wallet: SENDER });

    // Both should have been called (in parallel via Promise.all)
    expect(vi.mocked(getAppFeeBalances)).toHaveBeenCalledWith(SENDER);
    expect(vi.mocked(getAppFeeClaims)).toHaveBeenCalledWith(SENDER);
  });
});

// ─── index_transaction ───────────────────────────────────────────

describe("index_transaction", () => {
  const handler = captureToolHandler(registerIndexTransaction);
  const VALID_TX_HASH = "0x" + "b".repeat(64);

  beforeEach(() => {
    vi.mocked(indexTransaction).mockResolvedValue(undefined as any);
  });

  it("indexes a transaction successfully", async () => {
    const result = await handler({ chainId: "base", txHash: VALID_TX_HASH });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("submitted for indexing");
    expect(result.content[0].text).toContain("chain 8453");
    expect(vi.mocked(indexTransaction)).toHaveBeenCalledWith({
      chainId: 8453,
      txHash: VALID_TX_HASH,
    });
  });

  it("rejects invalid tx hash", async () => {
    const result = await handler({ chainId: 8453, txHash: "not-a-hash" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("handles chain resolution error", async () => {
    vi.mocked(resolveChainId).mockRejectedValueOnce(
      new Error('Unknown chain "badchain"')
    );

    const result = await handler({ chainId: "badchain", txHash: VALID_TX_HASH });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("badchain");
  });

  it("handles API error", async () => {
    vi.mocked(indexTransaction).mockRejectedValueOnce(
      new Error("Relay API POST /transactions/index failed (400): already indexed")
    );

    const result = await handler({ chainId: 8453, txHash: VALID_TX_HASH });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("[api 400]");
  });

  it("accepts numeric chain IDs", async () => {
    await handler({ chainId: 8453, txHash: VALID_TX_HASH });

    expect(vi.mocked(resolveChainId)).toHaveBeenCalledWith(8453);
  });
});
