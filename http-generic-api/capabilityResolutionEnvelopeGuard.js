import { resolveActivationBootstrapConfig } from "./activationBootstrapConfig.js";
import { resolveCapabilityExecutionEnvelope as resolveCapabilityExecutionEnvelopeCore } from "./capabilityResolutionEnvelopeGuardCore.js";

export * from "./capabilityResolutionEnvelopeGuardCore.js";

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function exactGithubUri(owner = "", repo = "") {
  const normalizedOwner = compact(owner, 191);
  const normalizedRepo = compact(repo, 191).replace(/\.git$/i, "");
  return normalizedOwner && normalizedRepo ? `github://${normalizedOwner}/${normalizedRepo}` : "";
}

function isRepoPatchEnvelopeRequest(options = {}) {
  const apps = new Set((options.acceptedAppKeys || []).map((value) => compact(value, 128).toLowerCase()));
  if (!apps.has("github")) return false;
  const values = [
    ...(options.acceptedIntents || []),
    ...(options.acceptedCapabilityKeys || []),
  ].map((value) => compact(value, 191).toLowerCase());
  return values.some((value) => ["repo_patch_apply", "github_repo_patch", "repo_mutation", "write", "create", "delete"].includes(value));
}

async function resolveRepoPatchExpectedResourceUri(options = {}) {
  const explicit = compact(options.expectedResourceUri, 2048);
  if (explicit) return explicit;
  if (!isRepoPatchEnvelopeRequest(options)) return "";

  const source = options.source && typeof options.source === "object" ? options.source : {};
  const direct = exactGithubUri(source.owner, source.repo);
  if (direct) return direct;

  const pool = options.pool || null;
  const bootstrap = await resolveActivationBootstrapConfig({
    query: pool?.query ? (sql, params) => pool.query(sql, params) : undefined,
  });
  if (!bootstrap?.ok) return "";
  return exactGithubUri(bootstrap.config?.github_owner, bootstrap.config?.github_repo);
}

async function loadPrincipalBinding(pool, envelopeId) {
  if (!pool?.query || !envelopeId) return null;
  const [rows] = await pool.query(
    `SELECT user_id, envelope_json
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id = ?
      LIMIT 1`,
    [envelopeId],
  );
  const row = rows?.[0] || null;
  if (!row) return null;
  const envelopeJson = parseJson(row.envelope_json, {});
  const principal = envelopeJson?.request_context?.principal;
  return {
    ledger_user_id: compact(row.user_id, 64),
    principal_type: compact(principal?.principal_type, 32).toLowerCase(),
    principal_id: compact(principal?.principal_id, 64),
  };
}

export async function resolveCapabilityExecutionEnvelope(options = {}) {
  const expectedResourceUri = await resolveRepoPatchExpectedResourceUri(options);
  if (isRepoPatchEnvelopeRequest(options) && !expectedResourceUri) {
    return {
      ok: false,
      status: "capability_resolution_envelope_resource_target_unresolved",
      envelope_required: true,
      message: "The exact GitHub repository target must resolve before repository mutation dispatch.",
      secrets_included: false,
    };
  }

  const resolved = await resolveCapabilityExecutionEnvelopeCore({
    ...options,
    expectedResourceUri: expectedResourceUri || options.expectedResourceUri || "",
  });
  if (!resolved.ok) return resolved;

  const pool = options.pool || null;
  const principal = await loadPrincipalBinding(pool, resolved.envelope_id);
  if (principal?.principal_type === "service") {
    if (!principal.principal_id || principal.ledger_user_id !== principal.principal_id) {
      return {
        ok: false,
        status: "capability_resolution_envelope_service_principal_binding_mismatch",
        envelope_required: true,
        envelope_id: resolved.envelope_id,
        secrets_included: false,
      };
    }
    if (compact(options.expectedUserId, 64) && compact(options.expectedUserId, 64) !== principal.principal_id) {
      return {
        ok: false,
        status: "capability_resolution_envelope_user_mismatch",
        envelope_required: true,
        envelope_id: resolved.envelope_id,
        secrets_included: false,
      };
    }
  }

  return {
    ...resolved,
    principal_type: principal?.principal_type || null,
    principal_id: principal?.principal_id || resolved.user_id || null,
    resource_uri: expectedResourceUri || resolved.resource_uri || null,
    secrets_included: false,
  };
}
