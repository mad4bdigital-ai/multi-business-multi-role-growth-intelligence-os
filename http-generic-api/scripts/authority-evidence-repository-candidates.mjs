#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildAuthorityEvidenceRepositoryCandidates } from "../authorityEvidenceRepositoryCandidateBuilder.js";

function parseArgs(argv) {
  const options = {
    inputFile: null,
    repository: null,
    observedRef: null,
    repositoryRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
    sourceDirectory: "specs/011-unified-effective-authority-control-plane/evidence-sources",
    indexOutput: "specs/011-unified-effective-authority-control-plane/evidence-sources/candidate-index.json",
    generatedAt: null,
    write: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      return value;
    };
    if (argument === "--input-file") options.inputFile = take();
    else if (argument.startsWith("--input-file=")) options.inputFile = argument.slice(13);
    else if (argument === "--repository") options.repository = take();
    else if (argument.startsWith("--repository=")) options.repository = argument.slice(13);
    else if (argument === "--observed-ref") options.observedRef = take();
    else if (argument.startsWith("--observed-ref=")) options.observedRef = argument.slice(15);
    else if (argument === "--repository-root") options.repositoryRoot = take();
    else if (argument.startsWith("--repository-root=")) options.repositoryRoot = argument.slice(18);
    else if (argument === "--source-directory") options.sourceDirectory = take();
    else if (argument.startsWith("--source-directory=")) options.sourceDirectory = argument.slice(19);
    else if (argument === "--index-output") options.indexOutput = take();
    else if (argument.startsWith("--index-output=")) options.indexOutput = argument.slice(15);
    else if (argument === "--generated-at") options.generatedAt = take();
    else if (argument.startsWith("--generated-at=")) options.generatedAt = argument.slice(15);
    else if (argument === "--write") options.write = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.inputFile || !options.repository || !options.observedRef) {
    throw new Error("--input-file, --repository, and --observed-ref are required.");
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

function extractSnapshots(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.snapshots)) return input.snapshots;
  if (Array.isArray(input?.sources)) return input.sources;
  if (Array.isArray(input?.source_bundle?.sources)) return input.source_bundle.sources;
  throw new Error("Input must contain an array of source snapshots.");
}

function resolveRepositoryOutput(repositoryRoot, relativePath, label) {
  const root = fs.realpathSync(path.resolve(repositoryRoot));
  const declared = String(relativePath || "").trim().replaceAll("\\", "/");
  if (!declared || declared.startsWith("/") || declared.split("/").some((segment) => !segment || segment === "..")) {
    throw new Error(`${label} must be a safe repository-relative path.`);
  }
  const absolute = path.resolve(root, declared);
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (relative !== declared) throw new Error(`${label} escaped the repository root.`);
  return { root, declared, absolute };
}

function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}

export function runAuthorityEvidenceRepositoryCandidates(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const repositoryRoot = fs.realpathSync(path.resolve(process.cwd(), options.repositoryRoot));
  const input = readJson(options.inputFile, "authority source snapshot input");
  const result = buildAuthorityEvidenceRepositoryCandidates({
    snapshots: extractSnapshots(input),
    repository: options.repository,
    observed_ref: options.observedRef,
    generated_at: options.generatedAt || new Date(),
    source_directory: options.sourceDirectory,
  });

  const sourceDirectory = resolveRepositoryOutput(repositoryRoot, options.sourceDirectory, "source directory");
  const indexOutput = resolveRepositoryOutput(repositoryRoot, options.indexOutput, "index output");
  if (indexOutput.declared.startsWith(`${sourceDirectory.declared}/`) === false) {
    throw new Error("index output must remain inside the source directory.");
  }

  if (options.write) {
    for (const document of result.documents) {
      writeAtomic(path.join(sourceDirectory.absolute, document.file_name), document.content);
    }
    writeAtomic(indexOutput.absolute, `${JSON.stringify(result.index, null, 2)}\n`);
  }

  process.stdout.write(`${JSON.stringify({
    status: options.write ? "repository_source_candidates_written" : "repository_source_candidates_validated",
    observed_ref: result.index.observed_ref,
    source_file_count: result.index.source_file_count,
    source_directory: result.index.source_directory,
    candidate_index_sha256: result.index.candidate_index_sha256,
    manifest_status: result.index.manifest_status,
    review_required: true,
    closes_t001: false,
    closes_t002: false,
    secrets_included: false,
  })}\n`);
  return 0;
}

function directExecution() {
  return Boolean(process.argv[1])
    && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

export const _testingAuthorityEvidenceRepositoryCandidates = Object.freeze({
  parseArgs,
  extractSnapshots,
  resolveRepositoryOutput,
});

if (directExecution()) {
  try {
    process.exitCode = runAuthorityEvidenceRepositoryCandidates();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
