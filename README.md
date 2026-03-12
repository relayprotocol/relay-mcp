# Relay MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for [Relay Protocol](https://relay.link) — cross-chain bridge and swap tools for AI agents.

[![Install with Cursor](https://img.shields.io/badge/Cursor-Install%20MCP-blue?style=flat&logo=cursor)](cursor://anysphere.cursor-deeplink/mcp/install?name=relay&type=command&command=npx&args=-y%20%40relayprotocol%2Frelay-mcp)

## Tools (16)

### Quoting & Routing

| Tool | Description |
|------|-------------|
| `get_bridge_quote` | Quote for bridging same token across chains |
| `get_swap_quote` | Quote for swapping between different tokens (same-chain or cross-chain) |
| `estimate_fees` | Fee breakdown for a bridge or swap route |

### Token & Chain Discovery

| Tool | Description |
|------|-------------|
| `get_supported_chains` | List supported blockchain networks (slim response) |
| `get_supported_tokens` | Search for tokens across chains |
| `get_trending_tokens` | Currently trending tokens across Relay-supported chains |
| `get_token_price` | Current USD price of a token |
| `get_token_details` | Full token fundamentals: price, market cap, volume, liquidity, optional price chart |
| `get_swap_sources` | List DEX aggregators and AMMs that Relay routes through |

### Chain Health

| Tool | Description |
|------|-------------|
| `check_chain_status` | Chain health, solver liquidity, and route configuration (3 API calls in 1 tool) |

### Transaction Tracking

| Tool | Description |
|------|-------------|
| `get_transaction_status` | Check status by request ID or on-chain tx hash |
| `get_transaction_history` | Past transactions for a wallet |
| `index_transaction` | Tell Relay to index a transaction it may have missed |

### Integrator Tools

| Tool | Description |
|------|-------------|
| `get_app_fees` | Claimable app fee balances and claim history (2 API calls in 1 tool) |
| `get_relay_app_url` | Deep link to the Relay web app with pre-filled parameters |
| `get_api_schema` | Discover Relay API endpoints and inspect their schemas |

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

## Features

- **Chain name resolution** — Pass `"base"`, `"ethereum"`, `"arb"` instead of numeric chain IDs. Supports aliases and fuzzy matching.
- **Input validation** — Addresses, amounts, and chain IDs are validated before hitting the API, with clear error messages.
- **Bundled tools** — `check_chain_status` and `get_app_fees` combine multiple API calls into single tools with parallel fetching.
- **Decision-tree descriptions** — Tool descriptions guide agents to pick the right tool ("For just the price, use `get_token_price`. For full fundamentals, use `get_token_details`.").
- **Slim responses** — Responses are trimmed to essential fields. Chart data is downsampled from ~21KB to ~3KB.
- **API schema discovery** — `get_api_schema` lets agents explore available endpoints on demand (progressive disclosure pattern).
- **Tx hash lookup** — `get_transaction_status` accepts either a request ID or an on-chain transaction hash.
- **Structured errors** — Errors are categorized (validation, api, network, rate_limit, server, auth) with retryability hints.

## Architecture

- **Transport:** Stdio (MCP spec)
- **Runtime:** Node.js >=20
- **API:** Direct HTTP calls to `api.relay.link` (no SDK dependency)
- **Read-only:** Returns quotes, fees, and status. Does not sign or broadcast transactions.

## Agent flow examples

```
User: "Bridge 0.1 ETH from Ethereum to Base"

1. Agent calls get_bridge_quote(originChainId="ethereum", destinationChainId="base", ...)
   → chain names resolved automatically, quote returned with fees and ETA
2. Agent shows user the quote and a link to execute on relay.link
```

```
User: "What tokens are trending on Base?"

1. Agent calls get_trending_tokens(chainId="base")
   → returns token identities (no prices)
2. Agent calls get_token_price for each interesting token
   → returns current USD prices
```

## License

MIT
