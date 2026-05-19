import { Router } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function readDeploymentCommit() {
  const file = path.resolve(process.cwd(), "DEPLOYMENT_COMMIT.json");
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function firstString(...values) {
  for (const value of values) {
    const str = String(value || "").trim();
    if (str) return str;
  }
  return null;
}

function sourceFor(value, pairs = []) {
  if (!value) return "unavailable";
  for (const [source, candidate] of pairs) {
    if (String(candidate || "").trim() === value) return source;
  }
  return "derived";
}

export function buildDeploymentInfoRoutes() {
  const router = Router();

  router.get("/deployment-info", async (req, res) => {
    const deployment = await readDeploymentCommit();
    const host = String(req.headers.host || "").toLowerCase();
    const isDevHostname = host.startsWith("dev.mad4b.com");
    const branch = firstString(
      deployment?.branch,
      process.env.GITHUB_REF_NAME,
      process.env.DEPLOY_BRANCH,
      process.env.BRANCH_NAME,
      isDevHostname ? "dev-autopilot-routing" : null
    );
    const commitSha = firstString(
      deployment?.commit_sha,
      deployment?.commit,
      process.env.GITHUB_SHA,
      process.env.DEPLOY_COMMIT,
      process.env.COMMIT_SHA,
      process.env.REVISION_SHA
    );

    res.status(200).json({
      ok: true,
      service: "growth-intelligence-platform",
      hostname: req.headers.host || null,
      branch,
      branch_source: sourceFor(branch, [
        ["DEPLOYMENT_COMMIT.json", deployment?.branch],
        ["GITHUB_REF_NAME", process.env.GITHUB_REF_NAME],
        ["DEPLOY_BRANCH", process.env.DEPLOY_BRANCH],
        ["BRANCH_NAME", process.env.BRANCH_NAME],
        ["dev_hostname_fallback", isDevHostname ? "dev-autopilot-routing" : null],
      ]),
      commit: commitSha,
      commit_sha: commitSha,
      commit_source: sourceFor(commitSha, [
        ["DEPLOYMENT_COMMIT.json", deployment?.commit_sha || deployment?.commit],
        ["GITHUB_SHA", process.env.GITHUB_SHA],
        ["DEPLOY_COMMIT", process.env.DEPLOY_COMMIT],
        ["COMMIT_SHA", process.env.COMMIT_SHA],
        ["REVISION_SHA", process.env.REVISION_SHA],
      ]),
      deployment,
      app_env: process.env.APP_ENV || process.env.NODE_ENV || null,
      expected_dev_branch: "dev-autopilot-routing",
      is_dev_hostname: isDevHostname,
      generated_at: new Date().toISOString(),
    });
  });

  return router;
}
