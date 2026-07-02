import { getPool } from "./db.js";
import { stableCapabilityHash } from "./dynamicCapabilityGovernanceCompiler.js";

export const DYNAMIC_CAPABILITY_CERTIFICATION_READBACK_VERSION =
  "dynamic-capability-certification-readback-v1";

const MUTATION_EFFECTS = new Set([
  "internal_write",
  "workspace_write",
  "external_write",
  "credential_touching",
  "deployment_affecting",
  "destructive",
]);

function rowsOf(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function bool(value) {
  return value === true || Number(value || 0) === 1 || String(value || "").toLowerCase() === "true";
}

function text(value, max = 191) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (!String(value || "").trim()) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function normalizeInput(input = {}) {
  const capabilityKey = text(input.capability_key);
  if (!capabilityKey) throw fail(400, "capability_certification_readback_capability_required", "capability_key is required.");
  const operationMode = text(input.operation_mode || "preview", 16).toLowerCase();
  if (!["preview", "apply"].includes(operationMode)) {
    throw fail(400, "capability_certification_readback_mode_invalid", "operation_mode must be preview or apply.");
  }
  return {
    capability_key: capabilityKey,
    operation_mode: operationMode,
    adapter_key: text(input.adapter_key) || null,
    resource_type: text(input.resource_type, 128) || null,
    provider_key: text(input.provider_key, 128) || null,
    runtime_surface: text(input.runtime_surface) || null,
    contract_key: text(input.contract_key) || null,
    environment: text(input.environment || "production", 64).toLowerCase(),
    evidence_limit: Math.max(1, Math.min(100, Number(input.evidence_limit || 25))),
  };
}

async function loadCurrentManifest(pool, capabilityKey) {
  const rows = rowsOf(await pool.query(
    `SELECT manifest_id, capability_key, manifest_version, manifest_hash,
            source_revision_hash, compiler_version, effect_class, risk_class,
            status, rollout_mode, manifest_json, created_at
       FROM platform_capability_compiled_manifests
      WHERE capability_key = ? AND is_current = 1
      ORDER BY manifest_version DESC
      LIMIT 2`,
    [capabilityKey],
  ));
  if (rows.length > 1) {
    throw fail(409, "CAPABILITY_SELECTOR_AMBIGUOUS", "More than one current manifest exists.", {
      capability_key: capabilityKey,
      current_manifest_count: rows.length,
    });
  }
  if (!rows[0]) {
    throw fail(404, "CAPABILITY_NOT_REGISTERED", "No current persisted manifest exists.", {
      capability_key: capabilityKey,
    });
  }
  return rows[0];
}

function selectorValues(request, manifest) {
  return [...new Set([
    request.adapter_key,
    request.resource_type,
    request.provider_key,
    request.runtime_surface,
    text(manifest?.source?.key),
    request.capability_key,
  ].filter(Boolean))];
}

async function loadAdapters(pool, request, manifest) {
  const values = selectorValues(request, manifest);
  if (!values.length) return [];
  const marks = values.map(() => "?").join(", ");
  return rowsOf(await pool.query(
    `SELECT adapter_key, resource_type, provider_key, adapter_kind,
            installed_tool_key, supports_plan, supports_read, supports_write,
            status, metadata_json, created_at, updated_at
       FROM platform_resource_adapters
      WHERE adapter_key IN (${marks})
         OR resource_type IN (${marks})
         OR provider_key IN (${marks})
         OR installed_tool_key IN (${marks})
      ORDER BY adapter_key ASC`,
    [...values, ...values, ...values, ...values],
  ));
}

function adapterScore(row, request, manifest) {
  const sourceKey = text(manifest?.source?.key);
  const metadata = parseJson(row.metadata_json);
  const delegated = Array.isArray(metadata.delegates_to)
    ? metadata.delegates_to.map((item) => text(item)).filter(Boolean)
    : [text(metadata.delegates_to)].filter(Boolean);
  let score = 0;
  if (request.adapter_key && row.adapter_key === request.adapter_key) score += 1000;
  if (request.runtime_surface && row.installed_tool_key === request.runtime_surface) score += 850;
  if (sourceKey && row.installed_tool_key === sourceKey) score += 800;
  if (sourceKey && delegated.includes(sourceKey)) score += 700;
  if (request.resource_type && row.resource_type === request.resource_type) score += 500;
  if (request.provider_key && row.provider_key === request.provider_key) score += 300;
  return score;
}

function adapterEligibility(row, request, manifest) {
  if (row.status !== "active") return { ok: false, reason_code: "ADAPTER_INACTIVE" };
  const mutation = MUTATION_EFFECTS.has(String(manifest.effect_class || ""));
  if (request.operation_mode === "apply" && mutation && !bool(row.supports_write)) {
    return { ok: false, reason_code: "ADAPTER_WRITE_UNSUPPORTED" };
  }
  if (!mutation && !bool(row.supports_read) && !bool(row.supports_plan)) {
    return { ok: false, reason_code: "ADAPTER_READ_UNSUPPORTED" };
  }
  return { ok: true, reason_code: null };
}

function boundedAdapter(row) {
  if (!row) return null;
  return {
    adapter_key: row.adapter_key,
    resource_type: row.resource_type,
    provider_key: row.provider_key || null,
    adapter_kind: row.adapter_kind,
    installed_tool_key: row.installed_tool_key || null,
    supports_plan: bool(row.supports_plan),
    supports_read: bool(row.supports_read),
    supports_write: bool(row.supports_write),
    status: row.status,
    secrets_included: false,
  };
}

function resolveAdapter(rows, request, manifest) {
  const ranked = rows
    .map((row) => ({ row, score: adapterScore(row, request, manifest), eligibility: adapterEligibility(row, request, manifest) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.row.adapter_key).localeCompare(String(b.row.adapter_key)));
  if (!ranked.length) return { state: "missing", reason_code: "ADAPTER_REQUIRED", candidate_count: 0, adapter: null };
  const eligible = ranked.filter((item) => item.eligibility.ok);
  if (!eligible.length) {
    return {
      state: "blocked",
      reason_code: ranked[0].eligibility.reason_code,
      candidate_count: ranked.length,
      adapter: boundedAdapter(ranked[0].row),
    };
  }
  if (eligible.length > 1 && eligible[0].score === eligible[1].score) {
    return { state: "ambiguous", reason_code: "ADAPTER_BINDING_AMBIGUOUS", candidate_count: eligible.length, adapter: null };
  }
  return { state: "pass", reason_code: null, candidate_count: eligible.length, adapter: boundedAdapter(eligible[0].row) };
}

async function loadGenericCertifications(pool, request, manifest, adapter) {
  const keys = [...new Set([
    request.capability_key,
    request.runtime_surface,
    adapter?.adapter_key,
    adapter?.installed_tool_key,
    text(manifest?.source?.key),
  ].filter(Boolean))];
  const marks = keys.map(() => "?").join(", ");
  return rowsOf(await pool.query(
    `SELECT certification_id, capability_key, certification_type, environment,
            subject_type, subject_key, certification_status, evidence_id,
            source_registry, source_key, certified_at, expires_at, revoked_at,
            metadata_json, secrets_included, created_at, updated_at
       FROM platform_capability_certifications
      WHERE capability_key IN (${marks})
         OR subject_key IN (${marks})
         OR source_key IN (${marks})
      ORDER BY updated_at DESC, certification_id ASC`,
    [...keys, ...keys, ...keys],
  ));
}

async function loadRuntimeCertifications(pool, request, manifest, adapter) {
  const keys = [...new Set([
    request.runtime_surface,
    adapter?.adapter_key,
    adapter?.installed_tool_key,
    text(manifest?.source?.key),
    request.capability_key,
  ].filter(Boolean))];
  const marks = keys.map(() => "?").join(", ");
  return rowsOf(await pool.query(
    `SELECT certification_key, surface_key, surface_family, tool_or_action_key,
            risk_class, certification_status, smoke_strategy, dispatch_allowed,
            apply_allowed, requires_resource_authority, requires_dry_run,
            requires_audit_evidence, requires_readback, last_evidence_ref,
            last_certified_at, expires_at, notes, created_at, updated_at
       FROM runtime_dispatch_certification_registry
      WHERE certification_key IN (${marks})
         OR surface_key IN (${marks})
         OR tool_or_action_key IN (${marks})
      ORDER BY updated_at DESC, certification_key ASC`,
    [...keys, ...keys, ...keys],
  ));
}

function expired(value, nowMs) {
  if (!value) return false;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed <= nowMs;
}

function statusKind(value) {
  const normalized = text(value, 128).toLowerCase();
  if (normalized.includes("revok")) return "revoked";
  if (normalized.includes("stale") || normalized.includes("expired")) return "stale";
  if (normalized.includes("pending") || normalized.includes("baseline_registered") || normalized === "draft") return "pending";
  if (/(certified|passed|approved|ready|active)/.test(normalized)) return "certified";
  return "unknown";
}

function genericCertificationState(row, request, nowMs) {
  if (bool(row.secrets_included)) return { state: "blocked", reason_code: "CERTIFICATION_SECRET_POLICY_VIOLATION" };
  if (row.revoked_at || statusKind(row.certification_status) === "revoked") return { state: "revoked", reason_code: "CERTIFICATION_REVOKED" };
  if (expired(row.expires_at, nowMs) || statusKind(row.certification_status) === "stale") return { state: "stale", reason_code: "CERTIFICATION_STALE" };
  if (String(row.environment || "").toLowerCase() !== request.environment) return { state: "blocked", reason_code: "CERTIFICATION_ENVIRONMENT_MISMATCH" };
  if (!row.certified_at || statusKind(row.certification_status) !== "certified") return { state: "pending", reason_code: "CERTIFICATION_REQUIRED" };
  return { state: "pass", reason_code: null };
}

function runtimeCertificationState(row, request, nowMs) {
  if (expired(row.expires_at, nowMs) || statusKind(row.certification_status) === "stale") return { state: "stale", reason_code: "CERTIFICATION_STALE" };
  if (statusKind(row.certification_status) === "revoked") return { state: "revoked", reason_code: "CERTIFICATION_REVOKED" };
  if (!bool(row.dispatch_allowed)) return { state: "pending", reason_code: "CERTIFICATION_REQUIRED" };
  if (request.operation_mode === "apply" && !bool(row.apply_allowed)) return { state: "blocked", reason_code: "CERTIFICATION_APPLY_NOT_ALLOWED" };
  if (!row.last_certified_at && request.operation_mode === "apply") return { state: "pending", reason_code: "CERTIFICATION_REQUIRED" };
  return { state: "pass", reason_code: null };
}

function certificationScore(row, request, manifest, adapter, source) {
  const sourceKey = text(manifest?.source?.key);
  let score = source === "generic" ? 100 : 0;
  if (source === "generic" && row.capability_key === request.capability_key) score += 1000;
  if (source === "generic" && adapter?.adapter_key && row.subject_key === adapter.adapter_key) score += 850;
  if (source === "generic" && request.runtime_surface && row.subject_key === request.runtime_surface) score += 800;
  if (source === "generic" && sourceKey && row.subject_key === sourceKey) score += 700;
  if (source === "runtime" && request.runtime_surface && [row.surface_key, row.tool_or_action_key].includes(request.runtime_surface)) score += 900;
  if (source === "runtime" && adapter?.installed_tool_key && [row.surface_key, row.tool_or_action_key].includes(adapter.installed_tool_key)) score += 850;
  if (source === "runtime" && sourceKey && [row.surface_key, row.tool_or_action_key].includes(sourceKey)) score += 800;
  if (source === "runtime" && row.certification_key === request.capability_key) score += 700;
  return score;
}

function boundedGenericCertification(row) {
  return {
    source: "platform_capability_certifications",
    certification_id: row.certification_id,
    capability_key: row.capability_key,
    certification_type: row.certification_type,
    environment: row.environment,
    subject_type: row.subject_type || null,
    subject_key: row.subject_key || null,
    certification_status: row.certification_status,
    evidence_id: row.evidence_id || null,
    source_registry: row.source_registry || null,
    source_key: row.source_key || null,
    certified_at: row.certified_at || null,
    expires_at: row.expires_at || null,
    revoked_at: row.revoked_at || null,
    secrets_included: false,
  };
}

function boundedRuntimeCertification(row) {
  return {
    source: "runtime_dispatch_certification_registry",
    certification_key: row.certification_key,
    surface_key: row.surface_key,
    surface_family: row.surface_family,
    tool_or_action_key: row.tool_or_action_key || null,
    certification_status: row.certification_status,
    dispatch_allowed: bool(row.dispatch_allowed),
    apply_allowed: bool(row.apply_allowed),
    requires_readback: bool(row.requires_readback),
    last_evidence_ref: row.last_evidence_ref || null,
    last_certified_at: row.last_certified_at || null,
    expires_at: row.expires_at || null,
    secrets_included: false,
  };
}

function resolveCertification(genericRows, runtimeRows, request, manifest, adapter, nowMs) {
  const runtimeByKey = new Map(runtimeRows.map((row) => [row.certification_key, row]));
  const candidates = [];
  for (const row of genericRows) {
    const state = genericCertificationState(row, request, nowMs);
    const linked = row.source_registry === "runtime_dispatch_certification_registry" && row.source_key
      ? runtimeByKey.get(row.source_key) || null
      : null;
    let reconciled = state;
    if (linked) {
      const specialized = runtimeCertificationState(linked, request, nowMs);
      if (state.state === "pass" && specialized.state !== "pass") {
        reconciled = { state: specialized.state, reason_code: "CERTIFICATION_SOURCE_CONFLICT" };
      }
    }
    candidates.push({
      source: "generic",
      score: certificationScore(row, request, manifest, adapter, "generic"),
      state: reconciled,
      identity: `generic:${row.certification_id}`,
      certification: boundedGenericCertification(row),
      specialized: linked ? boundedRuntimeCertification(linked) : null,
    });
  }
  for (const row of runtimeRows) {
    if (genericRows.some((item) => item.source_registry === "runtime_dispatch_certification_registry" && item.source_key === row.certification_key)) continue;
    candidates.push({
      source: "runtime",
      score: certificationScore(row, request, manifest, adapter, "runtime"),
      state: runtimeCertificationState(row, request, nowMs),
      identity: `runtime:${row.certification_key}`,
      certification: boundedRuntimeCertification(row),
      specialized: null,
    });
  }
  const ranked = candidates.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.identity.localeCompare(b.identity));
  if (!ranked.length) return { state: "missing", reason_code: "CERTIFICATION_REQUIRED", candidate_count: 0, certification: null };
  const passing = ranked.filter((item) => item.state.state === "pass");
  if (passing.length > 1 && passing[0].score === passing[1].score) {
    return { state: "ambiguous", reason_code: "CERTIFICATION_BINDING_AMBIGUOUS", candidate_count: passing.length, certification: null };
  }
  const selected = passing[0] || ranked[0];
  return {
    state: selected.state.state,
    reason_code: selected.state.reason_code,
    candidate_count: ranked.length,
    certification: selected.certification,
    specialized_source: selected.specialized,
  };
}

async function loadReadbackContracts(pool, request, adapter) {
  const adapterKey = adapter?.adapter_key || request.adapter_key;
  try {
    return rowsOf(await pool.query(
      `SELECT contract_id, contract_key, contract_version, capability_key,
              adapter_key, verification_type, acknowledgement_required,
              verification_required, expected_effect_class, input_schema_json,
              observed_state_schema_json, provider_binding_constraints_json,
              certification_status, status, is_current, valid_from, expires_at,
              revoked_at, source_registry, source_key, secrets_included,
              created_at, updated_at
         FROM platform_capability_readback_contracts
        WHERE is_current = 1
          AND capability_key = ?
          AND (? IS NULL OR contract_key = ?)
          AND (? IS NULL OR adapter_key IS NULL OR adapter_key = ?)
        ORDER BY contract_version DESC, contract_key ASC
        LIMIT 20`,
      [request.capability_key, request.contract_key, request.contract_key, adapterKey || null, adapterKey || null],
    ));
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_TABLE_ERROR"].includes(error?.code)) return [];
    throw error;
  }
}

function readbackScore(row, request, adapter) {
  let score = 0;
  if (request.contract_key && row.contract_key === request.contract_key) score += 1000;
  if (adapter?.adapter_key && row.adapter_key === adapter.adapter_key) score += 800;
  if (!row.adapter_key) score += 300;
  if (row.capability_key === request.capability_key) score += 200;
  return score;
}

function readbackState(row, request, manifest, nowMs) {
  if (bool(row.secrets_included)) return { state: "blocked", reason_code: "READBACK_SECRET_POLICY_VIOLATION" };
  if (row.revoked_at || row.status === "revoked" || row.certification_status === "revoked") return { state: "revoked", reason_code: "READBACK_CONTRACT_REVOKED" };
  if (expired(row.expires_at, nowMs) || row.status === "stale" || row.certification_status === "stale") return { state: "stale", reason_code: "READBACK_CONTRACT_STALE" };
  if (row.expected_effect_class && row.expected_effect_class !== manifest.effect_class) return { state: "blocked", reason_code: "READBACK_EFFECT_CLASS_MISMATCH" };
  if (request.operation_mode === "apply" && (row.status !== "certified" || row.certification_status !== "certified")) {
    return { state: "pending", reason_code: "READBACK_CONTRACT_REQUIRED" };
  }
  if (request.operation_mode === "preview" && !["shadow", "certified"].includes(row.status)) {
    return { state: "pending", reason_code: "READBACK_CONTRACT_REQUIRED" };
  }
  return { state: "pass", reason_code: null };
}

function boundedReadback(row) {
  if (!row) return null;
  return {
    contract_id: row.contract_id,
    contract_key: row.contract_key,
    contract_version: Number(row.contract_version || 0),
    capability_key: row.capability_key,
    adapter_key: row.adapter_key || null,
    verification_type: row.verification_type,
    acknowledgement_required: bool(row.acknowledgement_required),
    verification_required: bool(row.verification_required),
    expected_effect_class: row.expected_effect_class || null,
    certification_status: row.certification_status,
    status: row.status,
    valid_from: row.valid_from || null,
    expires_at: row.expires_at || null,
    revoked_at: row.revoked_at || null,
    source_registry: row.source_registry || null,
    source_key: row.source_key || null,
    schemas_returned: false,
    secrets_included: false,
  };
}

function resolveReadback(rows, request, manifest, adapter, nowMs) {
  const ranked = rows
    .map((row) => ({ row, score: readbackScore(row, request, adapter), state: readbackState(row, request, manifest, nowMs) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.row.contract_key).localeCompare(String(b.row.contract_key)));
  if (!ranked.length) return { state: "missing", reason_code: "READBACK_CONTRACT_REQUIRED", candidate_count: 0, contract: null };
  const passing = ranked.filter((item) => item.state.state === "pass");
  if (passing.length > 1 && passing[0].score === passing[1].score) {
    return { state: "ambiguous", reason_code: "READBACK_CONTRACT_AMBIGUOUS", candidate_count: passing.length, contract: null };
  }
  const selected = passing[0] || ranked[0];
  return {
    state: selected.state.state,
    reason_code: selected.state.reason_code,
    candidate_count: ranked.length,
    contract: boundedReadback(selected.row),
  };
}

function resolveAdapterRequirement({ request, requirements = {}, readbackResolution }) {
  const adapterRequirement = requirements.adapter;
  const adapterRequirementText = typeof adapterRequirement === "string"
    ? text(adapterRequirement, 64).toLowerCase()
    : "";
  const adapterRequirementObject = adapterRequirement && typeof adapterRequirement === "object"
    ? adapterRequirement
    : {};
  const sources = {
    request_selector: Boolean(request.adapter_key || request.resource_type || request.provider_key),
    manifest_requirement: bool(requirements.adapter_required)
      || bool(requirements.requires_adapter)
      || bool(requirements.resource_adapter)
      || bool(requirements.provider_adapter)
      || bool(adapterRequirement)
      || ["required", "adapter_required"].includes(adapterRequirementText)
      || bool(adapterRequirementObject.required)
      || Boolean(
        text(adapterRequirementObject.adapter_key)
        || text(adapterRequirementObject.resource_type, 128)
        || text(adapterRequirementObject.provider_key, 128)
      ),
    readback_contract: Boolean(readbackResolution?.contract?.adapter_key),
  };
  return {
    required: Object.values(sources).some(Boolean),
    sources,
  };
}

async function loadEvidence(pool, capabilityKey, limit) {
  return rowsOf(await pool.query(
    `SELECT evidence_id, evidence_type, subject_type, subject_key,
            capability_key, certification_id, source_system, source_ref,
            evidence_status, reason_code, payload_hash, observed_at,
            expires_at, revoked_at, supersedes_evidence_id, secrets_included
       FROM platform_evidence_events
      WHERE capability_key = ?
      ORDER BY observed_at DESC, evidence_id DESC
      LIMIT ?`,
    [capabilityKey, limit],
  ));
}

function summarizeEvidence(rows) {
  const safe = rows.filter((row) => !bool(row.secrets_included));
  const acknowledgement = safe.find((row) => /acknowledg/i.test(String(row.evidence_type || "")));
  const verification = safe.find((row) => /(readback|verification|verified)/i.test(String(row.evidence_type || "")));
  const ackState = !acknowledgement
    ? "not_started"
    : acknowledgement.evidence_status === "passed"
      ? "acknowledged"
      : ["failed", "blocked", "revoked", "expired"].includes(acknowledgement.evidence_status)
        ? "failed"
        : "observed";
  const verifyState = !verification
    ? "not_started"
    : verification.evidence_status === "passed"
      ? "verified"
      : ["failed", "blocked", "revoked", "expired"].includes(verification.evidence_status)
        ? "failed"
        : "unknown_effect";
  const bounded = (row) => row ? {
    evidence_id: row.evidence_id,
    evidence_type: row.evidence_type,
    evidence_status: row.evidence_status,
    reason_code: row.reason_code || null,
    source_system: row.source_system,
    source_ref: row.source_ref || null,
    payload_hash: row.payload_hash || null,
    observed_at: row.observed_at,
    expires_at: row.expires_at || null,
    revoked_at: row.revoked_at || null,
    secrets_included: false,
  } : null;
  return {
    acknowledgement: { state: ackState, evidence: bounded(acknowledgement) },
    verification: { state: verifyState, evidence: bounded(verification) },
  };
}

function nextAction(reason) {
  const map = {
    ADAPTER_REQUIRED: "register_or_select_adapter",
    ADAPTER_INACTIVE: "activate_certified_adapter",
    ADAPTER_WRITE_UNSUPPORTED: "select_write_capable_adapter",
    ADAPTER_READ_UNSUPPORTED: "select_read_capable_adapter",
    ADAPTER_BINDING_AMBIGUOUS: "resolve_adapter_ambiguity",
    CERTIFICATION_REQUIRED: "certify_selected_adapter",
    CERTIFICATION_STALE: "recertify_selected_adapter",
    CERTIFICATION_REVOKED: "replace_revoked_certification",
    CERTIFICATION_APPLY_NOT_ALLOWED: "obtain_apply_certification",
    CERTIFICATION_BINDING_AMBIGUOUS: "resolve_certification_ambiguity",
    CERTIFICATION_SOURCE_CONFLICT: "reconcile_specialized_certification_source",
    READBACK_CONTRACT_REQUIRED: "register_certified_readback_contract",
    READBACK_CONTRACT_STALE: "recertify_readback_contract",
    READBACK_CONTRACT_REVOKED: "replace_revoked_readback_contract",
    READBACK_CONTRACT_AMBIGUOUS: "resolve_readback_contract_ambiguity",
    READBACK_EFFECT_CLASS_MISMATCH: "align_readback_effect_class",
  };
  return map[reason] || "review_assurance_gap";
}

export async function buildDynamicCapabilityCertificationReadbackPreview(input = {}, deps = {}) {
  const request = normalizeInput(input);
  const pool = deps.pool || getPool();
  const observedAt = typeof deps.now === "function" ? deps.now() : new Date().toISOString();
  const nowMs = new Date(observedAt).getTime();
  const manifestRow = await loadCurrentManifest(pool, request.capability_key);
  const manifest = parseJson(manifestRow.manifest_json);
  const requirements = manifest.requirements && typeof manifest.requirements === "object" ? manifest.requirements : {};

  const manifestContext = { ...manifest, effect_class: manifestRow.effect_class };
  const adapterRows = await loadAdapters(pool, request, manifestContext);
  const adapterResolution = resolveAdapter(adapterRows, request, manifestContext);
  const selectedAdapter = adapterResolution.adapter;

  const genericRows = await loadGenericCertifications(pool, request, manifest, selectedAdapter);
  const runtimeRows = await loadRuntimeCertifications(pool, request, manifest, selectedAdapter);
  const certificationResolution = resolveCertification(genericRows, runtimeRows, request, manifest, selectedAdapter, nowMs);

  const readbackRows = await loadReadbackContracts(pool, request, selectedAdapter);
  const readbackResolution = resolveReadback(readbackRows, request, manifestRow, selectedAdapter, nowMs);
  const evidence = summarizeEvidence(await loadEvidence(pool, request.capability_key, request.evidence_limit));

  const mutation = MUTATION_EFFECTS.has(String(manifestRow.effect_class || ""));
  const adapterRequired = request.operation_mode === "apply" || Boolean(request.adapter_key || request.resource_type || request.provider_key);
  const certificationRequired = request.operation_mode === "apply" && bool(requirements.certification);
  const readbackRequired = request.operation_mode === "apply" && (mutation || bool(requirements.readback));
  const blockers = [];
  if (adapterRequired && adapterResolution.state !== "pass") blockers.push(adapterResolution.reason_code);
  if (certificationRequired && certificationResolution.state !== "pass") blockers.push(certificationResolution.reason_code);
  if (readbackRequired && readbackResolution.state !== "pass") blockers.push(readbackResolution.reason_code);
  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];

  const assuranceState = request.operation_mode === "preview"
    ? "shadow_preview"
    : uniqueBlockers.length
      ? "blocked"
      : "ready_for_dispatch_shadow";

  const decisionHash = stableCapabilityHash({
    version: DYNAMIC_CAPABILITY_CERTIFICATION_READBACK_VERSION,
    capability_key: request.capability_key,
    manifest_hash: manifestRow.manifest_hash,
    source_revision_hash: manifestRow.source_revision_hash,
    operation_mode: request.operation_mode,
    adapter_resolution: adapterResolution,
    certification_resolution: certificationResolution,
    readback_resolution: readbackResolution,
    evidence,
    blockers: uniqueBlockers,
  });

  return {
    ok: true,
    report_type: "dynamic_capability_certification_readback_preview",
    version: DYNAMIC_CAPABILITY_CERTIFICATION_READBACK_VERSION,
    mode: "shadow",
    observed_at: observedAt,
    capability_key: request.capability_key,
    operation_mode: request.operation_mode,
    decision_hash: decisionHash,
    manifest: {
      manifest_id: manifestRow.manifest_id,
      manifest_version: Number(manifestRow.manifest_version || 0),
      manifest_hash: manifestRow.manifest_hash,
      source_revision_hash: manifestRow.source_revision_hash,
      compiler_version: manifestRow.compiler_version,
      effect_class: manifestRow.effect_class,
      risk_class: manifestRow.risk_class,
      status: manifestRow.status,
      rollout_mode: manifestRow.rollout_mode,
      source: manifest.source || { table: null, key: null },
      requirements,
      secrets_included: false,
    },
    adapter_resolution: adapterResolution,
    certification_resolution: certificationResolution,
    readback_contract_resolution: readbackResolution,
    post_execution_evidence: evidence,
    assurance_state: assuranceState,
    blockers: uniqueBlockers,
    next_actions: [...new Set(uniqueBlockers.map(nextAction))],
    diagnostics: {
      mutation_effect_class: mutation,
      adapter_required: adapterRequired,
      certification_required: certificationRequired,
      readback_required: readbackRequired,
      apply_contract_ready: request.operation_mode === "apply" && uniqueBlockers.length === 0,
      acknowledgement_and_verification_separated: true,
      specialized_certification_sources_reconciled: true,
      legacy_authority_preserved: true,
    },
    execution_performed: false,
    guarantees: {
      registry: "mysql_primary",
      existing_adapter_authority_reused: true,
      existing_certification_authorities_reused: true,
      readback_contract_authority_additive_only: true,
      runtime_authority_changed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      mutations_performed: false,
      credential_payloads_read: false,
      raw_evidence_payloads_returned: false,
      fail_closed_for_apply: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export const _testingDynamicCapabilityCertificationReadback = {
  normalizeInput,
  resolveAdapter,
  resolveCertification,
  resolveReadback,
  summarizeEvidence,
};
