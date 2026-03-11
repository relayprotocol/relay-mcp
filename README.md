# Relay MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for [Relay Protocol](https://relay.link) — cross-chain bridge and swap tools for AI agents.

[![Install with Cursor](https://img.shields.io/badge/Cursor-Install%20MCP-blue?style=flat&logo=cursor)](cursor://anysphere.cursor-deeplink/mcp/install?name=relay&type=command&command=npx&args=-y%20%40relayprotocol%2Frelay-mcp)

## Tools

| Tool | Description |
|------|-------------|
| `get_supported_chains` | List supported blockchain networks |
| `get_supported_tokens` | Search for tokens across chains |
| `get_bridge_quote` | Quote for bridging same token across chains |
| `get_swap_quote` | Quote for swapping between different tokens |
| `estimate_fees` | Fee breakdown for a bridge or swap |
| `get_transaction_status` | Check status of a relay transaction |
| `get_transaction_history` | Past transactions for a wallet |
| `get_relay_app_url` | Deep link to the Relay web app with pre-filled parameters |

## Usage

### Claude Desktop / Claude Code

Add to your `claude_desktop_config.json` or `.claude.json`:

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

### Cursor

Add to `.cursor/mcp.json`:

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
- **Runtime:** Node.js >=20
- **API:** Direct HTTP calls to `api.relay.link` (no SDK dependency)
- **Read-only:** Returns quotes, fees, and status. Does not sign or broadcast transactions.

## Agent flow example

```
User: "Bridge 0.1 ETH from Ethereum to Base"

1. Agent calls get_supported_chains → resolves Ethereum=1, Base=8453
2. Agent calls get_bridge_quote → gets quote with fees and ETA
3. Agent shows user the quote and a link to execute on relay.link
```

## License

MIT
