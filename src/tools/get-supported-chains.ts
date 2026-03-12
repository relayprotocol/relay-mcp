import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getChains, type Chain } from "../relay-api.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "get_supported_chains",
    "List all blockchain networks supported by Relay for bridging and swapping. Returns chain IDs, names, native currencies, and status. Use this to resolve chain names to chain IDs before calling other tools.",
    {
      vmType: z
        .string()
        .optional()
        .describe(
          'Filter by virtual machine type (e.g. "evm", "svm"). Omit for all chains.'
        ),
    },
    async ({ vmType }) => {
      let chains: Chain[];
      try {
        ({ chains } = await getChains());
      } catch (err) {
        return mcpCatchError(err);
      }

      let filtered = chains.filter((c: Chain) => !c.disabled);
      if (vmType) {
        filtered = filtered.filter(
          (c: Chain) => c.vmType.toLowerCase() === vmType.toLowerCase()
        );
      }

      const simplified = filtered.map((c: Chain) => ({
        chainId: c.id,
        name: c.displayName,
        vmType: c.vmType,
        nativeCurrency: c.currency.symbol,
        depositEnabled: c.depositEnabled,
      }));

      const summary = `Found ${simplified.length} supported chain${simplified.length !== 1 ? "s" : ""}${vmType ? ` (${vmType})` : ""}. Examples: ${simplified
        .slice(0, 5)
        .map((c) => `${c.name} (${c.chainId})`)
        .join(", ")}${simplified.length > 5 ? "..." : ""}.`;

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(simplified, null, 2) },
        ],
      };
    }
  );
}
