#!/usr/bin/env node
// Read-only source-of-truth audit for historical, recoverable n8n workflows.
// Does not contact n8n, access DB/secrets, run restore scripts, or deploy assets.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONTRACT = "mad4b.n8n-workflow-source-inventory.v1";
const DEFAULT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

const hashFile = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function inspectWorkflowSources(directory = DEFAULT_DIRECTORY) {
  const names = fs.readdirSync(directory, { withFileTypes: true });
  assert(names.length > 0, "n8n_source_directory_empty");
  for (const entry of names) {
    // The inspector itself is source code, never a restorable workflow.
    if (entry.name === "inspect-workflow-sources.mjs") continue;
    assert(entry.isFile() && !entry.isSymbolicLink(), "n8n_source_nonregular_entry");
    assert(/^(?:[a-z0-9-]+\.template\.json|restore-[a-z0-9-]+\.mjs)$/u.test(entry.name),
      "n8n_source_unrecognized_entry");
  }
  const templates = names.map((x) => x.name)
    .filter((name) => name.endsWith(".template.json")).sort();
  const restorers = names.map((x) => x.name).filter((name) => name.startsWith("restore-")).sort();
  assert(templates.length > 0 && templates.length === restorers.length, "n8n_source_template_restore_count_mismatch");
  const workflows = [];
  const keys = new Set();
  for (const templateName of templates) {
    const stem = templateName.slice(0, -".template.json".length);
    const restoreName = "restore-" + stem + ".mjs";
    assert(restorers.includes(restoreName), "n8n_source_restore_script_missing");
    const templatePath = path.join(directory, templateName);
    const restorePath = path.join(directory, restoreName);
    const doc = JSON.parse(fs.readFileSync(templatePath, "utf8"));
    const restore = fs.readFileSync(restorePath, "utf8");
    assert(doc.runtime_type === "n8n", "n8n_source_runtime_type_mismatch");
    assert(typeof doc.workflow_key === "string" && /^[a-z][a-z0-9_]*$/u.test(doc.workflow_key),
      "n8n_source_workflow_key_invalid");
    assert(typeof doc.binding_key === "string" && /^[a-z][a-z0-9_]*$/u.test(doc.binding_key),
      "n8n_source_binding_key_invalid");
    assert(!keys.has(doc.binding_key), "n8n_source_duplicate_binding_key");
    keys.add(doc.binding_key);
    assert(doc.workflow?.nodes?.length > 0, "n8n_source_empty_workflow");
    assert(doc.credential?.type === "httpHeaderAuth" &&
      doc.credential.header_name === "Authorization" &&
      /^[A-Z][A-Z0-9_]*$/u.test(doc.credential.value_env_var || ""),
      "n8n_source_credential_reference_invalid");
    const security = doc.security_assertions || {};
    assert(security.contains_secret_values === false &&
      security.uses_native_header_auth === true &&
      security.code_node_uses_process_env === false &&
      security.code_node_contains_bearer_literal === false,
      "n8n_source_security_assertions_missing");
    assert(!/Bearer\s+[A-Za-z0-9._~+/-]{12,}/iu.test(JSON.stringify(doc)),
      "n8n_source_embedded_bearer_token");
    assert(!/N8N_API_KEY\s*[:=]\s*['"][^'"]+/iu.test(JSON.stringify(doc)),
      "n8n_source_embedded_api_key");
    assert(restore.includes(templateName) && restore.includes("N8N_API_KEY") &&
      restore.includes("secrets_printed: false"), "n8n_source_restore_contract_missing");
    const policy = doc.runtime_binding?.experiment_policy;
    const isExperiment = !!policy;
    if (isExperiment) {
      assert(security.production_replacement === false &&
        security.canonical_summary_write_allowed === false &&
        policy.promotion_status === "not_promoted" &&
        policy.blocked_use_cases?.includes("canonical_summary_write"),
        "n8n_source_experiment_policy_not_enforced");
    }
    workflows.push({
      workflow_key: doc.workflow_key,
      binding_key: doc.binding_key,
      task_class: doc.task_class || null,
      template: "local-connector/n8n-workflows/" + templateName,
      template_sha256: hashFile(templatePath),
      restore_script: "local-connector/n8n-workflows/" + restoreName,
      restore_script_sha256: hashFile(restorePath),
      promotion_status: isExperiment ? policy.promotion_status : "not_asserted_by_source",
      live_n8n_status: "not_checked",
      runtime_binding_status: "not_checked",
      restoration: "explicit_operator_approval_required",
    });
  }
  return {
    ok: true,
    contract: CONTRACT,
    source: "git_tracked_n8n_workflow_backups",
    workflow_count: workflows.length,
    workflows,
    connector_package_inclusion: false,
    restore_scripts_executed: false,
    network_access_attempted: false,
    database_mutation_performed: false,
    secrets_included: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--json"),
    "n8n_source_inspector_read_only_no_restore_options");
  console.log(JSON.stringify(inspectWorkflowSources(), null, 2));
}
