import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getRequestById,
  getRequestByHash,
  type RelayCurrencyAmountV3,
  type RelayRequestTxV3,
  type RelayRequestV3,
} from "../relay-api.js";
import {
  validateRequestId,
  validateTxHash,
  validationError,
} from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";
import { RELAY_APP_URL } from "../utils/descriptions.js";

function describeSide(
  side: RelayCurrencyAmountV3 | null | undefined,
  txs: RelayRequestTxV3[] | undefined,
  fallback: string
): string {
  if (side?.currency) {
    return `${side.amountFormatted} ${side.currency.symbol} on chain ${side.currency.chainId}`;
  }
  const chainId = txs?.[0]?.chainId;
  return chainId !== undefined ? `chain ${chainId}` : fallback;
}

function formatRequest(req: RelayRequestV3): {
  summary: string;
  data: Record<string, unknown>;
} {
  const trackingUrl = `${RELAY_APP_URL}/transaction/${req.id}`;
  const d = req.data;
  const route = d.route?.actual ?? d.route?.quoted;
  const input = route?.origin?.inputCurrency;
  const output = route?.destination?.outputCurrency;

  const origin = describeSide(input, d.inTxs, "unknown origin");
  const destination = describeSide(output, d.outTxs, "unknown destination");

  // Status-specific summary
  let summary: string;
  switch (req.status) {
    case "success":
      summary = `✅ Complete: ${origin} → ${destination}. Output tx: ${d.outTxs?.map((t) => t.txHash).join(", ") || "confirming"}.\n\nView: ${trackingUrl}`;
      break;
    case "pending":
      summary = `⏳ Processing: ${origin} → ${destination}. Relay is filling the order.`;
      break;
    case "waiting":
      summary = `🕐 Waiting: ${origin} → ${destination}. Submitted, awaiting relay pickup.`;
      break;
    case "failure":
      summary = `❌ Failed: ${origin} → ${destination}.${d.failReason ? ` Reason: ${d.failReason}` : ""}\n\nView: ${trackingUrl}`;
      break;
    case "refund":
      summary = `↩️ Refunded: ${origin}.${d.refundFailReason ? ` Refund issue: ${d.refundFailReason}` : ""}\n\nView: ${trackingUrl}`;
      break;
    default:
      summary = `Status "${req.status}": ${origin} → ${destination}.\n\nView: ${trackingUrl}`;
  }

  // Slim structured response
  const data: Record<string, unknown> = {
    requestId: req.id,
    status: req.status,
    user: req.user,
    recipient: req.recipient,
    origin: input || {
      chainId: d.inTxs?.[0]?.chainId,
      txHash: d.inTxs?.[0]?.txHash,
    },
    destination: output || {
      chainId: d.outTxs?.[0]?.chainId,
      txHash: d.outTxs?.[0]?.txHash,
    },
    inTxHashes: d.inTxs?.map((t) => t.txHash),
    outTxHashes: d.outTxs?.map((t) => t.txHash),
    timeEstimate: d.timeEstimate,
    createdAt: req.createdAt,
    updatedAt: req.updatedAt,
    trackingUrl,
  };

  if (d.failReason) data.failReason = d.failReason;
  if (d.refundFailReason) data.refundFailReason = d.refundFailReason;
  if (d.fees) data.fees = d.fees;
  if (d.route?.actual?.rate) data.rate = d.route.actual.rate;
  if (d.route) data.route = d.route;
  if (d.appFees?.actual?.length || d.appFees?.quoted?.length) data.appFees = d.appFees;

  return { summary, data };
}

export function register(server: McpServer) {
  server.tool(
    "get_transaction_status",
    `Check the status of a Relay bridge or swap transaction. Returns rich data including fees, token amounts, fail reasons, and route details.

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

      // Look up request — by ID or by hash
      let result;
      try {
        if (requestId) {
          result = await getRequestById(requestId);
        } else {
          result = await getRequestByHash(txHash!);
        }
      } catch (err) {
        return mcpCatchError(err);
      }

      if (!result.requests?.length) {
        const identifier = requestId || txHash;
        return {
          content: [
            {
              type: "text",
              text: `No Relay request found for ${requestId ? "request ID" : "transaction hash"} ${identifier}. This may not be a Relay transaction, or it may still be indexing. Try index_transaction if you know this tx exists on-chain.`,
            },
          ],
          isError: true,
        };
      }

      const req = result.requests[0];
      const { summary, data } = formatRequest(req);

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(data, null, 2) },
          {
            type: "resource",
            resource: {
              uri: `${RELAY_APP_URL}/transaction/${req.id}`,
              mimeType: "text/html",
              text: "View on Relay",
            },
          },
        ],
      };
    }
  );
}
