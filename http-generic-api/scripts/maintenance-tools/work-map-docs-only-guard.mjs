#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SHA_RE = /^[a-f0-9]{40}$/u;

function readNulPaths(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

export function assertDocsOnlyPaths(paths, root = null) {
  for (const file of paths) {
    if (typeof file !== "string" || !file.startsWith("docs/work-maps/")
      || file.includes("\\") || file.includes("\0")
      || file.split("/").some((part) => part === "." || part === ".." || part === "")) {
      throw new Error("docs_only_scope_violation:" + String(file).slice(0, 256));
    }
    if (!root) continue;
    let current = root;
    for (const part of file.split("/")) {
      current = path.join(current, part);
      try {
        if (fs.lstatSync(current).isSymbolicLink()) {
          throw new Error("docs_only_symlink_forbidden:" + file);
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
}

export function inspectDocsOnlyGit({ root = REPO_ROOT, expectedHeadSha } = {}) {
  if (!SHA_RE.test(expectedHeadSha || "")) throw new Error("docs_only_expected_head_invalid");
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  git("merge-base", "--is-ancestor", expectedHeadSha, "HEAD");
  // Disable rename detection to check both source and destination paths.\n  // Covers staged + unstaged tracked files, untracked files, and already committed changes.
  const tracked = readNulPaths(git("diff", "--no-renames", "--name-only", "-z", "HEAD"));
  const untracked = readNulPaths(git("ls-files", "--others", "--exclude-standard", "-z"));
  const committed = readNulPaths(git("diff", "--no-renames", "--name-only", "-z", expectedHeadSha, "HEAD"));
  const paths = [...new Set([...tracked, ...untracked, ...committed])].sort();
  assertDocsOnlyPaths(paths, root);
  return {
    contract: "mad4b.work-map-docs-only-scope.v1",
    write_scope: "docs_only",
    expected_head_sha: expectedHeadSha,
    changed_paths: paths,
    allowed_root: "docs/work-maps",
    protected_branch_mutation: false,
    secrets_included: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--expected-head-sha");
  try {
    console.log(JSON.stringify(inspectDocsOnlyGit({ expectedHeadSha: i < 0 ? "" : process.argv[i + 1] })));
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  }
}
