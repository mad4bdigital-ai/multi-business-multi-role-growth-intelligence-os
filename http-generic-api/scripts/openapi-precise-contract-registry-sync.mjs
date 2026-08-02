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
const HTTP_METHOD_KEYS = new Set([...HTTP_METHODS].map((method) => method.toLowerCase()));
const SUPPORT_TICKET_ROUTE_FILE = "routes/supportTicketRoutes.js";
const LEGACY_REGISTERED_PATH_TRANSITIONS = new Map([
  [
    "POST /admin/support/tickets/{ticket_id}/external-delivery/completion-certification",
    {
      operation_id: "supportTicketRuntimePostAdminSupportTicketsByTicketIdExternalDeliveryCompletionCertification",
      auth_profile: "admin_backend",
    },
  ],
]);

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
    const routeFile = String(rawContract?.route_file || "").trim();
    if (!pathItemRef.startsWith("./openapi/") || !pathItemRef.includes("#/")) {
      throw new Error(`OpenAPI route contract ${method} ${routePath} requires a local ./openapi/...#/ path_item_ref.`);
    }
    const existingRef = pathRefs.get(routePath);
    if (existingRef && existingRef !== pathItemRef) throw new Error(`OpenAPI route contracts for ${routePath} must share one path-item ref.`);
    pathRefs.set(routePath, pathItemRef);
    contracts.push({
      signature: `${method} ${routePath}`,
      method,
      path: routePath,
      path_item_ref: pathItemRef,
      route_file: routeFile,
    });
  }
  return { contracts, pathRefs };
}

function canonicalSecurity(value) {
  return JSON.stringify((Array.isArray(value) ? value : [])
    .map((entry) => Object.keys(entry || {}).sort())
    .sort());
}

function expectedSecurity(profile) {
  if (profile === "admin_backend") return [{ adminBearerAuth: [] }, { backendApiKeyAuth: [] }];
  if (profile === "user_jwt") return [{ userJwtAuth: [] }];
  return null;
}

function isRuntimeDerivedRegisteredOperation(operation, method) {
  if (!operation || typeof operation !== "object") return false;
  const profile = operation["x-runtime-auth-profile"];
  const security = expectedSecurity(profile);
  return operation["x-runtime-contract-source"] === SUPPORT_TICKET_ROUTE_FILE
    && security !== null
    && typeof operation.operationId === "string"
    && operation.operationId.startsWith("supportTicketRuntime")
    && typeof operation.summary === "string"
    && operation.summary.length > 0
    && operation.responses
    && typeof operation.responses === "object"
    && operation["x-contract-completeness"] !== "operation-index-only"
    && operation["x-openai-isConsequential"] === (method !== "GET")
    && canonicalSecurity(operation.security) === canonicalSecurity(security);
}

function isKnownLegacyRegisteredOperation(operation, contract) {
  if (!operation || typeof operation !== "object") return false;
  const transition = LEGACY_REGISTERED_PATH_TRANSITIONS.get(contract.signature);
  if (!transition) return false;
  const security = expectedSecurity(transition.auth_profile);
  return contract.route_file === SUPPORT_TICKET_ROUTE_FILE
    && operation.operationId === transition.operation_id
    && typeof operation.summary === "string"
    && operation.summary.length > 0
    && operation.responses
    && typeof operation.responses === "object"
    && operation["x-openai-isConsequential"] === (contract.method !== "GET")
    && canonicalSecurity(operation.security) === canonicalSecurity(security)
    && operation["x-runtime-contract-source"] == null
    && operation["x-source-file"] == null
    && operation["x-runtime-auth-profile"] == null
    && operation["x-contract-completeness"] == null;
}

function inspectReplaceableRegisteredPath(current, routePath, pathItemRef, contracts) {
  if (!current || typeof current !== "object" || Array.isArray(current) || current.$ref) return null;
  const currentKeys = Object.keys(current);
  if (currentKeys.length === 0 || currentKeys.some((key) => !HTTP_METHOD_KEYS.has(key))) return null;

  const expected = contracts.filter((contract) =>
    contract.path === routePath
    && contract.path_item_ref === pathItemRef
    && contract.route_file === SUPPORT_TICKET_ROUTE_FILE);
  if (expected.length === 0) return null;

  const expectedMethods = new Set(expected.map((contract) => contract.method));
  if (expectedMethods.size !== currentKeys.length) return null;
  if (currentKeys.some((key) => !expectedMethods.has(key.toUpperCase()))) return null;
  if ([...expectedMethods].some((method) => !current[method.toLowerCase()])) return null;
  if (expected.some((contract) => {
    const operation = current[contract.method.toLowerCase()];
    return !isRuntimeDerivedRegisteredOperation(operation, contract.method)
      && !isKnownLegacyRegisteredOperation(operation, contract);
  })) return null;

  return {
    path: routePath,
    path_item_ref: pathItemRef,
    signatures: expected.map((contract) => contract.signature).sort(),
  };
}

function inspectRegistry(doc, pathRefs, contracts) {
  const missing = [];
  const replaceable = [];
  const synced = [];
  const conflicts = [];
  for (const [routePath, pathItemRef] of [...pathRefs.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const current = doc.paths?.[routePath];
    if (!current || Object.keys(current).length === 0) {
      missing.push({ path: routePath, path_item_ref: pathItemRef });
      continue;
    }
    if (current.$ref === pathItemRef && Object.keys(current).length === 1) {
      synced.push({ path: routePath, path_item_ref: pathItemRef });
      continue;
    }
    const replaceableEntry = inspectReplaceableRegisteredPath(current, routePath, pathItemRef, contracts);
    if (replaceableEntry) {
      replaceable.push(replaceableEntry);
      continue;
    }
    conflicts.push({
      path: routePath,
      code: "registered_path_inline_contract_not_replaceable",
      expected_path_item_ref: pathItemRef,
      current,
    });
  }
  return { missing, replaceable, synced, conflicts };
}

function renderPathEntries(entries) {
  const object = {};
  for (const [routePath, pathItem] of [...entries.entries()].sort(([left], [right]) => left.localeCompare(right))) object[routePath] = pathItem;
  return YAML.stringify(object, { lineWidth: 0 }).trimEnd().split("\n").map((line) => `  ${line}`).join("\n") + "\n";
}

function removePathEntriesWithoutReformatting(source, routePaths) {
  const targets = new Set(routePaths);
  if (targets.size === 0) return source;
  const found = new Set();
  const lines = source.split("\n");
  const output = [];
  let inPaths = false;
  let skipping = false;

  for (const line of lines) {
    if (!inPaths) {
      output.push(line);
      if (/^paths:\s*(?:\{\s*\})?\s*$/.test(line)) inPaths = true;
      continue;
    }

    if (/^(?!\s|#)([A-Za-z0-9_$"'-][^:\n]*):(?:\s.*)?$/.test(line)) {
      inPaths = false;
      skipping = false;
      output.push(line);
      continue;
    }

    const pathMatch = /^  (\/[^:]+):\s*$/.exec(line);
    if (pathMatch) {
      skipping = targets.has(pathMatch[1]);
      if (skipping) found.add(pathMatch[1]);
      else output.push(line);
      continue;
    }

    if (!skipping) output.push(line);
  }

  const missingTargets = [...targets].filter((routePath) => !found.has(routePath));
  if (missingTargets.length > 0) {
    throw new Error(`Legacy precise-contract replacement could not locate path blocks: ${missingTargets.join(", ")}`);
  }
  return output.join("\n");
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

function mergeRuntimeOperationsByPath(beforeRuntime) {
  const operationsByPath = new Map();
  for (const source of [beforeRuntime.missingByPath, beforeRuntime.replaceableByPath]) {
    for (const [routePath, operations] of source) {
      if (operationsByPath.has(routePath)) throw new Error(`Duplicate Support Ticket runtime composition requested for ${routePath}.`);
      operationsByPath.set(routePath, operations);
    }
  }
  return operationsByPath;
}

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const openApiSource = fs.readFileSync(OPENAPI_PATH, "utf8");
  const doc = YAML.parse(openApiSource) || {};
  doc.paths ||= {};
  const { contracts, pathRefs } = normalizeRegistry(loadYaml(CONTRACT_REGISTRY_PATH, { contracts: {} }));
  const runtimeOperations = collectSupportTicketRuntimeOperations(ROOT);
  const beforeRegistry = inspectRegistry(doc, pathRefs, contracts);
  const beforeRuntime = inspectSupportTicketRuntimeContracts(doc, runtimeOperations, contracts, pathRefs);
  const conflicts = [...beforeRegistry.conflicts, ...beforeRuntime.conflicts];
  if (conflicts.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      code: "openapi_precise_contract_path_conflict",
      precise_contract_count: contracts.length,
      support_ticket_runtime_operation_count: runtimeOperations.length,
      missing_count: beforeRegistry.missing.length,
      missing_registry_count: beforeRegistry.missing.length,
      replaceable_registered_path_count: beforeRegistry.replaceable.length,
      missing_runtime_path_count: beforeRuntime.missingByPath.size,
      replaceable_runtime_path_count: beforeRuntime.replaceableByPath.size,
      conflict_count: conflicts.length,
      conflicts,
    }, null, 2));
    process.exit(1);
  }

  const appliedPreciseContracts = write ? beforeRegistry.missing : [];
  const appliedRegisteredPathReplacements = write ? beforeRegistry.replaceable : [];
  const entries = new Map([
    ...beforeRegistry.missing,
    ...beforeRegistry.replaceable,
  ].map((entry) => [entry.path, { $ref: entry.path_item_ref }]));
  for (const [routePath, pathItem] of buildSupportTicketRuntimePathItems(mergeRuntimeOperationsByPath(beforeRuntime))) {
    if (entries.has(routePath)) throw new Error(`Duplicate precise OpenAPI path composition requested for ${routePath}.`);
    entries.set(routePath, pathItem);
  }

  let afterRegistry = beforeRegistry;
  let afterRuntime = beforeRuntime;
  if (write && entries.size > 0) {
    const replacementPaths = new Set([
      ...beforeRegistry.replaceable.map((entry) => entry.path),
      ...beforeRuntime.replaceableByPath.keys(),
    ]);
    const withoutLegacyIndexes = removePathEntriesWithoutReformatting(openApiSource, replacementPaths);
    const updatedSource = applyPathEntriesWithoutReformatting(withoutLegacyIndexes, entries);
    const updatedDoc = YAML.parse(updatedSource) || {};
    afterRegistry = inspectRegistry(updatedDoc, pathRefs, contracts);
    afterRuntime = inspectSupportTicketRuntimeContracts(updatedDoc, runtimeOperations, contracts, pathRefs);
    if (afterRegistry.missing.length
      || afterRegistry.replaceable.length
      || afterRegistry.conflicts.length
      || afterRuntime.missingByPath.size
      || afterRuntime.replaceableByPath.size
      || afterRuntime.conflicts.length) {
      throw new Error("Precise route-contract composition failed post-write verification.");
    }
    fs.writeFileSync(OPENAPI_PATH, updatedSource.endsWith("\n") ? updatedSource : `${updatedSource}\n`);
  }

  const staticRuntimeSignatureCount = contracts.filter((contract) => runtimeOperations.some((operation) => operation.signature === contract.signature)).length;
  const result = {
    ok: afterRegistry.missing.length === 0
      && afterRegistry.replaceable.length === 0
      && afterRegistry.conflicts.length === 0
      && afterRuntime.missingByPath.size === 0
      && afterRuntime.replaceableByPath.size === 0
      && afterRuntime.conflicts.length === 0,
    changed: write && entries.size > 0,
    precise_contract_count: contracts.length,
    applied_precise_contracts: appliedPreciseContracts,
    applied_registered_path_replacements: appliedRegisteredPathReplacements,
    support_ticket_runtime_operation_count: runtimeOperations.length,
    support_ticket_generated_operation_count: runtimeOperations.length - staticRuntimeSignatureCount,
    applied_path_count: write ? entries.size : 0,
    replaced_runtime_derived_registry_path_count: write ? beforeRegistry.replaceable.length : 0,
    replaced_runtime_index_path_count: write ? beforeRuntime.replaceableByPath.size : 0,
    missing_count: afterRegistry.missing.length,
    missing_registry_count: afterRegistry.missing.length,
    replaceable_registered_path_count: afterRegistry.replaceable.length,
    missing_runtime_path_count: afterRuntime.missingByPath.size,
    replaceable_runtime_path_count: afterRuntime.replaceableByPath.size,
    conflict_count: afterRegistry.conflicts.length + afterRuntime.conflicts.length,
    missing: afterRegistry.missing,
    missing_registry: afterRegistry.missing,
    replaceable_registered_paths: afterRegistry.replaceable,
    missing_runtime_paths: [...afterRuntime.missingByPath.keys()].sort(),
    replaceable_runtime_paths: [...afterRuntime.replaceableByPath.keys()].sort(),
    conflicts: [...afterRegistry.conflicts, ...afterRuntime.conflicts],
  };
  console.log(JSON.stringify(result, null, 2));
  if (check && !result.ok) process.exit(1);
}

main();
