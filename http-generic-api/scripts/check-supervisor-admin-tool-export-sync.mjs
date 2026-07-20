#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(API_DIR, "config/supervisor-admin-tool-exports.json");
const TEST_COMMAND = "node test-supervisor-admin-tool-export-sync.mjs";

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readText(relativePath) {
  return readFileSync(path.join(API_DIR, relativePath), "utf8");
}

export function checkSupervisorAdminToolExportSync() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const aliasSource = readText(manifest.alias_file);
  const packageJson = JSON.parse(readText(manifest.package_file));
  const testManifest = readText(manifest.test_manifest);
  const errors = [];
  const seenToolKeys = new Set();
  const seenAliases = new Set();
  let semanticCapabilitiesChecked = 0;
  let policyPatchesChecked = 0;

  if (!testManifest.includes(TEST_COMMAND)) {
    errors.push(`test manifest missing ${TEST_COMMAND}`);
  }

  for (const tool of manifest.tools || []) {
    if (seenToolKeys.has(tool.tool_key)) errors.push(`duplicate tool_key ${tool.tool_key}`);
    if (seenAliases.has(tool.alias)) errors.push(`duplicate alias ${tool.alias}`);
    seenToolKeys.add(tool.tool_key);
    seenAliases.add(tool.alias);

    const scriptPath = path.join(API_DIR, tool.script);
    const migrationPath = path.join(API_DIR, tool.migration);
    if (!existsSync(scriptPath)) errors.push(`${tool.tool_key}: script missing ${tool.script}`);
    if (!existsSync(migrationPath)) errors.push(`${tool.tool_key}: migration missing ${tool.migration}`);

    const aliasPattern = new RegExp(
      `${escapeRegExp(tool.alias)}: \\{[^\\n]*args: \\[\"${escapeRegExp(tool.alias_arg)}\"\\][^\\n]*max_extra_args: ${Number(tool.max_extra_args)}[^\\n]*\\}`
    );
    if (!aliasPattern.test(aliasSource)) {
      errors.push(`${tool.tool_key}: alias/script/max_extra_args drift in ${manifest.alias_file}`);
    }

    if (existsSync(migrationPath)) {
      const migration = readFileSync(migrationPath, "utf8");
      for (const marker of ["admin_platform_endpoint_tools", `'${tool.tool_key}'`, tool.alias, "'/admin/control'"]) {
        if (!migration.includes(marker)) errors.push(`${tool.tool_key}: migration missing ${marker}`);
      }
    }

    if (tool.npm_script) {
      const command = packageJson.scripts?.[tool.npm_script] || "";
      if (!command.includes(tool.script)) {
        errors.push(`${tool.tool_key}: npm script ${tool.npm_script} does not target ${tool.script}`);
      }
    }

    if (tool.apply_confirmation && existsSync(scriptPath)) {
      const script = readFileSync(scriptPath, "utf8");
      if (!script.includes(tool.apply_confirmation)) {
        errors.push(`${tool.tool_key}: script missing confirmation ${tool.apply_confirmation}`);
      }
    }

    if (tool.capability_policy_migration) {
      semanticCapabilitiesChecked += 1;
      const requiredFields = [
        "semantic_capability_key",
        "apply_policy_key",
        "app_key",
        "operation_intent",
        "runtime_surface",
        "apply_confirmation",
      ];
      for (const field of requiredFields) {
        if (!tool[field]) errors.push(`${tool.tool_key}: manifest missing ${field}`);
      }

      const capabilityMigrationPath = path.join(API_DIR, tool.capability_policy_migration);
      if (!existsSync(capabilityMigrationPath)) {
        errors.push(`${tool.tool_key}: capability policy migration missing ${tool.capability_policy_migration}`);
      } else {
        const capabilityMigration = readFileSync(capabilityMigrationPath, "utf8");
        const markers = [
          "platform_semantic_capabilities",
          "capability_apply_authorization_policy_registry",
          `'${tool.semantic_capability_key}'`,
          `'${tool.apply_policy_key}'`,
          `'${tool.app_key}'`,
          `'${tool.operation_intent}'`,
          `'${tool.runtime_surface}'`,
          tool.apply_confirmation,
          "requires_typed_confirmation",
          "requires_same_cycle_dry_run",
          "transaction_rollback_required",
          "provider_call_forbidden",
          "external_write_forbidden",
          "credential_payload_read_forbidden",
          "secrets_included=false",
        ];
        for (const marker of markers) {
          if (!capabilityMigration.includes(marker)) {
            errors.push(`${tool.tool_key}: capability policy migration missing ${marker}`);
          }
        }
      }
    }

    if (tool.capability_policy_patch_migration) {
      policyPatchesChecked += 1;
      const policyPatchPath = path.join(API_DIR, tool.capability_policy_patch_migration);
      if (!existsSync(policyPatchPath)) {
        errors.push(`${tool.tool_key}: capability policy patch migration missing ${tool.capability_policy_patch_migration}`);
      } else {
        const policyPatch = readFileSync(policyPatchPath, "utf8");
        const markers = [
          "capability_apply_authorization_policy_registry",
          `'${tool.apply_policy_key}'`,
          `'${tool.semantic_capability_key}'`,
          `'${tool.app_key}'`,
          `'${tool.operation_intent}'`,
          `'${tool.runtime_surface}'`,
          "JSON_REMOVE",
          "$.confirmation_token",
          "$.required_confirmation",
          tool.apply_confirmation,
          "no_provider_call=true",
          "no_credential_payload_read=true",
          "no_external_write=true",
          "secrets_included=false",
        ];
        for (const marker of markers) {
          if (!policyPatch.includes(marker)) {
            errors.push(`${tool.tool_key}: capability policy patch migration missing ${marker}`);
          }
        }
        const removesSensitiveField = /JSON_REMOVE\s*\([\s\S]*?['"]\$\.confirmation_token['"]\s*\)/.test(policyPatch);
        const writesRequiredConfirmation = /JSON_SET\s*\([\s\S]*?['"]\$\.required_confirmation['"]/.test(policyPatch);
        if (!removesSensitiveField) {
          errors.push(`${tool.tool_key}: capability policy patch must remove the sensitive confirmation_token field`);
        }
        if (!writesRequiredConfirmation) {
          errors.push(`${tool.tool_key}: capability policy patch must write required_confirmation`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    group: manifest.group,
    tools_checked: seenToolKeys.size,
    semantic_capabilities_checked: semanticCapabilitiesChecked,
    policy_patches_checked: policyPatchesChecked,
    errors,
    secrets_included: false,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = checkSupervisorAdminToolExportSync();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
