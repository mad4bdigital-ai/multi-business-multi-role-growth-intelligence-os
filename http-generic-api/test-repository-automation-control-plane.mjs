import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REPOSITORY_AUTOMATION_CAPABILITIES,
  buildRepositoryAutomationPlan,
  classifySpecLifecycle,
  collectChunkedToolResponse,
  executeCiAutoRecovery,
  runRepositoryAutomation,
  scanRepositoryAutomationHygiene,
} from "./repositoryAutomationControlPlane.js";

// frontend-surface-operation: POST /admin/repository-automation/plan

const expectedCapabilities = [
  "pr_lifecycle_orchestrator",
  "migration_release_orchestrator",
  "deployment_parity_watcher",
  "capability_envelope_lifecycle_manager",
  "governed_retry_readback_wrapper",
  "branch_cleanup_controller",
  "spec_lifecycle_guard",
  "operational_closeout_workflow",
  "response_chunk_collector",
  "drift_aware_branch_update",
  "ci_auto_recovery",
  "docs_agent_stabilization_gate",
  "scheduled_hygiene_scan",
];
for (const capability of expectedCapabilities) {
  assert(REPOSITORY_AUTOMATION_CAPABILITIES.includes(capability), `missing capability ${capability}`);
}
assert.equal(new Set(REPOSITORY_AUTOMATION_CAPABILITIES).size, REPOSITORY_AUTOMATION_CAPABILITIES.length);

const fullPlan = buildRepositoryAutomationPlan({
  automation_key: "full_workstream",
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  pull_number: 2044,
  branch: "gpt/example",
  migration: "1034_sprint69_repository_automation_control_plane.sql",
  expected_checksum_sha256: "a".repeat(64),
  expected_statement_count: 12,
  changed_files: ["docs/history/example/README.md"],
  historical: true,
});
assert.equal(fullPlan.ok, true);
assert.equal(fullPlan.automation_key, "full_workstream");
assert.equal(fullPlan.safety.no_force_push, true);
assert.equal(fullPlan.safety.readback_before_retry, true);
assert.equal(fullPlan.safety.outer_and_inner_authority_required_for_mutations, true);
assert(fullPlan.steps.some((step) => step.step_key === "pr_finalize"));
assert.equal(fullPlan.steps.some((step) => step.step_key === "mark_ready"), false, "full_workstream must not auto-mark a PR ready before finalization");
const prDeliveryPlan = buildRepositoryAutomationPlan({ automation_key: "pr_delivery", owner: "mad4bdigital-ai", repo: "multi-business-multi-role-growth-intelligence-os", pull_number: 4386, branch: "gpt/integration-rollup" });
assert(prDeliveryPlan.steps.some((step) => step.step_key === "pr_finalize"));
assert.equal(prDeliveryPlan.steps.some((step) => step.step_key === "mark_ready"), false, "pr_delivery must require readiness as an external, separately authorized state");
assert(fullPlan.steps.some((step) => step.step_key === "migration_apply"));
assert(fullPlan.steps.some((step) => step.step_key === "deployment_parity"));
assert(fullPlan.steps.some((step) => step.step_key === "hygiene_scan"));
assert.equal(fullPlan.plan_sha256.length, 64);

const historicalBlocked = classifySpecLifecycle({
  historical: true,
  changed_files: [
    "specs/006-example/spec.md",
    "specs/006-example/tasks.md",
    "specs/006-example/completion.json",
  ],
});
assert.equal(historicalBlocked.ok, false);
assert(historicalBlocked.blockers.includes("historical_content_must_not_use_active_specs_path"));
assert(historicalBlocked.blockers.includes("historical_content_contains_stale_delivery_artifacts"));

const historicalAccepted = classifySpecLifecycle({
  historical: true,
  changed_files: ["docs/history/example/README.md", "docs/history/example/implemented-specification.md"],
});
assert.equal(historicalAccepted.ok, true);
assert.equal(historicalAccepted.classification, "historical");
assert.equal(historicalAccepted.recommended_root, "docs/history/<topic>/");

assert.throws(
  () => buildRepositoryAutomationPlan({ automation_key: "pr_delivery", mutation_approval: { password: "do-not-accept" } }),
  (error) => error?.code === "repository_automation_secret_field_rejected"
);

let dryRunDispatchCount = 0;
const dryRun = await runRepositoryAutomation({
  automation_key: "pr_delivery",
  mode: "dry_run",
  pull_number: 2044,
  branch: "gpt/example",
}, {
  dispatch: async () => { dryRunDispatchCount += 1; return { status: 200, body: { ok: true } }; },
  persist: false,
});
assert.equal(dryRun.status, "dry_run_complete");
assert.equal(dryRun.mutations_executed, false);
assert.equal(dryRunDispatchCount, 0);

let ciRecoveryDispatchCall = null;
let ciGateReads = 0;
const ciRecovery = await executeCiAutoRecovery({
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  pull_number: 2044,
  branch: "gpt/example",
  required_checks: ["Syntax Check"],
}, async (toolKey, args) => {
  if (toolKey === "github_pr_ci_gate") {
    ciGateReads += 1;
    return { status: 200, body: { ok: true, result: { gate_status: "blocked", missing_checks: ["Syntax Check"], pending_checks: [], secrets_included: false } } };
  }
  if (toolKey === "github_rest_endpoint_dispatch") {
    ciRecoveryDispatchCall = args;
    return { status: 200, body: { ok: true, result: { status: 204, secrets_included: false } } };
  }
  throw new Error(`unexpected CI recovery tool ${toolKey}`);
}, {
  dispatch_args: {
    mutation_approval: { approved_by: "test", reason: "Regression coverage for missing check dispatch", secrets_included: false },
  },
});
assert.equal(ciRecovery.status, "dispatched_pending_readback");
assert.equal(ciGateReads, 2);
assert.equal(ciRecoveryDispatchCall.tool_args.parent_action_key, "github_api_mcp");
assert.equal(ciRecoveryDispatchCall.tool_args.endpoint_key, "github_create_workflow_dispatch");
assert.equal(ciRecoveryDispatchCall.tool_args.path_params.workflow_id, "ci.yml");
assert.equal(ciRecoveryDispatchCall.tool_args.body.ref, "gpt/example");
assert.equal(ciRecovery.secrets_included, false);

const ciRecoveryWithoutApproval = await executeCiAutoRecovery({
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  pull_number: 2044,
  branch: "gpt/example",
  required_checks: ["Syntax Check"],
}, async () => ({ status: 200, body: { ok: true, result: { gate_status: "blocked", missing_checks: ["Syntax Check"], pending_checks: [], secrets_included: false } } }), {});
assert.equal(ciRecoveryWithoutApproval.status, "awaiting_input");
assert.equal(ciRecoveryWithoutApproval.required_dispatch.tool_key, "github_rest_endpoint_dispatch");
assert.equal(ciRecoveryWithoutApproval.required_dispatch.tool_args.endpoint_key, "github_create_workflow_dispatch");

await assert.rejects(
  () => runRepositoryAutomation({
    automation_key: "spec_lifecycle",
    mode: "apply",
    historical: true,
    changed_files: ["docs/history/example/README.md"],
  }, {
    dispatch: async () => ({ status: 200, body: { ok: true } }),
    persist: false,
    resolveEnvelope: async () => ({ ok: false, status: "capability_resolution_envelope_required" }),
  }),
  (error) => error?.code === "capability_resolution_envelope_required"
);

const specApply = await runRepositoryAutomation({
  automation_key: "spec_lifecycle",
  mode: "apply",
  capability_envelope_id: "env-test",
  historical: true,
  changed_files: ["docs/history/example/README.md"],
}, {
  dispatch: async () => ({ status: 200, body: { ok: true } }),
  persist: false,
  resolveEnvelope: async () => ({
    ok: true,
    envelope_id: "env-test",
    envelope_status: "ready_for_dispatch",
    dispatch_allowed: true,
    apply_allowed: false,
    secrets_included: false,
  }),
  markEnvelopeReferenced: async () => ({ ok: true }),
});
assert.equal(specApply.ok, true);
assert.equal(specApply.status, "completed");
assert.equal(specApply.mutations_executed, false);

const branchCleanup = await runRepositoryAutomation({
  automation_key: "branch_cleanup",
  mode: "apply",
  capability_envelope_id: "env-test",
  branch: "gpt/superseded-example",
  superseding_commits: ["b".repeat(40)],
}, {
  dispatch: async (toolKey) => {
    if (toolKey === "admin_branch_reconcile") return { status: 200, body: { ok: true, result: { ok: true, classification: { classification: "ahead_only" } } } };
    if (toolKey === "github_superseded_branch_cleanup") return { status: 200, body: { ok: true, result: { ok: true, ready: true } } };
    throw new Error(`unexpected tool ${toolKey}`);
  },
  persist: false,
  resolveEnvelope: async () => ({
    ok: true,
    envelope_id: "env-test",
    envelope_status: "ready_for_dispatch",
    dispatch_allowed: true,
    apply_allowed: false,
    secrets_included: false,
  }),
  markEnvelopeReferenced: async () => ({ ok: true }),
});
assert.equal(branchCleanup.status, "awaiting_input");
assert.equal(branchCleanup.checkpoint.step_key, "cleanup_apply");
assert(branchCleanup.checkpoint.missing_required_fields.includes("capability_envelope_id"));
assert(branchCleanup.checkpoint.missing_required_fields.includes("confirm"));

const chunked = await collectChunkedToolResponse({
  status: 200,
  body: {
    ok: true,
    response_chunked: true,
    chunk_id: "chunk-test",
    chunk: "{\"ok\":",
    continuation_required: true,
    page: { next_cursor: 6, max_chars: 10, has_more: true },
  },
}, {
  dispatch: async (toolKey, args) => {
    assert.equal(toolKey, "response_chunk_read");
    assert.equal(args.chunk_id, "chunk-test");
    return {
      status: 200,
      body: {
        ok: true,
        response_chunked: true,
        chunk_id: "chunk-test",
        chunk: "true}",
        continuation_required: false,
        page: { next_cursor: null, has_more: false },
      },
    };
  },
});
assert.equal(chunked.ok, true);
assert.equal(chunked.body.ok, true);
assert.equal(chunked.chunk_collection.chunk_count, 2);
assert.equal(chunked.chunk_collection.continuation_complete, true);
assert.equal(chunked.chunk_collection.response_sha256.length, 64);

const nestedRuntimeSha = "c".repeat(40);
const hygienePool = {
  async query(sql) {
    if (sql.includes("FROM capability_resolution_envelope_ledger")) return [[]];
    if (sql.includes("FROM governed_migration_authorization_registry")) return [[]];
    if (sql.includes("FROM repository_automation_runs")) return [[]];
    if (sql.includes("FROM execution_policies")) return [[]];
    throw new Error(`unexpected hygiene query ${sql}`);
  },
};
const chunkedInventoryBody = JSON.stringify({
  ok: true,
  result: {
    body: {
      ok: true,
      data: {
        data: {
          repository: {
            defaultBranchRef: { name: "main", target: { oid: nestedRuntimeSha, committedDate: "2026-07-07T00:00:00Z" } },
            refs: { nodes: [] },
            openPullRequests: { nodes: [] },
            recentPullRequests: { nodes: [] },
          },
        },
      },
    },
  },
});
let sawInventoryChunkRead = false;
const hygiene = await scanRepositoryAutomationHygiene({
  include_github: true,
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  default_branch: "main",
}, {
  pool: hygienePool,
  dispatch: async (toolKey, args) => {
    if (toolKey === "repo_inspect") {
      return { status: 200, body: { ok: true, result: { head_sha: nestedRuntimeSha, status: "## HEAD (no branch)" } } };
    }
    if (toolKey === "response_chunk_read") {
      assert.equal(args.chunk_id, "github-inventory-chunk");
      sawInventoryChunkRead = true;
      return {
        status: 200,
        body: {
          ok: true,
          response_chunked: true,
          chunk_id: "github-inventory-chunk",
          chunk: chunkedInventoryBody.slice(args.cursor),
          continuation_required: false,
          page: { next_cursor: null, has_more: false },
        },
      };
    }
    assert.equal(toolKey, "github_rest_endpoint_dispatch");
    const dispatchArgs = args.tool_args || args;
    if (dispatchArgs.endpoint_key === "github_graphql") {
      return {
        status: 200,
        body: {
          ok: true,
          response_chunked: true,
          chunk_id: "github-inventory-chunk",
          chunk: chunkedInventoryBody.slice(0, 50),
          continuation_required: true,
          page: { next_cursor: 50, max_chars: 50, has_more: true },
        },
      };
    }
    if (dispatchArgs.endpoint_key === "github_get_reference") {
      return {
        status: 200,
        body: {
          ok: true,
          result: {
            ok: true,
            name: "runtime_endpoint_call",
            result: {
              status: 200,
              body: {
                ok: true,
                status: 200,
                data: {
                  ref: "refs/heads/main",
                  object: { sha: nestedRuntimeSha, type: "commit" },
                },
              },
            },
          },
        },
      };
    }
    throw new Error(`unexpected runtime endpoint ${dispatchArgs.endpoint_key}`);
  },
});
assert.equal(hygiene.finding_count, 0);
assert.equal(sawInventoryChunkRead, true);
assert.equal(hygiene.sources.github_inventory, true);
assert.equal(hygiene.sources.deployment_parity, true);

const routes = readFileSync(new URL("./routes/repositoryAutomationRoutes.js", import.meta.url), "utf8");
const indexRoutes = readFileSync(new URL("./routes/index.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/1034_sprint69_repository_automation_control_plane.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const openapi = readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");

for (const path of [
  "/admin/repository-automation/plan",
  "/admin/repository-automation/run",
  "/admin/repository-automation/status",
  "/admin/repository-automation/hygiene-scan",
]) assert.match(routes, new RegExp(path.replaceAll("/", "\\/")));
assert.match(indexRoutes, /buildRepositoryAutomationRoutes/);
assert.match(indexRoutes, /app\.use\(buildRepositoryAutomationRoutes/);

for (const table of [
  "repository_automation_runs",
  "repository_automation_step_runs",
  "repository_automation_receipts",
]) assert(migration.includes("CREATE TABLE IF NOT EXISTS `" + table + "`"), `missing table ${table}`);
for (const tool of [
  "repository_automation_plan",
  "repository_automation_run",
  "repository_automation_status",
  "repository_automation_hygiene_scan",
]) assert.match(migration, new RegExp(`'${tool}'`));
assert.match(migration, /repository_automation_control_plane_v1/);
assert.match(migration, /repository_automation_hygiene_schedule_v1/);
assert.match(migration, /'enabled', FALSE/);
assert.match(migration, /'scheduled_hygiene_mutation_allowed', FALSE/);
assert.match(migration, /'force_push_allowed', FALSE/);
assert.match(migration, /'auto_approval_forbidden', TRUE/);
assert.match(migration, /'inner_tool_authority_preserved', TRUE/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
assert.match(runner, /1034_sprint69_repository_automation_control_plane\.sql/);
for (const path of [
  "/admin/repository-automation/plan:",
  "/admin/repository-automation/run:",
  "/admin/repository-automation/status:",
  "/admin/repository-automation/hygiene-scan:",
]) assert.match(openapi, new RegExp(path.replaceAll("/", "\\/")));
for (const operationId of [
  "planRepositoryAutomation",
  "runRepositoryAutomation",
  "readRepositoryAutomationStatus",
  "scanRepositoryAutomationHygiene",
]) assert.match(openapi, new RegExp(`operationId: ${operationId}`));
assert.match(openapi, /x-openai-isConsequential: true[\s\S]{0,600}operationId: runRepositoryAutomation/);
assert.match(openapi, /capability_envelope_id/);
assert.match(openapi, /'202':[\s\S]{0,300}awaiting_input checkpoint/);

console.log("repository automation control plane tests passed");
