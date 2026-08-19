import { promises as fs } from "node:fs";
import { readGithubRepositoryPolicy } from "../../http-generic-api/githubRepositoryPolicyController.js";
import { buildBranchReadbackEvidence, buildTwoBranchReadbackEvidence } from "./github-repository-policy-readback-core.mjs";
import { REGISTERED_POLICY_BRANCHES, resolveTargetBranch } from "../../http-generic-api/scripts/github-review-policy-target.mjs";

const token = String(process.env.GH_READ_TOKEN || "").trim();
const repository = String(process.env.REPOSITORY || process.env.GITHUB_REPOSITORY || "").trim();
const evidenceDir = String(process.env.EVIDENCE_DIR || ".artifacts/github-repository-policy-readback").trim();

function sanitize(value, depth = 0) {
  if (value === null || value === undefined || depth > 12) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, depth + 1));
  if (typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (/(password|secret|token|authorization|credential|private[_-]?key|cookie)/i.test(key)) return [key, "[redacted]"];
    return [key, sanitize(child, depth + 1)];
  }));
}

async function writeJson(name, value) {
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(`${evidenceDir}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, "utf8");
}

async function githubJson(pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`GitHub ref read failed HTTP ${response.status}: ${pathname}`);
  return payload;
}

async function currentRefSha(branch) {
  const target = resolveTargetBranch(branch);
  const ref = await githubJson(`/repos/${repository}/git/ref/heads/${encodeURIComponent(target)}`);
  const sha = String(ref?.object?.sha || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${target} did not resolve to a full SHA.`);
  return sha;
}

if (!token) throw new Error("GH_READ_TOKEN is required for policy readback.");
const [owner, repo] = repository.split("/");
if (!owner || !repo) throw new Error("REPOSITORY must be owner/repo.");

const branches = await Promise.all(REGISTERED_POLICY_BRANCHES.map(async (branch) => {
  const expectedSha = await currentRefSha(branch);
  const readback = await readGithubRepositoryPolicy({ owner, repo, default_branch: branch }, { token });
  return buildBranchReadbackEvidence({ branch, expectedSha, readback });
}));
const evidence = buildTwoBranchReadbackEvidence({ branches });
await writeJson("policy-readback.json", evidence);

if (evidence.server_policy_drift_count > 0) {
  console.error(JSON.stringify({ ok: false, ...evidence }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, ...evidence }));
}
