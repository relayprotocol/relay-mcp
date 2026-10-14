import { describe, it, expect, vi } from "vitest";
import type { Response } from "express";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { openAuthProvider, ACCESS_TOKEN_TTL } from "./auth.js";

const REDIRECT = "https://client.example/callback";

async function register(): Promise<OAuthClientInformationFull> {
  return openAuthProvider.clientsStore.registerClient!({
    redirect_uris: [REDIRECT],
  } as any) as Promise<OAuthClientInformationFull>;
}

async function authorize(client: OAuthClientInformationFull): Promise<string> {
  const redirect = vi.fn();
  await openAuthProvider.authorize(
    client,
    { codeChallenge: "challenge", redirectUri: REDIRECT } as any,
    { redirect } as unknown as Response
  );
  return new URL(redirect.mock.calls[0][0]).searchParams.get("code")!;
}

async function login(client: OAuthClientInformationFull) {
  const code = await authorize(client);
  return openAuthProvider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
}

describe("openAuthProvider", () => {
  it("enforces PKCE", () => {
    expect(openAuthProvider.skipLocalPkceValidation).toBeFalsy();
  });

  it("rejects unknown bearer tokens", async () => {
    await expect(openAuthProvider.verifyAccessToken("random-string")).rejects.toBeInstanceOf(
      InvalidTokenError
    );
  });

  it("rejects tampered tokens", async () => {
    const client = await register();
    const { access_token } = await login(client);
    const [body, sig] = access_token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), cid: "x" })
    ).toString("base64url");

    await expect(openAuthProvider.verifyAccessToken(`${forged}.${sig}`)).rejects.toBeInstanceOf(
      InvalidTokenError
    );
  });

  it("issues short-lived access tokens that verify", async () => {
    const client = await register();
    const tokens = await login(client);

    expect(tokens.expires_in).toBe(ACCESS_TOKEN_TTL);
    expect(tokens.refresh_token).toBeDefined();
    const info = await openAuthProvider.verifyAccessToken(tokens.access_token);
    expect(info.clientId).toBe(client.client_id);
  });

  it("does not accept a refresh token as an access token", async () => {
    const client = await register();
    const { refresh_token } = await login(client);

    await expect(openAuthProvider.verifyAccessToken(refresh_token!)).rejects.toBeInstanceOf(
      InvalidTokenError
    );
  });

  it("rejects expired tokens", async () => {
    const client = await register();
    const { access_token } = await login(client);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (ACCESS_TOKEN_TTL + 1) * 1000);
    try {
      await expect(openAuthProvider.verifyAccessToken(access_token)).rejects.toBeInstanceOf(
        InvalidTokenError
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds authorization codes to the issuing client and single use", async () => {
    const client = await register();
    const other = await register();
    const code = await authorize(client);

    await expect(
      openAuthProvider.challengeForAuthorizationCode(other, code)
    ).rejects.toBeInstanceOf(InvalidGrantError);

    await openAuthProvider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    await expect(
      openAuthProvider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)
    ).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it("rejects a mismatched redirect_uri", async () => {
    const client = await register();
    const code = await authorize(client);

    await expect(
      openAuthProvider.exchangeAuthorizationCode(client, code, undefined, "https://evil.example")
    ).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it("rotates refresh tokens", async () => {
    const client = await register();
    const { refresh_token } = await login(client);

    const next = await openAuthProvider.exchangeRefreshToken(client, refresh_token!);
    await expect(openAuthProvider.verifyAccessToken(next.access_token)).resolves.toBeDefined();
    await expect(
      openAuthProvider.exchangeRefreshToken(client, refresh_token!)
    ).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it("rejects refresh tokens from another client", async () => {
    const client = await register();
    const other = await register();
    const { refresh_token } = await login(client);

    await expect(
      openAuthProvider.exchangeRefreshToken(other, refresh_token!)
    ).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it("revokes access tokens", async () => {
    const client = await register();
    const { access_token } = await login(client);

    await openAuthProvider.revokeToken!(client, { token: access_token });
    await expect(openAuthProvider.verifyAccessToken(access_token)).rejects.toBeInstanceOf(
      InvalidTokenError
    );
  });
});
