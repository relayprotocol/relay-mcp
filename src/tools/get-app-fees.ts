import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAppFeeBalances, getAppFeeClaims } from "../relay-api.js";
import { validateAddress, validationError } from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "get_app_fees",
    `Check claimable app fee balances and past claim history for an integrator wallet.

Use this to answer "how much have I earned?" or "what fees are claimable?" App fees are earned by integrators who route swaps/bridges through Relay with a referral fee configured.

Returns both current claimable balances and historical claims in one call.`,
    {
      wallet: z
        .string()
        .describe("Integrator wallet address to check app fees for."),
    },
    async ({ wallet }) => {
      const addrErr = validateAddress(wallet, "wallet");
      if (addrErr) return validationError(addrErr);

      let balancesRes, claimsRes;
      try {
        [balancesRes, claimsRes] = await Promise.all([
          getAppFeeBalances(wallet),
          getAppFeeClaims(wallet),
        ]);
      } catch (err) {
        return mcpCatchError(err);
      }

      const balances = balancesRes.balances || [];
      const claims = claimsRes.claims || [];

      const totalUsd = balances.reduce(
        (sum, b) => sum + (parseFloat(b.amountUsd) || 0),
        0
      );

      const summary = balances.length > 0
        ? `${wallet.slice(0, 6)}...${wallet.slice(-4)} has $${totalUsd.toFixed(2)} in claimable app fees across ${balances.length} token${balances.length !== 1 ? "s" : ""}. ${claims.length} past claim${claims.length !== 1 ? "s" : ""}.`
        : `No claimable app fees for ${wallet.slice(0, 6)}...${wallet.slice(-4)}. ${claims.length} past claim${claims.length !== 1 ? "s" : ""}.`;

      return {
        content: [
          { type: "text", text: summary },
          {
            type: "text",
            text: JSON.stringify(
              { balances, claims, totalClaimableUsd: totalUsd.toFixed(2) },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
