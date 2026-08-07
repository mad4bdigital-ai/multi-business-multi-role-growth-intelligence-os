import fs from 'node:fs';

function replaceOnce(text, pattern, replacement, label) {
  const next = text.replace(pattern, replacement);
  if (next === text) throw new Error(`autofix replacement failed: ${label}`);
  return next;
}

const controllerPath = 'http-generic-api/githubRepositoryPolicyController.js';
let controller = fs.readFileSync(controllerPath, 'utf8');
controller = replaceOnce(controller,
  'github-repository-policy-controller-v1',
  'github-repository-policy-controller-v2',
  'controller version');
controller = replaceOnce(controller,
  '  "Execute current phase journeys",\n]);',
  '  "Execute current phase journeys",\n  "Single Owner Review Gate",\n]);',
  'required single-owner gate');
controller = replaceOnce(controller,
/function assertSecurePolicyOverrides\(args = \{\}\) \{[\s\S]*?\n\}\n\nasync function resolveTarget/,
`function assertSecurePolicyOverrides(args = {}, { singleOwnerMode = false } = {}) {
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
    throw controllerError(400, "github_repository_policy_unsafe_override_rejected", "Requested policy overrides weaken the governed main policy.", {
      failures,
      secrets_included: false,
    });
  }
}

async function resolveTarget`,
  'secure policy overrides');
controller = replaceOnce(controller,
/function buildDesiredRuleset\(checks\) \{[\s\S]*?\n\}\n\nfunction refPatternMatchesMain/,
`function eligibleHumanCollaborators(readback = {}) {
  return (Array.isArray(readback?.direct_collaborators) ? readback.direct_collaborators : []).filter((item) =>
    item?.type === "User" && ["write", "maintain", "admin"].includes(compact(item?.permission || item?.role_name || "", 32).toLowerCase())
  );
}

function singleOwnerModeEligible(readback = {}, target = {}) {
  const eligible = eligibleHumanCollaborators(readback);
  return eligible.length === 1 && eligible[0].login === target.owner;
}

function resolveSingleOwnerMode(args = {}, readback = null, target = {}) {
  const eligible = singleOwnerModeEligible(readback || {}, target);
  if (args.single_owner_mode === undefined || args.single_owner_mode === null || args.single_owner_mode === "") return eligible;
  return bool(args.single_owner_mode) && eligible;
}

function buildDesiredRuleset(checks, { singleOwnerMode = false } = {}) {
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
          require_last_push_approval: !singleOwnerMode,
          required_approving_review_count: singleOwnerMode ? 0 : 1,
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

function refPatternMatchesMain`,
  'desired ruleset');
controller = replaceOnce(controller,
`  const collaboratorPermissions = collaborators.ok
    ? await readCollaboratorPermissions({ owner: target.owner, repo: target.repo, collaborators: collaborators.payload, token, fetchImpl })
    : [];

  const config = resolveGitHubAppConfig(args.action || {});`,
`  const collaboratorPermissions = collaborators.ok
    ? await readCollaboratorPermissions({ owner: target.owner, repo: target.repo, collaborators: collaborators.payload, token, fetchImpl })
    : [];
  const eligibleHumans = collaboratorPermissions.filter((item) =>
    item?.type === "User" && ["write", "maintain", "admin"].includes(compact(item?.permission || item?.role_name || "", 32).toLowerCase())
  );
  const singleOwnerEligible = eligibleHumans.length === 1 && eligibleHumans[0].login === target.owner;

  const config = resolveGitHubAppConfig(args.action || {});`,
  'collaborator eligibility');
controller = replaceOnce(controller,
`  const missingChecks = checks.filter((check) => !observedChecks.includes(check));
  const branchReadable = branch.ok`,
`  const missingChecks = checks.filter((check) => !observedChecks.includes(check));
  const singleOwnerGateObserved = observedChecks.includes("Single Owner Review Gate");
  const singleOwnerModeObserved = singleOwnerEligible
    && requiredReviewCount === 0
    && singleOwnerGateObserved
    && mainRulesets.some((item) => item.pull_request.present);
  const branchReadable = branch.ok`,
  'single owner observed mode');
controller = replaceOnce(controller,
`    required_reviews_proven: requiredReviewCount >= 1,
    required_approving_review_count: requiredReviewCount || null,`,
`    required_reviews_proven: requiredReviewCount >= 1 || singleOwnerModeObserved,
    required_approving_review_count: requiredReviewCount,`,
  'required review proof');
controller = replaceOnce(controller,
`    require_last_push_approval_observed: lastPushApproval,`,
`    require_last_push_approval_observed: lastPushApproval || singleOwnerModeObserved,`,
  'last push proof');
controller = replaceOnce(controller,
`    direct_collaborators: collaboratorPermissions,
    finalizer_identity: {`,
`    direct_collaborators: collaboratorPermissions,
    eligible_human_collaborators: eligibleHumans,
    single_owner_mode_eligible: singleOwnerEligible,
    review_policy_mode: singleOwnerModeObserved ? "single_owner_attestation" : requiredReviewCount >= 1 ? "independent_approval" : "incomplete",
    finalizer_identity: {`,
  'readback review mode');
controller = replaceOnce(controller,
`export function buildGithubRepositoryPolicyPlan(args = {}, readback = null) {
  assertSecretFree(args);
  assertSecurePolicyOverrides(args);
  const checks = normalizeRequiredChecks(args.required_checks);
  const target = readback?.target || {`,
`export function buildGithubRepositoryPolicyPlan(args = {}, readback = null) {
  assertSecretFree(args);
  const checks = normalizeRequiredChecks(args.required_checks);
  const target = readback?.target || {`,
  'plan secure override position');
controller = replaceOnce(controller,
`  if (target.default_branch !== "main") {
    throw controllerError(400, "github_repository_policy_main_only", "The governed repository policy controller is restricted to the main branch.");
  }
  const desiredRuleset = buildDesiredRuleset(checks);`,
`  if (target.default_branch !== "main") {
    throw controllerError(400, "github_repository_policy_main_only", "The governed repository policy controller is restricted to the main branch.");
  }
  const singleOwnerMode = resolveSingleOwnerMode(args, readback, target);
  if (bool(args.single_owner_mode) && !singleOwnerModeEligible(readback || {}, target)) {
    throw controllerError(409, "github_repository_policy_single_owner_mode_ineligible", "single_owner_mode requires exactly one eligible human collaborator and that collaborator must be the repository owner.", {
      eligible_human_collaborators: eligibleHumanCollaborators(readback || {}).map((item) => ({ login: item.login, permission: item.permission, role_name: item.role_name })),
      secrets_included: false,
    });
  }
  assertSecurePolicyOverrides(args, { singleOwnerMode });
  const desiredRuleset = buildDesiredRuleset(checks, { singleOwnerMode });`,
  'plan single owner mode');
controller = replaceOnce(controller,
`    policy_fingerprint: policyFingerprint,
    capability_authorization: capabilityAuthorization,`,
`    policy_fingerprint: policyFingerprint,
    review_policy_mode: singleOwnerMode ? "single_owner_attestation" : "independent_approval",
    single_owner_mode: singleOwnerMode,
    capability_authorization: capabilityAuthorization,`,
  'plan mode output');
controller = replaceOnce(controller,
`      merge_queue_disabled: readback?.proof?.merge_queue_disabled_or_equivalent === true,
    },`,
`      merge_queue_disabled: readback?.proof?.merge_queue_disabled_or_equivalent === true,
      review_policy_mode_eligible: !singleOwnerMode || readback?.single_owner_mode_eligible === true,
    },`,
  'plan precondition');
controller = replaceOnce(controller,
`  if (!preReadback.proof.auto_merge_disabled || !preReadback.proof.merge_queue_disabled_or_equivalent) {
    throw controllerError(409, "github_repository_policy_alternate_merge_path_blocked", "Auto-merge or merge queue must be disabled before applying the governed policy.");
  }`,
`  if (plan.review_policy_mode === "single_owner_attestation" && plan.preconditions.review_policy_mode_eligible !== true) {
    throw controllerError(409, "github_repository_policy_single_owner_mode_ineligible", "Single-owner policy apply is blocked because the live collaborator readback does not prove exactly one eligible owner.");
  }
  if (!preReadback.proof.auto_merge_disabled || !preReadback.proof.merge_queue_disabled_or_equivalent) {
    throw controllerError(409, "github_repository_policy_alternate_merge_path_blocked", "Auto-merge or merge queue must be disabled before applying the governed policy.");
  }`,
  'apply single-owner precondition');
fs.writeFileSync(controllerPath, controller);

const testPath = 'http-generic-api/test-github-repository-policy-controller.mjs';
let test = fs.readFileSync(testPath, 'utf8');
test = replaceOnce(test,
`    assert.equal(first.desired_ruleset.bypass_actors.length, 0);
    assert.equal(first.desired_ruleset.rules.some((rule) => rule.type === "non_fast_forward"), true);
    assert.throws(
      () => buildGithubRepositoryPolicyPlan({ required_approving_review_count: 0 }, readback),
      (error) => error?.code === "github_repository_policy_unsafe_override_rejected"
    );`,
`    assert.equal(first.desired_ruleset.bypass_actors.length, 0);
    assert.equal(first.desired_ruleset.rules.some((rule) => rule.type === "non_fast_forward"), true);
    assert.equal(first.review_policy_mode, "single_owner_attestation");
    const singleOwnerPullRequest = first.desired_ruleset.rules.find((rule) => rule.type === "pull_request").parameters;
    assert.equal(singleOwnerPullRequest.required_approving_review_count, 0);
    assert.equal(singleOwnerPullRequest.require_last_push_approval, false);
    assert.ok(GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS.includes("Single Owner Review Gate"));
    assert.throws(
      () => buildGithubRepositoryPolicyPlan({ single_owner_mode: false, required_approving_review_count: 0 }, readback),
      (error) => error?.code === "github_repository_policy_unsafe_override_rejected"
    );`,
  'single owner controller regression');
fs.writeFileSync(testPath, test);

const gateScript = `import fs from "node:fs";

export const SINGLE_OWNER_CHECK_NAME = "Single Owner Review Gate";
export const SINGLE_OWNER_ATTESTATION_TOKEN = "OWNER_ATTEST_SINGLE_OWNER";
const ELIGIBLE = new Set(["write", "maintain", "admin"]);

function permissionOf(collaborator = {}) {
  if (collaborator?.permissions?.admin) return "admin";
  if (collaborator?.permissions?.maintain) return "maintain";
  if (collaborator?.permissions?.push) return "write";
  return String(collaborator?.role_name || "").toLowerCase();
}

export function eligibleHumans(collaborators = []) {
  return (Array.isArray(collaborators) ? collaborators : [])
    .filter((item) => item?.type === "User" && ELIGIBLE.has(permissionOf(item)))
    .map((item) => ({ login: item.login, permission: permissionOf(item) }));
}

export function evaluateReviewGate({ owner, author, headSha, collaborators = [], reviews = [] } = {}) {
  const eligible = eligibleHumans(collaborators);
  const eligibleLogins = new Set(eligible.map((item) => item.login));
  const byAuthor = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const login = review?.user?.login || review?.author?.login;
    if (!login) continue;
    const previous = byAuthor.get(login);
    const reviewTime = Date.parse(review?.submitted_at || review?.submittedAt || 0) || 0;
    const previousTime = Date.parse(previous?.submitted_at || previous?.submittedAt || 0) || 0;
    if (!previous || reviewTime >= previousTime) byAuthor.set(login, review);
  }
  const independent = eligible.filter((item) => item.login !== author);
  if (independent.length > 0) {
    const approval = independent.find((item) => {
      const review = byAuthor.get(item.login);
      return review?.state === "APPROVED" && review?.commit_id === headSha;
    });
    return {
      ok: Boolean(approval),
      mode: "independent_approval",
      reason: approval ? "eligible_independent_exact_head_approval" : "eligible_independent_exact_head_approval_missing",
      eligible_humans: eligible,
      reviewer: approval?.login || null,
    };
  }
  const singleOwnerEligible = eligible.length === 1 && eligible[0].login === author && author === owner;
  if (!singleOwnerEligible) {
    return { ok: false, mode: "blocked", reason: "single_owner_eligibility_not_proven", eligible_humans: eligible, reviewer: null };
  }
  const review = byAuthor.get(author);
  const body = String(review?.body || "");
  const attested = review?.state === "COMMENTED"
    && review?.commit_id === headSha
    && body.includes(SINGLE_OWNER_ATTESTATION_TOKEN)
    && body.includes(headSha);
  return {
    ok: attested,
    mode: "single_owner_attestation",
    reason: attested ? "single_owner_exact_head_attestation" : "single_owner_exact_head_attestation_missing",
    eligible_humans: eligible,
    reviewer: attested ? author : null,
  };
}

async function api(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer \${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GitHub API \${response.status}: \${body?.message || url}`);
  return body;
}

async function listAll(url, token) {
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = url.includes("?") ? "&" : "?";
    const batch = await api(`\${url}\${separator}per_page=100&page=\${page}`, token);
    if (!Array.isArray(batch)) throw new Error(`Expected array from \${url}`);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

async function publishCheck({ apiBase, repo, token, headSha, conclusion, summary }) {
  return api(`\${apiBase}/repos/\${repo}/check-runs`, token, {
    method: "POST",
    body: JSON.stringify({
      name: SINGLE_OWNER_CHECK_NAME,
      head_sha: headSha,
      status: "completed",
      conclusion,
      output: { title: SINGLE_OWNER_CHECK_NAME, summary },
    }),
  });
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  if (!eventPath || !token || !repo) throw new Error("GITHUB_EVENT_PATH, GITHUB_TOKEN and GITHUB_REPOSITORY are required");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const prNumber = event.pull_request?.number || event.review?.pull_request_url?.split("/").pop();
  if (!prNumber) throw new Error("Pull request number is required");
  const pr = await api(`\${apiBase}/repos/\${repo}/pulls/\${prNumber}`, token);
  if (pr.base?.ref !== "main") {
    await publishCheck({ apiBase, repo, token, headSha: pr.head.sha, conclusion: "success", summary: "Not a main-targeting pull request; gate is not applicable." });
    return;
  }
  const [collaborators, reviews] = await Promise.all([
    listAll(`\${apiBase}/repos/\${repo}/collaborators?affiliation=direct`, token),
    listAll(`\${apiBase}/repos/\${repo}/pulls/\${prNumber}/reviews`, token),
  ]);
  const result = evaluateReviewGate({ owner: pr.base?.repo?.owner?.login || repo.split("/")[0], author: pr.user?.login, headSha: pr.head.sha, collaborators, reviews });
  const summary = JSON.stringify({ ...result, pr_number: Number(prNumber), exact_head_sha: pr.head.sha, secrets_included: false });
  await publishCheck({ apiBase, repo, token, headSha: pr.head.sha, conclusion: result.ok ? "success" : "failure", summary });
  console.log(summary);
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === `file://\${process.argv[1]}`) main().catch((error) => { console.error(error); process.exitCode = 1; });
`;
fs.writeFileSync('http-generic-api/scripts/single-owner-review-gate.mjs', gateScript);

const gateTest = `import assert from "node:assert/strict";
import { evaluateReviewGate } from "./scripts/single-owner-review-gate.mjs";
const sha = "a".repeat(40);
const owner = "mad4bdigital-ai";
const admin = { login: owner, type: "User", permissions: { admin: true, maintain: true, push: true } };
{
  const result = evaluateReviewGate({ owner, author: owner, headSha: sha, collaborators: [admin], reviews: [{ user: { login: owner }, state: "COMMENTED", commit_id: sha, submitted_at: "2026-08-07T00:00:00Z", body: `OWNER_ATTEST_SINGLE_OWNER\\nexact_head_sha: \${sha}` }] });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "single_owner_attestation");
}
{
  const result = evaluateReviewGate({ owner, author: owner, headSha: sha, collaborators: [admin], reviews: [{ user: { login: owner }, state: "COMMENTED", commit_id: "b".repeat(40), submitted_at: "2026-08-07T00:00:00Z", body: `OWNER_ATTEST_SINGLE_OWNER\\nexact_head_sha: \${sha}` }] });
  assert.equal(result.ok, false);
}
{
  const reviewer = { login: "reviewer", type: "User", permissions: { push: true } };
  const result = evaluateReviewGate({ owner, author: owner, headSha: sha, collaborators: [admin, reviewer], reviews: [{ user: { login: owner }, state: "COMMENTED", commit_id: sha, submitted_at: "2026-08-07T00:00:00Z", body: `OWNER_ATTEST_SINGLE_OWNER\\nexact_head_sha: \${sha}` }] });
  assert.equal(result.ok, false);
  assert.equal(result.mode, "independent_approval");
}
{
  const reviewer = { login: "reviewer", type: "User", permissions: { push: true } };
  const result = evaluateReviewGate({ owner, author: owner, headSha: sha, collaborators: [admin, reviewer], reviews: [{ user: { login: "reviewer" }, state: "APPROVED", commit_id: sha, submitted_at: "2026-08-07T00:00:00Z", body: "approved" }] });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "independent_approval");
}
console.log(JSON.stringify({ ok: true, test: "single_owner_review_gate", secrets_included: false }));
`;
fs.writeFileSync('http-generic-api/test-single-owner-review-gate.mjs', gateTest);

const gateWorkflow = `name: Single Owner Review Gate

on:
  pull_request:
    branches: [main]
    types: [opened, reopened, synchronize, ready_for_review]
  pull_request_review:
    types: [submitted, dismissed]

permissions:
  contents: read
  pull-requests: read
  checks: write

concurrency:
  group: single-owner-review-gate-\${{ github.event.pull_request.number || github.event.review.pull_request_url }}
  cancel-in-progress: true

jobs:
  evaluate:
    name: Evaluate review policy
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
        with:
          ref: \${{ github.event.pull_request.head.sha || github.sha }}
          fetch-depth: 1
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
      - name: Evaluate collaborator-aware exact-head review gate
        env:
          GITHUB_TOKEN: \${{ github.token }}
        run: node http-generic-api/scripts/single-owner-review-gate.mjs
`;
fs.writeFileSync('.github/workflows/single-owner-review-gate.yml', gateWorkflow);

const migration = `-- GitHub main policy single-owner mode metadata and tool-schema upgrade.
-- no_provider_call=true; no_external_write=true; no_credential_payload_read=true;
-- no_protected_ref_mutation=true; no_force_push=true; secrets_included=false.

UPDATE execution_policies
SET policy_value = JSON_SET(
      CASE WHEN JSON_VALID(policy_value) THEN policy_value ELSE JSON_OBJECT() END,
      '$.review_policy_mode','auto_single_owner_or_independent',
      '$.required_approving_review_count_independent',1,
      '$.required_approving_review_count_single_owner',0,
      '$.single_owner_exact_head_attestation_required',TRUE,
      '$.single_owner_gate_check','Single Owner Review Gate',
      '$.required_status_checks',JSON_ARRAY(
        'Syntax Check','Unit & Integration Tests','Architecture Drift Detection','Execution Resolver Gate',
        'Evaluate changed feature phases','Execute current phase journeys','Single Owner Review Gate'
      )
    ),
    notes='Fail-closed main review policy with automatic single-owner exact-head attestation fallback; independent approval resumes when another eligible human exists.',
    updated_at=CURRENT_TIMESTAMP
WHERE policy_group='Repository Automation Governance' AND policy_key='github_repository_policy_controller_v1';

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      CASE WHEN JSON_VALID(input_schema) THEN input_schema ELSE JSON_OBJECT() END,
      '$.properties.single_owner_mode',JSON_OBJECT('type','boolean','description','Optional explicit request; succeeds only when live collaborator readback proves exactly one eligible human and that human is the repository owner.')
    ),
    description=CONCAT(description,' Single-owner mode uses an exact-head governed review check instead of GitHub-native self-approval and automatically ceases to apply when another eligible human collaborator exists.'),
    updated_at=CURRENT_TIMESTAMP
WHERE tool_key IN ('github_repository_policy_controller','repository_automation_policy_controller');

UPDATE platform_plugin_capabilities
SET metadata_json = JSON_SET(
      CASE WHEN JSON_VALID(metadata_json) THEN metadata_json ELSE JSON_OBJECT() END,
      '$.review_policy_mode','auto_single_owner_or_independent',
      '$.single_owner_gate_check','Single Owner Review Gate',
      '$.single_owner_exact_head_attestation_required',TRUE
    ), updated_at=CURRENT_TIMESTAMP
WHERE capability_key='repository_policy_controller';

INSERT INTO governed_migration_authorization_registry
  (migration_file,authorization_status,authorization_source,policy_key,risk_tier,requires_preflight,requires_confirmation,allow_record_only,allow_apply,notes,metadata_json)
VALUES
  ('1049_github_repository_policy_single_owner_mode.sql','authorized','migration_seed','governed_migration_runner_authorization_v1','medium',1,1,1,1,
   'Authorize metadata/schema registration for collaborator-aware single-owner review mode. No GitHub policy is applied by this migration.',
   JSON_OBJECT('scope','github_repository_policy_single_owner_mode_registration','live_github_policy_apply',false,'provider_calls',false,'external_writes',false,'protected_ref_mutation',false,'force_push',false,'secrets_included',false))
ON DUPLICATE KEY UPDATE authorization_status=VALUES(authorization_status),authorization_source=VALUES(authorization_source),policy_key=VALUES(policy_key),risk_tier=VALUES(risk_tier),requires_preflight=VALUES(requires_preflight),requires_confirmation=VALUES(requires_confirmation),allow_record_only=VALUES(allow_record_only),allow_apply=VALUES(allow_apply),notes=VALUES(notes),metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;
`;
fs.writeFileSync('http-generic-api/migrations/1049_github_repository_policy_single_owner_mode.sql', migration);

const contract = {
  $schema: '../../.specify/schemas/e2e-phases.schema.json',
  schema_version: 1,
  feature_key: 'github-repository-policy-single-owner-mode',
  title: 'GitHub main single-owner review policy mode',
  delivery_mode: 'single_pr',
  current_phase: 'mvp',
  scope: { include: [
    '.changes/e2e/github-repository-policy-single-owner-mode.json',
    '.github/workflows/single-owner-review-gate.yml',
    'http-generic-api/githubRepositoryPolicyController.js',
    'http-generic-api/migrations/1049_github_repository_policy_single_owner_mode.sql',
    'http-generic-api/scripts/single-owner-review-gate.mjs',
    'http-generic-api/test-github-repository-policy-controller.mjs',
    'http-generic-api/test-single-owner-review-gate.mjs'
  ] },
  merge_contract: { minimum_phase: 'mvp' },
  phases: [{ id: 'mvp', status: 'implemented', objective: 'Allow a repository with exactly one eligible human owner to use exact-head owner attestation without weakening CI, while automatically reverting to independent approval whenever another eligible human collaborator exists.', e2e_journeys: [{ id: 'single-owner-exact-head-review-gate', end_to_end: true, level: 'synthetic_runtime', actor: 'repository_owner', entrypoint: 'pull request review plus repository policy plan/apply', terminal_outcome: 'Single-owner mode plans zero GitHub-native approvals only when live collaborator inventory proves exactly one eligible owner and requires the Single Owner Review Gate on the exact head; independent approval resumes automatically otherwise.', steps: ['Read direct collaborator permissions.', 'Select single-owner mode only for exactly one eligible human who is also repository owner and PR author.', 'Require an exact-head COMMENTED owner attestation because GitHub rejects self-APPROVE.', 'Publish Single Owner Review Gate as an exact-head Check Run.', 'Require that check in the managed main Ruleset and keep stale-review, thread-resolution, strict status checks, no bypass actors, non-fast-forward and direct-push blocking.', 'Reject explicit single_owner_mode when collaborator eligibility is not proven.'], assertions: ['Single owner with exact-head attestation passes.', 'Stale-head attestation fails.', 'Adding an eligible independent collaborator disables owner-attestation mode and requires independent APPROVED review.', 'Single-owner Ruleset uses native approval count zero only together with the required Single Owner Review Gate.', 'Independent mode still requires at least one GitHub-native approval.', 'No bypass actors, force push, repository content mutation, secrets, Production mutation or provider action are introduced.'], tests: [{ id: 'single-owner-review-gate-regression', runner: 'node', working_directory: 'http-generic-api', path: 'test-single-owner-review-gate.mjs', args: [] }, { id: 'repository-policy-controller-single-owner-regression', runner: 'node', working_directory: 'http-generic-api', path: 'test-github-repository-policy-controller.mjs', args: [] }], evidence_paths: ['.github/workflows/single-owner-review-gate.yml','http-generic-api/githubRepositoryPolicyController.js','http-generic-api/scripts/single-owner-review-gate.mjs','http-generic-api/test-single-owner-review-gate.mjs','http-generic-api/migrations/1049_github_repository_policy_single_owner_mode.sql'] }],
  secrets_included: false
};
fs.mkdirSync('.changes/e2e', { recursive: true });
fs.writeFileSync('.changes/e2e/github-repository-policy-single-owner-mode.json', `${JSON.stringify(contract, null, 2)}\n`);

fs.rmSync('http-generic-api/scripts/apply-single-owner-policy-autofix.mjs');
fs.rmSync('.github/workflows/single-owner-policy-autofix.yml');
console.log(JSON.stringify({ ok: true, changed: [controllerPath, testPath, '.github/workflows/single-owner-review-gate.yml', 'http-generic-api/scripts/single-owner-review-gate.mjs', 'http-generic-api/test-single-owner-review-gate.mjs', 'http-generic-api/migrations/1049_github_repository_policy_single_owner_mode.sql', '.changes/e2e/github-repository-policy-single-owner-mode.json'], temporary_files_removed: true, secrets_included: false }));
