import { createHash } from "node:crypto";
import { getGitHubAppInstallationToken, resolveGitHubAppConfig } from "./githubAppAuth.js";

export const GITHUB_REPOSITORY_GOVERNANCE_ATTESTATION_VERSION = "github-repository-governance-attestation-v2";
export const GOVERNANCE_ATTESTATION_CONTEXTS = Object.freeze({
  main: Object.freeze({ context: "Derived State Closure", confirm: "ATTEST_DERIVED_STATE_CLOSURE", executed_relation: "executed_is_merge_candidate" }),
  Production: Object.freeze({ context: "Governed Production Promotion", confirm: "ATTEST_GOVERNED_PRODUCTION_PROMOTION", executed_relation: "executed_source_tree_equals_merge_candidate_tree" }),
});
const SHA_RE = /^[0-9a-f]{40}$/i;
const DIGEST_RE = /^[0-9a-f]{64}$/i;
const SECRET_KEY_RE = /(?:^|_)(?:password|passwd|secret|token|api_key|private_key|authorization|credential)(?:$|_)/i;
const SECRET_VALUE_RE = [/Bearer\s+[A-Za-z0-9._~+\-/]+=*/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/i, /\b(?:ghp_|github_pat_|ghs_)[A-Za-z0-9_.\-]+\b/];
function compact(value = "", max = 255) { return String(value ?? "").trim().slice(0, max); }
function error(status, code, message, details = null) { const e = new Error(message); e.status = status; e.code = code; e.details = details ? sanitize(details) : null; return e; }
function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (depth > 10) return "[max-depth]";
  if (typeof value === "string") return SECRET_VALUE_RE.some((p) => p.test(value)) ? "[redacted]" : value.slice(0, 4000);
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => sanitize(entry, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, SECRET_KEY_RE.test(key) ? "[redacted]" : sanitize(child, depth + 1, seen)]));
}
function assertSecretFree(value, path = "input", depth = 0) {
  if (value === null || value === undefined || depth > 12) return;
  if (typeof value === "string") { if (SECRET_VALUE_RE.some((p) => p.test(value))) throw error(400, "github_governance_attestation_secret_value_rejected", `Secret-like value is not allowed at ${path}.`); return; }
  if (Array.isArray(value)) { value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1)); return; }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) { if (SECRET_KEY_RE.test(key)) throw error(400, "github_governance_attestation_secret_field_rejected", `Secret-like field is not allowed at ${path}.${key}.`); assertSecretFree(child, `${path}.${key}`, depth + 1); }
}
function assertAdmin(auth = {}) {
  const caller = compact(auth.caller_type || auth.callerType, 64).toLowerCase();
  const role = compact(auth.role || auth.admin_role, 64).toLowerCase();
  if (caller !== "admin" && !["admin", "platform_admin", "super_admin"].includes(role) && auth.is_admin !== true) throw error(403, "github_governance_attestation_admin_required", "Governance attestation requires an authenticated Admin caller.");
}
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (!value || typeof value !== "object") return value; return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {}); }
export function governanceAttestationFingerprint(value = {}) { return createHash("sha256").update(JSON.stringify(stable(value ?? null)), "utf8").digest("hex"); }
async function request({ method = "GET", path, token, body, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com${path}`, { method, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "mad4b-governance-attestor", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { ok: response.ok, status: Number(response.status), payload: sanitize(payload) };
}
function requireResult(result, code, message) { if (!result.ok) throw error(result.status >= 400 && result.status < 500 ? result.status : 502, code, message, { upstream_status: result.status, github_error: result.payload, secrets_included: false }); return result.payload; }
function normalize(input = {}) {
  const owner = compact(input.owner, 191), repo = compact(input.repo, 191), branch = compact(input.default_branch || input.branch || "main", 191) || "main";
  const policy = GOVERNANCE_ATTESTATION_CONTEXTS[branch];
  if (!owner || !repo) throw error(400, "github_governance_attestation_repo_required", "owner and repo are required.");
  if (!policy) throw error(400, "github_governance_attestation_branch_unregistered", "Attestation is restricted to Constitution-governed branches.");
  const prNumber = Number(input.pr_number || 0), sourceHeadSha = compact(input.source_head_sha, 40).toLowerCase(), baseSha = compact(input.base_sha, 40).toLowerCase(), candidateSha = compact(input.candidate_sha || input.merge_candidate_sha, 40).toLowerCase(), executedSha = compact(input.executed_sha || candidateSha, 40).toLowerCase(), evidenceSha256 = compact(input.evidence_sha256, 64).toLowerCase(), sourceRunId = Number(input.source_run_id || 0);
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw error(400, "github_governance_attestation_pr_required", "pr_number must be positive.");
  for (const [name, value] of Object.entries({ source_head_sha: sourceHeadSha, base_sha: baseSha, candidate_sha: candidateSha, executed_sha: executedSha })) if (!SHA_RE.test(value)) throw error(400, "github_governance_attestation_sha_invalid", `${name} must be a full SHA.`);
  if (!DIGEST_RE.test(evidenceSha256)) throw error(400, "github_governance_attestation_evidence_digest_invalid", "evidence_sha256 must be SHA-256.");
  if (!Number.isInteger(sourceRunId) || sourceRunId <= 0) throw error(400, "github_governance_attestation_source_run_required", "source_run_id must be positive.");
  if (compact(input.confirm, 128) !== policy.confirm) throw error(400, "github_governance_attestation_confirmation_invalid", `confirm must equal ${policy.confirm}.`);
  if (branch === "main" && executedSha !== candidateSha) throw error(409, "github_governance_attestation_executed_candidate_mismatch", "main evidence must execute the exact merge candidate.");
  if (branch === "Production" && executedSha !== sourceHeadSha) throw error(409, "github_governance_attestation_executed_source_mismatch", "Production evidence must execute the certified release-candidate head.");
  return { owner, repo, branch, policy, prNumber, sourceHeadSha, baseSha, candidateSha, executedSha, evidenceSha256, sourceRunId };
}
export async function runGithubRepositoryGovernanceAttestation(input = {}, deps = {}) {
  assertSecretFree(input); assertAdmin(deps.auth || {});
  const n = normalize(input), fetchImpl = deps.fetchImpl || fetch, token = deps.token || await getGitHubAppInstallationToken({ action: input.action || {}, fetchImpl });
  const app = resolveGitHubAppConfig(input.action || {}), appId = /^\d+$/.test(String(app.appId || "")) ? Number(app.appId) : null;
  if (!appId) throw error(409, "github_governance_attestation_app_identity_unresolved", "GitHub App identity must resolve.");
  const base = `/repos/${encodeURIComponent(n.owner)}/${encodeURIComponent(n.repo)}`;
  const pr = requireResult(await request({ path: `${base}/pulls/${n.prNumber}`, token, fetchImpl }), "github_governance_attestation_pr_read_failed", "Unable to read pull request.");
  if (pr?.state !== "open") throw error(409, "github_governance_attestation_pr_not_open", "Pull request is not open.");
  if (pr?.base?.ref !== n.branch || String(pr?.base?.sha || "").toLowerCase() !== n.baseSha) throw error(409, "github_governance_attestation_base_sha_drift", "Target branch/base SHA drifted after evidence production.");
  if (String(pr?.head?.sha || "").toLowerCase() !== n.sourceHeadSha) throw error(409, "github_governance_attestation_head_sha_drift", "Source head drifted after evidence production.");
  if (pr?.head?.repo?.full_name && pr.head.repo.full_name !== `${n.owner}/${n.repo}`) throw error(409, "github_governance_attestation_fork_head_rejected", "Fork heads are rejected.");
  const refreshed = requireResult(await request({ path: `${base}/pulls/${n.prNumber}`, token, fetchImpl }), "github_governance_attestation_pr_refresh_failed", "Unable to refresh merge candidate.");
  if (String(refreshed?.merge_commit_sha || "").toLowerCase() !== n.candidateSha) throw error(409, "github_governance_attestation_merge_candidate_drift", "Current merge candidate differs from evidence-bound candidate.");
  let relation = "executed_is_merge_candidate";
  let candidateTreeSha = null, executedTreeSha = null;
  if (n.branch === "Production") {
    const [candidateCommit, executedCommit] = await Promise.all([
      request({ path: `${base}/git/commits/${n.candidateSha}`, token, fetchImpl }),
      request({ path: `${base}/git/commits/${n.executedSha}`, token, fetchImpl }),
    ]);
    const candidatePayload = requireResult(candidateCommit, "github_governance_attestation_candidate_commit_read_failed", "Unable to read Production merge candidate commit.");
    const executedPayload = requireResult(executedCommit, "github_governance_attestation_executed_commit_read_failed", "Unable to read certified release candidate commit.");
    candidateTreeSha = String(candidatePayload?.tree?.sha || "").toLowerCase();
    executedTreeSha = String(executedPayload?.tree?.sha || "").toLowerCase();
    if (!SHA_RE.test(candidateTreeSha) || candidateTreeSha !== executedTreeSha) throw error(409, "github_governance_attestation_candidate_tree_mismatch", "Production merge-candidate tree differs from the certified executed release-candidate tree.");
    relation = "executed_source_tree_equals_merge_candidate_tree";
  }
  const fingerprint = governanceAttestationFingerprint({ contract: GITHUB_REPOSITORY_GOVERNANCE_ATTESTATION_VERSION, app_id: appId, repository: `${n.owner}/${n.repo}`, branch: n.branch, context: n.policy.context, pr_number: n.prNumber, source_head_sha: n.sourceHeadSha, base_sha: n.baseSha, candidate_sha: n.candidateSha, executed_sha: n.executedSha, executed_relation: relation, evidence_sha256: n.evidenceSha256, source_run_id: n.sourceRunId });
  const created = requireResult(await request({ method: "POST", path: `${base}/statuses/${n.candidateSha}`, token, fetchImpl, body: { state: "success", context: n.policy.context, description: `${n.branch} governance attested ${fingerprint.slice(0, 12)}`.slice(0, 140) } }), "github_governance_attestation_status_create_failed", "Unable to publish final governance status.");
  if (created?.state !== "success" || created?.context !== n.policy.context) throw error(409, "github_governance_attestation_status_response_mismatch", "Published status does not match context/state.");
  const statuses = requireResult(await request({ path: `${base}/commits/${n.candidateSha}/statuses?per_page=100`, token, fetchImpl }), "github_governance_attestation_status_readback_failed", "Unable to read back final status.");
  const matching = (Array.isArray(statuses) ? statuses : []).filter((status) => status?.context === n.policy.context && status?.state === "success" && String(status?.creator?.id || "") === String(created?.creator?.id || ""));
  if (!matching.length) throw error(409, "github_governance_attestation_same_cycle_readback_failed", "Same-cycle readback did not prove the published status.");
  return { contract: GITHUB_REPOSITORY_GOVERNANCE_ATTESTATION_VERSION, mode: "attest", repository: `${n.owner}/${n.repo}`, branch: n.branch, context: n.policy.context, pr_number: n.prNumber, source_head_sha: n.sourceHeadSha, base_sha: n.baseSha, candidate_sha: n.candidateSha, executed_sha: n.executedSha, executed_relation: relation, candidate_tree_sha: candidateTreeSha, executed_tree_sha: executedTreeSha, evidence_sha256: n.evidenceSha256, source_run_id: n.sourceRunId, app_id: appId, attestation_fingerprint: fingerprint, status_id: Number(created?.id || 0) || null, status_creator_id: Number(created?.creator?.id || 0) || null, same_cycle_readback_proven: true, mutation_executed: true, repository_content_mutation_executed: false, force_push_executed: false, secrets_included: false };
}
