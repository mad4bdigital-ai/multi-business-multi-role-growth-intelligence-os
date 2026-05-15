import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const repoRoot = resolve(appDir, "..");
const packageJson = JSON.parse(readFileSync(resolve(appDir, "package.json"), "utf8"));

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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
const branch = argValue(
  "--branch",
  process.env.ACTIVATION_GITHUB_BRANCH || git(["rev-parse", "--abbrev-ref", "HEAD"])
);
const commitSha = argValue("--commit", process.env.DEPLOYMENT_COMMIT_SHA || git(["rev-parse", "HEAD"]));

const manifest = {
  repository,
  branch,
  commit_sha: commitSha,
  deployed_at: new Date().toISOString(),
  service_version: packageJson.version,
  build_source: "git",
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`deployment manifest written: ${outputPath}`);
console.log(`commit_sha: ${commitSha}`);
