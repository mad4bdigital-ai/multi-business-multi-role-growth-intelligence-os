import { createHash } from "node:crypto";
import { getGitHubAppInstallationToken, resolveGitHubAppConfig } from "./githubAppAuth.js";

export const GITHUB_REPOSITORY_GOVERNANCE_ATTESTATION_VERSION = "github-repository-governance-attestation-v1";
export const GOVERNANCE_ATTESTATION_CONTEXTS = Object.freeze({
  main: Object.freeze({
    context: "Derived State Closure",
    confirm: "ATTEST_DERIVED_STATE_CLOSURE",
  }),
  Production: Object.freeze({
    context: "Governed Production Promotion",
    confirm: "ATTEST_GOVERNED_PRODUCTION_PROMOTION",
  }),
});

const SHA_RE = /^[0-9a-f]{40}$/i;
const DIGEST_RE = /^[0-9a-f]{64}$/i;
const SECRET_KEY_RE = /(?:^|_)(?:password|passwd|secret|token|api_key|private_key|authorization|credential)(?:$|_)/i;
const SECRET_VALUE_RE = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp_|github_pat_|ghs_)[A-Za-z0-9_.\-]+\b/,
];

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function attestationError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details ? sanitize(details) : null;
  return error;
}

function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (depth > 10) return "[max-depth]";
  if (typeof value === "string") {
    if (SECRET_VALUE_RE.some((pattern) => pattern.test(value))) return "[redacted]";
    return value.length > 4000 ? `${value.slice(0, 4000)}...[truncated]` : value;
  }
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => sanitize(entry, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SECRET_KEY_RE.test(key) ? "[redacted]" : sanitize(child, depth + 1, seen),
  ]));
}

function assertSecretFree(value, path = "input", depth = 0) {
  if (value === null || value === undefined || depth > 12) return;
  if (typeof value === "string") {
    if (SECRET_VALUE_RE.some((pattern) => pattern.test(value))) {
      throw attestationError(400, "github_governance_attestation_secret_value_rejected", `Secret-like value is not allowed at ${path}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) {
      throw attestationError(400, "github_governance_attestation_secret_field_rejected", `Secret-like field is not allowed at ${path}.${key}.`);
    }
    assertSecretFree(child, `${path}.${key}`, depth + 1);
  }
}

function assertAdmin(auth = {}) {
  const callerType = compact(auth.caller_type || auth.callerType || "", 64).toLowerCase();
  const role = compact(auth.role || auth.admin_role || "", 64).toLowerCase();
  if (callerType !== "admin" && !["admin", "platform_admin", "super_admin"].includes(role) && auth.is_admin !== true) {
    throw attestationError(403, "github_governance_attestation_admin_required", "Governance attestation requires an authenticated Admin caller.");
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stable(value[key]);
    return result;
  }, {});
}

export function governanceAttestationFingerprint(value = {}) {
  return createHash("sha256").update(JSON.stringify(stable(value ?? null)), "utf8").digest("hex");
}

async function githubRequest({ method = "GET", path, token, body, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-governance-attestor",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { ok: response.ok, status: Number(response.status), payload: sanitize(payload) };
}

function requireGithub(result, code, message) {
  if (!result.ok) {
    throw attestationError(result.status >= 400 && result.status < 500 ? result.status : 502, code, message, {
      upstream_status: result.status,
      github_error: result.payload,
      secrets_included: false,
    });
  }
  return result.payload;
}

function normalizeInput(input = {}) {
  const owner = compact(input.owner, 191);
  const repo = compact(input.repo, 191);
  const branch = compact(input.default_branch || input.branch || "main", 191) || "main";
  const policy = GOVERNANCE_ATTESTATION_CONTEXTS[branch];
  if (!owner || !repo) throw attestationError(400, "github_governance_attestation_repo_required", "owner and repo are required.");
  if (!policy) throw attestationError(400, "github_governance_attestation_branch_unregistered", "Attestation is restricted to Constitution-governed branches.");
  const prNumber = Number(input.pr_number || 0);
  const candidateSha = compact(input.candidate_sha || input.merge_candidate_sha, 40).toLowerCase();
  const sourceHeadSha = compact(input.source_head_sha, 40).toLowerCase();
  const baseSha = compact(input.base_sha, 40).toLowerCase();
  const executedSha = compact(input.executed_sha || candidateSha, 40).toLowerCase();
  const evidenceSha256 = compact(input.evidence_sha256, 64).toLowerCase();
  const sourceRunId = Number(input.source_run_id || 0);
  const confirm = compact(input.confirm, 128);
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw attestationError(400, "github_governance_attestation_pr_required", "pr_number must be a positive integer.");
  for (const [name, value] of Object.entries({ candidate_sha: candidateSha, source_head_sha: sourceHeadSha, base_sha: baseSha, executed_sha: executedSha })) {
    if (!SHA_RE.test(value)) throw attestationError(400, "github_governance_attestation_sha_invalid", `${name} must be a full commit SHA.`);
  }
  if (executedSha !== candidateSha) throw attestationError(409, "github_governance_attestation_executed_candidate_mismatch", "executed_sha must equal candidate_sha.");
  if (!DIGEST_RE.test(evidenceSha256)) throw attestationError(400, "github_governance_attestation_evidence_digest_invalid", "evidence_sha256 must be a 64-character SHA-256 digest.");
  if (!Number.isInteger(sourceRunId) || sourceRunId <= 0) throw attestationError(400, "github_governance_attestation_source_run_required", "source_run_id must be a positive integer.");
  if (confirm !== policy.confirm) throw attestationError(400, "github_governance_attestation_confirmation_invalid", `confirm must equal ${policy.confirm}.`);
  return { owner, repo, branch, policy, prNumber, candidateSha, sourceHeadSha, baseSha, executedSha, evidenceSha256, sourceRunId };
}

export async function runGithubRepositoryGovernanceAttestation(input = {}, deps = {}) {
  assertSecretFree(input);
  assertAdmin(deps.auth || {});
  const normalized = normalizeInput(input);
  const fetchImpl = deps.fetchImpl || fetch;
  const token = deps.token || await getGitHubAppInstallationToken({ action: input.action || {}, fetchImpl });
  const config = resolveGitHubAppConfig(input.action || {});
  const appId = /^\d+$/.test(String(config.appId || "")) ? Number(config.appId) : null;
  if (!appId) throw attestationError(409, "github_governance_attestation_app_identity_unresolved", "GitHub App identity must resolve before attestation.");

  const base = `/repos/${encodeURIComponent(normalized.owner)}/${encodeURIComponent(normalized.repo)}`;
  const pr = requireGithub(
    await githubRequest({ path: `${base}/pulls/${normalized.prNumber}`, token, fetchImpl }),
    "github_governance_attestation_pr_read_failed",
    "Unable to read the exact pull request before attestation."
  );
  if (String(pr?.state || "").toLowerCase() !== "open") throw attestationError(409, "github_governance_attestation_pr_not_open", "The attested pull request is no longer open.");
  if (String(pr?.base?.ref || "") !== normalized.branch) throw attestationError(409, "github_governance_attestation_base_branch_mismatch", "Pull request base branch differs from the governed target branch.");
  if (String(pr?.base?.sha || "").toLowerCase() !== normalized.baseSha) throw attestationError(409, "github_governance_attestation_base_sha_drift", "Pull request base SHA drifted after evidence production.");
  if (String(pr?.head?.sha || "").toLowerCase() !== normalized.sourceHeadSha) throw attestationError(409, "github_governance_attestation_head_sha_drift", "Pull request head SHA drifted after evidence production.");
  const headRepo = String(pr?.head?.repo?.full_name || "");
  if (headRepo && headRepo !== `${normalized.owner}/${normalized.repo}`) throw attestationError(409, "github_governance_attestation_fork_head_rejected", "Governance attestation rejects fork heads.");

  const refreshed = requireGithub(
    await githubRequest({ path: `${base}/pulls/${normalized.prNumber}`, token, fetchImpl }),
    "github_governance_attestation_pr_refresh_failed",
    "Unable to refresh pull request merge identity before attestation."
  );
  const observedCandidate = String(refreshed?.merge_commit_sha || "").toLowerCase();
  if (observedCandidate !== normalized.candidateSha) {
    throw attestationError(409, "github_governance_attestation_merge_candidate_drift", "Current GitHub merge candidate differs from the evidence-bound candidate.", {
      expected_candidate_sha: normalized.candidateSha,
      observed_candidate_sha: observedCandidate || null,
      secrets_included: false,
    });
  }

  const attestationFingerprint = governanceAttestationFingerprint({
    contract: GITHUB_REPOSITORY_GOVERNANCE_ATTESTATION_VERSION,
    app_id: appId,
    repository: `${normalized.owner}/${normalized.repo}`,
    branch: normalized.branch,
    context: normalized.policy.context,
    pr_number: normalized.prNumber,
    source_head_sha: normalized.sourceHeadSha,
    base_sha: normalized.baseSha,
    candidate_sha: normalized.candidateSha,
    executed_sha: normalized.executedSha,
    evidence_sha256: normalized.evidenceSha256,
    source_run_id: normalized.sourceRunId,
  });
  const description = `${normalized.branch} governance attested ${attestationFingerprint.slice(0, 12)}`.slice(0, 140);
  const created = requireGithub(
    await githubRequest({
      method: "POST",
      path: `${base}/statuses/${normalized.candidateSha}`,
      token,
      fetchImpl,
      body: {
        state: "success",
        context: normalized.policy.context,
        description,
      },
    }),
    "github_governance_attestation_status_create_failed",
    "GitHub App failed to publish the final governance status."
  );
  if (created?.state !== "success" || created?.context !== normalized.policy.context || String(created?.sha || normalized.candidateSha).toLowerCase() !== normalized.candidateSha) {
    throw attestationError(409, "github_governance_attestation_status_response_mismatch", "GitHub accepted a status response that does not match the attested candidate/context.");
  }

  const statuses = requireGithub(
    await githubRequest({ path: `${base}/commits/${normalized.candidateSha}/statuses?per_page=100`, token, fetchImpl }),
    "github_governance_attestation_status_readback_failed",
    "Unable to read back the final governance status."
  );
  const matching = (Array.isArray(statuses) ? statuses : []).filter((status) =>
    status?.context === normalized.policy.context
    && status?.state === "success"
    && String(status?.creator?.id || "") === String(created?.creator?.id || "")
  );
  if (!matching.length) throw attestationError(409, "github_governance_attestation_same_cycle_readback_failed", "Same-cycle readback did not prove the newly published final governance status.");

  return {
    contract: GITHUB_REPOSITORY_GOVERNANCE_ATTESTATION_VERSION,
    mode: "attest",
    repository: `${normalized.owner}/${normalized.repo}`,
    branch: normalized.branch,
    context: normalized.policy.context,
    pr_number: normalized.prNumber,
    source_head_sha: normalized.sourceHeadSha,
    base_sha: normalized.baseSha,
    candidate_sha: normalized.candidateSha,
    executed_sha: normalized.executedSha,
    evidence_sha256: normalized.evidenceSha256,
    source_run_id: normalized.sourceRunId,
    app_id: appId,
    attestation_fingerprint: attestationFingerprint,
    status_id: Number(created?.id || 0) || null,
    status_creator_id: Number(created?.creator?.id || 0) || null,
    same_cycle_readback_proven: true,
    mutation_executed: true,
    repository_content_mutation_executed: false,
    force_push_executed: false,
    secrets_included: false,
  };
}
