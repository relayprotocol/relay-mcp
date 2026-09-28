const BASE_URL = process.env.RELAY_API_URL || "https://api.relay.link";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  params?: Record<string, string>;
}

/** Returns true for status codes that are safe to retry. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function relayApi<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, params } = options;

  let url = `${BASE_URL}${path}`;
  if (params) {
    const search = new URLSearchParams(params);
    url += `?${search.toString()}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Relay-Agent": "relay-mcp/0.4.0",
  };

  const apiKey = process.env.RELAY_API_KEY;
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 500ms, 1000ms. Respect Retry-After header for 429.
      const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await sleep(backoff);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new Error(`Relay API ${method} ${path} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
        continue; // retry timeouts
      }
      // Network errors are retryable
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text();
      let message: string;
      try {
        const json = JSON.parse(text);
        message = json.message || json.error || text;
      } catch {
        message = text;
      }
      lastError = new Error(`Relay API ${method} ${path} failed (${res.status}): ${message}`);

      if (isRetryable(res.status) && attempt < MAX_RETRIES) {
        // Check Retry-After header for 429
        const retryAfter = res.headers.get("Retry-After");
        if (retryAfter) {
          const retryMs = parseInt(retryAfter, 10) * 1000;
          if (!isNaN(retryMs) && retryMs > 0 && retryMs <= 30_000) {
            await sleep(retryMs);
          }
        }
        continue;
      }

      throw lastError;
    }

    return res.json() as Promise<T>;
  }

  throw lastError || new Error(`Relay API ${method} ${path} failed after ${MAX_RETRIES + 1} attempts`);
}

// --- API types ---

export interface Chain {
  id: number;
  name: string;
  displayName: string;
  httpRpcUrl: string;
  explorerUrl: string;
  depositEnabled: boolean;
  disabled: boolean;
  blockProductionLagging: boolean;
  vmType: string;
  iconUrl: string;
  currency: {
    id: string;
    symbol: string;
    name: string;
    address: string;
    decimals: number;
  };
  solverCurrencies?: Array<{
    id: string;
    symbol: string;
    name: string;
    address: string;
    decimals: number;
  }>;
  solverAddresses?: string[];
  contracts?: {
    multicall3?: string;
    multicaller?: string;
    onlyOwnerMulticaller?: string;
    relayReceiver?: string;
    erc20Router?: string;
    approvalProxy?: string;
    v3?: {
      erc20Router?: string;
      approvalProxy?: string;
    };
  };
}

export interface ChainsResponse {
  chains: Chain[];
}

/**
 * Fetch supported chains (cached in-memory with TTL).
 * Both chain-resolver and deeplink consume this, so caching here
 * avoids duplicate HTTP calls from separate consumers.
 * Refreshes every CACHE_TTL_MS to pick up new chains, status changes, etc.
 */
let chainsCachePromise: Promise<ChainsResponse> | null = null;
let chainsCacheTime = 0;
export function getChains(): Promise<ChainsResponse> {
  if (chainsCachePromise && Date.now() - chainsCacheTime < CACHE_TTL_MS) {
    return chainsCachePromise;
  }
  chainsCacheTime = Date.now();
  chainsCachePromise = relayApi<ChainsResponse>("/chains");
  // Reset on failure so the next call retries instead of returning a cached rejection.
  chainsCachePromise.catch(() => { chainsCachePromise = null; chainsCacheTime = 0; });
  return chainsCachePromise;
}

export interface CurrencyEntry {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  vmType: string;
  metadata?: {
    logoURI?: string;
    verified?: boolean;
  };
}

export interface CurrenciesRequest {
  chainIds?: number[];
  term?: string;
  address?: string;
  verified?: boolean;
  defaultList?: boolean;
  limit?: number;
}

export async function getCurrencies(
  params: CurrenciesRequest
): Promise<CurrencyEntry[][]> {
  return relayApi<CurrencyEntry[][]>("/currencies/v1", {
    method: "POST",
    body: params,
  });
}

export interface QuoteRequest {
  user: string;
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  amount: string;
  tradeType?: "EXACT_INPUT" | "EXPECTED_OUTPUT" | "EXACT_OUTPUT";
  recipient?: string;
  slippageTolerance?: string;
  useDepositAddress?: boolean;
  refundTo?: string;
}

export interface FeeEntry {
  currency: {
    symbol: string;
    decimals: number;
    address: string;
    chainId: number;
    name?: string;
    metadata?: Record<string, unknown>;
  };
  amount: string;
  amountFormatted: string;
  amountUsd: string;
  minimumAmount?: string;
}

export interface QuoteStepItemData {
  from: string;
  to: string;
  data: string;
  value: string;
  chainId: number;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface QuoteStepCheck {
  endpoint: string;
  method: string;
  body?: Record<string, unknown>;
}

export interface QuoteStep {
  id: string;
  action: string;
  description: string;
  kind: string;
  requestId?: string;
  depositAddress?: string;
  items: Array<{
    status: string;
    data: QuoteStepItemData;
    check?: QuoteStepCheck;
  }>;
}

export interface QuoteCurrencyDetail {
  currency: {
    symbol: string;
    decimals: number;
    chainId: number;
    address?: string;
    name?: string;
  };
  amount: string;
  amountFormatted: string;
  amountUsd: string;
  minimumAmount?: string;
}

export interface QuoteResponse {
  steps: QuoteStep[];
  fees: {
    gas: FeeEntry;
    relayer: FeeEntry;
    relayerGas: FeeEntry;
    relayerService: FeeEntry;
    app: FeeEntry;
    subsidized?: FeeEntry;
  };
  details: {
    operation: string;
    sender: string;
    recipient: string;
    currencyIn: QuoteCurrencyDetail;
    currencyOut: QuoteCurrencyDetail;
    totalImpact: { usd: string; percent: string };
    rate: string;
    timeEstimate: number;
    slippageTolerance?: {
      origin?: { usd: string; value: string; percent: string };
      destination?: { usd: string; value: string; percent: string };
    };
    swapImpact?: { usd: string; percent: string };
    refundCurrency?: QuoteCurrencyDetail;
    route?: Record<string, unknown>;
    isFixedRate?: boolean;
  };
  protocol?: Record<string, unknown>;
}

export async function getQuote(params: QuoteRequest): Promise<QuoteResponse> {
  return relayApi<QuoteResponse>("/quote/v2", {
    method: "POST",
    body: {
      ...params,
      tradeType: params.tradeType || "EXACT_INPUT",
    },
  });
}

export interface MultiInputOrigin {
  chainId: number;
  currency: string;
  amount: string;
  user?: string;
}

export interface MultiInputQuoteRequest {
  user: string;
  origins: MultiInputOrigin[];
  destinationChainId: number;
  destinationCurrency: string;
  tradeType?: "EXACT_INPUT" | "EXPECTED_OUTPUT" | "EXACT_OUTPUT";
  recipient?: string;
  refundTo?: string;
  partial?: boolean;
}

export async function getMultiInputQuote(
  params: MultiInputQuoteRequest
): Promise<QuoteResponse> {
  return relayApi<QuoteResponse>("/execute/swap/multi-input", {
    method: "POST",
    body: {
      ...params,
      tradeType: params.tradeType || "EXACT_INPUT",
    },
  });
}

export interface IntentStatus {
  status: string;
  inTxHashes?: string[];
  txHashes?: string[];
  originChainId?: number;
  destinationChainId?: number;
  updatedAt?: number;
}

export async function getIntentStatus(
  requestId: string
): Promise<IntentStatus> {
  return relayApi<IntentStatus>("/intents/status/v3", {
    params: { requestId },
  });
}

export interface RelayRequest {
  id: string;
  status: string;
  user: string;
  recipient: string;
  data: {
    inTxs: Array<{
      hash: string;
      chainId: number;
      timestamp: number;
      data?: Record<string, unknown>;
    }>;
    outTxs: Array<{
      hash: string;
      chainId: number;
      timestamp: number;
    }>;
    currency: string;
    timeEstimate: number;
    failReason?: string;
    refundFailReason?: string;
    fees?: Record<string, string>;
    feesUsd?: Record<string, string>;
    metadata?: {
      sender?: string;
      recipient?: string;
      currencyIn?: {
        currency: { chainId: number; address: string; symbol: string; name: string; decimals: number };
        amount: string;
        amountFormatted: string;
        amountUsd: string;
      };
      currencyOut?: {
        currency: { chainId: number; address: string; symbol: string; name: string; decimals: number };
        amount: string;
        amountFormatted: string;
        amountUsd: string;
      };
      rate?: string;
      route?: Record<string, unknown>;
      [key: string]: unknown;
    };
    appFees?: unknown[];
    paidAppFees?: unknown[];
    [key: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
}

export interface RequestsResponse {
  requests: RelayRequest[];
  continuation?: string;
}

export interface RelayCurrencyV3 {
  chainId?: number;
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
}

export interface RelayCurrencyAmountV3 {
  currency?: RelayCurrencyV3;
  amount?: string;
  amountFormatted?: string;
  amountUsd?: string;
}

export interface RelayRequestTxV3 {
  txHash?: string;
  chainId?: number;
  timestamp?: number;
  status?: "success" | "failure";
}

export interface RelayRequestRouteSideV3 {
  inputCurrency?: RelayCurrencyAmountV3 | null;
  outputCurrency?: RelayCurrencyAmountV3 | null;
}

export interface RelayRequestRouteSubV3 {
  origin?: RelayRequestRouteSideV3 | null;
  destination?: RelayRequestRouteSideV3 | null;
}

/** Subset of a GET /requests/v3 item. */
export interface RelayRequestV3 {
  id: string;
  status: string;
  user: string;
  recipient: string;
  data: {
    inTxs: RelayRequestTxV3[];
    outTxs: RelayRequestTxV3[];
    failReason: string | null;
    refundFailReason: string | null;
    timeEstimate?: number | null;
    route: {
      quoted?: RelayRequestRouteSubV3 | null;
      actual?: RelayRequestRouteSubV3 | null;
    } | null;
    [key: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
}

export interface RequestsV3Response {
  requests: RelayRequestV3[];
  continuation?: string;
}

export interface GetRequestsParams {
  user: string;
  limit?: number;
  continuation?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  originChainId?: number;
  destinationChainId?: number;
  depositAddress?: string;
}

/** Requires RELAY_API_KEY: GET /requests/v3 rejects unauthenticated calls. */
export async function getRequests(
  params: GetRequestsParams
): Promise<RequestsV3Response> {
  const query: Record<string, string> = {
    user: params.user,
    limit: String(params.limit ?? 10),
  };
  if (params.continuation) query.continuation = params.continuation;
  if (params.startTimestamp) query.startTimestamp = String(params.startTimestamp);
  if (params.endTimestamp) query.endTimestamp = String(params.endTimestamp);
  if (params.originChainId) query.originChainId = String(params.originChainId);
  if (params.destinationChainId) query.destinationChainId = String(params.destinationChainId);
  if (params.depositAddress) query.depositAddress = params.depositAddress;
  return relayApi<RequestsV3Response>("/requests/v3", { params: query });
}

/**
 * Look up a request by its Relay request ID.
 * Returns rich data: fees, metadata, route, fail reason, etc.
 */
export async function getRequestById(
  id: string
): Promise<RequestsResponse> {
  return relayApi<RequestsResponse>("/requests/v2", {
    params: { id },
  });
}

/**
 * Look up requests by transaction hash.
 * Useful for debugging: "what request does this tx belong to?"
 */
export async function getRequestByHash(
  hash: string
): Promise<RequestsResponse> {
  return relayApi<RequestsResponse>("/requests/v2", {
    params: { hash },
  });
}

// --- v0.3.0 API types and functions ---

export interface ChainHealth {
  healthy: boolean;
}

export async function getChainHealth(chainId: number): Promise<ChainHealth> {
  return relayApi<ChainHealth>("/chains/health", {
    params: { chainId: String(chainId) },
  });
}

export interface LiquidityEntry {
  symbol: string;
  address: string;
  decimals: number;
  balance: string;
  amountUsd: string;
  chainId?: number;
  currencyId?: string;
}

export async function getChainLiquidity(
  chainId: number
): Promise<LiquidityEntry[]> {
  // API returns { liquidity: [...] } — unwrap here so callers get a clean array.
  const resp = await relayApi<{ liquidity: LiquidityEntry[] }>("/chains/liquidity", {
    params: { chainId: String(chainId) },
  });
  return resp.liquidity;
}

export interface RouteConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export async function getRouteConfig(
  originChainId: number,
  destinationChainId: number
): Promise<RouteConfig> {
  return relayApi<RouteConfig>("/config/v2", {
    params: {
      originChainId: String(originChainId),
      destinationChainId: String(destinationChainId),
    },
  });
}

export interface UserBalanceConfig extends RouteConfig {
  user?: {
    balance?: string;
    maxBridgeAmount?: string;
  };
  fee?: string;
  solver?: {
    address?: string;
    balance?: string;
    capacityPerRequest?: string;
  };
  supportsExternalLiquidity?: boolean;
}

/**
 * Fetch route config enriched with the user's balance on the origin chain.
 * Shows how much of a given token the user holds and the max bridgeable amount.
 */
export async function getRouteConfigWithUser(
  originChainId: number,
  destinationChainId: number,
  originCurrency: string,
  destinationCurrency: string,
  user: string
): Promise<UserBalanceConfig> {
  return relayApi<UserBalanceConfig>("/config/v2", {
    params: {
      originChainId: String(originChainId),
      destinationChainId: String(destinationChainId),
      originCurrency,
      destinationCurrency,
      user,
    },
  });
}

export interface TokenPrice {
  price: number;
}

export async function getTokenPrice(
  chainId: number,
  address: string
): Promise<TokenPrice> {
  return relayApi<TokenPrice>("/currencies/token/price", {
    params: { chainId: String(chainId), address },
  });
}

export interface TokenDetails {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price?: number;
  marketCap?: number;
  fdv?: number;
  liquidity?: number;
  volume?: { "24h"?: { usd?: number } };
  priceChange?: Record<string, { percent?: number }>;
  createdAt?: string;
  [key: string]: unknown;
}

export async function getTokenDetails(
  chainId: number,
  address: string
): Promise<TokenDetails> {
  return relayApi<TokenDetails>(`/chains/${chainId}/currencies/${address}`);
}

export interface TokenChart {
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  volume: (string | number)[];
  [key: string]: unknown;
}

export async function getTokenChart(
  chainId: number,
  address: string
): Promise<TokenChart> {
  return relayApi<TokenChart>(
    `/chains/${chainId}/currencies/${address}/chart`
  );
}

export interface TrendingToken {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  vmType?: string;
  metadata?: Record<string, unknown>;
}

export async function getTrendingTokens(): Promise<TrendingToken[]> {
  return relayApi<TrendingToken[]>("/currencies/trending");
}

export async function getSwapSources(): Promise<string[]> {
  // API returns { sources: [...] } — unwrap here so callers get a clean array.
  const resp = await relayApi<{ sources: string[] }>("/swap-sources");
  return resp.sources;
}

export interface AppFeeBalance {
  currency: string;
  amount: string;
  amountFormatted: string;
  amountUsd: string;
  [key: string]: unknown;
}

export interface AppFeeBalancesResponse {
  balances: AppFeeBalance[];
}

export async function getAppFeeBalances(
  wallet: string
): Promise<AppFeeBalancesResponse> {
  return relayApi<AppFeeBalancesResponse>(`/app-fees/${wallet}/balances`);
}

export interface AppFeeClaim {
  id: string;
  status: string;
  [key: string]: unknown;
}

export interface AppFeeClaimsResponse {
  claims: AppFeeClaim[];
}

export async function getAppFeeClaims(
  wallet: string
): Promise<AppFeeClaimsResponse> {
  return relayApi<AppFeeClaimsResponse>(`/app-fees/${wallet}/claims`);
}

export interface IndexTransactionRequest {
  chainId: number;
  txHash: string;
}

export async function indexTransaction(
  params: IndexTransactionRequest
): Promise<unknown> {
  return relayApi<unknown>("/transactions/index", {
    method: "POST",
    body: params,
  });
}

/**
 * Fetch the Relay OpenAPI specification (cached in-memory with TTL).
 * Caches the promise to avoid duplicate fetches on concurrent calls.
 * Used by get_api_schema for progressive discovery and execute_api_call.
 */
let specCachePromise: Promise<any> | null = null;
let specCacheTime = 0;
export function getOpenApiSpec(): Promise<any> {
  if (specCachePromise && Date.now() - specCacheTime < CACHE_TTL_MS) {
    return specCachePromise;
  }
  specCacheTime = Date.now();
  specCachePromise = (async () => {
    const url = `${BASE_URL}/documentation/json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`OpenAPI spec fetch timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    }
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`Failed to fetch OpenAPI spec (${res.status})`);
    }
    return res.json();
  })();
  // Reset on any failure (network, HTTP, JSON parse) so the next call retries.
  specCachePromise.catch(() => { specCachePromise = null; specCacheTime = 0; });
  return specCachePromise;
}
