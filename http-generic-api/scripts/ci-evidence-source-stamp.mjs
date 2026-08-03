#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCE_CONTRACTS = Object.freeze({
  "e2e-parallel-work-evaluation.json": "mad4b.e2e-parallel-work-evaluation.v1",
  "e2e-phase-evaluation.json": "mad4b.e2e-phase-evaluation.v1",
  "e2e-parallel-execution.json": "mad4b.e2e-parallel-execution.v1",
  "e2e-phase-execution.json": "mad4b.e2e-phase-execution.v1"
});

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CANDIDATE_KINDS = new Set(["head", "merge_candidate"]);

function parseArgs(argv) {
  const options = { candidateKind: null, candidateSha: null, files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--candidate-kind") options.candidateKind = take();
    else if (arg.startsWith("--candidate-kind=")) options.candidateKind = arg.slice(17);
    else if (arg === "--candidate-sha") options.candidateSha = take();
    else if (arg.startsWith("--candidate-sha=")) options.candidateSha = arg.slice(16);
    else if (arg === "--file") options.files.push(take());
    else if (arg.startsWith("--file=")) options.files.push(arg.slice(7));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!CANDIDATE_KINDS.has(options.candidateKind)) throw new Error("--candidate-kind must be head or merge_candidate.");
  if (!SHA_PATTERN.test(options.candidateSha || "")) throw new Error("--candidate-sha must be a full lowercase 40-character SHA.");
  if (!options.files.length) throw new Error("At least one --file is required.");
  return options;
}

function writeAtomic(file, data) {
  const resolved = path.resolve(file);
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporary, resolved);
}

export function stampEvidenceFile(file, { candidateKind, candidateSha }) {
  const resolved = path.resolve(file);
  const name = path.basename(resolved);
  const expectedContract = SOURCE_CONTRACTS[name];
  if (!expectedContract) throw new Error(`Unsupported structured report filename: ${name}`);
  if (!fs.existsSync(resolved)) return { file: name, status: "missing" };
  const report = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (typeof report.ok !== "boolean") throw new Error(`${name} must declare boolean ok before stamping.`);
  if (report.secrets_included !== false) throw new Error(`${name} must declare secrets_included=false before stamping.`);
  if (report.contract != null && report.contract !== expectedContract) throw new Error(`${name} declares unexpected contract ${report.contract}.`);
  if (report.candidate_kind != null && report.candidate_kind !== candidateKind) throw new Error(`${name} candidate_kind conflicts with the workflow candidate.`);
  if (report.candidate_sha != null && report.candidate_sha !== candidateSha) throw new Error(`${name} candidate_sha conflicts with the workflow candidate.`);
  const stamped = {
    ...report,
    contract: expectedContract,
    candidate_kind: candidateKind,
    candidate_sha: candidateSha,
    secrets_included: false
  };
  writeAtomic(resolved, stamped);
  return { file: name, status: "stamped", contract: expectedContract, candidate_kind: candidateKind, candidate_sha: candidateSha };
}

export function runEvidenceSourceStamp(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const results = options.files.map((file) => stampEvidenceFile(file, options));
  if (!results.some((result) => result.status === "stamped")) throw new Error("No structured evidence report was available to stamp.");
  process.stdout.write(`${JSON.stringify({ ok: true, results, secrets_included: false })}\n`);
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runEvidenceSourceStamp();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 2;
  }
}
