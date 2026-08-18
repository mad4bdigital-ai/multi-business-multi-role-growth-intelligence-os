import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const repoRoot = resolve(appDir, "..");

export const ROOT_ENTRYPOINT_BRANCH_LOCK_ENV = "DEPLOYMENT_MANIFEST_AUTHORITATIVE_BRANCH";

function git(args, cwd = repoRoot) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function argValue(argv, name, fallback = "") {
  const prefix = `${name}=`;
  const entry = argv.find((arg) => arg === name || arg.startsWith(prefix));
  if (!entry) return fallback;
  if (entry === name) return "true";
  return entry.slice(prefix.length);
}

function normalizeDeploymentBranch(value) {
  const branch = String(value || "").trim();
  return branch.toLowerCase() === "main" ? "main" : branch;
}

export function generateDeploymentManifest({
  env = process.env,
  argv = process.argv.slice(2),
  outputPath: explicitOutputPath,
  deployedAt = new Date().toISOString(),
} = {}) {
  const packageJson = JSON.parse(readFileSync(resolve(appDir, "package.json"), "utf8"));
  const outputPath = resolve(appDir, explicitOutputPath || argValue(argv, "--out", "deployment-manifest.json"));
  const repository = argValue(
    argv,
    "--repository",
    env.ACTIVATION_GITHUB_REPOSITORY || "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"
  );
  const gitBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branchCandidates = [
    ["arg:--branch", argValue(argv, "--branch")],
    [`env:${ROOT_ENTRYPOINT_BRANCH_LOCK_ENV}`, env[ROOT_ENTRYPOINT_BRANCH_LOCK_ENV]],
    ["env:DEPLOYMENT_BRANCH", env.DEPLOYMENT_BRANCH],
    ["env:DEPLOY_BRANCH", env.DEPLOY_BRANCH],
    ["env:BRANCH_NAME", env.BRANCH_NAME],
    ["env:GITHUB_REF_NAME", env.GITHUB_REF_NAME],
    ["env:ACTIVATION_GITHUB_BRANCH", env.ACTIVATION_GITHUB_BRANCH],
    ["git", gitBranch === "HEAD" ? "" : gitBranch],
  ];
  const [branchSource, rawBranch] = branchCandidates.find(([, value]) => String(value || "").trim()) || ["unavailable", ""];
  const branch = normalizeDeploymentBranch(rawBranch);
  const isStaging = [env.NODE_ENV, env.APP_ENV].some((value) => String(value || "").trim().toLowerCase() === "staging");
  const commitCandidates = isStaging
    ? [
        ["arg:--commit", argValue(argv, "--commit")],
        ["env:DEPLOY_COMMIT", env.DEPLOY_COMMIT],
        ["env:DEPLOYMENT_EXPECTED_COMMIT_SHA", env.DEPLOYMENT_EXPECTED_COMMIT_SHA],
        ["env:DEPLOYMENT_COMMIT_SHA", env.DEPLOYMENT_COMMIT_SHA],
        ["env:GITHUB_SHA", env.GITHUB_SHA],
        ["env:COMMIT_SHA", env.COMMIT_SHA],
        ["env:REVISION_SHA", env.REVISION_SHA],
        ["git", git(["rev-parse", "HEAD"])],
      ]
    : [
        ["arg:--commit", argValue(argv, "--commit")],
        ["env:DEPLOYMENT_COMMIT_SHA", env.DEPLOYMENT_COMMIT_SHA],
        ["env:GITHUB_SHA", env.GITHUB_SHA],
        ["env:DEPLOY_COMMIT", env.DEPLOY_COMMIT],
        ["env:COMMIT_SHA", env.COMMIT_SHA],
        ["env:REVISION_SHA", env.REVISION_SHA],
        ["git", git(["rev-parse", "HEAD"])],
      ];
  const [commitSource, commitSha] = commitCandidates.find(([, value]) => String(value || "").trim()) || ["unavailable", ""];
  const stagingTree = String(env.STAGING_BUILD_TREE || "").trim().toLowerCase();
  const stagingContextFileSet = String(env.STAGING_BUILD_CONTEXT_FILE_SET_SHA256 || "").trim().toLowerCase();
  const stagingImageDigest = String(env.STAGING_APP_IMAGE_ID || "").trim().toLowerCase();
  if (isStaging) {
    if (!/^[0-9a-f]{40}$/.test(stagingTree)) {
      throw new Error("Staging deployment manifest requires STAGING_BUILD_TREE exact provenance");
    }
    if (!/^[0-9a-f]{64}$/.test(stagingContextFileSet)) {
      throw new Error("Staging deployment manifest requires STAGING_BUILD_CONTEXT_FILE_SET_SHA256 exact provenance");
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(stagingImageDigest)) {
      throw new Error("Staging deployment manifest requires STAGING_APP_IMAGE_ID content-addressed provenance");
    }
  }

  const manifest = {
    repository,
    branch,
    branch_source: branchSource,
    commit_sha: commitSha,
    commit_source: commitSource,
    ...(isStaging ? {
      tree_sha: stagingTree,
      tree_source: "git_archive_exact_commit",
      context_file_set_sha256: stagingContextFileSet,
      context_source: "git_archive_exact_commit",
      image_digest: stagingImageDigest,
    } : {}),
    deployed_at: deployedAt,
    service_version: packageJson.version,
    build_source: isStaging ? "portable_staging_docker_build" : "git",
    secrets_included: false,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { ok: true, output_path: outputPath, manifest, secrets_included: false };
}

export function isDirectExecution(importMetaUrl, argvPath) {
  if (!argvPath) return false;
  return resolve(fileURLToPath(importMetaUrl)) === resolve(argvPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const result = generateDeploymentManifest();
  console.log(`deployment manifest written: ${result.output_path}`);
  console.log(`commit_sha: ${result.manifest.commit_sha || "unavailable"}`);
}
