import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertCloseSupersededEvidenceV6,
} from "./repositoryGovernanceV6.js";
import {
  repositoryCloseSupersededSmokeConfirmation,
  runRepositoryCloseSupersededPositiveSmokeV6,
} from "./repositoryCloseSupersededPositiveSmoke.js";

const MAIN_SHA = "a".repeat(40);
const PARENT_SHA = "b".repeat(40);
const CONFIRM = repositoryCloseSupersededSmokeConfirmation(MAIN_SHA);

assert.equal(CONFIRM, "RUN_CLOSE_SUPERSEDED_SMOKE_AAAAAAAAAAAA");
assert.deepEqual(
  assertCloseSupersededEvidenceV6({
    plannedHeadSha: MAIN_SHA,
    analysis: {
      head_sha: MAIN_SHA,
      classification_v6: "superseded_by_main",
      confidence_v6: 0.99,
      main_equivalence: { exact: true, complete: true },
    },
  }),
  {
    ok: true,
    head_sha: MAIN_SHA,
    classification: "superseded_by_main",
    confidence: 0.99,
    exact_main_equivalence: true,
    complete_equivalence_evidence: true,
    secrets_included: false,
  }
);
assert.throws(
  () => assertCloseSupersededEvidenceV6({ plannedHeadSha: MAIN_SHA, analysis: { head_sha: MAIN_SHA, classification_v6: "manual_review_required", confidence_v6: 0.99, main_equivalence: { exact: true, complete: true } } }),
  (error) => error?.code === "repository_close_superseded_evidence_failed"
);

const calls = [];
let prState = "open";
const requestImpl = async ({ apiPath, method = "GET", body }) => {
  calls.push({ apiPath, method, body });
  if (apiPath === "/git/ref/heads/main" && method === "GET") return { status: 200, payload: { object: { sha: MAIN_SHA } } };
  if (apiPath === `/git/commits/${MAIN_SHA}` && method === "GET") return { status: 200, payload: { parents: [{ sha: PARENT_SHA }] } };
  if (apiPath === "/git/refs" && method === "POST") return { status: 201, payload: { ref: body.ref, object: { sha: body.sha } } };
  if (apiPath === "/pulls" && method === "POST") return { status: 201, payload: { number: 9123, html_url: "https://example.invalid/pr/9123", state: "open", head: { sha: MAIN_SHA } } };
  if (apiPath === "/pulls/9123" && method === "PATCH") { prState = "closed"; return { status: 200, payload: { number: 9123, state: "closed", head: { sha: MAIN_SHA } } }; }
  if (apiPath === "/pulls/9123" && method === "GET") return { status: 200, payload: { number: 9123, state: prState, head: { sha: MAIN_SHA } } };
  if (apiPath.startsWith("/git/refs/heads/") && method === "DELETE") return { status: 204, payload: {} };
  throw new Error(`Unexpected request: ${method} ${apiPath}`);
};

let auditPayload = null;
const result = await runRepositoryCloseSupersededPositiveSmokeV6({
  owner: "example-owner",
  repo: "example-repo",
  default_branch: "main",
  expected_main_sha: MAIN_SHA,
  confirm: CONFIRM,
  smoke_id: "deterministic-test",
  capability_envelope_id: "11111111-2222-4333-8444-555555555555",
}, {
  token: "test-token",
  requestImpl,
  reanalyzeImpl: async () => ({
    analysis: {
      head_sha: MAIN_SHA,
      classification_v6: "superseded_by_main",
      confidence_v6: 0.99,
      main_equivalence: { exact: true, complete: true, files: [{ path: "file.js", equal: true }] },
    },
  }),
  auditImpl: async (payload) => { auditPayload = payload; },
});

assert.equal(result.ok, true);
assert.equal(result.status, "completed");
assert.equal(result.setup.pr_number, 9123);
assert.equal(result.evidence.classification, "superseded_by_main");
assert.equal(result.verification.ok, true);
assert.equal(result.cleanup.ok, true);
assert.equal(result.cleanup.head_ref.deleted, true);
assert.equal(result.cleanup.base_ref.deleted, true);
assert.equal(result.production_recipe_activated, false);
assert.equal(result.production_apply_authority_changed, false);
assert.equal(auditPayload.payload.secrets_included, false);
assert.equal(calls.filter((call) => call.method === "DELETE").length, 2);

await assert.rejects(
  () => runRepositoryCloseSupersededPositiveSmokeV6({
    owner: "example-owner",
    repo: "example-repo",
    default_branch: "main",
    expected_main_sha: MAIN_SHA,
    confirm: CONFIRM,
    smoke_id: "stale-main-test",
  }, {
    token: "test-token",
    requestImpl: async ({ apiPath, method = "GET" }) => {
      if (apiPath === "/git/ref/heads/main") return { status: 200, payload: { object: { sha: "c".repeat(40) } } };
      if (apiPath.startsWith("/git/refs/heads/") && method === "DELETE") return { status: 404, payload: {} };
      throw new Error(`Unexpected stale-main request: ${method} ${apiPath}`);
    },
    auditImpl: async () => {},
  }),
  (error) => error?.code === "repository_close_superseded_smoke_main_moved"
);

const routes = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/1022_sprint69_repository_close_superseded_positive_smoke_policy.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
const manifest = readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");

for (const token of [
  "repository_close_superseded_positive_smoke",
  "runRepositoryCloseSupersededPositiveSmokeV6",
  "requireRepositoryCloseSupersededPositiveSmokeEnvelope",
  "expected_main_sha",
  "capability_envelope_id",
]) assert.match(routes, new RegExp(token));
for (const token of [
  "repository_close_superseded_positive_smoke_policy_v1",
  "same_production_evidence_predicate",
  "production_recipe_activation', FALSE",
  "production_apply_authority_change', FALSE",
  "secrets_included', FALSE",
]) assert.match(migration, new RegExp(token));
assert.match(runner, /1022_sprint69_repository_close_superseded_positive_smoke_policy\.sql/);
assert.match(readiness, /1022_sprint69_repository_close_superseded_positive_smoke_policy\.sql/);
assert.match(manifest, /test-repository-close-superseded-positive-smoke\.mjs/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

console.log("repository close-superseded positive smoke tests passed");
