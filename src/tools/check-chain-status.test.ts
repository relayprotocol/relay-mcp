import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpToolResponse } from "../utils/validators.js";

vi.mock("../relay-api.js", () => ({
  getChains: vi.fn(),
  getChainHealth: vi.fn(),
  getChainLiquidity: vi.fn(),
  getRouteConfig: vi.fn(),
}));

import {
  getChains,
  getChainHealth,
  getChainLiquidity,
  getRouteConfig,
} from "../relay-api.js";
import { register } from "./check-chain-status.js";

type ToolHandler = (args: {
  chainId: number;
  destinationChainId?: number;
}) => Promise<McpToolResponse>;

let handler: ToolHandler;
register({
  tool: (
    _name: string,
    _description: string,
    _schema: unknown,
    callback: ToolHandler
  ) => {
    handler = callback;
  },
} as unknown as McpServer);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("check_chain_status numeric chain validation", () => {
  it.each([
    { description: "origin", chainId: 0 },
    { description: "destination", chainId: 1, destinationChainId: 1.5 },
  ])("rejects an invalid $description chain ID before API calls", async (args) => {
    const result = await handler(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^\[validation\].*positive safe integer/i);
    expect(getChains).not.toHaveBeenCalled();
    expect(getChainHealth).not.toHaveBeenCalled();
    expect(getChainLiquidity).not.toHaveBeenCalled();
    expect(getRouteConfig).not.toHaveBeenCalled();
  });
});
