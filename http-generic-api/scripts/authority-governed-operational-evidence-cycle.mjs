#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AUTHORITY_EVIDENCE_SOURCE_FAMILIES } from "../authorityEvidenceSourceAdapters.js";
import { adaptAuthorityLiveCensusObservation } from "../authorityLiveCensusAdapter.js";
import { collectGovernedAuthorityLiveEvidence } from "../authorityLiveEvidenceOrchestrator.js";

function parseArgs(argv) {
  const options = { authorizationFile: null, sourcesFile: null, observationFile: null, packetOutput: null, now: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      return value;
    };
    if (argument === "--authorization-file") options.authorizationFile = take();
    else if (argument.startsWith("--authorization-file=")) options.authorizationFile = argument.slice(21);
    else if (argument === "--sources-file") options.sourcesFile = take();
    else if (argument.startsWith("--sources-file=")) options.sourcesFile = argument.slice(15);
    else if (argument === "--observation-file") options.observationFile = take();
    else if (argument.startsWith("--observation-file=")) options.observationFile = argument.slice(19);
    else if (argument === "--packet-output") options.packetOutput = take();
    else if (argument.startsWith("--packet-output=")) options.packetOutput = argument.slice(16);
    else if (argument === "--now") options.now = take();
    else if (argument.startsWith("--now=")) options.now = argument.slice(6);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.authorizationFile || !options.sourcesFile || !options.observationFile || !options.packetOutput) {
    throw new Error("--authorization-file, --sources-file, --observation-file, and --packet-output are required.");
  }
  return options;
}

function readJson(filePath, label) {
  const resolved = path.resolve(process.cwd(), filePath);
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${resolved}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  const resolved = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, resolved);
}

function collectorsFromSnapshots(snapshots) {
  if (!Array.isArray(snapshots)) throw new Error("The source snapshots file must contain an array.");
  const byFamily = new Map();
  for (const snapshot of snapshots) {
    const family = String(snapshot?.source_family || "").trim();
    if (!AUTHORITY_EVIDENCE_SOURCE_FAMILIES.includes(family)) throw new Error(`Unknown source family: ${family || "missing"}.`);
    if (byFamily.has(family)) throw new Error(`Duplicate source family: ${family}.`);
    byFamily.set(family, snapshot);
  }
  const missing = AUTHORITY_EVIDENCE_SOURCE_FAMILIES.filter((family) => !byFamily.has(family));
  if (missing.length || byFamily.size !== AUTHORITY_EVIDENCE_SOURCE_FAMILIES.length) {
    throw new Error(`Exactly eight source snapshots are required; missing: ${missing.join(", ") || "none"}.`);
  }
  return Object.fromEntries(AUTHORITY_EVIDENCE_SOURCE_FAMILIES.map((family) => [family, async () => byFamily.get(family)]));
}

export async function runAuthorityGovernedOperationalEvidenceCycle(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const authorization = readJson(options.authorizationFile, "operation authorization");
  const snapshots = readJson(options.sourcesFile, "repository source snapshots");
  const observation = readJson(options.observationFile, "live catalog observation");
  const catalog = adaptAuthorityLiveCensusObservation(observation);
  const packet = await collectGovernedAuthorityLiveEvidence({
    operation_authorization: authorization,
    source_collectors: collectorsFromSnapshots(snapshots),
    catalog_collector: async () => catalog,
    now: options.now || new Date(),
  });
  writeJson(options.packetOutput, packet);
  process.stdout.write(`${JSON.stringify({
    status: packet.status,
    operation_ref: packet.operation.operation_ref,
    observed_ref: observation.observed_ref,
    source_family_count: packet.source_bundle.source_family_count,
    blocking_issue_count: packet.blocking_issues.length,
    packet_sha256: packet.packet_sha256,
    read_only: packet.read_only,
    applies_sql: packet.applies_sql,
    database_mutation_executed: false,
    secrets_included: packet.secrets_included,
  })}\n`);
  return packet.status === "ready_for_human_ownership_review" ? 0 : 2;
}

function directExecution() {
  return Boolean(process.argv[1])
    && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

export const _testingAuthorityGovernedOperationalEvidenceCycle = Object.freeze({ parseArgs, collectorsFromSnapshots });

if (directExecution()) {
  try {
    process.exitCode = await runAuthorityGovernedOperationalEvidenceCycle();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
