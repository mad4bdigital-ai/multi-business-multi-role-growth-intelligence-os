#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AUTHORITY_EVIDENCE_SOURCE_FAMILIES } from "../authorityEvidenceSourceAdapters.js";
import {
  collectGovernedAuthorityLiveEvidence,
  finalizeGovernedAuthorityLiveEvidence,
} from "../authorityLiveEvidenceOrchestrator.js";

function parseArgs(argv) {
  const options = {
    authorizationFile: null,
    sourcesFile: null,
    catalogFile: null,
    reviewFile: null,
    packetFile: null,
    reportFile: null,
    now: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = (name) => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
      index += 1;
      return value;
    };
    if (argument === "--authorization-file") options.authorizationFile = readValue(argument);
    else if (argument.startsWith("--authorization-file=")) options.authorizationFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--sources-file") options.sourcesFile = readValue(argument);
    else if (argument.startsWith("--sources-file=")) options.sourcesFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--catalog-file") options.catalogFile = readValue(argument);
    else if (argument.startsWith("--catalog-file=")) options.catalogFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--review-file") options.reviewFile = readValue(argument);
    else if (argument.startsWith("--review-file=")) options.reviewFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--packet-file") options.packetFile = readValue(argument);
    else if (argument.startsWith("--packet-file=")) options.packetFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--report-file") options.reportFile = readValue(argument);
    else if (argument.startsWith("--report-file=")) options.reportFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--now") options.now = readValue(argument);
    else if (argument.startsWith("--now=")) options.now = argument.slice(argument.indexOf("=") + 1);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.packetFile) {
    if (!options.reviewFile) throw new Error("--review-file is required with --packet-file.");
    return options;
  }
  if (!options.authorizationFile || !options.sourcesFile || !options.catalogFile) {
    throw new Error("--authorization-file, --sources-file, and --catalog-file are required when building a packet.");
  }
  return options;
}

function readJson(filePath, label) {
  const resolved = path.resolve(process.cwd(), filePath);
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} JSON at ${resolved}: ${error.message}`);
  }
}

function writeReport(filePath, report) {
  if (!filePath) return;
  const resolved = path.resolve(process.cwd(), filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporary, resolved);
}

function collectorsFromSnapshots(snapshots) {
  if (!Array.isArray(snapshots)) throw new Error("The sources file must contain an array.");
  const required = [...AUTHORITY_EVIDENCE_SOURCE_FAMILIES];
  if (snapshots.length !== required.length) {
    throw new Error(`The sources file must contain exactly ${required.length} authority source snapshots.`);
  }
  const allowed = new Set(required);
  const byFamily = new Map();
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new Error(`Source snapshot at index ${index} must be an object.`);
    }
    const family = String(snapshot.source_family || "").trim();
    if (!allowed.has(family)) {
      throw new Error(`Unknown authority source family at index ${index}: ${family || "missing"}.`);
    }
    if (byFamily.has(family)) {
      throw new Error(`Duplicate authority source snapshot: ${family}.`);
    }
    byFamily.set(family, snapshot);
  }
  const missing = required.filter((family) => !byFamily.has(family));
  if (missing.length) {
    throw new Error(`Missing authority source snapshots: ${missing.join(", ")}.`);
  }
  return Object.fromEntries(required.map((family) => [
    family,
    async () => byFamily.get(family),
  ]));
}

export async function runAuthorityLiveEvidenceReview(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let packet;
  if (options.packetFile) {
    packet = readJson(options.packetFile, "live evidence packet");
  } else {
    const authorization = readJson(options.authorizationFile, "operation authorization");
    const snapshots = readJson(options.sourcesFile, "source snapshots");
    const catalog = readJson(options.catalogFile, "catalog census");
    packet = await collectGovernedAuthorityLiveEvidence({
      operation_authorization: authorization,
      source_collectors: collectorsFromSnapshots(snapshots),
      catalog_collector: async () => catalog,
      now: options.now || new Date(),
    });
  }

  let report = packet;
  if (options.reviewFile) {
    const review = readJson(options.reviewFile, "ownership review");
    report = finalizeGovernedAuthorityLiveEvidence({
      live_evidence_packet: packet,
      review_entries: review.review_entries,
      reviewer_key: review.reviewer_key,
      reviewed_at: review.reviewed_at,
      readback_ref: review.readback_ref,
    });
  }

  writeReport(options.reportFile, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.status === "blocked" ? 2 : 0;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

export const _testingAuthorityLiveEvidenceReview = Object.freeze({
  parseArgs,
  collectorsFromSnapshots,
});

if (isDirectExecution()) {
  try {
    process.exitCode = await runAuthorityLiveEvidenceReview();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
