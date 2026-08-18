#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = "mad4b.repository-governance-evidence-finalizer.v2";
const SHA_RE = /^[0-9a-f]{40}$/u;
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}
function exactSha(value, name) {
  if (!SHA_RE.test(value || "")) throw new Error(`snapshot ${name} invalid`);
  return value;
}
function producerIdentity(entry) {
  if (!entry || typeof entry !== "object") return null;
  const canonical = typeof entry.producer_id === "string" ? entry.producer_id : null;
  const legacy = typeof entry.id === "string" ? entry.id : null;
  if (canonical && legacy && canonical !== legacy) throw new Error(`producer evidence identity conflict: producer_id=${canonical} id=${legacy}`);
  return canonical || legacy;
}
const snapshotFile = path.resolve(arg("snapshot-file"));
const reportFile = path.resolve(arg("report-file", path.join(root, ".artifacts/repository-evidence-finalizer/report.json")));
const registry = JSON.parse(fs.readFileSync(path.join(root, ".github/governance/evidence-producers.json"), "utf8"));
const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
if (registry.contract !== "mad4b.repository-governance-evidence-producers.v1" || registry.binding !== "source_base_merge_candidate_executed_sha") throw new Error("evidence producer registry contract/binding mismatch");
const sourceHeadSha = exactSha(snapshot.source_head_sha, "source_head_sha");
const baseSha = exactSha(snapshot.base_sha, "base_sha");
const mergeCandidateSha = exactSha(snapshot.merge_candidate_sha, "merge_candidate_sha");
const executedSha = exactSha(snapshot.executed_sha, "executed_sha");
if (executedSha !== mergeCandidateSha) throw new Error("snapshot executed_sha must equal merge_candidate_sha");
if (!/^[1-9][0-9]*$/u.test(String(snapshot.pr_number || ""))) throw new Error("snapshot pr_number invalid");
const observed = new Map();
for (const entry of snapshot.producers || []) {
  const id = producerIdentity(entry);
  if (!id) throw new Error("producer evidence identity missing");
  if (observed.has(id)) throw new Error(`duplicate producer evidence identity: ${id}`);
  observed.set(id, entry);
}
const producers = [];
for (const expected of registry.producers || []) {
  const found = observed.get(expected.id);
  const fullIdentityOk = Boolean(found)
    && found.workflow_file === expected.workflow_file
    && found.workflow === expected.workflow
    && (!expected.event || found.event === expected.event)
    && found.source_head_sha === sourceHeadSha
    && found.base_sha === baseSha
    && found.merge_candidate_sha === mergeCandidateSha
    && found.executed_sha === executedSha
    && found.executed_sha === found.merge_candidate_sha
    && Number(found.pr_number) === Number(snapshot.pr_number);
  const passed = fullIdentityOk && found.status === "completed" && found.conclusion === registry.required_conclusion;
  producers.push({
    id: expected.id,
    workflow: expected.workflow,
    workflow_file: expected.workflow_file,
    required: expected.required === true,
    role: expected.role || "canonical",
    run_id: found?.run_id || null,
    source_head_sha: found?.source_head_sha || null,
    base_sha: found?.base_sha || null,
    merge_candidate_sha: found?.merge_candidate_sha || null,
    executed_sha: found?.executed_sha || null,
    pr_number: found?.pr_number || null,
    event: found?.event || null,
    status: found?.status || "missing",
    conclusion: found?.conclusion || null,
    identity_ok: fullIdentityOk,
    passed: expected.required === true ? passed : (found ? passed : true),
  });
}
const missingIds = producers.filter((entry) => entry.required && !entry.passed).map((entry) => entry.id);
const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  source_head_sha: sourceHeadSha,
  base_sha: baseSha,
  merge_candidate_sha: mergeCandidateSha,
  executed_sha: executedSha,
  pr_number: Number(snapshot.pr_number),
  required_conclusion: registry.required_conclusion,
  identity_binding: registry.binding,
  producer_count: producers.length,
  required_count: producers.filter((entry) => entry.required).length,
  failed_or_missing_required_count: missingIds.length,
  converged: missingIds.length === 0,
  failed_or_missing_required_ids: missingIds,
  producers,
  safety: { repository_mutation_performed: false, secrets_included: false },
};
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ contract: report.contract, converged: report.converged, merge_candidate_sha: mergeCandidateSha, failed_or_missing_required_ids: missingIds }));
if (!report.converged) process.exitCode = 1;
