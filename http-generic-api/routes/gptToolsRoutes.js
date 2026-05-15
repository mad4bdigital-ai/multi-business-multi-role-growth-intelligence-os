import { Router } from "express";
import { getPool } from "../db.js";

// Meta-operations that live in the GPT schema itself — never callable via tools/call
const RESERVED_TOOL_KEYS = new Set([
  "activation_session_context",
  "gpt_tools_list",
  "gpt_tools_call",
  "gpt_session_turn",
  "gpt_session_end",
]);

const TOOLS_TABLE = {
  admin: "admin_platform_endpoint_tools",
  tenant: "tenant_platform_endpoint_tools",
};

function resolveCallerType(req) {
  if (req.auth?.mode === "backend_api_key" || req.auth?.is_admin === true) return "admin";
  return "tenant";
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

async function fetchTools(callerType) {
  const table = TOOLS_TABLE[callerType] || TOOLS_TABLE.tenant;
  const [rows] = await getPool().query(
    `SELECT tool_key, display_name, description, http_method, http_path,
            path_param_keys, input_schema, tags
     FROM \`${table}\`
     WHERE is_enabled = 1
     ORDER BY sort_order ASC, tool_key ASC`
  );
  return rows.map((r) => ({
    name: r.tool_key,
    displayName: r.display_name,
    description: r.description,
    method: r.http_method,
    path: r.http_path,
    tags: r.tags ? r.tags.split(",").map((t) => t.trim()) : [],
    inputSchema: parseJson(r.input_schema),
  }));
}

async function dispatchTool(callerType, toolKey, args, req) {
  const table = TOOLS_TABLE[callerType] || TOOLS_TABLE.tenant;
  const [rows] = await getPool().query(
    `SELECT http_method, http_path, path_param_keys, fixed_body
     FROM \`${table}\`
     WHERE tool_key = ? AND is_enabled = 1
     LIMIT 1`,
    [toolKey]
  );

  if (!rows[0]) {
    return { status: 404, body: { ok: false, error: { code: "tool_not_found", message: `Tool '${toolKey}' not found.` } } };
  }

  const { http_method: method, http_path: pathTemplate } = rows[0];
  const pathParamKeys = parseJson(rows[0].path_param_keys) || [];
  const fixedBody = parseJson(rows[0].fixed_body) || {};
  const remaining = { ...args };

  // Substitute path parameters
  let path = pathTemplate;
  for (const key of pathParamKeys) {
    const val = args[key];
    if (val === undefined || val === null) {
      return { status: 400, body: { ok: false, error: { code: "missing_path_param", message: `Path parameter '${key}' is required for tool '${toolKey}'.` } } };
    }
    path = path.replace(`{${key}}`, encodeURIComponent(String(val)));
    delete remaining[key];
  }

  const internalBase = process.env.INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 8080}`;
  const httpMethod = method.toUpperCase();
  let url = `${internalBase}${path}`;

  const fetchOpts = {
    method: httpMethod,
    headers: {
      "Content-Type": "application/json",
      "Authorization": req.headers.authorization || "",
      "X-Forwarded-For": req.ip || "",
    },
    signal: AbortSignal.timeout(300_000),
  };

  if (httpMethod === "GET" || httpMethod === "DELETE") {
    const qs = Object.keys(remaining).length
      ? "?" + new URLSearchParams(
          Object.fromEntries(
            Object.entries(remaining).filter(([, v]) => v !== undefined && v !== null)
          )
        ).toString()
      : "";
    url += qs;
  } else {
    // fixed_body provides defaults (e.g. sub-tool name); caller arguments take priority
    fetchOpts.body = JSON.stringify({ ...fixedBody, ...remaining });
  }

  const response = await fetch(url, fetchOpts);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

export function buildGptToolsRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // GET /gpt/tools
  router.get("/gpt/tools", requireBackendApiKey, async (req, res) => {
    try {
      const callerType = resolveCallerType(req);
      const tools = await fetchTools(callerType);
      return res.status(200).json({ ok: true, caller_type: callerType, count: tools.length, tools });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tools_list_failed", message: err.message } });
    }
  });

  // POST /gpt/tools/call
  router.post("/gpt/tools/call", requireBackendApiKey, async (req, res) => {
    try {
      const body = req.body || {};
      // Accept both "tool_args" (preferred — avoids OpenAI reserved-keyword conflict) and legacy "arguments"
      const args = body.tool_args ?? body.arguments ?? {};
      const { name } = body;
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_name", message: "name is required." } });
      }
      if (RESERVED_TOOL_KEYS.has(name)) {
        return res.status(400).json({ ok: false, error: { code: "reserved_tool", message: `'${name}' is a meta-operation; call it directly via its schema path.` } });
      }

      const callerType = resolveCallerType(req);
      const result = await dispatchTool(callerType, name, args, req);
      return res.status(result.status).json(result.body);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tool_call_failed", message: err.message } });
    }
  });

  return router;
}
