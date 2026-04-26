import { Router } from "express";
import {
  githubApplyFileUpdates,
  githubValidatedApplyFileUpdates
} from "../github.js";

export function buildGithubRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  router.post("/github/apply-file-updates", requireBackendApiKey, async (req, res) => {
    try {
      const result = await githubApplyFileUpdates({
        input: req.body || {}
      });

      return res.status(200).json(result);
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "github_apply_file_updates_failed",
          message: err.message || "GitHub file update flow failed.",
          details: err.details || null
        }
      });
    }
  });

  router.post("/github/validated-apply-file-updates", requireBackendApiKey, async (req, res) => {
    try {
      const result = await githubValidatedApplyFileUpdates({
        input: req.body || {}
      });

      return res.status(200).json(result);
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "github_validated_apply_file_updates_failed",
          message: err.message || "GitHub validated file update flow failed.",
          details: err.details || null
        }
      });
    }
  });

  return router;
}
