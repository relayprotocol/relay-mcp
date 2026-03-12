import { describe, it, expect } from "vitest";
import { categorizeError, formatErrorResponse, type RelayError } from "./errors.js";

// ─── categorizeError ──────────────────────────────────────────────

describe("categorizeError", () => {
  it("categorizes 429 as rate_limit (retryable)", () => {
    const err = new Error("Relay API POST /quote/v2 failed (429): too many requests");
    const result = categorizeError(err);
    expect(result.category).toBe("rate_limit");
    expect(result.httpCode).toBe(429);
    expect(result.retryable).toBe(true);
  });

  it("categorizes 401 as auth (not retryable)", () => {
    const err = new Error("Relay API GET /chains failed (401): unauthorized");
    const result = categorizeError(err);
    expect(result.category).toBe("auth");
    expect(result.httpCode).toBe(401);
    expect(result.retryable).toBe(false);
  });

  it("categorizes 403 as auth (not retryable)", () => {
    const err = new Error("Relay API POST /execute failed (403): forbidden");
    const result = categorizeError(err);
    expect(result.category).toBe("auth");
    expect(result.httpCode).toBe(403);
    expect(result.retryable).toBe(false);
  });

  it("categorizes 500 as server (retryable)", () => {
    const err = new Error("Relay API GET /chains failed (500): internal error");
    const result = categorizeError(err);
    expect(result.category).toBe("server");
    expect(result.httpCode).toBe(500);
    expect(result.retryable).toBe(true);
  });

  it("categorizes 502 as server (retryable)", () => {
    const err = new Error("Relay API GET /chains failed (502): bad gateway");
    const result = categorizeError(err);
    expect(result.category).toBe("server");
    expect(result.retryable).toBe(true);
  });

  it("categorizes 503 as server (retryable)", () => {
    const err = new Error("Relay API GET /chains failed (503): unavailable");
    const result = categorizeError(err);
    expect(result.category).toBe("server");
    expect(result.retryable).toBe(true);
  });

  it("categorizes 400 as api (not retryable)", () => {
    const err = new Error("Relay API POST /quote/v2 failed (400): invalid amount");
    const result = categorizeError(err);
    expect(result.category).toBe("api");
    expect(result.httpCode).toBe(400);
    expect(result.retryable).toBe(false);
    expect(result.message).toContain("invalid amount");
  });

  it("categorizes 404 as api (not retryable)", () => {
    const err = new Error("Relay API GET /requests failed (404): not found");
    const result = categorizeError(err);
    expect(result.category).toBe("api");
    expect(result.httpCode).toBe(404);
    expect(result.retryable).toBe(false);
  });

  it("categorizes 'fetch failed' as network (retryable)", () => {
    const err = new Error("fetch failed: unable to connect");
    const result = categorizeError(err);
    expect(result.category).toBe("network");
    expect(result.retryable).toBe(true);
    expect(result.httpCode).toBeUndefined();
  });

  it("categorizes ECONNREFUSED as network (retryable)", () => {
    const err = new Error("ECONNREFUSED 127.0.0.1:3000");
    const result = categorizeError(err);
    expect(result.category).toBe("network");
    expect(result.retryable).toBe(true);
  });

  it("falls back to api for unknown errors", () => {
    const err = new Error("Something totally unexpected happened");
    const result = categorizeError(err);
    expect(result.category).toBe("api");
    expect(result.retryable).toBe(false);
    expect(result.message).toBe("Something totally unexpected happened");
  });

  it("handles error with no status code in message", () => {
    const err = new Error("Unknown chain \"foobar\"");
    const result = categorizeError(err);
    expect(result.category).toBe("api");
    expect(result.httpCode).toBeUndefined();
  });
});

// ─── formatErrorResponse ──────────────────────────────────────────

describe("formatErrorResponse", () => {
  it("formats rate_limit error with code and retryable", () => {
    const err: RelayError = {
      category: "rate_limit",
      message: "Rate limited — wait a moment and retry.",
      httpCode: 429,
      retryable: true,
    };
    const result = formatErrorResponse(err);
    expect(result).toBe("[rate_limit 429] Rate limited — wait a moment and retry. (retryable)");
  });

  it("formats auth error without retryable tag", () => {
    const err: RelayError = {
      category: "auth",
      message: "Authentication failed. Check RELAY_API_KEY.",
      httpCode: 401,
      retryable: false,
    };
    const result = formatErrorResponse(err);
    expect(result).toBe("[auth 401] Authentication failed. Check RELAY_API_KEY.");
    expect(result).not.toContain("retryable");
  });

  it("formats network error without code", () => {
    const err: RelayError = {
      category: "network",
      message: "Network error — check connectivity and retry.",
      retryable: true,
    };
    const result = formatErrorResponse(err);
    expect(result).toBe("[network] Network error — check connectivity and retry. (retryable)");
  });

  it("formats api error with code, no retryable", () => {
    const err: RelayError = {
      category: "api",
      message: "Bad request: invalid chain ID",
      httpCode: 400,
      retryable: false,
    };
    const result = formatErrorResponse(err);
    expect(result).toBe("[api 400] Bad request: invalid chain ID");
  });
});
