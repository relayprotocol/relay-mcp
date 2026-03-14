import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getQuote } from "../relay-api.js";
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
    "get_bridge_quote",
    `Get a quote for bridging the SAME token from one chain to another (e.g. ETH on Ethereum → ETH on Base).

Use this for same-token cross-chain transfers. For different tokens (same or cross-chain), use get_swap_quote instead.

Returns execution steps — each step contains ready-to-sign transaction data (to, data, value, chainId, gas). An agent with wallet tooling can sign and submit these directly. Also returns a relay.link deep link as a fallback for manual execution.

Amounts must be in the token's smallest unit. Use get_supported_tokens to look up decimals. Examples: 1 ETH = "1000000000000000000" (18 decimals), 1 USDC = "1000000" (6 decimals), 1 BTC = "100000000" (8 decimals, satoshis), 1 SOL = "1000000000" (9 decimals, lamports).

Chain IDs can be numbers (8453) or names ('base', 'ethereum', 'arb', 'bitcoin', 'solana').`,
    {
      originChainId: z
        .union([z.number(), z.string()])
        .describe(
          "Source chain ID or name (e.g. 1, 'ethereum', 'eth')."
        ),
      destinationChainId: z
        .union([z.number(), z.string()])
        .describe(
          "Destination chain ID or name (e.g. 8453, 'base')."
        ),
      currency: z
        .string()
        .describe(
          `Token address or symbol to bridge. Symbols like "ETH", "USDC", "USDT", "WETH" are resolved automatically. ${NATIVE_TOKEN_ADDRESSES}`
        ),
      amount: z
        .string()
        .describe(
          "Amount to bridge in the token's smallest unit. Examples: \"1000000000000000000\" for 1 ETH (18 decimals), \"100000000\" for 1 BTC (8 decimals)."
        ),
      sender: z.string().describe("Sender wallet address."),
      recipient: z
        .string()
        .optional()
        .describe(
          "Recipient wallet address. Defaults to sender if not provided."
        ),
      tradeType: z
        .enum(["EXACT_INPUT", "EXPECTED_OUTPUT", "EXACT_OUTPUT"])
        .optional()
        .default("EXACT_INPUT")
        .describe(
          "EXACT_INPUT (default): you specify input amount, output varies. EXPECTED_OUTPUT: you specify desired output, input is calculated (allows slippage). EXACT_OUTPUT: you specify exact output required, fails if not deliverable."
        ),
      useDepositAddress: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Use deposit address flow — returns an address the user can send funds to (e.g. from a CEX or wallet) instead of transaction calldata. No wallet signing needed. The deposit address is reusable for the same origin→destination→currency route. Only supports EXACT_INPUT. Adds ~33k gas for native tokens, ~70k for ERC-20s."
        ),
      refundTo: z
        .string()
        .optional()
        .describe(
          "Address to send refunds to if the bridge fails. Defaults to sender. Useful when sender is a deposit address or contract."
        ),
      includeSteps: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Include raw transaction steps for signing. Only needed if you have wallet tooling to submit transactions directly. Omit to save tokens."
        ),
    },
    async ({
      originChainId,
      destinationChainId,
      currency,
      amount,
      sender,
      recipient,
      tradeType,
      useDepositAddress,
      refundTo,
      includeSteps,
    }) => {
      // Validate sender address
      const senderErr = validateAddress(sender, "sender");
      if (senderErr) return validationError(senderErr);
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

      // Resolve token symbol → address if needed
      let resolvedCurrency: string;
      try {
        const vmType = await getChainVmType(resolvedOrigin);
        resolvedCurrency = await resolveTokenAddress(currency, resolvedOrigin, vmType);
      } catch (err) {
        return mcpCatchError(err);
      }

      let quote;
      try {
        quote = await getQuote({
        user: sender,
        originChainId: resolvedOrigin,
        destinationChainId: resolvedDest,
        originCurrency: resolvedCurrency,
        destinationCurrency: resolvedCurrency,
        amount,
        tradeType,
        recipient,
        useDepositAddress: useDepositAddress || undefined,
        refundTo,
      });
      } catch (err) {
        return mcpCatchError(err);
      }

      const { steps, details, fees } = quote;
      const depositAddress = steps?.[0]?.depositAddress;
      const depositSummary = depositAddress
        ? ` Send funds to deposit address: ${depositAddress}`
        : "";
      const summary = `Bridge ${details.currencyIn.amountFormatted} ${details.currencyIn.currency.symbol} (chain ${resolvedOrigin}) → ${details.currencyOut.amountFormatted} ${details.currencyOut.currency.symbol} (chain ${resolvedDest}). Total fees: $${fees.relayer.amountUsd}. ETA: ~${details.timeEstimate}s.${depositSummary}`;

      const deeplinkUrl = await buildRelayAppUrl({
        destinationChainId: resolvedDest,
        fromChainId: resolvedOrigin,
        fromCurrency: resolvedCurrency,
        toCurrency: resolvedCurrency,
        amount: details.currencyIn.amountFormatted,
        toAddress: recipient,
      });

      const content: Array<
        | { type: "text"; text: string }
        | {
            type: "resource_link";
            uri: string;
            name: string;
            description: string;
            mimeType: string;
          }
      > = [
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
                gas: {
                  formatted: fees.gas.amountFormatted,
                  usd: fees.gas.amountUsd,
                },
                relayer: {
                  formatted: fees.relayer.amountFormatted,
                  usd: fees.relayer.amountUsd,
                },
              },
              totalImpact: details.totalImpact,
              timeEstimateSeconds: details.timeEstimate,
              rate: details.rate,
              ...(depositAddress ? { depositAddress } : {}),
              ...(includeSteps ? { steps } : { stepsCount: steps.length }),
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
          description:
            "Open the Relay app to sign and execute this bridge",
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
