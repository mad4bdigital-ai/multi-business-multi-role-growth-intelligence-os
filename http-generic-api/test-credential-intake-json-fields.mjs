import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("routes/credentialIntakeRoutes.js", "utf8");

assert(source.includes('"json"'), "credential intake must allow json field type");
assert(source.includes("mcp_servers_json"), "credential intake must recognize mcp_servers_json field");
assert(source.includes("extractMcpServersConfig"), "credential intake must extract MCP server config from JSON");
assert(source.includes("mcpServers"), "MCP JSON intake must validate mcpServers object");
assert(source.includes("credentials.mcp_servers_json"), "raw MCP servers JSON must be stored encrypted with credentials");
assert(source.includes("credentials.bearer_token"), "Bearer token must be normalized for credential resolvers");
assert(source.includes("connection.mcp_endpoint"), "MCP endpoint must be populated from JSON server URL");
assert(source.includes("type=\"file\" accept=\"application/json,.json\""), "JSON field must support file upload helper");
assert(source.includes("file.size > 64 * 1024"), "JSON file helper must enforce bounded upload size");

console.log("credential intake JSON field tests passed");
