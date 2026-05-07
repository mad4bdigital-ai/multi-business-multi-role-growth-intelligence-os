// appAdapters/makecomMcp.js — Make.com MCP client adapter.
// Calls Make.com's MCP JSON-RPC endpoint as a client.
//
// Auth: mcp_token (bearer_token) stored in encrypted_credentials.mcp_token
// connection fields:
//   api_base_url         — Make zone base URL, e.g. https://eu2.make.com (default: https://eu1.make.com)
//   mcp_endpoint         — Full MCP endpoint URL if set, overrides api_base_url path
//   account_metadata.auth_mode — 'token_in_url' (default) or 'header'
//
// MCP transport: stateless HTTP (JSON-RPC 2.0)
//   token_in_url:  POST {base}/mcp/u/{mcp_token}/stateless
//   header:        POST {base}/mcp/stateless  +  Authorization: Bearer {mcp_token}

let _reqId = 1;

async function makeMcpCall(creds, connection, method, params = {}) {
  const token = creds.mcp_token || creds.api_key;
  if (!token) throw new Error("mcp_token required for Make.com MCP connection");

  const base = (connection.api_base_url || "https://eu1.make.com").replace(/\/$/, "");
  const authMode = connection.account_metadata?.auth_mode || "token_in_url";

  const url = authMode === "header"
    ? (connection.mcp_endpoint || `${base}/mcp/stateless`)
    : (connection.mcp_endpoint || `${base}/mcp/u/${token}/stateless`);

  const headers = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
  if (authMode === "header") headers["Authorization"] = `Bearer ${token}`;

  const body = { jsonrpc: "2.0", id: _reqId++, method, params };

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Make.com MCP returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error(`Make MCP error: ${JSON.stringify(data.error)}`);
  return data.result ?? data;
}

export const makecomMcpAdapter = {
  getDefaultGrants() {
    return [
      { action_key: "mcp_initialize",  auto_approve: true  },
      { action_key: "mcp_tools_list",  auto_approve: true  },
      { action_key: "mcp_tools_call",  auto_approve: false },
    ];
  },

  buildAuthUrl() { throw new Error("Make.com MCP uses bearer token, not OAuth"); },
  async exchangeCode() { throw new Error("Make.com MCP uses bearer token, not OAuth"); },
  async refreshAccessToken() { return {}; },

  async testConnection(creds, connection) {
    const base = (connection.api_base_url || "https://eu1.make.com").replace(/\/$/, "");
    try {
      const result = await makeMcpCall(creds, connection, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "growth-os-platform", version: "1.0.0" },
      });
      const serverName = result?.serverInfo?.name || "Make MCP";
      return {
        ok: true,
        account_label: `${serverName} (${base})`,
        account_metadata: { base, server_info: result?.serverInfo, protocol_version: result?.protocolVersion },
      };
    } catch (e) {
      return { ok: false, account_label: base, account_metadata: { base, error: e.message } };
    }
  },

  async call(action_key, args, creds, connection) {
    switch (action_key) {

      case "mcp_initialize": {
        const result = await makeMcpCall(creds, connection, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "growth-os-platform", version: "1.0.0" },
        });
        return { ok: true, result };
      }

      case "mcp_tools_list": {
        const result = await makeMcpCall(creds, connection, "tools/list", {});
        return { ok: true, result, tools: result?.tools || [] };
      }

      case "mcp_tools_call": {
        const { tool_name, tool_args = {} } = args;
        if (!tool_name) throw new Error("tool_name required");
        const result = await makeMcpCall(creds, connection, "tools/call", {
          name: tool_name,
          arguments: tool_args,
        });
        return { ok: true, result };
      }

      default:
        throw new Error(`makecom_mcp: unknown action '${action_key}'`);
    }
  },
};
