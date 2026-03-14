/**
 * Token symbol → address resolver.
 * Accepts either a token address (passed through) or a symbol like "USDC"/"ETH".
 * Uses a hardcoded map for common tokens, falls back to /currencies/v1 API search.
 */

import { getCurrencies } from "../relay-api.js";

/** Well-known native token addresses per VM type. */
const NATIVE_ADDRESSES: Record<string, string> = {
  evm: "0x0000000000000000000000000000000000000000",
  svm: "11111111111111111111111111111111",
  bvm: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8",
  hypevm: "0x00000000000000000000000000000000",
  lvm: "0",
};

/** Symbols that map to the native gas token. */
const NATIVE_SYMBOLS = new Set(["ETH", "NATIVE", "GAS"]);

/** Chain-specific native token symbol overrides. */
const CHAIN_NATIVE_SYMBOL: Record<number, string> = {
  56: "BNB",
  137: "MATIC",
  43114: "AVAX",
  792703809: "SOL",
  8253038: "BTC",
};

/** Hardcoded USDC addresses per chain (major EVM chains). */
const USDC: Record<number, string> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  43114: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
};

/** Hardcoded USDT addresses per chain. */
const USDT: Record<number, string> = {
  1: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  10: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
  137: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  8453: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
};

/** Hardcoded WETH addresses per chain. */
const WETH: Record<number, string> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  10: "0x4200000000000000000000000000000000000006",
  8453: "0x4200000000000000000000000000000000000006",
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
};

/**
 * Returns true if the input looks like a token address rather than a symbol.
 * Addresses are hex (0x...), base58 (Solana), or bech32 (Bitcoin).
 */
function looksLikeAddress(input: string): boolean {
  // EVM hex address
  if (/^0x[0-9a-fA-F]{8,}$/i.test(input)) return true;
  // Solana base58 (32-44 chars, no 0x prefix)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input)) return true;
  // Bitcoin bech32
  if (/^(bc1|tb1)/i.test(input)) return true;
  // Tron base58check (starts with T)
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(input)) return true;
  // Lighter numeric token ID
  if (/^\d+$/.test(input) && input.length <= 5) return false; // short numbers are ambiguous, treat as not-address
  return false;
}

/**
 * Resolve a token input to a contract address on a specific chain.
 *
 * Accepts:
 * - Token address (0x..., base58, bech32) → passed through as-is
 * - Token symbol ("ETH", "USDC", "WETH") → resolved to address on the given chain
 *
 * Resolution order:
 * 1. If input looks like an address, return it
 * 2. Check hardcoded native/USDC/USDT/WETH maps
 * 3. Fall back to /currencies/v1 API search
 *
 * Throws if the symbol can't be resolved on the given chain.
 */
export async function resolveTokenAddress(
  input: string,
  chainId: number,
  vmType?: string
): Promise<string> {
  // Pass through addresses
  if (looksLikeAddress(input)) return input;

  const upper = input.toUpperCase();

  // Native gas token
  if (NATIVE_SYMBOLS.has(upper) || upper === CHAIN_NATIVE_SYMBOL[chainId]) {
    const nativeAddr = vmType
      ? NATIVE_ADDRESSES[vmType.toLowerCase()]
      : NATIVE_ADDRESSES["evm"]; // default EVM
    if (nativeAddr) return nativeAddr;
  }

  // Hardcoded stablecoins / wrapped tokens
  if (upper === "USDC" && USDC[chainId]) return USDC[chainId];
  if (upper === "USDT" && USDT[chainId]) return USDT[chainId];
  if (upper === "WETH" && WETH[chainId]) return WETH[chainId];

  // Fall back to API search
  try {
    const results = await getCurrencies({
      chainIds: [chainId],
      term: input,
      limit: 5,
    });

    // results is CurrencyEntry[][] — one array per chainId
    const entries = results.flat();
    if (entries.length === 0) {
      throw new Error(
        `Token "${input}" not found on chain ${chainId}. Use get_supported_tokens to search, or provide the contract address directly.`
      );
    }

    // Exact symbol match preferred
    const exactMatch = entries.find(
      (e) => e.symbol.toUpperCase() === upper
    );
    if (exactMatch) return exactMatch.address;

    // If no exact match, return the first result but warn
    return entries[0].address;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Token")) throw err;
    throw new Error(
      `Could not resolve token "${input}" on chain ${chainId}. Use get_supported_tokens to search, or provide the contract address directly.`
    );
  }
}
