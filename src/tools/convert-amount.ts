import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Convert between human-readable token amounts and smallest-unit (wei/lamports/satoshis).
 * Pure math — no API calls needed.
 */
export function register(server: McpServer) {
  server.tool(
    "convert_amount",
    `Convert between human-readable token amounts and smallest-unit values (wei, lamports, satoshis).

Use this before calling quote/bridge/swap tools which require amounts in smallest units.

Examples:
- 1.5 ETH (18 decimals) → "1500000000000000000"
- 100 USDC (6 decimals) → "100000000"
- 0.001 BTC (8 decimals) → "100000"
- "1000000000000000000" → 1.0 (18 decimals)

Common decimals: ETH/WETH = 18, USDC/USDT = 6, BTC = 8, SOL = 9. Use get_supported_tokens or get_token_details to look up decimals for other tokens.`,
    {
      amount: z
        .string()
        .describe(
          'The amount to convert. Can be human-readable ("1.5") or smallest-unit ("1500000000000000000").'
        ),
      decimals: z
        .number()
        .int()
        .min(0)
        .max(18)
        .describe(
          "Token decimals. Common values: ETH=18, USDC=6, BTC=8, SOL=9."
        ),
      direction: z
        .enum(["toSmallestUnit", "toHuman"])
        .describe(
          '"toSmallestUnit": human → wei/lamports/satoshis. "toHuman": wei/lamports/satoshis → human-readable.'
        ),
    },
    async ({ amount, decimals, direction }) => {
      try {
        let result: string;
        if (direction === "toSmallestUnit") {
          result = toSmallestUnit(amount, decimals);
        } else {
          result = toHuman(amount, decimals);
        }

        const label =
          direction === "toSmallestUnit"
            ? `${amount} (human) → ${result} (smallest unit, ${decimals} decimals)`
            : `${amount} (smallest unit) → ${result} (human, ${decimals} decimals)`;

        return {
          content: [
            { type: "text", text: label },
            {
              type: "text",
              text: JSON.stringify({ input: amount, output: result, decimals, direction }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Conversion error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Convert a human-readable amount to smallest unit (e.g. "1.5" with 18 decimals → "1500000000000000000").
 * Uses string math to avoid floating point errors.
 */
function toSmallestUnit(amount: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid amount "${amount}" — must be a positive number (e.g. "1.5", "100").`);
  }

  const [intPart, fracPart = ""] = amount.split(".");

  if (fracPart.length > decimals) {
    throw new Error(
      `Amount "${amount}" has ${fracPart.length} decimal places but token only has ${decimals} decimals.`
    );
  }

  // Pad fractional part to exactly `decimals` digits
  const padded = fracPart.padEnd(decimals, "0");
  const raw = intPart + padded;

  // Strip leading zeros (but keep at least "0")
  return raw.replace(/^0+/, "") || "0";
}

/**
 * Convert smallest unit to human-readable (e.g. "1500000000000000000" with 18 decimals → "1.5").
 */
function toHuman(amount: string, decimals: number): string {
  if (!/^\d+$/.test(amount)) {
    throw new Error(`Invalid smallest-unit amount "${amount}" — must be a non-negative integer string.`);
  }

  if (decimals === 0) return amount;

  // Pad to at least decimals+1 chars
  const padded = amount.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);

  // Trim trailing zeros from fractional part
  const trimmed = fracPart.replace(/0+$/, "");
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}
