import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const repoRoot = resolve(appDir, "..");
const packageJson = JSON.parse(readFileSync(resolve(appDir, "package.json"), "utf8"));

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((arg) => arg === name || arg.startsWith(prefix));
  if (!entry) return fallback;
  if (entry === name) return "true";
  return entry.slice(prefix.length);
}

const outputPath = resolve(appDir, argValue("--out", "deployment-manifest.json"));
const repository = argValue(
  "--repository",
  process.env.ACTIVATION_GITHUB_REPOSITORY || "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"
);
const gitBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const branchCandidates = [
  ["arg:--branch", argValue("--branch")],
  ["env:DEPLOYMENT_BRANCH", process.env.DEPLOYMENT_BRANCH],
  ["env:DEPLOY_BRANCH", process.env.DEPLOY_BRANCH],
  ["env:BRANCH_NAME", process.env.BRANCH_NAME],
  ["env:GITHUB_REF_NAME", process.env.GITHUB_REF_NAME],
  ["env:ACTIVATION_GITHUB_BRANCH", process.env.ACTIVATION_GITHUB_BRANCH],
  ["git", gitBranch === "HEAD" ? "" : gitBranch],
];
const [branchSource, branch] = branchCandidates.find(([, value]) => String(value || "").trim()) || ["unavailable", ""];
const commitCandidates = [
  ["arg:--commit", argValue("--commit")],
  ["env:DEPLOYMENT_COMMIT_SHA", process.env.DEPLOYMENT_COMMIT_SHA],
  ["env:GITHUB_SHA", process.env.GITHUB_SHA],
  ["env:DEPLOY_COMMIT", process.env.DEPLOY_COMMIT],
  ["env:COMMIT_SHA", process.env.COMMIT_SHA],
  ["env:REVISION_SHA", process.env.REVISION_SHA],
  ["git", git(["rev-parse", "HEAD"])],
];
const [commitSource, commitSha] = commitCandidates.find(([, value]) => String(value || "").trim()) || ["unavailable", ""];

const manifest = {
  repository,
  branch,
  branch_source: branchSource,
  commit_sha: commitSha,
  commit_source: commitSource,
  deployed_at: new Date().toISOString(),
  service_version: packageJson.version,
  build_source: "git",
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`deployment manifest written: ${outputPath}`);
console.log(`commit_sha: ${commitSha || "unavailable"}`);
