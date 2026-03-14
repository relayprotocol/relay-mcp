import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getQuote } from "../relay-api.js";
import { resolveChainId, getChainVmType } from "../utils/chain-resolver.js";
import { resolveTokenAddress } from "../utils/token-resolver.js";
import {
  validateAddress,
  validateAmount,
  validationError,
} from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";
import { NATIVE_TOKEN_ADDRESSES } from "../utils/descriptions.js";

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
        .describe(`Origin token address or symbol (e.g. "USDC", "ETH"). ${NATIVE_TOKEN_ADDRESSES}`),
      destinationCurrency: z
        .string()
        .describe(`Destination token address or symbol (e.g. "USDC", "ETH"). ${NATIVE_TOKEN_ADDRESSES}`),
      amount: z
        .string()
        .describe("Amount in the origin token's smallest unit."),
      tradeType: z
        .enum(["EXACT_INPUT", "EXPECTED_OUTPUT", "EXACT_OUTPUT"])
        .optional()
        .default("EXACT_INPUT")
        .describe(
          "EXACT_INPUT (default): amount is the input. EXPECTED_OUTPUT: amount is the desired output. EXACT_OUTPUT: amount is the exact output required."
        ),
      sender: z
        .string()
        .optional()
        .describe(
          "Sender wallet address. Optional — defaults to a zero address for estimation purposes."
        ),
    },
    async ({
      originChainId,
      destinationChainId,
      originCurrency,
      destinationCurrency,
      amount,
      tradeType,
      sender,
    }) => {
      const effectiveSender =
        sender || "0x0000000000000000000000000000000000000001";

      // Validate inputs
      if (sender) {
        const senderErr = validateAddress(sender, "sender");
        if (senderErr) return validationError(senderErr);
      }
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

      // Resolve token symbols → addresses if needed
      let resolvedOriginCurrency: string;
      let resolvedDestCurrency: string;
      try {
        const [originVm, destVm] = await Promise.all([
          getChainVmType(resolvedOrigin),
          getChainVmType(resolvedDest),
        ]);
        [resolvedOriginCurrency, resolvedDestCurrency] = await Promise.all([
          resolveTokenAddress(originCurrency, resolvedOrigin, originVm),
          resolveTokenAddress(destinationCurrency, resolvedDest, destVm),
        ]);
      } catch (err) {
        return mcpCatchError(err);
      }

      let quote;
      try {
        quote = await getQuote({
          user: effectiveSender,
          originChainId: resolvedOrigin,
          destinationChainId: resolvedDest,
          originCurrency: resolvedOriginCurrency,
          destinationCurrency: resolvedDestCurrency,
          amount,
          tradeType,
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
