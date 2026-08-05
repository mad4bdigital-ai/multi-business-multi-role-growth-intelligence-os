import { createHash } from "node:crypto";
import { resolveActivationBootstrapConfig } from "./activationBootstrapConfig.js";
import { getGitHubAppInstallationToken, resolveGitHubAppConfig } from "./githubAppAuth.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";
import { getPool } from "./db.js";

export const GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION = "github-repository-policy-controller-v1";
export const GITHUB_REPOSITORY_POLICY_CONFIRMATION = "APPLY_GITHUB_MAIN_REVIEW_POLICY";
export const GITHUB_REPOSITORY_POLICY_RULESET_NAME = "MAD4B main review policy";
export const GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS = Object.freeze([
  "Syntax Check",
  "Unit & Integration Tests",
  "Architecture Drift Detection",
  "Execution Resolver Gate",
  "Evaluate changed feature phases",
  "Execute current phase journeys",
]);

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

export function buildGithubRepositoryPolicyCapabilityBinding({
  target = {},
  expected_main_sha = "",
  expected_policy_fingerprint = "",
} = {}) {
  const owner = compact(target.owner || "", 191);
  const repo = compact(target.repo || "", 191);
  const branch = compact(target.default_branch || "main", 191) || "main";
  const expectedMainSha = compact(expected_main_sha, 40).toLowerCase();
  const expectedPolicyFingerprint = compact(expected_policy_fingerprint, 64).toLowerCase();
  if (!owner || !repo || branch !== "main" || !SHA_PATTERN.test(expectedMainSha) || !FINGERPRINT_PATTERN.test(expectedPolicyFingerprint)) {
    return null;
  }
  const resourceUri = `github://${owner}/${repo}/branch/${branch}`;
  const bindingSha256 = githubRepositoryPolicyFingerprint({
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    capability_key: "repository_policy_controller",
    operation_intent: "github_repository_policy_apply",
    resource_uri: resourceUri,
    expected_main_sha: expectedMainSha,
    expected_policy_fingerprint: expectedPolicyFingerprint,
  });
  return {
    resource_uri: resourceUri,
    expected_commit_sha: expectedMainSha,
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

function normalizeRequiredChecks(value) {
  if (value === undefined || value === null || value === "") return [...GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS];
  if (!Array.isArray(value)) {
    throw controllerError(400, "github_repository_policy_required_checks_invalid", "required_checks must be an array.");
  }
  const checks = uniqueStrings(value);
  const expected = [...GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS];
  const missing = expected.filter((check) => !checks.includes(check));
  const unexpected = checks.filter((check) => !expected.includes(check));
  if (checks.length !== expected.length || missing.length || unexpected.length) {
    throw controllerError(400, "github_repository_policy_required_checks_invalid", "required_checks must exactly match the canonical main policy check set.", {
      expected,
      missing,
      unexpected,
      secrets_included: false,
    });
  }
  return expected;
}

function assertSecurePolicyOverrides(args = {}) {
  const failures = [];
  if (args.required_approving_review_count !== undefined && Number(args.required_approving_review_count) < 1) failures.push("required_approving_review_count_below_one");
  if (args.dismiss_stale_reviews_on_push !== undefined && !bool(args.dismiss_stale_reviews_on_push)) failures.push("dismiss_stale_reviews_must_be_enabled");
  if (args.required_review_thread_resolution !== undefined && !bool(args.required_review_thread_resolution)) failures.push("review_thread_resolution_must_be_enabled");
  if (args.require_last_push_approval !== undefined && !bool(args.require_last_push_approval)) failures.push("last_push_approval_must_be_enabled");
  if (args.allow_direct_pushes !== undefined && bool(args.allow_direct_pushes)) failures.push("direct_pushes_must_be_blocked");
  if (args.bypass_actors !== undefined && (!Array.isArray(args.bypass_actors) || args.bypass_actors.length > 0)) failures.push("bypass_actors_must_be_empty");
  if (args.merge_queue_enabled !== undefined && bool(args.merge_queue_enabled)) failures.push("merge_queue_must_remain_disabled");
  if (args.auto_merge_enabled !== undefined && bool(args.auto_merge_enabled)) failures.push("auto_merge_must_remain_disabled");
  if (failures.length) {
    throw controllerError(400, "github_repository_policy_unsafe_override_rejected", "Requested policy overrides weaken the governed main policy.", {
      failures,
      secrets_included: false,
    });
  }
}

async function resolveTarget(args = {}) {
  const config = args.owner && args.repo ? null : await resolveActivationBootstrapConfig({});
  const owner = compact(args.owner || config?.config?.github_owner || "", 191);
  const repo = compact(args.repo || config?.config?.github_repo || "", 191);
  const defaultBranch = compact(args.default_branch || config?.config?.github_branch || "main", 191) || "main";
  if (!owner || !repo) {
    throw controllerError(400, "github_repository_policy_repo_required", "GitHub owner and repo are required.");
  }
  if (defaultBranch !== "main") {
    throw controllerError(400, "github_repository_policy_main_only", "The governed repository policy controller is restricted to the main branch.", {
      requested_branch: defaultBranch,
      secrets_included: false,
    });
  }
  return { owner, repo, default_branch: defaultBranch };
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
  return {
    ok: response.ok,
    status: Number(response.status),
    payload: sanitizeEvidence(payload),
  };
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
        include: uniqueStrings(value.conditions?.ref_name?.include || ["~DEFAULT_BRANCH"]),
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

function statusCheckContexts(rules = []) {
  const parameters = ruleParameters(rules, "required_status_checks");
  return uniqueStrings((parameters.required_status_checks || []).map((item) => item?.context)).sort();
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

function buildDesiredRuleset(checks) {
  return writableRulesetPayload({
    name: GITHUB_REPOSITORY_POLICY_RULESET_NAME,
    bypass_actors: [],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["merge", "squash", "rebase"],
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: true,
          required_approving_review_count: 1,
          required_review_thread_resolution: true,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create: false,
          required_status_checks: checks.map((context) => ({ context })),
          strict_required_status_checks_policy: true,
        },
      },
      { type: "non_fast_forward" },
    ],
  });
}

function matchesMainCondition(detail = {}, defaultBranch = "main") {
  const include = uniqueStrings(detail.conditions?.ref_name?.include || []);
  return include.includes("~DEFAULT_BRANCH") || include.includes(`refs/heads/${defaultBranch}`) || include.includes(defaultBranch);
}

function evaluateRuleset(detail = {}, checks, finalizerAppId) {
  const writable = writableRulesetPayload(detail);
  const pullRequest = pullRequestRuleEvidence(writable.rules);
  const observedChecks = statusCheckContexts(writable.rules);
  const missingChecks = checks.filter((check) => !observedChecks.includes(check));
  const bypassActors = writable.bypass_actors;
  const matchingFinalizerBypassActors = bypassActors.filter((actor) => finalizerAppId && actor.actor_type === "Integration" && actor.actor_id === finalizerAppId);
  return {
    id: Number(detail.id || 0) || null,
    name: compact(detail.name || "", 100) || null,
    target: detail.target || null,
    enforcement: detail.enforcement || null,
    applies_to_main: matchesMainCondition(detail),
    pull_request: pullRequest,
    required_status_checks: observedChecks,
    missing_required_checks: missingChecks,
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
    const result = await githubRequest({
      apiPath: `/repos/${encode(owner)}/${encode(repo)}/rulesets/${id}`,
      token,
      fetchImpl,
    });
    details.push({ id, status: result.status, detail: result.ok ? result.payload : null, error: result.ok ? null : result.payload });
  }
  return details;
}

async function readCollaboratorPermissions({ owner, repo, collaborators, token, fetchImpl }) {
  const output = [];
  for (const collaborator of Array.isArray(collaborators) ? collaborators : []) {
    const login = compact(collaborator?.login || "", 100);
    if (!login) continue;
    const result = await githubRequest({
      apiPath: `/repos/${encode(owner)}/${encode(repo)}/collaborators/${encode(login)}/permission`,
      token,
      fetchImpl,
    });
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
  const fetchImpl = deps.fetchImpl || fetch;
  const token = await resolveToken(args, deps);
  const base = `/repos/${encode(target.owner)}/${encode(target.repo)}`;
  const [repository, branch, activeRules, rulesetsIndex, classicProtection, collaborators] = await Promise.all([
    githubRequest({ apiPath: base, token, fetchImpl }),
    githubRequest({ apiPath: `${base}/branches/${encode(target.default_branch)}`, token, fetchImpl }),
    githubRequest({ apiPath: `${base}/rules/branches/${encode(target.default_branch)}`, token, fetchImpl }),
    githubRequest({ apiPath: `${base}/rulesets?includes_parents=true&per_page=100`, token, fetchImpl }),
    githubRequest({ apiPath: `${base}/branches/${encode(target.default_branch)}/protection`, token, fetchImpl }),
    githubRequest({ apiPath: `${base}/collaborators?affiliation=direct&per_page=100`, token, fetchImpl }),
  ]);

  const rulesetDetails = rulesetsIndex.ok
    ? await readRulesetDetails({ owner: target.owner, repo: target.repo, index: rulesetsIndex.payload, token, fetchImpl })
    : [];
  const collaboratorPermissions = collaborators.ok
    ? await readCollaboratorPermissions({ owner: target.owner, repo: target.repo, collaborators: collaborators.payload, token, fetchImpl })
    : [];

  const config = resolveGitHubAppConfig(args.action || {});
  const finalizerAppId = /^\d+$/.test(String(config.appId || "")) ? Number(config.appId) : null;
  const finalizerInstallationId = /^\d+$/.test(String(config.installationId || "")) ? Number(config.installationId) : null;
  const checks = normalizeRequiredChecks(args.required_checks);
  const evaluatedRulesets = rulesetDetails
    .filter((item) => item.status === 200 && item.detail)
    .map((item) => evaluateRuleset(item.detail, checks, finalizerAppId));
  const mainRulesets = evaluatedRulesets.filter((item) => item.enforcement === "active" && item.applies_to_main);
  const managedRulesets = mainRulesets.filter((item) => item.name === GITHUB_REPOSITORY_POLICY_RULESET_NAME);
  const allBypassActors = mainRulesets.flatMap((item) => item.bypass_actors.map((actor) => ({ ...actor, ruleset_id: item.id, ruleset_name: item.name })));
  const matchingFinalizerBypassActors = allBypassActors.filter((actor) => finalizerAppId && actor.actor_type === "Integration" && actor.actor_id === finalizerAppId);

  const classic = classicProtection.ok ? classicProtection.payload : null;
  const classicPullRequest = classic?.required_pull_request_reviews || null;
  const classicChecks = uniqueStrings((classic?.required_status_checks?.checks || []).map((item) => item?.context));
  const activeRuleList = activeRules.ok && Array.isArray(activeRules.payload) ? activeRules.payload : [];
  const activePullRequestRules = activeRuleList.filter((item) => item?.type === "pull_request");
  const activeStatusRules = activeRuleList.filter((item) => item?.type === "required_status_checks");
  const mergeQueueObserved = activeRuleList.some((item) => item?.type === "merge_queue");

  const requiredReviewCounts = [
    ...mainRulesets.map((item) => item.pull_request.required_approving_review_count),
    Number(classicPullRequest?.required_approving_review_count || 0),
  ];
  const requiredReviewCount = Math.max(0, ...requiredReviewCounts);
  const dismissStale = mainRulesets.some((item) => item.pull_request.dismiss_stale_reviews_on_push)
    || bool(classicPullRequest?.dismiss_stale_reviews);
  const threadResolution = mainRulesets.some((item) => item.pull_request.required_review_thread_resolution)
    || bool(classic?.required_conversation_resolution?.enabled);
  const lastPushApproval = mainRulesets.some((item) => item.pull_request.require_last_push_approval)
    || bool(classicPullRequest?.require_last_push_approval);
  const observedChecks = uniqueStrings([
    ...mainRulesets.flatMap((item) => item.required_status_checks),
    ...classicChecks,
    ...activeStatusRules.flatMap((item) => (item?.parameters?.required_status_checks || []).map((entry) => entry?.context)),
  ]).sort();
  const missingChecks = checks.filter((check) => !observedChecks.includes(check));
  const branchKnownUnprotected = branch.ok && branch.payload?.protected === false;
  const classicKnownAbsent = classicProtection.status === 404;
  const protectionReadable = [200, 404].includes(classicProtection.status)
    && activeRules.ok
    && rulesetsIndex.ok
    && branch.ok;
  const pullRequestRequired = requiredReviewCount >= 1 || activePullRequestRules.length > 0 || mainRulesets.some((item) => item.pull_request.present);
  const directPushBlocked = protectionReadable
    && pullRequestRequired
    && allBypassActors.length === 0
    && !branchKnownUnprotected;
  const autoMergeAllowed = repository.ok ? bool(repository.payload?.allow_auto_merge) : null;

  const proof = {
    policy_state_readable: protectionReadable,
    required_reviews_proven: requiredReviewCount >= 1,
    required_approving_review_count: requiredReviewCount || null,
    dismiss_stale_reviews_proven: dismissStale,
    required_review_thread_resolution_proven: threadResolution,
    require_last_push_approval_observed: lastPushApproval,
    required_status_checks_proven: missingChecks.length === 0,
    missing_required_status_checks: missingChecks,
    direct_push_block_proven: directPushBlocked,
    finalizer_app_identity_resolved: finalizerAppId !== null,
    finalizer_not_bypass_proven: finalizerAppId !== null && matchingFinalizerBypassActors.length === 0,
    merge_queue_disabled_or_equivalent: !mergeQueueObserved,
    auto_merge_disabled: autoMergeAllowed === false,
  };
  proof.server_policy_gate_complete = Object.entries(proof)
    .filter(([key]) => !["required_approving_review_count", "missing_required_status_checks"].includes(key))
    .every(([, value]) => value === true);

  const findings = [];
  if (!proof.policy_state_readable) findings.push("policy_state_unreadable");
  if (!proof.required_reviews_proven) findings.push("required_review_missing");
  if (!proof.dismiss_stale_reviews_proven) findings.push("stale_review_dismissal_missing");
  if (!proof.required_review_thread_resolution_proven) findings.push("review_thread_resolution_missing");
  if (!proof.require_last_push_approval_observed) findings.push("latest_push_approval_missing");
  if (!proof.required_status_checks_proven) findings.push("required_status_checks_missing");
  if (!proof.direct_push_block_proven) findings.push("direct_push_block_unproven");
  if (!proof.finalizer_app_identity_resolved) findings.push("finalizer_app_identity_unresolved");
  if (!proof.finalizer_not_bypass_proven) findings.push("finalizer_bypass_posture_unproven");
  if (!proof.merge_queue_disabled_or_equivalent) findings.push("merge_queue_rule_observed");
  if (!proof.auto_merge_disabled) findings.push("repository_auto_merge_not_disabled");

  return {
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    mode: "readback",
    target,
    main_sha: branch.ok ? branch.payload?.commit?.sha || null : null,
    api_status: {
      repository: repository.status,
      branch: branch.status,
      active_rules: activeRules.status,
      rulesets_index: rulesetsIndex.status,
      classic_branch_protection: classicProtection.status,
      collaborators: collaborators.status,
    },
    branch_protected: branch.ok ? Boolean(branch.payload?.protected) : null,
    repository_auto_merge_allowed: autoMergeAllowed,
    active_rule_count: activeRuleList.length,
    ruleset_index_count: rulesetsIndex.ok && Array.isArray(rulesetsIndex.payload) ? rulesetsIndex.payload.length : null,
    ruleset_details: evaluatedRulesets,
    managed_ruleset_count: managedRulesets.length,
    bypass_actors: allBypassActors,
    direct_collaborators: collaboratorPermissions,
    finalizer_identity: {
      app_id: finalizerAppId,
      installation_id: finalizerInstallationId,
      resolved: finalizerAppId !== null,
    },
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
  assertSecurePolicyOverrides(args);
  const checks = normalizeRequiredChecks(args.required_checks);
  const target = readback?.target || {
    owner: compact(args.owner || "", 191),
    repo: compact(args.repo || "", 191),
    default_branch: compact(args.default_branch || "main", 191) || "main",
  };
  if (target.default_branch !== "main") {
    throw controllerError(400, "github_repository_policy_main_only", "The governed repository policy controller is restricted to the main branch.");
  }
  const desiredRuleset = buildDesiredRuleset(checks);
  const managedRulesets = (readback?.ruleset_details || []).filter((item) => item.name === GITHUB_REPOSITORY_POLICY_RULESET_NAME && item.applies_to_main);
  const existingManagedRuleset = managedRulesets.length === 1 ? managedRulesets[0] : null;
  const currentMainSha = readback?.main_sha || compact(args.expected_main_sha || "", 40) || null;
  const policyFingerprint = githubRepositoryPolicyFingerprint({
    target,
    expected_main_sha: currentMainSha,
    desired_ruleset: desiredRuleset,
  });
const capabilityAuthorization = buildGithubRepositoryPolicyCapabilityBinding({
  target,
  expected_main_sha: currentMainSha,
  expected_policy_fingerprint: policyFingerprint,
});
  return {
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    mode: "plan",
    target,
    expected_main_sha: currentMainSha,
    desired_ruleset: desiredRuleset,
    desired_ruleset_fingerprint: githubRepositoryPolicyFingerprint(desiredRuleset),
    policy_fingerprint: policyFingerprint,
    capability_authorization: capabilityAuthorization,
    operation: existingManagedRuleset ? "update_ruleset" : "create_ruleset",
    existing_ruleset_id: existingManagedRuleset?.id || null,
    preconditions: {
      policy_state_readable: readback?.proof?.policy_state_readable === true,
      finalizer_app_identity_resolved: readback?.proof?.finalizer_app_identity_resolved === true,
      no_main_bypass_actors: Array.isArray(readback?.bypass_actors) && readback.bypass_actors.length === 0,
      managed_ruleset_ambiguity_absent: managedRulesets.length <= 1,
      repository_auto_merge_disabled: readback?.proof?.auto_merge_disabled === true,
      merge_queue_disabled: readback?.proof?.merge_queue_disabled_or_equivalent === true,
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
    expected_main_sha: args.expected_main_sha,
    expected_policy_fingerprint: args.expected_policy_fingerprint || args.policy_fingerprint,
  });
  if (!authorization) {
    throw controllerError(400, "github_repository_policy_capability_binding_invalid", "Policy apply requires a complete repository, main SHA, and policy fingerprint binding.");
  }

  if (typeof deps.authorizeApply === "function") {
    const result = await deps.authorizeApply({ args, target, authorization, auth: deps.auth || {} });
    if (!result?.ok) throw controllerError(403, "github_repository_policy_capability_envelope_invalid", "Policy apply requires a valid capability envelope.");
    if (result.apply_allowed !== true) {
      throw capabilityEnvelopeError({
        ok: false,
        status: "capability_resolution_envelope_apply_not_allowed",
        envelope_id: result.envelope_id || null,
        secrets_included: false,
      }, "GitHub main policy apply requires an apply-authorized capability resolution envelope.");
    }
    return { ...result, authorization, secrets_included: false };
  }

  const pool = deps.pool || (typeof deps.resolveCapabilityExecutionEnvelope === "function" ? null : getPool());
  const acceptedIntents = [
    "github_repository_policy_apply",
    "repository_policy_controller",
    "github_main_review_policy",
  ];
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
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "GitHub main policy apply requires a valid capability resolution envelope.");
  }
  if (resolved.apply_allowed !== true) {
    throw capabilityEnvelopeError({
      ok: false,
      status: "capability_resolution_envelope_apply_not_allowed",
      envelope_id: resolved.envelope_id,
      secrets_included: false,
    }, "GitHub main policy apply requires an apply-authorized capability resolution envelope.");
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
    throw capabilityEnvelopeError({
      ok: false,
      status: "capability_resolution_envelope_policy_binding_mismatch",
      envelope_id: resolved.envelope_id,
      secrets_included: false,
    }, "GitHub main policy apply requires an envelope bound to the exact repository, main SHA, and policy fingerprint.");
  }
  await marker({
    pool,
    envelopeId: resolved.envelope_id,
    executionRef: `github_repository_policy_apply:${target.owner}/${target.repo}:${target.default_branch}:${authorization.expected_commit_sha}:${authorization.expected_policy_fingerprint}`,
  });
  return { ...resolved, authorization, secrets_included: false };
}

function validateApplyInputs(args, preReadback, plan) {
  const expectedMainSha = compact(args.expected_main_sha || "", 40).toLowerCase();
  const expectedFingerprint = compact(args.expected_policy_fingerprint || args.policy_fingerprint || "", 64).toLowerCase();
  if (!SHA_PATTERN.test(expectedMainSha)) {
    throw controllerError(400, "github_repository_policy_expected_main_sha_required", "expected_main_sha must be a full commit SHA.");
  }
  if (!FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    throw controllerError(400, "github_repository_policy_fingerprint_required", "expected_policy_fingerprint must be a 64-character SHA-256 fingerprint.");
  }
  if (compact(args.confirm || "", 128) !== GITHUB_REPOSITORY_POLICY_CONFIRMATION) {
    throw controllerError(400, "github_repository_policy_confirmation_invalid", `confirm must equal ${GITHUB_REPOSITORY_POLICY_CONFIRMATION}.`);
  }
  if (preReadback.main_sha !== expectedMainSha) {
    throw controllerError(409, "github_repository_policy_main_sha_drift", "The current main SHA no longer matches expected_main_sha.", {
      expected_main_sha: expectedMainSha,
      observed_main_sha: preReadback.main_sha,
      secrets_included: false,
    });
  }
  if (plan.policy_fingerprint !== expectedFingerprint) {
    throw controllerError(409, "github_repository_policy_fingerprint_mismatch", "The current policy plan fingerprint does not match the approved fingerprint.", {
      expected_policy_fingerprint: expectedFingerprint,
      observed_policy_fingerprint: plan.policy_fingerprint,
      secrets_included: false,
    });
  }
  if (!preReadback.proof.policy_state_readable) {
    throw controllerError(409, "github_repository_policy_state_unreadable", "Policy apply is blocked because the current protection state is unknown or inaccessible.", {
      api_status: preReadback.api_status,
      secrets_included: false,
    });
  }
  if (!preReadback.proof.finalizer_app_identity_resolved) {
    throw controllerError(409, "github_repository_policy_finalizer_identity_unresolved", "Policy apply is blocked until the finalizer GitHub App ID is resolved.");
  }
  if (preReadback.bypass_actors.length > 0) {
    throw controllerError(409, "github_repository_policy_bypass_actor_present", "Policy apply refuses a current main policy containing bypass actors.", {
      bypass_actors: preReadback.bypass_actors,
      secrets_included: false,
    });
  }
  if (preReadback.managed_ruleset_count > 1) {
    throw controllerError(409, "github_repository_policy_managed_ruleset_ambiguous", "More than one managed main policy Ruleset exists.");
  }
  if (!preReadback.proof.auto_merge_disabled || !preReadback.proof.merge_queue_disabled_or_equivalent) {
    throw controllerError(409, "github_repository_policy_alternate_merge_path_blocked", "Auto-merge or merge queue must be disabled before applying the governed policy.");
  }
}

async function rollbackRuleset({ target, token, fetchImpl, createdRulesetId, previousRuleset }) {
  try {
    if (createdRulesetId) {
      const result = await githubRequest({
        method: "DELETE",
        apiPath: `/repos/${encode(target.owner)}/${encode(target.repo)}/rulesets/${createdRulesetId}`,
        token,
        fetchImpl,
      });
      return { attempted: true, succeeded: result.ok, status: result.status, operation: "delete_created_ruleset", secrets_included: false };
    }
    if (previousRuleset?.id && previousRuleset?.raw_writable_policy) {
      const result = await githubRequest({
        method: "PUT",
        apiPath: `/repos/${encode(target.owner)}/${encode(target.repo)}/rulesets/${previousRuleset.id}`,
        token,
        fetchImpl,
        body: previousRuleset.raw_writable_policy,
      });
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
    const expectedMainSha = compact(args.expected_main_sha || "", 40).toLowerCase();
    const expectedFingerprint = compact(args.expected_policy_fingerprint || args.policy_fingerprint || "", 64).toLowerCase();
    if (!SHA_PATTERN.test(expectedMainSha)) {
      throw controllerError(400, "github_repository_policy_expected_main_sha_required", "expected_main_sha must be a full commit SHA.");
    }
    if (!FINGERPRINT_PATTERN.test(expectedFingerprint)) {
      throw controllerError(400, "github_repository_policy_fingerprint_required", "expected_policy_fingerprint must be a 64-character SHA-256 fingerprint.");
    }
    if (compact(args.confirm || "", 128) !== GITHUB_REPOSITORY_POLICY_CONFIRMATION) {
      throw controllerError(400, "github_repository_policy_confirmation_invalid", `confirm must equal ${GITHUB_REPOSITORY_POLICY_CONFIRMATION}.`);
    }
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
  const previousRuleset = (preReadback.ruleset_details || []).find((item) => item.name === GITHUB_REPOSITORY_POLICY_RULESET_NAME && item.applies_to_main) || null;
  const apiBase = `/repos/${encode(target.owner)}/${encode(target.repo)}/rulesets`;
  let mutation;
  let createdRulesetId = null;

  if (previousRuleset?.id) {
    const payload = await requireGithubRequest({
      method: "PUT",
      apiPath: `${apiBase}/${previousRuleset.id}`,
      token,
      fetchImpl,
      body: plan.desired_ruleset,
    }, "github_repository_policy_ruleset_update_failed");
    mutation = { operation: "update_ruleset", ruleset_id: Number(payload?.id || previousRuleset.id), status: "accepted" };
  } else {
    const payload = await requireGithubRequest({
      method: "POST",
      apiPath: apiBase,
      token,
      fetchImpl,
      body: plan.desired_ruleset,
    }, "github_repository_policy_ruleset_create_failed");
    createdRulesetId = Number(payload?.id || 0) || null;
    mutation = { operation: "create_ruleset", ruleset_id: createdRulesetId, status: "accepted" };
  }

  const postReadback = await readGithubRepositoryPolicy(args, { ...deps, token });
  const managed = (postReadback.ruleset_details || []).filter((item) => item.name === GITHUB_REPOSITORY_POLICY_RULESET_NAME && item.applies_to_main);
  const expectedRulesetFingerprint = plan.desired_ruleset_fingerprint;
  const postconditions = {
    main_sha_unchanged: postReadback.main_sha === preReadback.main_sha,
    one_managed_ruleset: managed.length === 1,
    ruleset_fingerprint_matches: managed.length === 1 && managed[0].policy_fingerprint === expectedRulesetFingerprint,
    server_policy_gate_complete: postReadback.proof.server_policy_gate_complete === true,
    no_bypass_actors: postReadback.bypass_actors.length === 0,
    secrets_included: false,
  };
  const postconditionPassed = Object.entries(postconditions)
    .filter(([key]) => key !== "secrets_included")
    .every(([, value]) => value === true);

  if (!postconditionPassed) {
    const rollback = await rollbackRuleset({ target, token, fetchImpl, createdRulesetId, previousRuleset });
    throw controllerError(409, "github_repository_policy_postcondition_failed", "GitHub accepted the policy mutation but same-cycle post-readback did not prove the planned policy.", {
      mutation,
      postconditions,
      rollback,
      secrets_included: false,
    });
  }

  return {
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    mode: "apply",
    target,
    expected_main_sha: preReadback.main_sha,
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
