import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const scriptPath = new URL("./scripts/local-project-path-repair.mjs", import.meta.url);
const scriptFile = fileURLToPath(scriptPath);
const source = await readFile(scriptPath, "utf8");

assert(source.includes("canonicalExistingPath"), "repair must canonicalize source and target paths");
assert(source.includes("canonicalAllowedRoots"), "repair must resolve allowlisted roots through realpath");
assert(source.includes("assertWithinAllowedRoots"), "repair apply mode must enforce allowlisted file roots");
assert(source.includes("safeRelativePath"), "repair must reject traversal in relative file paths");
assert(source.includes("entry.isSymbolicLink()"), "repair walk must skip symlinks");
assert(source.includes("local_project_path_target_escape_blocked"), "repair must block target root escape");
assert(source.includes("Symlinks are skipped"), "repair output must disclose symlink handling");

const root = await mkdtemp(path.join(os.tmpdir(), "local-path-repair-security-"));
try {
  const sourceDir = path.join(root, "source");
  const targetDir = path.join(root, "target");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(sourceDir, "file.txt"), "hello\n", "utf8");

  const dryRun = await run(process.execPath, [
    scriptFile,
    `--source-path=${sourceDir}`,
    `--target-path=${targetDir}`,
    "--dry-run",
  ]);
  const dryPayload = JSON.parse(dryRun.stdout);
  assert.equal(dryPayload.ok, true);
  assert.equal(dryPayload.filesMissing, 1);
  assert.equal(dryPayload.filesCopied, 0);

  await assert.rejects(
    run(process.execPath, [
      scriptFile,
      `--source-path=${sourceDir}`,
      `--target-path=${targetDir}`,
      "--apply",
    ]),
    (err) => err?.stderr?.includes("local_project_path_allowed_root_required"),
  );

  const applied = await run(process.execPath, [
    scriptFile,
    `--source-path=${sourceDir}`,
    `--target-path=${targetDir}`,
    `--allowed-roots=${root}`,
    "--apply",
  ]);
  const applyPayload = JSON.parse(applied.stdout);
  assert.equal(applyPayload.ok, true);
  assert.equal(applyPayload.filesCopied, 1);
  assert.equal(await readFile(path.join(targetDir, "file.txt"), "utf8"), "hello\n");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("local project path repair security tests passed");
