#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACT = "mad4b.repository-policy-objections.v1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}
function readJson(file, required = true) {
  if (!file) {
    if (required) throw new Error("required JSON input missing");
    return null;
  }
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`required JSON input does not exist: ${file}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value)), "utf8").digest("hex");
}
function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
function globRegex(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else source += "[^/]*";
    } else source += escapeRegex(ch);
  }
  return new RegExp(`^${source}$`, "u");
}
function matches(file, patterns = []) {
  return patterns.some((pattern) => globRegex(pattern).test(file));
}
function objection({ policy_id, objection_id, severity = "blocking", candidate_sha, evidence = {}, remediation, waiverable = false, stage = "source" }) {
  const core = { policy_id, objection_id, severity, candidate_sha, evidence, remediation, waiverable, stage };
  return { ...core, objection_digest: digest(core), waived: false, waiver: null };
}

const mode = arg("mode", "finalizer");
if (!["source", "finalizer"].includes(mode)) throw new Error("mode must be source or finalizer");
const governanceFile = path.resolve(arg("governance-report"));
const derivedFile = arg("derived-report");
const evidenceFile = arg("evidence-report");
const outputFile = path.resolve(arg("report-file", path.join(root, ".artifacts/repository-policy-objections/report.json")));

const constitution = readJson(path.join(root, "http-generic-api/config/repository-governance-constitution.json"));
const registry = readJson(path.join(root, ".github/governance/policy-registry.json"));
const waiverLedger = readJson(path.join(root, ".github/governance/waiver-ledger.json"));
const governance = readJson(governanceFile);
const derived = readJson(derivedFile ? path.resolve(derivedFile) : null, false);
const producerEvidence = readJson(evidenceFile ? path.resolve(evidenceFile) : null, false);
const candidateSha = governance?.candidate?.sha;
if (!/^[0-9a-f]{40}$/u.test(candidateSha || "")) throw new Error("governance report candidate SHA missing or invalid");

const policyById = new Map((registry.policies || []).map((entry) => [entry.id, entry]));
const objections = [];

for (const result of governance.policies || []) {
  if (result.passed) continue;
  const policy = policyById.get(result.id) || {};
  objections.push(objection({
    policy_id: result.id,
    objection_id: `${result.id}:assertion-failed`,
    severity: policy.severity || result.severity || "blocking",
    candidate_sha: candidateSha,
    evidence: { assertions: result.assertions || [] },
    remediation: policy.remediation || policy.description || `Resolve policy ${result.id}.`,
    waiverable: policy.waiverable === true,
    stage: "source",
  }));
}

const riskByClass = new Map((constitution.surface_classes || []).map((entry) => [entry.id, entry.risk || "low"]));
const criticalPaths = new Set();
const malformedSurfaceClassPaths = new Set();
const semanticClasses = constitution.semantic_executable_classes || [];
const unregisteredExecutables = new Set();
for (const change of governance.change_inventory?.changes || []) {
  for (const observed of change.paths || []) {
    if (!Array.isArray(observed.surface_classes)) {
      malformedSurfaceClassPaths.add(observed.path || "unknown");
      continue;
    }
    if (observed.surface_classes.some((classId) => riskByClass.get(classId) === "critical")) criticalPaths.add(observed.path);
  }
  if (!["A", "R", "C"].includes(change.status) || !change.new_path) continue;
  const target = (change.paths || []).find((entry) => entry.path === change.new_path);
  if (!target?.executable) continue;
  const semantic = semanticClasses.filter((entry) => matches(change.new_path, entry.patterns || [])).map((entry) => entry.id);
  if (semantic.length === 0) unregisteredExecutables.add(change.new_path);
}
if (malformedSurfaceClassPaths.size) {
  objections.push(objection({
    policy_id: "governance-report-shape",
    objection_id: "governance-report-shape:surface-classes-missing",
    severity: "blocking",
    candidate_sha: candidateSha,
    evidence: { paths: [...malformedSurfaceClassPaths].sort() },
    remediation: "Regenerate the canonical governance report with surface_classes on every changed path before evaluating objections.",
    waiverable: false,
    stage: "source",
  }));
}
if (unregisteredExecutables.size) {
  objections.push(objection({
    policy_id: "semantic-executable-registration",
    objection_id: "semantic-executable-registration:new-executable-unregistered",
    severity: "blocking",
    candidate_sha: candidateSha,
    evidence: { paths: [...unregisteredExecutables].sort() },
    remediation: "Register every new executable in a typed semantic executable class in the Constitution.",
    waiverable: false,
    stage: "source",
  }));
}
const canonicalControlPaths = new Set(constitution.control_plane_paths || []);
const unregisteredCriticalPaths = [...criticalPaths].filter((file) => !canonicalControlPaths.has(file));
if (unregisteredCriticalPaths.length) {
  objections.push(objection({
    policy_id: "critical-control-plane-registration",
    objection_id: "critical-control-plane-registration:changed-critical-path-unregistered",
    severity: "blocking",
    candidate_sha: candidateSha,
    evidence: { paths: unregisteredCriticalPaths.sort() },
    remediation: "Register every changed critical governance path in Constitution.control_plane_paths and the convergence automation control surface.",
    waiverable: false,
    stage: "source",
  }));
}
if (criticalPaths.size) {
  objections.push(objection({
    policy_id: "control-plane-self-amendment",
    objection_id: "control-plane-self-amendment:manual-merge-required",
    severity: "manual",
    candidate_sha: candidateSha,
    evidence: { critical_paths: [...criticalPaths].sort() },
    remediation: "Critical governance/control-plane changes may be repaired automatically but require an independent/manual merge decision; autonomous merge is forbidden.",
    waiverable: false,
    stage: "source",
  }));
}

if (derived) {
  if (derived.candidate?.sha !== candidateSha) {
    objections.push(objection({
      policy_id: "derived-state-evidence-binding",
      objection_id: "derived-state-evidence-binding:candidate-mismatch",
      severity: "blocking", candidate_sha: candidateSha,
      evidence: { governance_sha: candidateSha, derived_sha: derived.candidate?.sha || null },
      remediation: "Re-run derived-state verification on the exact same candidate.",
      waiverable: false, stage: "source",
    }));
  }
  for (const artifact of derived.artifacts || []) {
    if (artifact.current) continue;
    objections.push(objection({
      policy_id: `derived-state:${artifact.artifact_id}`,
      objection_id: `derived-state:${artifact.artifact_id}:stale-or-failed`,
      severity: artifact.merge_blocking ? "blocking" : "advisory",
      candidate_sha: candidateSha,
      evidence: {
        artifact_id: artifact.artifact_id,
        artifact_class: artifact.artifact_class,
        verifier_id: artifact.verifier_id,
        repair_authority: artifact.repair_authority || null,
      },
      remediation: artifact.merge_blocking
        ? "Run the registered governed repair authority and re-verify the exact candidate."
        : "Publish the observability artifact after merge; do not mutate the feature PR solely for freshness.",
      waiverable: false,
      stage: "source",
    }));
  }
}

if (mode === "finalizer") {
  if (!producerEvidence) {
    objections.push(objection({
      policy_id: "trusted-evidence-producers",
      objection_id: "trusted-evidence-producers:report-missing",
      severity: "blocking", candidate_sha: candidateSha, evidence: {},
      remediation: "Collect trusted producer evidence for the exact source head and PR.",
      waiverable: false, stage: "source",
    }));
  } else {
    for (const producer of producerEvidence.producers || []) {
      if (producer.required !== true || producer.passed === true) continue;
      objections.push(objection({
        policy_id: "trusted-evidence-producers",
        objection_id: `trusted-evidence-producers:${producer.id}`,
        severity: "blocking", candidate_sha: candidateSha,
        evidence: producer,
        remediation: `Obtain a successful ${producer.workflow || producer.id} run bound to the exact source head.`,
        waiverable: false, stage: "source",
      }));
    }
  }
  if (constitution.authority?.server_enforcement_attestation === "required_before_single_gate_activation") {
    objections.push(objection({
      policy_id: "server-enforcement-activation",
      objection_id: "server-enforcement-activation:attestation-required",
      severity: "activation", candidate_sha: candidateSha,
      evidence: { live_readback_in_finalizer: false },
      remediation: "Before activating Derived State Closure as the sole server-required check, apply and read back the GitHub server policy under its independent typed authorization.",
      waiverable: false, stage: "activation",
    }));
  }
}

const now = Date.now();
const waiverErrors = [];
for (const entry of waiverLedger.waivers || []) {
  if (!entry?.policy_id || !entry?.objection_id || !/^[0-9a-f]{64}$/u.test(entry?.objection_digest || "")) {
    waiverErrors.push("invalid_waiver_identity");
    continue;
  }
  const expires = Date.parse(entry.expires_at || "");
  if (!Number.isFinite(expires)) { waiverErrors.push(`invalid_expiry:${entry.objection_id}`); continue; }
  if (expires <= now) continue;
  if (!entry.reason || !entry.approved_by) { waiverErrors.push(`missing_reason_or_approver:${entry.objection_id}`); continue; }
  const target = objections.find((item) =>
    item.policy_id === entry.policy_id &&
    item.objection_id === entry.objection_id &&
    item.objection_digest === entry.objection_digest
  );
  if (!target) continue;
  if (!target.waiverable) { waiverErrors.push(`non_waiverable:${entry.objection_id}`); continue; }
  target.waived = true;
  target.waiver = {
    expires_at: entry.expires_at,
    approved_by: entry.approved_by,
    reason: entry.reason,
  };
}
if (waiverErrors.length) {
  objections.push(objection({
    policy_id: "waiver-ledger-integrity",
    objection_id: "waiver-ledger-integrity:invalid-entry",
    severity: "blocking", candidate_sha: candidateSha,
    evidence: { errors: [...new Set(waiverErrors)].sort() },
    remediation: "Repair invalid, unbound, expired-format, or non-waiverable waiver entries.",
    waiverable: false, stage: "source",
  }));
}

const unresolved = objections.filter((item) => !item.waived);
const blocking = unresolved.filter((item) => item.severity === "blocking");
const manual = unresolved.filter((item) => item.severity === "manual");
const advisory = unresolved.filter((item) => item.severity === "advisory");
const activation = unresolved.filter((item) => item.severity === "activation");
const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  mode,
  candidate_sha: candidateSha,
  source_head_sha: derived?.candidate?.source_head_sha || governance?.candidate?.source_head_sha || null,
  objection_count: objections.length,
  unresolved_count: unresolved.length,
  blocking_count: blocking.length,
  manual_count: manual.length,
  advisory_count: advisory.length,
  activation_count: activation.length,
  waived_count: objections.filter((item) => item.waived).length,
  merge_allowed_by_source_policy: blocking.length === 0,
  automerge_allowed: blocking.length === 0 && manual.length === 0,
  single_gate_activation_allowed: blocking.length === 0 && activation.length === 0,
  objections,
  safety: {
    repository_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  },
};
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  contract: report.contract,
  candidate_sha: report.candidate_sha,
  blocking_count: report.blocking_count,
  manual_count: report.manual_count,
  advisory_count: report.advisory_count,
  activation_count: report.activation_count,
  merge_allowed_by_source_policy: report.merge_allowed_by_source_policy,
  automerge_allowed: report.automerge_allowed
})}\n`);
if (blocking.length) process.exitCode = 1;
