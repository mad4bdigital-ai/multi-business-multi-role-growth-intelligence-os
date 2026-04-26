import { Router } from "express";
import {
  githubApplyFileUpdates,
  githubValidatedApplyFileUpdates,
  githubGetPRStatus,
  githubMergePR,
  githubPreviewFileUpdates,
  githubCommentOnPR
} from "../github.js";

function newRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function buildGithubRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  router.post("/github/apply-file-updates", requireBackendApiKey, async (req, res) => {
    const request_id = newRequestId();
    try {
      const result = await githubApplyFileUpdates({
        input: req.body || {}
      });

      return res.status(200).json({ ...result, request_id });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        request_id,
        error: {
          code: err.code || "github_apply_file_updates_failed",
          message: err.message || "GitHub file update flow failed.",
          details: err.details || null
        }
      });
    }
  });

  router.post("/github/validated-apply-file-updates", requireBackendApiKey, async (req, res) => {
    const request_id = newRequestId();
    try {
      const result = await githubValidatedApplyFileUpdates({
        input: req.body || {}
      });

      return res.status(200).json({ ...result, request_id });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        request_id,
        error: {
          code: err.code || "github_validated_apply_file_updates_failed",
          message: err.message || "GitHub validated file update flow failed.",
          details: err.details || null
        }
      });
    }
  });

  router.get("/github/pr-status", requireBackendApiKey, async (req, res) => {
    const request_id = newRequestId();
    try {
      const result = await githubGetPRStatus({
        input: {
          owner: req.query.owner,
          repo: req.query.repo,
          pull_number: req.query.pull_number
        }
      });

      return res.status(200).json({ ...result, request_id });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        request_id,
        error: {
          code: err.code || "github_pr_status_failed",
          message: err.message || "GitHub PR status fetch failed.",
          details: err.details || null
        }
      });
    }
  });

  router.post("/github/merge-pr", requireBackendApiKey, async (req, res) => {
    const request_id = newRequestId();
    try {
      const result = await githubMergePR({
        input: req.body || {}
      });

      return res.status(200).json({ ...result, request_id });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        request_id,
        error: {
          code: err.code || "github_merge_pr_failed",
          message: err.message || "GitHub PR merge failed.",
          details: err.details || null,
          ci_status: err.ci_status || null
        }
      });
    }
  });

  router.post("/github/preview-file-updates", requireBackendApiKey, async (req, res) => {
    const request_id = newRequestId();
    try {
      const result = await githubPreviewFileUpdates({
        input: req.body || {}
      });

      return res.status(200).json({ ...result, request_id });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        request_id,
        error: {
          code: err.code || "github_preview_file_updates_failed",
          message: err.message || "GitHub preview file updates failed.",
          details: err.details || null
        }
      });
    }
  });

  router.post("/github/comment-on-pr", requireBackendApiKey, async (req, res) => {
    const request_id = newRequestId();
    try {
      const result = await githubCommentOnPR({
        input: req.body || {}
      });

      return res.status(200).json({ ...result, request_id });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        request_id,
        error: {
          code: err.code || "github_comment_on_pr_failed",
          message: err.message || "GitHub PR comment creation failed.",
          details: err.details || null
        }
      });
    }
  });

  return router;
}
