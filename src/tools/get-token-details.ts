import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getTokenDetails,
  getTokenChart,
  type TokenChart,
} from "../relay-api.js";
import { resolveChainId } from "../utils/chain-resolver.js";
import { validateAddress, validationError } from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";
import { NATIVE_TOKEN_ADDRESSES } from "../utils/descriptions.js";

/**
 * Slim a raw chart response (~21KB) to essentials (~3KB).
 * Keeps timestamps, close prices, and volume.
 * Drops OHLC candle data, trader counts, buy/sell breakdowns.
 * Adds summary stats for quick agent consumption.
 */
function slimChart(raw: TokenChart) {
  const timestamps = raw.t || [];
  const closes = raw.c || [];
  // Volume may come as string[] from API — coerce to numbers for stats
  const rawVolumes = raw.volume || [];
  const volumes = rawVolumes.map((v) => (typeof v === "string" ? parseFloat(v) || 0 : v));

  // Compute summary stats from close prices
  const validCloses = closes.filter((v) => typeof v === "number" && !isNaN(v));
  const stats =
    validCloses.length > 0
      ? {
          min: validCloses.reduce((a, b) => (a < b ? a : b)),
          max: validCloses.reduce((a, b) => (a > b ? a : b)),
          latest: validCloses[validCloses.length - 1],
          first: validCloses[0],
          changePercent:
            validCloses[0] !== 0
              ? (
                  ((validCloses[validCloses.length - 1] - validCloses[0]) /
                    validCloses[0]) *
                  100
                ).toFixed(2) + "%"
              : "N/A",
          dataPoints: validCloses.length,
        }
      : null;

  // Downsample if too many points (keep ~50 evenly spaced)
  const maxPoints = 50;
  let t = timestamps;
  let c = closes;
  let v = volumes;
  if (timestamps.length > maxPoints) {
    const step = Math.ceil(timestamps.length / maxPoints);
    t = timestamps.filter((_: unknown, i: number) => i % step === 0);
    c = closes.filter((_: unknown, i: number) => i % step === 0);
    v = volumes.filter((_: unknown, i: number) => i % step === 0);
  }

  return { timestamps: t, closes: c, volumes: v, stats };
}

export function register(server: McpServer) {
  server.tool(
    "get_token_details",
    `Get detailed information about a token: price, market cap, volume, liquidity, and optionally a price chart.

For just the USD price, use get_token_price instead — it's faster and simpler.
For trending tokens (discovery), use get_trending_tokens first, then this tool for deep-dives.

When includeChart is true, returns a slimmed price chart (~50 data points with close prices, volumes, and summary stats). Raw chart data is ~21KB; this tool reduces it to ~3KB.`,
    {
      chainId: z
        .union([z.number(), z.string()])
        .describe("Chain where the token lives (ID or name)."),
      address: z
        .string()
        .describe(`Token contract address. ${NATIVE_TOKEN_ADDRESSES}`),
      includeChart: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Include price chart data. Defaults to false. Adds ~3KB to response."
        ),
    },
    async ({ chainId, address, includeChart }) => {
      const addrErr = validateAddress(address, "address");
      if (addrErr) return validationError(addrErr);

      let resolvedChainId: number;
      try {
        resolvedChainId = await resolveChainId(chainId);
      } catch (err) {
        return mcpCatchError(err);
      }

      // Fetch details, optionally chart in parallel
      let details;
      let chart: ReturnType<typeof slimChart> | null = null;
      try {
        if (includeChart) {
          const [d, rawChart] = await Promise.all([
            getTokenDetails(resolvedChainId, address),
            getTokenChart(resolvedChainId, address),
          ]);
          details = d;
          chart = slimChart(rawChart);
        } else {
          details = await getTokenDetails(resolvedChainId, address);
        }
      } catch (err) {
        return mcpCatchError(err);
      }

      // Slim the details to most useful fields
      const volume24h = details.volume?.["24h"]?.usd;
      const slim: Record<string, unknown> = {
        chainId: resolvedChainId,
        address,
        symbol: details.symbol,
        name: details.name,
        decimals: details.decimals,
        price: details.price,
        marketCap: details.marketCap,
        fdv: details.fdv,
        liquidity: details.liquidity,
        volume24h,
      };
      if (details.priceChange) {
        slim.priceChange = details.priceChange;
      }
      if (chart) {
        slim.chart = chart;
      }

      const priceStr = details.price != null ? `$${details.price}` : "N/A";
      const mcapStr =
        details.marketCap != null
          ? `$${(details.marketCap / 1e6).toFixed(1)}M`
          : "N/A";
      const summary = `${details.symbol} (${details.name}) on chain ${resolvedChainId}: Price ${priceStr}, Market cap ${mcapStr}.${chart ? ` Chart: ${chart.stats?.dataPoints || 0} data points, ${chart.stats?.changePercent || "N/A"} change.` : ""}`;

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(slim, null, 2) },
        ],
      };
    }
  );
}
