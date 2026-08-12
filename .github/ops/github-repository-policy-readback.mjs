import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { readGithubRepositoryPolicy } from "../../http-generic-api/githubRepositoryPolicyController.js";

const token = String(process.env.GH_READ_TOKEN || "").trim();
const repository = String(process.env.REPOSITORY || process.env.GITHUB_REPOSITORY || "").trim();
const expectedMainSha = String(process.env.EXPECTED_MAIN_SHA || "").trim().toLowerCase();
const evidenceDir = String(process.env.EVIDENCE_DIR || ".artifacts/github-repository-policy-readback").trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

assert(token, "GH_READ_TOKEN is required for policy readback.");
const [owner, repo] = repository.split("/");
assert(owner && repo, "REPOSITORY must be owner/repo.");
assert(/^[0-9a-f]{40}$/i.test(expectedMainSha), "EXPECTED_MAIN_SHA must be a full SHA.");

const readback = await readGithubRepositoryPolicy({ owner, repo, default_branch: "main" }, { token });
const actualMainSha = String(readback.main_sha || "").toLowerCase();
const evidence = {
  contract: "github_repository_policy_readback_workflow.v1",
  mode: "readback",
  target: readback.target,
  expected_main_sha: expectedMainSha,
  observed_main_sha: actualMainSha || null,
  exact_main_sha: actualMainSha === expectedMainSha,
  branch_protected: readback.branch_protected,
  ruleset_index_count: readback.ruleset_index_count,
  active_rule_count: readback.active_rule_count,
  review_policy_mode: readback.review_policy_mode,
  finalizer_identity: readback.finalizer_identity,
  proof: readback.proof,
  findings: readback.findings,
  policy_fingerprint: createHash("sha256").update(JSON.stringify(readback.ruleset_details || []), "utf8").digest("hex"),
  mutation_executed: false,
  provider_call_executed: false,
  external_write_executed: false,
  secrets_included: false,
};
await writeJson("policy-readback.json", evidence);

if (!evidence.exact_main_sha) {
  console.error(JSON.stringify({ ok: false, reason: "main_sha_drift", ...evidence }));
  process.exitCode = 1;
} else if (readback.proof?.server_policy_gate_complete !== true) {
  console.error(JSON.stringify({ ok: false, reason: "server_policy_gate_incomplete", ...evidence }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, ...evidence }));
}
