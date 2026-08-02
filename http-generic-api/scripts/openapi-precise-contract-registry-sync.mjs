import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  buildSupportTicketRuntimePathItems,
  collectSupportTicketRuntimeOperations,
  inspectSupportTicketRuntimeContracts,
} from "./support-ticket-runtime-openapi-contracts.mjs";

const ROOT = process.cwd();
const OPENAPI_PATH = path.join(ROOT, "openapi.yaml");
const CONTRACT_REGISTRY_PATH = path.join(ROOT, "openapi-route-contracts.yaml");
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function loadYaml(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return YAML.parse(fs.readFileSync(filePath, "utf8")) || fallback;
}

function normalizePath(routePath) {
  let value = String(routePath || "").trim();
  if (!value || value === "/") return "/";
  if (!value.startsWith("/")) value = `/${value}`;
  return value.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function normalizeRegistry(input) {
  const entries = input?.contracts && typeof input.contracts === "object" ? input.contracts : {};
  const contracts = [];
  const pathRefs = new Map();
  for (const [rawSignature, rawContract] of Object.entries(entries)) {
    const signature = String(rawSignature || "").trim();
    const match = signature.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/);
    if (!match || !HTTP_METHODS.has(match[1])) throw new Error(`Invalid OpenAPI route contract signature: ${signature}`);
    const method = match[1];
    const routePath = normalizePath(match[2]);
    const pathItemRef = String(rawContract?.path_item_ref || "").trim();
    if (!pathItemRef.startsWith("./openapi/") || !pathItemRef.includes("#/")) {
      throw new Error(`OpenAPI route contract ${method} ${routePath} requires a local ./openapi/...#/ path_item_ref.`);
    }
    const existingRef = pathRefs.get(routePath);
    if (existingRef && existingRef !== pathItemRef) throw new Error(`OpenAPI route contracts for ${routePath} must share one path-item ref.`);
    pathRefs.set(routePath, pathItemRef);
    contracts.push({ signature: `${method} ${routePath}`, method, path: routePath, path_item_ref: pathItemRef });
  }
  return { contracts, pathRefs };
}

function inspectRegistry(doc, pathRefs) {
  const missing = [];
  const synced = [];
  const conflicts = [];
  for (const [routePath, pathItemRef] of [...pathRefs.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const current = doc.paths?.[routePath];
    if (!current || Object.keys(current).length === 0) missing.push({ path: routePath, path_item_ref: pathItemRef });
    else if (current.$ref === pathItemRef && Object.keys(current).length === 1) synced.push({ path: routePath, path_item_ref: pathItemRef });
    else conflicts.push({ path: routePath, expected_path_item_ref: pathItemRef, current });
  }
  return { missing, synced, conflicts };
}

function renderPathEntries(entries) {
  const object = {};
  for (const [routePath, pathItem] of [...entries.entries()].sort(([left], [right]) => left.localeCompare(right))) object[routePath] = pathItem;
  return YAML.stringify(object, { lineWidth: 0 }).trimEnd().split("\n").map((line) => `  ${line}`).join("\n") + "\n";
}

function applyPathEntriesWithoutReformatting(source, entries) {
  if (entries.size === 0) return source;
  const pathsMatch = /^paths:\s*(\{\s*\})?\s*$/m.exec(source);
  if (!pathsMatch) throw new Error("Root OpenAPI document must contain a top-level paths section before precise contracts can be composed.");
  const block = renderPathEntries(entries);
  const beforeLine = source.slice(0, pathsMatch.index);
  const afterLine = source.slice(pathsMatch.index + pathsMatch[0].length);
  if (pathsMatch[1]) {
    const normalizedAfter = afterLine.startsWith("\n") ? afterLine.slice(1) : afterLine;
    return `${beforeLine}paths:\n${block}${normalizedAfter}`;
  }
  const sectionStart = pathsMatch.index + pathsMatch[0].length;
  const sectionTail = source.slice(sectionStart);
  const nextTopLevel = /^(?!\s|#)([A-Za-z0-9_$"'-][^:\n]*):(?:\s.*)?$/m.exec(sectionTail);
  const insertionIndex = nextTopLevel ? sectionStart + nextTopLevel.index : source.length;
  const prefix = source.slice(0, insertionIndex);
  const suffix = source.slice(insertionIndex);
  const normalizedPrefix = prefix.endsWith("\n") ? prefix : `${prefix}\n`;
  const normalizedSuffix = suffix && !suffix.startsWith("\n") ? `\n${suffix}` : suffix;
  return `${normalizedPrefix}${block}${normalizedSuffix}`;
}

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const openApiSource = fs.readFileSync(OPENAPI_PATH, "utf8");
  const doc = YAML.parse(openApiSource) || {};
  doc.paths ||= {};
  const { contracts, pathRefs } = normalizeRegistry(loadYaml(CONTRACT_REGISTRY_PATH, { contracts: {} }));
  const runtimeOperations = collectSupportTicketRuntimeOperations(ROOT);
  const beforeRegistry = inspectRegistry(doc, pathRefs);
  const beforeRuntime = inspectSupportTicketRuntimeContracts(doc, runtimeOperations, contracts, pathRefs);
  const conflicts = [...beforeRegistry.conflicts, ...beforeRuntime.conflicts];
  if (conflicts.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      code: "openapi_precise_contract_path_conflict",
      precise_contract_count: contracts.length,
      support_ticket_runtime_operation_count: runtimeOperations.length,
      missing_registry_count: beforeRegistry.missing.length,
      missing_runtime_path_count: beforeRuntime.missingByPath.size,
      conflict_count: conflicts.length,
      conflicts,
    }, null, 2));
    process.exit(1);
  }

  const entries = new Map(beforeRegistry.missing.map((entry) => [entry.path, { $ref: entry.path_item_ref }]));
  for (const [routePath, pathItem] of buildSupportTicketRuntimePathItems(beforeRuntime.missingByPath)) {
    if (entries.has(routePath)) throw new Error(`Duplicate precise OpenAPI path composition requested for ${routePath}.`);
    entries.set(routePath, pathItem);
  }

  let afterRegistry = beforeRegistry;
  let afterRuntime = beforeRuntime;
  if (write && entries.size > 0) {
    const updatedSource = applyPathEntriesWithoutReformatting(openApiSource, entries);
    const updatedDoc = YAML.parse(updatedSource) || {};
    afterRegistry = inspectRegistry(updatedDoc, pathRefs);
    afterRuntime = inspectSupportTicketRuntimeContracts(updatedDoc, runtimeOperations, contracts, pathRefs);
    if (afterRegistry.missing.length || afterRegistry.conflicts.length || afterRuntime.missingByPath.size || afterRuntime.conflicts.length) {
      throw new Error("Precise route-contract composition failed post-write verification.");
    }
    fs.writeFileSync(OPENAPI_PATH, updatedSource.endsWith("\n") ? updatedSource : `${updatedSource}\n`);
  }

  const staticRuntimeSignatureCount = contracts.filter((contract) => runtimeOperations.some((operation) => operation.signature === contract.signature)).length;
  const result = {
    ok: afterRegistry.missing.length === 0 && afterRegistry.conflicts.length === 0 && afterRuntime.missingByPath.size === 0 && afterRuntime.conflicts.length === 0,
    changed: write && entries.size > 0,
    precise_contract_count: contracts.length,
    support_ticket_runtime_operation_count: runtimeOperations.length,
    support_ticket_generated_operation_count: runtimeOperations.length - staticRuntimeSignatureCount,
    applied_path_count: write ? entries.size : 0,
    missing_registry_count: afterRegistry.missing.length,
    missing_runtime_path_count: afterRuntime.missingByPath.size,
    conflict_count: afterRegistry.conflicts.length + afterRuntime.conflicts.length,
    missing_registry: afterRegistry.missing,
    missing_runtime_paths: [...afterRuntime.missingByPath.keys()].sort(),
    conflicts: [...afterRegistry.conflicts, ...afterRuntime.conflicts],
  };
  console.log(JSON.stringify(result, null, 2));
  if (check && !result.ok) process.exit(1);
}

main();
