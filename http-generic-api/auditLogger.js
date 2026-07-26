/**
 * Audit Logger — Sprint 16
 *
 * Write-only append to audit_log. Never UPDATE or DELETE from this table.
 * Designed to be called from any route handler without blocking the response.
 */

import { getPool } from "./db.js";
import { randomUUID } from "node:crypto";

function safeJson(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serialization_error: true, secrets_included: false });
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text && text !== "null" && text !== "undefined") return text;
  }
  return null;
}

export async function writeAuditLog({
  tenant_id = null,
  workspace_id = null,
  workspace_key = null,
  actor_id = null,
  actor_type = null,
  user_id = null,
  brand_id = null,
  brand_key = null,
  request_id = null,
  session_id = null,
  conversation_id = null,
  correlation_id = null,
  execution_context_json = null,
  action,
  resource_type = null,
  resource_id = null,
  before_json = null,
  after_json = null,
  ip_address = null,
  user_agent = null,
  service_mode = "self_serve",
  metadata = null,
  outcome = null,
} = {}) {
  if (!action) throw new Error("auditLogger: action is required");
  const audit_id = randomUUID();
  const resolvedUserId = firstNonEmpty(user_id, actor_type === "user" ? actor_id : null);
  const resolvedActorType = firstNonEmpty(actor_type, actor_id ? (resolvedUserId ? "user" : "service") : null);
  const resolvedCorrelationId = firstNonEmpty(correlation_id, request_id, audit_id);
  const contextJson = execution_context_json || {
    source: "audit_logger",
    metadata: metadata || null,
    outcome: outcome || null,
    secrets_included: false,
  };
  await getPool().query(
    `INSERT INTO \`audit_log\`
       (audit_id, tenant_id, workspace_id, workspace_key, actor_id, actor_type, user_id,
        brand_id, brand_key, request_id, session_id, conversation_id, correlation_id,
        execution_context_json, action, resource_type, resource_id,
        before_json, after_json, ip_address, user_agent, service_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      audit_id,
      tenant_id,
      workspace_id,
      workspace_key,
      actor_id,
      resolvedActorType,
      resolvedUserId,
      brand_id,
      brand_key,
      request_id,
      session_id,
      conversation_id,
      resolvedCorrelationId,
      safeJson(contextJson),
      action,
      resource_type,
      resource_id,
      before_json ? JSON.stringify(before_json) : null,
      after_json  ? JSON.stringify(after_json)  : null,
      ip_address,
      user_agent,
      service_mode,
    ]
  );
  return audit_id;
}

// Fire-and-forget version for use inside route handlers where we don't want
// audit failures to affect the HTTP response.
export function writeAuditLogAsync(params) {
  writeAuditLog(params).catch(() => { /* suppress — audit must not break the request */ });
}
