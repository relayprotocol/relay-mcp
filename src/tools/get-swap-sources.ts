import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSwapSources } from "../relay-api.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "get_swap_sources",
    `List all DEX aggregators and AMMs that Relay routes swaps through (e.g. Uniswap, Jupiter, SushiSwap).

Use this to answer "what DEX sources does Relay support?" or to verify which protocols are available for swap routing. No parameters needed.`,
    {},
    async () => {
      let sources: string[];
      try {
        sources = await getSwapSources();
      } catch (err) {
        return mcpCatchError(err);
      }

      const summary = `Relay routes swaps through ${sources.length} sources: ${sources.slice(0, 8).join(", ")}${sources.length > 8 ? `, and ${sources.length - 8} more` : ""}.`;

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(sources, null, 2) },
        ],
      };
    }
  );
}
