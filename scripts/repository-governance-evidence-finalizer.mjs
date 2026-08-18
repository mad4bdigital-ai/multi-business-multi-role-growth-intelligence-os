#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = "mad4b.repository-governance-evidence-finalizer.v1";
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}
const snapshotFile = path.resolve(arg("snapshot-file"));
const reportFile = path.resolve(arg("report-file", path.join(root, ".artifacts/repository-evidence-finalizer/report.json")));
const registry = JSON.parse(fs.readFileSync(path.join(root, ".github/governance/evidence-producers.json"), "utf8"));
const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
if (registry.contract !== "mad4b.repository-governance-evidence-producers.v1") throw new Error("evidence producer registry contract mismatch");
if (!/^[0-9a-f]{40}$/u.test(snapshot.source_head_sha || "")) throw new Error("snapshot source_head_sha invalid");
if (!/^[1-9][0-9]*$/u.test(String(snapshot.pr_number || ""))) throw new Error("snapshot pr_number invalid");
const observed = new Map((snapshot.producers || []).map((entry) => [entry.id, entry]));
const producers = [];
for (const expected of registry.producers || []) {
  const found = observed.get(expected.id);
  const identityOk = Boolean(found)
    && found.workflow_file === expected.workflow_file
    && found.workflow === expected.workflow
    && found.head_sha === snapshot.source_head_sha
    && Number(found.pr_number) === Number(snapshot.pr_number);
  const passed = identityOk && found.status === "completed" && found.conclusion === registry.required_conclusion;
  producers.push({
    id: expected.id,
    workflow: expected.workflow,
    workflow_file: expected.workflow_file,
    required: expected.required === true,
    run_id: found?.run_id || null,
    head_sha: found?.head_sha || null,
    pr_number: found?.pr_number || null,
    status: found?.status || "missing",
    conclusion: found?.conclusion || null,
    identity_ok: identityOk,
    passed: expected.required === true ? passed : (found ? passed : true),
  });
}
const missingIds = producers.filter((entry) => entry.required && !entry.passed).map((entry) => entry.id);
const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  source_head_sha: snapshot.source_head_sha,
  pr_number: Number(snapshot.pr_number),
  required_conclusion: registry.required_conclusion,
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
console.log(JSON.stringify({ contract: report.contract, converged: report.converged, failed_or_missing_required_ids: missingIds }));
