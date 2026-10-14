/**
 * OAuth provider for remote MCP clients (Claude, etc.).
 * Auto-approves all clients; tokens are HMAC-signed so they survive restarts
 * when MCP_TOKEN_SECRET is set.
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";

export const ACCESS_TOKEN_TTL = 3600 * 24;
export const REFRESH_TOKEN_TTL = 3600 * 24 * 30;
const AUTH_CODE_TTL = 600;

const secret = process.env.MCP_TOKEN_SECRET
  ? Buffer.from(process.env.MCP_TOKEN_SECRET)
  : randomBytes(32);

const clients = new Map<string, OAuthClientInformationFull>();
const codes = new Map<
  string,
  { clientId: string; codeChallenge: string; redirectUri: string; expiresAt: number }
>();
const revoked = new Map<string, { expiresAt: number }>();

type TokenType = "access" | "refresh";

interface TokenPayload {
  typ: TokenType;
  cid: string;
  exp: number;
  jti: string;
}

const now = () => Math.floor(Date.now() / 1000);

function hmac(data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

function signToken(typ: TokenType, clientId: string, ttl: number): string {
  const payload: TokenPayload = { typ, cid: clientId, exp: now() + ttl, jti: randomUUID() };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body).toString("base64url")}`;
}

function readToken(token: string, typ: TokenType): TokenPayload | undefined {
  const [body, sig, ...rest] = token.split(".");
  if (!body || !sig || rest.length) return undefined;

  const expected = hmac(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return undefined;
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return undefined;
  }
  if (payload.typ !== typ || typeof payload.exp !== "number" || payload.exp <= now()) {
    return undefined;
  }
  if (revoked.has(payload.jti)) return undefined;
  return payload;
}

function issueTokens(clientId: string): OAuthTokens {
  return {
    access_token: signToken("access", clientId, ACCESS_TOKEN_TTL),
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: signToken("refresh", clientId, REFRESH_TOKEN_TTL),
  };
}

function pruneExpired<V extends { expiresAt: number }>(map: Map<string, V>) {
  const t = now();
  for (const [k, v] of map) if (v.expiresAt <= t) map.delete(k);
}

const clientsStore: OAuthRegisteredClientsStore = {
  getClient(clientId: string) {
    return clients.get(clientId);
  },
  registerClient(client) {
    const clientId = randomUUID();
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: clientId,
      client_id_issued_at: now(),
    };
    clients.set(clientId, full);
    return full;
  },
};

function takeCode(client: OAuthClientInformationFull, authorizationCode: string) {
  const entry = codes.get(authorizationCode);
  if (!entry || entry.expiresAt <= now() || entry.clientId !== client.client_id) {
    throw new InvalidGrantError("Invalid authorization code");
  }
  return entry;
}

export const openAuthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ) {
    pruneExpired(codes);
    const code = randomUUID();
    codes.set(code, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      expiresAt: now() + AUTH_CODE_TTL,
    });

    const url = new URL(params.redirectUri);
    url.searchParams.set("code", code);
    if (params.state) url.searchParams.set("state", params.state);
    res.redirect(url.toString());
  },

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ) {
    return takeCode(client, authorizationCode).codeChallenge;
  },

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string
  ) {
    const entry = takeCode(client, authorizationCode);
    codes.delete(authorizationCode);
    if (redirectUri !== undefined && redirectUri !== entry.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match authorization request");
    }
    return issueTokens(client.client_id);
  },

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string
  ) {
    const payload = readToken(refreshToken, "refresh");
    if (!payload || payload.cid !== client.client_id) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    pruneExpired(revoked);
    revoked.set(payload.jti, { expiresAt: payload.exp });
    return issueTokens(client.client_id);
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const payload = readToken(token, "access");
    if (!payload) throw new InvalidTokenError("Invalid or expired access token");
    return {
      token,
      clientId: payload.cid,
      scopes: [],
      expiresAt: payload.exp,
    };
  },

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ) {
    const payload =
      readToken(request.token, "access") ?? readToken(request.token, "refresh");
    if (!payload || payload.cid !== client.client_id) return;
    pruneExpired(revoked);
    revoked.set(payload.jti, { expiresAt: payload.exp });
  },
};
