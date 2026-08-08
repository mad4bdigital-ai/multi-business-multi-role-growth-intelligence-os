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
  return values.some((value) => ["repo_patch_apply", "github_repo_patch"].includes(value));
}

function repoPatchSourceScope(options = {}) {
  const source = options.source && typeof options.source === "object" ? options.source : {};
  return {
    branch: compact(source.branch || source.resource_branch || source.resourceBranch, 255),
    expected_commit_sha: compact(
      source.expected_branch_sha || source.expectedBranchSha ||
      source.expected_commit_sha || source.expectedCommitSha ||
      source.expected_base_sha || source.expectedBaseSha ||
      options.expectedCommitSha,
      64,
    ).toLowerCase(),
  };
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
  const requestContext = envelopeJson?.request_context || {};
  const principal = requestContext?.principal;
  const authorityScope = envelopeJson?.authority?.exact_platform_resource_authority_scope || {};
  return {
    ledger_user_id: compact(row.user_id, 64),
    principal_type: compact(principal?.principal_type, 32).toLowerCase(),
    principal_id: compact(principal?.principal_id, 64),
    resource_branch: compact(requestContext.resource_branch || authorityScope.resource_branch, 255),
    expected_commit_sha: compact(requestContext.expected_commit_sha || authorityScope.expected_commit_sha, 64).toLowerCase(),
    exact_platform_authority_scope_matched: authorityScope?.matched === true,
  };
}

function envelopeScopeFailure(status, envelopeId, details = {}) {
  return {
    ok: false,
    status,
    envelope_required: true,
    envelope_id: envelopeId,
    ...details,
    secrets_included: false,
  };
}

export async function resolveCapabilityExecutionEnvelope(options = {}) {
  const expectedResourceUri = await resolveRepoPatchExpectedResourceUri(options);
  const sourceScope = repoPatchSourceScope(options);
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
    expectedCommitSha: sourceScope.expected_commit_sha || options.expectedCommitSha || "",
  });
  if (!resolved.ok) return resolved;

  const pool = options.pool || null;
  const principal = await loadPrincipalBinding(pool, resolved.envelope_id);
  if (principal?.principal_type === "service") {
    if (!principal.principal_id || principal.ledger_user_id !== principal.principal_id) {
      return envelopeScopeFailure("capability_resolution_envelope_service_principal_binding_mismatch", resolved.envelope_id);
    }
    if (compact(options.expectedUserId, 64) && compact(options.expectedUserId, 64) !== principal.principal_id) {
      return envelopeScopeFailure("capability_resolution_envelope_user_mismatch", resolved.envelope_id);
    }

    if (isRepoPatchEnvelopeRequest(options) && principal.exact_platform_authority_scope_matched) {
      if (!principal.resource_branch || !sourceScope.branch) {
        return envelopeScopeFailure("capability_resolution_envelope_resource_branch_target_unresolved", resolved.envelope_id, {
          envelope_resource_branch: principal.resource_branch || null,
          expected_resource_branch: sourceScope.branch || null,
        });
      }
      if (principal.resource_branch !== sourceScope.branch) {
        return envelopeScopeFailure("capability_resolution_envelope_resource_branch_mismatch", resolved.envelope_id, {
          envelope_resource_branch: principal.resource_branch,
          expected_resource_branch: sourceScope.branch,
        });
      }
      if (!principal.expected_commit_sha || !sourceScope.expected_commit_sha) {
        return envelopeScopeFailure("capability_resolution_envelope_commit_target_unresolved", resolved.envelope_id, {
          envelope_commit_sha: principal.expected_commit_sha || null,
          expected_commit_sha: sourceScope.expected_commit_sha || null,
        });
      }
      if (principal.expected_commit_sha !== sourceScope.expected_commit_sha) {
        return envelopeScopeFailure("capability_resolution_envelope_commit_mismatch", resolved.envelope_id, {
          envelope_commit_sha: principal.expected_commit_sha,
          expected_commit_sha: sourceScope.expected_commit_sha,
          commit_hint_required: true,
        });
      }
    }
  }

  return {
    ...resolved,
    principal_type: principal?.principal_type || null,
    principal_id: principal?.principal_id || resolved.user_id || null,
    resource_uri: expectedResourceUri || resolved.resource_uri || null,
    resource_branch: principal?.resource_branch || null,
    expected_commit_sha: principal?.expected_commit_sha || resolved.expected_commit_sha || null,
    secrets_included: false,
  };
}
