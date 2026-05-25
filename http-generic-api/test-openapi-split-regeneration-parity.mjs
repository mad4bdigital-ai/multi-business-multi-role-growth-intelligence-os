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
      after[file],
      before[file],
      `${file} is not semantically regenerated from openapi.yaml. Run node scripts/split-openapi.mjs and commit the generated artifact.`
    );
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("openapi split regeneration parity tests passed");
