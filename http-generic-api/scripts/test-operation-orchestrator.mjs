import assert from "node:assert/strict";
import "./test-operation-run-ownership.mjs";
import "./test-operation-runtime-guard.mjs";
import {
  getOperationContract,
  listOperationContracts,
  normalizeOperationKey,
  validateOperationInput,
} from "../operationContractRegistry.js";
import { _testingOperationContextService } from "../operationContextService.js";
import { _testingOperationOrchestrator } from "../operationOrchestrator.js";

assert.equal(normalizeOperationKey("repo_change_execute"), "repo.change.execute");
assert.equal(normalizeOperationKey("sync branch with main"), "repo.branch.reconcile");
assert.equal(getOperationContract("ci_diagnose").execution_class, "read_only");

const tenantContracts = listOperationContracts({ principalScope: "tenant" });
assert.ok(tenantContracts.some((item) => item.operation_key === "repo.change.preview"));
assert.ok(tenantContracts.every((item) => item.principal_scopes.includes("tenant")));

assert.throws(
  () => validateOperationInput(getOperationContract("repo.change.execute"), { owner: "o", repo: "r" }),
  (error) => error.code === "OPERATION_REQUIRED_FIELDS_MISSING",
);

assert.equal(
  _testingOperationContextService.principalClass({ mode: "user_jwt", user_id: "u", tenant_id: "t" }),
  "tenant",
);
assert.equal(
  _testingOperationContextService.principalClass({ mode: "backend_api", is_admin: true }),
  "admin",
);
assert.equal(
  _testingOperationContextService.repositoryUri({ owner: "mad4bdigital-ai", repo: "repo" }),
  "github://mad4bdigital-ai/repo",
);
assert.equal(_testingOperationContextService.responseMode({ response_mode: "full" }), "full");
assert.equal(_testingOperationContextService.responseMode({ response_mode: "invalid" }), "summary");

const automation = _testingOperationOrchestrator.automationInput({
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  branch: "feature",
}, "dry_run");
assert.equal(automation.automation_key, "pr_delivery");
assert.equal(automation.mode, "dry_run");
assert.equal(automation.default_branch, "main");

const diagnosis = _testingOperationOrchestrator.summarizeChecks({
  checks: [
    { name: "Syntax Check", conclusion: "failure" },
    { name: "Unit & Integration Tests", status: "queued" },
  ],
});
assert.equal(diagnosis.status, "failed");
assert.deepEqual(diagnosis.failing_checks.map((item) => item.name), ["Syntax Check"]);

console.log("operation orchestrator tests passed");
