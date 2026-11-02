import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCurrencies, type CurrencyEntry } from "../relay-api.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "get_supported_tokens",
    "Search for tokens supported by Relay across chains. Use this to find token contract addresses before getting quotes. Returns token symbol, name, address, and chain availability.",
    {
      chainIds: z
        .array(z.number())
        .optional()
        .describe(
          "Filter to specific chain IDs (e.g. [1, 8453] for Ethereum and Base). Omit for all chains."
        ),
      term: z
        .string()
        .optional()
        .describe(
          'Search by token name or symbol (e.g. "USDC", "ethereum").'
        ),
      verified: z
        .boolean()
        .optional()
        .default(true)
        .describe("Only return verified tokens. Defaults to true."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Max number of token entries (one per token per chain) to return (1-100). Defaults to 20."),
    },
    async ({ chainIds, term, verified, limit }) => {
      let result: CurrencyEntry[];
      try {
        result = await getCurrencies({
          chainIds,
          term,
          verified,
          limit,
        });
      } catch (err) {
        return mcpCatchError(err);
      }

      const bySymbol = new Map<string, CurrencyEntry[]>();
      for (const entry of result) {
        const group = bySymbol.get(entry.symbol);
        if (group) group.push(entry);
        else bySymbol.set(entry.symbol, [entry]);
      }

      const tokens = [...bySymbol.values()].map((group) => {
        const first = group[0];
        return {
          symbol: first.symbol,
          name: first.name,
          chains: group.map((entry) => ({
            chainId: entry.chainId,
            address: entry.address,
            decimals: entry.decimals,
          })),
        };
      });

      const summary = `Found ${tokens.length} token${tokens.length !== 1 ? "s" : ""}${term ? ` matching "${term}"` : ""}. ${tokens
        .slice(0, 5)
        .map((t) => `${t.symbol} (on ${t.chains.length} chain${t.chains.length !== 1 ? "s" : ""})`)
        .join(", ")}${tokens.length > 5 ? "..." : ""}.`;

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(tokens, null, 2) },
        ],
      };
    }
  );
}
