import { createHash, randomUUID } from "node:crypto";

import { getPool } from "./db.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";

function stableJson(value = {}) {
  try {
    return JSON.stringify(value ?? { secrets_included: false });
  } catch {
    return JSON.stringify({ ok: false, serialization_error: "resource_recipe_evidence_json_failed", secrets_included: false });
  }
}

function sha256Hex(value = "") {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function previewJson(value = {}, max = 4000) {
  return stableJson(value).slice(0, max);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function isSecretLikeKey(key = "") {
  return /secret|token|api[_-]?key|private[_-]?key|ciphertext|password|refresh[_-]?token|access[_-]?token/i.test(String(key || ""));
}

function assertNoSecretKeys(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (isSecretLikeKey(key) && key !== "secrets_included") {
      const err = new Error(`Resource recipe evidence refuses to store sensitive field at ${path}.${key}`);
      err.code = "resource_recipe_apply_evidence_secret_key_rejected";
      throw err;
    }
    assertNoSecretKeys(nested, `${path}.${key}`);
  }
}

function envelopeSummary(envelope = {}) {
  return {
    ok: Boolean(envelope.ok ?? envelope.envelope_id),
    envelope_id: envelope.envelope_id || null,
    app_key: envelope.app_key || null,
    capability_key: envelope.capability_key || null,
    operation_intent: envelope.operation_intent || null,
    selected_runtime_surface: envelope.selected_runtime_surface || null,
    dispatch_allowed: envelope.dispatch_allowed === true || envelope.dispatch_allowed === 1,
    apply_allowed: envelope.apply_allowed === true || envelope.apply_allowed === 1,
    secrets_included: false,
  };
}

function buildEvidenceSummaries({ args = {}, result = {}, auth = {} } = {}) {
  const safeArgs = {
    recipe_key: args.recipe_key || null,
    mode: args.mode || result.mode || null,
    input_sha256: args.input ? sha256Hex(args.input) : null,
    has_resource_ref: Boolean(args.resource_ref),
    options_keys: Object.keys(asObject(args.options)).filter((key) => !isSecretLikeKey(key)).sort(),
    typed_confirmation_sha256: args.typed_confirmation ? sha256Hex(args.typed_confirmation) : null,
    capability_envelope_id: args.capability_envelope_id || result.capability_envelope?.envelope_id || null,
    secrets_included: false,
  };
  const driveWrite = asObject(result.drive_write);
  const readback = asObject(result.readback);
  const manifestDryRun = asObject(result.manifest_materialization_dry_run);
  const responseSummary = {
    ok: Boolean(result.ok),
    classification: result.classification || null,
    mode: result.mode || args.mode || null,
    recipe_key: result.recipe_key || args.recipe_key || null,
    resource_type: result.resource_type || null,
    resource_uri: result.resource_uri || null,
    manifest_filename: manifestDryRun.filename || null,
    manifest_content_sha256: manifestDryRun.content_sha256 || null,
    drive_file_id: driveWrite.file_id || driveWrite.id || readback.file_id || null,
    drive_endpoint_key: driveWrite.endpoint_key || null,
    readback_ok: Boolean(readback.ok ?? result.readback?.ok),
    provider_calls_made: Number(result.provider_calls_made || 0),
    graph_write_made: Boolean(result.execution_evidence?.graph_write_made || result.graph_write_made),
    file_content_returned: Boolean(result.execution_evidence?.file_content_returned || result.file_content_returned),
    capability_envelope: envelopeSummary(result.capability_envelope || {}),
    secrets_included: false,
  };
  const metadata = {
    evidence_version: "resource_recipe_apply_evidence_v1",
    tool: result.tool || "governed_resource_run",
    actor: {
      actor_id: auth?.user_id || auth?.sub || auth?.email || "admin_gpt",
      actor_type: auth?.is_admin ? "platform_admin" : auth?.user_id ? "user" : "system",
      tenant_id: auth?.tenant_id || null,
    },
    request: safeArgs,
    response: responseSummary,
    safety: {
      graph_write_made: responseSummary.graph_write_made,
      file_content_returned: responseSummary.file_content_returned,
      secrets_included: false,
    },
    secrets_included: false,
  };
  assertNoSecretKeys(metadata);
  return { safeArgs, responseSummary, metadata };
}

export async function writeResourceRecipeApplyEvidence({ pool = getPool(), args = {}, result = {}, auth = {} } = {}) {
  const mode = String(result.mode || args.mode || "").trim();
  if (mode !== "apply") {
    return { ok: true, skipped: true, reason: "not_apply_mode", secrets_included: false };
  }
  const { safeArgs, responseSummary, metadata } = buildEvidenceSummaries({ args, result, auth });
  const traceId = `resource_recipe_apply:${randomUUID()}`;
  const executionStatus = result.ok ? "success" : "degraded";
  const executionEvidence = await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "resource_recipe_apply",
    executionClass: "resource_recipe_apply_audit_v1",
    sourceLayer: "system_layer_resource_recipe",
    userInput: `governed_resource_run ${responseSummary.recipe_key || "unknown_recipe"}`,
    routeKeys: "governed_resource_run",
    selectedWorkflows: "resource_recipe_apply_evidence_v1",
    executionMode: "governed_resource_recipe_apply",
    decisionTrigger: "capability_envelope_apply_authorized",
    executionStatus,
    outputSummary: metadata,
    recoveryStatus: result.ok ? "not_required" : "readback_or_apply_degraded",
    routeStatus: result.ok ? "resolved" : "degraded",
    routeSource: "system_layer_tools",
    intakeValidationStatus: "validated",
    executionReadyStatus: result.ok ? "ready" : "degraded",
    failureReason: result.ok ? null : responseSummary.classification || "resource_recipe_apply_degraded",
    tenantId: auth?.tenant_id || args.tenant_id || args.options?.tenant_id || null,
    userId: auth?.user_id || args.user_id || args.options?.user_id || null,
    actorId: auth?.user_id || auth?.sub || auth?.email || "admin_gpt",
    actorType: auth?.is_admin ? "platform_admin" : auth?.user_id ? "user" : "system",
    parentActionKey: responseSummary.drive_endpoint_key ? "google_drive_api" : null,
    endpointKey: responseSummary.drive_endpoint_key || null,
    toolKey: "governed_resource_run",
    appKey: responseSummary.capability_envelope?.app_key || null,
    actionKey: responseSummary.recipe_key || null,
    resourceType: responseSummary.resource_type || null,
    resourceId: responseSummary.drive_file_id || responseSummary.resource_uri || null,
    targetType: responseSummary.drive_file_id ? "drive_file" : responseSummary.resource_type || null,
    targetId: responseSummary.drive_file_id || null,
    correlationId: traceId,
    idempotencyKey: responseSummary.manifest_content_sha256 || null,
    executionContext: metadata,
    contextSources: [metadata],
  });

  const evidenceId = randomUUID();
  const requestPreview = previewJson(safeArgs);
  const responsePreview = previewJson(responseSummary);
  const metadataJson = previewJson(metadata, 8000);
  await pool.query(
    `INSERT INTO audit_payload_evidence
       (evidence_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id,
        source_table, source_pk, evidence_type, request_preview, request_sha256,
        response_preview, response_sha256, metadata_json, redaction_status, secrets_included)
     VALUES (?, ?, ?, ?, 'resource_recipe_apply', ?, ?, 'execution_log', ?, 'resource_recipe_apply_readback', ?, ?, ?, ?, ?, 'not_required', 0)`,
    [
      evidenceId,
      auth?.tenant_id || args.tenant_id || args.options?.tenant_id || null,
      auth?.user_id || auth?.sub || auth?.email || "admin_gpt",
      auth?.is_admin ? "platform_admin" : auth?.user_id ? "user" : "system",
      responseSummary.resource_type || null,
      responseSummary.drive_file_id || responseSummary.resource_uri || null,
      executionEvidence.row?.id ? String(executionEvidence.row.id) : null,
      requestPreview,
      sha256Hex(requestPreview),
      responsePreview,
      sha256Hex(responsePreview),
      metadataJson,
    ]
  );

  return {
    ok: true,
    execution_log: {
      ok: Boolean(executionEvidence.row),
      id: executionEvidence.row?.id || null,
      trace_id: traceId,
      execution_status: executionEvidence.row?.execution_status || executionStatus,
    },
    audit_payload_evidence: {
      ok: true,
      evidence_id: evidenceId,
      evidence_type: "resource_recipe_apply_readback",
    },
    secrets_included: false,
  };
}
