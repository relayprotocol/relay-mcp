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

/** Validate an EVM address (0x-prefixed, 40 hex chars). */
export function validateAddress(
  value: string,
  paramName = "address"
): ValidationError | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return null;

  if (!value.startsWith("0x")) {
    return {
      param: paramName,
      value,
      message: "Address must start with 0x",
      suggestion: `0x${value}`,
    };
  }
  if (value.length !== 42) {
    return {
      param: paramName,
      value,
      message: `Address must be 42 characters (got ${value.length})`,
    };
  }
  return {
    param: paramName,
    value,
    message: "Address contains invalid hex characters",
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

/** Validate a transaction hash (0x-prefixed, 64 hex chars). */
export function validateTxHash(
  value: string,
  paramName = "hash"
): ValidationError | null {
  return validateHex64(value, "Transaction hash", paramName);
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
