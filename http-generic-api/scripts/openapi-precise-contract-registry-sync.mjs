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
const CONTRACT_REGISTRY_FRAGMENT_DIR = path.join(ROOT, "openapi-route-contracts.d");
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const HTTP_METHOD_KEYS = new Set([...HTTP_METHODS].map((method) => method.toLowerCase()));
const COMPOSITION_MODES = new Set(["ref", "inline"]);
const SUPPORT_TICKET_ROUTE_FILE = "routes/supportTicketRoutes.js";
const PLATFORM_PLUGIN_ROUTE_FILE = "routes/tenantPlatformPluginRoutes.js";
const PLATFORM_PLUGIN_RESOLVE_SIGNATURE = "POST /tenant/platform/plugins/resolve";
const PLATFORM_PLUGIN_RESOLVE_OPERATION_ID = "tenantPlatformPluginResolve";
const LEGACY_REGISTERED_PATH_TRANSITIONS = new Map([
  [
    "POST /admin/support/tickets/{ticket_id}/external-delivery/completion-certification",
    {
      route_file: SUPPORT_TICKET_ROUTE_FILE,
      operation_id: "supportTicketExternalDeliveryCompletionCertify",
      auth_profile: "admin_backend",
      consequential: false,
      composition_mode: "ref",
      path_item_ref: "./openapi/support-ticket-runtime-completion.yaml#/certifyAdminSupportTicketExternalDeliveryCompletion",
    },
  ],
  [
    PLATFORM_PLUGIN_RESOLVE_SIGNATURE,
    {
      route_file: PLATFORM_PLUGIN_ROUTE_FILE,
      operation_id: PLATFORM_PLUGIN_RESOLVE_OPERATION_ID,
      auth_profile: null,
      consequential: false,
      composition_mode: "inline",
      path_item_ref: "./openapi/platform-plugin-tenant-resolve.yaml#/tenantPlatformPluginResolvePath",
      legacy_request_required: ["plugin_key"],
      legacy_request_absent_properties: ["workspace_id"],
      legacy_contract_version: "one-selector-v1",
    },
  ],
]);

function loadYaml(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return YAML.parse(fs.readFileSync(filePath, "utf8")) || fallback;
}

function relativeSource(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, "/");
}

function loadCombinedRegistry() {
  const sources = [CONTRACT_REGISTRY_PATH];
  if (fs.existsSync(CONTRACT_REGISTRY_FRAGMENT_DIR)) {
    const fragments = fs.readdirSync(CONTRACT_REGISTRY_FRAGMENT_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
      .map((entry) => path.join(CONTRACT_REGISTRY_FRAGMENT_DIR, entry.name))
      .sort((left, right) => left.localeCompare(right));
    sources.push(...fragments);
  }

  const contracts = {};
  const contractSources = new Map();
  for (const sourcePath of sources) {
    const registry = loadYaml(sourcePath, { version: 1, contracts: {} });
    if (registry?.version !== undefined && registry.version !== 1) {
      throw new Error(`Unsupported OpenAPI route contract registry version in ${relativeSource(sourcePath)}.`);
    }
    const entries = registry?.contracts && typeof registry.contracts === "object"
      ? registry.contracts
      : {};
    for (const [signature, contract] of Object.entries(entries)) {
      if (Object.hasOwn(contracts, signature)) {
        throw new Error(`Duplicate OpenAPI route contract signature ${signature} in ${contractSources.get(signature)} and ${relativeSource(sourcePath)}.`);
      }
      contracts[signature] = contract;
      contractSources.set(signature, relativeSource(sourcePath));
    }
  }
  return {
    version: 1,
    contracts,
    source_files: sources.map(relativeSource),
  };
}

function normalizePath(routePath) {
  let value = String(routePath || "").trim();
  if (!value || value === "/") return "/";
  if (!value.startsWith("/")) value = `/${value}`;
  return value.replace(/:([A-Za-z0-9_]+)/g, "{$1").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function normalizeRegistry(input) {
  const entries = input?.contracts && typeof input.contracts === "object" ? input.contracts : {};
  const contracts = [];
  const pathRefs = new Map();
  const pathModes = new Map();
  for (const [rawSignature, rawContract] of Object.entries(entries)) {
    const signature = String(rawSignature || "").trim();
    const match = signature.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/);
    if (!match || !HTTP_METHODS.has(match[1])) throw new Error(`Invalid OpenAPI route contract signature: ${signature}`);
    const method = match[1];
    const routePath = normalizePath(match[2]);
    const pathItemRef = String(rawContract?.path_item_ref || "").trim();
    const routeFile = String(rawContract?.route_file || "").trim();
    const compositionMode = String(rawContract?.composition_mode || "ref").trim().toLowerCase();
    if (!pathItemRef.startsWith("./openapi/") || !pathItemRef.includes("#/")) {
      throw new Error(`OpenAPI route contract ${method} ${routePath} requires a local ./openapi/...#/ path_item_ref.`);
    }
    if (!COMPOSITION_MODES.has(compositionMode)) {
      throw new Error(`OpenAPI route contract ${method} ${routePath} has unsupported composition_mode ${compositionMode}.`);
    }
    const existingRef = pathRefs.get(routePath);
    if (existingRef && existingRef !== pathItemRef) throw new Error(`OpenAPI route contracts for ${routePath} must share one path-item ref.`);
    const existingMode = pathModes.get(routePath);
    if (existingMode && existingMode !== compositionMode) throw new Error(`OpenAPI route contracts for ${routePath} must share one composition_mode.`);
    pathRefs.set(routePath, pathItemRef);
    pathModes.set(routePath, compositionMode);
    contracts.push({
      signature: `${method} ${routePath}`,
      method,
      path: routePath,
      path_item_ref: pathItemRef,
      route_file: routeFile,
      composition_mode: compositionMode,
    });
  }
  return { contracts, pathRefs, pathModes };
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

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function equivalent(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function resolveJsonPointer(document, pointer, sourceLabel) {
  const normalized = String(pointer || "");
  if (!normalized.startsWith("/")) throw new Error(`OpenAPI precise contract ${sourceLabel} requires a JSON pointer fragment.`);
  let current = document;
  for (const rawPart of normalized.slice(1).split("/")) {
    const part = rawPart.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (!current || typeof current !== "object" || !(part in current)) {
      throw new Error(`OpenAPI precise contract ${sourceLabel} cannot resolve pointer #${normalized}.`);
    }
    current = current[part];
  }
  return current;
}

function loadReferencedPathItem(pathItemRef) {
  const separator = pathItemRef.indexOf("#");
  if (separator <= 0) throw new Error(`Invalid OpenAPI path_item_ref ${pathItemRef}.`);
  const relativeFile = pathItemRef.slice(0, separator);
  const pointer = pathItemRef.slice(separator + 1);
  const sourcePath = path.resolve(ROOT, relativeFile.replace(/^\.\//u, ""));
  const openApiDir = path.resolve(ROOT, "openapi");
  if (sourcePath !== openApiDir && !sourcePath.startsWith(`${openApiDir}${path.sep}`)) {
    throw new Error(`OpenAPI precise contract ${pathItemRef} must remain within http-generic-api/openapi/.`);
  }
  const document = loadYaml(sourcePath, null);
  if (!document) throw new Error(`Missing OpenAPI precise contract source ${relativeSource(sourcePath)}.`);
  const pathItem = resolveJsonPointer(document, pointer, pathItemRef);
  if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) {
    throw new Error(`OpenAPI precise contract ${pathItemRef} must resolve to one path-item object.`);
  }
  return JSON.parse(JSON.stringify(pathItem));
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

function legacyRequestShapeMatches(operation, transition) {
  const schema = operation?.requestBody?.content?.["application/json"]?.schema;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const properties = schema?.properties && typeof schema.properties === "object" ? schema.properties : {};
  if ((transition.legacy_request_required || []).some((field) => !required.includes(field))) return false;
  if ((transition.legacy_request_absent_properties || []).some((field) => Object.hasOwn(properties, field))) return false;
  if (transition.legacy_contract_version) {
    const versions = operation?.responses?.["200"]?.content?.["application/json"]?.schema
      ?.properties?.compatibility_telemetry?.properties?.contract_version?.enum;
    if (!Array.isArray(versions) || !versions.includes(transition.legacy_contract_version)) return false;
  }
  return true;
}

function isKnownLegacyRegisteredOperation(operation, contract) {
  if (!operation || typeof operation !== "object") return false;
  const transition = LEGACY_REGISTERED_PATH_TRANSITIONS.get(contract.signature);
  if (!transition) return false;
  const security = transition.auth_profile ? expectedSecurity(transition.auth_profile) : null;
  const securityMatches = transition.auth_profile
    ? security !== null && canonicalSecurity(operation.security) === canonicalSecurity(security)
    : true;
  return contract.route_file === transition.route_file
    && contract.path_item_ref === transition.path_item_ref
    && contract.composition_mode === transition.composition_mode
    && operation.operationId === transition.operation_id
    && typeof operation.summary === "string"
    && operation.summary.length > 0
    && operation.responses
    && typeof operation.responses === "object"
    && operation["x-openai-isConsequential"] === transition.consequential
    && securityMatches
    && legacyRequestShapeMatches(operation, transition)
    && operation["x-runtime-contract-source"] == null
    && operation["x-source-file"] == null
    && operation["x-runtime-auth-profile"] == null
    && operation["x-contract-completeness"] == null;
}

function isKnownWorkspaceV2RegisteredOperation(operation, contract) {
  if (!operation || typeof operation !== "object") return false;
  if (contract.signature !== PLATFORM_PLUGIN_RESOLVE_SIGNATURE
    || contract.route_file !== PLATFORM_PLUGIN_ROUTE_FILE
    || contract.path_item_ref !== "./openapi/platform-plugin-tenant-resolve.yaml#/tenantPlatformPluginResolvePath"
    || contract.composition_mode !== "inline") return false;

  const schema = operation?.requestBody?.content?.["application/json"]?.schema;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const properties = schema?.properties && typeof schema.properties === "object" ? schema.properties : {};
  const versions = operation?.responses?.["200"]?.content?.["application/json"]?.schema
    ?.properties?.compatibility_telemetry?.properties?.contract_version?.enum;
  const ownership = operation?.responses?.["200"]?.content?.["application/json"]?.schema
    ?.properties?.connection_ownership_resolution?.properties;
  const ownerScopeTypes = ownership?.owner_scope_type?.enum;
  const brandIncluded = ownership?.brand_connections_included?.enum;
  const security = expectedSecurity("user_jwt");

  return operation.operationId === PLATFORM_PLUGIN_RESOLVE_OPERATION_ID
    && operation["x-runtime-contract-source"] === PLATFORM_PLUGIN_ROUTE_FILE
    && operation["x-runtime-auth-profile"] === "user_jwt"
    && operation["x-contract-completeness"] === "precise-runtime-contract"
    && operation["x-openai-isConsequential"] === false
    && security !== null
    && canonicalSecurity(operation.security) === canonicalSecurity(security)
    && typeof operation.summary === "string"
    && operation.summary.length > 0
    && operation.responses
    && typeof operation.responses === "object"
    && required.includes("plugin_key")
    && required.includes("workspace_id")
    && Object.hasOwn(properties, "workspace_id")
    && Array.isArray(versions)
    && versions.length === 1
    && versions[0] === "one-selector-workspace-v2"
    && ownership
    && typeof ownership === "object"
    && Array.isArray(ownerScopeTypes)
    && ownerScopeTypes.includes("personal_workspace")
    && ownerScopeTypes.includes("company_workspace")
    && !ownerScopeTypes.includes("brand")
    && Array.isArray(brandIncluded)
    && brandIncluded.length === 1
    && brandIncluded[0] === false
    && !Object.hasOwn(ownership, "brand_authority_source");
}

function inspectReplaceableRegisteredPath(current, routePath, pathItemRef, contracts) {
  if (!current || typeof current !== "object" || Array.isArray(current) || current.$ref) return null;
  const currentKeys = Object.keys(current);
  if (currentKeys.length === 0 || currentKeys.some((key) => !HTTP_METHOD_KEYS.has(key))) return null;

  const expected = contracts.filter((contract) =>
    contract.path === routePath
    && contract.path_item_ref === pathItemRef);
  if (expected.length === 0) return null;

  const expectedMethods = new Set(expected.map((contract) => contract.method));
  if (expectedMethods.size !== currentKeys.length) return null;
  if (currentKeys.some((key) => !expectedMethods.has(key.toUpperCase()))) return null;
  if ([...expectedMethods].some((method) => !current[method.toLowerCase()])) return null;
  if (expected.some((contract) => {
    const operation = current[contract.method.toLowerCase()];
    return !isRuntimeDerivedRegisteredOperation(operation, contract.method)
      && !isKnownLegacyRegisteredOperation(operation, contract)
      && !isKnownWorkspaceV2RegisteredOperation(operation, contract);
  })) return null;

  return {
    path: routePath,
    path_item_ref: pathItemRef,
    composition_mode: expected[0].composition_mode,
    signatures: expected.map((contract) => contract.signature).sort(),
  };
}

function inspectRegistry(doc, pathRefs, contracts, pathModes) {
  const missing = [];
  const replaceable = [];
  const synced = [];
  const conflicts = [];
  for (const [routePath, pathItemRef] of [...pathRefs.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const compositionMode = pathModes.get(routePath) || "ref";
    const current = doc.paths?.[routePath];
    if (!current || Object.keys(current).length === 0) {
      missing.push({ path: routePath, path_item_ref: pathItemRef, composition_mode: compositionMode });
      continue;
    }
    if (compositionMode === "ref" && current.$ref === pathItemRef && Object.keys(current).length === 1) {
      synced.push({ path: routePath, path_item_ref: pathItemRef, composition_mode: compositionMode });
      continue;
    }
    if (compositionMode === "inline") {
      const canonicalPathItem = loadReferencedPathItem(pathItemRef);
      if (equivalent(current, canonicalPathItem)) {
        synced.push({ path: routePath, path_item_ref: pathItemRef, composition_mode: compositionMode });
        continue;
      }
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
      expected_composition_mode: compositionMode,
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

function buildRegisteredPathItem(entry) {
  return entry.composition_mode === "inline"
    ? loadReferencedPathItem(entry.path_item_ref)
    : { $ref: entry.path_item_ref };
}

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const openApiSource = fs.readFileSync(OPENAPI_PATH, "utf8");
  const doc = YAML.parse(openApiSource) || {};
  doc.paths ||= {};
  const combinedRegistry = loadCombinedRegistry();
  const { contracts, pathRefs, pathModes } = normalizeRegistry(combinedRegistry);
  const runtimeOperations = collectSupportTicketRuntimeOperations(ROOT);
  const beforeRegistry = inspectRegistry(doc, pathRefs, contracts, pathModes);
  const beforeRuntime = inspectSupportTicketRuntimeContracts(doc, runtimeOperations, contracts, pathRefs);
  const conflicts = [...beforeRegistry.conflicts, ...beforeRuntime.conflicts];
  if (conflicts.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      code: "openapi_precise_contract_path_conflict",
      registry_source_count: combinedRegistry.source_files.length,
      registry_sources: combinedRegistry.source_files,
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
  ].map((entry) => [entry.path, buildRegisteredPathItem(entry)]));
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
    afterRegistry = inspectRegistry(updatedDoc, pathRefs, contracts, pathModes);
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
    registry_source_count: combinedRegistry.source_files.length,
    registry_sources: combinedRegistry.source_files,
    precise_contract_count: contracts.length,
    inline_contract_count: contracts.filter((contract) => contract.composition_mode === "inline").length,
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