import assert from "node:assert/strict";
import { buildTenantConflictReadinessReport } from "./repoConflictIntelligenceService.js";

const registryRows = [
  {
    tool_key: "tenant_repo_conflict_intelligence_analyze",
    is_enabled: 1,
    http_method: "POST",
    http_path: "/me/repo-conflict-intelligence/analyze",
    tags: "repo_conflict_intelligence,tenant,read_only,request_only,no_provider_write,no_git_mutation,no_secrets",
  },
  {
    tool_key: "tenant_repo_conflict_intelligence_plan",
    is_enabled: 1,
    http_method: "POST",
    http_path: "/me/repo-conflict-intelligence/plan",
    tags: "repo_conflict_intelligence,tenant,planner,read_only,preview_only,request_only,no_provider_write,no_git_mutation,no_secrets",
  },
  {
    tool_key: "tenant_repo_conflict_intelligence_resolve_dry_run",
    is_enabled: 1,
    http_method: "POST",
    http_path: "/me/repo-conflict-intelligence/resolve-dry-run",
    tags: "repo_conflict_intelligence,tenant,dry_run,read_only,preview_only,request_only,no_provider_write,no_git_mutation,no_secrets",
  },
];

const report = buildTenantConflictReadinessReport({ registry_rows: registryRows });
assert.equal(report.ok, true);
assert.equal(report.status, "authorization_gated");
assert.equal(report.logic_readiness, "ready");
assert.equal(report.registry_readiness, "ready");
assert.equal(report.transport_auth.status, "authorization_gated");
assert.equal(report.transport_auth.live_user_jwt_tested, false);
assert.equal(report.transport_auth.auth_bypass_attempted, false);
assert.equal(report.checks.registry_complete, true);
assert.equal(report.checks.registry_enabled, true);
assert.equal(report.checks.registry_request_only, true);
assert.equal(report.checks.registry_no_secrets, true);
assert.equal(report.checks.registry_no_provider_write, true);
assert.equal(report.checks.registry_no_git_mutation, true);
assert.equal(report.checks.tenant_scope_preserved, true);
assert.equal(report.checks.execution_disabled, true);
assert.equal(report.checks.provider_write_disabled, true);
assert.equal(report.checks.secrets_excluded, true);
assert.equal(report.checks.no_cross_tenant_metadata, true);
assert.equal(report.execution_allowed, false);
assert.equal(report.provider_write, false);
assert.equal(report.secrets_included, false);

const degraded = buildTenantConflictReadinessReport({ registry_rows: registryRows.slice(0, 2) });
assert.equal(degraded.status, "degraded");
assert.equal(degraded.registry_readiness, "degraded");
assert.equal(degraded.checks.registry_complete, false);

console.log("repo conflict intelligence tenant readiness tests passed");
