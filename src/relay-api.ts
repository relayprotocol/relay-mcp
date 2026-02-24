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
    "X-Relay-Agent": "relay-mcp/0.1.0",
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

// --- API methods ---

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

export async function getChains(): Promise<ChainsResponse> {
  return relayApi<ChainsResponse>("/chains");
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

export interface TransactionData {
  from: string;
  to: string;
  data: string;
  value: string;
  chainId: number;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface SignatureData {
  sign?: {
    signatureKind: "eip191" | "eip712";
    domain?: any;
    types?: any;
    primaryType?: string;
    value?: any;
    message?: string;
  };
  post?: {
    body: any;
    method: string;
    endpoint: string;
  };
}

export interface StepItem {
  status: string;
  data: any; // TransactionData for kind=transaction, SignatureData for kind=signature
  check?: {
    endpoint: string;
    method: string;
  };
}

export interface Step {
  id: string;
  action: string;
  description: string;
  kind: "transaction" | "signature";
  requestId: string;
  items: StepItem[];
}

export interface QuoteResponse {
  steps: Step[];
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

/**
 * Poll a step item's check endpoint until the step is confirmed.
 * For approval steps: waits for on-chain confirmation.
 * For deposit steps: waits for relay network to pick it up (returns once status != "waiting").
 */
export async function pollStepCheck(
  check: { endpoint: string; method: string },
  stepId: string,
  options: { maxAttempts?: number; intervalMs?: number } = {}
): Promise<{ status: string; txHashes?: string[] }> {
  const maxAttempts = options.maxAttempts || 60; // 5 min at 5s intervals
  const intervalMs = options.intervalMs || 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await relayApi<{
      status: string;
      txHashes?: string[];
      inTxHashes?: string[];
      details?: string;
    }>(check.endpoint, { method: check.method as "GET" | "POST" });

    if (res.status === "success") {
      return { status: "success", txHashes: res.txHashes };
    }
    if (res.status === "failure") {
      throw new Error(res.details || "Step check returned failure");
    }

    // For approval steps, we need to wait for full confirmation
    // For deposit steps on the last step, we can return early — the caller
    // will use get_transaction_status for ongoing tracking
    if (stepId === "approve") {
      // Keep polling until success/failure
    } else {
      // For deposit/other steps, once status is "pending" or beyond, the relay has picked it up
      if (res.status === "pending" || res.status === "submitted") {
        return { status: res.status, txHashes: res.txHashes };
      }
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Step check timed out after ${maxAttempts} attempts`);
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
