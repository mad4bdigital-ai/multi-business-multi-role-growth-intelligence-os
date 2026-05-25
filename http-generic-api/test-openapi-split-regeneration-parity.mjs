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
const METHODS = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);

function readGeneratedSpecs(root) {
  return Object.fromEntries(
    GENERATED_SPLIT_FILES.map((file) => [file, yaml.load(readFileSync(join(root, file), "utf8"))])
  );
}

function sortedOperationSignatures(doc) {
  const signatures = [];
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const method of Object.keys(pathItem || {}).filter((m) => METHODS.has(m))) {
      const op = pathItem[method] || {};
      signatures.push([
        method.toUpperCase(),
        pathKey,
        op.operationId || "",
        op["x-openai-isConsequential"] === true ? "consequential" : "non_consequential",
      ].join(" "));
    }
  }
  return signatures.sort();
}

function securitySchemeNames(doc) {
  return Object.keys(doc.components?.securitySchemes || {}).sort();
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
    assert.deepStrictEqual(
      sortedOperationSignatures(after[file]),
      sortedOperationSignatures(before[file]),
      `${file} regenerated operations differ from the committed split artifact.`
    );
    assert.deepStrictEqual(
      securitySchemeNames(after[file]),
      securitySchemeNames(before[file]),
      `${file} regenerated security schemes differ from the committed split artifact.`
    );
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("openapi split regeneration operation parity tests passed");
