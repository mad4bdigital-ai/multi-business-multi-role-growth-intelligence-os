// OS-private, one-shot consent receipts for write and interactive Native Device MCP tools.
// The OAuth bearer is identity, NOT authority to write. No consent secret enters JSON-RPC.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

const TTL_MS = 90_000;
const MAX_GRANTS = 32;
const MAX_ARGS = 32 * 1024;
export const APPROVAL_TOOLS = Object.freeze([
  "files_create_directory", "files_create_file", "files_copy", "files_move",
  "files_patch", "files_rollback", "terminal_start_interactive", "terminal_input",
]);
function secureEqual(a, b) {
  if (typeof a !== "string" || !a || typeof b !== "string" || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}
function argsDigest(tool, args) {
  const serialized = JSON.stringify(canonical({ tool, arguments: args }));
  if (!serialized || Buffer.byteLength(serialized) > MAX_ARGS) return null;
  return createHash("sha256").update(serialized).digest("hex");
}
function denied(code, status = 403) {
  return { ok: false, http_status: status, code, secrets_included: false };
}
export function createDeviceMcpApprovalBroker({ env = process.env, now = Date.now } = {}) {
  const enabled = env.CONNECTOR_DEVICE_MCP_APPROVAL_ENABLED === "true" &&
    env.CONNECTOR_DEVICE_MCP_ENABLED === "true" &&
    env.CONNECTOR_DEVICE_MCP_ENVIRONMENT === "staging" &&
    typeof env.CONNECTOR_DEVICE_MCP_APPROVAL_TOKEN === "string" &&
    env.CONNECTOR_DEVICE_MCP_APPROVAL_TOKEN.length >= 24 &&
    Boolean(env.CONNECTOR_DEVICE_ID && env.CONNECTOR_TENANT_ID);
  const receipts = new Map();
  const capabilities = Object.freeze({
    enabled, one_shot: true, ttl_seconds: TTL_MS / 1000, max_pending: MAX_GRANTS,
    exact_arguments: true, approval_source: "loopback_admin_plus_separate_local_secret",
    secrets_included: false,
  });
  function purge() {
    for (const [id, receipt] of receipts)
      if (receipt.expires_at <= now()) receipts.delete(id);
  }
  function issue(body, localApproval) {
    if (!enabled) return denied("approval_broker_disabled");
    if (!secureEqual(localApproval, env.CONNECTOR_DEVICE_MCP_APPROVAL_TOKEN))
      return denied("local_consent_required");
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.hasOwn(body, "approval_token") || body.action !== "issue" ||
        body.device_id !== env.CONNECTOR_DEVICE_ID ||
        body.tenant_id !== env.CONNECTOR_TENANT_ID ||
        !APPROVAL_TOOLS.includes(body.tool)) return denied("invalid_approval_request", 400);
    const principal = [body.tenant_id, body.subject, body.client_id];
    if (principal.some(v => typeof v !== "string" || !v.trim() || v.length > 128 ||
        /[\x00-\x1f]/.test(v))) return denied("invalid_principal", 400);
    const args = body.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) return denied("invalid_arguments", 400);
    const digest = argsDigest(body.tool, args);
    if (!digest) return denied("arguments_too_large", 413);
    purge();
    if (receipts.size >= MAX_GRANTS) return denied("pending_consent_limit", 429);
    const id = randomUUID(), expires_at = now() + TTL_MS;
    receipts.set(id, {
      principal: "oauth:" + JSON.stringify(principal),
      tool: body.tool, digest, expires_at,
    });
    // The receipt ID is for local auditing, never a bearer credential or MCP argument.
    return { ok: true, http_status: 200, approval_id: id, tool: body.tool,
      expires_at: new Date(expires_at).toISOString(), one_shot: true,
      secrets_included: false };
  }
  function consume(principal, tool, args) {
    if (!enabled || !APPROVAL_TOOLS.includes(tool) || typeof principal !== "string")
      return false;
    const digest = argsDigest(tool, args);
    if (!digest) return false;
    purge();
    for (const [id, receipt] of receipts) {
      if (receipt.principal !== principal || receipt.tool !== tool ||
          !secureEqual(receipt.digest, digest)) continue;
      receipts.delete(id); // Atomic consume before privileged dispatch.
      return true;
    }
    return false;
  }
  return { issue, consume, capabilities };
}
