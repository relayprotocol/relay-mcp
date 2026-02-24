import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getQuote } from "../relay-api.js";

export function register(server: McpServer) {
  server.tool(
    "execute_bridge",
    "Get an unsigned transaction for a bridge or swap via Relay. Returns the raw transaction data (to, data, value, chainId, gas) that your wallet must sign and broadcast. Also returns a requestId for tracking status via get_transaction_status. This tool does NOT sign or send the transaction — your agent's wallet infrastructure must handle that.",
    {
      originChainId: z.number().describe("Source chain ID."),
      destinationChainId: z.number().describe("Destination chain ID."),
      originCurrency: z
        .string()
        .describe(
          'Origin token address. "0x0000000000000000000000000000000000000000" for native.'
        ),
      destinationCurrency: z
        .string()
        .describe(
          'Destination token address. "0x0000000000000000000000000000000000000000" for native.'
        ),
      amount: z
        .string()
        .describe("Amount in the origin token's smallest unit (wei)."),
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

      const step = quote.steps[0];
      if (!step || !step.items[0]) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Quote returned no executable steps. The route may not be available.",
            },
          ],
          isError: true,
        };
      }

      const item = step.items[0];
      const tx = item.data;
      const { details, fees } = quote;

      const summary = `Ready to execute: ${details.currencyIn.amountFormatted} ${details.currencyIn.currency.symbol} (chain ${originChainId}) → ${details.currencyOut.amountFormatted} ${details.currencyOut.currency.symbol} (chain ${destinationChainId}). Sign and broadcast the transaction below, then use get_transaction_status with the requestId to track completion.`;

      return {
        content: [
          { type: "text", text: summary },
          {
            type: "text",
            text: JSON.stringify(
              {
                transaction: {
                  to: tx.to,
                  data: tx.data,
                  value: tx.value,
                  chainId: tx.chainId,
                  gas: tx.gas,
                  maxFeePerGas: tx.maxFeePerGas,
                  maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
                },
                requestId: step.requestId,
                amountIn: details.currencyIn.amountFormatted,
                amountOut: details.currencyOut.amountFormatted,
                fees: {
                  gas: fees.gas.amountUsd,
                  relayer: fees.relayer.amountUsd,
                },
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
