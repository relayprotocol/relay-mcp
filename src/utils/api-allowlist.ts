// Default-deny: only read-only endpoints belong here; never add state-changing ones.

export type AllowedMethod = "GET" | "POST";

export const ALLOWED_ENDPOINTS: Record<string, AllowedMethod[]> = {
  "/chains": ["GET"],
  "/chains/health": ["GET"],
  "/chains/liquidity": ["GET"],
  "/chains/{chainId}/currencies/{address}": ["GET"],
  "/chains/{chainId}/currencies/{address}/chart": ["GET"],
  "/config": ["GET"],
  "/config/v2": ["GET"],
  "/currencies/classifications": ["GET"],
  "/currencies/token/price": ["GET"],
  "/currencies/token/price/v2": ["GET"],
  "/currencies/trending": ["GET"],
  "/currencies/v1": ["POST"],
  "/currencies/v2": ["POST"],
  "/intents/status": ["GET"],
  "/intents/status/v2": ["GET"],
  "/intents/status/v3": ["GET"],
  "/price": ["POST"],
  "/prices/rates": ["GET"],
  "/quote": ["POST"],
  "/quote/v2": ["POST"],
  "/requests/v2": ["GET"],
  "/requests/v3": ["GET"],
  "/swap-sources": ["GET"],
  "/app-fees/{wallet}/balances": ["GET"],
  "/app-fees/{wallet}/claims": ["GET"],
};

const SAFE_PATH = /^\/[A-Za-z0-9/_.:-]*$/;

const MATCHERS = Object.entries(ALLOWED_ENDPOINTS).map(([template, methods]) => ({
  regex: new RegExp(
    "^" + template.replace(/\{[^}]+\}/g, "[A-Za-z0-9_.:-]+") + "$"
  ),
  methods,
}));

export function isAllowedEndpoint(method: string, path: string): boolean {
  // fetch() resolves dot segments, so "/quote/../execute" must never reach the matcher.
  if (!SAFE_PATH.test(path) || path.split("/").some((s) => s === "." || s === "..")) {
    return false;
  }
  return MATCHERS.some(
    (m) => m.regex.test(path) && m.methods.includes(method as AllowedMethod)
  );
}

export function isAllowedSpecPath(template: string, method: string): boolean {
  return (
    ALLOWED_ENDPOINTS[template]?.includes(method.toUpperCase() as AllowedMethod) ??
    false
  );
}
