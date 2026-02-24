import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getQuote } from "../relay-api.js";

export function register(server: McpServer) {
  server.tool(
    "estimate_fees",
    "Estimate the fees for a bridge or swap without committing to execution. Returns a breakdown of gas fees, relayer fees, and total cost impact. Useful for comparing routes or showing users expected costs.",
    {
      originChainId: z.number().describe("Source chain ID."),
      destinationChainId: z.number().describe("Destination chain ID."),
      originCurrency: z
        .string()
        .describe('Origin token address. "0x0000000000000000000000000000000000000000" for native.'),
      destinationCurrency: z
        .string()
        .describe('Destination token address. "0x0000000000000000000000000000000000000000" for native.'),
      amount: z
        .string()
        .describe("Amount in the origin token's smallest unit."),
      sender: z.string().describe("Sender wallet address."),
    },
    async ({
      originChainId,
      destinationChainId,
      originCurrency,
      destinationCurrency,
      amount,
      sender,
    }) => {
      const quote = await getQuote({
        user: sender,
        originChainId,
        destinationChainId,
        originCurrency,
        destinationCurrency,
        amount,
      });

      const { fees, details } = quote;

      const summary = `Fee estimate for ${details.currencyIn.amountFormatted} ${details.currencyIn.currency.symbol} → ${details.currencyOut.currency.symbol}: Gas $${fees.gas.amountUsd}, Relayer $${fees.relayer.amountUsd}. Total impact: ${details.totalImpact.percent}% ($${details.totalImpact.usd}).`;

      return {
        content: [
          { type: "text", text: summary },
          {
            type: "text",
            text: JSON.stringify(
              {
                gas: {
                  amount: fees.gas.amountFormatted,
                  symbol: fees.gas.currency.symbol,
                  usd: fees.gas.amountUsd,
                },
                relayer: {
                  amount: fees.relayer.amountFormatted,
                  symbol: fees.relayer.currency.symbol,
                  usd: fees.relayer.amountUsd,
                },
                relayerGas: {
                  amount: fees.relayerGas.amountFormatted,
                  usd: fees.relayerGas.amountUsd,
                },
                relayerService: {
                  amount: fees.relayerService.amountFormatted,
                  usd: fees.relayerService.amountUsd,
                },
                totalImpact: details.totalImpact,
                timeEstimateSeconds: details.timeEstimate,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
