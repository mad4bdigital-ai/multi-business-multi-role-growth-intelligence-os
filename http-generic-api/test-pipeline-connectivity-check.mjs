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
        producer_signatures: ["generator.mjs --write"],
        consumer_signatures: ["generator.mjs --check"],
        approved_producers: ["autofix", "docs"],
        required_consumers: ["validate"],
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
        required_commands: ["connectivity-check.mjs", "generator.mjs --write", "generator.mjs --check", "git push origin"],
        forbidden_commands: ["--force", "--force-with-lease"],
      },
      {
        key: "docs",
        workflow: ".github/workflows/docs.yml",
        mode: "conditional_write",
        required_permissions: { contents: "write" },
        required_triggers: ["pull_request"],
        required_commands: ["connectivity-check.mjs", "generator.mjs --write", "docs-write"],
      },
    ],
    edges: [
      { from: "autofix", to: "maps", type: "produces" },
      { from: "docs", to: "maps", type: "conditionally_produces" },
      { from: "maps", to: "validate", type: "validated_by" },
    ],
  };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-connectivity-"));
  write(root, ".specify/pipeline-connectivity-contract.json", `${JSON.stringify(fixtureContract(), null, 2)}\n`);
  write(root, ".github/workflows/validate.yml", `name: Validate\non:\n  pull_request:\n    paths:\n      - pipeline-connectivity-contract.json\npermissions:\n  contents: read\njobs:\n  check:\n    steps:\n      - run: node connectivity-check.mjs\n      - run: node generator.mjs --check\n`);
  write(root, ".github/workflows/autofix.yml", `name: Autofix\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  fix:\n    steps:\n      - run: |-\n          node connectivity-check.mjs\n          node generator.mjs --write\n          node generator.mjs --check\n          git push origin HEAD:refs/heads/test\n`);
  write(root, ".github/workflows/docs.yml", `name: Docs\non:\n  pull_request:\npermissions:\n  contents: write\njobs:\n  docs:\n    if: contains('docs-write', 'docs-write')\n    steps:\n      - run: node connectivity-check.mjs\n      - run: node generator.mjs --write\n`);
  return root;
}

{
  const root = setup();
  const result = validatePipelineConnectivity({ repoRoot: root });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
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
  const file = path.join(root, ".github/workflows/validate.yml");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("node generator.mjs --check", "echo disconnected"));
  const codes = new Set(validatePipelineConnectivity({ repoRoot: root }).findings.map((row) => row.code));
  assert.ok(codes.has("REQUIRED_COMMAND_DISCONNECTED"));
  assert.ok(codes.has("ARTIFACT_CONSUMER_DISCONNECTED"));
}

{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/spec-kit-work-map-autofix.yml"), "utf8");
  const manifest = fs.readFileSync(path.join(repoRoot, "http-generic-api/scripts/run-test-manifest.mjs"), "utf8");
  const concurrencyBlock = workflow.slice(workflow.indexOf("concurrency:"), workflow.indexOf("jobs:"));
  const permissionsBlock = workflow.slice(workflow.indexOf("permissions:"), workflow.indexOf("concurrency:"));

  assert.ok(concurrencyBlock.includes("format('spec-kit-work-map-noop-{0}', github.run_id)"), "Unauthorised reopened events must use a run-unique no-op concurrency group");
  assert.ok(concurrencyBlock.includes("github.event.action == 'reopened'"), "Concurrency authorization must require a reopened event");
  assert.ok(concurrencyBlock.includes("github.event.pull_request.head.repo.full_name == github.repository"), "Concurrency authorization must require a same-repository head");
  assert.ok(concurrencyBlock.includes("github.actor != 'github-actions[bot]'"), "Concurrency authorization must reject bot-authored reopened events");
  assert.ok(concurrencyBlock.includes("work-map-autofix:authorized"), "Concurrency authorization must require the explicit marker");
  assert.ok(concurrencyBlock.includes("cancel-in-progress: true"), "Authorized retries must retain cancellation semantics within their trusted group");

  assert.ok(permissionsBlock.includes("pull-requests: write"), "Sticky diagnostics require explicit pull-request write permission");
  assert.ok(workflow.includes("Bootstrap Work Map diagnostic envelope"), "Checkout and setup failures require a bootstrap report");
  assert.ok(workflow.includes("WORK_MAP_STEP_OUTCOMES"), "The diagnostic report must include a workflow step ledger");
  assert.ok(workflow.includes("work-map-autofix-diagnostic-report"), "The PR diagnostic comment must use a stable marker");
  assert.ok(workflow.includes("gh api --method PATCH"), "Existing diagnostic comments must be updated rather than duplicated");
  assert.ok(workflow.includes("gh api --method POST"), "The first diagnostic run must create a PR comment");
  assert.ok(workflow.includes("actions/upload-artifact@v4"), "Raw diagnostic reports and logs must remain downloadable");
  assert.ok(workflow.includes("GITHUB_STEP_SUMMARY"), "Human-readable diagnostics must be published to the run summary");
  assert.ok(workflow.includes("regenerate-and-verify-idempotency"), "Generator and idempotency failures must run through the governed recorder");
  assert.ok(workflow.includes("commit-push-and-dispatch"), "Commit, push, readback, and validation dispatch failures must run through the governed recorder");
  assert.ok(manifest.includes("node test-work-map-autofix-diagnostics.mjs"), "Diagnostic reporter regression must remain in the canonical CI test manifest");

  const bootstrapIndex = workflow.indexOf("Bootstrap Work Map diagnostic envelope");
  const checkoutIndex = workflow.indexOf("actions/checkout@v5");
  const finalizeIndex = workflow.indexOf("Finalize Work Map diagnostic report");
  const uploadIndex = workflow.indexOf("Upload Work Map diagnostic report");
  const publishIndex = workflow.indexOf("Publish sticky Work Map diagnostic report");
  assert.ok(bootstrapIndex >= 0 && bootstrapIndex < checkoutIndex, "Bootstrap reporting must exist before checkout");
  assert.ok(finalizeIndex >= 0 && finalizeIndex < uploadIndex, "The report must be finalized before artifact upload");
  assert.ok(uploadIndex >= 0 && uploadIndex < publishIndex, "Artifact upload must precede PR publication so the run contains downloadable evidence");
}

console.log("Pipeline connectivity contract regression passed");
