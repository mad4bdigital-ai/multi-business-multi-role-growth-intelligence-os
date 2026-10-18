// Native, stateless Streamable HTTP MCP resource with pinned OAuth JWT validation.
// NO connector Admin Recovery secret, backend API key, or token-forwarding fallback.
import { createPublicKey, verify as verifySignature } from "node:crypto";

const PROTOCOL = "2025-06-18";
const MAX_TOKEN = 8192;
const MAX_RPC_BYTES = 65536;
const CLOCK_SKEW = 30;
const MAX_LIFETIME = 60 * 60;
const NO_CACHE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  "Content-Type": "application/json; charset=utf-8" };
function err(status, code) { return { http_status: status, body: { error: code }, headers: NO_CACHE }; }
function cleanOrigin(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
    return u.origin + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, ""));
  } catch { return null; }
}
function b64json(b64) {
  if (typeof b64 !== "string" || !/^[A-Za-z0-9_-]+$/.test(b64) || b64.length > MAX_TOKEN) return null;
  try { return JSON.parse(Buffer.from(b64, "base64url").toString("utf8")); }
  catch { return null; }
}
function config(env) {
  const issuer = cleanOrigin(env.CONNECTOR_DEVICE_MCP_ISSUER);
  const resource = cleanOrigin(env.CONNECTOR_DEVICE_MCP_RESOURCE);
  const configured = String(env.CONNECTOR_DEVICE_MCP_JWKS_JSON || "");
  const environment = String(env.CONNECTOR_DEVICE_MCP_ENVIRONMENT || "");
  const expectedIssuer = environment === "staging" ? "https://dev.mad4b.com" :
    environment === "production" ? "https://auth.mad4b.com" : null;
  let keys = [];
  try {
    const decoded = JSON.parse(configured);
    if (Array.isArray(decoded.keys)) keys = decoded.keys.filter(k =>
      k?.kty === "RSA" && k?.alg === "RS256" && k?.kid &&
      k?.n && k?.e && !("d" in k) && (!k.use || k.use === "sig"));
  } catch { /* fail closed */ }
  const deviceId = String(env.CONNECTOR_DEVICE_ID || "").trim();
  const tenantId = String(env.CONNECTOR_TENANT_ID || "").trim();
  const enabled = env.CONNECTOR_DEVICE_MCP_ENABLED === "true" &&
    Boolean(issuer && issuer === expectedIssuer && resource && keys.length && deviceId && tenantId) &&
    resource === "https://connector.mad4b.com/mcp/device" && issuer !== resource;
  return { enabled, issuer, resource, keys, deviceId, tenantId, environment };
}
function auth(header, setting, now = Date.now) {
  if (!/^Bearer\s+\S+$/i.test(header || "")) return null;
  const token = header.trim().split(/\s+/)[1];
  if (!token || token.length > MAX_TOKEN || (token.match(/\./g) || []).length !== 2) return null;
  const [h, p, sig] = token.split(".");
  // Reject non-canonical base64url encodings. Node decodes ambiguous final
  // base64url characters to identical bytes; bearer strings must have one encoding.
  if (!/^[A-Za-z0-9_-]+$/.test(sig) || sig.length > MAX_TOKEN ||
      Buffer.from(sig, "base64url").toString("base64url") !== sig) return null;
  const head = b64json(h), claim = b64json(p);
  if (!head || !claim || head.alg !== "RS256" || !head.kid || head.typ && !["JWT", "at+jwt"].includes(head.typ))
    return null;
  const match = setting.keys.filter(k => k.kid === head.kid);
  if (match.length !== 1) return null;
  let verified = false;
  try {
    const key = createPublicKey({ key: match[0], format: "jwk" });
    verified = verifySignature("RSA-SHA256", Buffer.from(h + "." + p), key, Buffer.from(sig, "base64url"));
  } catch { return null; }
  if (!verified) return null;
  const second = Math.floor(now() / 1000);
  if (claim.iss !== setting.issuer ||
      !(claim.aud === setting.resource || Array.isArray(claim.aud) && claim.aud.includes(setting.resource)) ||
      claim.device_id !== setting.deviceId || claim.tenant_id !== setting.tenantId ||
      claim.environment !== setting.environment ||
      typeof claim.sub !== "string" || !claim.sub.trim() ||
      typeof (claim.azp || claim.client_id) !== "string" ||
      typeof claim.exp !== "number" || !Number.isInteger(claim.exp) ||
      typeof claim.iat !== "number" || !Number.isInteger(claim.iat) ||
      claim.exp <= second - CLOCK_SKEW || claim.iat > second + CLOCK_SKEW ||
      claim.exp - claim.iat > MAX_LIFETIME ||
      claim.nbf != null && (typeof claim.nbf !== "number" || claim.nbf > second + CLOCK_SKEW))
    return null;
  return { sub: claim.sub, clientId: claim.azp || claim.client_id, scopes: new Set(
    typeof claim.scope === "string" ? claim.scope.split(/\s+/) : []),
    deviceId: claim.device_id, tenantId: claim.tenant_id, environment: claim.environment };
}
const schemaPath = { type: "object", additionalProperties: false,
  properties: { relative_path: { type: "string" } } };
const schemaRead = { type: "object", additionalProperties: false,
  required: ["relative_path"], properties: { relative_path: { type: "string" } } };
const schemaSearch = { type: "object", additionalProperties: false,
  required: ["query"], properties: {
    relative_path: { type: "string" }, query: { type: "string" },
    mode: { type: "string", enum: ["filename", "content"] },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    cursor: { type: "integer", minimum: 0 },
  } };
const schemaSession = { type: "object", additionalProperties: false,
  required: ["session_id"], properties: {
    session_id: { type: "string" }, cursor: { type: "integer", minimum: 0 },
  } };
const schemaStart = { type: "object", additionalProperties: false, required: ["profile"],
  properties: { profile: { type: "string", enum: ["git_status", "git_log"] } } };
const schemaEmpty = { type: "object", additionalProperties: false, properties: {} };
const definitions = Object.freeze({
  devices_health: { scope: "device:status:read", description: "Read local device capability status", inputSchema: schemaEmpty },
  devices_list: { scope: "device:status:read", description: "List the single OAuth-bound local device", inputSchema: schemaEmpty },
  devices_capabilities: { scope: "device:status:read", description: "Discover enabled and disabled local device engines", inputSchema: schemaEmpty },
  files_list: { scope: "device:files:read", description: "List a bounded path within an allowlisted project", inputSchema: schemaPath, fileAction: "list" },
  files_read: { scope: "device:files:read", description: "Read one allowlisted text file", inputSchema: schemaRead, fileAction: "read" },
  files_info: { scope: "device:files:read", description: "Read file metadata and SHA-256 without content", inputSchema: schemaRead, fileAction: "info" },
  files_search: { scope: "device:files:read", description: "Bounded literal content or filename search", inputSchema: schemaSearch, fileAction: "search" },
  sessions_list: { scope: "device:terminal:read", description: "List sessions owned by the OAuth principal", inputSchema: schemaEmpty, terminalAction: "list" },
  sessions_get: { scope: "device:terminal:read", description: "Read the owned session and bounded transcript", inputSchema: schemaSession, terminalAction: "status" },
  sessions_resume: { scope: "device:terminal:read", description: "Resume an owned session transcript cursor", inputSchema: schemaSession, terminalAction: "resume" },
  sessions_close: { scope: "device:terminal:execute", description: "Close a finished session owned by this OAuth principal", inputSchema: schemaSession, terminalAction: "close" },
  terminal_cancel: { scope: "device:terminal:execute", description: "Cancel one session owned by this OAuth principal", inputSchema: schemaSession, terminalAction: "cancel" },
  terminal_output: { scope: "device:terminal:read", description: "Fetch output for an owned terminal session", inputSchema: schemaSession, terminalAction: "output" },
  terminal_start_readonly: { scope: "device:terminal:execute", description: "Start an allowlisted read-only Git probe", inputSchema: schemaStart, terminalAction: "start" },
  process_list: { scope: "device:terminal:read", description: "List processes started by this principal only", inputSchema: schemaEmpty, terminalAction: "process_list" },
  process_status: { scope: "device:terminal:read", description: "Read status of one owned process", inputSchema: schemaSession, terminalAction: "process_status" },
  process_terminate_owned: { scope: "device:terminal:execute", description: "Terminate only a process started by this OAuth principal", inputSchema: schemaSession, terminalAction: "process_terminate" },
});
function allowedTools(identity, files, terminal) {
  return Object.entries(definitions).filter(([, d]) => identity.scopes.has(d.scope) &&
    (!d.fileAction || files?.capabilities?.enabled) &&
    (!d.terminalAction || terminal?.capabilities?.enabled))
    .map(([name, d]) => ({ name, description: d.description, inputSchema: d.inputSchema }));
}
function validArgs(value, schema) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false;
  if ((schema.required || []).some(key => !Object.hasOwn(value, key))) return false;
  for (const [name, v] of Object.entries(value)) {
    const p = schema.properties[name];
    if (p.type === "string" && (typeof v !== "string" || v.length > 512)) return false;
    if (p.type === "integer" && (!Number.isSafeInteger(v) || v < (p.minimum ?? 0) || v > (p.maximum ?? 100000))) return false;
    if (p.enum && !p.enum.includes(v)) return false;
  }
  return true;
}
function rpc(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

export function createDeviceMcpResource({ env = process.env, files, terminal, now = Date.now } = {}) {
  const setting = config(env);
  const metadata = () => setting.enabled ? {
    resource: setting.resource, authorization_servers: [setting.issuer],
    scopes_supported: ["device:status:read", "device:files:read", "device:terminal:read", "device:terminal:execute"],
    bearer_methods_supported: ["header"], resource_documentation: "https://connector.mad4b.com",
  } : null;
  function handle({ authorization = "", body, contentLength = 0 } = {}) {
    if (!setting.enabled) return err(404, "native_mcp_not_configured");
    const identity = auth(authorization, setting, now);
    if (!identity) return { ...err(401, "invalid_oauth_bearer"), headers: {
      ...NO_CACHE, "WWW-Authenticate": 'Bearer resource_metadata="' + setting.resource.replace(/\/mcp\/device$/, "/.well-known/oauth-protected-resource/mcp/device") + '"',
    } };
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      JSON.stringify(body).length > MAX_RPC_BYTES || contentLength > MAX_RPC_BYTES) return err(413, "mcp_request_too_large");
    const id = Object.hasOwn(body, "id") ? body.id : null;
    if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return { http_status: 400, headers: NO_CACHE, body: rpcError(id, -32600, "Invalid JSON-RPC request") };
    }
    let response;
    if (body.method === "initialize") response = rpc(id, {
      protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "mad4b-device-gateway", version: "0.1.0" },
      instructions: "Only OAuth-scoped, device-bound capabilities. Interactive shell, file writes and arbitrary process termination are not exposed.",
    });
    else if (body.method === "ping") response = rpc(id, {});
    else if (body.method === "notifications/initialized") return { http_status: 202, headers: NO_CACHE, body: null };
    else if (body.method === "tools/list") response = rpc(id, { tools: allowedTools(identity, files, terminal) });
    else if (body.method === "tools/call") {
      const name = body.params?.name;
      const d = Object.hasOwn(definitions, name) ? definitions[name] : null;
      if (!d || !identity.scopes.has(d.scope) ||
          d.fileAction && !files?.capabilities?.enabled ||
          d.terminalAction && !terminal?.capabilities?.enabled) {
        response = rpcError(id, -32601, "Tool is not available for this OAuth grant");
      } else if (!validArgs(body.params?.arguments ?? {}, d.inputSchema)) {
        response = rpcError(id, -32602, "Invalid tool arguments");
      } else {
        const args = body.params?.arguments || {};
        let result;
        if (name === "devices_list") result = { ok: true, devices: [{ device_id: setting.deviceId, tenant_id: setting.tenantId, environment: setting.environment }], secrets_included: false };
        else if (name === "devices_capabilities") result = {
          ok: true,
          files: {
            enabled: files?.capabilities?.enabled === true,
            read_enabled: files?.capabilities?.read_enabled === true,
            write_enabled: false,
          },
          terminal: {
            enabled: terminal?.capabilities?.enabled === true,
            interactive_enabled: false,
            pty: terminal?.capabilities?.pty === true,
          },
          secrets_included: false,
        };
        else if (name === "devices_health") result = {
          ok: true, device_id: setting.deviceId, files_enabled: Boolean(files?.capabilities?.enabled),
          terminal_enabled: Boolean(terminal?.capabilities?.enabled),
          native_mcp_enabled: true, secrets_included: false };
        else if (d.fileAction) result = files.dispatch({ ...args, action: d.fileAction });
        else result = terminal.dispatch({ ...args, action: d.terminalAction,
          // Encode the entire tuple so ":" inside sub/client IDs cannot collide.
          owner_principal: "oauth:" + JSON.stringify([identity.tenantId, identity.sub, identity.clientId]) });
        response = rpc(id, { content: [{ type: "text", text: JSON.stringify(result) }],
          isError: result?.ok !== true });
      }
    } else response = rpcError(id, -32601, "Method not found");
    return { http_status: 200, headers: NO_CACHE, body: response };
  }
  return { handle, metadata, capabilities: {
    enabled: setting.enabled, oauth_resource: setting.enabled ? setting.resource : null,
    authorization_server: setting.enabled ? setting.issuer : null,
    native_mcp_protocol: PROTOCOL, stateless_http: true,
    token_binding: "RS256_pinned_jwks_issuer_audience_device_tenant_principal",
    remote_interactive_shell: false, remote_file_write: false,
    secrets_included: false,
  } };
}
