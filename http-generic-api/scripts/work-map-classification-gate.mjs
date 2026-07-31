#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchemaIntelligenceMaps } from "./platform-work-map-schema-intelligence.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
const REGISTRY_PATH = ".specify/work-map-intentional-unclassified.json";
const WORK_MAP_INDEX = "docs/work-maps/README.md";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function isoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value);
}

function nonEmptyStrings(value, min = 1) {
  return Array.isArray(value) && value.length >= min && value.every((row) => typeof row === "string" && row.trim());
}

function push(findings, type, details = {}) {
  findings.push({ type, ...details });
}

function parseIndexedMapFiles(root) {
  const source = fs.readFileSync(path.join(root, WORK_MAP_INDEX), "utf8");
  return new Set([...source.matchAll(/^- \[[^\]]+\]\(\.\/([^)]+\.md)\)\s*$/gm)].map((match) => match[1]));
}

export function validateIntentionalRegistry({ root = REPO_ROOT, now = new Date(), intentionalObjects = [] } = {}) {
  const findings = [];
  const file = path.join(root, REGISTRY_PATH);
  if (!fs.existsSync(file)) {
    push(findings, "missing_intentional_unclassified_registry", { file: REGISTRY_PATH });
    return findings;
  }

  let registry;
  try {
    registry = readJson(file);
  } catch (error) {
    push(findings, "invalid_intentional_unclassified_registry_json", { message: error.message });
    return findings;
  }

  if (registry.schema_version !== 1) push(findings, "invalid_intentional_registry_schema_version", { value: registry.schema_version });
  if (registry.default_disposition !== "forbidden") push(findings, "intentional_registry_not_fail_closed", { value: registry.default_disposition });
  if (registry.secrets_included !== false) push(findings, "intentional_registry_secret_boundary_missing");

  const indexedMaps = fs.existsSync(path.join(root, WORK_MAP_INDEX)) ? parseIndexedMapFiles(root) : new Set();
  const entries = Array.isArray(registry.entries) ? registry.entries : [];
  const names = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      push(findings, "invalid_intentional_unclassified_entry", { index });
      continue;
    }
    const name = entry.object_name;
    if (typeof name !== "string" || !name.trim()) push(findings, "intentional_entry_missing_object_name", { index });
    else if (names.has(name)) push(findings, "duplicate_intentional_unclassified_entry", { object_name: name });
    else names.add(name);

    if (!["table", "view"].includes(entry.object_type)) push(findings, "intentional_entry_invalid_object_type", { object_name: name, value: entry.object_type });
    if (typeof entry.owner !== "string" || entry.owner.trim().length < 2) push(findings, "intentional_entry_missing_owner", { object_name: name });
    if (typeof entry.rationale !== "string" || entry.rationale.trim().length < 40) push(findings, "intentional_entry_missing_rationale", { object_name: name });
    if (!nonEmptyStrings(entry.nearest_existing_map_refs, 2)) push(findings, "intentional_entry_missing_nearest_maps", { object_name: name });
    else {
      for (const mapRef of entry.nearest_existing_map_refs) {
        const normalized = mapRef.replace(/^docs\/work-maps\//, "");
        if (!indexedMaps.has(normalized)) push(findings, "intentional_entry_unknown_map_ref", { object_name: name, map_ref: mapRef });
      }
    }
    const requiredReuseOptions = [
      "reuse_existing_map",
      "extend_existing_map",
      "compose_existing_maps",
      "extend_existing_generator_or_taxonomy",
    ];
    if (!nonEmptyStrings(entry.reviewed_reuse_options, requiredReuseOptions.length)) {
      push(findings, "intentional_entry_missing_reuse_review", { object_name: name });
    } else {
      const missing = requiredReuseOptions.filter((value) => !entry.reviewed_reuse_options.includes(value));
      if (missing.length) push(findings, "intentional_entry_incomplete_reuse_review", { object_name: name, missing });
    }
    if (typeof entry.approval_ref !== "string" || !entry.approval_ref.trim()) push(findings, "intentional_entry_missing_approval", { object_name: name });
    if (!isoDate(entry.expires_at)) push(findings, "intentional_entry_invalid_expiry", { object_name: name, value: entry.expires_at });
    else if (new Date(entry.expires_at).getTime() <= now.getTime()) push(findings, "intentional_entry_expired", { object_name: name, expires_at: entry.expires_at });
    if (typeof entry.follow_up_gate !== "string" || !entry.follow_up_gate.trim()) push(findings, "intentional_entry_missing_follow_up_gate", { object_name: name });
  }

  const discovered = new Set(intentionalObjects.map((row) => row.name));
  for (const name of discovered) {
    if (!names.has(name)) push(findings, "intentional_object_missing_registry_entry", { object_name: name });
  }
  for (const name of names) {
    if (!discovered.has(name)) push(findings, "stale_intentional_registry_entry", { object_name: name });
  }
  return findings;
}

function parseObjectsFromCoverage(text, heading) {
  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  if (start < 0) return [];
  const after = text.indexOf("\n", start + marker.length);
  const rest = text.slice(after + 1);
  const next = rest.search(/^## /m);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  return [...section.matchAll(/^- `([^`]+)` \((table|view)\)$/gm)].map((match) => ({ name: match[1], type: match[2] }));
}

export function validateClassificationReport({ root = REPO_ROOT, now = new Date() } = {}) {
  const findings = [];
  const result = buildSchemaIntelligenceMaps({ repoRoot: root });
  const coverage = result.maps["work-map-coverage-matrix.md"] || "";
  const unresolved = parseObjectsFromCoverage(coverage, "Unresolved schema objects");
  const intentional = parseObjectsFromCoverage(coverage, "Intentionally unclassified schema objects");

  if (result.metrics.total_accounted_objects !== result.metrics.total_discovered_objects) {
    push(findings, "schema_object_accounting_mismatch", {
      accounted: result.metrics.total_accounted_objects,
      discovered: result.metrics.total_discovered_objects,
    });
  }
  if (result.metrics.unresolved_unclassified_objects !== unresolved.length) {
    push(findings, "unresolved_metric_mismatch", { metric: result.metrics.unresolved_unclassified_objects, rendered: unresolved.length });
  }
  if (result.metrics.intentional_unclassified_objects !== intentional.length) {
    push(findings, "intentional_metric_mismatch", { metric: result.metrics.intentional_unclassified_objects, rendered: intentional.length });
  }
  if (unresolved.length) push(findings, "unresolved_schema_objects_forbidden", { count: unresolved.length, objects: unresolved });
  findings.push(...validateIntentionalRegistry({ root, now, intentionalObjects: intentional }));

  return { findings, metrics: result.metrics, unresolved, intentional };
}

function main() {
  const report = validateClassificationReport();
  if (report.findings.length) {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: "work_map_schema_classification_gate_failed",
        message: "Every schema object must be classified or covered by a bounded intentional exception.",
        details: { findings: report.findings, metrics: report.metrics },
      },
      secrets_included: false,
    }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    policy_key: "work_map_schema_classification_gate_v1",
    classification_coverage_percent: report.metrics.classification_coverage_percent,
    discovered_objects: report.metrics.total_discovered_objects,
    classified_objects: report.metrics.classified_objects,
    intentional_unclassified_objects: report.metrics.intentional_unclassified_objects,
    unresolved_unclassified_objects: report.metrics.unresolved_unclassified_objects,
    gate: "fail_closed",
    secrets_included: false,
  }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
