import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { register as registerGetSupportedChains } from "./tools/get-supported-chains.js";
import { register as registerGetSupportedTokens } from "./tools/get-supported-tokens.js";
import { register as registerGetBridgeQuote } from "./tools/get-bridge-quote.js";
import { register as registerGetSwapQuote } from "./tools/get-swap-quote.js";
import { register as registerEstimateFees } from "./tools/estimate-fees.js";
import { register as registerExecuteBridge } from "./tools/execute-bridge.js";
import { register as registerGetTransactionStatus } from "./tools/get-transaction-status.js";
import { register as registerGetTransactionHistory } from "./tools/get-transaction-history.js";
import { register as registerGetRelayAppUrl } from "./tools/get-relay-app-url.js";

const server = new McpServer({
  name: "relay-mcp",
  version: "0.1.0",
});

registerGetSupportedChains(server);
registerGetSupportedTokens(server);
registerGetBridgeQuote(server);
registerGetSwapQuote(server);
registerEstimateFees(server);
registerExecuteBridge(server);
registerGetTransactionStatus(server);
registerGetTransactionHistory(server);
registerGetRelayAppUrl(server);

const transport = new StdioServerTransport();
await server.connect(transport);
