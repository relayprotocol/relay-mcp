/**
 * Structured error categorization for Relay API errors.
 * Maps raw errors into clear categories for agent consumption.
 */

export interface RelayError {
  category:
    | "validation"
    | "api"
    | "network"
    | "rate_limit"
    | "server"
    | "auth";
  message: string;
  httpCode?: number;
  retryable: boolean;
}

/**
 * Categorize a raw error into a structured RelayError.
 * Parses the error message format from relay-api.ts:
 *   "Relay API GET /path failed (404): message"
 */
export function categorizeError(err: Error): RelayError {
  const match = err.message.match(/failed \((\d+)\)/);
  const code = match ? parseInt(match[1], 10) : undefined;

  if (code === 429) {
    return {
      category: "rate_limit",
      message: "Rate limited — wait a moment and retry.",
      httpCode: code,
      retryable: true,
    };
  }
  if (code === 401 || code === 403) {
    return {
      category: "auth",
      message: "Authentication failed. Check RELAY_API_KEY.",
      httpCode: code,
      retryable: false,
    };
  }
  if (code && code >= 500) {
    return {
      category: "server",
      message: "Relay API server error — retry in a few seconds.",
      httpCode: code,
      retryable: true,
    };
  }
  if (code && code >= 400) {
    return {
      category: "api",
      message: err.message,
      httpCode: code,
      retryable: false,
    };
  }
  if (
    err.message.includes("fetch failed") ||
    err.message.includes("ECONNREFUSED")
  ) {
    return {
      category: "network",
      message: "Network error — check connectivity and retry.",
      retryable: true,
    };
  }

  return {
    category: "api",
    message: err.message,
    retryable: false,
  };
}

/** Format a RelayError for MCP tool response. */
export function formatErrorResponse(err: RelayError): string {
  const prefix = `[${err.category}${err.httpCode ? ` ${err.httpCode}` : ""}]`;
  const retry = err.retryable ? " (retryable)" : "";
  return `${prefix} ${err.message}${retry}`;
}

/**
 * Catch-all error handler for tool handlers.
 * Categorizes the error, formats it, and returns an MCP isError response.
 * Replaces the 6-line catch block duplicated across every tool.
 */
export function mcpCatchError(err: unknown) {
  const relayErr = categorizeError(
    err instanceof Error ? err : new Error(String(err))
  );
  return {
    content: [{ type: "text" as const, text: formatErrorResponse(relayErr) }],
    isError: true as const,
  };
}
