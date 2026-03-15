/**
 * Code Mode lite: execute arbitrary Relay API calls.
 * Pairs with get_api_schema for progressive discovery.
 *
 * Agents discover endpoints via get_api_schema, then call any endpoint
 * with full parameters and get the raw, unfiltered response. This covers
 * the long tail of API features (30+ quote params, nested response data,
 * fee breakdowns, route details, slippage config, etc.) that dedicated
 * tools intentionally simplify away for common use cases.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { relayApi } from "../relay-api.js";
import { mcpCatchError } from "../utils/errors.js";

/**
 * Endpoints that should never be callable via this tool.
 * /execute/* endpoints require signed transaction data and wallet interaction
 * which MCP servers should not handle — execution belongs in the client/wallet layer.
 */
const BLOCKED_PATTERNS = [
  "/execute",
  "/fast-fill",
  "/admin",
  "/lives",
  "/loadforge",
  "/conduit",
  "/provision",
  "/wallets/screen",
  "/sanctioned",
];

function isBlocked(path: string): boolean {
  return BLOCKED_PATTERNS.some((p) => path.includes(p));
}

export function register(server: McpServer) {
  server.tool(
    "execute_api_call",
    `Call any public Relay API endpoint with full parameters and get the raw, unfiltered response.

Use get_api_schema first to discover endpoints and their parameter schemas, then use this tool to call them. This gives you access to all API features that the dedicated tools simplify away — for example:

- Full /quote/v2 params: slippageTolerance, appFees, includedSwapSources, useExternalLiquidity, topupGas, maxRouteLength, etc.
- Full response data: detailed fee breakdowns, route objects, slippage details, protocol data, swap impact
- Endpoints without dedicated tools: /price (lightweight pricing), /currencies/v2, /execute/* (with pre-signed data)
- Advanced /requests/v2 query params: sortBy, sortDirection, includeOrderData, referrer, includeChildTxs

For common operations (simple quotes, token search, chain status), prefer the dedicated tools — they validate inputs, resolve chain names/token symbols, and format responses. Use this tool when you need parameters or response fields those tools don't expose.`,
    {
      method: z
        .enum(["GET", "POST", "PUT", "DELETE"])
        .default("GET")
        .describe("HTTP method."),
      path: z
        .string()
        .describe(
          "API endpoint path (e.g. '/quote/v2', '/chains', '/requests/v2'). Must start with '/'."
        ),
      params: z
        .record(z.string())
        .optional()
        .describe(
          "Query parameters as key-value string pairs (for GET requests or additional query params)."
        ),
      body: z
        .record(z.unknown())
        .optional()
        .describe(
          "Request body (for POST/PUT requests). Pass the full JSON object as documented in the API schema."
        ),
    },
    async ({ method, path, params, body }) => {
      // Validate path
      if (!path.startsWith("/")) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Path must start with '/' (e.g. '/quote/v2').",
            },
          ],
          isError: true as const,
        };
      }

      if (isBlocked(path)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Endpoint "${path}" is not accessible via this tool.`,
            },
          ],
          isError: true as const,
        };
      }

      try {
        const result = await relayApi<unknown>(path, {
          method,
          params,
          body,
        });

        const json = JSON.stringify(result, null, 2);

        // Truncate very large responses to avoid blowing up context
        const MAX_CHARS = 50_000;
        const truncated = json.length > MAX_CHARS;
        const output = truncated
          ? json.slice(0, MAX_CHARS) +
            `\n\n... (truncated — response was ${json.length} chars. Use more specific query params to reduce response size.)`
          : json;

        return {
          content: [
            {
              type: "text" as const,
              text: `${method} ${path} — ${truncated ? "truncated " : ""}${typeof result === "object" && result !== null && Array.isArray(result) ? `${result.length} items` : "OK"}`,
            },
            { type: "text" as const, text: output },
          ],
        };
      } catch (err) {
        return mcpCatchError(err);
      }
    }
  );
}
