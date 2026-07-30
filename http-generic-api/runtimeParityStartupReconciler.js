import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";
import {
  createRepositoryMainMovedTriggerEvent,
  resolveConfiguredReleaseBranch,
} from "./repositoryMainMovedTriggerService.js";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DEFAULT_MANIFEST_PATH = fileURLToPath(new URL("./deployment-manifest.json", import.meta.url));
const VERIFIED_VALUES = new Set(["1", "true", "verified", "pass", "passed"]);

function normalizeText(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeSha(value) {
  const normalized = normalizeText(value, 40).toLowerCase();
  return SHA_PATTERN.test(normalized) ? normalized : "";
}

function isVerified(value) {
  return VERIFIED_VALUES.has(normalizeText(value, 32).toLowerCase());
}

async function readManifestFile(manifestPath = DEFAULT_MANIFEST_PATH) {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

export async function reconcileRuntimeParityOnStartup(options = {}) {
  const env = options.env || process.env;
  const runtimeEnvironment = normalizeText(env.RUNTIME_ENV || env.NODE_ENV, 32).toLowerCase();
  if (runtimeEnvironment !== "production") {
    return { ok: true, status: "skipped", reason: "non_production_environment", secrets_included: false };
  }

  try {
    const readManifest = options.readManifest || (() => readManifestFile(options.manifestPath));
    const manifest = await readManifest();
    const expectedBranch = resolveConfiguredReleaseBranch(env);
    const branch = normalizeText(
      manifest?.branch || env.GITHUB_REF_NAME || env.GITHUB_BRANCH || expectedBranch,
      191,
    ).replace(/^refs\/heads\//, "");
    if (branch !== expectedBranch) {
      return {
        ok: true,
        status: "skipped",
        reason: expectedBranch === "main" ? "non_main_branch" : "non_release_branch",
        branch,
        expected_branch: expectedBranch,
        secrets_included: false,
      };
    }

    const repository = normalizeText(
      manifest?.repository || env.RELEASE_TRIGGER_REPOSITORY || env.GITHUB_REPOSITORY,
      255,
    ).toLowerCase();
    const afterSha = normalizeSha(manifest?.commit_sha);
    if (!repository || !afterSha) {
      return { ok: false, status: "degraded", reason: "invalid_deployment_manifest", secrets_included: false };
    }

    const pool = (options.getPool || getPool)();
    const [rows] = await pool.query(
      `SELECT expected_commit_sha, deployed_commit_sha, production_parity, verified_at, updated_at
         FROM runtime_deployment_parity_status
        WHERE environment_key = 'production'
        LIMIT 1`,
    );
    const parity = rows?.[0] || null;
    const deployedSha = normalizeSha(parity?.deployed_commit_sha);
    const expectedSha = normalizeSha(parity?.expected_commit_sha);

    if (deployedSha === afterSha && isVerified(parity?.production_parity)) {
      return {
        ok: true,
        status: "skipped",
        reason: "already_verified",
        deployed_commit_sha: afterSha,
        secrets_included: false,
      };
    }

    const beforeSha = [deployedSha, expectedSha].find((candidate) => candidate && candidate !== afterSha) || "";
    if (!beforeSha) {
      return {
        ok: false,
        status: "degraded",
        reason: "no_distinct_verified_baseline",
        deployed_commit_sha: afterSha,
        secrets_included: false,
      };
    }

    const sourceEventId = `runtime-startup:${afterSha}`;
    const createTrigger = options.createTrigger || createRepositoryMainMovedTriggerEvent;
    const result = await createTrigger({
      source_event_id: sourceEventId,
      repository,
      branch,
      before_sha: beforeSha,
      after_sha: afterSha,
      forced: false,
      deleted: false,
      environment_key: "production",
      occurred_at: manifest?.deployed_at || new Date().toISOString(),
    }, {
      mode: "runtime_parity_startup_reconciler",
    }, {
      pool,
      env,
      allowDeploymentBranch: true,
    });

    return {
      ok: true,
      status: result?.deduplicated ? "deduplicated" : "triggered",
      source_event_id: sourceEventId,
      before_sha: beforeSha,
      after_sha: afterSha,
      trigger_event_id: result?.trigger_event?.trigger_event_id || null,
      coordination_status: result?.trigger_event?.coordination_status || null,
      secrets_included: false,
    };
  } catch (error) {
    return {
      ok: false,
      status: "degraded",
      reason: "startup_reconciliation_failed",
      error_code: normalizeText(error?.code || "runtime_parity_startup_reconciliation_failed", 128),
      secrets_included: false,
    };
  }
}
