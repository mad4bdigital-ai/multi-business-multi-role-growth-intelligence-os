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
  write(root, ".github/workflows/validate.yml", `name: Validate\non:\n  pull_request:\n    paths:\n      - pipeline-connectivity-contract.json\npermissions:\n  contents: read\njobs:\n  check:\n    steps:\n      - run: node connectivity-check.mjs\n      - run: node generator.mjs --check\n`);
  write(root, ".github/workflows/autofix.yml", `name: Autofix\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  fix:\n    steps:\n      - run: |-\n          node connectivity-check.mjs\n          node generator.mjs --write\n          node generator.mjs --check\n          echo writer-token\n          git push origin HEAD:refs/heads/test\n`);
  write(root, ".github/workflows/docs.yml", `name: Docs\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  docs:\n    steps:\n      - run: |-\n          node connectivity-check.mjs\n          node generator.mjs --write\n          echo preview-only\n`);
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
  write(root, ".github/workflows/path-only-reference.yml", `name: Path only\non:\n  pull_request:\n    paths:\n      - "generator.mjs --write"\npermissions:\n  contents: read\njobs:\n  noop:\n    steps:\n      - run: echo no artifact generation\n`);
  const result = validatePipelineConnectivity({ repoRoot: root });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
}

{
  const root = setup();
  write(root, ".github/workflows/hidden-writer.yml", `name: Hidden\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  hidden:\n    steps:\n      - run: |\n          node generator.mjs \\\n            --write\n`);
  const codes = new Set(validatePipelineConnectivity({ repoRoot: root }).findings.map((row) => row.code));
  assert.ok(codes.has("UNDECLARED_ARTIFACT_PRODUCER"));
  assert.ok(codes.has("ARTIFACT_PRODUCER_SET_MISMATCH"));
}

{
  const root = setup();
  write(root, ".github/workflows/excluded-maintenance.yml", `name: Excluded maintenance\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  sync:\n    steps:\n      - run: node maintenance.mjs --write --skip-work-maps\n`);
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
  const integrationWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/spec-kit-work-map-integration.yml"), "utf8");
  const docsWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/docs-agent.yml"), "utf8");
  const openapiWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/openapi-auto-sync.yml"), "utf8");
  const maintenanceSource = fs.readFileSync(path.join(repoRoot, "http-generic-api/scripts/repo-maintenance-sync.mjs"), "utf8");
  const manifest = fs.readFileSync(path.join(repoRoot, "http-generic-api/scripts/run-test-manifest.mjs"), "utf8");

  const writerPolicy = contract.artifact_writer_policies.find((row) => row.artifact_group === "platform_work_maps");
  assert.equal(writerPolicy.writer_pipeline, "spec-kit-work-map-autofix");
  assert.deepEqual(
    writerPolicy.non_writer_pipelines.map((row) => row.pipeline).sort(),
    ["docs-agent", "openapi-auto-sync", "spec-kit-work-map-integration"].sort(),
  );

  assert.ok(docsWorkflow.includes("Generate dynamic text Work Map preview"));
  assert.ok(docsWorkflow.includes("Report preview-only PR mode"));
  assert.ok(docsWorkflow.includes("Review is required"));
  assert.ok(!docsWorkflow.includes("docs-agent-write"));
  assert.ok(!docsWorkflow.includes("git add docs/work-maps"));
  assert.ok(!docsWorkflow.includes("git push origin"));

  assert.ok(openapiWorkflow.includes("repo-maintenance-sync.mjs --write --skip-work-maps"));
  assert.ok(openapiWorkflow.includes("Refuse Work Map mutation outside the governed writer"));
  assert.ok(!openapiWorkflow.includes("platform-work-map-generator.mjs --write"));
  assert.ok(maintenanceSource.includes("const skipWorkMaps = process.argv.includes(\"--skip-work-maps\")"));
  assert.ok(maintenanceSource.includes("platform-work-map-generator-skipped-explicit-scope"));

  assert.ok(integrationWorkflow.includes("Generate exact-head Work Map repair candidate"));
  assert.ok(integrationWorkflow.includes("generated_from_exact_checked_out_head"));
  assert.ok(integrationWorkflow.includes("remote_write_executed: false"));
  assert.ok(integrationWorkflow.includes("actions/upload-artifact@v4"));
  assert.ok(integrationWorkflow.includes("Fail closed on stale generated Work Maps"));
  assert.ok(!integrationWorkflow.includes("git push origin"));
  assert.ok(!integrationWorkflow.includes("git commit"));

  const triggerBlock = autofixWorkflow.slice(autofixWorkflow.indexOf("on:"), autofixWorkflow.indexOf("permissions:"));
  const concurrencyBlock = autofixWorkflow.slice(autofixWorkflow.indexOf("concurrency:"), autofixWorkflow.indexOf("jobs:"));
  const permissionsBlock = autofixWorkflow.slice(autofixWorkflow.indexOf("permissions:"), autofixWorkflow.indexOf("concurrency:"));
  const jobAuthorizationBlock = autofixWorkflow.slice(autofixWorkflow.indexOf("jobs:"), autofixWorkflow.indexOf("runs-on:"));

  assert.ok(triggerBlock.includes("types: [reopened]"), "Pull-request autofix must only be triggered by an explicit reopened event");
  assert.ok(concurrencyBlock.includes("format('spec-kit-work-map-noop-{0}', github.run_id)"), "Unauthorised events must use a run-unique no-op concurrency group");
  assert.ok(concurrencyBlock.includes("work-map-autofix:authorized"), "Authorized artifact writes must share the governed branch concurrency group");
  assert.ok(concurrencyBlock.includes("cancel-in-progress: false"), "Authorized writes must queue instead of cancelling an active writer");
  assert.ok(jobAuthorizationBlock.includes("github.event.action == 'reopened'"));
  assert.ok(jobAuthorizationBlock.includes("github.event.pull_request.head.repo.full_name == github.repository"));
  assert.ok(jobAuthorizationBlock.includes("github.actor != 'github-actions[bot]'"));
  assert.ok(jobAuthorizationBlock.includes("work-map-autofix:authorized"));

  assert.ok(permissionsBlock.includes("pull-requests: write"));
  assert.ok(autofixWorkflow.includes("workflow_dispatch requires exactly one open same-repository PR targeting main"));
  assert.ok(autofixWorkflow.includes('head="${GITHUB_REPOSITORY_OWNER}:${TARGET_BRANCH}"'));
  assert.ok(autofixWorkflow.includes("Consume one-time pull-request authorization"));
  assert.ok(autofixWorkflow.includes("consume-one-time-authorization"));
  assert.ok(autofixWorkflow.includes("Authorization marker removal readback failed"));
  assert.ok(autofixWorkflow.includes('"consume_authorization":"${{ steps.consume_authorization.outcome }}"'));
  assert.ok(autofixWorkflow.includes("Bootstrap Work Map diagnostic envelope"));
  assert.ok(autofixWorkflow.includes("WORK_MAP_STEP_OUTCOMES"));
  assert.ok(autofixWorkflow.includes("work-map-autofix-diagnostic-report"));
  assert.ok(autofixWorkflow.includes("gh api --method PATCH"));
  assert.ok(autofixWorkflow.includes("gh api --method POST"));
  assert.ok(autofixWorkflow.includes("actions/upload-artifact@v4"));
  assert.ok(autofixWorkflow.includes("GITHUB_STEP_SUMMARY"));
  assert.ok(autofixWorkflow.includes("regenerate-and-verify-idempotency"));
  assert.ok(autofixWorkflow.includes("commit-push-and-dispatch"));
  assert.ok(manifest.includes("node test-work-map-autofix-diagnostics.mjs"));

  const bootstrapIndex = autofixWorkflow.indexOf("Bootstrap Work Map diagnostic envelope");
  const checkoutIndex = autofixWorkflow.indexOf("actions/checkout@v5");
  const pinIndex = autofixWorkflow.indexOf("Pin authorized branch head");
  const consumeIndex = autofixWorkflow.indexOf("Consume one-time pull-request authorization");
  const regenerateIndex = autofixWorkflow.indexOf("Regenerate and verify idempotency");
  const finalizeIndex = autofixWorkflow.indexOf("Finalize Work Map diagnostic report");
  const uploadIndex = autofixWorkflow.indexOf("Upload Work Map diagnostic report");
  const publishIndex = autofixWorkflow.indexOf("Publish sticky Work Map diagnostic report");
  assert.ok(bootstrapIndex >= 0 && bootstrapIndex < checkoutIndex);
  assert.ok(pinIndex >= 0 && pinIndex < consumeIndex);
  assert.ok(consumeIndex >= 0 && consumeIndex < regenerateIndex);
  assert.ok(finalizeIndex >= 0 && finalizeIndex < uploadIndex);
  assert.ok(uploadIndex >= 0 && uploadIndex < publishIndex);
}

console.log("Pipeline connectivity contract regression passed");
