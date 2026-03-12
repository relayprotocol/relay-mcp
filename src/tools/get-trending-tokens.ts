import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTrendingTokens } from "../relay-api.js";
import { resolveChainId } from "../utils/chain-resolver.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "get_trending_tokens",
    `List currently trending tokens across Relay-supported chains.

Returns token identities only (symbol, name, address, chainId) — NOT prices or volumes. To get pricing for a trending token, follow up with get_token_price or get_token_details.

Use this to answer "what tokens are trending?" or "what's popular on Base right now?"`,
    {
      chainId: z
        .union([z.number(), z.string()])
        .optional()
        .describe(
          "Filter to a specific chain (ID or name like 'base', 'ethereum'). Omit for all chains."
        ),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Max tokens to return. Defaults to 10."),
    },
    async ({ chainId, limit }) => {
      let resolvedChainId: number | undefined;
      if (chainId !== undefined) {
        try {
          resolvedChainId = await resolveChainId(chainId);
        } catch (err) {
          return mcpCatchError(err);
        }
      }

      let tokens;
      try {
        tokens = await getTrendingTokens();
      } catch (err) {
        return mcpCatchError(err);
      }

      if (resolvedChainId !== undefined) {
        tokens = tokens.filter((t) => t.chainId === resolvedChainId);
      }
      tokens = tokens.slice(0, limit);

      const chainLabel = resolvedChainId
        ? ` on chain ${resolvedChainId}`
        : "";
      const summary = `${tokens.length} trending token${tokens.length !== 1 ? "s" : ""}${chainLabel}: ${tokens
        .slice(0, 5)
        .map((t) => t.symbol)
        .join(", ")}${tokens.length > 5 ? "..." : ""}. Note: prices not included — use get_token_price for pricing.`;

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(tokens, null, 2) },
        ],
      };
    }
  );
}
