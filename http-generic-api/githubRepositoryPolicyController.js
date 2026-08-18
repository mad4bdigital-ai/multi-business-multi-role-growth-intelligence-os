import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveActivationBootstrapConfig } from "./activationBootstrapConfig.js";
import { getGitHubAppInstallationToken, resolveGitHubAppConfig } from "./githubAppAuth.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";

export const GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION = "github-repository-policy-controller-v3";
export const GITHUB_REPOSITORY_POLICY_CONFIRMATION = "APPLY_GITHUB_MAIN_REVIEW_POLICY";
export const GITHUB_REPOSITORY_POLICY_RULESET_NAME = "MAD4B main review policy";
// Compatibility export only. Runtime authority is repository-governance-constitution.json.
export const GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS = Object.freeze(["Derived State Closure"]);

const CONSTITUTION_URL = new URL("./config/repository-governance-constitution.json", import.meta.url);
const CONSTITUTION_CONTRACT = "mad4b.repository-governance-constitution.v1";
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;
const ALLOWED_MODES = new Set(["readback", "plan", "apply"]);
const SECRET_KEY_PATTERN = /(?:^|_)(?:password|passwd|secret|token|api_key|private_key|authorization|credential)(?:$|_)/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp_|github_pat_|ghs_)[A-Za-z0-9_.\-]+\b/,
];

function controllerError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details ? sanitizeEvidence(details) : null;
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stable(value[key]);
    return result;
  }, {});
}

function stableJson(value) {
  return JSON.stringify(stable(value ?? null));
}

export function githubRepositoryPolicyFingerprint(value = {}) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function bool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => compact(value, 255)).filter(Boolean))];
}

function readConstitution() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(CONSTITUTION_URL, "utf8"));
  } catch (error) {
    throw controllerError(500, "github_repository_policy_constitution_unreadable", "Repository governance Constitution could not be loaded.", {
      error: error?.message || String(error),
      secrets_included: false,
    });
  }
  if (
    parsed?.contract !== CONSTITUTION_CONTRACT
    || parsed?.authority?.source_of_truth !== "http-generic-api/config/repository-governance-constitution.json"
    || !parsed?.branches
    || typeof parsed.branches !== "object"
  ) {
    throw controllerError(500, "github_repository_policy_constitution_invalid", "Repository governance Constitution is not a valid canonical authority.");
  }
  return parsed;
}

function resolveBranchPolicy(branch = "main") {
  const constitution = readConstitution();
  const branchName = compact(branch || "main", 191) || "main";
  const policy = constitution.branches?.[branchName];
  if (!policy || typeof policy !== "object") {
    throw controllerError(400, "github_repository_policy_branch_unregistered", "Target branch is not registered in the repository governance Constitution.", {
      requested_branch: branchName,
      registered_branches: Object.keys(constitution.branches || {}).sort(),
      secrets_included: false,
    });
  }
  const expectedRef = `refs/heads/${branchName}`;
  if (compact(policy.ref || "", 255) !== expectedRef) {
    throw controllerError(500, "github_repository_policy_branch_contract_invalid", "Constitution branch ref does not match its registry key.", {
      branch: branchName,
      expected_ref: expectedRef,
      observed_ref: policy.ref || null,
      secrets_included: false,
    });
  }
  if (policy.require_pull_request !== true || policy.block_direct_push !== true || policy.block_force_push !== true) {
    throw controllerError(500, "github_repository_policy_branch_contract_weakened", "Constitution branch policy does not meet the minimum fail-closed server enforcement floor.", {
      branch: branchName,
      secrets_included: false,
    });
  }
  const requiredChecks = uniqueStrings(policy.required_checks || []);
  return {
    constitution_contract: constitution.contract,
    constitution_schema_version: constitution.schema_version,
    constitution_source: constitution.authority.source_of_truth,
    final_gate_context: compact(constitution.authority.final_gate_context || "", 255) || null,
    branch: branchName,
    ref: expectedRef,
    role: compact(policy.role || "", 128) || null,
    require_pull_request: true,
    block_direct_push: true,
    block_force_push: true,
    dismiss_stale_approvals: policy.dismiss_stale_approvals !== false,
    require_conversation_resolution: policy.require_conversation_resolution !== false,
    strict_required_status_checks: policy.strict_required_status_checks !== false,
    required_checks: requiredChecks,
    required_check_activation: compact(policy.required_check_activation || "", 255) || null,
    generic_pull_request_merge_forbidden: policy.generic_pull_request_merge_forbidden === true,
    promotion_path: compact(policy.promotion_path || "", 255) || null,
    same_sha_closure_required: policy.same_sha_closure_required === true,
    secrets_included: false,
  };
}

function managedRulesetName(branch = "main") {
  return branch === "main" ? GITHUB_REPOSITORY_POLICY_RULESET_NAME : `MAD4B ${branch} governance policy`;
}

function confirmationForBranch(branch = "main") {
  return branch === "main" ? GITHUB_REPOSITORY_POLICY_CONFIRMATION : `APPLY_GITHUB_${String(branch).toUpperCase()}_POLICY`;
}

function normalizeRequiredChecks(value, branchPolicy) {
  const expected = [...(branchPolicy?.required_checks || [])];
  if (value === undefined || value === null || value === "") return expected;
  if (!Array.isArray(value)) {
    throw controllerError(400, "github_repository_policy_required_checks_invalid", "required_checks must be an array.");
  }
  const checks = uniqueStrings(value);
  const missing = expected.filter((check) => !checks.includes(check));
  const unexpected = checks.filter((check) => !expected.includes(check));
  if (checks.length !== expected.length || missing.length || unexpected.length) {
    throw controllerError(
      400,
      "github_repository_policy_required_checks_invalid",
      "required_checks must exactly match the target branch policy in the repository governance Constitution.",
      { expected, missing, unexpected, branch: branchPolicy?.branch || null, secrets_included: false }
    );
  }
  return expected;
}

export function buildGithubRepositoryPolicyCapabilityBinding({
  target = {},
  expected_main_sha = "",
  expected_commit_sha = "",
  expected_policy_fingerprint = "",
} = {}) {
  const owner = compact(target.owner || "", 191);
  const repo = compact(target.repo || "", 191);
  const branch = compact(target.default_branch || target.branch || "main", 191) || "main";
  resolveBranchPolicy(branch);
  const expectedCommitSha = compact(expected_commit_sha || expected_main_sha, 40).toLowerCase();
  const expectedPolicyFingerprint = compact(expected_policy_fingerprint, 64).toLowerCase();
  if (!owner || !repo || !SHA_PATTERN.test(expectedCommitSha) || !FINGERPRINT_PATTERN.test(expectedPolicyFingerprint)) {
    return null;
  }
  const resourceUri = `github://${owner}/${repo}/branch/${branch}`;
  const bindingSha256 = githubRepositoryPolicyFingerprint({
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    constitution_contract: CONSTITUTION_CONTRACT,
    capability_key: "repository_policy_controller",
    operation_intent: "github_repository_policy_apply",
    resource_uri: resourceUri,
    expected_commit_sha: expectedCommitSha,
    expected_policy_fingerprint: expectedPolicyFingerprint,
  });
  return {
    resource_uri: resourceUri,
    expected_commit_sha: expectedCommitSha,
    expected_policy_fingerprint: expectedPolicyFingerprint,
    binding_sha256: bindingSha256,
    capability_sha256: expectedPolicyFingerprint,
    secrets_included: false,
  };
}

function assertSecretFree(value, path = "input", depth = 0) {
  if (value === null || value === undefined || depth > 12) return;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw controllerError(400, "github_repository_policy_secret_value_rejected", `Secret-like value is not allowed at ${path}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw controllerError(400, "github_repository_policy_secret_field_rejected", `Secret-like field is not allowed at ${path}.${key}.`);
    }
    assertSecretFree(child, `${path}.${key}`, depth + 1);
  }
}

function sanitizeEvidence(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (depth > 10) return "[max-depth]";
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return "[redacted]";
    return value.length > 4000 ? `${value.slice(0, 4000)}...[truncated]` : value;
  }
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeEvidence(item, depth + 1, seen));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeEvidence(child, depth + 1, seen);
  }
  return output;
}

function encode(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

function normalizeMode(value) {
  const mode = compact(value || "readback", 32).toLowerCase();
  if (!ALLOWED_MODES.has(mode)) {
    throw controllerError(400, "github_repository_policy_mode_invalid", "mode must be readback, plan, or apply.");
  }
  return mode;
}

function assertSecurePolicyOverrides(args = {}, { singleOwnerMode = false } = {}) {
  const failures = [];
  if (args.required_approving_review_count !== undefined) {
    const requested = Number(args.required_approving_review_count);
    if (singleOwnerMode ? requested !== 0 : requested < 1) {
      failures.push(singleOwnerMode ? "single_owner_review_count_must_be_zero" : "required_approving_review_count_below_one");
    }
  }
  if (args.dismiss_stale_reviews_on_push !== undefined && !bool(args.dismiss_stale_reviews_on_push)) failures.push("dismiss_stale_reviews_must_be_enabled");
  if (args.required_review_thread_resolution !== undefined && !bool(args.required_review_thread_resolution)) failures.push("review_thread_resolution_must_be_enabled");
  if (args.require_last_push_approval !== undefined) {
    const requested = bool(args.require_last_push_approval);
    if (singleOwnerMode ? requested : !requested) failures.push(singleOwnerMode ? "single_owner_last_push_native_approval_must_be_disabled" : "last_push_approval_must_be_enabled");
  }
  if (args.allow_direct_pushes !== undefined && bool(args.allow_direct_pushes)) failures.push("direct_pushes_must_be_blocked");
  if (args.bypass_actors !== undefined && (!Array.isArray(args.bypass_actors) || args.bypass_actors.length > 0)) failures.push("bypass_actors_must_be_empty");
  if (args.merge_queue_enabled !== undefined && bool(args.merge_queue_enabled)) failures.push("merge_queue_must_remain_disabled");
  if (args.auto_merge_enabled !== undefined && bool(args.auto_merge_enabled)) failures.push("auto_merge_must_remain_disabled");
  if (failures.length) {
    throw controllerError(400, "github_repository_policy_unsafe_override_rejected", "Requested policy overrides weaken the governed repository policy.", {
      failures,
      secrets_included: false,
    });
  }
}

async function resolveTarget(args = {}) {
  const config = args.owner && args.repo ? null : await resolveActivationBootstrapConfig({});
  const owner = compact(args.owner || config?.config?.github_owner || "", 191);
  const repo = compact(args.repo || config?.config?.github_repo || "", 191);
  const branch = compact(args.default_branch || args.branch || config?.config?.github_branch || "main", 191) || "main";
  if (!owner || !repo) {
    throw controllerError(400, "github_repository_policy_repo_required", "GitHub owner and repo are required.");
  }
  const branchPolicy = resolveBranchPolicy(branch);
  return { owner, repo, default_branch: branch, branch_policy: branchPolicy };
}

async function resolveToken(args, deps) {
  if (deps.token) return String(deps.token);
  return getGitHubAppInstallationToken({ action: args.action || {}, fetchImpl: deps.fetchImpl || fetch });
}

async function githubRequest({ method = "GET", apiPath, token, body, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-github-repository-policy-controller",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { ok: response.ok, status: Number(response.status), payload: sanitizeEvidence(payload) };
}

async function requireGithubRequest(options, errorCode) {
  const result = await githubRequest(options);
  if (!result.ok) {
    throw controllerError(result.status >= 400 && result.status < 500 ? result.status : 502, errorCode, result.payload?.message || `GitHub request failed with HTTP ${result.status}.`, {
      status: result.status,
      api_path: options.apiPath,
      github_error: result.payload,
      secrets_included: false,
    });
  }
  return result.payload;
}

function normalizeBypassActor(actor = {}) {
  return {
    actor_id: Number(actor.actor_id || 0) || null,
    actor_type: compact(actor.actor_type || "", 64) || null,
    bypass_mode: compact(actor.bypass_mode || "", 64) || null,
  };
}

function writableRulesetPayload(value = {}) {
  return {
    name: compact(value.name || GITHUB_REPOSITORY_POLICY_RULESET_NAME, 100),
    target: "branch",
    enforcement: "active",
    bypass_actors: Array.isArray(value.bypass_actors) ? value.bypass_actors.map(normalizeBypassActor).filter((item) => item.actor_id && item.actor_type) : [],
    conditions: {
      ref_name: {
        include: uniqueStrings(value.conditions?.ref_name?.include || []),
        exclude: uniqueStrings(value.conditions?.ref_name?.exclude || []),
      },
    },
    rules: Array.isArray(value.rules) ? value.rules : [],
  };
}

function ruleParameters(rules = [], type) {
  const rule = (Array.isArray(rules) ? rules : []).find((item) => item?.type === type);
  return rule?.parameters && typeof rule.parameters === "object" ? rule.parameters : {};
}

function statusCheckBindings(rules = []) {
  const parameters = ruleParameters(rules, "required_status_checks");
  return (Array.isArray(parameters.required_status_checks) ? parameters.required_status_checks : [])
    .map((item) => ({
      context: compact(item?.context || "", 255),
      integration_id: Number(item?.integration_id ?? item?.app_id ?? 0) || null,
    }))
    .filter((item) => item.context);
}

function pullRequestRuleEvidence(rules = []) {
  const parameters = ruleParameters(rules, "pull_request");
  return {
    present: (Array.isArray(rules) ? rules : []).some((item) => item?.type === "pull_request"),
    required_approving_review_count: Number(parameters.required_approving_review_count || 0),
    dismiss_stale_reviews_on_push: bool(parameters.dismiss_stale_reviews_on_push),
    required_review_thread_resolution: bool(parameters.required_review_thread_resolution),
    require_last_push_approval: bool(parameters.require_last_push_approval),
    require_code_owner_review: bool(parameters.require_code_owner_review),
    allowed_merge_methods: uniqueStrings(parameters.allowed_merge_methods || []),
  };
}

function eligibleHumanCollaborators(readback = {}) {
  const collaborators = Array.isArray(readback?.collaborators) ? readback.collaborators : readback?.direct_collaborators;
  return (Array.isArray(collaborators) ? collaborators : []).filter((item) =>
    item?.type === "User" && ["write", "maintain", "admin"].includes(compact(item?.permission || item?.role_name || "", 32).toLowerCase())
  );
}

function singleOwnerModeEligible(readback = {}, branchPolicy = null) {
  const eligible = eligibleHumanCollaborators(readback);
  return readback?.proof?.collaborator_ownership_complete === true
    && eligible.length === 1
    && (branchPolicy?.required_checks || []).length > 0;
}

function resolveSingleOwnerMode(args = {}, readback = null, branchPolicy = null) {
  const eligible = singleOwnerModeEligible(readback || {}, branchPolicy);
  if (args.single_owner_mode === undefined || args.single_owner_mode === null || args.single_owner_mode === "") return eligible;
  return bool(args.single_owner_mode) && eligible;
}

function buildDesiredRuleset(checks, { singleOwnerMode = false, branchPolicy, finalizerAppId = null } = {}) {
  const rules = [];
  if (branchPolicy.require_pull_request) {
    rules.push({
      type: "pull_request",
      parameters: {
        allowed_merge_methods: ["merge", "squash", "rebase"],
        dismiss_stale_reviews_on_push: branchPolicy.dismiss_stale_approvals,
        require_code_owner_review: false,
        require_last_push_approval: !singleOwnerMode,
        required_approving_review_count: singleOwnerMode ? 0 : 1,
        required_review_thread_resolution: branchPolicy.require_conversation_resolution,
      },
    });
  }
  if (checks.length > 0) {
    rules.push({
      type: "required_status_checks",
      parameters: {
        do_not_enforce_on_create: false,
        required_status_checks: checks.map((context) => ({
          context,
          ...(finalizerAppId ? { integration_id: finalizerAppId } : {}),
        })),
        strict_required_status_checks_policy: branchPolicy.strict_required_status_checks,
      },
    });
  }
  if (branchPolicy.block_force_push) rules.push({ type: "non_fast_forward" });
  return writableRulesetPayload({
    name: managedRulesetName(branchPolicy.branch),
    bypass_actors: [],
    conditions: { ref_name: { include: [branchPolicy.ref], exclude: [] } },
    rules,
  });
}

function refPatternMatchesBranch(pattern = "", branch = "main") {
  const value = compact(pattern, 255);
  if (!value) return false;
  const branchRef = `refs/heads/${branch}`;
  if (["~ALL", branch, branchRef].includes(value)) return true;
  if (value === "~DEFAULT_BRANCH") return branch === "main";
  if (!value.includes("*") && !value.includes("?")) return false;
  const wildcardSafe = value.replace(/\*\*/g, "\u0000").replace(/\*/g, "\u0001").replace(/\?/g, "\u0002");
  const escaped = wildcardSafe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = escaped.replace(/\u0000/g, ".*").replace(/\u0001/g, "[^/]*").replace(/\u0002/g, "[^/]");
  try {
    return new RegExp(`^${source}$`).test(branchRef);
  } catch {
    return false;
  }
}

function matchesBranchCondition(detail = {}, branch = "main") {
  const include = uniqueStrings(detail.conditions?.ref_name?.include || []);
  const exclude = uniqueStrings(detail.conditions?.ref_name?.exclude || []);
  return include.some((pattern) => refPatternMatchesBranch(pattern, branch))
    && !exclude.some((pattern) => refPatternMatchesBranch(pattern, branch));
}

function evaluateRuleset(detail = {}, checks, finalizerAppId, target = {}) {
  const writable = writableRulesetPayload(detail);
  const pullRequest = pullRequestRuleEvidence(writable.rules);
  const bindings = statusCheckBindings(writable.rules);
  const observedChecks = uniqueStrings(bindings.map((item) => item.context)).sort();
  const missingChecks = checks.filter((check) => !observedChecks.includes(check));
  const producerMismatches = checks.filter((check) => {
    const matches = bindings.filter((item) => item.context === check);
    return finalizerAppId && !matches.some((item) => item.integration_id === finalizerAppId);
  });
  const bypassActors = writable.bypass_actors;
  const matchingFinalizerBypassActors = bypassActors.filter((actor) => finalizerAppId && actor.actor_type === "Integration" && actor.actor_id === finalizerAppId);
  const sourceType = compact(detail.source_type || "", 64) || null;
  const source = compact(detail.source || "", 255) || null;
  const repositorySource = target.owner && target.repo ? `${target.owner}/${target.repo}` : null;
  const applies = matchesBranchCondition(detail, target.default_branch || "main");
  return {
    id: Number(detail.id || 0) || null,
    name: compact(detail.name || "", 100) || null,
    target: detail.target || null,
    enforcement: detail.enforcement || null,
    source_type: sourceType,
    source,
    repository_owned: sourceType === "Repository" && source === repositorySource,
    applies_to_target: applies,
    applies_to_main: applies,
    pull_request: pullRequest,
    required_status_checks: observedChecks,
    required_status_check_bindings: bindings,
    missing_required_checks: missingChecks,
    required_check_producer_mismatches: producerMismatches,
    bypass_actors: bypassActors,
    matching_finalizer_bypass_actors: matchingFinalizerBypassActors,
    policy_fingerprint: githubRepositoryPolicyFingerprint(writable),
    raw_writable_policy: writable,
    secrets_included: false,
  };
}

async function readRulesetDetails({ owner, repo, index, token, fetchImpl }) {
  const details = [];
  for (const item of Array.isArray(index) ? index : []) {
    const id = Number(item?.id || 0);
    if (!id) continue;
    const result = await githubRequest({ apiPath: `/repos/${encode(owner)}/${encode(repo)}/rulesets/${id}`, token, fetchImpl });
    details.push({ id, status: result.status, detail: result.ok ? result.payload : null, error: result.ok ? null : result.payload });
  }
  return details;
}

async function readAllCollaborators({ owner, repo, token, fetchImpl }) {
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await githubRequest({ apiPath: `/repos/${encode(owner)}/${encode(repo)}/collaborators?affiliation=all&per_page=100&page=${page}`, token, fetchImpl });
    if (!result.ok || !Array.isArray(result.payload)) return { ok: false, status: result.status, payload: [], complete: false };
    items.push(...result.payload);
    if (result.payload.length < 100) return { ok: true, status: result.status, payload: items, complete: true };
  }
  return { ok: false, status: 409, payload: [], complete: false };
}

async function readCollaboratorPermissions({ owner, repo, collaborators, token, fetchImpl }) {
  const output = [];
  for (const collaborator of Array.isArray(collaborators) ? collaborators : []) {
    const login = compact(collaborator?.login || "", 100);
    if (!login) continue;
    const result = await githubRequest({ apiPath: `/repos/${encode(owner)}/${encode(repo)}/collaborators/${encode(login)}/permission`, token, fetchImpl });
    output.push({
      login,
      type: collaborator?.type || null,
      status: result.status,
      permission: result.ok ? compact(result.payload?.permission || "", 32) || null : null,
      role_name: result.ok ? compact(result.payload?.role_name || "", 64) || null : null,
      secrets_included: false,
    });
  }
  return output;
}

export async function readGithubRepositoryPolicy(args = {}, deps = {}) {
  assertSecretFree(args);
  const target = await resolveTarget(args);
  const branchPolicy = target.branch_policy;
  const fetchImpl = deps.fetchImpl || fetch;
  const token = await resolveToken(args, deps);
  const base = `/repos/${encode(target.owner)}/${encode(target.repo)}`;
  const [repository, branch, activeRules, rulesetsIndex, classicProtection, collaborators] = await Promise.all([
    githubRequest({ apiPath: base, token, fetchImpl }),
    githubRequest({ apiPath: `${base}/branches/${encode(target.default_branch)}`, token, fetchImpl }),
    githubRequest({ apiPath: `${base}/rules/branches/${encode(target.default_branch)}`, token, fetchImpl }),
    githubRequest({ apiPath: `${base}/rulesets?includes_parents=true&per_page=100`, token, fetchImpl }),
    githubRequest({ apiPath: `${base}/branches/${encode(target.default_branch)}/protection`, token, fetchImpl }),
    readAllCollaborators({ owner: target.owner, repo: target.repo, token, fetchImpl }),
  ]);

  const rulesetsIndexReadable = rulesetsIndex.ok && Array.isArray(rulesetsIndex.payload);
  const rulesetIndex = rulesetsIndexReadable ? rulesetsIndex.payload : [];
  const rulesetDetails = rulesetsIndexReadable ? await readRulesetDetails({ owner: target.owner, repo: target.repo, index: rulesetIndex, token, fetchImpl }) : [];
  const indexedRulesetIds = rulesetIndex.map((item) => Number(item?.id || 0)).filter(Boolean);
  const rulesetDetailsReadable = rulesetsIndexReadable
    && indexedRulesetIds.length === rulesetIndex.length
    && rulesetDetails.length === indexedRulesetIds.length
    && rulesetDetails.every((item) => item.status === 200 && item.detail);
  const collaboratorPermissions = collaborators.ok && collaborators.complete === true
    ? await readCollaboratorPermissions({ owner: target.owner, repo: target.repo, collaborators: collaborators.payload, token, fetchImpl })
    : [];
  const collaboratorPermissionsReadable = collaborators.ok
    && collaborators.complete === true
    && Array.isArray(collaborators.payload)
    && collaboratorPermissions.length === collaborators.payload.length
    && collaboratorPermissions.every((item) => item?.status === 200 && Boolean(compact(item?.permission || item?.role_name || "", 32)));
  const eligibleHumans = collaboratorPermissionsReadable
    ? collaboratorPermissions.filter((item) => item?.type === "User" && ["write", "maintain", "admin"].includes(compact(item?.permission || item?.role_name || "", 32).toLowerCase()))
    : [];

  const config = resolveGitHubAppConfig(args.action || {});
  const finalizerAppId = /^\d+$/.test(String(config.appId || "")) ? Number(config.appId) : null;
  const finalizerInstallationId = /^\d+$/.test(String(config.installationId || "")) ? Number(config.installationId) : null;
  const checks = normalizeRequiredChecks(args.required_checks, branchPolicy);
  const managedName = managedRulesetName(target.default_branch);
  const evaluatedRulesets = rulesetDetails
    .filter((item) => item.status === 200 && item.detail)
    .map((item) => evaluateRuleset(item.detail, checks, finalizerAppId, target));
  const targetRulesets = evaluatedRulesets.filter((item) => item.enforcement === "active" && item.applies_to_target);
  const managedRulesets = evaluatedRulesets.filter((item) => item.name === managedName && item.applies_to_target);
  const repositoryManagedRulesets = managedRulesets.filter((item) => item.repository_owned === true);
  const activeManagedRulesets = targetRulesets.filter((item) => item.name === managedName);
  const allBypassActors = targetRulesets.flatMap((item) => item.bypass_actors.map((actor) => ({ ...actor, ruleset_id: item.id, ruleset_name: item.name })));
  const matchingFinalizerBypassActors = allBypassActors.filter((actor) => finalizerAppId && actor.actor_type === "Integration" && actor.actor_id === finalizerAppId);

  const classic = classicProtection.ok ? classicProtection.payload : null;
  const classicPullRequest = classic?.required_pull_request_reviews || null;
  const classicChecks = uniqueStrings((classic?.required_status_checks?.checks || []).map((item) => item?.context));
  const activeRuleList = activeRules.ok && Array.isArray(activeRules.payload) ? activeRules.payload : [];
  const activePullRequestRules = activeRuleList.filter((item) => item?.type === "pull_request");
  const mergeQueueObserved = activeRuleList.some((item) => item?.type === "merge_queue");

  const requiredReviewCounts = [
    ...targetRulesets.map((item) => item.pull_request.required_approving_review_count),
    Number(classicPullRequest?.required_approving_review_count || 0),
  ];
  const requiredReviewCount = Math.max(0, ...requiredReviewCounts);
  const dismissStale = targetRulesets.some((item) => item.pull_request.dismiss_stale_reviews_on_push) || bool(classicPullRequest?.dismiss_stale_reviews);
  const threadResolution = targetRulesets.some((item) => item.pull_request.required_review_thread_resolution) || bool(classic?.required_conversation_resolution?.enabled);
  const lastPushApproval = targetRulesets.some((item) => item.pull_request.require_last_push_approval) || bool(classicPullRequest?.require_last_push_approval);
  const observedChecks = uniqueStrings([...targetRulesets.flatMap((item) => item.required_status_checks), ...classicChecks]).sort();
  const missingChecks = checks.filter((check) => !observedChecks.includes(check));
  const managedProducerBound = checks.length === 0 || activeManagedRulesets.some((item) =>
    item.repository_owned === true
    && item.missing_required_checks.length === 0
    && item.required_check_producer_mismatches.length === 0
  );
  const singleOwnerModeObserved = eligibleHumans.length === 1
    && checks.length > 0
    && requiredReviewCount === 0
    && managedProducerBound
    && activeManagedRulesets.some((item) => item.pull_request.present);

  const branchReadable = branch.ok && SHA_PATTERN.test(String(branch.payload?.commit?.sha || "")) && typeof branch.payload?.protected === "boolean";
  const activeRulesReadable = activeRules.ok && Array.isArray(activeRules.payload);
  const classicProtectionReadable = classicProtection.status === 404 || (classicProtection.status === 200 && classicProtection.payload && typeof classicProtection.payload === "object");
  const repositoryAutoMergeReadable = repository.ok && typeof repository.payload?.allow_auto_merge === "boolean";
  const protectionReadable = classicProtectionReadable && activeRulesReadable && rulesetsIndexReadable && rulesetDetailsReadable && branchReadable;
  const pullRequestRequired = !branchPolicy.require_pull_request
    || requiredReviewCount >= 1
    || activePullRequestRules.length > 0
    || targetRulesets.some((item) => item.pull_request.present);
  const directPushBlocked = protectionReadable && branch.payload.protected === true && pullRequestRequired && allBypassActors.length === 0;
  const nonFastForwardObserved = targetRulesets.some((item) => (item.raw_writable_policy?.rules || []).some((rule) => rule?.type === "non_fast_forward"));
  const autoMergeAllowed = repositoryAutoMergeReadable ? repository.payload.allow_auto_merge : null;
  const genericPrRestrictionProven = branchPolicy.generic_pull_request_merge_forbidden !== true;

  const proof = {
    policy_state_readable: protectionReadable,
    collaborator_ownership_complete: collaboratorPermissionsReadable,
    ruleset_details_readable: rulesetDetailsReadable,
    required_reviews_proven: !branchPolicy.require_pull_request || requiredReviewCount >= 1 || singleOwnerModeObserved,
    required_approving_review_count: requiredReviewCount,
    dismiss_stale_reviews_proven: !branchPolicy.dismiss_stale_approvals || dismissStale,
    required_review_thread_resolution_proven: !branchPolicy.require_conversation_resolution || threadResolution,
    require_last_push_approval_observed: lastPushApproval || singleOwnerModeObserved,
    required_status_checks_proven: missingChecks.length === 0 && managedProducerBound,
    required_status_check_producer_bound: managedProducerBound,
    missing_required_status_checks: missingChecks,
    direct_push_block_proven: directPushBlocked,
    force_push_block_proven: !branchPolicy.block_force_push || nonFastForwardObserved,
    finalizer_app_identity_resolved: finalizerAppId !== null,
    finalizer_not_bypass_proven: finalizerAppId !== null && rulesetDetailsReadable && matchingFinalizerBypassActors.length === 0,
    merge_queue_disabled_or_equivalent: !mergeQueueObserved,
    auto_merge_disabled: autoMergeAllowed === false,
    generic_pull_request_merge_forbidden_proven: genericPrRestrictionProven,
  };
  proof.server_policy_gate_complete = Object.entries(proof)
    .filter(([key]) => !["required_approving_review_count", "missing_required_status_checks"].includes(key))
    .every(([, value]) => value === true);

  const findings = [];
  if (!proof.policy_state_readable) findings.push("policy_state_unreadable");
  if (!proof.collaborator_ownership_complete) findings.push("collaborator_ownership_incomplete");
  if (!proof.ruleset_details_readable) findings.push("ruleset_details_unreadable");
  if (!proof.required_reviews_proven) findings.push("required_review_missing");
  if (!proof.dismiss_stale_reviews_proven) findings.push("stale_review_dismissal_missing");
  if (!proof.required_review_thread_resolution_proven) findings.push("review_thread_resolution_missing");
  if (!proof.require_last_push_approval_observed) findings.push("latest_push_approval_missing");
  if (!proof.required_status_checks_proven) findings.push("required_status_checks_missing");
  if (!proof.required_status_check_producer_bound) findings.push("required_status_check_producer_unbound");
  if (!proof.direct_push_block_proven) findings.push("direct_push_block_unproven");
  if (!proof.force_push_block_proven) findings.push("force_push_block_unproven");
  if (!proof.finalizer_app_identity_resolved) findings.push("finalizer_app_identity_unresolved");
  if (!proof.finalizer_not_bypass_proven) findings.push("finalizer_bypass_posture_unproven");
  if (!proof.merge_queue_disabled_or_equivalent) findings.push("merge_queue_rule_observed");
  if (!proof.auto_merge_disabled) findings.push("repository_auto_merge_not_disabled");
  if (!proof.generic_pull_request_merge_forbidden_proven) findings.push("generic_pull_request_merge_forbidden_unproven");

  const branchSha = branchReadable ? String(branch.payload.commit.sha).toLowerCase() : null;
  return {
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    mode: "readback",
    constitution: {
      contract: branchPolicy.constitution_contract,
      source: branchPolicy.constitution_source,
      branch_policy: branchPolicy,
      source_of_truth: true,
    },
    target: { owner: target.owner, repo: target.repo, default_branch: target.default_branch },
    branch_sha: branchSha,
    main_sha: branchSha,
    api_status: {
      repository: repository.status,
      branch: branch.status,
      active_rules: activeRules.status,
      rulesets_index: rulesetsIndex.status,
      classic_branch_protection: classicProtection.status,
      collaborators: collaborators.status,
      ruleset_details: rulesetDetails.map((item) => ({ id: item.id, status: item.status })),
    },
    branch_protected: branchReadable ? branch.payload.protected : null,
    repository_auto_merge_allowed: autoMergeAllowed,
    active_rule_count: activeRuleList.length,
    ruleset_index_count: rulesetsIndexReadable ? rulesetIndex.length : null,
    ruleset_details: evaluatedRulesets,
    managed_ruleset_name: managedName,
    managed_ruleset_count: managedRulesets.length,
    repository_managed_ruleset_count: repositoryManagedRulesets.length,
    active_managed_ruleset_count: activeManagedRulesets.length,
    bypass_actors: allBypassActors,
    collaborators: collaboratorPermissions,
    direct_collaborators: collaboratorPermissions,
    eligible_human_collaborators: eligibleHumans,
    single_owner_mode_eligible: singleOwnerModeEligible({ collaborators: collaboratorPermissions, proof }, branchPolicy),
    review_policy_mode: singleOwnerModeObserved ? "single_owner_attestation" : requiredReviewCount >= 1 ? "independent_approval" : "incomplete",
    finalizer_identity: { app_id: finalizerAppId, installation_id: finalizerInstallationId, resolved: finalizerAppId !== null },
    matching_finalizer_bypass_actors: matchingFinalizerBypassActors,
    required_checks: checks,
    observed_required_checks: observedChecks,
    merge_queue_rule_observed: mergeQueueObserved,
    proof,
    findings,
    mutation_executed: false,
    secrets_included: false,
  };
}

export function buildGithubRepositoryPolicyPlan(args = {}, readback = null) {
  assertSecretFree(args);
  const target = readback?.target || {
    owner: compact(args.owner || "", 191),
    repo: compact(args.repo || "", 191),
    default_branch: compact(args.default_branch || args.branch || "main", 191) || "main",
  };
  const branchPolicy = readback?.constitution?.branch_policy || resolveBranchPolicy(target.default_branch);
  const checks = normalizeRequiredChecks(args.required_checks, branchPolicy);
  const singleOwnerMode = resolveSingleOwnerMode(args, readback, branchPolicy);
  if (bool(args.single_owner_mode) && !singleOwnerModeEligible(readback || {}, branchPolicy)) {
    throw controllerError(409, "github_repository_policy_single_owner_mode_ineligible", "single_owner_mode requires complete collaborator proof, exactly one eligible human, and a trusted required gate.", {
      eligible_human_collaborators: eligibleHumanCollaborators(readback || {}).map((item) => ({ login: item.login, permission: item.permission, role_name: item.role_name })),
      branch: branchPolicy.branch,
      secrets_included: false,
    });
  }
  assertSecurePolicyOverrides(args, { singleOwnerMode });
  const finalizerAppId = Number(readback?.finalizer_identity?.app_id || 0) || null;
  const desiredRuleset = buildDesiredRuleset(checks, { singleOwnerMode, branchPolicy, finalizerAppId });
  const managedName = managedRulesetName(branchPolicy.branch);
  const managedRulesets = (readback?.ruleset_details || []).filter((item) => item.name === managedName && item.applies_to_target);
  const repositoryManagedRulesets = managedRulesets.filter((item) => item.repository_owned === true);
  const existingManagedRuleset = managedRulesets.length === 1 && repositoryManagedRulesets.length === 1 ? repositoryManagedRulesets[0] : null;
  const activationBlockers = [];
  if (branchPolicy.generic_pull_request_merge_forbidden) activationBlockers.push("generic_pull_request_merge_forbidden_not_expressible_by_current_repository_ruleset_contract");
  if (!finalizerAppId && checks.length > 0) activationBlockers.push("trusted_required_check_producer_unresolved");
  const managedRulesetBlocked = managedRulesets.length > 1
    || (managedRulesets.length === 1 && repositoryManagedRulesets.length !== 1)
    || activationBlockers.length > 0;
  const currentBranchSha = readback?.branch_sha || readback?.main_sha || compact(args.expected_commit_sha || args.expected_main_sha || "", 40) || null;
  const policyFingerprint = githubRepositoryPolicyFingerprint({
    controller_contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    constitution_contract: branchPolicy.constitution_contract,
    constitution_source: branchPolicy.constitution_source,
    branch_policy: branchPolicy,
    target,
    expected_commit_sha: currentBranchSha,
    desired_ruleset: desiredRuleset,
  });
  const capabilityAuthorization = buildGithubRepositoryPolicyCapabilityBinding({
    target,
    expected_commit_sha: currentBranchSha,
    expected_policy_fingerprint: policyFingerprint,
  });
  return {
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    mode: "plan",
    constitution: { contract: branchPolicy.constitution_contract, source: branchPolicy.constitution_source, branch_policy: branchPolicy, source_of_truth: true },
    target,
    expected_commit_sha: currentBranchSha,
    expected_main_sha: currentBranchSha,
    desired_ruleset: desiredRuleset,
    desired_ruleset_fingerprint: githubRepositoryPolicyFingerprint(desiredRuleset),
    policy_fingerprint: policyFingerprint,
    required_checks: checks,
    required_check_producer_integration_id: finalizerAppId,
    confirmation: confirmationForBranch(branchPolicy.branch),
    review_policy_mode: singleOwnerMode ? "single_owner_attestation" : "independent_approval",
    single_owner_mode: singleOwnerMode,
    capability_authorization: capabilityAuthorization,
    activation_blockers: activationBlockers,
    operation: managedRulesetBlocked ? "blocked" : existingManagedRuleset ? "update_ruleset" : "create_ruleset",
    existing_ruleset_id: existingManagedRuleset?.id || null,
    preconditions: {
      policy_state_readable: readback?.proof?.policy_state_readable === true,
      finalizer_app_identity_resolved: readback?.proof?.finalizer_app_identity_resolved === true,
      no_target_bypass_actors: Array.isArray(readback?.bypass_actors) && readback.bypass_actors.length === 0,
      no_main_bypass_actors: Array.isArray(readback?.bypass_actors) && readback.bypass_actors.length === 0,
      managed_ruleset_ambiguity_absent: managedRulesets.length <= 1,
      managed_ruleset_repository_owned: managedRulesets.length === 0 || (managedRulesets.length === 1 && repositoryManagedRulesets.length === 1),
      repository_auto_merge_disabled: readback?.proof?.auto_merge_disabled === true,
      merge_queue_disabled: readback?.proof?.merge_queue_disabled_or_equivalent === true,
      review_policy_mode_eligible: !singleOwnerMode || readback?.single_owner_mode_eligible === true,
      activation_blockers_absent: activationBlockers.length === 0,
    },
    mutation_executed: false,
    force_push_allowed: false,
    repository_content_mutation_allowed: false,
    secrets_included: false,
  };
}

function assertAdminCaller(auth = {}) {
  const callerType = compact(auth.caller_type || auth.callerType || "", 64).toLowerCase();
  const role = compact(auth.role || auth.admin_role || "", 64).toLowerCase();
  if (callerType !== "admin" && !["admin", "platform_admin", "super_admin"].includes(role) && auth.is_admin !== true) {
    throw controllerError(403, "github_repository_policy_admin_required", "Policy apply requires an authenticated Admin caller.");
  }
}

async function authorizeApply(args, deps, target) {
  const authorization = buildGithubRepositoryPolicyCapabilityBinding({
    target,
    expected_commit_sha: args.expected_commit_sha || args.expected_main_sha,
    expected_policy_fingerprint: args.expected_policy_fingerprint || args.policy_fingerprint,
  });
  if (!authorization) {
    throw controllerError(400, "github_repository_policy_capability_binding_invalid", "Policy apply requires a complete repository, branch SHA, and policy fingerprint binding.");
  }

  if (typeof deps.authorizeApply === "function") {
    const result = await deps.authorizeApply({ args, target, authorization, auth: deps.auth || {} });
    if (!result?.ok) throw controllerError(403, "github_repository_policy_capability_envelope_invalid", "Policy apply requires a valid capability envelope.");
    if (result.apply_allowed !== true) {
      throw capabilityEnvelopeError({ ok: false, status: "capability_resolution_envelope_apply_not_allowed", envelope_id: result.envelope_id || null, secrets_included: false }, "GitHub repository policy apply requires an apply-authorized capability resolution envelope.");
    }
    return { ...result, authorization, secrets_included: false };
  }

  const pool = deps.pool || (typeof deps.resolveCapabilityExecutionEnvelope === "function" ? null : (await import("./db.js")).getPool());
  const acceptedIntents = ["github_repository_policy_apply", "repository_policy_controller", "github_main_review_policy"];
  const resolver = deps.resolveCapabilityExecutionEnvelope || resolveCapabilityExecutionEnvelope;
  const marker = deps.markCapabilityEnvelopeReferenced || markCapabilityEnvelopeReferenced;
  const resolved = await resolver({
    pool,
    source: args,
    acceptedAppKeys: ["github"],
    acceptedIntents,
    acceptedCapabilityKeys: ["repository_policy_controller"],
    expectedTenantId: deps.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: deps.auth?.user_id || deps.auth?.admin_id || "",
    expectedResourceUri: authorization.resource_uri,
    expectedCommitSha: authorization.expected_commit_sha,
    requireCommitHint: true,
    expectedBindingSha256: authorization.binding_sha256,
    expectedCapabilitySha256: authorization.capability_sha256,
  });
  if (!resolved.ok) throw capabilityEnvelopeError(resolved, "GitHub repository policy apply requires a valid capability resolution envelope.");
  if (resolved.apply_allowed !== true) {
    throw capabilityEnvelopeError({ ok: false, status: "capability_resolution_envelope_apply_not_allowed", envelope_id: resolved.envelope_id, secrets_included: false }, "GitHub repository policy apply requires an apply-authorized capability resolution envelope.");
  }
  if (
    resolved.app_key !== "github"
    || resolved.capability_key !== "repository_policy_controller"
    || !acceptedIntents.includes(String(resolved.operation_intent || "").trim().toLowerCase())
    || resolved.resource_uri !== authorization.resource_uri
    || resolved.expected_commit_sha !== authorization.expected_commit_sha
    || resolved.binding_sha256 !== authorization.binding_sha256
    || resolved.capability_sha256 !== authorization.capability_sha256
  ) {
    throw capabilityEnvelopeError({ ok: false, status: "capability_resolution_envelope_policy_binding_mismatch", envelope_id: resolved.envelope_id, secrets_included: false }, "GitHub repository policy apply requires an envelope bound to the exact repository branch SHA and policy fingerprint.");
  }
  await marker({
    pool,
    envelopeId: resolved.envelope_id,
    executionRef: `github_repository_policy_apply:${target.owner}/${target.repo}:${target.default_branch}:${authorization.expected_commit_sha}:${authorization.expected_policy_fingerprint}`,
  });
  return { ...resolved, authorization, secrets_included: false };
}

function validateApplyInputs(args, preReadback, plan) {
  const expectedCommitSha = compact(args.expected_commit_sha || args.expected_main_sha || "", 40).toLowerCase();
  const expectedFingerprint = compact(args.expected_policy_fingerprint || args.policy_fingerprint || "", 64).toLowerCase();
  const expectedConfirm = confirmationForBranch(preReadback.target.default_branch);
  if (!SHA_PATTERN.test(expectedCommitSha)) throw controllerError(400, "github_repository_policy_expected_main_sha_required", "expected_commit_sha (or legacy expected_main_sha) must be a full commit SHA.");
  if (!FINGERPRINT_PATTERN.test(expectedFingerprint)) throw controllerError(400, "github_repository_policy_fingerprint_required", "expected_policy_fingerprint must be a 64-character SHA-256 fingerprint.");
  if (compact(args.confirm || "", 128) !== expectedConfirm) throw controllerError(400, "github_repository_policy_confirmation_invalid", `confirm must equal ${expectedConfirm}.`);
  if (preReadback.branch_sha !== expectedCommitSha) {
    throw controllerError(409, "github_repository_policy_main_sha_drift", "The current target branch SHA no longer matches the approved expected SHA.", {
      branch: preReadback.target.default_branch,
      expected_commit_sha: expectedCommitSha,
      observed_commit_sha: preReadback.branch_sha,
      secrets_included: false,
    });
  }
  if (plan.policy_fingerprint !== expectedFingerprint) {
    throw controllerError(409, "github_repository_policy_fingerprint_mismatch", "The current Constitution-derived policy plan fingerprint does not match the approved fingerprint.", {
      expected_policy_fingerprint: expectedFingerprint,
      observed_policy_fingerprint: plan.policy_fingerprint,
      secrets_included: false,
    });
  }
  if (!preReadback.proof.policy_state_readable) throw controllerError(409, "github_repository_policy_state_unreadable", "Policy apply is blocked because current protection state is unknown or inaccessible.", { api_status: preReadback.api_status, secrets_included: false });
  if (!preReadback.proof.finalizer_app_identity_resolved) throw controllerError(409, "github_repository_policy_finalizer_identity_unresolved", "Policy apply is blocked until the trusted GitHub App producer ID is resolved.");
  if (preReadback.bypass_actors.length > 0) throw controllerError(409, "github_repository_policy_bypass_actor_present", "Policy apply refuses a target policy containing bypass actors.", { bypass_actors: preReadback.bypass_actors, secrets_included: false });
  if (!plan.preconditions.managed_ruleset_ambiguity_absent || preReadback.managed_ruleset_count > 1) throw controllerError(409, "github_repository_policy_managed_ruleset_ambiguous", "More than one managed target-branch Ruleset exists.");
  if (!plan.preconditions.managed_ruleset_repository_owned) throw controllerError(409, "github_repository_policy_managed_ruleset_not_repository_owned", "The matching managed Ruleset is inherited and cannot be mutated by the repository controller.");
  if (plan.review_policy_mode === "single_owner_attestation" && plan.preconditions.review_policy_mode_eligible !== true) throw controllerError(409, "github_repository_policy_single_owner_mode_ineligible", "Single-owner policy apply is blocked by live collaborator proof.");
  if (!preReadback.proof.auto_merge_disabled || !preReadback.proof.merge_queue_disabled_or_equivalent) throw controllerError(409, "github_repository_policy_alternate_merge_path_blocked", "Auto-merge or merge queue must be disabled before applying the governed policy.");
  if (plan.activation_blockers.length > 0 || plan.operation === "blocked") {
    throw controllerError(409, "github_repository_policy_activation_blocked", "The Constitution-derived policy cannot be safely represented by the current server enforcement contract.", {
      branch: preReadback.target.default_branch,
      activation_blockers: plan.activation_blockers,
      secrets_included: false,
    });
  }
}

async function rollbackRuleset({ target, token, fetchImpl, createdRulesetId, previousRuleset }) {
  try {
    if (createdRulesetId) {
      const result = await githubRequest({ method: "DELETE", apiPath: `/repos/${encode(target.owner)}/${encode(target.repo)}/rulesets/${createdRulesetId}`, token, fetchImpl });
      return { attempted: true, succeeded: result.ok, status: result.status, operation: "delete_created_ruleset", secrets_included: false };
    }
    if (previousRuleset?.id && previousRuleset?.raw_writable_policy) {
      const result = await githubRequest({ method: "PUT", apiPath: `/repos/${encode(target.owner)}/${encode(target.repo)}/rulesets/${previousRuleset.id}`, token, fetchImpl, body: previousRuleset.raw_writable_policy });
      return { attempted: true, succeeded: result.ok, status: result.status, operation: "restore_previous_ruleset", secrets_included: false };
    }
  } catch (error) {
    return { attempted: true, succeeded: false, error: error?.message || String(error), secrets_included: false };
  }
  return { attempted: false, succeeded: false, secrets_included: false };
}

export async function runGithubRepositoryPolicyController(args = {}, deps = {}) {
  assertSecretFree(args);
  const mode = normalizeMode(args.mode);
  if (mode === "readback") return readGithubRepositoryPolicy(args, deps);

  if (mode === "apply") {
    assertAdminCaller(deps.auth || {});
    const expectedCommitSha = compact(args.expected_commit_sha || args.expected_main_sha || "", 40).toLowerCase();
    const expectedFingerprint = compact(args.expected_policy_fingerprint || args.policy_fingerprint || "", 64).toLowerCase();
    const branch = compact(args.default_branch || args.branch || "main", 191) || "main";
    if (!SHA_PATTERN.test(expectedCommitSha)) throw controllerError(400, "github_repository_policy_expected_main_sha_required", "expected_commit_sha (or legacy expected_main_sha) must be a full commit SHA.");
    if (!FINGERPRINT_PATTERN.test(expectedFingerprint)) throw controllerError(400, "github_repository_policy_fingerprint_required", "expected_policy_fingerprint must be a 64-character SHA-256 fingerprint.");
    if (compact(args.confirm || "", 128) !== confirmationForBranch(branch)) throw controllerError(400, "github_repository_policy_confirmation_invalid", `confirm must equal ${confirmationForBranch(branch)}.`);
    const target = await resolveTarget(args);
    await authorizeApply(args, deps, target);
  }

  const preReadback = await readGithubRepositoryPolicy(args, deps);
  const plan = buildGithubRepositoryPolicyPlan(args, preReadback);
  if (mode === "plan") return { ...plan, readback: preReadback, secrets_included: false };

  validateApplyInputs(args, preReadback, plan);
  const fetchImpl = deps.fetchImpl || fetch;
  const token = await resolveToken(args, deps);
  const target = preReadback.target;
  const previousRuleset = (preReadback.ruleset_details || []).find((item) => item.name === preReadback.managed_ruleset_name && item.applies_to_target && item.repository_owned === true) || null;
  const apiBase = `/repos/${encode(target.owner)}/${encode(target.repo)}/rulesets`;
  let mutation;
  let createdRulesetId = null;

  if (previousRuleset?.id) {
    const payload = await requireGithubRequest({ method: "PUT", apiPath: `${apiBase}/${previousRuleset.id}`, token, fetchImpl, body: plan.desired_ruleset }, "github_repository_policy_ruleset_update_failed");
    mutation = { operation: "update_ruleset", ruleset_id: Number(payload?.id || previousRuleset.id), status: "accepted" };
  } else {
    const payload = await requireGithubRequest({ method: "POST", apiPath: apiBase, token, fetchImpl, body: plan.desired_ruleset }, "github_repository_policy_ruleset_create_failed");
    createdRulesetId = Number(payload?.id || 0) || null;
    mutation = { operation: "create_ruleset", ruleset_id: createdRulesetId, status: "accepted" };
  }

  const postReadback = await readGithubRepositoryPolicy(args, { ...deps, token });
  const managed = (postReadback.ruleset_details || []).filter((item) => item.name === postReadback.managed_ruleset_name && item.applies_to_target);
  const repositoryManaged = managed.filter((item) => item.repository_owned === true);
  const expectedRulesetFingerprint = plan.desired_ruleset_fingerprint;
  const postconditions = {
    branch_sha_unchanged: postReadback.branch_sha === preReadback.branch_sha,
    main_sha_unchanged: postReadback.branch_sha === preReadback.branch_sha,
    one_managed_ruleset: managed.length === 1 && repositoryManaged.length === 1,
    ruleset_fingerprint_matches: repositoryManaged.length === 1 && repositoryManaged[0].policy_fingerprint === expectedRulesetFingerprint,
    required_check_producer_bound: postReadback.proof.required_status_check_producer_bound === true,
    server_policy_gate_complete: postReadback.proof.server_policy_gate_complete === true,
    no_bypass_actors: postReadback.bypass_actors.length === 0,
    secrets_included: false,
  };
  const postconditionPassed = Object.entries(postconditions).filter(([key]) => key !== "secrets_included").every(([, value]) => value === true);

  if (!postconditionPassed) {
    const rollback = await rollbackRuleset({ target, token, fetchImpl, createdRulesetId, previousRuleset });
    throw controllerError(409, "github_repository_policy_postcondition_failed", "GitHub accepted the policy mutation but same-cycle readback did not prove the Constitution-derived policy.", {
      mutation,
      postconditions,
      rollback,
      secrets_included: false,
    });
  }

  return {
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    mode: "apply",
    constitution: plan.constitution,
    target,
    expected_commit_sha: preReadback.branch_sha,
    expected_main_sha: preReadback.branch_sha,
    policy_fingerprint: plan.policy_fingerprint,
    desired_ruleset_fingerprint: expectedRulesetFingerprint,
    mutation,
    postconditions,
    readback: postReadback,
    mutation_executed: true,
    force_push_executed: false,
    repository_content_mutation_executed: false,
    secrets_included: false,
  };
}
