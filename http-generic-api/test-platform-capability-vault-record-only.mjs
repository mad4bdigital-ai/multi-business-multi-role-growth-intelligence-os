import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recordRepoIngestionPlan } from "./platformCapabilityVaultRecordOnly.js";

function createFakeDb() {
  const state = {
    sourcesByFullName: new Map(),
    sourcesById: new Map(),
    resolutions: new Map(),
    candidates: new Map(),
    jobs: new Map(),
    queries: [],
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    releaseCount: 0,
  };

  const connection = {
    async beginTransaction() { state.beginCount += 1; },
    async commit() { state.commitCount += 1; },
    async rollback() { state.rollbackCount += 1; },
    release() { state.releaseCount += 1; },
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      state.queries.push({ sql: normalized, params });

      if (normalized.startsWith("SELECT repo_source_id FROM repo_source_registry WHERE full_name")) {
        const source = state.sourcesByFullName.get(params[0]);
        return [[source ? { repo_source_id: source.repo_source_id } : undefined].filter(Boolean)];
      }
      if (normalized.startsWith("INSERT INTO repo_source_registry")) {
        const source = {
          repo_source_id: params[0],
          owner: params[1],
          repo: params[2],
          full_name: params[3],
          html_url: params[4],
          default_branch: params[5],
          pinned_commit_sha: params[6],
          license_spdx: params[7],
          description: params[8],
          source_status: "discovered",
          risk_class: params[9],
        };
        const existing = state.sourcesByFullName.get(source.full_name);
        if (existing) source.repo_source_id = existing.repo_source_id;
        state.sourcesByFullName.set(source.full_name, source);
        state.sourcesById.set(source.repo_source_id, source);
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("INSERT INTO platform_capability_source_resolutions")) {
        state.resolutions.set(params[0], {
          resolution_id: params[0],
          source_type: "github_repo",
          source_ref: params[1],
          read_strategy: "pinned_repo_tree_record_only",
          status: "planned",
          resolution_json: JSON.parse(params[2]),
        });
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("INSERT INTO repo_capability_candidates")) {
        state.candidates.set(params[0], {
          capability_candidate_id: params[0],
          repo_source_id: params[1],
          candidate_type: params[2],
          capability_key_suggested: params[3],
          runtime_language: params[4],
          install_method_detected: params[5],
          requires_code_execution: params[6],
          risk_class: params[7],
          status: "candidate",
        });
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("INSERT INTO repo_ingestion_jobs")) {
        state.jobs.set(params[0], {
          job_id: params[0],
          repo_source_id: params[1],
          source_repo_full_name: params[2],
          requested_by: params[3],
          ingestion_mode: "preview",
          status: "succeeded",
          result_json: JSON.parse(params[4]),
        });
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("SELECT repo_source_id, full_name")) {
        const row = state.sourcesById.get(params[0]);
        return [[row].filter(Boolean)];
      }
      if (normalized.startsWith("SELECT resolution_id, source_type")) {
        const row = state.resolutions.get(params[0]);
        return [[row].filter(Boolean)];
      }
      if (normalized.startsWith("SELECT capability_candidate_id, repo_source_id")) {
        const row = state.candidates.get(params[0]);
        return [[row].filter(Boolean)];
      }
      if (normalized.startsWith("SELECT job_id, repo_source_id")) {
        const row = state.jobs.get(params[0]);
        return [[row].filter(Boolean)];
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };

  return {
    state,
    pool: { async getConnection() { return connection; } },
  };
}

const input = {
  source_repo_full_name: "mad4bdigital-ai/seo-geo-claude-skills",
  source_commit_sha: "b69ebc6123456789abcdef0123456789abcdef01",
  default_branch: "main",
  license_spdx: "Apache-2.0",
  description: "20 SEO and GEO skills",
  confirm_record_only: true,
  files: [
    { path: "research/keyword-research/SKILL.md", size_bytes: 7448 },
    { path: "references/skill-contract.md", size_bytes: 16166 },
    { path: "hooks/claude-hook.sh", size_bytes: 6939, executable: true },
  ],
};

const fake = createFakeDb();
const auditCalls = [];
const writeAuditLog = async (payload) => {
  auditCalls.push(payload);
  return `audit-${auditCalls.length}`;
};
const deps = {
  pool: fake.pool,
  writeAuditLog,
  principal: { tenant_id: "tenant-1", user_id: "admin-1", mode: "user_jwt" },
};

const first = await recordRepoIngestionPlan(input, deps);
assert.equal(first.ok, true);
assert.equal(first.mode, "record_only");
assert.equal(first.will_execute, false);
assert.equal(first.will_install, false);
assert.equal(first.secrets_included, false);
assert.equal(first.readback.verified, true);
assert.equal(first.readback.resolution.status, "planned");
assert.equal(first.readback.candidate.status, "candidate");
assert.equal(first.readback.job.ingestion_mode, "preview");
assert.equal(fake.state.beginCount, 1);
assert.equal(fake.state.commitCount, 1);
assert.equal(fake.state.rollbackCount, 0);
assert.equal(fake.state.releaseCount, 1);
assert.equal(fake.state.sourcesById.size, 1);
assert.equal(fake.state.resolutions.size, 1);
assert.equal(fake.state.candidates.size, 1);
assert.equal(fake.state.jobs.size, 1);
assert.deepEqual(auditCalls.map((item) => item.action), [
  "platform_capability_vault_repo_ingestion_record_intent",
  "platform_capability_vault_repo_ingestion_record_completed",
]);
assert.equal(auditCalls[0].actor_id, "admin-1");
assert.equal(auditCalls[1].after_json.readback_verified, true);

const second = await recordRepoIngestionPlan(input, deps);
assert.equal(second.source_id, first.source_id);
assert.equal(second.resolution_id, first.resolution_id);
assert.equal(second.candidate_id, first.candidate_id);
assert.equal(second.job_id, first.job_id);
assert.equal(fake.state.sourcesById.size, 1);
assert.equal(fake.state.resolutions.size, 1);
assert.equal(fake.state.candidates.size, 1);
assert.equal(fake.state.jobs.size, 1);
assert.equal(fake.state.commitCount, 2);

await assert.rejects(
  () => recordRepoIngestionPlan({ ...input, confirm_record_only: false }, deps),
  (error) => error.code === "platform_capability_vault_record_confirmation_required" && error.status === 400
);
const auditCountBeforeUnknownField = auditCalls.length;
const queryCountBeforeUnknownField = fake.state.queries.length;
await assert.rejects(
  () => recordRepoIngestionPlan({ ...input, token: "super-secret-must-not-be-persisted" }, deps),
  (error) => error.code === "platform_capability_vault_unknown_fields" && error.status === 400
);
assert.equal(auditCalls.length, auditCountBeforeUnknownField, "unknown fields must be rejected before audit/write side effects");
assert.equal(fake.state.queries.length, queryCountBeforeUnknownField, "unknown fields must be rejected before DB access");
await assert.rejects(
  () => recordRepoIngestionPlan({ ...input, source_commit_sha: "not-a-sha" }, deps),
  (error) => error.code === "platform_capability_vault_commit_sha_invalid" && error.status === 400
);
await assert.rejects(
  () => recordRepoIngestionPlan({ ...input, description: "malware exploit payload" }, deps),
  (error) => error.code === "platform_capability_vault_record_plan_blocked" && error.status === 422
);

const migration313 = readFileSync(new URL("./migrations/314_sprint69_capability_authority_evidence_projection.sql", import.meta.url), "utf8");
assert.match(migration313, /CREATE OR REPLACE VIEW `v_platform_capability_authority_evidence`/);
assert.match(migration313, /CREATE OR REPLACE VIEW `v_platform_capabilities_effective_evidence`/);
assert.match(migration313, /platform_tool_dispatch_bindings/);
assert.match(migration313, /readback_policy_key/);
assert.match(migration313, /status = 'active'/);
assert.match(migration313, /COALESCE\(c\.evidence_ref, e\.evidence_ref\)/);
assert.doesNotMatch(migration313, /^\s*(DELETE|DROP|TRUNCATE|ALTER)\b/mi);
assert.doesNotMatch(migration313, /INSERT INTO platform_tool_dispatch_bindings/i);

const routes = readFileSync(new URL("./routes/platformPrivateCapabilityVaultRoutes.js", import.meta.url), "utf8");
const openapi = readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const docs = readFileSync(new URL("../docs/platform-private-capability-vault.md", import.meta.url), "utf8");
assert.match(routes, /repo-ingestion-record/);
assert.match(routes, /req\.auth\?\.user_id/);
assert.match(routes, /recordRepoIngestionPlan/);
assert.match(openapi, /\/platform\/capability-vault\/repo-ingestion-record:/);
assert.match(openapi, /operationId: platformCapabilityVaultRepoIngestionRecord/);
assert.match(openapi, /x-openai-isConsequential: true/);
assert.match(openapi, /const: true/);
assert.match(docs, /Record-only ingestion/);

console.log("platform capability vault record-only tests passed");
