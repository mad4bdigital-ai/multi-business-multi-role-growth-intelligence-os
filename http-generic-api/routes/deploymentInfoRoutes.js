import { Router } from "express";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

async function fileMtimeIso(file) {
  try {
    const s = await stat(file);
    return s?.mtime ? new Date(s.mtime).toISOString() : null;
  } catch {
    return null;
  }
}

async function readJsonFile(file) {
  try {
    const raw = await readFile(file, "utf8");
    const json = JSON.parse(raw);
    return { json, mtime: await fileMtimeIso(file), file };
  } catch {
    return null;
  }
}

async function readDeploymentCommit() {
  const candidates = [
    path.resolve(process.cwd(), "DEPLOYMENT_COMMIT.json"),
    path.resolve(process.cwd(), "http-generic-api", "DEPLOYMENT_COMMIT.json"),
  ];
  for (const file of candidates) {
    const value = await readJsonFile(file);
    if (value?.json) return { ...value.json, _source_file: value.file, _source_mtime: value.mtime };
  }
  return null;
}

function sanitizeDeploymentManifest(deployment) {
  if (!deployment) return { present: false };
  const safe = { ...deployment };
  delete safe._source_file;
  safe.present = true;
  safe.source = "DEPLOYMENT_COMMIT.json";
  safe.source_file_detected = Boolean(deployment._source_file);
  safe.source_mtime = deployment._source_mtime || null;
  return safe;
}

function firstString(...values) {
  for (const value of values) {
    const str = String(value || "").trim();
    if (str) return str;
  }
  return null;
}

function normalizeIso(value) {
  const str = String(value || "").trim();
  if (!str) return null;
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstIso(...values) {
  for (const value of values) {
    const iso = normalizeIso(value);
    if (iso) return iso;
  }
  return null;
}

function sourceFor(value, pairs = []) {
  if (!value) return "unavailable";
  for (const [source, candidate] of pairs) {
    if (String(candidate || "").trim() === value) return source;
    if (normalizeIso(candidate) && normalizeIso(candidate) === value) return source;
  }
  return "derived";
}

function looksLikeSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value || "").trim());
}

function branchFromRef(refName) {
  const value = String(refName || "").trim();
  if (!value.startsWith("refs/heads/")) return null;
  return value.slice("refs/heads/".length) || null;
}

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function findGitDir() {
  const candidates = [
    path.resolve(process.cwd(), ".git"),
    path.resolve(process.cwd(), "..", ".git"),
    path.resolve(process.cwd(), "http-generic-api", "..", ".git"),
  ];
  for (const candidate of candidates) {
    const head = await readText(path.join(candidate, "HEAD"));
    if (head) return candidate;
  }
  return null;
}

async function readPackedRef(gitDir, refName) {
  const raw = await readText(path.join(gitDir, "packed-refs"));
  if (!raw) return null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === refName && looksLikeSha(sha)) return sha;
  }
  return null;
}

async function readGitCheckoutInfo() {
  const gitDir = await findGitDir();
  if (!gitDir) return null;
  const headFile = path.join(gitDir, "HEAD");
  const headRaw = String(await readText(headFile) || "").trim();
  if (!headRaw) return null;
  const headMtime = await fileMtimeIso(headFile);

  if (looksLikeSha(headRaw)) {
    return { branch: null, commit_sha: headRaw, git_source: "git_head_detached", git_dir_detected: true, head_mtime: headMtime };
  }

  const m = headRaw.match(/^ref:\s*(.+)$/);
  if (!m) return null;
  const refName = m[1].trim();
  const refFile = path.join(gitDir, refName);
  const directSha = String(await readText(refFile) || "").trim();
  const packedSha = directSha ? null : await readPackedRef(gitDir, refName);
  const commitSha = looksLikeSha(directSha) ? directSha : packedSha;
  const refMtime = await fileMtimeIso(refFile);
  return {
    branch: branchFromRef(refName),
    commit_sha: commitSha || null,
    git_ref: refName,
    git_source: commitSha ? (directSha ? "git_ref_file" : "git_packed_refs") : "git_ref_unresolved",
    git_dir_detected: true,
    head_mtime: headMtime,
    ref_mtime: refMtime,
  };
}

export function buildDeploymentInfoRoutes() {
  const router = Router();

  router.get("/deployment-info", async (req, res) => {
    const deployment = await readDeploymentCommit();
    const git = await readGitCheckoutInfo();
    const host = String(req.headers.host || "").toLowerCase();
    const isDevHostname = host.startsWith("dev.mad4b.com");
    const expectedDevBranch = firstString(process.env.DEV_DEPLOYMENT_BRANCH, process.env.GOVERNED_DEV_BRANCH, "dev");
    const branch = firstString(
      deployment?.branch,
      process.env.GITHUB_REF_NAME,
      process.env.DEPLOY_BRANCH,
      process.env.BRANCH_NAME,
      git?.branch,
      isDevHostname ? expectedDevBranch : null
    );
    const commitSha = firstString(
      deployment?.commit_sha,
      deployment?.commit,
      process.env.GITHUB_SHA,
      process.env.DEPLOY_COMMIT,
      process.env.COMMIT_SHA,
      process.env.REVISION_SHA,
      git?.commit_sha
    );
    const deployedAt = firstIso(
      deployment?.deployed_at,
      deployment?.generated_at,
      deployment?._source_mtime,
      process.env.DEPLOYED_AT,
      process.env.BUILD_TIMESTAMP,
      process.env.RELEASE_CREATED_AT,
      git?.ref_mtime,
      git?.head_mtime
    );
    const generatedAt = new Date().toISOString();

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
        ["git_checkout", git?.branch],
        ["dev_hostname_fallback", isDevHostname ? expectedDevBranch : null],
      ]),
      commit: commitSha,
      commit_sha: commitSha,
      commit_source: sourceFor(commitSha, [
        ["DEPLOYMENT_COMMIT.json", deployment?.commit_sha || deployment?.commit],
        ["GITHUB_SHA", process.env.GITHUB_SHA],
        ["DEPLOY_COMMIT", process.env.DEPLOY_COMMIT],
        ["COMMIT_SHA", process.env.COMMIT_SHA],
        ["REVISION_SHA", process.env.REVISION_SHA],
        [git?.git_source || "git_checkout", git?.commit_sha],
      ]),
      deployed_at: deployedAt,
      deployed_at_source: sourceFor(deployedAt, [
        ["DEPLOYMENT_COMMIT.json.deployed_at", deployment?.deployed_at],
        ["DEPLOYMENT_COMMIT.json.generated_at", deployment?.generated_at],
        ["DEPLOYMENT_COMMIT.json.mtime", deployment?._source_mtime],
        ["DEPLOYED_AT", process.env.DEPLOYED_AT],
        ["BUILD_TIMESTAMP", process.env.BUILD_TIMESTAMP],
        ["RELEASE_CREATED_AT", process.env.RELEASE_CREATED_AT],
        ["git_ref_mtime", git?.ref_mtime],
        ["git_head_mtime", git?.head_mtime],
      ]),
      deployment: sanitizeDeploymentManifest(deployment),
      git: git ? {
        branch: git.branch || null,
        ref: git.git_ref || null,
        source: git.git_source,
        detected: Boolean(git.git_dir_detected),
        head_mtime: git.head_mtime || null,
        ref_mtime: git.ref_mtime || null,
      } : { detected: false },
      evidence: {
        commit_sha_available: Boolean(commitSha),
        branch_available: Boolean(branch),
        deployed_at_available: Boolean(deployedAt),
        git_detected: Boolean(git?.git_dir_detected),
        manifest_detected: Boolean(deployment),
        secrets_included: false,
      },
      app_env: process.env.APP_ENV || process.env.NODE_ENV || null,
      expected_dev_branch: "dev-autopilot-routing",
      is_dev_hostname: isDevHostname,
      generated_at: generatedAt,
    });
  });

  return router;
}
