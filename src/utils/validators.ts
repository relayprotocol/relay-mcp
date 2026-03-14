/**
 * Input validation for Relay API parameters.
 * Validates before HTTP requests to give fast, clear error messages.
 * Ported from relay-cli — zero dependencies.
 */

export interface ValidationError {
  param: string;
  value: string;
  message: string;
  suggestion?: string;
}

/** Validate a wallet or token address across supported VM types. */
export function validateAddress(
  value: string,
  paramName = "address"
): ValidationError | null {
  // EVM: 0x-prefixed, 40 hex chars
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  // HypeVM (Hyperliquid): 0x-prefixed, 32 hex chars
  if (/^0x[0-9a-fA-F]{32}$/.test(value)) return null;
  // Lighter (LVM): bare "0" as native currency
  if (value === "0") return null;
  // Solana (SVM): base58, 32–44 chars
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return null;
  // Bitcoin: bech32 (bc1...) or legacy (1.../3...)
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(value)) return null;
  // Tron (TVM): T-prefixed base58, 34 chars
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return null;

  return {
    param: paramName,
    value,
    message: "Invalid address format. Supported: EVM (0x + 40 hex), HypeVM (0x + 32 hex), Lighter (\"0\"), Solana (base58), Bitcoin (bc1.../1.../3...), Tron (T...)",
  };
}

/** Shared validation for 0x-prefixed 64-hex-char values (request IDs, tx hashes). */
function validateHex64(
  value: string,
  label: string,
  paramName: string
): ValidationError | null {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  if (!value.startsWith("0x")) {
    return { param: paramName, value, message: `${label} must start with 0x` };
  }
  if (value.length !== 66) {
    return {
      param: paramName,
      value,
      message: `${label} must be 66 characters (got ${value.length})`,
    };
  }
  return { param: paramName, value, message: `${label} contains invalid hex characters` };
}

/** Validate a request ID (0x-prefixed, 64 hex chars = 66 total). */
export function validateRequestId(
  value: string,
  paramName = "requestId"
): ValidationError | null {
  return validateHex64(value, "Request ID", paramName);
}

/** Validate a wei amount is a numeric string. */
export function validateAmount(
  value: string,
  paramName = "amount"
): ValidationError | null {
  if (/^\d+$/.test(value)) return null;
  return {
    param: paramName,
    value,
    message: "Amount must be a numeric string (wei, no decimals)",
  };
}

/** Validate a transaction hash (EVM: 0x + 64 hex, or Bitcoin: 64 hex without prefix). */
export function validateTxHash(
  value: string,
  paramName = "hash"
): ValidationError | null {
  // EVM: 0x-prefixed, 64 hex chars
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  // Bitcoin/non-EVM: 64 hex chars without 0x prefix
  if (/^[0-9a-fA-F]{64}$/.test(value)) return null;
  // Solana: base58, 87-88 chars
  if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(value)) return null;

  return {
    param: paramName,
    value,
    message: "Invalid transaction hash. Expected EVM (0x + 64 hex), Bitcoin (64 hex), or Solana (base58).",
  };
}

/** MCP error response type used by tool handlers. */
export type McpToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Convert a ValidationError into an MCP isError response.
 * Eliminates the 7-line boilerplate block repeated in every tool.
 */
export function validationError(err: ValidationError): McpToolResponse {
  return {
    content: [
      {
        type: "text",
        text: `Validation error (${err.param}): ${err.message}`,
      },
    ],
    isError: true,
  };
}

/**
 * Validate multiple addresses in one call.
 * Returns a validationError response on first failure, or null if all pass.
 */
export function validateAddresses(
  ...pairs: Array<[string, string]>
): McpToolResponse | null {
  for (const [value, name] of pairs) {
    const err = validateAddress(value, name);
    if (err) return validationError(err);
  }
  return null;
}
