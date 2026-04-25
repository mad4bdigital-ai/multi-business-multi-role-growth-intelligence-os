import { isBackendApiKeyEnabled } from "./runtimeGuards.js";

// Ensure the token is strictly via URL (?token=...)
export function requireMcpToken(req, res, next) {
  // Reject Authorization header entirely for MCP
  if (req.header("Authorization")) {
    return res.status(400).json({
      ok: false,
      error: { code: "invalid_auth_method", message: "MCP contract strictly requires token_in_url. Authorization headers are rejected." }
    });
  }

  if (!isBackendApiKeyEnabled(process.env)) return next();
  const expected = process.env.BACKEND_API_KEY;
  const token = req.query.token;

  if (token !== expected) {
    return res.status(401).json({
      ok: false,
      error: { code: "unauthorized", message: "Invalid MCP token." }
    });
  }
  next();
}

// Ensure transport uses valid Accept types
export function requireMcpAcceptHeader(req, res, next) {
  const accept = req.header("Accept") || "";
  if (!accept.includes("application/json") && !accept.includes("text/event-stream")) {
    return res.status(406).json({
      ok: false,
      error: { code: "not_acceptable", message: "MCP contract requires Accept: application/json or text/event-stream" }
    });
  }
  next();
}

export async function mcpInitialize(req, res) {
  return res.json({
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {
        listChanged: true
      }
    },
    serverInfo: {
      name: "multi-business-growth-intelligence-os",
      version: "1.0.0"
    }
  });
}

export async function mcpToolsList(req, res) {
  // Uses cached layer to prevent heavy registry polling on each list request
  return res.json({
    tools: [
      {
        name: "execute_action",
        description: "Executes a governed registry action.",
        inputSchema: {
          type: "object",
          properties: {
            parent_action_key: { type: "string" },
            endpoint_key: { type: "string" },
            brand: { type: "string" },
            target_key: { type: "string" }
          },
          required: ["parent_action_key", "endpoint_key"]
        }
      }
    ]
  });
}

export async function mcpToolsCall(req, res) {
  const { name, arguments: args } = req.body;
  if (name !== "execute_action") {
    return res.status(400).json({ error: `Unknown tool: ${name}` });
  }

  // To truly execute, this should pipe into the main execution route
  // For now we map it conceptually to be consumed by the execution endpoint
  return res.json({
    content: [
      {
        type: "text",
        text: JSON.stringify({ status: "MCP execution received.", args })
      }
    ]
  });
}
