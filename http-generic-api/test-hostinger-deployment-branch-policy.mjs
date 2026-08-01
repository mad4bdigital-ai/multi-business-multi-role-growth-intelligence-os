import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(__dirname, "..");

function readRepositoryFile(path) {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

const policy = JSON.parse(
  readFileSync(join(__dirname, "config/deployment-branch-policy.json"), "utf8")
);

assert.equal(policy.schema_version, "mad4b.deployment-branch-policy.v1");
assert.equal(policy.source_of_change.branch, "main");
assert.equal(policy.source_of_change.production_deploy_authority, false);

assert.deepEqual(
  {
    hostname: policy.production.hostname,
    source_branch: policy.production.source_branch,
    upstream_branch: policy.production.upstream_branch,
    deployment_mode: policy.production.deployment_mode,
    auto_deploy_on_push: policy.production.auto_deploy_on_push,
    required_environment_branch: policy.production.required_environment_branch,
  },
  {
    hostname: "auth.mad4b.com",
    source_branch: "Production",
    upstream_branch: "main",
    deployment_mode: "hostinger_auto_deploy",
    auto_deploy_on_push: true,
    required_environment_branch: "Production",
  },
  "production must deploy through Hostinger Auto Deploy from the protected Production branch"
);

assert.deepEqual(
  {
    hostname: policy.staging.hostname,
    source_branch: policy.staging.source_branch,
    runtime_location: policy.staging.runtime_location,
    lifecycle_status: policy.staging.lifecycle_status,
    deployment_mode: policy.staging.deployment_mode,
    hostinger_auto_deploy: policy.staging.hostinger_auto_deploy,
  },
  {
    hostname: "dev.mad4b.com",
    source_branch: "main",
    runtime_location: "local_device",
    lifecycle_status: "planned",
    deployment_mode: "local_staging_runtime",
    hostinger_auto_deploy: false,
  },
  "main must remain the source for the planned local staging runtime, not Hostinger production"
);

assert.deepEqual(
  {
    source_branch: policy.promotion.source_branch,
    target_branch: policy.promotion.target_branch,
    mode: policy.promotion.mode,
    force_push_allowed: policy.promotion.force_push_allowed,
  },
  {
    source_branch: "main",
    target_branch: "Production",
    mode: "governed_pull_request",
    force_push_allowed: false,
  },
  "production promotion must be a governed main-to-Production pull request"
);

const hostingerGuide = readRepositoryFile("docs/hostinger-node-deploy.md");
const runtimeSyncGuide = readRepositoryFile("http-generic-api/docs/hostinger-runtime-sync-runbook.md");
const developmentGuide = readRepositoryFile("docs/development-environment-governance.md");
const topLevelInstructions = readRepositoryFile("Top Level Instructions.md");
const agentGuide = readRepositoryFile("AI_Agent_Knowledge_Guide.md");
const rootPackage = JSON.parse(readRepositoryFile("package.json"));
const nodeVersion = readRepositoryFile(".nvmrc").trim();

assert(hostingerGuide.includes("auth.mad4b.com` | Production control plane | `Production` | Hostinger Auto Deploy"));
assert(hostingerGuide.includes("A push or merge to `main` must not deploy production directly."));
assert(hostingerGuide.includes("DEPLOYMENT_BRANCH=Production"));
assert(hostingerGuide.includes("dev.mad4b.com` | Planned local staging runtime | `main` | Local device"));

assert(runtimeSyncGuide.includes("`Production` is the only Hostinger Auto Deploy source for `auth.mad4b.com`."));
assert(runtimeSyncGuide.includes("`main` is the source-of-change branch and the source for the planned local staging runtime."));
assert(runtimeSyncGuide.includes("Hostinger must build the exact resulting `Production` SHA"));

assert(developmentGuide.includes("`main` is the source branch for the planned local staging runtime at `dev.mad4b.com`."));
assert(developmentGuide.includes("It is not the Hostinger production deployment branch."));
assert(developmentGuide.includes("`Production` | Hostinger Auto Deploy"));

assert(topLevelInstructions.includes("`auth.mad4b.com` is deployed by Hostinger Auto Deploy from protected `Production` only."));
assert(topLevelInstructions.includes("`main` remains the source of change and the source for the planned local `dev.mad4b.com` staging runtime."));
assert(agentGuide.includes("synchronize the protected `Production` branch from the exact latest `main`"));
assert(agentGuide.includes("Hostinger must create a fresh build from the resulting `Production` merge"));

const forbiddenCurrentPolicyPatterns = [
  /auth\.mad4b\.com\s*->\s*main/i,
  /push\/merge to main\s*->\s*Hostinger Auto Deploy\s*->\s*auth\.mad4b\.com/i,
  /Enable Auto deploy on push to `main`/i,
  /normal `main` auto-deploy/i,
  /pull the latest `main` commit/i,
  /production is `auth\.mad4b\.com` on `main`/i,
  /Production remains `auth\.mad4b\.com` and is expected to track `main`/i,
];

for (const [path, source] of [
  ["docs/hostinger-node-deploy.md", hostingerGuide],
  ["http-generic-api/docs/hostinger-runtime-sync-runbook.md", runtimeSyncGuide],
  ["docs/development-environment-governance.md", developmentGuide],
  ["Top Level Instructions.md", topLevelInstructions],
]) {
  for (const pattern of forbiddenCurrentPolicyPatterns) {
    assert.equal(
      pattern.test(source),
      false,
      `${path} must not reintroduce direct main-to-Hostinger production deployment wording: ${pattern}`
    );
  }
}

assert.equal(rootPackage.scripts.start, "node server.js");
assert.equal(nodeVersion, "22");

console.log("Hostinger deployment branch policy guard passed");
