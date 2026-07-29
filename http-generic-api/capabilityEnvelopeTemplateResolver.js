import crypto, { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { runCapabilityResolutionDryRun } from "./scripts/capability-resolution-dry-run.mjs";
import { createCapabilityResolutionEnvelopeLedger } from "./scripts/capability-resolution-envelope-create.mjs";

export const CAPABILITY_ENVELOPE_TEMPLATE_CONTEXT_FIELDS = Object.freeze([
  "tenant_id",
  "user_id",
  "workspace_id",
  "workspace_key",
  "workspace_type",
  "user_role",
  "brand_key",
  "business_activity_type",
  "plan_id",
  "plan_item_id",
  "resource_uri",
  "recipe_key",
  "expected_commit_sha",
  "binding_sha256",
  "capability_sha256",
]);

const CONTEXT_LIMITS = Object.freeze({
  tenant_id: 64,
  user_id: 64,
  workspace_id: 64,
  workspace_key: 191,
  workspace_type: 64,
  user_role: 64,
  brand_key: 191,
  business_activity_type: 191,
  plan_id: 64,
  plan_item_id: 64,
  resource_uri: 512,
  recipe_key: 191,
  expected_commit_sha: 40,
  binding_sha256: 64,
  capability_sha256: 64,
});

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function safeText(value, max = 191) {
  return String(value ?? "").trim().slice(0, max);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function shapeTemplate(row) {
  if (!row) return null;
  return {
    template_id: row.template_id,
    template_key: row.template_key,
    template_version: Number(row.template_version),
    display_name: row.display_name,
    description: row.description,
    app_key: row.app_key,
    capability_key: row.capability_key,
    operation_intent: row.operation_intent,
    runtime_surface: row.runtime_surface,
    requested_source_tier: row.requested_source_tier,
    required_context: parseJson(row.required_context_json, []),
    allowed_context: parseJson(row.allowed_context_json, []),
    defaults: parseJson(row.defaults_json, {}),
    max_ttl_minutes: Number(row.max_ttl_minutes || 60),
    template_hash: row.template_hash,
    status: row.status,
    secrets_included: false,
  };
}

async function loadTemplate(pool, templateKey) {
  const [rows] = await pool.query(
    `SELECT template_id, template_key, template_version, display_name, description,
            app_key, capability_key, operation_intent, runtime_surface, requested_source_tier,
            required_context_json, allowed_context_json, defaults_json, max_ttl_minutes,
            template_hash, status
       FROM capability_envelope_templates
      WHERE template_key = ? AND status = 'active'
      ORDER BY template_version DESC
      LIMIT 1`,
    [templateKey],
  );
  return shapeTemplate(rows[0] || null);
}

export function normalizeCapabilityEnvelopeTemplateContext(template, rawContext = {}) {
  const defaults = template?.defaults?.context && typeof template.defaults.context === "object"
    ? template.defaults.context
    : {};
  const source = { ...defaults, ...(rawContext || {}) };
  const allowed = new Set(Array.isArray(template?.allowed_context) ? template.allowed_context : []);
  const required = Array.isArray(template?.required_context) ? template.required_context : [];
  const unknownFields = Object.keys(source).filter((key) => !allowed.has(key));
  if (unknownFields.length) {
    fail("capability_envelope_template_unknown_context", "Template context contains unsupported fields.", 400, { unknown_fields: unknownFields });
  }
  const context = {};
  for (const key of allowed) {
    if (source[key] == null || source[key] === "") continue;
    context[key] = safeText(source[key], CONTEXT_LIMITS[key] || 191);
  }
  const missingFields = required.filter((key) => !context[key]);
  if (missingFields.length) {
    fail("capability_envelope_template_context_missing", "Template context is missing required fields.", 400, { missing_fields: missingFields });
  }
  if (context.expected_commit_sha && !/^[0-9a-f]{40}$/i.test(context.expected_commit_sha)) {
    fail("capability_envelope_template_commit_invalid", "expected_commit_sha must be a 40-character hexadecimal commit SHA.", 400);
  }
  for (const field of ["binding_sha256", "capability_sha256"]) {
    if (context[field] && !/^[0-9a-f]{64}$/i.test(context[field])) {
      fail(
        `capability_envelope_template_${field}_invalid`,
        `${field} must be a 64-character hexadecimal SHA-256 fingerprint.`,
        400,
      );
    }
  }
  if (context.resource_uri && !/^[a-z][a-z0-9+.-]*:\/\//i.test(context.resource_uri)) {
    fail("capability_envelope_template_resource_uri_invalid", "resource_uri must be an absolute governed resource URI.", 400);
  }
  return context;
}

export function buildCapabilityEnvelopeTemplatePassthrough(template, context, { explain = false } = {}) {
  const args = [];
  const flags = {
    tenant_id: "--tenant-id",
    user_id: "--user-id",
    workspace_id: "--workspace-id",
    workspace_key: "--workspace-key",
    workspace_type: "--workspace-type",
    user_role: "--user-role",
    brand_key: "--brand-key",
    business_activity_type: "--business-activity-type",
    plan_id: "--plan-id",
    plan_item_id: "--plan-item-id",
    resource_uri: "--resource-uri",
    recipe_key: "--recipe-key",
    expected_commit_sha: "--expected-commit-sha",
    binding_sha256: "--binding-sha256",
    capability_sha256: "--capability-sha256",
  };
  for (const key of CAPABILITY_ENVELOPE_TEMPLATE_CONTEXT_FIELDS) {
    if (!context[key]) continue;
    args.push(flags[key], context[key]);
  }
  args.push("--app-key", template.app_key);
  args.push("--capability-key", template.capability_key);
  args.push("--operation-intent", template.operation_intent);
  args.push("--runtime-surface", template.runtime_surface);
  if (template.requested_source_tier) args.push("--requested-source-tier", template.requested_source_tier);
  if (explain) args.push("--explain");
  return args;
}

export function computeCapabilityEnvelopeTemplateResolutionHash({ template, context, ttlMinutes, dryRun }) {
  return sha256({
    template_key: template.template_key,
    template_version: template.template_version,
    template_hash: template.template_hash,
    context,
    ttl_minutes: ttlMinutes,
    decision: dryRun?.decision || null,
    selected_source_tier: dryRun?.selected_source?.selected_source_tier || null,
    blocking_gaps: dryRun?.blocking_gaps || [],
    secrets_included: false,
  });
}

function buildDryRunInput(template, context, explain) {
  return {
    tenantId: context.tenant_id || "",
    userId: context.user_id || "",
    workspaceId: context.workspace_id || "",
    workspaceKey: context.workspace_key || "",
    workspaceType: context.workspace_type || "",
    userRole: context.user_role || "",
    brandKey: context.brand_key || "",
    businessActivityType: context.business_activity_type || "",
    appKey: template.app_key,
    capabilityKey: template.capability_key,
    operationIntent: template.operation_intent,
    runtimeSurface: template.runtime_surface,
    requestedSourceTier: template.requested_source_tier || "",
    explain: explain === true,
  };
}

export async function resolveCapabilityEnvelopeTemplate(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const runDryRun = deps.runCapabilityResolutionDryRun || runCapabilityResolutionDryRun;
  const templateKey = safeText(input.template_key || input.templateKey, 191);
  if (!templateKey) fail("capability_envelope_template_key_missing", "template_key is required.", 400);
  const template = await loadTemplate(pool, templateKey);
  if (!template) fail("capability_envelope_template_not_found", "Capability envelope template was not found.", 404);
  if (input.expected_template_hash && input.expected_template_hash !== template.template_hash) {
    fail("capability_envelope_template_hash_mismatch", "Capability envelope template changed after review.", 409, {
      expected_template_hash: input.expected_template_hash,
      current_template_hash: template.template_hash,
    });
  }
  const context = normalizeCapabilityEnvelopeTemplateContext(template, input.context || {});
  const ttlMinutes = boundedInt(
    input.ttl_minutes ?? template.defaults?.ttl_minutes,
    Math.min(60, template.max_ttl_minutes),
    5,
    template.max_ttl_minutes,
  );
  const dryRun = await runDryRun(buildDryRunInput(template, context, input.explain));
  const blockingGaps = Array.isArray(dryRun?.blocking_gaps) ? dryRun.blocking_gaps : [];
  const sourceTierAlignment = !template.requested_source_tier
    || template.requested_source_tier === dryRun?.selected_source?.selected_source_tier;
  const createAllowed = sourceTierAlignment
    && blockingGaps.length === 0
    && ["ready_for_dispatch", "ready_requires_approval"].includes(dryRun?.decision);
  const passthrough = buildCapabilityEnvelopeTemplatePassthrough(template, context, { explain: input.explain });
  const resolutionHash = computeCapabilityEnvelopeTemplateResolutionHash({ template, context, ttlMinutes, dryRun });
  const result = {
    ok: true,
    mode: "preview",
    template,
    context,
    ttl_minutes: ttlMinutes,
    dry_run: dryRun,
    create_allowed: createAllowed,
    source_tier_alignment: sourceTierAlignment,
    passthrough_argument_names: passthrough.filter((_, index) => index % 2 === 0 || passthrough[index] === "--explain"),
    resolution_hash: resolutionHash,
    secrets_included: false,
  };
  Object.defineProperty(result, "_passthrough", {
    value: passthrough,
    enumerable: false,
    writable: false,
  });
  return result;
}

async function loadCapabilityEnvelopeTemplateResolutionByHash(pool, resolutionHash) {
  const [rows] = await pool.query(
    `SELECT r.resolution_id, r.template_key, r.template_version, r.template_hash,
            r.resolution_hash, r.envelope_id, r.resolution_status, r.requested_by,
            r.created_at, e.envelope_status, e.decision, e.dispatch_allowed,
            e.apply_allowed, e.approval_required, e.blocking_gap_count, e.expires_at
       FROM capability_envelope_template_resolutions r
       JOIN capability_resolution_envelope_ledger e ON e.envelope_id = r.envelope_id
      WHERE r.resolution_hash = ? LIMIT 1`,
    [resolutionHash],
  );
  return rows[0] || null;
}

export async function createCapabilityEnvelopeFromTemplate(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const createEnvelope = deps.createCapabilityResolutionEnvelopeLedger || createCapabilityResolutionEnvelopeLedger;
  const resolved = await resolveCapabilityEnvelopeTemplate(input, deps);
  if (!resolved.create_allowed) {
    fail("capability_envelope_template_resolution_blocked", "Template resolution is blocked by current authority or binding gaps.", 409, {
      decision: resolved.dry_run?.decision,
      blocking_gaps: resolved.dry_run?.blocking_gaps || [],
      source_tier_alignment: resolved.source_tier_alignment,
      resolution_hash: resolved.resolution_hash,
    });
  }
  const existing = await loadCapabilityEnvelopeTemplateResolutionByHash(pool, resolved.resolution_hash);
  if (existing) {
    return {
      ok: true,
      mode: "created",
      deduplicated: true,
      template: resolved.template,
      resolution: existing,
      envelope: {
        ok: true,
        envelope_id: existing.envelope_id,
        envelope_status: existing.envelope_status,
        decision: existing.decision,
        secrets_included: false,
      },
      resolution_hash: resolved.resolution_hash,
      secrets_included: false,
    };
  }
  const requestedBy = safeText(input.requested_by || input.requestedBy || "gpt_admin", 191) || "gpt_admin";
  const envelope = await createEnvelope({
    requestedBy,
    ttlMinutes: resolved.ttl_minutes,
    passthrough: resolved._passthrough,
  });
  const resolutionId = randomUUID();
  await pool.query(
    `INSERT INTO capability_envelope_template_resolutions
      (resolution_id, template_id, template_key, template_version, template_hash,
       resolution_hash, request_context_json, resolved_request_json, dry_run_json,
       envelope_id, resolution_status, requested_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, 0)`,
    [
      resolutionId,
      resolved.template.template_id,
      resolved.template.template_key,
      resolved.template.template_version,
      resolved.template.template_hash,
      resolved.resolution_hash,
      JSON.stringify(resolved.context),
      JSON.stringify({
        app_key: resolved.template.app_key,
        capability_key: resolved.template.capability_key,
        operation_intent: resolved.template.operation_intent,
        runtime_surface: resolved.template.runtime_surface,
        requested_source_tier: resolved.template.requested_source_tier,
        ttl_minutes: resolved.ttl_minutes,
        secrets_included: false,
      }),
      JSON.stringify(resolved.dry_run),
      envelope.envelope_id,
      requestedBy,
    ],
  );
  const resolution = await loadCapabilityEnvelopeTemplateResolutionByHash(pool, resolved.resolution_hash);
  return {
    ok: true,
    mode: "created",
    deduplicated: false,
    template: resolved.template,
    resolution: resolution || { resolution_id: resolutionId, envelope_id: envelope.envelope_id },
    envelope,
    resolution_hash: resolved.resolution_hash,
    secrets_included: false,
  };
}

export async function getCapabilityEnvelopeTemplate(templateKey, deps = {}) {
  const pool = deps.pool || getPool();
  const template = await loadTemplate(pool, safeText(templateKey, 191));
  if (!template) fail("capability_envelope_template_not_found", "Capability envelope template was not found.", 404);
  return { ok: true, template, secrets_included: false };
}

export async function listCapabilityEnvelopeTemplates(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const limit = boundedInt(input.limit, 25, 1, 100);
  const cursor = safeText(input.cursor, 191);
  const [rows] = await pool.query(
    `SELECT template_id, template_key, template_version, display_name, description,
            app_key, capability_key, operation_intent, runtime_surface, requested_source_tier,
            required_context_json, allowed_context_json, defaults_json, max_ttl_minutes,
            template_hash, status
       FROM capability_envelope_templates
      WHERE status = 'active' AND template_key > ?
      ORDER BY template_key ASC, template_version DESC
      LIMIT ?`,
    [cursor, limit + 1],
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(shapeTemplate);
  return {
    ok: true,
    items,
    page: {
      next_cursor: hasMore ? items[items.length - 1]?.template_key || null : null,
      has_more: hasMore,
    },
    secrets_included: false,
  };
}
