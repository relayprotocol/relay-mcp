import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getQuote } from "../relay-api.js";
import { buildRelayAppUrl } from "../deeplink.js";
import { resolveChainId } from "../utils/chain-resolver.js";
import {
  validateAddress,
  validateAmount,
  validateAddresses,
  validationError,
} from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "get_swap_quote",
    `Get a quote for swapping between DIFFERENT tokens, same-chain or cross-chain (e.g. ETH → USDC on Base, or ETH on Ethereum → USDC on Base).

Use when input and output tokens differ. Works same-chain and cross-chain. For same-token bridging (e.g. ETH on Ethereum → ETH on Base), use get_bridge_quote instead — it's simpler.

Returns execution steps — each step contains ready-to-sign transaction data (to, data, value, chainId, gas). An agent with wallet tooling can sign and submit these directly. Also returns a relay.link deep link as a fallback for manual execution.

Amounts must be in wei (smallest unit). Use get_supported_tokens to look up token decimals first. Examples: 1 USDC = "1000000" (6 decimals), 1 ETH = "1000000000000000000" (18 decimals).

Chain IDs can be numbers (8453) or names ('base', 'ethereum', 'arb').`,
    {
      originChainId: z
        .union([z.number(), z.string()])
        .describe("Source chain ID or name (e.g. 1, 'ethereum', 'eth')."),
      destinationChainId: z
        .union([z.number(), z.string()])
        .describe(
          "Destination chain ID or name (e.g. 8453, 'base'). Can be the same as originChainId for same-chain swaps."
        ),
      originCurrency: z
        .string()
        .describe(
          'Token address to swap from. Use "0x0000000000000000000000000000000000000000" for native ETH on EVM chains. For Solana, use the base58 mint address.'
        ),
      destinationCurrency: z
        .string()
        .describe(
          'Token address to swap to. Use "0x0000000000000000000000000000000000000000" for native ETH on EVM chains. For Solana, use the base58 mint address.'
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
      // Validate inputs
      const addrErr = validateAddresses(
        [sender, "sender"],
        [originCurrency, "originCurrency"],
        [destinationCurrency, "destinationCurrency"],
      );
      if (addrErr) return addrErr;
      if (recipient) {
        const recipErr = validateAddress(recipient, "recipient");
        if (recipErr) return validationError(recipErr);
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

      let quote;
      try {
        quote = await getQuote({
          user: sender,
          originChainId: resolvedOrigin,
          destinationChainId: resolvedDest,
          originCurrency,
          destinationCurrency,
          amount,
          recipient,
        });
      } catch (err) {
        return mcpCatchError(err);
      }

      const { steps, details, fees } = quote;
      const isCrossChain = resolvedOrigin !== resolvedDest;
      const action = isCrossChain ? "Cross-chain swap" : "Swap";
      const summary = `${action}: ${details.currencyIn.amountFormatted} ${details.currencyIn.currency.symbol} (chain ${resolvedOrigin}) → ${details.currencyOut.amountFormatted} ${details.currencyOut.currency.symbol} (chain ${resolvedDest}). Total fees: $${fees.relayer.amountUsd}. ETA: ~${details.timeEstimate}s.`;

      const deeplinkUrl = await buildRelayAppUrl({
        destinationChainId: resolvedDest,
        fromChainId: resolvedOrigin,
        fromCurrency: originCurrency,
        toCurrency: destinationCurrency,
        amount: details.currencyIn.amountFormatted,
        toAddress: recipient,
      });

      const content: Array<{ type: "text"; text: string } | { type: "resource_link"; uri: string; name: string; description: string; mimeType: string }> = [
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
              steps,
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
