import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

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

function createServer() {
  const server = new McpServer({
    name: "relay-mcp",
    version: "0.3.0",
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

  return server;
}

// Smithery sandbox export for tool scanning
export function createSandboxServer() {
  return createServer();
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
