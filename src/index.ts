import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import express from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { openAuthProvider } from "./auth.js";

// v0.2.0 tools
import { register as registerGetSupportedChains } from "./tools/get-supported-chains.js";
import { register as registerGetSupportedTokens } from "./tools/get-supported-tokens.js";
import { register as registerGetBridgeQuote } from "./tools/get-bridge-quote.js";
import { register as registerGetSwapQuote } from "./tools/get-swap-quote.js";
import { register as registerEstimateFees } from "./tools/estimate-fees.js";
import { register as registerGetTransactionStatus } from "./tools/get-transaction-status.js";
import { register as registerGetTransactionHistory } from "./tools/get-transaction-history.js";
import { register as registerGetRelayAppUrl } from "./tools/get-relay-app-url.js";
import { register as registerGetApiSchema } from "./tools/get-api-schema.js";

// v0.3.0 tools
import { register as registerCheckChainStatus } from "./tools/check-chain-status.js";
import { register as registerGetTokenPrice } from "./tools/get-token-price.js";
import { register as registerGetTokenDetails } from "./tools/get-token-details.js";
import { register as registerGetTrendingTokens } from "./tools/get-trending-tokens.js";
import { register as registerGetSwapSources } from "./tools/get-swap-sources.js";
import { register as registerGetAppFees } from "./tools/get-app-fees.js";
import { register as registerIndexTransaction } from "./tools/index-transaction.js";
import { register as registerGetMultiInputQuote } from "./tools/get-multi-input-quote.js";
import { register as registerConvertAmount } from "./tools/convert-amount.js";

function createServer() {
  const server = new McpServer({
    name: "relay-mcp",
    version: "0.3.0",
    icons: [
      {
        src: "https://docs.relay.link/favicon.png",
        mimeType: "image/png",
        sizes: ["32x32"],
        theme: "dark",
      },
      {
        src: "https://docs.relay.link/logo/relay-black.svg",
        mimeType: "image/svg+xml",
        sizes: ["any"],
        theme: "light",
      },
      {
        src: "https://docs.relay.link/logo/relay-white.svg",
        mimeType: "image/svg+xml",
        sizes: ["any"],
        theme: "dark",
      },
    ],
  });

  // Resources
  server.resource("relay-docs", "relay://docs/llms.txt", {
    description:
      "Relay Protocol documentation overview — API endpoints, chain support, and quick-start integration guide. Use this first for general context.",
    mimeType: "text/plain",
  }, async () => {
    const res = await fetch("https://docs.relay.link/llms.txt");
    if (!res.ok) throw new Error(`Failed to fetch llms.txt (${res.status})`);
    const text = await res.text();
    return { contents: [{ uri: "relay://docs/llms.txt", mimeType: "text/plain", text }] };
  });

  server.resource("relay-docs-full", "relay://docs/llms-full.txt", {
    description:
      "Comprehensive Relay Protocol documentation (~30K words) — deep coverage of deposit addresses, gasless execution, app fees, fee sponsorship, gas top-up, error handling, rate limits, and contract compatibility. Use when you need detailed feature docs beyond the overview.",
    mimeType: "text/plain",
  }, async () => {
    const res = await fetch("https://docs.relay.link/llms-full.txt");
    if (!res.ok) throw new Error(`Failed to fetch llms-full.txt (${res.status})`);
    const text = await res.text();
    return { contents: [{ uri: "relay://docs/llms-full.txt", mimeType: "text/plain", text }] };
  });

  // Core tools (v0.2.0)
  registerGetSupportedChains(server);
  registerGetSupportedTokens(server);
  registerGetBridgeQuote(server);
  registerGetSwapQuote(server);
  registerEstimateFees(server);
  registerGetTransactionStatus(server);
  registerGetTransactionHistory(server);
  registerGetRelayAppUrl(server);
  registerGetApiSchema(server);

  // v0.3.0 tools
  registerCheckChainStatus(server);
  registerGetTokenPrice(server);
  registerGetTokenDetails(server);
  registerGetTrendingTokens(server);
  registerGetSwapSources(server);
  registerGetAppFees(server);
  registerIndexTransaction(server);
  registerGetMultiInputQuote(server);
  registerConvertAmount(server);

  return server;
}

// Smithery sandbox export for tool scanning
export function createSandboxServer() {
  return createServer();
}

async function main() {
  const mode = process.env.MCP_TRANSPORT || "stdio";

  if (mode === "http") {
    const port = parseInt(process.env.PORT || "3000", 10);
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
    const app = express();
    app.use(express.json());

    // OAuth auth router (handles /.well-known/*, /authorize, /token, /register)
    app.use(
      mcpAuthRouter({
        provider: openAuthProvider,
        issuerUrl: new URL(baseUrl),
        baseUrl: new URL(baseUrl),
        serviceDocumentationUrl: new URL("https://docs.relay.link"),
      })
    );

    // Bearer auth middleware for MCP endpoints
    const auth = requireBearerAuth({ verifier: openAuthProvider });

    // Track transports per session for cleanup
    const transports = new Map<string, StreamableHTTPServerTransport>();

    app.post("/mcp", auth, async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        // Existing session
        await transports.get(sessionId)!.handleRequest(req, res, req.body);
      } else {
        // New session — create server + transport
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
        };
        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        // Session ID is generated during handleRequest, so store after
        if (transport.sessionId) transports.set(transport.sessionId, transport);
      }
    });

    app.get("/mcp", auth, async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res);
      } else {
        res.status(400).json({ error: "No valid session. Send a POST to /mcp first." });
      }
    });

    app.delete("/mcp", auth, async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.close();
        transports.delete(sessionId);
        res.status(200).json({ message: "Session closed" });
      } else {
        res.status(404).json({ error: "Session not found" });
      }
    });

    // Health check (no auth needed)
    app.get("/health", (_req, res) => {
      res.json({ status: "ok", tools: 18, version: "0.3.0", sessions: transports.size });
    });

    app.listen(port, "0.0.0.0", () => {
      console.log(`Relay MCP server running on http://0.0.0.0:${port}/mcp`);
    });
  } else {
    // Default: stdio mode for local use
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main();
