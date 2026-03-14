import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildRelayAppUrl } from "../deeplink.js";
import { resolveChainId } from "../utils/chain-resolver.js";
import { mcpCatchError } from "../utils/errors.js";
import { NATIVE_TOKEN_ADDRESSES } from "../utils/descriptions.js";

export function register(server: McpServer) {
  server.tool(
    "get_relay_app_url",
    "Generate a deep link to the Relay web app with pre-filled bridge/swap parameters. The user can open this URL in their browser to START a new transaction via the Relay UI. This is NOT a transaction tracking URL — do NOT use it to check on an in-progress transaction. For tracking, use get_transaction_status with the requestId.",
    {
      destinationChainId: z
        .union([z.number(), z.string()])
        .describe("Destination chain (ID or name like 'base', 'ethereum'). This determines the Relay app page."),
      fromChainId: z
        .union([z.number(), z.string()])
        .optional()
        .describe("Origin chain (ID or name). If omitted, user picks in the UI."),
      fromCurrency: z
        .string()
        .optional()
        .describe(`Origin token address. ${NATIVE_TOKEN_ADDRESSES}`),
      toCurrency: z
        .string()
        .optional()
        .describe(`Destination token address. ${NATIVE_TOKEN_ADDRESSES}`),
      amount: z
        .string()
        .optional()
        .describe("Pre-filled input amount in human-readable units (e.g. \"0.1\" for 0.1 ETH)."),
      toAddress: z
        .string()
        .optional()
        .describe("Recipient wallet address."),
      tradeType: z
        .enum(["EXACT_INPUT", "EXPECTED_OUTPUT", "EXACT_OUTPUT"])
        .optional()
        .describe("Trade type. Defaults to EXACT_INPUT."),
    },
    async ({ destinationChainId, fromChainId, fromCurrency, toCurrency, amount, toAddress, tradeType }) => {
      let resolvedDestId: number;
      let resolvedFromId: number | undefined;
      try {
        resolvedDestId = await resolveChainId(destinationChainId);
        if (fromChainId !== undefined) {
          resolvedFromId = await resolveChainId(fromChainId);
        }
      } catch (err) {
        return mcpCatchError(err);
      }

      let url: string | null;
      try {
        url = await buildRelayAppUrl({
          destinationChainId: resolvedDestId,
          fromChainId: resolvedFromId,
          fromCurrency,
          toCurrency,
          amount,
          toAddress,
          tradeType,
        });
      } catch (err) {
        return mcpCatchError(err);
      }

      if (!url) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Chain ID ${resolvedDestId} not found in Relay app routing. Use get_supported_chains to find valid chain IDs.`,
            },
          ],
          isError: true,
        };
      }

      const summary = `Open this link to complete the transaction in the Relay app: ${url}`;

      return {
        content: [
          { type: "text", text: summary },
          {
            type: "text",
            text: JSON.stringify({ url }, null, 2),
          },
        ],
      };
    }
  );
}
