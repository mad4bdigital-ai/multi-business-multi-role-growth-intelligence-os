import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AUTHORITY_SCOPE_SHADOW_READINESS_CODES,
  evaluateAuthorityScopeShadowReadiness
} from "./src/application/authorityScope/authorityScopeShadowReadinessService.js";
import {
  createAuthorityScopeShadowReadinessRepository
} from "./src/infrastructure/authorityScope/authorityScopeShadowReadinessRepository.js";

const policy = Object.freeze({
  minimumSampleCount:100,
  mismatchThresholdPercent:0.5
});

const insufficient = evaluateAuthorityScopeShadowReadiness({
  policy,
  summary:{ sampleCount:99,matchCount:99,mismatchCount:0,unresolvedCount:0 }
});
assert.equal(insufficient.readinessCode, AUTHORITY_SCOPE_SHADOW_READINESS_CODES.INSUFFICIENT_SAMPLES);
assert.equal(insufficient.readyForReview, false);

const unresolved = evaluateAuthorityScopeShadowReadiness({
  policy,
  summary:{ sampleCount:100,matchCount:99,mismatchCount:0,unresolvedCount:1 }
});
assert.equal(unresolved.readinessCode, AUTHORITY_SCOPE_SHADOW_READINESS_CODES.UNRESOLVED_PRESENT);

const mismatch = evaluateAuthorityScopeShadowReadiness({
  policy,
  summary:{ sampleCount:100,matchCount:99,mismatchCount:1,unresolvedCount:0 }
});
assert.equal(mismatch.readinessCode, AUTHORITY_SCOPE_SHADOW_READINESS_CODES.MISMATCH_THRESHOLD_EXCEEDED);
assert.equal(mismatch.evidence.mismatchPercent, 1);

const ready = evaluateAuthorityScopeShadowReadiness({
  policy,
  summary:{ sampleCount:100,matchCount:100,mismatchCount:0,unresolvedCount:0 }
});
assert.equal(ready.readinessCode, AUTHORITY_SCOPE_SHADOW_READINESS_CODES.READY_FOR_REVIEW);
assert.equal(ready.readyForReview, true);
assert.equal(ready.enforcementRequested, false);
assert.equal(ready.promotionRequested, false);
assert.equal(ready.authorityGranted, false);
assert.equal(ready.providerCalls, false);
assert.equal(ready.credentialPayloadReads, false);
assert.equal(ready.externalWrites, false);
assert.equal(ready.secretsIncluded, false);

const preservedBaseBlocker = evaluateAuthorityScopeShadowReadiness({
  policy,
  baseReadinessCode:"p95_latency_budget_exceeded",
  summary:{ sampleCount:100,matchCount:0,mismatchCount:100,unresolvedCount:10 }
});
assert.equal(preservedBaseBlocker.readinessCode, "p95_latency_budget_exceeded");
assert.equal(preservedBaseBlocker.readyForReview, false);

assert.throws(
  () => evaluateAuthorityScopeShadowReadiness({ summary:{} }),
  error => error.code === "authority_scope_readiness_policy_required" && error.status === 422
);

const executions = [];
const repository = createAuthorityScopeShadowReadinessRepository({
  resolvePool:async () => ({
    execute:async (sql, params = []) => {
      executions.push({ sql,params });
      if (sql.includes("v_authority_scope_shadow_summary")) {
        return [[{
          sample_count:120,
          match_count:120,
          mismatch_count:0,
          unresolved_count:0,
          comparable_sample_count:120,
          mismatch_percent:0,
          last_observed_at:"2026-06-29T00:00:00.000Z",
          secrets_included:0
        }]];
      }
      return [[{
        policy_key:"dynamic_container_authority_v1",
        rollout_mode:"shadow",
        base_readiness_code:"ready_for_review",
        readiness_code:"ready_for_review",
        authority_scope_sample_count:120,
        authority_scope_match_count:120,
        authority_scope_mismatch_count:0,
        authority_scope_unresolved_count:0,
        authority_scope_comparable_sample_count:120,
        authority_scope_mismatch_percent:0,
        authority_scope_last_observed_at:"2026-06-29T00:00:00.000Z",
        enforcement_requested:0,
        secrets_included:0
      }]];
    }
  })
});

const summary = await repository.readSummary();
assert.equal(summary.sampleCount, 120);
assert.equal(summary.matchCount, 120);
assert.equal(summary.secretsIncluded, false);

const combined = await repository.readCombinedReadiness("dynamic_container_authority_v1");
assert.equal(combined.policyKey, "dynamic_container_authority_v1");
assert.equal(combined.readinessCode, "ready_for_review");
assert.equal(combined.authorityScope.sampleCount, 120);
assert.equal(combined.secretsIncluded, false);

assert.equal(executions.length, 2);
for (const execution of executions) {
  assert.match(execution.sql.trim(), /^SELECT /);
  assert.equal(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(execution.sql), false);
}
assert.equal(executions[1].sql.includes("dynamic_container_authority_v1"), false);
assert.deepEqual(executions[1].params, ["dynamic_container_authority_v1"]);

const migration = await readFile(
  new URL("./migrations/20260629_authority_scope_shadow_readiness.sql", import.meta.url),
  "utf8"
);
assert.match(migration, /CREATE OR REPLACE VIEW `v_authority_scope_shadow_summary`/);
assert.match(migration, /CREATE OR REPLACE VIEW `v_container_rollout_readiness_v2`/);
assert.match(migration, /authority_scope_unresolved_present/);
assert.match(migration, /authority_scope_mismatch_threshold_exceeded/);
assert.equal(/CREATE OR REPLACE VIEW `v_container_rollout_readiness`\s+AS/i.test(migration), false);
assert.equal(/\b(INSERT INTO|UPDATE |DELETE FROM|ALTER TABLE|DROP TABLE)\b/i.test(migration), false);

const applicationSource = await readFile(
  new URL("./src/application/authorityScope/authorityScopeShadowReadinessService.js", import.meta.url),
  "utf8"
);
assert.equal(/\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(applicationSource), false);
assert.equal(applicationSource.includes("db.js"), false);

const repositorySource = await readFile(
  new URL("./src/infrastructure/authorityScope/authorityScopeShadowReadinessRepository.js", import.meta.url),
  "utf8"
);
assert.match(repositorySource, /FROM v_authority_scope_shadow_summary/);
assert.match(repositorySource, /FROM v_container_rollout_readiness_v2/);
assert.equal(/\b(INSERT|UPDATE|DELETE)\b/i.test(repositorySource), false);

console.log("authority scope shadow readiness tests passed");
