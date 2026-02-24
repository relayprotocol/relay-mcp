import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getQuote } from "../relay-api.js";
import { getSessionInfo } from "../wallet/index.js";

export function register(server: McpServer) {
  server.tool(
    "execute_bridge",
    `Get a quote and unsigned transactions for a bridge or swap via Relay. Returns ALL steps required to complete the transfer.

For ERC-20 tokens (like USDC), there are typically TWO steps:
  1. approve — An ERC-20 approval transaction allowing Relay to spend the token.
  2. deposit — The actual bridge/swap transaction.

For native tokens (ETH), there is usually just ONE step:
  1. deposit — The bridge/swap transaction.

Some routes may also include a "signature" step (EIP-712 signing instead of a transaction).

Each step has a "kind" field:
  - "transaction" → must be signed and broadcast via eth_sendTransaction
  - "signature" → must be signed via eth_signTypedData_v4, then POSTed to the Relay API

After calling this tool, pass ALL the returned steps to the wallet tool with action "execute" to sign and submit them in order. The wallet tool handles the full multi-step flow automatically.

If a wallet is connected via the wallet tool, the sender defaults to the connected address.
Returns a requestId for tracking status via get_transaction_status.`,
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
      sender: z
        .string()
        .optional()
        .describe(
          "Sender wallet address. If omitted and a wallet is connected via the wallet tool, the connected address is used."
        ),
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
      // Resolve sender from connected wallet if not provided
      const walletState = getSessionInfo();
      const resolvedSender = sender || walletState.address;

      if (!resolvedSender) {
        return {
          content: [
            {
              type: "text",
              text: 'Error: No sender address provided and no wallet connected. Either pass a sender address or connect a wallet first using the wallet tool with action "pair".',
            },
          ],
          isError: true,
        };
      }

      const quote = await getQuote({
        user: resolvedSender,
        originChainId,
        destinationChainId,
        originCurrency,
        destinationCurrency,
        amount,
        recipient,
      });

      if (!quote.steps || quote.steps.length === 0) {
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

      const { details, fees } = quote;

      // Find the requestId from the deposit step (or last step)
      const depositStep = quote.steps.find((s) => s.id === "deposit") || quote.steps[quote.steps.length - 1];
      const requestId = depositStep.requestId;

      // Build step summaries
      const stepSummaries = quote.steps.map((step, i) => {
        return `Step ${i + 1}: ${step.action} (${step.kind}, id: ${step.id})`;
      });

      const walletHint = walletState.connected
        ? ' A wallet is connected — call wallet with action "execute" and pass the steps array to sign and submit all transactions automatically.'
        : " Sign and broadcast each transaction in order, polling the check endpoint between steps, then use get_transaction_status with the requestId to track completion.";

      const summary = `Ready to execute: ${details.currencyIn.amountFormatted} ${details.currencyIn.currency.symbol} (chain ${originChainId}) → ${details.currencyOut.amountFormatted} ${details.currencyOut.currency.symbol} (chain ${destinationChainId}).\n\nSteps required (${quote.steps.length}):\n${stepSummaries.join("\n")}${walletHint}`;

      return {
        content: [
          { type: "text", text: summary },
          {
            type: "text",
            text: JSON.stringify(
              {
                steps: quote.steps,
                requestId,
                sender: resolvedSender,
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
