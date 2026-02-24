import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getQuote } from "../relay-api.js";
import { buildRelayAppUrl } from "../deeplink.js";

export function register(server: McpServer) {
  server.tool(
    "get_bridge_quote",
    "Get a quote for bridging the same token from one chain to another (e.g. ETH on Ethereum → ETH on Base). Returns estimated output amount, fees breakdown, and time estimate. Use get_swap_quote instead if you want to change the token type.",
    {
      originChainId: z
        .number()
        .describe("Source chain ID (e.g. 1 for Ethereum)."),
      destinationChainId: z
        .number()
        .describe("Destination chain ID (e.g. 8453 for Base)."),
      currency: z
        .string()
        .describe(
          'Token address to bridge. Use "0x0000000000000000000000000000000000000000" for native ETH.'
        ),
      amount: z
        .string()
        .describe(
          "Amount to bridge in the token's smallest unit (wei for ETH). Example: \"1000000000000000000\" for 1 ETH."
        ),
      sender: z
        .string()
        .describe("Sender wallet address."),
      recipient: z
        .string()
        .optional()
        .describe(
          "Recipient wallet address. Defaults to sender if not provided."
        ),
    },
    async ({ originChainId, destinationChainId, currency, amount, sender, recipient }) => {
      const quote = await getQuote({
        user: sender,
        originChainId,
        destinationChainId,
        originCurrency: currency,
        destinationCurrency: currency,
        amount,
        recipient,
      });

      const { details, fees } = quote;
      const summary = `Bridge ${details.currencyIn.amountFormatted} ${details.currencyIn.currency.symbol} (chain ${originChainId}) → ${details.currencyOut.amountFormatted} ${details.currencyOut.currency.symbol} (chain ${destinationChainId}). Total fees: $${fees.relayer.amountUsd}. ETA: ~${details.timeEstimate}s.`;

      const deeplinkUrl = await buildRelayAppUrl({
        destinationChainId,
        fromChainId: originChainId,
        fromCurrency: currency,
        toCurrency: currency,
        amount: details.currencyIn.amountFormatted,
        toAddress: recipient || sender,
      });

      const content: Array<Record<string, unknown>> = [
        { type: "text", text: summary },
        {
          type: "text",
          text: JSON.stringify(
            {
              amountIn: details.currencyIn.amountFormatted,
              amountOut: details.currencyOut.amountFormatted,
              amountInUsd: details.currencyIn.amountUsd,
              amountOutUsd: details.currencyOut.amountUsd,
              fees: {
                gas: { formatted: fees.gas.amountFormatted, usd: fees.gas.amountUsd },
                relayer: { formatted: fees.relayer.amountFormatted, usd: fees.relayer.amountUsd },
              },
              totalImpact: details.totalImpact,
              timeEstimateSeconds: details.timeEstimate,
              rate: details.rate,
              relayAppUrl: deeplinkUrl ?? undefined,
            },
            null,
            2
          ),
        },
      ];

      if (deeplinkUrl) {
        content.push({
          type: "resource_link",
          uri: deeplinkUrl,
          name: "Execute bridge on Relay",
          description: "Open the Relay app to sign and execute this bridge",
          mimeType: "text/html",
        });
        content.push({
          type: "text",
          text: `To execute this bridge, open the Relay app: ${deeplinkUrl}`,
        });
      }

      return { content };
    }
  );
}
