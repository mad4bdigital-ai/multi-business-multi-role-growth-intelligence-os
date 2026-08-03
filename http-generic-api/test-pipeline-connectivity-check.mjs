#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePipelineConnectivity } from "./scripts/pipeline-connectivity-check.mjs";

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function fixtureContract() {
  return {
    version: 1,
    artifact_groups: [{
      key: "maps",
      root: "docs/work-maps",
      producer_signatures: ["generator.mjs --write"],
      consumer_signatures: ["generator.mjs --check"],
      approved_producers: ["writer", "preview"],
      required_consumers: ["gate"],
    }],
    artifact_writer_policies: [{
      key: "maps-writer",
      artifact_group: "maps",
      writer_pipeline: "writer",
      required_writer_commands: ["expected-head", "git push origin"],
      forbidden_writer_commands: ["--force"],
      non_writer_pipelines: [{
        pipeline: "bridge",
        required_commands: ["one-time-marker", "dispatch-writer"],
        forbidden_commands: ["generator.mjs --write", "git push origin"],
      }, {
        pipeline: "preview",
        required_commands: ["preview-only"],
        forbidden_commands: ["git push origin", "git add docs/work-maps"],
      }],
    }],
    pipelines: [{
      key: "bridge",
      workflow: ".github/workflows/bridge.yml",
      mode: "authorize",
      required_permissions: { contents: "read" },
      required_triggers: ["pull_request"],
      required_commands: ["one-time-marker", "dispatch-writer"],
      forbidden_commands: ["generator.mjs --write", "git push origin"],
    }, {
      key: "gate",
      workflow: ".github/workflows/gate.yml",
      mode: "validate",
      required_permissions: { contents: "read" },
      required_triggers: ["pull_request"],
      required_path_patterns: ["pipeline-connectivity-contract.json"],
      required_commands: ["connectivity-check.mjs", "generator.mjs --check"],
      forbidden_commands: ["generator.mjs --write", "git push"],
    }, {
      key: "writer",
      workflow: ".github/workflows/writer.yml",
      mode: "write",
      required_permissions: { contents: "write" },
      required_triggers: ["workflow_dispatch"],
      forbidden_triggers: ["pull_request", "push"],
      required_commands: ["connectivity-check.mjs", "generator.mjs --write", "generator.mjs --check", "expected-head", "git push origin"],
      forbidden_commands: ["--force", "one-time-marker"],
    }, {
      key: "preview",
      workflow: ".github/workflows/preview.yml",
      mode: "preview",
      required_permissions: { contents: "read" },
      required_triggers: ["pull_request"],
      required_commands: ["connectivity-check.mjs", "generator.mjs --write", "preview-only"],
      forbidden_commands: ["git push origin", "git add docs/work-maps"],
    }],
    edges: [
      { from: "bridge", to: "writer", type: "authorized_dispatch" },
      { from: "writer", to: "maps", type: "sole_remote_writer" },
      { from: "preview", to: "maps", type: "preview_only_producer" },
      { from: "maps", to: "gate", type: "validated_by" },
    ],
  };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-connectivity-"));
  write(root, ".specify/pipeline-connectivity-contract.json", `${JSON.stringify(fixtureContract(), null, 2)}\n`);
  write(root, ".github/workflows/bridge.yml", `name: Bridge
on:
  pull_request:
permissions:
  contents: read
jobs:
  dispatch:
    steps:
      - run: |
          echo one-time-marker
          echo dispatch-writer
`);
  write(root, ".github/workflows/gate.yml", `name: Gate
on:
  pull_request:
    paths:
      - pipeline-connectivity-contract.json
permissions:
  contents: read
jobs:
  check:
    steps:
      - run: node connectivity-check.mjs
      - run: node generator.mjs --check
`);
  write(root, ".github/workflows/writer.yml", `name: Writer
on:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  write:
    steps:
      - run: |
          node connectivity-check.mjs
          node generator.mjs --write
          node generator.mjs --check
          echo expected-head
          git push origin HEAD:refs/heads/test
`);
  write(root, ".github/workflows/preview.yml", `name: Preview
on:
  pull_request:
permissions:
  contents: read
jobs:
  preview:
    steps:
      - run: |
          node connectivity-check.mjs
          node generator.mjs --write
          echo preview-only
`);
  return root;
}

{
  const root = setup();
  const result = validatePipelineConnectivity({ repoRoot: root });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.artifact_writer_policy_count, 1);
}

{
  const root = setup();
  const file = path.join(root, ".github/workflows/writer.yml");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("  workflow_dispatch:", "  pull_request:"));
  const codes = new Set(validatePipelineConnectivity({ repoRoot: root }).findings.map((row) => row.code));
  assert.ok(codes.has("REQUIRED_TRIGGER_DISCONNECTED"));
  assert.ok(codes.has("FORBIDDEN_TRIGGER_CONNECTED"));
}

{
  const root = setup();
  const file = path.join(root, ".github/workflows/bridge.yml");
  fs.appendFileSync(file, "      - run: node generator.mjs --write\n");
  const codes = new Set(validatePipelineConnectivity({ repoRoot: root }).findings.map((row) => row.code));
  assert.ok(codes.has("FORBIDDEN_COMMAND_CONNECTED"));
  assert.ok(codes.has("NON_WRITER_REMOTE_MUTATION_CONNECTED"));
  assert.ok(codes.has("ARTIFACT_PRODUCER_SET_MISMATCH"));
}

{
  const root = setup();
  const file = path.join(root, ".github/workflows/gate.yml");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("      - pipeline-connectivity-contract.json\n", ""));
  const codes = new Set(validatePipelineConnectivity({ repoRoot: root }).findings.map((row) => row.code));
  assert.ok(codes.has("REQUIRED_PATH_DISCONNECTED"));
}

{
  const root = setup();
  write(root, ".github/workflows/hidden-writer.yml", `name: Hidden
on:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  hidden:
    steps:
      - run: |
          node generator.mjs \
            --write
`);
  const codes = new Set(validatePipelineConnectivity({ repoRoot: root }).findings.map((row) => row.code));
  assert.ok(codes.has("UNDECLARED_ARTIFACT_PRODUCER"));
  assert.ok(codes.has("ARTIFACT_PRODUCER_SET_MISMATCH"));
}

{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const contract = JSON.parse(fs.readFileSync(path.join(repoRoot, ".specify/pipeline-connectivity-contract.json"), "utf8"));
  const bridgeWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/e2e-contract-reference-integrity.yml"), "utf8");
  const writerWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/spec-kit-work-map-autofix.yml"), "utf8");
  const integrationWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/spec-kit-work-map-integration.yml"), "utf8");
  const docsWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/docs-agent.yml"), "utf8");
  const openapiWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/openapi-auto-sync.yml"), "utf8");

  const writerPolicy = contract.artifact_writer_policies.find((row) => row.artifact_group === "platform_work_maps");
  assert.equal(writerPolicy.writer_pipeline, "spec-kit-work-map-autofix");
  assert.deepEqual(
    writerPolicy.non_writer_pipelines.map((row) => row.pipeline).sort(),
    ["docs-agent", "openapi-auto-sync", "spec-kit-work-map-integration", "work-map-recovery-bridge"].sort(),
  );

  const bridgeContract = contract.pipelines.find((row) => row.key === "work-map-recovery-bridge");
  const writerContract = contract.pipelines.find((row) => row.key === "spec-kit-work-map-autofix");
  assert.deepEqual(bridgeContract.required_triggers.sort(), ["pull_request", "workflow_dispatch"].sort());
  assert.deepEqual(writerContract.required_triggers, ["workflow_dispatch"]);
  assert.ok(writerContract.forbidden_triggers.includes("pull_request"));

  assert.ok(bridgeWorkflow.includes("Validate immutable PR snapshot and dispatch sole writer"));
  assert.ok(bridgeWorkflow.includes("work-map-autofix:authorized"));
  assert.ok(bridgeWorkflow.includes("authorization_consumed=true"));
  assert.ok(bridgeWorkflow.includes("spec-kit-work-map-autofix.yml/dispatches"));
  assert.ok(bridgeWorkflow.includes("delegated_run_id"));
  assert.ok(bridgeWorkflow.includes("direct_repository_content_mutation=false"));
  assert.ok(bridgeWorkflow.includes("protected_branch_mutation=false"));
  assert.ok(bridgeWorkflow.includes("force_push=false"));
  assert.ok(bridgeWorkflow.includes("gh api --method PATCH"));
  assert.ok(!bridgeWorkflow.includes("platform-work-map-generator.mjs --write"));
  assert.ok(!bridgeWorkflow.includes("git push origin"));

  const triggerBlock = writerWorkflow.slice(writerWorkflow.indexOf("on:"), writerWorkflow.indexOf("permissions:"));
  const permissionsBlock = writerWorkflow.slice(writerWorkflow.indexOf("permissions:"), writerWorkflow.indexOf("concurrency:"));
  const concurrencyBlock = writerWorkflow.slice(writerWorkflow.indexOf("concurrency:"), writerWorkflow.indexOf("jobs:"));
  assert.ok(triggerBlock.includes("workflow_dispatch:"));
  assert.ok(triggerBlock.includes("expected_head_sha:"));
  assert.ok(!triggerBlock.includes("pull_request:"));
  assert.ok(permissionsBlock.includes("actions: write"));
  assert.ok(permissionsBlock.includes("contents: write"));
  assert.ok(permissionsBlock.includes("pull-requests: write"));
  assert.ok(permissionsBlock.includes("issues: write"));
  assert.ok(concurrencyBlock.includes("inputs.branch"));
  assert.ok(concurrencyBlock.includes("cancel-in-progress: false"));

  assert.ok(writerWorkflow.includes("Initialize diagnostics and validate inputs"));
  assert.ok(writerWorkflow.includes("Checkout exact authorized head"));
  assert.ok(writerWorkflow.includes("Pin branch and pull request identity"));
  assert.ok(writerWorkflow.includes('test "${actual_head_sha}" = "${EXPECTED_HEAD_SHA}"'));
  assert.ok(writerWorkflow.includes('test "${remote_head_sha}" = "${EXPECTED_HEAD_SHA}"'));
  assert.ok(writerWorkflow.includes('test "${pr_count}" = "1"'));
  assert.ok(writerWorkflow.includes('head="${GITHUB_REPOSITORY_OWNER}:${TARGET_BRANCH}"'));
  assert.ok(writerWorkflow.includes("Regenerate and prove idempotency"));
  assert.ok(writerWorkflow.includes("Commit and push governed Work Maps"));
  assert.ok(writerWorkflow.includes("Dispatch exact-head verification"));
  assert.ok(writerWorkflow.includes("WORK_MAP_AUTOFIX_V2"));
  assert.ok(writerWorkflow.includes("gh workflow run ci.yml"));
  assert.ok(writerWorkflow.includes("gh workflow run spec-kit-work-map-integration.yml"));
  assert.ok(!writerWorkflow.includes("work-map-autofix:authorized"));
  assert.ok(!writerWorkflow.includes("gh api --method PATCH"));
  assert.ok(!writerWorkflow.includes("--force"));
  assert.ok(!writerWorkflow.includes("--force-with-lease"));

  const order = [
    "Initialize diagnostics and validate inputs",
    "Checkout exact authorized head",
    "Pin branch and pull request identity",
    "Validate generator and governance contracts",
    "Regenerate and prove idempotency",
    "Commit and push governed Work Maps",
    "Dispatch exact-head verification",
    "Finalize diagnostic evidence",
    "Upload Work Map diagnostic evidence",
  ].map((name) => writerWorkflow.indexOf(name));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(order, [...order].sort((left, right) => left - right));

  assert.ok(integrationWorkflow.includes("Generate exact-head Work Map repair candidate"));
  assert.ok(integrationWorkflow.includes("EXPECTED_CHECKED_OUT_SHA"));
  assert.ok(integrationWorkflow.includes("generated_from_exact_checked_out_head"));
  assert.ok(integrationWorkflow.includes("remote_write_executed: false"));
  assert.ok(integrationWorkflow.includes("Fail closed on stale generated Work Maps"));
  assert.ok(!integrationWorkflow.includes("git push origin"));
  assert.ok(!integrationWorkflow.includes("git commit"));

  assert.ok(docsWorkflow.includes("Report preview-only PR mode"));
  assert.ok(!docsWorkflow.includes("git push origin"));
  assert.ok(openapiWorkflow.includes("repo-maintenance-sync.mjs --write --skip-work-maps"));
  assert.ok(!openapiWorkflow.includes("platform-work-map-generator.mjs --write"));

  const realResult = validatePipelineConnectivity({ repoRoot });
  assert.equal(realResult.ok, true, JSON.stringify(realResult.findings, null, 2));
}

console.log("Pipeline connectivity contract regression passed");
