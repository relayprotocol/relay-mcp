import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMultiInputQuote } from "../relay-api.js";
import { buildRelayAppUrl } from "../deeplink.js";
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
    "get_multi_input_quote",
    `Get a quote for consolidating tokens from MULTIPLE origin chains into a single destination (e.g. USDC from Ethereum + Arbitrum + Optimism → USDC on Base).

Use this for portfolio consolidation, rebalancing, or collecting scattered funds. Each origin specifies its own chain, token, and amount. All origins settle to one destination chain and token.

Amounts must be in each token's smallest unit. Chain IDs can be numbers (8453) or names ('base', 'ethereum', 'arb').`,
    {
      origins: z
        .array(
          z.object({
            chainId: z.union([z.number(), z.string()]).describe("Origin chain ID or name."),
            currency: z.string().describe(`Token address or symbol on this origin chain (e.g. "USDC", "ETH"). ${NATIVE_TOKEN_ADDRESSES}`),
            amount: z.string().describe("Amount in the token's smallest unit."),
          })
        )
        .min(2)
        .describe("Array of origin sources (minimum 2). Each specifies a chain, token, and amount to consolidate."),
      destinationChainId: z
        .union([z.number(), z.string()])
        .describe("Destination chain ID or name (e.g. 8453, 'base')."),
      destinationCurrency: z
        .string()
        .describe(`Destination token address or symbol (e.g. "USDC", "ETH"). ${NATIVE_TOKEN_ADDRESSES}`),
      sender: z.string().describe("Sender wallet address (must hold funds on all origin chains)."),
      recipient: z
        .string()
        .optional()
        .describe("Recipient wallet address. Defaults to sender."),
      tradeType: z
        .enum(["EXACT_INPUT", "EXPECTED_OUTPUT", "EXACT_OUTPUT"])
        .optional()
        .default("EXACT_INPUT")
        .describe("EXACT_INPUT (default): origin amounts are inputs. EXPECTED_OUTPUT: total amount is desired output."),
      partial: z
        .boolean()
        .optional()
        .default(false)
        .describe("Allow partial fills — if one origin fails, others still execute."),
      includeSteps: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include raw transaction steps for signing. Omit to save tokens."),
    },
    async ({
      origins,
      destinationChainId,
      destinationCurrency,
      sender,
      recipient,
      tradeType,
      partial,
      includeSteps,
    }) => {
      // Validate sender
      const senderErr = validateAddress(sender, "sender");
      if (senderErr) return validationError(senderErr);
      if (recipient) {
        const recipErr = validateAddress(recipient, "recipient");
        if (recipErr) return validationError(recipErr);
      }

      // Validate each origin
      for (let i = 0; i < origins.length; i++) {
        const amtErr = validateAmount(origins[i].amount);
        if (amtErr) return validationError(`origins[${i}].amount: ${amtErr}`);
      }

      // Resolve all chain IDs in parallel
      let resolvedDest: number;
      let resolvedOrigins: Array<{ chainId: number; currency: string; amount: string }>;
      let resolvedDestCurrency: string;
      try {
        const [destId, ...originIds] = await Promise.all([
          resolveChainId(destinationChainId),
          ...origins.map((o) => resolveChainId(o.chainId)),
        ]);
        resolvedDest = destId;

        // Resolve token symbols → addresses for each origin + destination
        const destVm = await getChainVmType(resolvedDest);
        resolvedDestCurrency = await resolveTokenAddress(destinationCurrency, resolvedDest, destVm);
        const resolvedCurrencies = await Promise.all(
          origins.map(async (o, i) => {
            const vm = await getChainVmType(originIds[i]);
            return resolveTokenAddress(o.currency, originIds[i], vm);
          })
        );

        resolvedOrigins = origins.map((o, i) => ({
          chainId: originIds[i],
          currency: resolvedCurrencies[i],
          amount: o.amount,
        }));
      } catch (err) {
        return mcpCatchError(err);
      }

      let quote;
      try {
        quote = await getMultiInputQuote({
          user: sender,
          origins: resolvedOrigins,
          destinationChainId: resolvedDest,
          destinationCurrency: resolvedDestCurrency,
          tradeType,
          recipient,
          partial: partial || undefined,
        });
      } catch (err) {
        return mcpCatchError(err);
      }

      const { steps, details, fees } = quote;
      const originSummary = resolvedOrigins
        .map((o) => `${o.amount} on chain ${o.chainId}`)
        .join(", ");
      const summary = `Multi-input consolidation: ${resolvedOrigins.length} origins (${originSummary}) → ${details.currencyOut.amountFormatted} ${details.currencyOut.currency.symbol} on chain ${resolvedDest}. Total fees: $${fees.relayer.amountUsd}. ETA: ~${details.timeEstimate}s.`;

      const content: Array<
        | { type: "text"; text: string }
        | { type: "resource_link"; uri: string; name: string; description: string; mimeType: string }
      > = [
        { type: "text", text: summary },
        {
          type: "text",
          text: JSON.stringify(
            {
              origins: resolvedOrigins,
              destination: {
                chainId: resolvedDest,
                currency: resolvedDestCurrency,
              },
              amountOut: details.currencyOut.amountFormatted,
              amountOutUsd: details.currencyOut.amountUsd,
              fees: {
                gas: { formatted: fees.gas.amountFormatted, usd: fees.gas.amountUsd },
                relayer: { formatted: fees.relayer.amountFormatted, usd: fees.relayer.amountUsd },
              },
              totalImpact: details.totalImpact,
              timeEstimateSeconds: details.timeEstimate,
              ...(includeSteps ? { steps } : { stepsCount: steps.length }),
            },
            null,
            2
          ),
        },
      ];

      return { content };
    }
  );
}
