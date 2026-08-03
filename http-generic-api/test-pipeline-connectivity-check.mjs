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
    artifact_groups: [
      {
        key: "maps",
        root: "docs/work-maps",
        producer_signatures: ["generator.mjs --write", "maintenance.mjs --write"],
        producer_exclusion_signatures: ["maintenance.mjs --write --skip-work-maps"],
        consumer_signatures: ["generator.mjs --check"],
        approved_producers: ["autofix", "docs"],
        required_consumers: ["validate"],
      },
    ],
    artifact_writer_policies: [
      {
        key: "maps-writer",
        artifact_group: "maps",
        writer_pipeline: "autofix",
        required_writer_commands: ["writer-token", "git push origin"],
        forbidden_writer_commands: ["--force"],
        non_writer_pipelines: [
          {
            pipeline: "docs",
            required_commands: ["preview-only"],
            forbidden_commands: ["git push origin", "git add docs/work-maps"],
          },
        ],
      },
    ],
    pipelines: [
      {
        key: "validate",
        workflow: ".github/workflows/validate.yml",
        mode: "validate",
        required_permissions: { contents: "read" },
        required_triggers: ["pull_request"],
        required_path_patterns: ["pipeline-connectivity-contract.json"],
        required_commands: ["connectivity-check.mjs", "generator.mjs --check"],
        forbidden_commands: ["generator.mjs --write", "git push"],
      },
      {
        key: "autofix",
        workflow: ".github/workflows/autofix.yml",
        mode: "write",
        required_permissions: { contents: "write" },
        required_triggers: ["workflow_dispatch"],
        forbidden_triggers: ["pull_request"],
        required_commands: ["connectivity-check.mjs", "generator.mjs --write", "generator.mjs --check", "writer-token", "git push origin"],
        forbidden_commands: ["--force", "--force-with-lease"],
      },
      {
        key: "docs",
        workflow: ".github/workflows/docs.yml",
        mode: "preview",
        required_permissions: { contents: "read" },
        required_triggers: ["pull_request"],
        required_commands: ["connectivity-check.mjs", "generator.mjs --write", "preview-only"],
        forbidden_commands: ["git push origin", "git add docs/work-maps"],
      },
    ],
    edges: [
      { from: "autofix", to: "maps", type: "sole_remote_writer" },
      { from: "docs", to: "maps", type: "preview_only_producer" },
      { from: "maps", to: "validate", type: "validated_by" },
    ],
  };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-connectivity-"));
  write(root, ".specify/pipeline-connectivity-contract.json", `${JSON.stringify(fixtureContract(), null, 2)}\n`);
  write(root, ".github/workflows/validate.yml", `name: Validate
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
  write(root, ".github/workflows/autofix.yml", `name: Autofix
on:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  fix:
    steps:
      - run: |-
          node connectivity-check.mjs
          node generator.mjs --write
          node generator.mjs --check
          echo writer-token
          git push origin HEAD:refs/heads/test
`);
  write(root, ".github/workflows/docs.yml", `name: Docs
on:
  pull_request:
permissions:
  contents: read
jobs:
  docs:
    steps:
      - run: |-
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
  const file = path.join(root, ".github/workflows/validate.yml");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("contents: read", "contents: write").replace("generator.mjs --check", "generator.mjs --write"));
  const codes = new Set(validatePipelineConnectivity({ repoRoot: root }).findings.map((row) => row.code));
  assert.ok(codes.has("PIPELINE_PERMISSION_MISMATCH"));
  assert.ok(codes.has("FORBIDDEN_COMMAND_CONNECTED"));
  assert.ok(codes.has("ARTIFACT_PRODUCER_SET_MISMATCH"));
}

{
  const root = setup();
  const file = path.join(root, ".github/workflows/validate.yml");
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
  const root = setup();
  write(root, ".github/workflows/excluded-maintenance.yml", `name: Excluded maintenance
on:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  sync:
    steps:
      - run: node maintenance.mjs --write --skip-work-maps
`);
  const result = validatePipelineConnectivity({ repoRoot: root });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
}

{
  const root = setup();
  const file = path.join(root, ".github/workflows/docs.yml");
  fs.appendFileSync(file, "      - run: git push origin HEAD:refs/heads/docs\n");
  const codes = new Set(validatePipelineConnectivity({ repoRoot: root }).findings.map((row) => row.code));
  assert.ok(codes.has("FORBIDDEN_COMMAND_CONNECTED"));
  assert.ok(codes.has("NON_WRITER_REMOTE_MUTATION_CONNECTED"));
}

{
  const root = setup();
  const file = path.join(root, ".github/workflows/validate.yml");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("node generator.mjs --check", "echo disconnected"));
  const codes = new Set(validatePipelineConnectivity({ repoRoot: root }).findings.map((row) => row.code));
  assert.ok(codes.has("REQUIRED_COMMAND_DISCONNECTED"));
  assert.ok(codes.has("ARTIFACT_CONSUMER_DISCONNECTED"));
}

{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const contract = JSON.parse(fs.readFileSync(path.join(repoRoot, ".specify/pipeline-connectivity-contract.json"), "utf8"));
  const autofixWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/spec-kit-work-map-autofix.yml"), "utf8");
  const recoveryWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/spec-kit-work-map-autofix-recovery-dispatch.yml"), "utf8");
  const integrationWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/spec-kit-work-map-integration.yml"), "utf8");
  const docsWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/docs-agent.yml"), "utf8");
  const openapiWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/openapi-auto-sync.yml"), "utf8");
  const maintenanceSource = fs.readFileSync(path.join(repoRoot, "http-generic-api/scripts/repo-maintenance-sync.mjs"), "utf8");

  const result = validatePipelineConnectivity({ repoRoot });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));

  const writerPolicy = contract.artifact_writer_policies.find((row) => row.artifact_group === "platform_work_maps");
  assert.equal(writerPolicy.writer_pipeline, "spec-kit-work-map-autofix");
  assert.deepEqual(
    writerPolicy.non_writer_pipelines.map((row) => row.pipeline).sort(),
    ["docs-agent", "openapi-auto-sync", "spec-kit-work-map-autofix-recovery-dispatch", "spec-kit-work-map-integration"].sort(),
  );

  const writerContract = contract.pipelines.find((row) => row.key === "spec-kit-work-map-autofix");
  const recoveryContract = contract.pipelines.find((row) => row.key === "spec-kit-work-map-autofix-recovery-dispatch");
  assert.deepEqual(writerContract.required_triggers, ["workflow_dispatch"]);
  assert.ok(writerContract.forbidden_triggers.includes("pull_request"));
  assert.equal(recoveryContract.mode, "trusted_authorization_and_exact_head_dispatch");

  const writerTriggerBlock = autofixWorkflow.slice(autofixWorkflow.indexOf("on:"), autofixWorkflow.indexOf("permissions:"));
  assert.ok(writerTriggerBlock.includes("workflow_dispatch:"));
  assert.ok(!writerTriggerBlock.includes("pull_request:"));
  assert.ok(autofixWorkflow.includes("expected_head_sha:"));
  assert.ok(autofixWorkflow.includes("Pin branch and pull request identity"));
  assert.ok(autofixWorkflow.includes('test "${remote_head_sha}" = "${EXPECTED_HEAD_SHA}"'));
  assert.ok(autofixWorkflow.includes('[[ "${TARGET_BRANCH}" != "main" && "${TARGET_BRANCH}" != "Production" ]]'));
  assert.ok(autofixWorkflow.includes('git push origin "HEAD:refs/heads/${TARGET_BRANCH}"'));
  assert.ok(autofixWorkflow.includes("gh workflow run ci.yml"));
  assert.ok(!autofixWorkflow.includes("git push --force"));

  assert.ok(recoveryWorkflow.includes("pull_request_target:"));
  assert.ok(recoveryWorkflow.includes("issue_comment:"));
  assert.ok(recoveryWorkflow.includes("<!-- work-map-autofix:authorized -->"));
  assert.ok(recoveryWorkflow.includes("/recover-work-maps"));
  assert.ok(recoveryWorkflow.includes("Consume one-time authorization marker"));
  assert.ok(recoveryWorkflow.includes("Authorization marker removal readback failed"));
  assert.ok(recoveryWorkflow.includes("spec-kit-work-map-autofix.yml/dispatches"));
  assert.ok(!recoveryWorkflow.includes("actions/checkout"));
  assert.ok(!recoveryWorkflow.includes("git push origin"));
  assert.ok(!recoveryWorkflow.includes("platform-work-map-generator.mjs --write"));

  assert.ok(docsWorkflow.includes("Generate dynamic text Work Map preview"));
  assert.ok(docsWorkflow.includes("Report preview-only PR mode"));
  assert.ok(!docsWorkflow.includes("git add docs/work-maps"));
  assert.ok(!docsWorkflow.includes("git push origin"));

  assert.ok(integrationWorkflow.includes("Generate exact-head Work Map repair candidate"));
  assert.ok(integrationWorkflow.includes("remote_write_executed: false"));
  assert.ok(!integrationWorkflow.includes("git push origin"));
  assert.ok(!integrationWorkflow.includes("git commit"));

  assert.ok(openapiWorkflow.includes("repo-maintenance-sync.mjs --write --skip-work-maps"));
  assert.ok(openapiWorkflow.includes("Refuse Work Map mutation outside the governed writer"));
  assert.ok(!openapiWorkflow.includes("platform-work-map-generator.mjs --write"));
  assert.ok(maintenanceSource.includes('const skipWorkMaps = process.argv.includes("--skip-work-maps")'));
}

console.log("Pipeline connectivity contract regression passed");
