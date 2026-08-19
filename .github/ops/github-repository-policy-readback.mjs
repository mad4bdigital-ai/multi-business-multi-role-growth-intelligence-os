import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { readGithubRepositoryPolicy } from "../../http-generic-api/githubRepositoryPolicyController.js";

const token = String(process.env.GH_READ_TOKEN || "").trim();
const repository = String(process.env.REPOSITORY || process.env.GITHUB_REPOSITORY || "").trim();
const expectedMainSha = String(process.env.EXPECTED_MAIN_SHA || "").trim().toLowerCase();
const evidenceDir = String(process.env.EVIDENCE_DIR || ".artifacts/github-repository-policy-readback").trim();
const BRANCHES = Object.freeze(["main", "Production"]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function sanitize(value, depth = 0) {
  if (value === null || value === undefined || depth > 12) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, depth + 1));
  if (typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [/(password|secret|token|authorization|credential|private[_-]?key|cookie)/i.test(key) ? key : key, /(password|secret|token|authorization|credential|private[_-]?key|cookie)/i.test(key) ? "[redacted]" : sanitize(child, depth + 1)]));
}
async function writeJson(name, value) {
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(`${evidenceDir}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, "utf8");
}
function branchEvidence(branch, readback) {
  const observedSha = String(readback.branch_sha || readback.main_sha || "").toLowerCase();
  const complete = readback.proof?.server_policy_gate_complete === true;
  return {
    branch,
    observed_sha: observedSha || null,
    branch_protected: readback.branch_protected,
    ruleset_index_count: readback.ruleset_index_count,
    active_rule_count: readback.active_rule_count,
    review_policy_mode: readback.review_policy_mode,
    required_checks: readback.required_checks,
    finalizer_identity: readback.finalizer_identity,
    proof: readback.proof,
    findings: readback.findings,
    server_policy_gate_complete: complete,
    policy_fingerprint: createHash("sha256").update(JSON.stringify(readback.ruleset_details || []), "utf8").digest("hex"),
  };
}

assert(token, "GH_READ_TOKEN is required for policy readback.");
const [owner, repo] = repository.split("/");
assert(owner && repo, "REPOSITORY must be owner/repo.");
assert(/^[0-9a-f]{40}$/i.test(expectedMainSha), "EXPECTED_MAIN_SHA must be a full SHA.");

const raw = {};
for (const branch of BRANCHES) raw[branch] = await readGithubRepositoryPolicy({ owner, repo, default_branch: branch }, { token });
const branches = Object.fromEntries(BRANCHES.map((branch) => [branch, branchEvidence(branch, raw[branch])]));
const exactMainSha = branches.main.observed_sha === expectedMainSha;
const driftBranches = BRANCHES.filter((branch) => branches[branch].server_policy_gate_complete !== true);
const evidence = {
  contract: "github_repository_policy_readback_workflow.v2",
  mode: "readback",
  expected_main_sha: expectedMainSha,
  exact_main_sha: exactMainSha,
  branches,
  server_policy_drift_branches: driftBranches,
  server_policy_drift_count: driftBranches.length,
  governance_fixed_point: exactMainSha && driftBranches.length === 0,
  mutation_executed: false,
  provider_call_executed: false,
  external_write_executed: false,
  secrets_included: false,
};
await writeJson("policy-readback.json", evidence);

if (!exactMainSha) {
  console.error(JSON.stringify({ ok: false, reason: "main_sha_drift", ...evidence }));
  process.exitCode = 1;
} else if (evidence.server_policy_drift_count !== 0) {
  console.error(JSON.stringify({ ok: false, reason: "GOVERNANCE_SERVER_POLICY_DRIFT", ...evidence }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, ...evidence }));
}
