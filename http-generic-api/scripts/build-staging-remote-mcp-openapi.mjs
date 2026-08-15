import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const here = path.dirname(new URL(import.meta.url).pathname);
const apiRoot = path.resolve(here, "..");
const targetPath = path.join(apiRoot, "openapi", "openapi.remote-mcp.staging.yaml");
const resource = "https://mcp_dev.mad4b.com";
const forbiddenHosts = ["auth.mad4b.com", "mcp.mad4b.com", "activation.mad4b.com", "activation_dev.mad4b.com"];
const document = {
  openapi: "3.1.0",
  info: {
    title: "Growth Intelligence Platform - Staging Remote MCP",
    version: "1.0.0-staging-mcp",
    summary: "Independent Staging Remote MCP streamable HTTP contract.",
    description: "A separate MCP protocol document for mcp_dev.mad4b.com. This is not a Tenant or Admin Custom GPT Action schema; it describes only the governed Remote MCP transport and keeps mutation scope enforcement in the runtime governance layer."
  },
  servers: [{ url: resource, description: "Staging Remote MCP resource" }],
  security: [{ remoteMcpBearerAuth: [] }],
  paths: {
    "/mcp": {
      get: {
        operationId: "remoteMcpGet",
        summary: "Read the Remote MCP transport resource",
        tags: ["remote-mcp"],
        responses: {
          "200": { description: "MCP JSON-RPC response or capability resource metadata", content: { "application/json": { schema: { $ref: "#/components/schemas/JsonRpcResponse" } } } },
          "401": { description: "OAuth bearer authorization required" },
          "404": { description: "Canonical mcp_dev host required" }
        }
      },
      post: {
        operationId: "remoteMcpJsonRpc",
        summary: "Send a Remote MCP JSON-RPC request",
        tags: ["remote-mcp"],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/JsonRpcRequest" } } } },
        responses: {
          "200": { description: "MCP JSON-RPC response", content: { "application/json": { schema: { $ref: "#/components/schemas/JsonRpcResponse" } } } },
          "401": { description: "OAuth bearer authorization required" },
          "403": { description: "Scope or write governance denied" },
          "404": { description: "Canonical mcp_dev host required" }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      remoteMcpBearerAuth: { type: "http", scheme: "bearer", bearerFormat: "OAuth 2.1 access token" }
    },
    schemas: {
      JsonRpcRequest: {
        type: "object",
        required: ["jsonrpc", "method"],
        properties: {
          jsonrpc: { type: "string", const: "2.0" },
          id: { oneOf: [{ type: "string" }, { type: "integer" }, { type: "null" }] },
          method: { type: "string" },
          params: { type: "object", additionalProperties: true }
        },
        additionalProperties: false
      },
      JsonRpcResponse: {
        type: "object",
        required: ["jsonrpc"],
        properties: {
          jsonrpc: { type: "string", const: "2.0" },
          id: { oneOf: [{ type: "string" }, { type: "integer" }, { type: "null" }] },
          result: { type: "object", additionalProperties: true },
          error: { type: "object", additionalProperties: true }
        },
        additionalProperties: false
      }
    }
  },
  "x-mad4b-environment": "staging",
  "x-mad4b-surface": "remote-mcp",
  "x-mad4b-staging-boundary": {
    resource,
    server_uri_count: 1,
    authorization_server: "https://dev.mad4b.com/auth/mcp",
    write_activation: false,
    production_hosts_forbidden_policy: "http-generic-api/config/domain-family-policy.json",
    secrets_included: false
  }
};
const output = YAML.stringify(document, { lineWidth: -1, aliasDuplicateObjects: false });
if (document.servers.length !== 1 || document.servers[0].url !== resource) throw new Error("STAGING_REMOTE_MCP_OPENAPI_FAIL_CLOSED: server URI contract invalid");
for (const host of forbiddenHosts) if (output.includes(host)) throw new Error(`STAGING_REMOTE_MCP_OPENAPI_FAIL_CLOSED: forbidden host leaked: ${host}`);
if (output.includes("CLOUDFLARE_TUNNEL_TOKEN") || output.includes("REMOTE_MCP_OAUTH_SIGNING_SECRET")) throw new Error("STAGING_REMOTE_MCP_OPENAPI_FAIL_CLOSED: secret reference leaked");
fs.writeFileSync(targetPath, output, "utf8");
console.log(JSON.stringify({ ok: true, target: targetPath, server_uri: resource, protocol: "remote_mcp", secrets_included: false }));
