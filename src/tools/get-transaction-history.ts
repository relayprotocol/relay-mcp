import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRequests } from "../relay-api.js";

export function register(server: McpServer) {
  server.tool(
    "get_transaction_history",
    "Get past Relay bridge and swap transactions for a wallet address. Returns transaction IDs, statuses, chains, and timestamps. Supports pagination via cursor.",
    {
      user: z.string().describe("Wallet address to look up."),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Max number of transactions to return. Defaults to 10."),
      cursor: z
        .string()
        .optional()
        .describe(
          "Pagination cursor from a previous response. Omit for the first page."
        ),
    },
    async ({ user, limit, cursor }) => {
      const result = await getRequests(user, limit, cursor);

      const txs = result.requests.map((r) => ({
        requestId: r.id,
        status: r.status,
        originChain: r.data.inTxs[0]?.chainId,
        destinationChain: r.data.outTxs[0]?.chainId,
        originTx: r.data.inTxs[0]?.hash,
        destinationTx: r.data.outTxs[0]?.hash,
        currency: r.data.currency,
        createdAt: r.createdAt,
      }));

      const summary = `Found ${txs.length} transaction${txs.length !== 1 ? "s" : ""} for ${user.slice(0, 6)}...${user.slice(-4)}.${result.continuation ? " More results available (use cursor to paginate)." : ""}`;

      return {
        content: [
          { type: "text", text: summary },
          {
            type: "text",
            text: JSON.stringify(
              { transactions: txs, cursor: result.continuation || null },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
