/**
 * Chain name → ID resolver with fuzzy matching.
 * Ported from relay-cli's chain-resolver — uses in-memory cache (MCP is long-lived).
 */

import { getChains, type Chain } from "../relay-api.js";

interface ChainEntry {
  id: number;
  name: string;
  displayName: string;
}

// Cache the promise (not the result) to avoid thundering herd on concurrent calls.
let chainsCachePromise: Promise<ChainEntry[]> | null = null;

function loadChains(): Promise<ChainEntry[]> {
  if (chainsCachePromise) return chainsCachePromise;

  chainsCachePromise = getChains().then(({ chains }) =>
    chains.map((c: Chain) => ({
      id: c.id,
      name: c.name,
      displayName: c.displayName,
    }))
  );
  // Reset on failure so the next call retries instead of returning a cached rejection.
  chainsCachePromise.catch(() => { chainsCachePromise = null; });
  return chainsCachePromise;
}

/** Common shorthand aliases for chain names. */
const ALIASES: Record<string, string> = {
  eth: "ethereum",
  op: "optimism",
  arb: "arbitrum",
  avax: "avalanche",
  matic: "polygon",
  poly: "polygon",
  bnb: "bsc",
  zk: "zksync",
  zksync: "zksync-era",
  sol: "solana",
  btc: "bitcoin",
};

/**
 * Resolve a chain identifier (name, alias, or numeric ID) to a chain ID.
 * Accepts: numeric ID, chain name, display name, or alias (case-insensitive).
 * Throws with suggestions on ambiguous or unknown input.
 */
export async function resolveChainId(
  input: string | number
): Promise<number> {
  if (typeof input === "number") return input;

  const num = parseInt(input, 10);
  if (Number.isInteger(num) && num > 0 && String(num) === input) {
    return num;
  }

  const chains = await loadChains();
  const lower = input.toLowerCase();

  // Exact match
  const exact = chains.find(
    (c) =>
      c.name.toLowerCase() === lower ||
      c.displayName.toLowerCase() === lower
  );
  if (exact) return exact.id;

  // Alias match
  const aliased = ALIASES[lower];
  if (aliased) {
    const match = chains.find((c) => c.name.toLowerCase() === aliased);
    if (match) return match.id;
  }

  // Fuzzy: substring match
  const fuzzy = chains.filter(
    (c) =>
      c.name.toLowerCase().includes(lower) ||
      c.displayName.toLowerCase().includes(lower)
  );

  if (fuzzy.length === 1) return fuzzy[0].id;

  if (fuzzy.length > 1) {
    const suggestions = fuzzy
      .slice(0, 5)
      .map((c) => `  ${c.id} (${c.displayName})`)
      .join("\n");
    throw new Error(
      `Ambiguous chain "${input}". Did you mean:\n${suggestions}`
    );
  }

  // No match — suggest closest by similarity
  const suggestions = chains
    .map((c) => ({ chain: c, score: similarity(lower, c.name.toLowerCase()) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => `  ${s.chain.id} (${s.chain.displayName})`)
    .join("\n");

  throw new Error(`Unknown chain "${input}". Did you mean:\n${suggestions}`);
}

/** Dice coefficient string similarity. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = bigrams.get(bigram) || 0;
    if (count > 0) {
      bigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2.0 * intersectionSize) / (a.length + b.length - 2);
}
