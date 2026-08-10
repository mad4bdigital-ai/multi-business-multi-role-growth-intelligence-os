import assert from "node:assert/strict";
import {
  acquireRepositoryOperationLease,
  assertRepositoryOperationLeaseHolder,
  releaseRepositoryOperationLease,
  repositoryOperationLeaseResourceKey,
} from "./repositoryOperationLeaseService.js";
import { runRepositoryReconciliationOrchestrator } from "./repositoryReconciliationOrchestrator.js";

class Pool {
  constructor() {
    this.leases = [];
    this.recipe = {
      recipe_key: "repo.pr.reconcile_and_finalize",
      resource_type: "github_pull_request",
      operation_key: "reconcile_and_finalize",
      adapter_key: "github.pull_request.reconciliation.orchestrator",
      risk_class: "mutation",
      mode: "apply",
      requires_capability_envelope: 1,
      requires_typed_confirmation: 1,
      requires_same_cycle_readback: 1,
      policy_json: "{}",
      engine_key: "repository_reconciliation_orchestrator",
      status: "planned",
    };
    this.steps = [
      {
        step_order: 10,
        step_key: "reconcile",
        step_kind: "installed_tool_call",
        tool_key: "admin_branch_reconcile",
        endpoint_key: null,
        required: 1,
        on_error_policy: "fail",
        status: "active",
      },
    ];
  }

  async getConnection() { return this; }
  async beginTransaction() {}
  async commit() {}
  async rollback() {}
  release() {}

  findLeaseById(leaseId) {
    return this.leases.find((row) => row.lease_id === leaseId) || null;
  }

  activeLeaseByResource(resourceKey) {
    return this.leases.find((row) => row.resource_key === resourceKey && row.status === "active") || null;
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("UPDATE repository_operation_leases") && q.includes("resource_key=?") && q.includes("expires_at<=CURRENT_TIMESTAMP")) {
      return [{ affectedRows: 0 }];
    }
    if (q.startsWith("UPDATE repository_operation_leases") && q.includes("lease_id=?") && q.includes("expires_at<=CURRENT_TIMESTAMP")) {
      return [{ affectedRows: 0 }];
    }
    if (q.startsWith("SELECT lease_id") && q.includes("FROM repository_operation_leases") && q.includes("WHERE resource_key=?")) {
      return [[this.activeLeaseByResource(params[0])].filter(Boolean)];
    }
    if (q.startsWith("INSERT INTO repository_operation_leases")) {
      const [lease_id, repository_owner, repository_name, branch_name, resource_key, operation_key,
        operation_fingerprint, resource_fingerprint, holder_run_id, holder_actor_type, holder_actor_id,
        lease_mode, ttl_seconds] = params;
      if (this.activeLeaseByResource(resource_key)) {
        const error = new Error("duplicate lease");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      this.leases.push({
        lease_id, repository_owner, repository_name, branch_name, resource_key, operation_key,
        operation_fingerprint, resource_fingerprint, holder_run_id, holder_actor_type, holder_actor_id,
        lease_mode, status: "active", acquired_at: "2026-06-30T12:00:00Z",
        renewed_at: "2026-06-30T12:00:00Z",
        expires_at: new Date(Date.now() + Number(ttl_seconds || 900) * 1000).toISOString(),
        released_at: null, release_reason: null,
      });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("SELECT lease_id") && q.includes("FROM repository_operation_leases") && q.includes("WHERE lease_id=?")) {
      const row = this.findLeaseById(params[0]);
      if (q.includes("status='active'") && (!row || row.status !== "active")) return [[]];
      return [[row].filter(Boolean)];
    }
    if (q.startsWith("UPDATE repository_operation_leases") && q.includes("renewed_at=CURRENT_TIMESTAMP")) {
      const row = this.findLeaseById(params[1]);
      if (row && row.status === "active") row.renewed_at = "2026-06-30T12:00:01Z";
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (q.startsWith("UPDATE repository_operation_leases") && q.includes("status='released'")) {
      const row = this.findLeaseById(params[1]);
      if (row && row.status === "active") {
        row.status = "released";
        row.released_at = "2026-06-30T12:00:02Z";
        row.release_reason = params[0];
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (q.includes("FROM platform_resource_recipes")) return [[this.recipe]];
    if (q.includes("FROM platform_resource_recipe_steps")) return [this.steps];
    throw new Error(`Unexpected SQL in test fake pool: ${q.slice(0, 180)}`);
  }
}

const pool = new Pool();
const lease = {
  repository_owner: "o",
  repository_name: "r",
  branch_name: "gpt/test",
  operation_key: "recipe",
  operation_fingerprint: "a".repeat(64),
  holder_run_id: "run-1",
};

assert.equal(repositoryOperationLeaseResourceKey(lease), "github://o/r/branch/gpt/test");
await assert.rejects(
  () => acquireRepositoryOperationLease({ ...lease, branch_name: "main" }, { pool }),
  (error) => error.code === "repository_operation_lease_protected_branch",
);

const acquired = await acquireRepositoryOperationLease(lease, { pool, uuid: () => "lease-1" });
assert.equal(acquired.lease.lease_id, "lease-1");
assert.equal(acquired.reused, false);
const reused = await acquireRepositoryOperationLease(lease, { pool, uuid: () => "lease-2" });
assert.equal(reused.reused, true);
const verified = await assertRepositoryOperationLeaseHolder(
  { lease_id: "lease-1", holder_run_id: "run-1", resource_fingerprint: acquired.lease.resource_fingerprint },
  { pool },
);
assert.equal(verified.lease.holder_run_id, "run-1");
await assert.rejects(
  () => acquireRepositoryOperationLease({ ...lease, holder_run_id: "run-2" }, { pool, uuid: () => "lease-3" }),
  (error) => error.code === "repository_operation_lease_conflict",
);
const released = await releaseRepositoryOperationLease(
  { lease_id: "lease-1", holder_run_id: "run-1", resource_fingerprint: acquired.lease.resource_fingerprint },
  { pool },
);
assert.equal(released.lease.status, "released");

const args = {
  owner: "o",
  repo: "r",
  branch: "gpt/test",
  pull_number: 1980,
  expected_base_sha: "b".repeat(40),
  expected_branch_sha: "c".repeat(40),
  mode: "dry_run",
  operation_id: "operation-1",
};
const reconcileBranch = async () => ({
  classification: {
    classification: "diverged_same_files",
    ahead_by: 1,
    behind_by: 2,
    overlapping_files: ["a.js"],
  },
  evidence: {
    base_ref_sha: "b".repeat(40),
    branch_ref_sha: "c".repeat(40),
  },
});
const result = await runRepositoryReconciliationOrchestrator(args, { pool, reconcileBranch });
assert.equal(result.ok, true);
assert.equal(result.apply_allowed, false);
assert.equal(result.plan.plan.force_push_allowed, false);
assert.equal(result.plan.plan.migration_apply_allowed, false);

await assert.rejects(
  () => runRepositoryReconciliationOrchestrator({
    ...args,
    mode: "apply",
    plan_id: result.plan.plan_id,
    plan_sha256: result.plan.plan_sha256,
    capability_envelope_id: "e",
    approval_hold_id: "h",
  }, { pool, reconcileBranch }),
  (error) => error.code === "repository_reconciliation_recipe_not_active",
);

console.log("repository reconciliation lease and orchestrator tests passed");
