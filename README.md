# Relay MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for [Relay Protocol](https://relay.link) — cross-chain bridge and swap tools for AI agents.

## Tools

| Tool | Description |
|------|-------------|
| `get_supported_chains` | List supported blockchain networks |
| `get_supported_tokens` | Search for tokens across chains |
| `get_bridge_quote` | Quote for bridging same token across chains |
| `get_swap_quote` | Quote for swapping between different tokens |
| `estimate_fees` | Fee breakdown for a bridge or swap |
| `execute_bridge` | Get unsigned transaction data for execution |
| `get_transaction_status` | Check status of a relay transaction |
| `get_transaction_history` | Past transactions for a wallet |
| `get_relay_app_url` | Deep link to the Relay web app with pre-filled parameters |

## Usage

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "relay": {
      "command": "npx",
      "args": ["-y", "@relayprotocol/relay-mcp"]
    }
  }
}
```

### Run from source

```bash
npm install
npm run build
npm start
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_API_URL` | `https://api.relay.link` | Relay API base URL |
| `RELAY_API_KEY` | — | Optional API key for higher rate limits |

## Architecture

- **Transport:** Stdio (MCP spec)
- **Runtime:** Node.js
- **API:** Direct HTTP calls to `api.relay.link` (no SDK dependency)
- **Signing:** The server returns unsigned transactions. Your agent's wallet infrastructure (Privy, Dynamic, Turnkey, etc.) handles signing and broadcasting.

## Agent flow example

```
User: "Bridge 0.1 ETH from Ethereum to Base"

1. Agent calls get_supported_chains → resolves Ethereum=1, Base=8453
2. Agent calls get_bridge_quote → gets quote with fees and ETA
3. Agent shows user the quote for confirmation
4. Agent calls execute_bridge → gets unsigned transaction + requestId
5. Agent signs and broadcasts tx via wallet infrastructure
6. Agent calls get_transaction_status(requestId) → polls until success
7. Agent confirms completion to user
```

## License

MIT
