import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRequests } from "../relay-api.js";
import { resolveChainId } from "../utils/chain-resolver.js";
import { validateAddress, validationError } from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "get_transaction_history",
    `Get past Relay bridge and swap transactions for a wallet address. Returns transaction IDs, statuses, chains, and timestamps. Supports pagination via cursor.

Filter by time range, origin/destination chain, or deposit address to narrow results.`,
    {
      user: z.string().describe("Wallet address to look up."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(10)
        .describe("Max number of transactions to return (1-100). Defaults to 10."),
      cursor: z
        .string()
        .optional()
        .describe(
          "Pagination cursor from a previous response. Omit for the first page."
        ),
      originChainId: z
        .union([z.number(), z.string()])
        .optional()
        .describe("Filter by origin chain (ID or name like 'ethereum', 'base')."),
      destinationChainId: z
        .union([z.number(), z.string()])
        .optional()
        .describe("Filter by destination chain (ID or name like 'base', 'arb')."),
      startTimestamp: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Filter: only transactions after this Unix timestamp (seconds)."),
      endTimestamp: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Filter: only transactions before this Unix timestamp (seconds)."),
      depositAddress: z
        .string()
        .optional()
        .describe("Filter by deposit address used in the transaction."),
    },
    async ({
      user,
      limit,
      cursor,
      originChainId,
      destinationChainId,
      startTimestamp,
      endTimestamp,
      depositAddress,
    }) => {
      // Validate wallet address
      const addrErr = validateAddress(user, "user");
      if (addrErr) return validationError(addrErr);

      // Resolve optional chain filters
      let resolvedOrigin: number | undefined;
      let resolvedDest: number | undefined;
      try {
        if (originChainId !== undefined) {
          resolvedOrigin = await resolveChainId(originChainId);
        }
        if (destinationChainId !== undefined) {
          resolvedDest = await resolveChainId(destinationChainId);
        }
      } catch (err) {
        return mcpCatchError(err);
      }

      let result;
      try {
        result = await getRequests({
          user,
          limit,
          continuation: cursor,
          originChainId: resolvedOrigin,
          destinationChainId: resolvedDest,
          startTimestamp,
          endTimestamp,
          depositAddress,
        });
      } catch (err) {
        return mcpCatchError(err);
      }

      const txs = result.requests.map((r) => {
        const route = r.data.route?.actual ?? r.data.route?.quoted;
        const input = route?.origin?.inputCurrency;
        const output = route?.destination?.outputCurrency;
        return {
          requestId: r.id,
          status: r.status,
          failReason: r.data.failReason,
          originChain: r.data.inTxs[0]?.chainId ?? input?.currency?.chainId,
          destinationChain: r.data.outTxs[0]?.chainId ?? output?.currency?.chainId,
          originTx: r.data.inTxs[0]?.txHash,
          destinationTx: r.data.outTxs[0]?.txHash,
          originCurrency: input?.currency?.symbol,
          originAmount: input?.amountFormatted,
          destinationCurrency: output?.currency?.symbol,
          destinationAmount: output?.amountFormatted,
          createdAt: r.createdAt,
        };
      });

      const filters: string[] = [];
      if (resolvedOrigin) filters.push(`origin: chain ${resolvedOrigin}`);
      if (resolvedDest) filters.push(`dest: chain ${resolvedDest}`);
      if (startTimestamp) filters.push(`after: ${new Date(startTimestamp * 1000).toISOString()}`);
      if (endTimestamp) filters.push(`before: ${new Date(endTimestamp * 1000).toISOString()}`);
      if (depositAddress) filters.push(`deposit: ${depositAddress.slice(0, 10)}...`);
      const filterStr = filters.length ? ` [${filters.join(", ")}]` : "";

      const summary = `Found ${txs.length} transaction${txs.length !== 1 ? "s" : ""} for ${user.slice(0, 6)}...${user.slice(-4)}${filterStr}.${result.continuation ? " More results available (use cursor to paginate)." : ""}`;

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
