/**
 * API schema discovery tool — progressive disclosure pattern.
 * Agents call with no args to list endpoints, or with an endpoint to inspect its schema.
 * Ported from relay-cli's schema introspection.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getOpenApiSpec } from "../relay-api.js";
import { mcpCatchError } from "../utils/errors.js";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"] as const;

/** Filter out internal/admin endpoints. */
const EXCLUDE_PATTERNS = [
  "/admin",
  "/lives",
  "/loadforge",
  "/conduit",
  "/provision",
  "/wallets/screen",
  "/sanctioned",
];

function getPublicPaths(
  spec: any
): Record<string, any> {
  const filtered: Record<string, any> = {};
  for (const [path, item] of Object.entries(spec.paths)) {
    if (EXCLUDE_PATTERNS.some((p) => path.includes(p))) continue;
    filtered[path] = item;
  }
  return filtered;
}

/** Keep only the latest version when multiple exist (e.g. /quote/v2 over /quote). */
function getLatestVersionPaths(
  paths: Record<string, any>
): Record<string, any> {
  const keys = Object.keys(paths);
  const result: Record<string, any> = {};

  for (const p of keys) {
    const match = p.match(/^(.+?)(?:\/v(\d+))?$/);
    if (!match) {
      result[p] = paths[p];
      continue;
    }
    const basePath = match[1];
    const version = match[2] ? parseInt(match[2], 10) : 0;
    const hasHigher = keys.some((other) => {
      const m = other.match(/^(.+?)\/v(\d+)$/);
      return m && m[1] === basePath && parseInt(m[2], 10) > version;
    });
    if (!hasHigher) result[p] = paths[p];
  }
  return result;
}

/** Summarize a JSON schema to a compact form, with depth cap. */
function summarizeSchema(schema: any, depth = 0): any {
  if (!schema) return { type: "unknown" };
  if (depth > 4) return { type: schema.type || "object", note: "(truncated)" };

  if (schema.type === "array") {
    return {
      type: "array",
      items: schema.items
        ? summarizeSchema(schema.items, depth + 1)
        : "unknown",
    };
  }

  if (schema.type === "object" || schema.properties) {
    const props: Record<string, any> = {};
    for (const [key, val] of Object.entries(schema.properties || {})) {
      const prop = val as any;
      props[key] = {
        type: prop.type || (prop.properties ? "object" : "unknown"),
        required: schema.required?.includes(key) || false,
        ...(prop.description && { description: prop.description }),
        ...(prop.enum && { enum: prop.enum }),
        ...(prop.default !== undefined && { default: prop.default }),
        ...((prop.type === "object" || prop.properties) && {
          properties: summarizeSchema(prop, depth + 1).properties,
        }),
        ...(prop.type === "array" && {
          items: summarizeSchema(prop, depth + 1).items,
        }),
      };
    }
    return { type: "object", properties: props };
  }

  return {
    type: schema.type || "unknown",
    ...(schema.enum && { enum: schema.enum }),
    ...(schema.description && { description: schema.description }),
    ...(schema.format && { format: schema.format }),
  };
}

export function register(server: McpServer) {
  server.tool(
    "get_api_schema",
    `Discover Relay API endpoints and their schemas. Two modes:

1. No arguments → lists all public endpoints (method, path, summary).
2. With endpoint → shows detailed parameter and response schemas.

Use this to explore what the API offers before calling other tools.`,
    {
      endpoint: z
        .string()
        .optional()
        .describe(
          "Endpoint path to inspect, e.g. 'quote' or '/chains'. Omit to list all endpoints."
        ),
    },
    async ({ endpoint }) => {
      let spec;
      try {
        spec = await getOpenApiSpec();
      } catch (err) {
        return mcpCatchError(err);
      }
      const publicPaths = getPublicPaths(spec);
      const latestPaths = getLatestVersionPaths(publicPaths);

      // Mode 1: list all endpoints
      if (!endpoint) {
        const rows: string[] = [];
        for (const [path, item] of Object.entries(latestPaths)) {
          const pathItem = item as any;
          for (const method of HTTP_METHODS) {
            if (pathItem[method]) {
              const op = pathItem[method];
              rows.push(
                `${method.toUpperCase().padEnd(6)} ${path}  — ${op.summary || op.description || ""}`
              );
            }
          }
        }
        rows.sort();

        return {
          content: [
            {
              type: "text",
              text: `${rows.length} public endpoints. Call get_api_schema with an endpoint path for details.\n\n${rows.join("\n")}`,
            },
          ],
        };
      }

      // Mode 2: inspect a specific endpoint
      const normalized = endpoint.startsWith("/")
        ? endpoint
        : `/${endpoint}`;

      // Find matching path (exact or partial)
      const matchKey = Object.keys(latestPaths).find(
        (p) =>
          p === normalized ||
          p.startsWith(normalized) ||
          p.includes(normalized)
      );

      if (!matchKey) {
        return {
          content: [
            {
              type: "text",
              text: `Endpoint "${endpoint}" not found. Use get_api_schema() to list all endpoints.`,
            },
          ],
          isError: true,
        };
      }

      const pathItem = latestPaths[matchKey] as any;
      const details: any = { path: matchKey, methods: {} };

      for (const method of HTTP_METHODS) {
        const op = pathItem[method];
        if (!op) continue;

        const methodDetail: any = {
          summary: op.summary || op.description || "",
        };

        // Parameters (query, path, header)
        if (op.parameters?.length) {
          methodDetail.parameters = op.parameters.map((p: any) => ({
            name: p.name,
            in: p.in,
            required: p.required || false,
            type: p.schema?.type || "string",
            ...(p.description && { description: p.description }),
            ...(p.schema?.enum && { enum: p.schema.enum }),
            ...(p.schema?.default !== undefined && {
              default: p.schema.default,
            }),
          }));
        }

        // Request body
        const bodySchema =
          op.requestBody?.content?.["application/json"]?.schema;
        if (bodySchema) {
          methodDetail.requestBody = summarizeSchema(bodySchema);
        }

        // Response
        const okResponse = op.responses?.["200"] || op.responses?.["201"];
        const responseSchema =
          okResponse?.content?.["application/json"]?.schema;
        if (responseSchema) {
          methodDetail.response = summarizeSchema(responseSchema);
        }

        details.methods[method.toUpperCase()] = methodDetail;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(details, null, 2),
          },
        ],
      };
    }
  );
}
