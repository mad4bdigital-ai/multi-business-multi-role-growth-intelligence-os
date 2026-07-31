import fs from "node:fs";
import path from "node:path";

const CONTRACT_MANIFEST_FILES = Object.freeze([
  { file: "resource-api-mutation-callability.manifest.json", schemaVersion: "resource-api-mutation-callability-v1" },
  { file: "resource-api-surface-callability.manifest.json", schemaVersion: "resource-api-surface-callability-v1" },
]);
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const EFFECT_PROFILES = Object.freeze({
  read_only: Object.freeze({
    read_only: true,
    provider_calls_allowed: false,
    external_writes_allowed: false,
    database_writes_allowed: false,
    transaction_required: false,
    same_cycle_readback_required: false,
    credential_payload_reads_allowed: false,
  }),
  database_mutation: Object.freeze({
    read_only: false,
    provider_calls_allowed: false,
    external_writes_allowed: false,
    database_writes_allowed: true,
    transaction_required: true,
    same_cycle_readback_required: true,
    credential_payload_reads_allowed: false,
  }),
  provider_read: Object.freeze({
    read_only: true,
    provider_calls_allowed: true,
    external_writes_allowed: false,
    database_writes_allowed: false,
    transaction_required: false,
    same_cycle_readback_required: true,
    credential_payload_reads_allowed: true,
  }),
  external_execute: Object.freeze({
    read_only: false,
    provider_calls_allowed: true,
    external_writes_allowed: true,
    database_writes_allowed: true,
    transaction_required: true,
    same_cycle_readback_required: true,
    credential_payload_reads_allowed: true,
  }),
});

function unique(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

function overrideValue(fileOverrides, relativePath) {
  if (fileOverrides instanceof Map) return fileOverrides.has(relativePath) ? fileOverrides.get(relativePath) : undefined;
  if (fileOverrides && Object.prototype.hasOwnProperty.call(fileOverrides, relativePath)) return fileOverrides[relativePath];
  return undefined;
}

function readContractSource({ root, relativePath, fileOverrides, findings, contractKey, role }) {
  if (!relativePath || typeof relativePath !== "string") {
    findings.push({ type: "direct_route_contract_file_not_declared", contract_key: contractKey, role });
    return null;
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    findings.push({ type: "direct_route_contract_file_outside_root", contract_key: contractKey, role, file: relativePath });
    return null;
  }
  const overridden = overrideValue(fileOverrides, relativePath);
  if (overridden !== undefined) return String(overridden);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    findings.push({ type: "direct_route_contract_file_missing", contract_key: contractKey, role, file: relativePath });
    return null;
  }
  return fs.readFileSync(resolvedPath, "utf8");
}

function requireMarkers({ source, markers, findings, contractKey, role, file }) {
  if (!Array.isArray(markers) || markers.length === 0) {
    findings.push({ type: "direct_route_contract_markers_missing", contract_key: contractKey, role, file });
    return;
  }
  for (const marker of markers) {
    if (typeof marker !== "string" || marker.length === 0) {
      findings.push({ type: "direct_route_contract_marker_invalid", contract_key: contractKey, role, file });
      continue;
    }
    if (source !== null && !source.includes(marker)) findings.push({ type: "direct_route_contract_marker_missing", contract_key: contractKey, role, file, marker });
  }
}

function loadContractManifests(root, findings) {
  const contracts = [];
  for (const definition of CONTRACT_MANIFEST_FILES) {
    const filePath = path.join(path.resolve(root), definition.file);
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (payload.schema_version !== definition.schemaVersion || !Array.isArray(payload.contracts)) {
        findings.push({ type: "callability_manifest_invalid", file: definition.file, expected_schema_version: definition.schemaVersion });
        continue;
      }
      contracts.push(...payload.contracts);
    } catch (error) {
      findings.push({ type: "callability_manifest_invalid", file: definition.file, message: String(error?.message || error) });
    }
  }
  return contracts;
}

function contractToolBindings(contract, findings, contractKey) {
  if (contract?.tool_keys !== undefined && !Array.isArray(contract.tool_keys)) {
    findings.push({ type: "direct_route_contract_tool_keys_invalid", contract_key: contractKey || null });
  }
  if (contract?.tool_bindings !== undefined && !Array.isArray(contract.tool_bindings)) {
    findings.push({ type: "direct_route_contract_tool_bindings_invalid", contract_key: contractKey || null });
  }

  const contractMigrationFile = String(contract?.migration_file || "").trim();
  const legacyCandidates = [contract?.tool_key, ...(Array.isArray(contract?.tool_keys) ? contract.tool_keys : [])];
  const invalidLegacy = legacyCandidates.filter((value) => value !== undefined && (typeof value !== "string" || value.trim().length === 0));
  for (const value of invalidLegacy) findings.push({ type: "direct_route_contract_tool_key_invalid", contract_key: contractKey || null, tool_key: value ?? null });

  const bindings = unique(legacyCandidates.filter((value) => typeof value === "string").map((value) => value.trim())).map((toolKey) => ({
    tool_key: toolKey,
    migration_file: contractMigrationFile,
    migration_markers: contract?.migration_markers,
  }));

  for (const rawBinding of Array.isArray(contract?.tool_bindings) ? contract.tool_bindings : []) {
    if (!rawBinding || typeof rawBinding !== "object" || Array.isArray(rawBinding)) {
      findings.push({ type: "direct_route_contract_tool_binding_invalid", contract_key: contractKey || null });
      continue;
    }
    const toolKey = String(rawBinding.tool_key || "").trim();
    const migrationFile = String(rawBinding.migration_file || "").trim();
    if (!toolKey) findings.push({ type: "direct_route_contract_tool_key_missing", contract_key: contractKey || null });
    if (!migrationFile) findings.push({ type: "direct_route_contract_migration_file_missing", contract_key: contractKey || null, tool_key: toolKey || null });
    bindings.push({ tool_key: toolKey, migration_file: migrationFile, migration_markers: rawBinding.migration_markers });
  }

  const seen = new Set();
  for (const binding of bindings) {
    if (!binding.tool_key) continue;
    if (seen.has(binding.tool_key)) findings.push({ type: "direct_route_contract_tool_key_duplicate", contract_key: contractKey || null, tool_key: binding.tool_key });
    seen.add(binding.tool_key);
  }
  return bindings.filter((binding) => binding.tool_key);
}

function validateEffectPolicy({ contract, method, findings, contractKey }) {
  const explicitEffectClass = contract?.effect_class !== undefined;
  const effectClass = String(contract?.effect_class || (method === "GET" ? "read_only" : "database_mutation")).trim();
  const profile = EFFECT_PROFILES[effectClass];
  if (!profile) {
    findings.push({ type: "direct_route_contract_effect_class_invalid", contract_key: contractKey || null, effect_class: effectClass || null });
    return effectClass || null;
  }

  const expectedPolicy = {
    auth_model: "user_jwt",
    runtime_execution_allowed: true,
    secrets_included: false,
    ...profile,
  };
  const legacyGetOptional = new Set(["database_writes_allowed", "transaction_required", "same_cycle_readback_required"]);
  for (const [field, expected] of Object.entries(expectedPolicy)) {
    if (!explicitEffectClass && method === "GET" && legacyGetOptional.has(field) && contract?.[field] === undefined) continue;
    if (contract?.[field] !== expected) findings.push({ type: "direct_route_contract_policy_mismatch", contract_key: contractKey || null, field, expected, actual: contract?.[field] });
  }
  return effectClass;
}

export function validateDirectRouteCallabilityContracts({ root = process.cwd(), manifest, fileOverrides = {} } = {}) {
  const findings = [];
  const baseContracts = manifest?.callability_gate?.direct_route_contracts;
  if (baseContracts !== undefined && !Array.isArray(baseContracts)) findings.push({ type: "direct_route_contracts_invalid" });
  const contracts = [...(Array.isArray(baseContracts) ? baseContracts : []), ...loadContractManifests(root, findings)];
  if (baseContracts === undefined && contracts.length === 0) return { ok: findings.length === 0, findings, contracts: [], covered_contracts: [], covered_tool_keys: [], covered_route_signatures: [], covered_migration_files: [], secrets_included: false };

  const seenContractKeys = new Set();
  const seenToolKeys = new Set();
  const seenRouteSignatures = new Set();
  const results = [];
  const coveredContracts = [];

  for (const contract of contracts) {
    const startFindingCount = findings.length;
    const contractKey = String(contract?.contract_key || "").trim();
    const toolBindings = contractToolBindings(contract, findings, contractKey);
    const routeSignature = String(contract?.route_signature || "").trim().replace(/^([a-z]+)\s+/i, (_, methodName) => `${methodName.toUpperCase()} `);
    const method = routeSignature.split(/\s+/, 1)[0] || "";

    if (!contractKey) findings.push({ type: "direct_route_contract_key_missing" });
    if (toolBindings.length === 0) findings.push({ type: "direct_route_contract_tool_key_missing", contract_key: contractKey || null });
    if (!ALLOWED_METHODS.has(method) || !/^[A-Z]+\s+\//.test(routeSignature)) findings.push({ type: "direct_route_contract_route_signature_invalid", contract_key: contractKey || null, route_signature: routeSignature || null });
    if (contractKey && seenContractKeys.has(contractKey)) findings.push({ type: "direct_route_contract_key_duplicate", contract_key: contractKey });
    for (const binding of toolBindings) {
      if (!binding.migration_file) findings.push({ type: "direct_route_contract_migration_file_missing", contract_key: contractKey || null, tool_key: binding.tool_key });
      if (seenToolKeys.has(binding.tool_key)) findings.push({ type: "direct_route_contract_tool_key_duplicate", contract_key: contractKey || null, tool_key: binding.tool_key });
    }
    if (routeSignature && seenRouteSignatures.has(routeSignature)) findings.push({ type: "direct_route_contract_route_signature_duplicate", contract_key: contractKey || null, route_signature: routeSignature });
    if (contractKey) seenContractKeys.add(contractKey);
    for (const binding of toolBindings) seenToolKeys.add(binding.tool_key);
    if (routeSignature) seenRouteSignatures.add(routeSignature);

    const effectClass = validateEffectPolicy({ contract, method, findings, contractKey });

    const migrationGroups = new Map();
    for (const binding of toolBindings) {
      if (!binding.migration_file) continue;
      const markers = Array.isArray(binding.migration_markers) ? binding.migration_markers : [];
      const existing = migrationGroups.get(binding.migration_file) || [];
      migrationGroups.set(binding.migration_file, unique([...existing, ...markers]));
    }
    for (const [migrationFile, markers] of migrationGroups.entries()) {
      const source = readContractSource({ root, relativePath: migrationFile, fileOverrides, findings, contractKey: contractKey || null, role: "migration" });
      requireMarkers({ source, markers, findings, contractKey: contractKey || null, role: "migration", file: migrationFile });
    }

    for (const [role, fileField, markerField] of [
      ["route", "route_file", "route_markers"],
      ["mount", "mount_file", "mount_markers"],
      ["test", "test_file", "test_markers"],
      ["openapi", "openapi_file", "openapi_markers"],
    ]) {
      const relativePath = String(contract?.[fileField] || "").trim();
      const source = readContractSource({ root, relativePath, fileOverrides, findings, contractKey: contractKey || null, role });
      requireMarkers({ source, markers: contract?.[markerField], findings, contractKey: contractKey || null, role, file: relativePath || null });
    }

    const valid = findings.length === startFindingCount;
    const toolKeys = unique(toolBindings.map((binding) => binding.tool_key));
    const migrationFiles = unique(toolBindings.map((binding) => binding.migration_file));
    const result = {
      contract_key: contractKey || null,
      tool_key: toolKeys[0] || null,
      tool_keys: toolKeys,
      route_signature: routeSignature || null,
      migration_file: migrationFiles[0] || null,
      migration_files: migrationFiles,
      effect_class: effectClass,
      status: valid ? "covered" : "invalid",
    };
    results.push(result);
    if (valid) {
      for (const binding of toolBindings) coveredContracts.push({ ...result, tool_key: binding.tool_key, migration_file: binding.migration_file });
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    contracts: results,
    covered_contracts: coveredContracts,
    covered_tool_keys: unique(coveredContracts.map((contract) => contract.tool_key)),
    covered_route_signatures: unique(coveredContracts.map((contract) => contract.route_signature)),
    covered_migration_files: unique(coveredContracts.map((contract) => contract.migration_file)),
    secrets_included: false,
  };
}
