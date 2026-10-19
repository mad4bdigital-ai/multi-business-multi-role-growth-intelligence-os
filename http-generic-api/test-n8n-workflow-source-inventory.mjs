#!/usr/bin/env node
// Regression: existing n8n workflows remain separate source-controlled backups,
// discoverable without mutation and never bundled into the Connector Agent image.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectWorkflowSources } from "../local-connector/n8n-workflows/inspect-workflow-sources.mjs";
import { createReleaseManifest } from "./scripts/staging-connector-release-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const original = path.join(root, "local-connector", "n8n-workflows");
const audit = inspectWorkflowSources(original);
assert.equal(audit.ok, true);
assert.equal(audit.source, "git_tracked_n8n_workflow_backups");
assert.equal(audit.connector_package_inclusion, false);
assert.equal(audit.restore_scripts_executed, false);
assert.equal(audit.database_mutation_performed, false);
assert.equal(audit.secrets_included, false);
const registry = createReleaseManifest(root);
assert(!registry.files.some((file) => file.path.startsWith("local-connector/n8n-workflows/")),
  "n8n_source_must_never_be_merged_into_connector_release");
const dockerfile = fs.readFileSync(path.join(root, "http-generic-api/Dockerfile.staging"), "utf8");
assert(dockerfile.includes("COPY .staging-connector-release/local-connector/"),
  "connector_image_must_use_generated_release_only");
assert(!dockerfile.includes("COPY local-connector/"),
  "connector_image_must_not_copy_raw_n8n_sources");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-n8n-source-test-"));
try {
  const names = fs.readdirSync(original).filter((name) => name !== "inspect-workflow-sources.mjs");
  for (const name of names) fs.copyFileSync(path.join(original, name), path.join(tmp, name));
  assert.deepEqual(inspectWorkflowSources(tmp).workflows.map((x) => x.binding_key).sort(),
    audit.workflows.map((x) => x.binding_key).sort(), "n8n_source_snapshot_parity_failed");

  // Future workflow sources may be added independently of the Connector manifest.
  const example = "platform-classification-v1";
  const newTemplate = "future-n8n-audit.template.json";
  const newRestore = "restore-future-n8n-audit.mjs";
  const doc = JSON.parse(fs.readFileSync(path.join(tmp, example + ".template.json"), "utf8"));
  doc.workflow_key = "future_n8n_audit";
  doc.binding_key = "future_n8n_audit_v1";
  fs.writeFileSync(path.join(tmp, newTemplate), JSON.stringify(doc));
  const script = fs.readFileSync(path.join(tmp, "restore-" + example + ".mjs"), "utf8")
    .replace(example + ".template.json", newTemplate);
  fs.writeFileSync(path.join(tmp, newRestore), script);
  assert.equal(inspectWorkflowSources(tmp).workflow_count, audit.workflow_count + 1,
    "n8n_source_new_backup_not_discovered");
  assert(!createReleaseManifest(root).files.some((file) => file.path.includes("future-n8n-audit")),
    "n8n_source_growth_must_not_expand_connector_distribution");

  // Compromised safety flags must fail closed.
  doc.security_assertions.contains_secret_values = true;
  fs.writeFileSync(path.join(tmp, newTemplate), JSON.stringify(doc));
  assert.throws(() => inspectWorkflowSources(tmp), /n8n_source_security_assertions_missing/u);
  doc.security_assertions.contains_secret_values = false;
  fs.writeFileSync(path.join(tmp, newTemplate), JSON.stringify(doc));

  // A missing paired restore path must fail even if the template is valid.
  fs.unlinkSync(path.join(tmp, newRestore));
  assert.throws(() => inspectWorkflowSources(tmp), /n8n_source_template_restore_count_mismatch|n8n_source_restore_script_missing/u);

  // Nested/unexpected source material must not silently become restorable.
  fs.writeFileSync(path.join(tmp, "unreviewed.txt"), "not a workflow source");
  assert.throws(() => inspectWorkflowSources(tmp), /n8n_source_unrecognized_entry/u);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(JSON.stringify({ ok: true, contract: "mad4b.n8n-source-separation-test.v1",
  source_workflows: audit.workflow_count, dynamic_discovery: true,
  restored_live_workflows: false, connector_distribution_unchanged: true,
  secrets_included: false }));
