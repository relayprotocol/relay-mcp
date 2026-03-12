import { getChains } from "./relay-api.js";

// Cache the promise to avoid duplicate fetches on concurrent calls.
let chainNameMapPromise: Promise<Map<number, string>> | null = null;

function getChainNameMap(): Promise<Map<number, string>> {
  if (chainNameMapPromise) return chainNameMapPromise;
  chainNameMapPromise = getChains().then(({ chains }) =>
    new Map(
      chains.map((c) => [c.id, c.name.toLowerCase().replace(/\s+/g, "-")])
    )
  );
  // Reset on failure so the next call retries instead of returning a cached rejection.
  chainNameMapPromise.catch(() => { chainNameMapPromise = null; });
  return chainNameMapPromise;
}

export interface DeeplinkParams {
  destinationChainId: number;
  fromChainId?: number;
  fromCurrency?: string;
  toCurrency?: string;
  amount?: string;
  toAddress?: string;
  tradeType?: string;
}

export async function buildRelayAppUrl(
  params: DeeplinkParams
): Promise<string | null> {
  const nameMap = await getChainNameMap();
  const chainName = nameMap.get(params.destinationChainId);
  if (!chainName) return null;

  const url = new URL(`https://relay.link/bridge/${chainName}`);

  if (params.fromChainId !== undefined)
    url.searchParams.set("fromChainId", String(params.fromChainId));
  if (params.fromCurrency)
    url.searchParams.set("fromCurrency", params.fromCurrency);
  if (params.toCurrency)
    url.searchParams.set("toCurrency", params.toCurrency);
  if (params.amount) url.searchParams.set("amount", params.amount);
  if (params.toAddress) url.searchParams.set("toAddress", params.toAddress);
  if (params.tradeType) url.searchParams.set("tradeType", params.tradeType);

  return url.toString();
}
