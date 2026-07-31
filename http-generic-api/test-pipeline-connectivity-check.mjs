#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
        required_commands: ["connectivity-check.mjs", "generator.mjs --write", "generator.mjs --check", "--force-with-lease"],
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
  write(root, ".github/workflows/autofix.yml", `name: Autofix\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  fix:\n    steps:\n      - run: node connectivity-check.mjs\n      - run: node generator.mjs --write\n      - run: node generator.mjs --check\n      - run: git push --force-with-lease\n`);
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
  write(root, ".github/workflows/hidden-writer.yml", `name: Hidden\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  hidden:\n    steps:\n      - run: node generator.mjs --write\n`);
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

console.log("Pipeline connectivity contract regression passed");
