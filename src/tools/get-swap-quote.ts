import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getQuote } from "../relay-api.js";
import { buildRelayAppUrl } from "../deeplink.js";

export function register(server: McpServer) {
  server.tool(
    "get_swap_quote",
    "Get a quote for swapping between different tokens, optionally across chains (e.g. ETH on Ethereum → USDC on Base, or USDC → WETH on the same chain). Returns estimated output amount, fees, and time estimate.",
    {
      originChainId: z
        .number()
        .describe("Source chain ID (e.g. 1 for Ethereum)."),
      destinationChainId: z
        .number()
        .describe(
          "Destination chain ID. Can be the same as originChainId for same-chain swaps."
        ),
      originCurrency: z
        .string()
        .describe(
          'Token address to swap from. Use "0x0000000000000000000000000000000000000000" for native ETH.'
        ),
      destinationCurrency: z
        .string()
        .describe(
          'Token address to swap to. Use "0x0000000000000000000000000000000000000000" for native ETH.'
        ),
      amount: z
        .string()
        .describe(
          "Amount to swap in the origin token's smallest unit (wei for ETH)."
        ),
      sender: z.string().describe("Sender wallet address."),
      recipient: z
        .string()
        .optional()
        .describe("Recipient wallet address. Defaults to sender."),
    },
    async ({
      originChainId,
      destinationChainId,
      originCurrency,
      destinationCurrency,
      amount,
      sender,
      recipient,
    }) => {
      const quote = await getQuote({
        user: sender,
        originChainId,
        destinationChainId,
        originCurrency,
        destinationCurrency,
        amount,
        recipient,
      });

      const { details, fees } = quote;
      const isCrossChain = originChainId !== destinationChainId;
      const action = isCrossChain ? "Cross-chain swap" : "Swap";
      const summary = `${action}: ${details.currencyIn.amountFormatted} ${details.currencyIn.currency.symbol} (chain ${originChainId}) → ${details.currencyOut.amountFormatted} ${details.currencyOut.currency.symbol} (chain ${destinationChainId}). Total fees: $${fees.relayer.amountUsd}. ETA: ~${details.timeEstimate}s.`;

      const deeplinkUrl = await buildRelayAppUrl({
        destinationChainId,
        fromChainId: originChainId,
        fromCurrency: originCurrency,
        toCurrency: destinationCurrency,
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
          name: "Execute swap on Relay",
          description: "Open the Relay app to sign and execute this swap",
          mimeType: "text/html",
        });
        content.push({
          type: "text",
          text: `To execute this swap, open the Relay app: ${deeplinkUrl}`,
        });
      }

      return { content };
    }
  );
}
