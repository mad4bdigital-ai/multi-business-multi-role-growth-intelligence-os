import crypto from "node:crypto";

const VOLATILE_APPROVAL_ARG_KEYS = new Set([
  "approval_hold_id",
  "consent_accepted",
  "request_id",
  "trace_id",
  "session_id",
  "conversation_id",
]);

function text(value) {
  return String(value ?? "").trim();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (VOLATILE_APPROVAL_ARG_KEYS.has(key)) continue;
    const child = value[key];
    if (child === undefined) continue;
    out[key] = canonicalize(child);
  }
  return out;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function timingSafeHexEqual(left, right) {
  const a = Buffer.from(text(left), "utf8");
  const b = Buffer.from(text(right), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function localGatewayConsentRequired(tool = {}) {
  const riskClass = text(tool.risk_class).toLowerCase();
  return tool.consent_required === true
    || Number(tool.consent_required) === 1
    || tool.requires_approval === true
    || Number(tool.requires_approval) === 1
    || tool.is_consequential === true
    || Number(tool.is_consequential) === 1
    || riskClass === "high"
    || riskClass === "admin_recovery";
}

export function localGatewayConsentStatus(tool = {}, args = {}) {
  if (!localGatewayConsentRequired(tool)) return "not_required";
  return args.consent_accepted === true || args.consent_accepted === "true"
    ? "accepted"
    : "missing";
}

export function buildLocalGatewayApprovalBinding({
  toolKey,
  tenantId,
  userId,
  deviceId,
  args = {},
} = {}) {
  const canonicalArgs = canonicalize(args);
  const request = {
    version: "local_gateway_approval_binding_v1",
    tool_key: text(toolKey) || null,
    tenant_id: text(tenantId) || null,
    user_id: text(userId) || null,
    device_id: text(deviceId) || null,
    args: canonicalArgs,
  };
  return {
    version: request.version,
    tool_key: request.tool_key,
    tenant_id: request.tenant_id,
    user_id: request.user_id,
    device_id: request.device_id,
    request_digest: digest(request),
    secrets_included: false,
  };
}

export function validateLocalGatewayApprovalBinding(storedBinding, expectedBinding) {
  if (!storedBinding || typeof storedBinding !== "object") {
    return { ok: false, code: "approval_hold_binding_missing", secrets_included: false };
  }
  const keys = ["version", "tool_key", "tenant_id", "user_id", "device_id"];
  for (const key of keys) {
    if (text(storedBinding[key]) !== text(expectedBinding?.[key])) {
      return {
        ok: false,
        code: "approval_hold_binding_mismatch",
        mismatch_field: key,
        secrets_included: false,
      };
    }
  }
  if (!timingSafeHexEqual(storedBinding.request_digest, expectedBinding?.request_digest)) {
    return {
      ok: false,
      code: "approval_hold_request_digest_mismatch",
      mismatch_field: "request_digest",
      secrets_included: false,
    };
  }
  return { ok: true, code: "approval_hold_binding_valid", secrets_included: false };
}
