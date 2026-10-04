/**
 * Simple open OAuth provider for remote MCP clients (Claude, etc.).
 * Auto-approves all clients — Relay's API is public, so no real auth needed.
 * This just satisfies the MCP OAuth handshake requirement.
 */

import { randomUUID } from "node:crypto";
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

// In-memory stores
const clients = new Map<string, OAuthClientInformationFull>();
const codes = new Map<
  string,
  { clientId: string; codeChallenge: string; redirectUri: string }
>();
const tokens = new Map<string, { clientId: string; expiresAt: number }>();

const clientsStore: OAuthRegisteredClientsStore = {
  getClient(clientId: string) {
    return clients.get(clientId);
  },
  registerClient(client) {
    const clientId = randomUUID();
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    clients.set(clientId, full);
    return full;
  },
};

export const openAuthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ) {
    if (!client.redirect_uris?.includes(params.redirectUri)) {
      throw new Error("Unregistered redirect URI");
    }

    // Auto-approve: generate auth code and redirect back immediately
    const code = randomUUID();
    codes.set(code, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
    });

    const url = new URL(params.redirectUri);
    url.searchParams.set("code", code);
    if (params.state) url.searchParams.set("state", params.state);
    res.redirect(url.toString());
  },

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ) {
    const entry = codes.get(authorizationCode);
    if (!entry) throw new Error("Invalid authorization code");
    return entry.codeChallenge;
  },

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ) {
    const entry = codes.get(authorizationCode);
    if (!entry) throw new Error("Invalid authorization code");
    if (entry.clientId !== client.client_id) {
      throw new Error("Authorization code was issued to a different client");
    }
    codes.delete(authorizationCode);

    const accessToken = randomUUID();
    const expiresIn = 3600 * 24 * 365; // 1 year
    tokens.set(accessToken, {
      clientId: entry.clientId,
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    });

    const result: OAuthTokens = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
    };
    return result;
  },

  async exchangeRefreshToken() {
    throw new Error("Refresh tokens not supported");
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // First check in-memory store (tokens issued this process lifetime)
    const entry = tokens.get(token);
    if (entry) {
      if (entry.expiresAt < Math.floor(Date.now() / 1000)) {
        tokens.delete(token);
        throw new Error("Token expired");
      }
      return {
        token,
        clientId: entry.clientId,
        scopes: [],
        expiresAt: entry.expiresAt,
      };
    }

    // Tokens must have been issued by this server instance. Clients reauthorize
    // after a restart instead of gaining access with an arbitrary bearer token.
    throw new Error("Invalid access token");
  },

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ) {
    tokens.delete(request.token);
  },

  

};
