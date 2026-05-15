import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_DEPLOYMENT_MANIFEST_PATH = resolve(__dirname, "deployment-manifest.json");

function parseJson(value = "") {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function normalizeManifest(raw = {}, source = "unknown") {
  return {
    source,
    repository: String(raw.repository || "").trim(),
    branch: String(raw.branch || "").trim(),
    commit_sha: String(raw.commit_sha || raw.commit || raw.sha || "").trim(),
    deployed_at: String(raw.deployed_at || "").trim(),
    service_version: String(raw.service_version || raw.version || "").trim(),
    build_source: String(raw.build_source || "").trim(),
  };
}

export function readDeploymentManifest(env = process.env) {
  const inlineManifest = parseJson(env.DEPLOYMENT_MANIFEST_JSON);
  if (inlineManifest) {
    return {
      ok: true,
      manifest: normalizeManifest(inlineManifest, "env:DEPLOYMENT_MANIFEST_JSON"),
    };
  }

  const configuredPath = String(env.DEPLOYMENT_MANIFEST_PATH || "").trim();
  const candidates = configuredPath
    ? [configuredPath]
    : [
        DEFAULT_DEPLOYMENT_MANIFEST_PATH,
        resolve(process.cwd(), "deployment-manifest.json"),
      ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const parsed = parseJson(readFileSync(path, "utf8"));
    if (!parsed) {
      return {
        ok: false,
        source: path,
        error: {
          code: "deployment_manifest_invalid_json",
          message: "Deployment manifest exists but is not valid JSON.",
        },
      };
    }
    return {
      ok: true,
      manifest: normalizeManifest(parsed, path),
    };
  }

  return {
    ok: false,
    source: "none",
    error: {
      code: "deployment_manifest_not_found",
      message: "No deployment manifest found in DEPLOYMENT_MANIFEST_JSON, DEPLOYMENT_MANIFEST_PATH, or default runtime path.",
    },
  };
}

export function classifyDeploymentProvenance({
  manifestResult = readDeploymentManifest(),
  env = process.env,
} = {}) {
  const expectedCommitSha = String(
    env.DEPLOYMENT_EXPECTED_COMMIT_SHA ||
    env.GITHUB_MAIN_HEAD_SHA ||
    ""
  ).trim();

  if (!manifestResult.ok) {
    return {
      deployment_status: "deployment_validation_incomplete",
      expected_commit_sha: expectedCommitSha || null,
      deployed_commit_sha: null,
      manifest: null,
      error: manifestResult.error,
    };
  }

  const deployedCommitSha = manifestResult.manifest.commit_sha;
  if (!deployedCommitSha) {
    return {
      deployment_status: "deployment_validation_incomplete",
      expected_commit_sha: expectedCommitSha || null,
      deployed_commit_sha: null,
      manifest: manifestResult.manifest,
      error: {
        code: "deployment_manifest_commit_missing",
        message: "Deployment manifest is present but missing commit_sha.",
      },
    };
  }

  if (!expectedCommitSha) {
    return {
      deployment_status: "deployment_commit_uncompared",
      expected_commit_sha: null,
      deployed_commit_sha: deployedCommitSha,
      manifest: manifestResult.manifest,
      error: null,
    };
  }

  const current = deployedCommitSha.toLowerCase() === expectedCommitSha.toLowerCase();
  return {
    deployment_status: current ? "deployed_current" : "deployed_stale",
    expected_commit_sha: expectedCommitSha,
    deployed_commit_sha: deployedCommitSha,
    manifest: manifestResult.manifest,
    error: current ? null : {
      code: "deployment_commit_mismatch",
      message: "Deployed manifest commit does not match the expected GitHub head commit.",
    },
  };
}

export function buildVersionPayload({ serviceVersion = "", env = process.env } = {}) {
  const manifestResult = readDeploymentManifest(env);
  const deployment = classifyDeploymentProvenance({ manifestResult, env });
  return {
    ok: deployment.deployment_status !== "deployed_stale",
    service: "http_generic_api_connector",
    version: serviceVersion,
    deployment,
    timestamp: new Date().toISOString(),
  };
}
