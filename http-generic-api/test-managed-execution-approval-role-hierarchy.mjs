import assert from "node:assert/strict";
import { assertManagedExecutionApprovalAuthority } from "./managedExecutionLifecycleService.js";

function connection(role) {
  return {
    async query(sql, params) {
      assert(sql.includes("FROM memberships"));
      assert.deepEqual(params, ["tenant-1", "reviewer-1"]);
      return [[{ user_id: "reviewer-1", role, status: "active" }]];
    },
  };
}

await assert.doesNotReject(
  assertManagedExecutionApprovalAuthority({
    connection: connection("supervisor"),
    hold: { tenant_id: "tenant-1", required_role: "certified_reviewer" },
    decisionBy: "reviewer-1",
  }),
);
await assert.doesNotReject(
  assertManagedExecutionApprovalAuthority({
    connection: connection("supervisor"),
    hold: { tenant_id: "tenant-1", required_role: "managed_operator" },
    decisionBy: "reviewer-1",
  }),
);
await assert.rejects(
  assertManagedExecutionApprovalAuthority({
    connection: connection("certified_reviewer"),
    hold: { tenant_id: "tenant-1", required_role: "supervisor" },
    decisionBy: "reviewer-1",
  }),
  (error) => error.code === "managed_execution_approval_role_required",
);

console.log("managed execution approval role hierarchy tests passed");
