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

export function buildDeploymentInfoRoutes() {
  const router = Router();

  router.get("/deployment-info", async (req, res) => {
    const deployment = await readDeploymentCommit();
    res.status(200).json({
      ok: true,
      service: "growth-intelligence-platform",
      hostname: req.headers.host || null,
      branch: deployment?.branch || process.env.GITHUB_REF_NAME || process.env.DEPLOY_BRANCH || null,
      commit: deployment?.commit || process.env.GITHUB_SHA || process.env.DEPLOY_COMMIT || null,
      deployment,
      app_env: process.env.APP_ENV || process.env.NODE_ENV || null,
      expected_dev_branch: "dev-autopilot-routing",
      is_dev_hostname: String(req.headers.host || "").toLowerCase().startsWith("dev.mad4b.com"),
      generated_at: new Date().toISOString(),
    });
  });

  return router;
}
