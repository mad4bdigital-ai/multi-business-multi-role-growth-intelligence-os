#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { collectAuthorityEvidenceRepositorySnapshots } from "../authorityEvidenceRepositorySnapshotCollector.js";

function parseArgs(argv) {
  const options = {
    manifestFile: null,
    sourcesOutput: null,
    attestationOutput: null,
    repositoryRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
    now: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      return value;
    };
    if (argument === "--manifest-file") options.manifestFile = take();
    else if (argument.startsWith("--manifest-file=")) options.manifestFile = argument.slice(16);
    else if (argument === "--sources-output") options.sourcesOutput = take();
    else if (argument.startsWith("--sources-output=")) options.sourcesOutput = argument.slice(17);
    else if (argument === "--attestation-output") options.attestationOutput = take();
    else if (argument.startsWith("--attestation-output=")) options.attestationOutput = argument.slice(21);
    else if (argument === "--repository-root") options.repositoryRoot = take();
    else if (argument.startsWith("--repository-root=")) options.repositoryRoot = argument.slice(18);
    else if (argument === "--now") options.now = take();
    else if (argument.startsWith("--now=")) options.now = argument.slice(6);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.manifestFile || !options.sourcesOutput || !options.attestationOutput) {
    throw new Error("--manifest-file, --sources-output, and --attestation-output are required.");
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

export function runAuthorityEvidenceRepositorySnapshots(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const attestation = collectAuthorityEvidenceRepositorySnapshots({
    manifest: readJson(options.manifestFile, "repository source manifest"),
    repository_root: path.resolve(process.cwd(), options.repositoryRoot),
    now: options.now || new Date(),
  });
  writeJson(options.sourcesOutput, attestation.snapshots);
  writeJson(options.attestationOutput, attestation);
  process.stdout.write(`${JSON.stringify({
    status: attestation.status,
    observed_ref: attestation.observed_ref,
    source_file_count: attestation.source_files.length,
    blocking_gap_count: attestation.blocking_gap_count,
    attestation_sha256: attestation.attestation_sha256,
    secrets_included: false,
  })}\n`);
  return attestation.status === "ready_for_live_catalog_cycle" ? 0 : 2;
}

function directExecution() {
  return Boolean(process.argv[1])
    && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

export const _testingAuthorityEvidenceRepositorySnapshots = Object.freeze({ parseArgs });

if (directExecution()) {
  try {
    process.exitCode = runAuthorityEvidenceRepositorySnapshots();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
