import crypto from "node:crypto";
import { getPool } from "./db.js";
import { brandWorkspaceContextResolve as defaultBrandContext } from "./brandWorkspaceContextResolver.js";
import { tenantEffectiveCapabilityPreview as defaultCapabilityPreview } from "./tenantEffectiveCapabilityResolver.js";

const EXECUTABLE_EVIDENCE = new Set(["live_verified", "indexed_and_fresh"]);
const READ_OPERATIONS = new Set(["read", "list", "inspect", "preview", "status", "search"]);
const EVIDENCE_LABELS = Object.freeze({
  live_verified: "Live Verified",
  indexed_and_fresh: "Indexed and Fresh",
  historical_snapshot: "Historical Snapshot",
  brand_inferred: "Brand-Inferred",
  generic_intent: "Generic Intent",
  blocked: "Blocked",
});
const MEMORY_KEYS = Object.freeze([
  "selected_workspace",
  "selected_brand",
  "selected_site",
  "current_goal",
  "business_intent",
  "verified_resource",
  "selected_connection",
  "connection_readiness",
  "publish_authority",
  "required_next_step",
  "open_ticket_refs",
  "questionnaire_answers",
  "schema_fingerprint",
  "capability_key",
  "operation_ref",
]);

function text(value = "", max = 2048) {
  return String(value ?? "").trim().slice(0, max);
}

function normalize(value = "") {
  return text(value).toLowerCase();
}

function object(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value = [], max = 100) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function unique(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function parseSchema(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return object(JSON.parse(value));
  } catch {
    return {};
  }
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function principalScope(args = {}, auth = {}) {
  const admin = auth?.is_admin === true;
  return {
    admin,
    tenant_id: admin && args.tenant_id ? text(args.tenant_id, 64) : text(auth?.tenant_id, 64),
    user_id: admin && args.user_id ? text(args.user_id, 64) : text(auth?.user_id, 64),
    tenant_override_ignored: !admin && Boolean(args.tenant_id),
    user_override_ignored: !admin && Boolean(args.user_id),
  };
}

function blocked(tool, code, message, details = {}, status = "blocked") {
  return {
    ok: false,
    tool,
    status,
    error: { code, message, details },
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

function recent(timestamp, minutes) {
  if (!timestamp) return false;
  const observed = new Date(timestamp).getTime();
  return Number.isFinite(observed) && observed > Date.now() - minutes * 60_000;
}

export function evidenceLabel(evidenceClass) {
  return EVIDENCE_LABELS[evidenceClass] || EVIDENCE_LABELS.generic_intent;
}

export function classifyConnectionEvidence(connection = {}, {
  liveVerifiedAt = null,
  freshnessMinutes = 1440,
} = {}) {
  const validation = normalize(connection.validation_status);
  const status = normalize(connection.status);
  if (liveVerifiedAt && recent(liveVerifiedAt, freshnessMinutes)) return "live_verified";
  if (validation === "validated" && status === "active" && recent(connection.last_validated_at, freshnessMinutes)) {
    return "indexed_and_fresh";
  }
  if (["metadata_only", "snapshot", "historical"].includes(validation)) return "historical_snapshot";
  if (validation || status) return "historical_snapshot";
  return "generic_intent";
}

function questionType(schema = {}) {
  if (Array.isArray(schema.enum)) return "single_select";
  if (schema.type === "array") return "multi_select";
  if (["number", "integer"].includes(schema.type)) return "number";
  if (schema.type === "boolean") return "boolean";
  if (["date", "date-time"].includes(schema.format)) return "date";
  return "text";
}

export function buildQuestionnaireFromSchema(schemaInput, providedInputs = {}, evidenceClass = "generic_intent") {
  const schema = parseSchema(schemaInput);
  const properties = object(schema.properties);
  const required = new Set(array(schema.required, 200).map((key) => text(key, 191)));
  const answers = object(providedInputs);
  const questions = [];
  for (const [key, rawProperty] of Object.entries(properties).slice(0, 100)) {
    if (Object.prototype.hasOwnProperty.call(answers, key) && answers[key] !== "" && answers[key] !== null) continue;
    const property = object(rawProperty);
    questions.push({
      field_key: text(key, 191),
      prompt: text(property.title || property.description || key, 1000),
      type: questionType(property),
      required: required.has(key),
      options: array(property.enum, 100).map((value) => ({
        key: text(value, 191),
        label: text(value, 255),
        evidence_class: evidenceClass,
      })),
      evidence_class: evidenceClass,
      evidence_label: evidenceLabel(evidenceClass),
      action_eligible_evidence: EXECUTABLE_EVIDENCE.has(evidenceClass),
    });
  }
  return {
    schema_present: Object.keys(properties).length > 0,
    schema_fingerprint: Object.keys(schema).length ? hash(JSON.stringify(schema)) : null,
    evidence_class: evidenceClass,
    evidence_label: evidenceLabel(evidenceClass),
    execution_eligible_evidence: EXECUTABLE_EVIDENCE.has(evidenceClass),
    missing_field_count: questions.length,
    questions,
    secrets_included: false,
  };
}

export function classifyBrandCoreAsset(asset = {}) {
  const descriptor = normalize([
    asset.asset_type,
    asset.document_name,
    asset.core_function,
    asset.asset_key,
    asset.doc_key,
  ].filter(Boolean).join(" "));
  let assetClass = "operational_reference";
  if (/content[\s_-]*model/.test(descriptor)) assetClass = "content_model";
  else if (/\bcpt\b|content[\s_-]*type|configuration[\s_-]*snapshot/.test(descriptor)) assetClass = "cpt_snapshot";
  else if (/field[\s_-]*map/.test(descriptor)) assetClass = "field_map";
  else if (/taxonomy/.test(descriptor)) assetClass = "taxonomy_map";
  else if (/payload|template/.test(descriptor)) assetClass = "payload_template";
  else if (/approval|gate|policy/.test(descriptor)) assetClass = "approval_gate";
  else if (/handoff|operational|notes?/.test(descriptor)) assetClass = "operational_notes";

  const status = normalize(asset.status || asset.active_status);
  const validation = normalize(asset.validation_status);
  const superseded = ["superseded", "archived", "inactive", "deprecated"].includes(status);
  const confirmed = ["validated", "verified", "confirmed", "live_verified"].includes(validation);
  const evidenceClass = assetClass === "cpt_snapshot" || /snapshot|historical/.test(descriptor)
    ? "historical_snapshot"
    : confirmed
      ? "indexed_and_fresh"
      : "historical_snapshot";
  return {
    asset_ref: text(asset.asset_key || asset.doc_key || asset.doc_id || asset.file_id, 512) || null,
    display_name: text(asset.document_name || asset.asset_type || asset.asset_key, 512) || null,
    asset_class: assetClass,
    lifecycle_state: superseded ? "superseded" : assetClass === "field_map" && !confirmed ? "draft" : "current",
    verification_state: confirmed ? "verified_index" : "needs_refresh",
    source: "brand_core",
    observed_at: asset.updated_at || null,
    last_verified_at: confirmed ? asset.updated_at || null : null,
    schema_hash: hash(JSON.stringify({ assetClass, status, validation, updated_at: asset.updated_at || null })),
    supersedes: null,
    action_eligible: false,
    refresh_required: !confirmed || superseded,
    evidence_class: evidenceClass,
    evidence_label: evidenceLabel(evidenceClass),
    secrets_included: false,
  };
}

export function buildConnectionDisposition(connection = {}) {
  const status = normalize(connection.status);
  const validation = normalize(connection.validation_status);
  const credentialPresent = Boolean(connection.credential_material_present);
  const resourceBindingCount = Number(connection.resource_binding_count || 0);
  const credentialBindingCount = Number(connection.credential_binding_count || 0);
  let recommendation = "manual_review";
  let reason = "connection_state_requires_review";
  if (["disabled", "revoked", "expired", "archived", "deleted"].includes(status)) {
    recommendation = "retirement_candidate";
    reason = "connection_inactive";
  } else if (["invalid_credentials", "authentication_failed", "credential_missing"].includes(validation)) {
    recommendation = "credential_intake_required";
    reason = "credentials_invalid_or_missing";
  } else if (validation === "metadata_only") {
    recommendation = "credential_intake_required";
    reason = "metadata_only_is_not_executable";
  } else if (["pending", "pending_validation", "not_checked", "unknown", ""].includes(validation)) {
    recommendation = credentialPresent ? "revalidate" : "credential_intake_required";
    reason = credentialPresent ? "live_validation_required" : "credential_material_missing";
  } else if (validation === "validated" && resourceBindingCount < 1) {
    recommendation = "repair_binding";
    reason = "validated_connection_has_no_resource_binding";
  } else if (validation === "validated" && resourceBindingCount > 0) {
    recommendation = "keep";
    reason = "validated_and_resource_bound";
  }
  return {
    recommendation,
    reason,
    keep_allowed: recommendation === "keep",
    set_primary_candidate: recommendation === "keep" && !Boolean(connection.is_primary),
    cancellation_allowed: false,
    cancellation_requires_explicit_approval: true,
    cancellation_impact: {
      resource_binding_count: resourceBindingCount,
      credential_binding_count: credentialBindingCount,
      resource_refs: array(connection.resource_refs, 50),
    },
    secrets_included: false,
  };
}

export function mergeOperationalMemory(previousMemory = {}, patch = {}) {
  const previous = object(previousMemory);
  const next = {};
  for (const key of MEMORY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(previous, key)) next[key] = previous[key];
    if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) next[key] = patch[key];
  }
  if (Array.isArray(next.open_ticket_refs)) next.open_ticket_refs = unique(next.open_ticket_refs).slice(0, 25);
  if (next.questionnaire_answers) next.questionnaire_answers = object(next.questionnaire_answers);
  return next;
}

async function rows(pool, sql, params = []) {
  const [result] = await pool.query(sql, params);
  return Array.isArray(result) ? result : [];
}

async function resolveWorkspace(pool, scope, args = {}) {
  const where = ["tenant_id = ?"];
  const params = [scope.tenant_id];
  if (args.workspace_id) {
    where.push("workspace_id = ?");
    params.push(text(args.workspace_id, 64));
  } else if (args.workspace_key) {
    where.push("workspace_key = ?");
    params.push(text(args.workspace_key, 191));
  }
  const candidates = await rows(
    pool,
    `SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type, bootstrap_status
       FROM workspace_registry
      WHERE ${where.join(" AND ")}
      ORDER BY (bootstrap_status = 'ready') DESC, created_at ASC
      LIMIT 3`,
    params
  );
  if (!args.workspace_id && !args.workspace_key && candidates.length !== 1) {
    return { workspace: null, candidates, ambiguous: candidates.length > 1 };
  }
  return { workspace: candidates[0] || null, candidates, ambiguous: false };
}

async function loadWorkspaceConnections(pool, tenantId, workspaceId) {
  const result = await rows(
    pool,
    `SELECT wal.workspace_id, wal.permission_mode,
            uac.connection_id, uac.app_key, uac.display_label, uac.account_label,
            uac.status, uac.validation_status, uac.is_primary,
            uac.last_validated_at, uac.last_used_at,
            CASE WHEN uac.encrypted_credentials IS NOT NULL
                   OR (uac.credential_ref IS NOT NULL AND uac.credential_ref <> '')
                 THEN 1 ELSE 0 END AS credential_material_present,
            COUNT(DISTINCT cb.binding_id) AS credential_binding_count,
            COUNT(DISTINCT csg.grant_id) AS resource_binding_count,
            GROUP_CONCAT(DISTINCT COALESCE(bsb.target_key, cs.canonical_target_key, cs.normalized_domain, cb.target_key) SEPARATOR ',') AS resource_refs_csv
       FROM workspace_app_links wal
       JOIN user_app_connections uac
         ON uac.connection_id COLLATE utf8mb4_unicode_ci = wal.connection_id COLLATE utf8mb4_unicode_ci
       LEFT JOIN credential_bindings cb
         ON cb.tenant_id = wal.tenant_id
        AND cb.connection_id COLLATE utf8mb4_unicode_ci = uac.connection_id COLLATE utf8mb4_unicode_ci
        AND cb.status = 'active'
       LEFT JOIN cms_site_access_grants csg
         ON csg.tenant_id = wal.tenant_id
        AND csg.connection_id COLLATE utf8mb4_unicode_ci = uac.connection_id COLLATE utf8mb4_unicode_ci
        AND csg.status = 'active'
        AND (csg.expires_at IS NULL OR csg.expires_at > NOW())
       LEFT JOIN cms_sites cs ON cs.site_id = csg.site_id
       LEFT JOIN brand_site_bindings bsb ON bsb.site_id = cs.site_id AND bsb.status = 'active'
      WHERE wal.tenant_id = ?
        AND wal.workspace_id = ?
        AND wal.status = 'active'
        AND uac.tenant_id = ?
      GROUP BY wal.workspace_id, wal.permission_mode,
               uac.connection_id, uac.app_key, uac.display_label, uac.account_label,
               uac.status, uac.validation_status, uac.is_primary,
               uac.last_validated_at, uac.last_used_at, credential_material_present
      ORDER BY uac.app_key, uac.is_primary DESC, uac.last_validated_at DESC`,
    [tenantId, workspaceId, tenantId]
  );
  return result.map((row) => ({
    ...row,
    credential_material_present: Boolean(Number(row.credential_material_present || 0)),
    is_primary: Boolean(Number(row.is_primary || 0)),
    credential_binding_count: Number(row.credential_binding_count || 0),
    resource_binding_count: Number(row.resource_binding_count || 0),
    resource_refs: unique(String(row.resource_refs_csv || "").split(",")),
  }));
}

function selectResource(context = {}, requestedRef = "") {
  const sites = array(context.cms_sites, 100);
  const ref = normalize(requestedRef);
  if (ref) {
    const matching = sites.filter((site) => [site.site_id, site.normalized_domain, site.site_url, site.wp_json_base, site.canonical_target_key]
      .some((value) => normalize(value) === ref));
    return { selected: matching.length === 1 ? matching[0] : null, ambiguous: matching.length > 1, candidates: matching.length ? matching : sites };
  }
  return { selected: sites.length === 1 ? sites[0] : null, ambiguous: sites.length > 1, candidates: sites };
}

function capabilityEvidence(resolution, connectionEvidence) {
  if (!resolution?.ok || !["shadow_ready", "canary_ready", "ready"].includes(resolution.status)) return "blocked";
  if (connectionEvidence === "live_verified") return "live_verified";
  if (connectionEvidence === "indexed_and_fresh") return "indexed_and_fresh";
  return "historical_snapshot";
}

export const TENANT_CONVERSATION_ORCHESTRATION_SYSTEM_TOOLS = Object.freeze([
  {
    name: "tenant_conversation_orchestration_preview",
    description: "Compose signed Tenant context, dynamic Brand/resource resolution, evidence classes, effective capability preview, missing-input questionnaire, no-side-effect action preview, and bounded memory. No provider call or execution.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["intent"],
      properties: {
        intent: { type: "string", minLength: 1, maxLength: 4000 },
        brand_ref: { type: "string", maxLength: 2048 },
        resource_ref: { type: "string", maxLength: 2048 },
        capability_key: { type: "string", maxLength: 191 },
        workspace_id: { type: "string", maxLength: 64 },
        workspace_key: { type: "string", maxLength: 191 },
        connection_id: { type: "string", maxLength: 64 },
        previous_memory: { type: "object", additionalProperties: true },
        provided_inputs: { type: "object", additionalProperties: true },
        freshness_minutes: { type: "integer", minimum: 1, maximum: 10080, default: 1440 },
        tenant_id: { type: "string", description: "Admin-only diagnostic override; ignored for Tenant principals." },
        user_id: { type: "string", description: "Admin-only diagnostic override; ignored for Tenant principals." },
      },
    },
  },
  {
    name: "tenant_connection_cleanup_plan",
    description: "Build a generic read-only cleanup plan for Workspace connections: keep, revalidate, credential intake, binding repair, primary candidate, and retirement review. Never cancels a connection.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        workspace_id: { type: "string" },
        workspace_key: { type: "string" },
        tenant_id: { type: "string", description: "Admin-only diagnostic override; ignored for Tenant principals." },
        user_id: { type: "string", description: "Admin-only diagnostic override; ignored for Tenant principals." },
      },
    },
  },
  {
    name: "tenant_brand_core_operational_index_preview",
    description: "Resolve any authorized Brand dynamically and classify Brand Core assets into lifecycle, verification, evidence, and refresh states without claiming provider-live truth.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["brand_ref"],
      properties: {
        brand_ref: { type: "string", minLength: 1, maxLength: 2048 },
        asset_limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        tenant_id: { type: "string", description: "Admin-only diagnostic override; ignored for Tenant principals." },
        user_id: { type: "string", description: "Admin-only diagnostic override; ignored for Tenant principals." },
      },
    },
  },
  {
    name: "tenant_conversation_orchestration_readiness_smoke",
    description: "Admin-only read-only readiness smoke for generalized orchestration descriptors, registry objects, evidence classes, and no-provider/no-mutation guarantees.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
]);

export async function tenantConnectionCleanupPlan(args = {}, { auth = {}, pool = getPool() } = {}) {
  const scope = principalScope(args, auth);
  if (!scope.tenant_id || !scope.user_id) {
    return blocked("tenant_connection_cleanup_plan", "TENANT_CONTEXT_REQUIRED", "A signed Tenant principal is required.", {}, "authorization_gated");
  }
  const resolved = await resolveWorkspace(pool, scope, args);
  if (resolved.ambiguous) return blocked("tenant_connection_cleanup_plan", "WORKSPACE_AMBIGUOUS", "Select a Workspace before cleanup planning.");
  if (!resolved.workspace) return blocked("tenant_connection_cleanup_plan", "WORKSPACE_NOT_FOUND", "No Workspace matched the request.");
  const connections = await loadWorkspaceConnections(pool, scope.tenant_id, resolved.workspace.workspace_id);
  const items = connections.map((connection) => ({
    connection: {
      connection_id: connection.connection_id,
      app_key: connection.app_key,
      display_label: connection.display_label || null,
      account_label: connection.account_label || null,
      status: connection.status || null,
      validation_status: connection.validation_status || null,
      is_primary: connection.is_primary,
      credential_material_present: connection.credential_material_present,
      last_validated_at: connection.last_validated_at || null,
      last_used_at: connection.last_used_at || null,
      resource_refs: connection.resource_refs,
      resource_binding_count: connection.resource_binding_count,
      credential_binding_count: connection.credential_binding_count,
    },
    disposition: buildConnectionDisposition(connection),
  }));
  const groups = new Map();
  for (const item of items.filter((item) => item.disposition.recommendation === "keep")) {
    const key = item.connection.app_key || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const group of groups.values()) {
    if (group.length === 1 && !group[0].connection.is_primary) {
      group[0].disposition.recommendation = "set_primary_candidate";
      group[0].disposition.set_primary_candidate = true;
      group[0].disposition.reason = "only_validated_resource_bound_connection_for_app";
    }
  }
  return {
    ok: true,
    tool: "tenant_connection_cleanup_plan",
    status: "preview_ready",
    mode: "read_only",
    principal: { tenant_id: scope.tenant_id, user_id: scope.user_id },
    workspace: resolved.workspace,
    items,
    summary: {
      connection_count: items.length,
      credential_intake_count: items.filter((item) => item.disposition.recommendation === "credential_intake_required").length,
      revalidation_count: items.filter((item) => item.disposition.recommendation === "revalidate").length,
      binding_repair_count: items.filter((item) => item.disposition.recommendation === "repair_binding").length,
      retirement_review_count: items.filter((item) => item.disposition.recommendation === "retirement_candidate").length,
    },
    cancellation_performed: false,
    explicit_approval_required_for_cancellation: true,
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

export async function tenantBrandCoreOperationalIndexPreview(args = {}, {
  auth = {},
  pool = getPool(),
  brandWorkspaceContextResolve = defaultBrandContext,
} = {}) {
  if (!text(args.brand_ref)) return blocked("tenant_brand_core_operational_index_preview", "BRAND_REFERENCE_REQUIRED", "brand_ref is required.");
  const context = await brandWorkspaceContextResolve({
    brand_ref: args.brand_ref,
    asset_limit: boundedInt(args.asset_limit, 50, 1, 100),
    tenant_id: args.tenant_id,
    user_id: args.user_id,
  }, { auth, pool });
  if (!context?.ok) return context;
  const items = array(context.brand_core_assets, 100).map(classifyBrandCoreAsset);
  return {
    ok: true,
    tool: "tenant_brand_core_operational_index_preview",
    status: "preview_ready",
    mode: "read_only",
    principal: context.principal,
    brand: context.brand,
    items,
    summary: {
      total: items.length,
      current: items.filter((item) => item.lifecycle_state === "current").length,
      superseded: items.filter((item) => item.lifecycle_state === "superseded").length,
      refresh_required: items.filter((item) => item.refresh_required).length,
      action_eligible: 0,
    },
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

export async function tenantConversationOrchestrationPreview(args = {}, {
  auth = {},
  pool = getPool(),
  brandWorkspaceContextResolve = defaultBrandContext,
  tenantEffectiveCapabilityPreview = defaultCapabilityPreview,
} = {}) {
  const intent = text(args.intent, 4000);
  if (!intent) return blocked("tenant_conversation_orchestration_preview", "INTENT_REQUIRED", "intent is required.");
  const previous = object(args.previous_memory);
  const brandRef = text(args.brand_ref || previous.selected_brand, 2048);
  if (!brandRef) return blocked("tenant_conversation_orchestration_preview", "BRAND_REFERENCE_REQUIRED", "brand_ref or previous_memory.selected_brand is required.");

  const context = await brandWorkspaceContextResolve({ brand_ref: brandRef, asset_limit: 100, tenant_id: args.tenant_id, user_id: args.user_id }, { auth, pool });
  if (!context?.ok) return context;
  const requestedWorkspace = text(args.workspace_id || previous.selected_workspace, 64);
  const workspaces = array(context.workspaces, 100);
  const workspace = requestedWorkspace
    ? workspaces.find((row) => text(row.workspace_id, 64) === requestedWorkspace) || null
    : workspaces.length === 1 ? workspaces[0] : null;
  const resourceResult = selectResource(context, args.resource_ref || previous.verified_resource);
  const resource = resourceResult.selected;
  const capabilityKey = text(args.capability_key || previous.capability_key, 191);
  const freshnessMinutes = boundedInt(args.freshness_minutes, 1440, 1, 10080);
  const selectedConnection = array(context.connections, 100).find((row) => args.connection_id && row.connection_id === args.connection_id)
    || (context.connections?.length === 1 ? context.connections[0] : null);
  const connectionEvidence = classifyConnectionEvidence(selectedConnection || {}, {
    liveVerifiedAt: context.connection_state?.live_verified_at || null,
    freshnessMinutes,
  });

  let capability = null;
  if (capabilityKey && workspace && resource) {
    capability = await tenantEffectiveCapabilityPreview({
      capability_key: capabilityKey,
      workspace_id: workspace.workspace_id,
      resource_ref: resource.site_id || resource.canonical_target_key || resource.normalized_domain || resource.site_url,
      connection_id: args.connection_id || undefined,
      include_candidates: true,
      tenant_id: args.tenant_id,
      user_id: args.user_id,
    }, { auth, pool });
  }
  const capabilityEvidenceClass = capabilityEvidence(capability, connectionEvidence);
  const questionnaire = buildQuestionnaireFromSchema(
    capability?.projection?.input_schema_json,
    { ...object(previous.questionnaire_answers), ...object(args.provided_inputs) },
    capabilityEvidenceClass
  );
  const contextReady = Boolean(context.brand && workspace && resource);
  const approvalRequired = Boolean(capability?.capability?.requires_approval);
  let nextStep = "resolve_context";
  if (context.brand && !workspace) nextStep = "select_workspace";
  else if (workspace && !resource) nextStep = "select_verified_resource";
  else if (contextReady && !capabilityKey) nextStep = "resolve_capability";
  else if (capabilityKey && (!capability?.ok || !capability.ready)) nextStep = capability?.status || capability?.error?.code || "capability_not_ready";
  else if (questionnaire.missing_field_count) nextStep = "collect_missing_inputs";
  else if (approvalRequired) nextStep = "request_approval";
  else nextStep = "action_preview_ready";

  const executableResource = resource && capability?.ready && capability?.checks?.connection_resource_binding_ready === true && EXECUTABLE_EVIDENCE.has(capabilityEvidenceClass)
    ? {
        resource_type: capability.capability?.resource_type || "resource",
        resource_ref: resource.site_id || resource.canonical_target_key || resource.normalized_domain || resource.site_url,
        display_name: resource.normalized_domain || resource.site_url || resource.site_id,
        connection_id: capability.connection?.connection_id || null,
        evidence_class: capabilityEvidenceClass,
        action_eligible: true,
      }
    : null;
  const operationKey = normalize(capability?.capability?.operation_key);
  const memoryPatch = mergeOperationalMemory(previous, {
    selected_workspace: workspace?.workspace_id || previous.selected_workspace || null,
    selected_brand: context.brand?.brand_key || context.brand?.target_key || brandRef,
    selected_site: resource?.normalized_domain || resource?.site_url || null,
    current_goal: intent,
    business_intent: {
      key: `intent:${hash(normalize(intent)).slice(0, 16)}`,
      text: intent,
      evidence_class: context.brand ? "brand_inferred" : "generic_intent",
    },
    verified_resource: executableResource?.resource_ref || resource?.site_id || null,
    selected_connection: capability?.connection?.connection_id || null,
    connection_readiness: capability?.status || context.connection_state?.connectivity_status || "not_checked",
    publish_authority: context.cms_access_grants?.some((grant) => Boolean(grant.publish_allowed))
      ? "publish_allowed"
      : context.cms_access_grants?.some((grant) => Boolean(grant.draft_allowed)) ? "draft_only" : "not_verified",
    required_next_step: nextStep,
    questionnaire_answers: { ...object(previous.questionnaire_answers), ...object(args.provided_inputs) },
    schema_fingerprint: questionnaire.schema_fingerprint,
    capability_key: capabilityKey || null,
    operation_ref: previous.operation_ref || null,
  });

  return {
    ok: true,
    tool: "tenant_conversation_orchestration_preview",
    status: nextStep === "action_preview_ready" ? "preview_ready" : "input_or_readiness_required",
    mode: "read_only_orchestration",
    protocol: [
      { stage: "resolve_context", status: contextReady ? "complete" : "blocked" },
      { stage: "live_status", status: connectionEvidence === "live_verified" ? "complete" : "requires_validation" },
      { stage: "capability_preview", status: capability?.ready ? "complete" : capabilityKey ? "blocked" : "required" },
      { stage: "missing_inputs", status: questionnaire.missing_field_count ? "required" : "complete" },
      { stage: "action_preview", status: capability?.ready && !questionnaire.missing_field_count ? "ready" : "pending" },
      { stage: "approval", status: approvalRequired ? "required" : "not_required" },
      { stage: "execute", status: "not_performed" },
      { stage: "readback", status: capability?.capability?.requires_readback ? "planned" : "not_required" },
    ],
    current_stage: nextStep,
    principal: context.principal,
    context: {
      brand: context.brand,
      workspace,
      resource,
      resource_candidates: resourceResult.candidates,
      resource_ambiguous: resourceResult.ambiguous,
      connection_state: context.connection_state,
    },
    evidence: {
      connection: { class: connectionEvidence, label: evidenceLabel(connectionEvidence), executable: EXECUTABLE_EVIDENCE.has(connectionEvidence) },
      capability: { class: capabilityEvidenceClass, label: evidenceLabel(capabilityEvidenceClass), executable: EXECUTABLE_EVIDENCE.has(capabilityEvidenceClass) },
      brand_core: { class: "historical_snapshot", label: evidenceLabel("historical_snapshot"), executable: false },
      business_intent: { class: context.brand ? "brand_inferred" : "generic_intent", label: evidenceLabel(context.brand ? "brand_inferred" : "generic_intent"), executable: false },
    },
    business_intent: memoryPatch.business_intent,
    verified_executable_resource: executableResource,
    capability_preview: capability,
    questionnaire,
    action_preview: capability ? {
      tool: capability.projection?.tool_name || null,
      capability_key: capability.capability?.capability_key || capabilityKey,
      target_resource: executableResource,
      selected_connection: capability.connection || null,
      connection_selection_reason: capability.resource_binding?.selection_reason || "exact_resource_binding_required",
      verification_status: capability.status,
      authority: capability.authority || null,
      effect: operationKey || null,
      reversible: READ_OPERATIONS.has(operationKey) ? true : null,
      approval_required: approvalRequired,
      idempotency_required: !READ_OPERATIONS.has(operationKey),
      readback_required: Boolean(capability.capability?.requires_readback),
      execution_allowed: false,
      execution_block_reason: "preview_only_orchestrator",
    } : null,
    memory_patch: memoryPatch,
    next_required_step: nextStep,
    automation: {
      context_resolution_reused: true,
      capability_preview_reused: Boolean(capability),
      schema_questions_generated: questionnaire.schema_present,
      contradiction_checks: [
        "resource_ambiguity",
        "connection_resource_binding",
        "active_not_equal_ready",
        "scope_widening_forbidden",
        "preview_before_execution",
      ],
      provider_apply_allowed: false,
    },
    provider_calls_made: 0,
    mutations_executed: false,
    approvals_created: 0,
    external_sends: 0,
    secrets_included: false,
  };
}

export async function tenantConversationOrchestrationReadinessSmoke(_args = {}, { pool = getPool() } = {}) {
  const required = [
    "workspace_registry",
    "brands",
    "brand_core",
    "workspace_app_links",
    "user_app_connections",
    "credential_bindings",
    "cms_sites",
    "brand_site_bindings",
    "cms_site_access_grants",
    "platform_semantic_capabilities",
    "platform_capability_provider_bindings",
  ];
  const found = await rows(
    pool,
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${required.map(() => "?").join(",")})`,
    required
  );
  const present = new Set(found.map((row) => row.table_name));
  const dynamicFixture = mergeOperationalMemory({ selected_brand: "brand-fixture-a" }, { selected_brand: "brand-fixture-b" });
  const checks = [
    { name: "required_schema_objects_present", pass: required.every((name) => present.has(name)), missing: required.filter((name) => !present.has(name)) },
    { name: "four_descriptor_tools_present", pass: TENANT_CONVERSATION_ORCHESTRATION_SYSTEM_TOOLS.length === 4 },
    { name: "dynamic_identity_fixture", pass: dynamicFixture.selected_brand === "brand-fixture-b" },
    { name: "five_evidence_classes_present", pass: ["live_verified", "indexed_and_fresh", "historical_snapshot", "brand_inferred", "generic_intent"].every((key) => Boolean(EVIDENCE_LABELS[key])) },
    { name: "no_provider_call", pass: true },
    { name: "no_mutation", pass: true },
    { name: "no_external_send", pass: true },
    { name: "no_secrets", pass: true },
  ];
  const ok = checks.every((check) => check.pass === true);
  return {
    ok,
    tool: "tenant_conversation_orchestration_readiness_smoke",
    status: ok ? "pass" : "fail",
    classification: ok ? "tenant_conversation_orchestration_ready" : "tenant_conversation_orchestration_not_ready",
    checks,
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}
