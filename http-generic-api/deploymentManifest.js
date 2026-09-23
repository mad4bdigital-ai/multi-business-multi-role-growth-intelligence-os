import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_DEPLOYMENT_MANIFEST_PATH = resolve(__dirname, "deployment-manifest.json");

const SHA_RE = /^[0-9a-f]{40}$/iu;

function parseJson(value = "") {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function normalizeDeploymentBranch(value) {
  const branch = String(value || "").trim();
  return branch.toLowerCase() === "main" ? "main" : branch;
}

function normalizeManifest(raw = {}, source = "unknown", env = process.env) {
  return {
    source,
    repository: String(raw.repository || raw.repo || env.GITHUB_REPOSITORY || env.DEPLOY_REPOSITORY || "").trim(),
    branch: normalizeDeploymentBranch(raw.branch || raw.ref_name || env.GITHUB_REF_NAME || env.DEPLOY_BRANCH || env.BRANCH_NAME || ""),
    branch_source: String(raw.branch_source || "").trim(),
    commit_sha: String(raw.commit_sha || raw.commit || raw.sha || raw.revision_sha || "").trim().toLowerCase(),
    commit_source: String(raw.commit_source || "").trim(),
    tree_sha: String(raw.tree_sha || "").trim().toLowerCase(),
    tree_source: String(raw.tree_source || "").trim(),
    context_file_set_sha256: String(raw.context_file_set_sha256 || "").trim().toLowerCase(),
    context_source: String(raw.context_source || "").trim(),
    image_digest: String(raw.image_digest || raw.image_id || env.STAGING_APP_IMAGE_ID || "").trim(),
    secrets_included: raw.secrets_included === false ? false : null,
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
      manifest: normalizeManifest(inlineManifest, "env:DEPLOYMENT_MANIFEST_JSON", env),
    };
  }

  const inlineCommit = parseJson(env.DEPLOYMENT_COMMIT_JSON);
  if (inlineCommit) {
    return {
      ok: true,
      manifest: normalizeManifest(inlineCommit, "env:DEPLOYMENT_COMMIT_JSON", env),
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
      manifest: normalizeManifest(parsed, path, env),
    };
  }

  return {
    ok: false,
    source: "none",
    error: {
      code: "deployment_manifest_not_found",
      message: "No deployment manifest found in DEPLOYMENT_MANIFEST_JSON, DEPLOYMENT_COMMIT_JSON, DEPLOYMENT_MANIFEST_PATH, or default runtime path.",
    },
  };
}

export function readCanonicalDeploymentIdentity({ env = process.env, requireManifest = false } = {}) {
  const manifestResult = readDeploymentManifest(env);
  if (manifestResult.ok) {
    const manifest = manifestResult.manifest;
    return {
      ok: Boolean(manifest.repository && manifest.branch && SHA_RE.test(manifest.commit_sha)),
      source: manifest.source,
      repository: manifest.repository || null,
      branch: manifest.branch || null,
      sha: SHA_RE.test(manifest.commit_sha) ? manifest.commit_sha.toLowerCase() : (manifest.commit_sha || null),
      commit_sha: SHA_RE.test(manifest.commit_sha) ? manifest.commit_sha.toLowerCase() : (manifest.commit_sha || null),
      manifest_bound: true,
      manifest,
      error: null,
      secrets_included: false,
    };
  }

  if (requireManifest) {
    return {
      ok: false,
      source: manifestResult.source || "none",
      repository: null,
      branch: null,
      sha: null,
      commit_sha: null,
      manifest_bound: false,
      manifest: null,
      error: manifestResult.error,
      secrets_included: false,
    };
  }

  const repository = String(env.GITHUB_REPOSITORY || env.DEPLOY_REPOSITORY || "").trim() || null;
  const branch = normalizeDeploymentBranch(env.GITHUB_REF_NAME || env.DEPLOY_BRANCH || env.BRANCH_NAME || "") || null;
  const sha = String(env.GITHUB_SHA || env.DEPLOY_COMMIT || env.COMMIT_SHA || env.REVISION_SHA || "").trim().toLowerCase() || null;
  return {
    ok: Boolean(repository && branch && SHA_RE.test(sha || "")),
    source: "env:fallback",
    repository,
    branch,
    sha,
    commit_sha: sha,
    manifest_bound: false,
    manifest: null,
    error: manifestResult.error,
    secrets_included: false,
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
  const canonicalManifest = deployment.manifest || null;
  const canonicalCommit = String(canonicalManifest?.commit_sha || "").trim();
  const canonicalBranch = String(canonicalManifest?.branch || "").trim();
  return {
    ok: deployment.deployment_status !== "deployed_stale",
    service: "http_generic_api_connector",
    version: serviceVersion,
    gitCommitFull: /^[0-9a-f]{40}$/iu.test(canonicalCommit) ? canonicalCommit.toLowerCase() : null,
    gitBranch: canonicalBranch || null,
    provenanceSource: canonicalManifest?.source || null,
    deployment,
    timestamp: new Date().toISOString(),
  };
}
