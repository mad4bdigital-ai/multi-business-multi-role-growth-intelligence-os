#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function isContractPath(value) {
  const file = normalize(value);
  return (file.startsWith(".changes/e2e/") && file.endsWith(".json"))
    || /^specs\/[^/]+\/e2e-phases\.json$/u.test(file);
}

function ensureInside(root, relativePath) {
  const normalized = normalize(relativePath);
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) return null;
  const resolved = path.resolve(root, normalized);
  const rootPath = path.resolve(root);
  if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`)) return null;
  return { normalized, resolved };
}

function walkJson(root, relativeDirectory) {
  const start = path.join(root, relativeDirectory);
  if (!fs.existsSync(start)) return [];
  const files = [];
  const visit = (absolute, relative) => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const nextAbsolute = path.join(absolute, entry.name);
      const nextRelative = normalize(path.posix.join(relative, entry.name));
      if (entry.isDirectory()) visit(nextAbsolute, nextRelative);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(nextRelative);
    }
  };
  visit(start, normalize(relativeDirectory));
  return files;
}

export function discoverContractPaths(root = REPO_ROOT) {
  const contracts = new Set(walkJson(root, ".changes/e2e").filter(isContractPath));
  const specsRoot = path.join(root, "specs");
  if (fs.existsSync(specsRoot)) {
    for (const entry of fs.readdirSync(specsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const contractPath = normalize(path.posix.join("specs", entry.name, "e2e-phases.json"));
      if (fs.existsSync(path.join(root, contractPath))) contracts.add(contractPath);
    }
  }
  return [...contracts].sort();
}

function parseChangedLine(line) {
  const fields = line.split("\t");
  const status = fields[0] || "";
  if (/^[RC]\d+$/u.test(status)) {
    return { status: status[0], old_path: normalize(fields[1]), path: normalize(fields[2]) };
  }
  return { status: status[0] || status, path: normalize(fields[1]), old_path: null };
}

export function changedEntriesFromGit({ root = REPO_ROOT, base, head = "HEAD" } = {}) {
  if (!base) throw new Error("A base SHA/ref is required for pull-request integrity evaluation.");
  const output = execFileSync("git", ["diff", "--name-status", "--find-renames", `${base}...${head}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split(/\r?\n/u).filter(Boolean).map(parseChangedLine);
}

function implementedEvidence(contract, contractPath, findings) {
  const evidence = [];
  if (contract?.schema_version !== 1) findings.push({ code: "invalid_contract_schema_version", contract_path: contractPath });
  if (typeof contract?.feature_key !== "string" || contract.feature_key.trim().length < 3) {
    findings.push({ code: "missing_feature_key", contract_path: contractPath });
  }
  const phases = Array.isArray(contract?.phases) ? contract.phases : [];
  for (const phase of phases) {
    if (phase?.status !== "implemented") continue;
    const journeys = Array.isArray(phase.e2e_journeys) ? phase.e2e_journeys : [];
    if (!journeys.length) {
      findings.push({
        code: "implemented_phase_has_no_e2e_journey",
        contract_path: contractPath,
        feature_key: contract?.feature_key || null,
        phase: phase?.id || null,
      });
      continue;
    }
    for (const journey of journeys) {
      const paths = Array.isArray(journey?.evidence_paths) ? journey.evidence_paths : [];
      if (!paths.length) {
        findings.push({
          code: "implemented_journey_has_no_evidence_paths",
          contract_path: contractPath,
          feature_key: contract?.feature_key || null,
          phase: phase?.id || null,
          journey_id: journey?.id || null,
        });
      }
      for (const evidencePath of paths) {
        evidence.push({
          contract_path: contractPath,
          feature_key: contract?.feature_key || null,
          phase: phase?.id || null,
          journey_id: journey?.id || null,
          path: normalize(evidencePath),
        });
      }
    }
  }
  return evidence;
}

function readContract(root, contractPath, findings) {
  const located = ensureInside(root, contractPath);
  if (!located || !fs.existsSync(located.resolved)) {
    findings.push({ code: "contract_not_found", contract_path: contractPath });
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(located.resolved, "utf8"));
  } catch (error) {
    findings.push({ code: "invalid_contract_json", contract_path: contractPath, message: error.message });
    return null;
  }
}

export function evaluateEvidenceIntegrity({
  root = REPO_ROOT,
  changedEntries = [],
  all = false,
} = {}) {
  const findings = [];
  const allContracts = discoverContractPaths(root);
  const parsed = new Map();
  const evidenceByContract = new Map();

  for (const contractPath of allContracts) {
    const localFindings = [];
    const contract = readContract(root, contractPath, localFindings);
    parsed.set(contractPath, contract);
    evidenceByContract.set(contractPath, contract ? implementedEvidence(contract, contractPath, localFindings) : []);
    if (all) findings.push(...localFindings);
  }

  const changedContracts = new Set();
  const deletedPaths = new Set();
  for (const entry of changedEntries) {
    if (entry.status === "D") deletedPaths.add(normalize(entry.path));
    if (entry.status === "R" && entry.old_path) deletedPaths.add(normalize(entry.old_path));
    if (entry.path && entry.status !== "D" && isContractPath(entry.path)) changedContracts.add(normalize(entry.path));
  }

  const affectedByDeletion = new Set();
  for (const [contractPath, evidence] of evidenceByContract) {
    if (evidence.some((item) => deletedPaths.has(item.path))) affectedByDeletion.add(contractPath);
  }

  const targets = all
    ? new Set(allContracts)
    : new Set([...changedContracts, ...affectedByDeletion]);

  if (!all) {
    for (const contractPath of targets) {
      const localFindings = [];
      const contract = parsed.has(contractPath)
        ? parsed.get(contractPath)
        : readContract(root, contractPath, localFindings);
      const evidence = contract ? implementedEvidence(contract, contractPath, localFindings) : [];
      findings.push(...localFindings);
      evidenceByContract.set(contractPath, evidence);
    }
  }

  const checkedEvidence = [];
  for (const contractPath of [...targets].sort()) {
    for (const item of evidenceByContract.get(contractPath) || []) {
      const located = ensureInside(root, item.path);
      const deleted = deletedPaths.has(item.path);
      const exists = Boolean(located && fs.existsSync(located.resolved));
      checkedEvidence.push({ ...item, exists, deleted_in_change: deleted });
      if (!located) {
        findings.push({ code: "invalid_evidence_path", ...item });
      } else if (deleted) {
        findings.push({ code: "deleted_evidence_still_referenced", ...item });
      } else if (!exists) {
        findings.push({ code: "missing_implemented_journey_evidence", ...item });
      }
    }
  }

  return {
    schema_version: 1,
    contract: "mad4b.e2e-contract-reference-integrity.v1",
    enforcement_mode: "fail_closed",
    evaluation_mode: all ? "all_contracts" : "changed_contracts_and_deleted_evidence",
    ok: findings.length === 0,
    changed_entries: changedEntries,
    changed_contracts: [...changedContracts].sort(),
    deleted_paths: [...deletedPaths].sort(),
    deletion_affected_contracts: [...affectedByDeletion].sort(),
    targeted_contracts: [...targets].sort(),
    checked_evidence: checkedEvidence,
    findings,
    secrets_included: false,
  };
}

function writeAtomic(file, payload) {
  if (!file) return;
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(temporary, resolved);
}

function parseArgs(argv) {
  const options = { root: REPO_ROOT, base: null, head: "HEAD", reportFile: null, all: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const read = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      return value;
    };
    if (argument === "--root") options.root = path.resolve(read());
    else if (argument.startsWith("--root=")) options.root = path.resolve(argument.slice(7));
    else if (argument === "--base") options.base = read();
    else if (argument.startsWith("--base=")) options.base = argument.slice(7);
    else if (argument === "--head") options.head = read();
    else if (argument.startsWith("--head=")) options.head = argument.slice(7);
    else if (argument === "--report-file") options.reportFile = read();
    else if (argument.startsWith("--report-file=")) options.reportFile = argument.slice(14);
    else if (argument === "--all") options.all = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const changedEntries = options.all ? [] : changedEntriesFromGit(options);
  const report = evaluateEvidenceIntegrity({ root: options.root, changedEntries, all: options.all });
  writeAtomic(options.reportFile, report);
  const output = JSON.stringify(report, null, 2);
  if (!report.ok) {
    console.error(output);
    process.exit(1);
  }
  console.log(output);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
