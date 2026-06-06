import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";
import { resolveRuntimeWorkflow } from "./runtimeWorkflowResolver.js";

function poolWith(rows) {
  return {
    state: { queries: [] },
    async query(sql, params) {
      this.state.queries.push({ sql: String(sql), params });
      return [rows];
    },
  };
}

{
  const pool = poolWith([{
    workflow_id: "wf.unique",
    workflow_key: "workflow.shared",
    active: "TRUE",
  }]);
  const result = await resolveRuntimeWorkflow({ pool, workflow_key: "workflow.shared" });
  assert.equal(result.ok, true);
  assert.equal(result.workflow.workflow_id, "wf.unique");
  assert.equal(result.resolution.matched_by, "workflow_key");
  assert.match(pool.state.queries[0].sql, /LIMIT 2/);
}

{
  const pool = poolWith([{
    workflow_id: "wf.explicit",
    workflow_key: "workflow.shared",
    active: "TRUE",
  }]);
  const result = await resolveRuntimeWorkflow({
    pool,
    workflow_id: "wf.explicit",
    workflow_key: "workflow.shared",
  });
  assert.equal(result.ok, true);
  assert.equal(result.resolution.matched_by, "workflow_id");
  assert.deepEqual(pool.state.queries[0].params, ["wf.explicit"]);
}

{
  const result = await resolveRuntimeWorkflow({
    pool: poolWith([
      { workflow_id: "wf.variant.a", workflow_key: "workflow.shared", active: "TRUE" },
      { workflow_id: "wf.variant.b", workflow_key: "workflow.shared", active: "TRUE" },
    ]),
    workflow_key: "workflow.shared",
  });
  assert.equal(result.ok, false);
  assert.equal(result.resolution.code, "workflow_ambiguous");
  assert.equal(result.resolution.candidate_count, 2);
}

{
  const result = await resolveRuntimeWorkflow({
    pool: poolWith([]),
    workflow_key: "workflow.missing",
  });
  assert.equal(result.ok, false);
  assert.equal(result.resolution.code, "workflow_not_found");
}

for (const path of [
  "agentLoopRunner.js",
  "connectorExecutor.js",
  "chainEventDispatcher.js",
  "outputSinkRouter.js",
  "services/governanceValidationEngine.js",
]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /FROM\s+`workflows`[\s\S]{0,240}workflow_key\s*=\s*\?[\s\S]{0,240}LIMIT\s+1/i,
    `${path} must not select an arbitrary workflow_key row`
  );
}

for (const path of [
  "connectorExecutor.js",
  "outputSinkRouter.js",
]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(
    source,
    /resolution\.code !== "workflow_identity_missing"/,
    `${path} must block unresolved supplied workflow identities`
  );
}

for (const path of [
  "routes/plannerRoutes.js",
  "routes/connectorRoutes.js",
  "chainEventDispatcher.js",
  "governedExecutionPreflight.js",
]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source, /workflow_id/, `${path} must persist explicit workflow identity`);
}

{
  const migration = readFileSync(
    new URL("migrations/206_sprint67_deterministic_workflow_execution_identity.sql", import.meta.url),
    "utf8"
  );
  const backfillMigration = readFileSync(
    new URL("migrations/209_sprint67_execution_plan_workflow_identity_backfill.sql", import.meta.url),
    "utf8"
  );
  const runner = readFileSync(
    new URL("scripts/governed-migration-runner.mjs", import.meta.url),
    "utf8"
  );
  const readback = readFileSync(
    new URL("scripts/workflow-execution-identity-readback.mjs", import.meta.url),
    "utf8"
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS `workflow_id`/);
  assert.match(migration, /idx_execution_plans_workflow_id/);
  assert.match(
    runner,
    /206_sprint67_deterministic_workflow_execution_identity\.sql/,
    "migration 206 must be allowlisted for the governed runner"
  );
  assert.match(
    runner,
    /209_sprint67_execution_plan_workflow_identity_backfill\.sql/,
    "migration 209 must be allowlisted for the governed runner"
  );
  assert.match(backfillMigration, /HAVING COUNT\(\*\) = 1/, "backfill must resolve only unique workflow keys");
  assert.match(
    backfillMigration,
    /SUM\(workflow_id IS NOT NULL AND workflow_id <> ''\) = 1/,
    "backfill unique-candidate counting must also require that candidate to have an exact workflow_id"
  );
  assert.match(backfillMigration, /ep\.workflow_id IS NULL OR ep\.workflow_id = ''/, "backfill must not overwrite explicit workflow identities");
  assert.match(backfillMigration, /COLLATE utf8mb4_unicode_ci/, "backfill must handle the live workflow-key collation difference explicitly");
  assert.doesNotMatch(backfillMigration, /\b(?:DELETE|DROP|TRUNCATE)\b/i, "backfill must not contain destructive SQL");
  const backfillPreflight = assessMigrationSqlPreflight("209_sprint67_execution_plan_workflow_identity_backfill.sql", backfillMigration);
  assert.equal(backfillPreflight.status, "pass", "migration 209 must pass governed SQL preflight");
  assert.equal(backfillPreflight.counts.update, 1, "migration 209 must contain one UPDATE");
  assert.equal(backfillPreflight.counts.update_guarded, 1, "migration 209 UPDATE must have a top-level WHERE guard");
  assert.match(readback, /information_schema\.columns/);
  assert.match(readback, /information_schema\.statistics/);
  assert.match(readback, /uniquely_resolvable_fallback_plans/);
  assert.match(readback, /identity_missing_fallback_plans/);
  assert.match(readback, /unresolved_fallback_plans/);
  assert.match(readback, /identityless_plans/);
  assert.match(readback, /ACTIVE_WORKFLOW_SQL/, "readback must reuse the runtime active-workflow predicate");
  assert.match(readback, /resolveRuntimeWorkflow/);
  assert.match(readback, /secrets_included:\s*false/);
}

console.log("runtime workflow resolver tests passed");
