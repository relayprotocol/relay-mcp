import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getIntentStatus } from "../relay-api.js";

export function register(server: McpServer) {
  server.tool(
    "get_transaction_status",
    "Check the status of a Relay bridge or swap transaction. Statuses: waiting (submitted), pending (processing), success (complete), failure, refund. Use the requestId returned from execute_bridge.",
    {
      requestId: z
        .string()
        .describe(
          "The request ID returned from execute_bridge or from a quote's steps[].requestId."
        ),
    },
    async ({ requestId }) => {
      const status = await getIntentStatus(requestId);

      let summary: string;
      switch (status.status) {
        case "success":
          summary = `Transaction complete. Destination tx: ${status.txHashes?.join(", ") || "pending confirmation"}.`;
          break;
        case "pending":
          summary = "Transaction is being processed by the relay network.";
          break;
        case "waiting":
          summary = "Transaction submitted, waiting to be picked up by the relay network.";
          break;
        case "failure":
          summary = "Transaction failed. Check the requestId and try again.";
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
          { type: "text", text: JSON.stringify(status, null, 2) },
        ],
      };
    }
  );
}
