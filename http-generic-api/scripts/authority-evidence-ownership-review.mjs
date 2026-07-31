#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { buildAuthorityEvidenceSourceBundle } from "../authorityEvidenceSourceAdapters.js";
import { assessAuthorityOwnershipReview } from "../authorityOwnershipReview.js";

function parseArgs(argv) {
  const options = {
    sourcesFile: null,
    catalogFile: null,
    reviewFile: null,
    reportFile: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = (name) => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
      index += 1;
      return value;
    };
    if (argument === "--sources-file") options.sourcesFile = readValue(argument);
    else if (argument.startsWith("--sources-file=")) options.sourcesFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--catalog-file") options.catalogFile = readValue(argument);
    else if (argument.startsWith("--catalog-file=")) options.catalogFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--review-file") options.reviewFile = readValue(argument);
    else if (argument.startsWith("--review-file=")) options.reviewFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--report-file") options.reportFile = readValue(argument);
    else if (argument.startsWith("--report-file=")) options.reportFile = argument.slice(argument.indexOf("=") + 1);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.sourcesFile || !options.catalogFile || !options.reviewFile) {
    throw new Error("Usage: authority-evidence-ownership-review.mjs --sources-file <sources.json> --catalog-file <catalog.json> --review-file <review.json> [--report-file <report.json>]");
  }
  return options;
}

async function readJson(filePath, label) {
  const resolved = path.resolve(process.cwd(), filePath);
  try {
    return JSON.parse(await fs.readFile(resolved, "utf8"));
  } catch (error) {
    const wrapped = new Error(`Unable to read ${label} JSON at ${resolved}: ${error.message}`);
    wrapped.code = "AUTHORITY_EVIDENCE_JSON_READ_FAILED";
    throw wrapped;
  }
}

async function writeJson(filePath, value) {
  if (!filePath) return;
  const resolved = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, resolved);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const sourceInput = await readJson(options.sourcesFile, "sources");
  const catalog = await readJson(options.catalogFile, "catalog");
  const reviewInput = await readJson(options.reviewFile, "review");
  const sourceBundle = buildAuthorityEvidenceSourceBundle({
    sources: sourceInput.sources,
    expected_source_families: sourceInput.expected_source_families,
  });
  const ownershipReview = assessAuthorityOwnershipReview({
    catalog_census: catalog,
    source_bundle: sourceBundle,
    review_entries: reviewInput.review_entries,
    review_metadata: reviewInput.review_metadata,
  });
  const report = {
    contract: "mad4b.ueacp.authority-evidence-ownership-phase-report.v1",
    source_bundle: sourceBundle,
    ownership_review: ownershipReview,
    migration_apply_authorized: false,
    runtime_authority_changed: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  await writeJson(options.reportFile, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = ownershipReview.status === "ready_for_human_task_closure_review" ? 0 : 2;
} catch (error) {
  const report = {
    contract: "mad4b.ueacp.authority-evidence-ownership-phase-error.v1",
    status: "fail",
    error: {
      code: error?.code || "AUTHORITY_EVIDENCE_OWNERSHIP_PHASE_FAILED",
      message: error?.message || "Authority evidence and ownership review failed.",
    },
    closure_state: {
      t001_complete: false,
      t002_complete: false,
      migration_apply_authorized: false,
    },
    runtime_authority_changed: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
}
