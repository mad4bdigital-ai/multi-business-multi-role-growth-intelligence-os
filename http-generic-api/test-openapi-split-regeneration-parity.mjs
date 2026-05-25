import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const GENERATED_SPLIT_FILES = [
  "openapi.tenant-gpt.auth.yaml",
  "openapi.custom-gpt.auth-dispatcher.yaml",
];

function readGeneratedFiles(root) {
  return Object.fromEntries(
    GENERATED_SPLIT_FILES.map((file) => [file, readFileSync(join(root, file), "utf8")])
  );
}

const tempRoot = mkdtempSync(join(tmpdir(), "openapi-split-parity-"));

try {
  cpSync(process.cwd(), tempRoot, {
    recursive: true,
    filter: (source) => !source.includes("/node_modules") && !source.includes("/.git"),
  });

  const before = readGeneratedFiles(tempRoot);
  execFileSync(process.execPath, ["scripts/split-openapi.mjs"], {
    cwd: tempRoot,
    stdio: "pipe",
    env: { ...process.env, CI: "true" },
  });
  const after = readGeneratedFiles(tempRoot);

  for (const file of GENERATED_SPLIT_FILES) {
    assert.equal(
      after[file],
      before[file],
      `${file} is not regenerated from openapi.yaml. Run node scripts/split-openapi.mjs and commit the generated artifact.`
    );
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("openapi split regeneration parity tests passed");
