import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getIntentStatus, getRequestByHash } from "../relay-api.js";
import {
  validateRequestId,
  validateTxHash,
  validationError,
} from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "get_transaction_status",
    `Check the status of a Relay bridge or swap transaction.

Accepts either a requestId (from a previous quote/execution) or a txHash (on-chain transaction hash) to look up the request.

Note: Quotes expire in ~30 seconds. If tracking a completed transaction, use the requestId from the execution response or the on-chain txHash — not the quote ID.

If get_transaction_status returns "not found" for a tx you know exists on-chain, use index_transaction to tell Relay to index it.

Statuses: waiting (broadcast, not confirmed) → pending (relay processing) → success (funds arrived) | failure | refund.`,
    {
      requestId: z
        .string()
        .optional()
        .describe(
          "The Relay request ID (0x-prefixed, 66 chars). Provide this OR txHash."
        ),
      txHash: z
        .string()
        .optional()
        .describe(
          "On-chain transaction hash to look up. Provide this OR requestId."
        ),
    },
    async ({ requestId, txHash }) => {
      if (!requestId && !txHash) {
        return {
          content: [
            {
              type: "text",
              text: "Provide either requestId or txHash to check transaction status.",
            },
          ],
          isError: true,
        };
      }

      // Validate inputs
      if (requestId) {
        const err = validateRequestId(requestId);
        if (err) return validationError(err);
      }
      if (txHash) {
        const err = validateTxHash(txHash, "txHash");
        if (err) return validationError(err);
      }

      // If txHash provided, resolve to requestId first
      let resolvedRequestId = requestId;
      try {
        if (!resolvedRequestId && txHash) {
          const result = await getRequestByHash(txHash);
          if (!result.requests?.length) {
            return {
              content: [
                {
                  type: "text",
                  text: `No Relay request found for transaction hash ${txHash}. This tx may not be a Relay transaction, or it may still be indexing.`,
                },
              ],
              isError: true,
            };
          }
          resolvedRequestId = result.requests[0].id;
        }
      } catch (err) {
        return mcpCatchError(err);
      }

      let status;
      try {
        status = await getIntentStatus(resolvedRequestId!);
      } catch (err) {
        return mcpCatchError(err);
      }
      const trackingUrl = `https://relay.link/transaction/${resolvedRequestId}`;

      let summary: string;
      switch (status.status) {
        case "success":
          summary = `Transaction complete! Destination tx: ${status.txHashes?.join(", ") || "pending confirmation"}.\n\nView on Relay: ${trackingUrl}`;
          break;
        case "pending":
          summary = "Transaction is being processed by the relay network.";
          break;
        case "waiting":
          summary =
            "Transaction submitted, waiting to be picked up by the relay network.";
          break;
        case "failure":
          summary =
            "Transaction failed. Check the requestId and try again.";
          break;
        case "refund":
          summary = "Transaction was refunded to the sender.";
          break;
        default:
          summary = `Transaction status: ${status.status}.`;
      }

      return {
        content: [
          { type: "text", text: summary },
          {
            type: "text",
            text: JSON.stringify(
              { requestId: resolvedRequestId, ...status },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
