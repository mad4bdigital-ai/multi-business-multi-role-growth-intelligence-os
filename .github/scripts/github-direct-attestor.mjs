#!/usr/bin/env node
// MAD4B GitHub Direct Attestor. Protected GitHub Actions entrypoint, no Backend dependency.
import { readFileSync, appendFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { resolve } from "node:path";

const SHA = /^[a-f0-9]{40}$/;
const CONTEXT = "Derived State Closure";
const WORKFLOW = ".github/workflows/derived-state-closure.yml";
const CHECKS = ["Syntax Check", "Unit & Integration Tests", "Policy Objection Gate", "Single Owner Review Gate"];

function requireValid(value, reason) {
  if (!value) throw new Error("DIRECT_ATTESTOR_BLOCKED:" + reason);
}
function digits(value) { return /^[1-9]\d*$/.test(String(value || "")); }
function getJson(dir, file) {
  return JSON.parse(readFileSync(resolve(dir, file), "utf8"));
}
export function validateEvidence(e, x) {
  requireValid(e.identity?.pr_number === x.pr, "evidence_pr_mismatch");
  for (const [field, expected] of Object.entries({
    source_head_sha: x.head, base_sha: x.base, merge_candidate_sha: x.candidate,
    executed_sha: x.candidate, source_run_id: x.run
  })) requireValid(String(e.identity?.[field]) === String(expected), "evidence_" + field + "_mismatch");
  // The real derived-state report stores immutable SHA bindings inside candidate.
  requireValid(e.report?.contract === "mad4b.repository-derived-state-closure.v2" &&
    e.report?.candidate?.sha === x.candidate &&
    e.report?.candidate?.source_head_sha === x.head &&
    e.report?.candidate?.base_sha === x.base &&
    e.report?.candidate?.pr_number === x.pr &&
    e.report?.converged === true &&
    e.report?.blocking_stale_or_failed_artifact_count === 0, "derived_state_not_converged");
  requireValid(e.finalizer?.contract === "mad4b.repository-governance-evidence-finalizer.v2" &&
    e.finalizer?.merge_candidate_sha === x.candidate &&
    e.finalizer?.source_head_sha === x.head &&
    e.finalizer?.base_sha === x.base &&
    e.finalizer?.executed_sha === x.candidate &&
    e.finalizer?.pr_number === x.pr &&
    e.finalizer?.required_count > 0 &&
    e.finalizer?.failed_or_missing_required_count === 0 &&
    e.finalizer?.converged === true &&
    Array.isArray(e.finalizer?.failed_or_missing_required_ids) &&
    e.finalizer.failed_or_missing_required_ids.length === 0, "producer_evidence_not_converged");
  requireValid(e.objections?.contract === "mad4b.repository-policy-objections.v1" &&
    e.objections?.candidate_sha === x.candidate && e.objections?.source_head_sha === x.head &&
    e.objections?.blocking_count === 0 && e.objections?.manual_count === 0 &&
    e.objections?.activation_count === 0 &&
    e.objections?.merge_allowed_by_source_policy === true &&
    e.objections?.automerge_allowed === false, "policy_objection_unresolved");
  requireValid(e.owner?.ok === true && e.owner?.exact_head_sha === x.head &&
    e.owner?.pr_number === x.pr &&
    ["single_owner_attestation", "independent_approval"].includes(e.owner?.mode), "manual_authorization_missing");
  requireValid(e.environment?.converged === true && e.environment?.issue_count === 0 &&
    e.environment?.expected_head_sha === x.head && e.environment?.base_sha === x.base, "environment_impact_unresolved");
  return true;
}
export function validateReview(reviews, ownerLogin, authorLogin, head) {
  requireValid(ownerLogin === authorLogin, "single_owner_author_eligibility_missing");
  const body = "OWNER_ATTEST_SINGLE_OWNER\nexact_head_sha: " + head;
  requireValid(reviews.some(v => v.state === "COMMENTED" &&
    v.commit_id === head && v.user?.login === ownerLogin &&
    String(v.body || "").trim() === body), "exact_head_owner_review_missing");
  return true;
}
export function validateChecks(runs) {
  for (const checkName of CHECKS) {
    requireValid(runs.some(v => v.name === checkName && v.status === "completed" &&
      v.conclusion === "success" && v.app?.slug === "github-actions"), "required_check_not_successful:" + checkName);
  }
  return true;
}
export function validateCandidate(statuses, checkRuns, headStatuses) {
  requireValid(Array.isArray(statuses) && statuses.length === 0, "merge_candidate_status_conflict");
  requireValid(checkRuns?.total_count === 0, "merge_candidate_check_run_conflict");
  requireValid(Array.isArray(headStatuses) &&
    headStatuses.every(s => s.context !== CONTEXT), "existing_head_attestation_conflict");
  return true;
}
export function statusTarget(branch, head, candidate) {
  requireValid(SHA.test(head) && SHA.test(candidate), "invalid_sha");
  return branch === "main" ? head : candidate;
}
function encode(v) { return Buffer.from(v).toString("base64url"); }
function pem(v) { return String(v || "").replace(/\\n/g, "\n").trim(); }
function githubAppJwt(id, key) {
  requireValid(digits(id) && pem(key).includes("PRIVATE KEY-----"), "github_app_credentials_missing");
  const now = Math.floor(Date.now() / 1000);
  const data = encode(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: id }));
  return data + "." + createSign("RSA-SHA256").update(data).sign(pem(key)).toString("base64url");
}
async function api(token, path, method = "GET", body) {
  const response = await fetch("https://api.github.com" + path, {
    method, signal: AbortSignal.timeout(30000),
    headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "mad4b-github-direct-attestor",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  // Fail without emitting raw upstream responses, which may contain sensitive detail.
  if (!response.ok) throw new Error("DIRECT_ATTESTOR_BLOCKED:github_api_" + response.status + ":" + method + ":" + path.split("?")[0]);
  return response.status === 204 ? null : response.json();
}
function ensurePr(pr, x, repo) {
  requireValid(pr?.state === "open" && pr?.draft === false &&
    pr?.base?.ref === "main" && pr?.base?.sha === x.base &&
    pr?.head?.sha === x.head && pr?.head?.ref !== "main" && pr?.head?.ref !== "Production" &&
    pr?.head?.repo?.full_name === repo &&
    pr?.merge_commit_sha === x.candidate, "pr_identity_drift");
}
function readEvidence(dir) {
  return {
    identity: getJson(dir, "detector-identity.json"),
    report: getJson(dir, "report.json"),
    finalizer: getJson(dir, "evidence-finalizer.json"),
    objections: getJson(dir, "policy-objections.json"),
    owner: getJson(dir, "manual-authorization.json"),
    environment: getJson(dir, "environment-impact.json")
  };
}
async function installToken(repo, appId, key) {
  const jwt = githubAppJwt(appId, key);
  const installation = await api(jwt, "/repos/" + repo + "/installation");
  requireValid(digits(installation?.id) && String(installation?.app_id) === String(appId),
    "github_app_installation_identity_invalid");
  const token = await api(jwt, "/app/installations/" + installation.id + "/access_tokens", "POST", {});
  requireValid(typeof token?.token === "string" && token.token.length > 10, "installation_token_missing");
  return token.token;
}
async function currentSnapshot(token, repo, x) {
  const pr = await api(token, "/repos/" + repo + "/pulls/" + x.pr);
  ensurePr(pr, x, repo);
  const [headCommit, candidateCommit] = await Promise.all([
    api(token, "/repos/" + repo + "/git/commits/" + x.head),
    api(token, "/repos/" + repo + "/git/commits/" + x.candidate)
  ]);
  requireValid(SHA.test(headCommit?.tree?.sha || "") &&
    headCommit?.tree?.sha === candidateCommit?.tree?.sha, "candidate_tree_differs_from_head");
  return pr;
}
function writeOutput(result) {
  const keys = ["pr_number", "source_head_sha", "base_sha", "candidate_sha",
    "attestor_app_id", "status_creator_id", "attestor_status_id"];
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    keys.map(k => k + "=" + result[k]).join("\n") + "\n");
}
async function execute() {
  const argv = new Map(process.argv.slice(2).map(s => s.split("=", 2)));
  const repo = String(process.env.GITHUB_REPOSITORY || "");
  const parts = repo.split("/");
  requireValid(parts.length === 2 && parts.every(Boolean), "invalid_repository");
  requireValid(process.env.GITHUB_REF === "refs/heads/main" &&
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch", "untrusted_entrypoint");
  requireValid(process.env.GITHUB_ACTOR === parts[0], "dispatch_actor_not_owner");
  const pr = Number(argv.get("--pr"));
  const run = Number(argv.get("--run"));
  const head = String(argv.get("--head") || "");
  const candidate = String(argv.get("--candidate") || "");
  const base = String(argv.get("--base") || "");
  const mode = String(argv.get("--mode") || "plan");
  const evidenceDir = String(argv.get("--evidence-dir") || "");
  requireValid(Number.isSafeInteger(pr) && pr > 0 && Number.isSafeInteger(run) && run > 0,
    "invalid_pr_or_source_run");
  requireValid([head, base, candidate].every(s => SHA.test(s)), "invalid_commit_binding");
  requireValid(["plan", "attest"].includes(mode), "invalid_mode");
  requireValid(evidenceDir, "evidence_missing");
  const x = { pr, run, head, base, candidate };
  const e = readEvidence(evidenceDir);
  validateEvidence(e, x);
  // GITHUB_TOKEN is permitted for read-only plan. It is NEVER used to publish a status.
  const readToken = String(process.env.GITHUB_TOKEN || "");
  requireValid(readToken, "read_token_missing");
  const prLive = await currentSnapshot(readToken, repo, x);
  const source = await api(readToken, "/repos/" + repo + "/actions/runs/" + run);
  requireValid(source?.status === "completed" && source?.conclusion === "success" &&
    source?.path === WORKFLOW && ["pull_request", "workflow_dispatch"].includes(source?.event),
    "source_run_not_trusted");
  requireValid(source?.event !== "workflow_dispatch" || source?.head_sha === base,
    "dispatch_source_main_sha_mismatch");
  const artifacts = await api(readToken, "/repos/" + repo + "/actions/runs/" + run + "/artifacts?per_page=100");
  requireValid(artifacts?.artifacts?.filter(a => a.name === "derived-state-closure-" + run &&
    !a.expired).length === 1, "source_artifact_not_unique");
  const reviews = await api(readToken, "/repos/" + repo + "/pulls/" + pr + "/reviews?per_page=100");
  validateReview(reviews, parts[0], prLive?.user?.login, head);
  const checks = await api(readToken, "/repos/" + repo + "/commits/" + head + "/check-runs?per_page=100");
  validateChecks(checks?.check_runs || []);
  const [statuses, candChecks, headStatuses] = await Promise.all([
    api(readToken, "/repos/" + repo + "/commits/" + candidate + "/statuses?per_page=100"),
    api(readToken, "/repos/" + repo + "/commits/" + candidate + "/check-runs?per_page=100"),
    api(readToken, "/repos/" + repo + "/commits/" + head + "/statuses?per_page=100")
  ]);
  validateCandidate(statuses, candChecks, headStatuses);
  requireValid(statusTarget("main", head, candidate) === head, "target_not_head");
  if (mode === "plan") {
    console.log(JSON.stringify({ outcome: "plan_pass", pr, head, candidate,
      source_run_id: run, no_mutation: true, backend_required: false }));
    return;
  }
  requireValid(process.env.DIRECT_ATTESTOR_ENABLED === "enabled", "direct_mode_not_enabled");
  const appId = String(process.env.DIRECT_GITHUB_APP_ID || "");
  const key = String(process.env.DIRECT_GITHUB_APP_PRIVATE_KEY || "");
  const appToken = await installToken(repo, appId, key);
  // Independently re-evaluate all mutable identities using the signing App identity.
  await currentSnapshot(appToken, repo, x);
  const [candidateAgain, candidateChecksAgain, headStatusesAgain] = await Promise.all([
    api(appToken, "/repos/" + repo + "/commits/" + candidate + "/statuses?per_page=100"),
    api(appToken, "/repos/" + repo + "/commits/" + candidate + "/check-runs?per_page=100"),
    api(appToken, "/repos/" + repo + "/commits/" + head + "/statuses?per_page=100")
  ]);
  validateCandidate(candidateAgain, candidateChecksAgain, headStatusesAgain);
  const created = await api(appToken, "/repos/" + repo + "/statuses/" + head, "POST", {
    state: "success", context: CONTEXT,
    description: ("GitHub Direct trusted exact-head run " + run).slice(0, 140)
  });
  requireValid(created?.sha === head && created?.state === "success" &&
    created?.context === CONTEXT && digits(created?.id) && digits(created?.creator?.id),
    "created_status_identity_invalid");
  const published = await api(appToken, "/repos/" + repo + "/commits/" + head + "/statuses?per_page=100");
  const newest = published.find(s => s.context === CONTEXT);
  requireValid(newest?.id === created.id && newest?.creator?.id === created.creator.id &&
    newest?.state === "success", "latest_status_same_cycle_mismatch");
  const result = { outcome: "attested", backend_required: false, pr_number: pr,
    source_head_sha: head, base_sha: base, candidate_sha: candidate,
    attestor_app_id: Number(appId), status_creator_id: Number(created.creator.id),
    attestor_status_id: Number(created.id) };
  writeOutput(result);
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === new URL("file://" + resolve(process.argv[1])).href) {
  execute().catch(e => { console.error(String(e?.message || e)); process.exitCode = 1; });
}
