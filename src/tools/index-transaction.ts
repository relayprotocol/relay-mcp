import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { indexTransaction } from "../relay-api.js";
import { resolveChainId } from "../utils/chain-resolver.js";
import { validateTxHash, validationError } from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "index_transaction",
    `Tell Relay to index a transaction it may have missed. Use this when a bridge or swap transaction exists on-chain but doesn't appear in Relay's system (e.g. get_transaction_status returns "not found").

This is a write operation — it tells Relay's indexer to look at a specific transaction. The response confirms whether indexing was accepted.`,
    {
      chainId: z
        .union([z.number(), z.string()])
        .describe("Chain the transaction is on (ID or name like 'ethereum', 'base')."),
      txHash: z
        .string()
        .describe("Transaction hash to index. EVM: 0x-prefixed 66 chars. Bitcoin: 64 hex chars. Solana: base58 signature."),
    },
    async ({ chainId, txHash }) => {
      const hashErr = validateTxHash(txHash, "txHash");
      if (hashErr) return validationError(hashErr);

      let resolvedChainId: number;
      try {
        resolvedChainId = await resolveChainId(chainId);
      } catch (err) {
        return mcpCatchError(err);
      }

      try {
        await indexTransaction({
          chainId: resolvedChainId,
          txHash,
        });
      } catch (err) {
        return mcpCatchError(err);
      }

      return {
        content: [
          {
            type: "text",
            text: `Transaction ${txHash} submitted for indexing on chain ${resolvedChainId}. It should appear in Relay's system shortly.`,
          },
        ],
      };
    }
  );
}
