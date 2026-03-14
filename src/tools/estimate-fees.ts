import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getQuote } from "../relay-api.js";
import { resolveChainId } from "../utils/chain-resolver.js";
import {
  validateAmount,
  validateAddresses,
  validationError,
} from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "estimate_fees",
    `Estimate the fees for a specific bridge or swap route without committing to execution. Returns a breakdown of gas fees, relayer fees, and total cost impact.

Use this for comparing route costs or showing users expected fees. For standalone token pricing (not route-specific), use get_token_price instead.

Amounts must be in the token's smallest unit (wei for ETH, satoshis for BTC, lamports for SOL). Chain IDs can be numbers (8453) or names ('base', 'ethereum', 'arb', 'bitcoin', 'solana').`,
    {
      originChainId: z.union([z.number(), z.string()]).describe("Source chain ID or name (e.g. 1, 'ethereum', 'eth')."),
      destinationChainId: z.union([z.number(), z.string()]).describe("Destination chain ID or name (e.g. 8453, 'base')."),
      originCurrency: z
        .string()
        .describe('Origin token address. EVM native: "0x0000000000000000000000000000000000000000". Solana native: "11111111111111111111111111111111". Bitcoin native: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8". Hyperliquid native: "0x00000000000000000000000000000000". Lighter native: "0".'),
      destinationCurrency: z
        .string()
        .describe('Destination token address. EVM native: "0x0000000000000000000000000000000000000000". Solana native: "11111111111111111111111111111111". Bitcoin native: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8". Hyperliquid native: "0x00000000000000000000000000000000". Lighter native: "0".'),
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
      // Validate inputs
      const addrErr = validateAddresses(
        [sender, "sender"],
        [originCurrency, "originCurrency"],
        [destinationCurrency, "destinationCurrency"],
      );
      if (addrErr) return addrErr;
      const amtErr = validateAmount(amount);
      if (amtErr) return validationError(amtErr);

      let resolvedOrigin: number;
      let resolvedDest: number;
      try {
        [resolvedOrigin, resolvedDest] = await Promise.all([
          resolveChainId(originChainId),
          resolveChainId(destinationChainId),
        ]);
      } catch (err) {
        return mcpCatchError(err);
      }

      let quote;
      try {
        quote = await getQuote({
          user: sender,
          originChainId: resolvedOrigin,
          destinationChainId: resolvedDest,
          originCurrency,
          destinationCurrency,
          amount,
        });
      } catch (err) {
        return mcpCatchError(err);
      }

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
