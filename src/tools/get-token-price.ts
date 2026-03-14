import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTokenPrice } from "../relay-api.js";
import { resolveChainId } from "../utils/chain-resolver.js";
import { validateAddress, validationError } from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "get_token_price",
    `Get the current USD price of a token on a specific chain.

For just the price, use this tool. For full fundamentals (marketCap, volume, liquidity, chart), use get_token_details instead.

For fee estimates on a specific bridge/swap route, use estimate_fees — this tool is for standalone token pricing only.`,
    {
      chainId: z
        .union([z.number(), z.string()])
        .describe("Chain where the token lives (ID or name like 'ethereum', 'base')."),
      address: z
        .string()
        .describe(
          'Token contract address. Use "0x0000000000000000000000000000000000000000" for native ETH on EVM chains. For Solana, use the base58 mint address.'
        ),
    },
    async ({ chainId, address }) => {
      const addrErr = validateAddress(address, "address");
      if (addrErr) return validationError(addrErr);

      let resolvedChainId: number;
      try {
        resolvedChainId = await resolveChainId(chainId);
      } catch (err) {
        return mcpCatchError(err);
      }

      let result;
      try {
        result = await getTokenPrice(resolvedChainId, address);
      } catch (err) {
        return mcpCatchError(err);
      }

      const summary = `Token price on chain ${resolvedChainId}: $${result.price}`;

      return {
        content: [
          { type: "text", text: summary },
          {
            type: "text",
            text: JSON.stringify(
              { chainId: resolvedChainId, address, price: result.price },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
