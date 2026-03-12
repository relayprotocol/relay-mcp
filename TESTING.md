# Testing Plan — relay-mcp v0.2.0

## Automated Tests

### Unit Tests (133 tests, 5 suites)

```bash
npm run test
```

| Suite | Tests | Covers |
|-------|-------|--------|
| `validators.test.ts` | 32 | `validateHex64`, `validateAddresses`, address/amount/chainId/txHash/requestId validation |
| `chain-resolver.test.ts` | 25 | Alias resolution, fuzzy matching (Dice coefficient), numeric passthrough, errors, caching |
| `errors.test.ts` | 16 | Error categorization by HTTP status, `mcpCatchError()` return shape, network/timeout/auth/rate-limit buckets |
| `deeplink.test.ts` | 11 | URL construction for bridge/swap deeplinks, chain name lookup, optional params, recipient handling |
| `tools.test.ts` | 49 | Every tool handler happy path + error paths (mocked API). All 9 tools including `get_api_schema` and `get_transaction_status` txHash lookup |

### Integration Tests (14 tests, live API)

```bash
npm run test:integration
```

Hits the real Relay API:
- `getChains` — fetches live chain list
- `getQuote` — real quote for ETH bridge
- `getRequests` — transaction history lookup
- `getIntentStatus` — status check by request ID
- `getRequestByHash` — tx hash → request resolution
- `getOpenApiSpec` — OpenAPI spec fetch
- Chain resolution end-to-end ("base" → 8453)

### Build

```bash
npm run build
```

TypeScript compile — 21 files → `dist/`, zero errors expected.

---

## Manual Testing Checklist

Run these before merging. Each test targets a gap that automated tests can't cover (mocked APIs hide real-world shape mismatches).

### 1. MCP Inspector Smoke Test

Wire up the built server with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) and call each tool interactively:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

- [ ] `get_supported_chains()` — returns slim chain objects (no `httpRpcUrl`, `contracts`, `solverAddresses`)
- [ ] `get_api_schema()` — lists all public endpoints
- [ ] `get_api_schema({ endpoint: "quote" })` — shows params + response shape
- [ ] `get_bridge_quote({ originChainId: "ethereum", destinationChainId: "base", ... })` — accepts chain names
- [ ] `get_swap_quote({ originChainId: 8453, ... })` — accepts numeric chain IDs
- [ ] `estimate_fees(...)` — returns fee breakdown
- [ ] `get_transaction_status({ txHash: "0x..." })` — resolves hash → status
- [ ] `get_transaction_status({ requestId: "0x..." })` — direct request ID lookup
- [ ] `get_transaction_history({ user: "0x..." })` — slim response shape

Why: Unit tests mock the API. This catches serialization issues, Zod schema mismatches, or MCP protocol-level problems that mocks hide.

### 2. Chain Name Resolution Edge Cases

Call `get_bridge_quote` or `get_swap_quote` with these chain name variants against the live API:

- [ ] `"arbitrum"` → should resolve to 42161
- [ ] `"arb"` → alias → 42161
- [ ] `"Arbitrum One"` → display name match → 42161
- [ ] `"zora"` → 7777777
- [ ] `"op"` / `"optimism"` → 10
- [ ] `"base"` → 8453
- [ ] `"polygon"` → 137
- [ ] `"bsc"` / `"bnb"` → 56
- [ ] `"avax"` / `"avalanche"` → 43114
- [ ] `"soneium"` → should fuzzy match if within threshold
- [ ] `"notachain"` → should return a clean error, not crash

Why: The fuzzy matcher (Dice coefficient, threshold 0.4) works in tests with mock data, but the real chain list may have names that trip up the threshold.

### 3. Failure-Then-Retry

Test that transient failures don't permanently break the server:

1. Disconnect network (airplane mode or `sudo ifconfig en0 down`)
2. Call `get_supported_chains()` — should get a clean error
3. Reconnect network
4. Call `get_supported_chains()` again — **should succeed** (not return cached rejection)
5. Repeat with `get_api_schema()` to verify spec cache also resets

Why: Fix 4 in the simplify review addressed permanent failure caching. This validates the `.catch(() => { cache = null })` pattern works end-to-end, not just in mocked tests.

### 4. Transaction History Pagination

```
get_transaction_history({ user: "<whale-address>", limit: 5 })
```

Then paginate:
```
get_transaction_history({ user: "<whale-address>", limit: 5, cursor: "<cursor-from-previous>" })
```

- [ ] First page returns 5 txs + a cursor
- [ ] Second page returns different txs
- [ ] Response shape is slim (no deep nested fee structures)
- [ ] `originChain`, `destinationChain`, `originTx`, `destinationTx` fields are present

Why: Response slimming changes may not match real response shapes if the API has evolved. Pagination cursor handling is only tested with mocks.

### 5. Concurrent Tool Calls

MCP clients can fire multiple tools at once. Test cold-start concurrency:

1. Restart the MCP server (fresh process, empty caches)
2. Simultaneously call `get_bridge_quote(originChainId: "base", ...)` and `get_swap_quote(originChainId: "ethereum", ...)`
3. Both should succeed
4. Check server logs — `/chains` should only be fetched **once** (not twice)

Why: Promise caching in `getChains()` should deduplicate, but a race condition where two promises get created before the first assignment would bypass it. The `let` + immediate assignment pattern should prevent this in single-threaded Node, but worth confirming.

### 6. Error Message Quality

Call tools with intentionally bad inputs and verify errors are actionable:

- [ ] `get_bridge_quote({ sender: "not-an-address", ... })` → validation error mentioning "sender"
- [ ] `get_bridge_quote({ originChainId: "notachain", ... })` → chain resolution error
- [ ] `get_bridge_quote({ amount: "-100", ... })` → amount validation error
- [ ] `get_transaction_status({})` → "Provide either requestId or txHash"
- [ ] `get_transaction_status({ txHash: "0xdeadbeef..." })` → "No Relay request found" (not a crash)

Why: Agents consume these error messages to self-correct. Vague errors like "400 Bad Request" waste agent tokens on retries.

---

## What's NOT Tested Yet (Future PR)

- **`resolveTokenAddress()`** — Exported from chain-resolver but not integrated into any tool. Tools still require raw contract addresses. Worth wiring up in a future PR so agents can say "USDC" instead of `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`.
- **Rate limiting** — No tests for how the server behaves when Relay API returns 429s. The error categorizer tags them as `rate_limit` + `retryable: true`, but there's no backoff/retry logic.
- **WebSocket/SSE transport** — Currently stdio only. If the server needs to support HTTP transport, tool registration and error handling would need re-testing.
