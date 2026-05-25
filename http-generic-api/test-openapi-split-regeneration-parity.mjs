import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";

const GENERATED_SPLIT_FILES = [
  "openapi.tenant-gpt.auth.yaml",
  "openapi.custom-gpt.auth-dispatcher.yaml",
];

function readGeneratedSpecs(root) {
  return Object.fromEntries(
    GENERATED_SPLIT_FILES.map((file) => [file, yaml.load(readFileSync(join(root, file), "utf8"))])
  );
}

function sortedPathMethods(doc) {
  const methods = [];
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const method of Object.keys(pathItem || {}).filter((m) => ["get", "post", "put", "delete", "patch", "options", "head", "trace"].includes(m))) {
      methods.push(`${method.toUpperCase()} ${pathKey}:${pathItem[method]?.operationId || ""}`);
    }
  }
  return methods.sort();
}

function schemaKeys(doc) {
  return Object.keys(doc.components?.schemas || {}).sort();
}

function mismatchSummary(before, after) {
  const fields = [];
  for (const key of ["openapi", "servers", "security"]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) fields.push(key);
  }
  if (JSON.stringify(before.info) !== JSON.stringify(after.info)) fields.push("info");
  if (JSON.stringify(sortedPathMethods(before)) !== JSON.stringify(sortedPathMethods(after))) fields.push("paths");
  if (JSON.stringify(schemaKeys(before)) !== JSON.stringify(schemaKeys(after))) fields.push("component_schema_keys");
  if (JSON.stringify(before.components?.securitySchemes || {}) !== JSON.stringify(after.components?.securitySchemes || {})) fields.push("securitySchemes");
  return {
    fields,
    before_info: before.info,
    after_info: after.info,
    before_paths: sortedPathMethods(before),
    after_paths: sortedPathMethods(after),
    before_schema_keys: schemaKeys(before),
    after_schema_keys: schemaKeys(after),
  };
}

const sourceRoot = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "openapi-split-parity-"));

try {
  cpSync(sourceRoot, tempRoot, {
    recursive: true,
    filter: (source) => !source.includes("/node_modules") && !source.includes("/.git"),
  });

  const before = readGeneratedSpecs(tempRoot);
  execFileSync(process.execPath, [join(sourceRoot, "scripts", "split-openapi.mjs")], {
    cwd: tempRoot,
    stdio: "pipe",
    env: { ...process.env, CI: "true" },
  });
  const after = readGeneratedSpecs(tempRoot);

  for (const file of GENERATED_SPLIT_FILES) {
    try {
      assert.deepStrictEqual(after[file], before[file]);
    } catch {
      throw new Error(`${file} is not semantically regenerated from openapi.yaml: ${JSON.stringify(mismatchSummary(before[file], after[file]))}`);
    }
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("openapi split regeneration parity tests passed");
