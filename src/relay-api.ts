const BASE_URL = process.env.RELAY_API_URL || "https://api.relay.link";

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  params?: Record<string, string>;
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
    "X-Relay-Agent": "relay-mcp/0.3.0",
  };

  const apiKey = process.env.RELAY_API_KEY;
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    let message: string;
    try {
      const json = JSON.parse(text);
      message = json.message || json.error || text;
    } catch {
      message = text;
    }
    throw new Error(`Relay API ${method} ${path} failed (${res.status}): ${message}`);
  }

  return res.json() as Promise<T>;
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
  vmType: string;
  iconUrl: string;
  currency: {
    id: string;
    symbol: string;
    name: string;
    address: string;
    decimals: number;
  };
}

export interface ChainsResponse {
  chains: Chain[];
}

/**
 * Fetch supported chains (cached in-memory).
 * Both chain-resolver and deeplink consume this, so caching here
 * avoids duplicate HTTP calls from separate consumers.
 */
let chainsCachePromise: Promise<ChainsResponse> | null = null;
export function getChains(): Promise<ChainsResponse> {
  if (chainsCachePromise) return chainsCachePromise;
  chainsCachePromise = relayApi<ChainsResponse>("/chains");
  // Reset on failure so the next call retries instead of returning a cached rejection.
  chainsCachePromise.catch(() => { chainsCachePromise = null; });
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
}

export interface FeeEntry {
  currency: {
    symbol: string;
    decimals: number;
    address: string;
    chainId: number;
  };
  amount: string;
  amountFormatted: string;
  amountUsd: string;
}

export interface QuoteResponse {
  fees: {
    gas: FeeEntry;
    relayer: FeeEntry;
    relayerGas: FeeEntry;
    relayerService: FeeEntry;
    app: FeeEntry;
  };
  details: {
    operation: string;
    sender: string;
    recipient: string;
    currencyIn: {
      currency: { symbol: string; decimals: number; chainId: number };
      amount: string;
      amountFormatted: string;
      amountUsd: string;
    };
    currencyOut: {
      currency: { symbol: string; decimals: number; chainId: number };
      amount: string;
      amountFormatted: string;
      amountUsd: string;
    };
    totalImpact: { usd: string; percent: string };
    rate: string;
    timeEstimate: number;
  };
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

export interface IntentStatus {
  status: string;
  inTxHashes?: string[];
  txHashes?: string[];
  originChainId?: number;
  destinationChainId?: number;
  updatedAt?: string;
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
    }>;
    outTxs: Array<{
      hash: string;
      chainId: number;
      timestamp: number;
    }>;
    currency: string;
    timeEstimate: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface RequestsResponse {
  requests: RelayRequest[];
  continuation?: string;
}

export async function getRequests(
  user: string,
  limit = 10,
  continuation?: string
): Promise<RequestsResponse> {
  const params: Record<string, string> = {
    user,
    limit: String(limit),
  };
  if (continuation) params.continuation = continuation;
  return relayApi<RequestsResponse>("/requests", { params });
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
}

export async function getChainLiquidity(
  chainId: number
): Promise<LiquidityEntry[]> {
  return relayApi<LiquidityEntry[]>("/chains/liquidity", {
    params: { chainId: String(chainId) },
  });
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
  fullyDilutedValuation?: number;
  liquidity?: number;
  volume24h?: number;
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
  volume: number[];
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
}

export async function getTrendingTokens(): Promise<TrendingToken[]> {
  return relayApi<TrendingToken[]>("/currencies/trending");
}

export async function getSwapSources(): Promise<string[]> {
  return relayApi<string[]>("/swap-sources");
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
 * Fetch the Relay OpenAPI specification (cached in-memory).
 * Caches the promise to avoid duplicate fetches on concurrent calls.
 * Used by get_api_schema for progressive discovery.
 */
let specCachePromise: Promise<any> | null = null;
export function getOpenApiSpec(): Promise<any> {
  if (specCachePromise) return specCachePromise;
  specCachePromise = (async () => {
    const url = `${BASE_URL}/documentation/json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch OpenAPI spec (${res.status})`);
    }
    return res.json();
  })();
  // Reset on any failure (network, HTTP, JSON parse) so the next call retries.
  specCachePromise.catch(() => { specCachePromise = null; });
  return specCachePromise;
}
