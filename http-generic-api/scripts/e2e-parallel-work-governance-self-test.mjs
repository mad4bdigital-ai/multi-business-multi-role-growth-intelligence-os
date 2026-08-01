#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateParallelWork } from "./e2e-parallel-work-governance.mjs";

const policy = JSON.parse(fs.readFileSync(new URL("../../.specify/e2e-phase-governance.json", import.meta.url), "utf8"));

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-parallel-work-"));
  fs.mkdirSync(path.join(root, ".specify"), { recursive: true });
  fs.writeFileSync(path.join(root, ".specify", "e2e-phase-governance.json"), `${JSON.stringify(policy, null, 2)}\n`);
  return root;
}

function write(root, relative, content = "export default true;\n") {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function baseContract() {
  return {
    schema_version: 1,
    feature_key: "001-example",
    title: "Example",
    delivery_mode: "multi_pr",
    current_phase: "mvp",
    scope: { include: ["specs/001-example/**", "http-generic-api/example/**"] },
    merge_contract: { minimum_phase: "mvp" },
    phases: [{ id: "mvp", status: "blocked", objective: "Build the complete slice.", blockers: ["Pending integration."], planned_e2e_journey: { id: "example-e2e", required_level: "synthetic_runtime", actor: "tenant", entrypoint: "POST /example", terminal_outcome: "Readback succeeds.", steps: ["Submit", "Read back"] } }],
    parallel_work: {
      enabled: true,
      strategy: "dependency_dag",
      file_ownership: "exclusive_by_default",
      merge_policy: "workstream_commits_then_e2e_rollup",
      no_partial_feature_merge: true,
      workstreams: [
        {
          id: "contracts",
          title: "Contracts",
          status: "in_progress",
          owner_type: "ai_agent",
          branch_pattern: "gpt/001-example/contracts-*",
          scope: { include: ["specs/001-example/**"] },
          depends_on: [],
          deliverables: ["Spec and API contracts"],
          integration_points: ["example-contract-v1"],
          required_tests: []
        },
        {
          id: "runtime",
          title: "Runtime",
          status: "planned",
          owner_type: "human",
          branch_pattern: "gpt/001-example/runtime-*",
          scope: { include: ["http-generic-api/example/runtime/**"] },
          depends_on: ["contracts"],
          deliverables: ["Runtime service"],
          integration_points: ["example-contract-v1"],
          required_tests: []
        },
        {
          id: "verification",
          title: "Verification",
          status: "planned",
          owner_type: "mixed",
          branch_pattern: "gpt/001-example/verification-*",
          scope: { include: ["http-generic-api/example/test/**"] },
          depends_on: ["contracts", "runtime"],
          deliverables: ["Synthetic E2E"],
          integration_points: ["example-e2e"],
          required_tests: []
        }
      ],
      declared_overlaps: [],
      integration: {
        branch_pattern: "gpt/001-example/integration-*",
        required_workstreams: ["contracts", "runtime", "verification"],
        e2e_journey_ids: ["example-e2e"],
        convergence_tests: []
      }
    }
  };
}

function markReady(workstream, sha) {
  workstream.status = "ready_for_integration";
  workstream.required_tests = [{ id: `${workstream.id}-test`, runner: "node", working_directory: "http-generic-api", path: `example/${workstream.id}/test.mjs`, args: [] }];
  workstream.commit_evidence = { head_sha: sha, commits: [sha] };
}

function evaluate(contract, changedFiles, headRef = "gpt/001-example/contracts-a") {
  const root = tempRepo();
  write(root, "specs/001-example/e2e-phases.json", `${JSON.stringify(contract, null, 2)}\n`);
  for (const file of changedFiles) write(root, file);
  return evaluateParallelWork({ root, policy, changedFiles: [...changedFiles, "specs/001-example/e2e-phases.json"], headRef, head: "HEAD" });
}

{
  const report = evaluate(baseContract(), ["specs/001-example/spec.md"]);
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.equal(report.contracts[0].active_workstream, "contracts");
}

{
  const contract = baseContract();
  contract.parallel_work.workstreams[0].depends_on = ["verification"];
  const report = evaluate(contract, ["specs/001-example/spec.md"]);
  assert.equal(report.ok, false);
  assert(report.findings.some((row) => row.code === "parallel_work_dependency_cycle"));
}

{
  const contract = baseContract();
  contract.parallel_work.workstreams[1].scope.include = ["specs/001-example/**"];
  const report = evaluate(contract, ["specs/001-example/spec.md"]);
  assert.equal(report.ok, false);
  assert(report.findings.some((row) => row.code === "parallel_work_undeclared_scope_overlap"));
}

{
  const report = evaluate(baseContract(), ["http-generic-api/example/runtime/service.mjs"], "gpt/001-example/contracts-a");
  assert.equal(report.ok, false);
  assert(report.findings.some((row) => row.code === "parallel_work_change_outside_active_workstream"));
}

{
  const contract = baseContract();
  markReady(contract.parallel_work.workstreams[1], "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const report = evaluate(contract, ["http-generic-api/example/runtime/service.mjs"], "gpt/001-example/runtime-a");
  assert.equal(report.ok, false);
  assert(report.findings.some((row) => row.code === "parallel_work_ready_before_dependency"));
}

{
  const contract = baseContract();
  markReady(contract.parallel_work.workstreams[0], "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  markReady(contract.parallel_work.workstreams[1], "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  contract.parallel_work.workstreams = [
    contract.parallel_work.workstreams[1],
    contract.parallel_work.workstreams[0],
    contract.parallel_work.workstreams[2]
  ];
  const report = evaluate(contract, ["http-generic-api/example/runtime/service.mjs"], "gpt/001-example/runtime-a");
  assert.equal(report.ok, true, JSON.stringify(report.findings));
}

{
  const contract = baseContract();
  contract.parallel_work.workstreams[1].scope.include = ["specs/001-example/shared.json"];
  contract.parallel_work.declared_overlaps = [{ id: "shared-contract", workstreams: ["contracts", "runtime"], patterns: ["specs/001-example/shared.json"], reason: "Generated compatibility file", coordinator: "integration-owner" }];
  const report = evaluate(contract, ["specs/001-example/shared.json"], "gpt/001-example/contracts-a");
  assert.equal(report.ok, true, JSON.stringify(report.findings));
}

console.log(JSON.stringify({ ok: true, tests: 7, gate: "e2e_parallel_work_governance", secrets_included: false }));
