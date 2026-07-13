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
  }

  return {
    ok: errors.length === 0,
    group: manifest.group,
    tools_checked: seenToolKeys.size,
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
