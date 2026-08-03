import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const apiDir = path.dirname(scriptPath);
const repoRoot = path.resolve(apiDir, "..");

function run(command, args, cwd = apiDir) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}: ${result.stderr || result.error?.message || "unknown"}`);
  }
  return result.stdout;
}

const generatedSurfacePaths = [
  "docs/surface-contract-discovery-status.json",
  "docs/surface-contract-discovery-status.md",
  "docs/surface-contract-gap-queue.json",
  "docs/surface-contract-gap-queue.md",
  "docs/surface-contract-safety-attestations.json",
  "http-generic-api/resource-api-surface-callability.manifest.json",
  "http-generic-api/surface-contract-classification-evidence.json",
  "http-generic-api/test-surface-callability-full-closure.mjs",
  "http-generic-api/scripts/test-manifest.mjs",
];
const correctedSourcePaths = [
  "http-generic-api/routes/tenantLifecycleRoutes.js",
];
const exportPaths = [...generatedSurfacePaths, ...correctedSourcePaths];
const allowedChanged = new Set([
  ...exportPaths,
  "http-generic-api/frontend-operation-governance.generated.json",
  "http-generic-api/frontend-surface-dispatch.generated.json",
  "http-generic-api/openapi/frontend-runtime-routes.generated.yaml",
]);

const lifecyclePath = path.join(apiDir, "routes/tenantLifecycleRoutes.js");
const lifecycleSource = fs.readFileSync(lifecyclePath, "utf8");
const unstableCode = 'err.code || "workspace_invitations_expire_stale_failed"';
const stableCode = 'err.code || "workspace_invitations_expire_failed"';
const markerCount = lifecycleSource.split(unstableCode).length - 1;
if (markerCount !== 1) {
  throw new Error(`workspace_invitation_expire_stable_code_marker_count:${markerCount}`);
}
fs.writeFileSync(lifecyclePath, lifecycleSource.replace(unstableCode, stableCode));

run("node", ["scripts/surface-contract-discovery.mjs"]);
run("node", ["scripts/surface-callability-closure/generate_closure_contracts.mjs"]);
run("node", ["scripts/surface-contract-discovery.mjs"]);

const status = run("git", ["status", "--porcelain", "--untracked-files=all"], repoRoot);
const changed = status
  .split("\n")
  .filter(Boolean)
  .map((line) => line.slice(3).trim())
  .map((file) => file.includes(" -> ") ? file.split(" -> ").at(-1) : file);
const unexpected = changed.filter((file) => !allowedChanged.has(file));
if (unexpected.length) {
  throw new Error(`surface_export_write_set_violation:${unexpected.sort().join(",")}`);
}

const missing = exportPaths.filter((relativePath) => !fs.existsSync(path.join(repoRoot, relativePath)));
if (missing.length) {
  throw new Error(`surface_export_missing_files:${missing.join(",")}`);
}

let sourceHeadSha = null;
try {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  sourceHeadSha = event?.pull_request?.head?.sha || null;
} catch {}
const candidateSha = run("git", ["rev-parse", "HEAD"], repoRoot).trim();
const files = exportPaths.map((relativePath) => {
  const bytes = fs.readFileSync(path.join(repoRoot, relativePath));
  return {
    path: relativePath,
    encoding: "base64",
    size_bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    content_base64: bytes.toString("base64"),
  };
});
const envelope = {
  contract: "mad4b.surface-callability-generated-artifact-export.v1",
  generated_at: new Date().toISOString(),
  source_head_sha: sourceHeadSha,
  candidate_sha: candidateSha,
  generator_sequence: [
    "restore stable workspace invitation expire error code",
    "node scripts/surface-contract-discovery.mjs",
    "node scripts/surface-callability-closure/generate_closure_contracts.mjs",
    "node scripts/surface-contract-discovery.mjs",
  ],
  changed_files: changed.sort(),
  files,
  direct_repository_mutation: false,
  protected_branch_mutation: false,
  force_push: false,
  secrets_included: false,
};
fs.writeFileSync(
  path.join(apiDir, "frontend-operation-governance.generated.json"),
  `${JSON.stringify(envelope, null, 2)}\n`,
);
console.log(JSON.stringify({
  contract: envelope.contract,
  source_head_sha: envelope.source_head_sha,
  candidate_sha: envelope.candidate_sha,
  exported_files: files.length,
  total_bytes: files.reduce((sum, file) => sum + file.size_bytes, 0),
  secrets_included: false,
}));
throw new Error("surface_artifact_export_complete_intentional_test_failure");
