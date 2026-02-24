import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildRelayAppUrl } from "../deeplink.js";

export function register(server: McpServer) {
  server.tool(
    "get_relay_app_url",
    "Generate a deep link to the Relay web app with pre-filled bridge/swap parameters. The user can open this URL in their browser, connect their wallet, and sign the transaction. Use this when the user wants to execute a transaction through the Relay UI rather than programmatically.",
    {
      destinationChainId: z
        .number()
        .describe("Destination chain ID (e.g. 8453 for Base). This determines the Relay app page."),
      fromChainId: z
        .number()
        .optional()
        .describe("Origin chain ID (e.g. 1 for Ethereum). If omitted, user picks in the UI."),
      fromCurrency: z
        .string()
        .optional()
        .describe('Origin token address. "0x0000000000000000000000000000000000000000" for native.'),
      toCurrency: z
        .string()
        .optional()
        .describe('Destination token address. "0x0000000000000000000000000000000000000000" for native.'),
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
      const url = await buildRelayAppUrl({
        destinationChainId,
        fromChainId,
        fromCurrency,
        toCurrency,
        amount,
        toAddress,
        tradeType,
      });

      if (!url) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Chain ID ${destinationChainId} not found. Use get_supported_chains to find valid chain IDs.`,
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
