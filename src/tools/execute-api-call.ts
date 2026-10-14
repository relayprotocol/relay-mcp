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
import { isAllowedEndpoint } from "../utils/api-allowlist.js";

export function register(server: McpServer) {
  server.tool(
    "execute_api_call",
    `Call a read-only Relay API endpoint with full parameters and get the raw, unfiltered response.

Use get_api_schema first to discover endpoints and their parameter schemas, then use this tool to call them. This gives you access to all API features that the dedicated tools simplify away — for example:

- Full /quote/v2 params: slippageTolerance, appFees, includedSwapSources, useExternalLiquidity, topupGas, maxRouteLength, etc.
- Full response data: detailed fee breakdowns, route objects, slippage details, protocol data, swap impact
- Endpoints without dedicated tools: /price (lightweight pricing), /currencies/v2
- Advanced /requests/v3 query params: sortBy, sortDirection, referrer, includeChildRequests, includeTotal, filters

For common operations (simple quotes, token search, chain status), prefer the dedicated tools — they validate inputs, resolve chain names/token symbols, and format responses. Use this tool when you need parameters or response fields those tools don't expose.`,
    {
      method: z
        .enum(["GET", "POST"])
        .default("GET")
        .describe("HTTP method."),
      path: z
        .string()
        .describe(
          "API endpoint path (e.g. '/quote/v2', '/chains', '/requests/v3'). Must start with '/'."
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

      if (!isAllowedEndpoint(method, path)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `${method} ${path} is not accessible via this tool. Use get_api_schema to list available endpoints.`,
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
