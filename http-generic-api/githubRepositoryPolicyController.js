import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveActivationBootstrapConfig } from "./activationBootstrapConfig.js";
import { getGitHubAppInstallationToken, resolveGitHubAppConfig } from "./githubAppAuth.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";

export const GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION = "github-repository-policy-controller-v4";
export const GITHUB_REPOSITORY_POLICY_CONFIRMATION = "APPLY_GITHUB_MAIN_REVIEW_POLICY";
export const GITHUB_REPOSITORY_POLICY_RULESET_NAME = "MAD4B main review policy";
export const GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS = Object.freeze(["Derived State Closure"]);

const CONSTITUTION_URL = new URL("./config/repository-governance-constitution.json", import.meta.url);
const CONSTITUTION_CONTRACT = "mad4b.repository-governance-constitution.v1";
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const SHA_RE = /^[0-9a-f]{40}$/i;
const DIGEST_RE = /^[0-9a-f]{64}$/i;
const MODES = new Set(["readback", "plan", "apply"]);
const SECRET_KEY_RE = /(?:^|_)(?:password|passwd|secret|token|api_key|private_key|authorization|credential)(?:$|_)/i;
const SECRET_VALUE_RE = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp_|github_pat_|ghs_)[A-Za-z0-9_.\-]+\b/,
];

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}
function bool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = compact(value, 16).toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  return fallback;
}
function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => compact(value, 255)).filter(Boolean))];
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}
export function githubRepositoryPolicyFingerprint(value = {}) {
  return createHash("sha256").update(JSON.stringify(stable(value ?? null)), "utf8").digest("hex");
}
function policyError(status, code, message, details = null) {
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
    if (SECRET_VALUE_RE.some((pattern) => pattern.test(value))) throw policyError(400, "github_repository_policy_secret_value_rejected", `Secret-like value is not allowed at ${path}.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) throw policyError(400, "github_repository_policy_secret_field_rejected", `Secret-like field is not allowed at ${path}.${key}.`);
    assertSecretFree(child, `${path}.${key}`, depth + 1);
  }
}

function constitution() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(CONSTITUTION_URL, "utf8"));
  } catch (error) {
    throw policyError(500, "github_repository_policy_constitution_unreadable", "Repository governance Constitution could not be loaded.", { error: error?.message || String(error), secrets_included: false });
  }
  if (
    parsed?.contract !== CONSTITUTION_CONTRACT
    || parsed?.authority?.source_of_truth !== "http-generic-api/config/repository-governance-constitution.json"
    || !parsed?.branches
  ) throw policyError(500, "github_repository_policy_constitution_invalid", "Repository governance Constitution is not canonical.");
  return parsed;
}
function branchPolicy(branch = "main") {
  const source = constitution();
  const name = compact(branch || "main", 191) || "main";
  const value = source.branches?.[name];
  if (!value) throw policyError(400, "github_repository_policy_branch_unregistered", "Target branch is not registered in the repository governance Constitution.", { requested_branch: name, registered_branches: Object.keys(source.branches || {}).sort(), secrets_included: false });
  if (value.ref !== `refs/heads/${name}`) throw policyError(500, "github_repository_policy_branch_contract_invalid", "Constitution branch ref does not match its registry key.");
  if (value.require_pull_request !== true || value.block_direct_push !== true || value.block_force_push !== true) throw policyError(500, "github_repository_policy_branch_contract_weakened", "Constitution branch policy is below the server-enforcement floor.");
  return {
    constitution_contract: source.contract,
    constitution_schema_version: source.schema_version,
    constitution_source: source.authority.source_of_truth,
    final_gate_context: source.authority.final_gate_context,
    final_attestor: source.authority.final_attestor,
    evidence_identity: source.authority.evidence_identity,
    branch: name,
    ref: value.ref,
    role: value.role || null,
    require_pull_request: true,
    block_direct_push: true,
    block_force_push: true,
    dismiss_stale_approvals: value.dismiss_stale_approvals !== false,
    require_conversation_resolution: value.require_conversation_resolution !== false,
    strict_required_status_checks: value.strict_required_status_checks !== false,
    required_checks: uniqueStrings(value.required_checks || []),
    required_check_producer: value.required_check_producer || null,
    required_check_evidence: value.required_check_evidence || null,
    required_check_activation: value.required_check_activation || null,
    generic_pull_request_merge_forbidden: value.generic_pull_request_merge_forbidden === true,
    promotion_path: value.promotion_path || null,
    same_sha_closure_required: value.same_sha_closure_required === true,
    secrets_included: false,
  };
}
function managedRulesetName(branch) {
  return branch === "main" ? GITHUB_REPOSITORY_POLICY_RULESET_NAME : `MAD4B ${branch} governance policy`;
}
export function githubRepositoryPolicyConfirmationForBranch(branch = "main") {
  return branch === "main" ? GITHUB_REPOSITORY_POLICY_CONFIRMATION : `APPLY_GITHUB_${String(branch).toUpperCase()}_POLICY`;
}
function normalizeChecks(input, policy) {
  const expected = [...policy.required_checks];
  if (input === undefined || input === null || input === "") return expected;
  if (!Array.isArray(input)) throw policyError(400, "github_repository_policy_required_checks_invalid", "required_checks must be an array.");
  const observed = uniqueStrings(input);
  const missing = expected.filter((entry) => !observed.includes(entry));
  const unexpected = observed.filter((entry) => !expected.includes(entry));
  if (missing.length || unexpected.length || observed.length !== expected.length) throw policyError(400, "github_repository_policy_required_checks_invalid", "required_checks must exactly match the Constitution branch policy.", { branch: policy.branch, expected, missing, unexpected, secrets_included: false });
  return expected;
}

export function buildGithubRepositoryPolicyCapabilityBinding({ target = {}, expected_main_sha = "", expected_commit_sha = "", expected_policy_fingerprint = "" } = {}) {
  const owner = compact(target.owner, 191);
  const repo = compact(target.repo, 191);
  const branch = compact(target.default_branch || target.branch || "main", 191) || "main";
  branchPolicy(branch);
  const commitSha = compact(expected_commit_sha || expected_main_sha, 40).toLowerCase();
  const fingerprint = compact(expected_policy_fingerprint, 64).toLowerCase();
  if (!owner || !repo || !SHA_RE.test(commitSha) || !DIGEST_RE.test(fingerprint)) return null;
  const resourceUri = `github://${owner}/${repo}/branch/${branch}`;
  const bindingSha256 = githubRepositoryPolicyFingerprint({
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    constitution_contract: CONSTITUTION_CONTRACT,
    capability_key: "repository_policy_controller",
    operation_intent: "github_repository_policy_apply",
    resource_uri: resourceUri,
    expected_commit_sha: commitSha,
    expected_policy_fingerprint: fingerprint,
  });
  return { resource_uri: resourceUri, expected_commit_sha: commitSha, expected_policy_fingerprint: fingerprint, binding_sha256: bindingSha256, capability_sha256: fingerprint, secrets_included: false };
}

async function resolveTarget(args = {}) {
  const config = args.owner && args.repo ? null : await resolveActivationBootstrapConfig({});
  const owner = compact(args.owner || config?.config?.github_owner, 191);
  const repo = compact(args.repo || config?.config?.github_repo, 191);
  const branch = compact(args.default_branch || args.branch || config?.config?.github_branch || "main", 191) || "main";
  if (!owner || !repo) throw policyError(400, "github_repository_policy_repo_required", "GitHub owner and repo are required.");
  return { owner, repo, default_branch: branch, branch_policy: branchPolicy(branch) };
}
async function resolveToken(args, deps) {
  return deps.token || getGitHubAppInstallationToken({ action: args.action || {}, fetchImpl: deps.fetchImpl || fetch });
}
async function request({ method = "GET", path, token, body, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-github-repository-policy-controller",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { ok: response.ok, status: Number(response.status), payload: sanitize(payload) };
}
function requireRequest(result, code) {
  if (!result.ok) throw policyError(result.status >= 400 && result.status < 500 ? result.status : 502, code, result.payload?.message || `GitHub request failed with HTTP ${result.status}.`, { status: result.status, github_error: result.payload, secrets_included: false });
  return result.payload;
}
async function readAllCollaborators({ owner, repo, token, fetchImpl }) {
  const output = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await request({ path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators?affiliation=all&per_page=100&page=${page}`, token, fetchImpl });
    if (!result.ok || !Array.isArray(result.payload)) return { ok: false, status: result.status, complete: false, payload: [] };
    output.push(...result.payload);
    if (result.payload.length < 100) return { ok: true, status: result.status, complete: true, payload: output };
  }
  return { ok: false, status: 409, complete: false, payload: [] };
}
async function collaboratorPermissions({ owner, repo, collaborators, token, fetchImpl }) {
  const output = [];
  for (const collaborator of collaborators || []) {
    const login = compact(collaborator?.login, 100);
    if (!login) continue;
    const result = await request({ path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(login)}/permission`, token, fetchImpl });
    output.push({ login, type: collaborator?.type || null, status: result.status, permission: result.ok ? compact(result.payload?.permission, 32) || null : null, role_name: result.ok ? compact(result.payload?.role_name, 64) || null : null, secrets_included: false });
  }
  return output;
}
function normalizeBypass(actor = {}) {
  return { actor_id: Number(actor.actor_id || 0) || null, actor_type: compact(actor.actor_type, 64) || null, bypass_mode: compact(actor.bypass_mode, 64) || null };
}
function writableRuleset(value = {}) {
  return {
    name: compact(value.name || GITHUB_REPOSITORY_POLICY_RULESET_NAME, 100),
    target: "branch",
    enforcement: "active",
    bypass_actors: (Array.isArray(value.bypass_actors) ? value.bypass_actors : []).map(normalizeBypass).filter((entry) => entry.actor_id && entry.actor_type),
    conditions: { ref_name: { include: uniqueStrings(value.conditions?.ref_name?.include || []), exclude: uniqueStrings(value.conditions?.ref_name?.exclude || []) } },
    rules: Array.isArray(value.rules) ? value.rules : [],
  };
}
function ruleParams(rules, type) {
  const rule = (rules || []).find((entry) => entry?.type === type);
  return rule?.parameters && typeof rule.parameters === "object" ? rule.parameters : {};
}
function statusBindings(rules) {
  return (ruleParams(rules, "required_status_checks").required_status_checks || []).map((entry) => ({ context: compact(entry?.context, 255), integration_id: Number(entry?.integration_id ?? entry?.app_id ?? 0) || null })).filter((entry) => entry.context);
}
function pullRequestEvidence(rules) {
  const p = ruleParams(rules, "pull_request");
  return {
    present: (rules || []).some((entry) => entry?.type === "pull_request"),
    required_approving_review_count: Number(p.required_approving_review_count || 0),
    dismiss_stale_reviews_on_push: bool(p.dismiss_stale_reviews_on_push),
    required_review_thread_resolution: bool(p.required_review_thread_resolution),
    require_last_push_approval: bool(p.require_last_push_approval),
  };
}
export function branchPatternMatches(pattern, branch) {
  const value = compact(pattern, 255);
  const ref = `refs/heads/${branch}`;
  if (["~ALL", branch, ref].includes(value)) return true;
  if (value === "~DEFAULT_BRANCH") return branch === "main";
  if (!value.includes("*") && !value.includes("?")) return false;
  let source = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "*") {
      if (value[i + 1] === "*") {
        if (value[i + 2] === "/") { source += "(?:.*/)?"; i += 2; }
        else { source += ".*"; i += 1; }
      } else source += "[^/]*";
    } else if (ch === "?") source += "[^/]";
    else source += ch.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  try { return new RegExp(`^${source}$`, "u").test(ref); } catch { return false; }
}
function appliesToBranch(detail, branch) {
  const include = uniqueStrings(detail.conditions?.ref_name?.include || []);
  const exclude = uniqueStrings(detail.conditions?.ref_name?.exclude || []);
  return include.some((pattern) => branchPatternMatches(pattern, branch)) && !exclude.some((pattern) => branchPatternMatches(pattern, branch));
}
function evaluateRuleset(detail, checks, appId, target) {
  const writable = writableRuleset(detail);
  const bindings = statusBindings(writable.rules);
  const contexts = uniqueStrings(bindings.map((entry) => entry.context)).sort();
  const missing = checks.filter((context) => !contexts.includes(context));
  const producerMismatches = checks.filter((context) => !bindings.some((entry) => entry.context === context && appId && entry.integration_id === appId));
  const sourceType = compact(detail.source_type, 64) || null;
  const source = compact(detail.source, 255) || null;
  const applies = appliesToBranch(detail, target.default_branch);
  return {
    id: Number(detail.id || 0) || null,
    name: compact(detail.name, 100) || null,
    enforcement: detail.enforcement || null,
    source_type: sourceType,
    source,
    repository_owned: sourceType === "Repository" && source === `${target.owner}/${target.repo}`,
    applies_to_target: applies,
    applies_to_main: applies,
    pull_request: pullRequestEvidence(writable.rules),
    required_status_checks: contexts,
    required_status_check_bindings: bindings,
    missing_required_checks: missing,
    required_check_producer_mismatches: producerMismatches,
    bypass_actors: writable.bypass_actors,
    policy_fingerprint: githubRepositoryPolicyFingerprint(writable),
    raw_writable_policy: writable,
    secrets_included: false,
  };
}
async function rulesetDetails({ owner, repo, index, token, fetchImpl }) {
  const output = [];
  for (const item of index || []) {
    const id = Number(item?.id || 0);
    if (!id) continue;
    const result = await request({ path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/rulesets/${id}`, token, fetchImpl });
    output.push({ id, status: result.status, detail: result.ok ? result.payload : null });
  }
  return output;
}
function desiredRuleset(checks, policy, appId, singleOwnerMode) {
  const rules = [{
    type: "pull_request",
    parameters: {
      allowed_merge_methods: ["merge", "squash", "rebase"],
      dismiss_stale_reviews_on_push: policy.dismiss_stale_approvals,
      require_code_owner_review: false,
      require_last_push_approval: !singleOwnerMode,
      required_approving_review_count: singleOwnerMode ? 0 : 1,
      required_review_thread_resolution: policy.require_conversation_resolution,
    },
  }];
  if (checks.length) rules.push({
    type: "required_status_checks",
    parameters: {
      do_not_enforce_on_create: false,
      required_status_checks: checks.map((context) => ({ context, integration_id: appId })),
      strict_required_status_checks_policy: policy.strict_required_status_checks,
    },
  });
  rules.push({ type: "non_fast_forward" });
  return writableRuleset({ name: managedRulesetName(policy.branch), bypass_actors: [], conditions: { ref_name: { include: [policy.ref], exclude: [] } }, rules });
}

export async function readGithubRepositoryPolicy(args = {}, deps = {}) {
  assertSecretFree(args);
  const target = await resolveTarget(args);
  const policy = target.branch_policy;
  const fetchImpl = deps.fetchImpl || fetch;
  const token = await resolveToken(args, deps);
  const base = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  const [repository, branch, activeRules, indexResult, classic, collaborators] = await Promise.all([
    request({ path: base, token, fetchImpl }),
    request({ path: `${base}/branches/${encodeURIComponent(target.default_branch)}`, token, fetchImpl }),
    request({ path: `${base}/rules/branches/${encodeURIComponent(target.default_branch)}`, token, fetchImpl }),
    request({ path: `${base}/rulesets?includes_parents=true&per_page=100`, token, fetchImpl }),
    request({ path: `${base}/branches/${encodeURIComponent(target.default_branch)}/protection`, token, fetchImpl }),
    readAllCollaborators({ owner: target.owner, repo: target.repo, token, fetchImpl }),
  ]);
  const indexReadable = indexResult.ok && Array.isArray(indexResult.payload);
  const index = indexReadable ? indexResult.payload : [];
  const details = indexReadable ? await rulesetDetails({ owner: target.owner, repo: target.repo, index, token, fetchImpl }) : [];
  const detailsReadable = indexReadable && details.length === index.length && details.every((entry) => entry.status === 200 && entry.detail);
  const collaboratorRows = collaborators.ok && collaborators.complete ? await collaboratorPermissions({ owner: target.owner, repo: target.repo, collaborators: collaborators.payload, token, fetchImpl }) : [];
  const collaboratorReadable = collaborators.ok && collaborators.complete && collaboratorRows.length === collaborators.payload.length && collaboratorRows.every((entry) => entry.status === 200 && (entry.permission || entry.role_name));
  const eligibleHumans = collaboratorReadable ? collaboratorRows.filter((entry) => entry.type === "User" && ["write", "maintain", "admin"].includes(compact(entry.permission || entry.role_name, 32).toLowerCase())) : [];
  const appConfig = resolveGitHubAppConfig(args.action || {});
  const appId = /^\d+$/.test(String(appConfig.appId || "")) ? Number(appConfig.appId) : null;
  const installationId = /^\d+$/.test(String(appConfig.installationId || "")) ? Number(appConfig.installationId) : null;
  const checks = normalizeChecks(args.required_checks, policy);
  const evaluated = details.filter((entry) => entry.status === 200 && entry.detail).map((entry) => evaluateRuleset(entry.detail, checks, appId, target));
  const activeTarget = evaluated.filter((entry) => entry.enforcement === "active" && entry.applies_to_target);
  const managedName = managedRulesetName(policy.branch);
  const managed = evaluated.filter((entry) => entry.name === managedName && entry.applies_to_target);
  const repositoryManaged = managed.filter((entry) => entry.repository_owned);
  const activeManaged = activeTarget.filter((entry) => entry.name === managedName && entry.repository_owned);
  const bypassActors = activeTarget.flatMap((entry) => entry.bypass_actors.map((actor) => ({ ...actor, ruleset_id: entry.id, ruleset_name: entry.name })));
  const classicValue = classic.ok ? classic.payload : null;
  const classicReviews = classicValue?.required_pull_request_reviews || null;
  const classicChecks = uniqueStrings((classicValue?.required_status_checks?.checks || []).map((entry) => entry?.context));
  const activeList = activeRules.ok && Array.isArray(activeRules.payload) ? activeRules.payload : [];
  const reviewCounts = [...activeTarget.map((entry) => entry.pull_request.required_approving_review_count), Number(classicReviews?.required_approving_review_count || 0)];
  const reviewCount = Math.max(0, ...reviewCounts);
  const observedChecks = uniqueStrings([...activeTarget.flatMap((entry) => entry.required_status_checks), ...classicChecks]).sort();
  const missingChecks = checks.filter((entry) => !observedChecks.includes(entry));
  const producerBound = checks.length === 0 || activeManaged.some((entry) => entry.missing_required_checks.length === 0 && entry.required_check_producer_mismatches.length === 0);
  const singleOwnerObserved = eligibleHumans.length === 1 && reviewCount === 0 && producerBound && activeManaged.some((entry) => entry.pull_request.present);
  const branchReadable = branch.ok && SHA_RE.test(String(branch.payload?.commit?.sha || "")) && typeof branch.payload?.protected === "boolean";
  const policyReadable = branchReadable && activeRules.ok && Array.isArray(activeRules.payload) && indexReadable && detailsReadable && (classic.status === 404 || classic.status === 200);
  const pullRequestRequired = activeTarget.some((entry) => entry.pull_request.present) || activeList.some((entry) => entry?.type === "pull_request");
  const nonFastForward = activeTarget.some((entry) => entry.raw_writable_policy.rules.some((rule) => rule?.type === "non_fast_forward"));
  const dismissStale = activeTarget.some((entry) => entry.pull_request.dismiss_stale_reviews_on_push) || bool(classicReviews?.dismiss_stale_reviews);
  const conversationResolution = activeTarget.some((entry) => entry.pull_request.required_review_thread_resolution) || bool(classicValue?.required_conversation_resolution?.enabled);
  const lastPush = activeTarget.some((entry) => entry.pull_request.require_last_push_approval) || bool(classicReviews?.require_last_push_approval) || singleOwnerObserved;
  const autoMergeDisabled = repository.ok && repository.payload?.allow_auto_merge === false;
  const mergeQueueDisabled = !activeList.some((entry) => entry?.type === "merge_queue");
  const trustedPromotionGate = policy.generic_pull_request_merge_forbidden
    ? policy.required_check_producer === "trusted_github_app_attestor"
      && policy.same_sha_closure_required
      && policy.promotion_path
      && checks.length === 1
      && checks[0] === policy.promotion_path
      && producerBound
      && appId !== null
    : true;
  const proof = {
    policy_state_readable: policyReadable,
    collaborator_ownership_complete: collaboratorReadable,
    ruleset_details_readable: detailsReadable,
    required_reviews_proven: reviewCount >= 1 || singleOwnerObserved,
    required_approving_review_count: reviewCount,
    dismiss_stale_reviews_proven: dismissStale,
    required_review_thread_resolution_proven: conversationResolution,
    require_last_push_approval_observed: lastPush,
    required_status_checks_proven: missingChecks.length === 0 && producerBound,
    required_status_check_producer_bound: producerBound,
    missing_required_status_checks: missingChecks,
    direct_push_block_proven: policyReadable && branch.payload.protected === true && pullRequestRequired && bypassActors.length === 0,
    force_push_block_proven: nonFastForward,
    finalizer_app_identity_resolved: appId !== null,
    finalizer_not_bypass_proven: appId !== null && detailsReadable && bypassActors.length === 0,
    merge_queue_disabled_or_equivalent: mergeQueueDisabled,
    auto_merge_disabled: autoMergeDisabled,
    generic_pull_request_merge_forbidden_proven: trustedPromotionGate,
  };
  proof.server_policy_gate_complete = Object.entries(proof).filter(([key]) => !["required_approving_review_count", "missing_required_status_checks"].includes(key)).every(([, value]) => value === true);
  const findingMap = {
    policy_state_readable: "policy_state_unreadable",
    collaborator_ownership_complete: "collaborator_ownership_incomplete",
    ruleset_details_readable: "ruleset_details_unreadable",
    required_reviews_proven: "required_review_missing",
    dismiss_stale_reviews_proven: "stale_review_dismissal_missing",
    required_review_thread_resolution_proven: "review_thread_resolution_missing",
    require_last_push_approval_observed: "latest_push_approval_missing",
    required_status_checks_proven: "required_status_checks_missing",
    required_status_check_producer_bound: "required_status_check_producer_unbound",
    direct_push_block_proven: "direct_push_block_unproven",
    force_push_block_proven: "force_push_block_unproven",
    finalizer_app_identity_resolved: "finalizer_app_identity_unresolved",
    finalizer_not_bypass_proven: "finalizer_bypass_posture_unproven",
    merge_queue_disabled_or_equivalent: "merge_queue_rule_observed",
    auto_merge_disabled: "repository_auto_merge_not_disabled",
    generic_pull_request_merge_forbidden_proven: "generic_pull_request_merge_forbidden_unproven",
  };
  const findings = Object.entries(findingMap).filter(([key]) => proof[key] !== true).map(([, finding]) => finding);
  const branchSha = branchReadable ? String(branch.payload.commit.sha).toLowerCase() : null;
  return {
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    mode: "readback",
    constitution: { contract: policy.constitution_contract, source: policy.constitution_source, branch_policy: policy, source_of_truth: true },
    target: { owner: target.owner, repo: target.repo, default_branch: target.default_branch },
    branch_sha: branchSha,
    main_sha: branchSha,
    api_status: { repository: repository.status, branch: branch.status, active_rules: activeRules.status, rulesets_index: indexResult.status, classic_branch_protection: classic.status, collaborators: collaborators.status, ruleset_details: details.map((entry) => ({ id: entry.id, status: entry.status })) },
    branch_protected: branchReadable ? branch.payload.protected : null,
    repository_auto_merge_allowed: repository.ok ? repository.payload?.allow_auto_merge ?? null : null,
    active_rule_count: activeList.length,
    ruleset_index_count: indexReadable ? index.length : null,
    ruleset_details: evaluated,
    managed_ruleset_name: managedName,
    managed_ruleset_count: managed.length,
    repository_managed_ruleset_count: repositoryManaged.length,
    active_managed_ruleset_count: activeManaged.length,
    bypass_actors: bypassActors,
    collaborators: collaboratorRows,
    direct_collaborators: collaboratorRows,
    eligible_human_collaborators: eligibleHumans,
    single_owner_mode_eligible: collaboratorReadable && eligibleHumans.length === 1,
    review_policy_mode: singleOwnerObserved ? "single_owner_attestation" : reviewCount >= 1 ? "independent_approval" : "incomplete",
    finalizer_identity: { app_id: appId, installation_id: installationId, resolved: appId !== null },
    required_checks: checks,
    observed_required_checks: observedChecks,
    proof,
    findings,
    mutation_executed: false,
    secrets_included: false,
  };
}

function assertSecureOverrides(args, singleOwnerMode) {
  const failures = [];
  if (args.required_approving_review_count !== undefined) {
    const count = Number(args.required_approving_review_count);
    if (singleOwnerMode ? count !== 0 : count < 1) failures.push("unsafe_review_count");
  }
  if (args.allow_direct_pushes !== undefined && bool(args.allow_direct_pushes)) failures.push("direct_pushes_must_be_blocked");
  if (args.bypass_actors !== undefined && (!Array.isArray(args.bypass_actors) || args.bypass_actors.length)) failures.push("bypass_actors_must_be_empty");
  if (args.auto_merge_enabled !== undefined && bool(args.auto_merge_enabled)) failures.push("auto_merge_must_be_disabled");
  if (args.merge_queue_enabled !== undefined && bool(args.merge_queue_enabled)) failures.push("merge_queue_must_be_disabled");
  if (failures.length) throw policyError(400, "github_repository_policy_unsafe_override_rejected", "Requested overrides weaken the Constitution-derived policy.", { failures, secrets_included: false });
}

export function buildGithubRepositoryPolicyPlan(args = {}, readback = null) {
  assertSecretFree(args);
  const target = readback?.target || { owner: compact(args.owner, 191), repo: compact(args.repo, 191), default_branch: compact(args.default_branch || args.branch || "main", 191) || "main" };
  const policy = readback?.constitution?.branch_policy || branchPolicy(target.default_branch);
  const checks = normalizeChecks(args.required_checks, policy);
  const appId = Number(readback?.finalizer_identity?.app_id || 0) || null;
  const eligible = readback?.proof?.collaborator_ownership_complete === true && (readback?.eligible_human_collaborators || []).length === 1;
  const singleOwnerMode = args.single_owner_mode === undefined ? eligible : bool(args.single_owner_mode) && eligible;
  if (bool(args.single_owner_mode) && !eligible) throw policyError(409, "github_repository_policy_single_owner_mode_ineligible", "single_owner_mode requires complete collaborator proof and exactly one eligible human.");
  assertSecureOverrides(args, singleOwnerMode);
  const desired = desiredRuleset(checks, policy, appId, singleOwnerMode);
  const managed = (readback?.ruleset_details || []).filter((entry) => entry.name === managedRulesetName(policy.branch) && entry.applies_to_target);
  const repoManaged = managed.filter((entry) => entry.repository_owned);
  const existing = managed.length === 1 && repoManaged.length === 1 ? repoManaged[0] : null;
  const blockers = [];
  if (!appId && checks.length) blockers.push("trusted_required_check_producer_unresolved");
  if (policy.generic_pull_request_merge_forbidden && !(policy.required_check_producer === "trusted_github_app_attestor" && policy.same_sha_closure_required && checks.length === 1 && checks[0] === policy.promotion_path)) blockers.push("promotion_gate_contract_incomplete");
  if (managed.length > 1 || (managed.length === 1 && repoManaged.length !== 1)) blockers.push("managed_ruleset_ambiguous_or_inherited");
  const currentSha = readback?.branch_sha || readback?.main_sha || compact(args.expected_commit_sha || args.expected_main_sha, 40).toLowerCase() || null;
  const fingerprint = githubRepositoryPolicyFingerprint({ controller_contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION, constitution_contract: policy.constitution_contract, branch_policy: policy, target, expected_commit_sha: currentSha, desired_ruleset: desired });
  return {
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    mode: "plan",
    constitution: { contract: policy.constitution_contract, source: policy.constitution_source, branch_policy: policy, source_of_truth: true },
    target,
    expected_commit_sha: currentSha,
    expected_main_sha: currentSha,
    desired_ruleset: desired,
    desired_ruleset_fingerprint: githubRepositoryPolicyFingerprint(desired),
    policy_fingerprint: fingerprint,
    required_checks: checks,
    required_check_producer_integration_id: appId,
    confirmation: githubRepositoryPolicyConfirmationForBranch(policy.branch),
    review_policy_mode: singleOwnerMode ? "single_owner_attestation" : "independent_approval",
    single_owner_mode: singleOwnerMode,
    capability_authorization: buildGithubRepositoryPolicyCapabilityBinding({ target, expected_commit_sha: currentSha, expected_policy_fingerprint: fingerprint }),
    activation_blockers: blockers,
    operation: blockers.length ? "blocked" : existing ? "update_ruleset" : "create_ruleset",
    existing_ruleset_id: existing?.id || null,
    preconditions: {
      policy_state_readable: readback?.proof?.policy_state_readable === true,
      finalizer_app_identity_resolved: readback?.proof?.finalizer_app_identity_resolved === true,
      no_target_bypass_actors: Array.isArray(readback?.bypass_actors) && readback.bypass_actors.length === 0,
      managed_ruleset_ambiguity_absent: managed.length <= 1,
      managed_ruleset_repository_owned: managed.length === 0 || (managed.length === 1 && repoManaged.length === 1),
      repository_auto_merge_disabled: readback?.proof?.auto_merge_disabled === true,
      merge_queue_disabled: readback?.proof?.merge_queue_disabled_or_equivalent === true,
      review_policy_mode_eligible: !singleOwnerMode || eligible,
      activation_blockers_absent: blockers.length === 0,
    },
    mutation_executed: false,
    force_push_allowed: false,
    repository_content_mutation_allowed: false,
    secrets_included: false,
  };
}

function assertAdmin(auth = {}) {
  const callerType = compact(auth.caller_type || auth.callerType, 64).toLowerCase();
  const role = compact(auth.role || auth.admin_role, 64).toLowerCase();
  if (callerType !== "admin" && !["admin", "platform_admin", "super_admin"].includes(role) && auth.is_admin !== true) throw policyError(403, "github_repository_policy_admin_required", "Policy apply requires an authenticated Admin caller.");
}
async function authorizeApply(args, deps, target) {
  const authorization = buildGithubRepositoryPolicyCapabilityBinding({ target, expected_commit_sha: args.expected_commit_sha || args.expected_main_sha, expected_policy_fingerprint: args.expected_policy_fingerprint || args.policy_fingerprint });
  if (!authorization) throw policyError(400, "github_repository_policy_capability_binding_invalid", "Policy apply requires exact repository, branch SHA, and policy fingerprint binding.");
  if (typeof deps.authorizeApply === "function") {
    const resolved = await deps.authorizeApply({ args, target, authorization, auth: deps.auth || {} });
    if (!resolved?.ok) throw policyError(403, "github_repository_policy_capability_envelope_invalid", "Policy apply requires a valid capability envelope.");
    if (resolved.apply_allowed !== true) throw capabilityEnvelopeError({ ok: false, status: "capability_resolution_envelope_apply_not_allowed", envelope_id: resolved.envelope_id || null, secrets_included: false }, "Policy apply requires an apply-authorized capability envelope.");
    return { ...resolved, authorization };
  }
  const pool = deps.pool || (typeof deps.resolveCapabilityExecutionEnvelope === "function" ? null : (await import("./db.js")).getPool());
  const acceptedIntents = ["github_repository_policy_apply", "repository_policy_controller", "github_main_review_policy"];
  const resolver = deps.resolveCapabilityExecutionEnvelope || resolveCapabilityExecutionEnvelope;
  const marker = deps.markCapabilityEnvelopeReferenced || markCapabilityEnvelopeReferenced;
  const resolved = await resolver({ pool, source: args, acceptedAppKeys: ["github"], acceptedIntents, acceptedCapabilityKeys: ["repository_policy_controller"], expectedTenantId: deps.auth?.tenant_id || PLATFORM_TENANT_ID, expectedUserId: deps.auth?.user_id || deps.auth?.admin_id || "", expectedResourceUri: authorization.resource_uri, expectedCommitSha: authorization.expected_commit_sha, requireCommitHint: true, expectedBindingSha256: authorization.binding_sha256, expectedCapabilitySha256: authorization.capability_sha256 });
  if (!resolved.ok) throw capabilityEnvelopeError(resolved, "Policy apply requires a valid capability envelope.");
  if (resolved.apply_allowed !== true) throw capabilityEnvelopeError({ ok: false, status: "capability_resolution_envelope_apply_not_allowed", envelope_id: resolved.envelope_id, secrets_included: false }, "Policy apply requires an apply-authorized capability envelope.");
  if (resolved.app_key !== "github" || resolved.capability_key !== "repository_policy_controller" || !acceptedIntents.includes(String(resolved.operation_intent || "").toLowerCase()) || resolved.resource_uri !== authorization.resource_uri || resolved.expected_commit_sha !== authorization.expected_commit_sha || resolved.binding_sha256 !== authorization.binding_sha256 || resolved.capability_sha256 !== authorization.capability_sha256) throw capabilityEnvelopeError({ ok: false, status: "capability_resolution_envelope_policy_binding_mismatch", envelope_id: resolved.envelope_id, secrets_included: false }, "Capability envelope does not match the exact Constitution-derived policy.");
  await marker({ pool, envelopeId: resolved.envelope_id, executionRef: `github_repository_policy_apply:${target.owner}/${target.repo}:${target.default_branch}:${authorization.expected_commit_sha}:${authorization.expected_policy_fingerprint}` });
  return { ...resolved, authorization };
}
async function rollback({ target, token, fetchImpl, createdId, previous }) {
  try {
    if (createdId) {
      const result = await request({ method: "DELETE", path: `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/rulesets/${createdId}`, token, fetchImpl });
      return { attempted: true, succeeded: result.ok, operation: "delete_created_ruleset", status: result.status, secrets_included: false };
    }
    if (previous?.id && previous.raw_writable_policy) {
      const result = await request({ method: "PUT", path: `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/rulesets/${previous.id}`, token, fetchImpl, body: previous.raw_writable_policy });
      return { attempted: true, succeeded: result.ok, operation: "restore_previous_ruleset", status: result.status, secrets_included: false };
    }
  } catch (error) {
    return { attempted: true, succeeded: false, error: error?.message || String(error), secrets_included: false };
  }
  return { attempted: false, succeeded: false, secrets_included: false };
}

export async function runGithubRepositoryPolicyController(args = {}, deps = {}) {
  assertSecretFree(args);
  const mode = compact(args.mode || "readback", 32).toLowerCase();
  if (!MODES.has(mode)) throw policyError(400, "github_repository_policy_mode_invalid", "mode must be readback, plan, or apply.");
  if (mode === "readback") return readGithubRepositoryPolicy(args, deps);
  if (mode === "apply") {
    assertAdmin(deps.auth || {});
    const expectedSha = compact(args.expected_commit_sha || args.expected_main_sha, 40).toLowerCase();
    const fingerprint = compact(args.expected_policy_fingerprint || args.policy_fingerprint, 64).toLowerCase();
    const branch = compact(args.default_branch || args.branch || "main", 191) || "main";
    if (!SHA_RE.test(expectedSha)) throw policyError(400, "github_repository_policy_expected_main_sha_required", "expected_commit_sha (or expected_main_sha) must be a full commit SHA.");
    if (!DIGEST_RE.test(fingerprint)) throw policyError(400, "github_repository_policy_fingerprint_required", "expected_policy_fingerprint must be a SHA-256 digest.");
    if (compact(args.confirm, 128) !== githubRepositoryPolicyConfirmationForBranch(branch)) throw policyError(400, "github_repository_policy_confirmation_invalid", `confirm must equal ${githubRepositoryPolicyConfirmationForBranch(branch)}.`);
    const target = await resolveTarget(args);
    await authorizeApply(args, deps, target);
  }
  const before = await readGithubRepositoryPolicy(args, deps);
  const plan = buildGithubRepositoryPolicyPlan(args, before);
  if (mode === "plan") return { ...plan, readback: before, secrets_included: false };
  const expectedSha = compact(args.expected_commit_sha || args.expected_main_sha, 40).toLowerCase();
  const expectedFingerprint = compact(args.expected_policy_fingerprint || args.policy_fingerprint, 64).toLowerCase();
  if (before.branch_sha !== expectedSha) throw policyError(409, "github_repository_policy_main_sha_drift", "Target branch SHA drifted after authorization.", { expected_commit_sha: expectedSha, observed_commit_sha: before.branch_sha, secrets_included: false });
  if (plan.policy_fingerprint !== expectedFingerprint) throw policyError(409, "github_repository_policy_fingerprint_mismatch", "Policy fingerprint drifted after authorization.");
  if (!before.proof.policy_state_readable) throw policyError(409, "github_repository_policy_state_unreadable", "Current policy state is unreadable.");
  if (!before.proof.finalizer_app_identity_resolved) throw policyError(409, "github_repository_policy_finalizer_identity_unresolved", "Trusted GitHub App identity is unresolved.");
  if (before.bypass_actors.length) throw policyError(409, "github_repository_policy_bypass_actor_present", "Existing target policy contains bypass actors.");
  if (!plan.preconditions.managed_ruleset_ambiguity_absent) throw policyError(409, "github_repository_policy_managed_ruleset_ambiguous", "Managed target Ruleset is ambiguous.");
  if (!plan.preconditions.managed_ruleset_repository_owned) throw policyError(409, "github_repository_policy_managed_ruleset_not_repository_owned", "Managed target Ruleset is inherited.");
  if (!before.proof.auto_merge_disabled || !before.proof.merge_queue_disabled_or_equivalent) throw policyError(409, "github_repository_policy_alternate_merge_path_blocked", "Auto-merge and merge queue must be disabled.");
  if (plan.operation === "blocked" || plan.activation_blockers.length) throw policyError(409, "github_repository_policy_activation_blocked", "Constitution-derived policy cannot be safely activated.", { activation_blockers: plan.activation_blockers, secrets_included: false });

  const fetchImpl = deps.fetchImpl || fetch;
  const token = await resolveToken(args, deps);
  const target = before.target;
  const previous = (before.ruleset_details || []).find((entry) => entry.name === before.managed_ruleset_name && entry.applies_to_target && entry.repository_owned) || null;
  const apiBase = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/rulesets`;
  let mutation;
  let createdId = null;
  if (previous?.id) {
    const payload = requireRequest(await request({ method: "PUT", path: `${apiBase}/${previous.id}`, token, fetchImpl, body: plan.desired_ruleset }), "github_repository_policy_ruleset_update_failed");
    mutation = { operation: "update_ruleset", ruleset_id: Number(payload?.id || previous.id), status: "accepted" };
  } else {
    const payload = requireRequest(await request({ method: "POST", path: apiBase, token, fetchImpl, body: plan.desired_ruleset }), "github_repository_policy_ruleset_create_failed");
    createdId = Number(payload?.id || 0) || null;
    mutation = { operation: "create_ruleset", ruleset_id: createdId, status: "accepted" };
  }
  const after = await readGithubRepositoryPolicy(args, { ...deps, token });
  const managed = (after.ruleset_details || []).filter((entry) => entry.name === after.managed_ruleset_name && entry.applies_to_target && entry.repository_owned);
  const postconditions = {
    branch_sha_unchanged: after.branch_sha === before.branch_sha,
    main_sha_unchanged: after.branch_sha === before.branch_sha,
    one_managed_ruleset: managed.length === 1,
    ruleset_fingerprint_matches: managed.length === 1 && managed[0].policy_fingerprint === plan.desired_ruleset_fingerprint,
    required_check_producer_bound: after.proof.required_status_check_producer_bound === true,
    generic_pull_request_merge_forbidden_proven: after.proof.generic_pull_request_merge_forbidden_proven === true,
    server_policy_gate_complete: after.proof.server_policy_gate_complete === true,
    no_bypass_actors: after.bypass_actors.length === 0,
    secrets_included: false,
  };
  const passed = Object.entries(postconditions).filter(([key]) => key !== "secrets_included").every(([, value]) => value === true);
  if (!passed) {
    const rollbackEvidence = await rollback({ target, token, fetchImpl, createdId, previous });
    throw policyError(409, "github_repository_policy_postcondition_failed", "Same-cycle readback did not prove the Constitution-derived policy.", { mutation, postconditions, rollback: rollbackEvidence, secrets_included: false });
  }
  return {
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    mode: "apply",
    constitution: plan.constitution,
    target,
    expected_commit_sha: before.branch_sha,
    expected_main_sha: before.branch_sha,
    policy_fingerprint: plan.policy_fingerprint,
    desired_ruleset_fingerprint: plan.desired_ruleset_fingerprint,
    mutation,
    postconditions,
    readback: after,
    mutation_executed: true,
    force_push_executed: false,
    repository_content_mutation_executed: false,
    secrets_included: false,
  };
}
