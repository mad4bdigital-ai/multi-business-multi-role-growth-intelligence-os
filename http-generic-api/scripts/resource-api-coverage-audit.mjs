#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateDirectRouteCallabilityContracts } from "./resource-api-callability-contracts.mjs";

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, "resource-api-coverage.manifest.json");
const ROUTE_PATH = path.join(ROOT, "routes", "resourceApiRoutes.js");
const OPENAPI_PATH = path.join(ROOT, "openapi.yaml");
const TENANT_OPENAPI_PATH = path.join(ROOT, "openapi", "openapi.tenant-gpt.auth.yaml");
const REQUIRED_STATES = new Set([
  "active", "existing_writer_only", "existing_runtime_only", "existing_workflows_only",
  "existing_decision_routes_only", "completed_state_only", "readback_guarded",
  "not_applicable", "not_yet_versioned", "blocked_by_policy", "migration_only",
]);

function fail(code, message, details = {}) {
  console.error(JSON.stringify({ ok: false, error: { code, message, details }, secrets_included: false }, null, 2));
  process.exit(1);
}

function normalizeRouteSignature(signature) {
  return String(signature).replace(/\{([^}]+)\}/g, ":$1").replace(/\s+/g, " ").trim();
}

function routeSignatures(source) {
  const result = new Set();
  const re = /router\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = re.exec(source)) !== null) result.add(`${match[1].toUpperCase()} ${match[2]}`);
  return result;
}

function openApiHas(source, signature) {
  const [method, routePath] = signature.split(" ", 2);
  const normalized = routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pathRe = new RegExp(`(?:^|\\n)\\s*${escaped}:\\s*\\n([\\s\\S]*?)(?=\\n\\s*\\/[A-Za-z0-9_{}./:-]+:\\s*\\n|\\ncomponents:|$)`);
  const block = source.match(pathRe)?.[1] || "";
  return new RegExp(`(?:^|\\n)\\s+${method.toLowerCase()}:`).test(block);
}

function gitChangedFiles() {
  const candidates = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}...HEAD` : null,
    "origin/main...HEAD", "HEAD~1...HEAD",
  ].filter(Boolean);
  for (const range of candidates) {
    try {
      const output = execFileSync("git", ["diff", "--name-only", range], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    } catch {}
  }
  return [];
}

function changedContent(files) {
  return files.map((file) => {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return "";
    return fs.readFileSync(full, "utf8");
  }).join("\n");
}

function declaredSurfacePolicies(source) {
  const decisions = new Set();
  const insertRe = /INSERT\s+INTO\s+platform_resource_surface_policy_registry\b[\s\S]*?(?:ON\s+DUPLICATE\s+KEY\s+UPDATE|;)/gi;
  for (const blockMatch of source.matchAll(insertRe)) {
    for (const row of blockMatch[0].matchAll(/["'](table|view|tool)["']\s*,\s*["']([A-Za-z0-9_]+)["']/g)) {
      decisions.add(`${row[1]}:${row[2]}`);
    }
  }
  return decisions;
}

function readContractSource(relativePath, findings, familyKey, role) {
  if (!relativePath) {
    findings.push({ type: "callability_contract_file_not_declared", family_key: familyKey, role });
    return null;
  }
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    findings.push({ type: "callability_contract_file_missing", family_key: familyKey, role, file: relativePath });
    return null;
  }
  return fs.readFileSync(fullPath, "utf8");
}

function validateCallabilityContracts(manifest, findings) {
  const coveredToolKeys = new Set();
  const gate = manifest.callability_gate || {};
  if (gate.required !== true) {
    findings.push({ type: "callability_gate_not_enabled" });
    return coveredToolKeys;
  }
  if (!Array.isArray(gate.contracts) || gate.contracts.length === 0) {
    findings.push({ type: "callability_contracts_missing" });
    return coveredToolKeys;
  }

  for (const contract of gate.contracts) {
    const familyKey = String(contract.family_key || "").trim() || null;
    if (!familyKey) {
      findings.push({ type: "callability_family_key_missing" });
      continue;
    }

    const contractSource = readContractSource(contract.contract_source_file, findings, familyKey, "contract_source");
    const registrySource = readContractSource(contract.admin_registry_file, findings, familyKey, "admin_registry");
    const implementationSource = readContractSource(contract.implementation_file, findings, familyKey, "implementation");

    if (contractSource && contract.contract_source_marker && !contractSource.includes(contract.contract_source_marker)) {
      findings.push({
        type: "callability_contract_source_marker_missing",
        family_key: familyKey,
        file: contract.contract_source_file,
        marker: contract.contract_source_marker,
      });
    }

    if (contractSource && contract.contract_key_pattern) {
      try {
        const expression = new RegExp(contract.contract_key_pattern, "g");
        const keys = [];
        let match;
        while ((match = expression.exec(contractSource)) !== null) {
          keys.push(String(match[1] || match[0] || "").trim());
          if (match[0] === "") expression.lastIndex += 1;
        }
        const uniqueKeys = new Set(keys.filter(Boolean));
        for (const key of uniqueKeys) coveredToolKeys.add(key);
        if (Number.isInteger(contract.expected_contract_count) && keys.length !== contract.expected_contract_count) {
          findings.push({
            type: "callability_contract_count_mismatch",
            family_key: familyKey,
            expected: contract.expected_contract_count,
            actual: keys.length,
          });
        }
        if (uniqueKeys.size !== keys.length) {
          findings.push({
            type: "callability_contract_keys_not_unique",
            family_key: familyKey,
            contract_count: keys.length,
            unique_count: uniqueKeys.size,
          });
        }
      } catch (error) {
        findings.push({
          type: "callability_contract_pattern_invalid",
          family_key: familyKey,
          pattern: contract.contract_key_pattern,
          message: String(error?.message || error),
        });
      }
    } else {
      findings.push({ type: "callability_contract_key_pattern_missing", family_key: familyKey });
    }

    for (const [markerRole, marker] of [
      ["descriptor", contract.descriptor_marker],
      ["handler", contract.handler_marker],
      ["handler_call", contract.handler_call_marker],
    ]) {
      if (!marker) {
        findings.push({ type: "callability_marker_not_declared", family_key: familyKey, role: markerRole });
      } else if (registrySource && !registrySource.includes(marker)) {
        findings.push({
          type: "callability_registry_marker_missing",
          family_key: familyKey,
          role: markerRole,
          file: contract.admin_registry_file,
          marker,
        });
      }
    }

    if (!contract.implementation_export_marker) {
      findings.push({ type: "callability_implementation_export_not_declared", family_key: familyKey });
    } else if (implementationSource && !implementationSource.includes(contract.implementation_export_marker)) {
      findings.push({
        type: "callability_implementation_export_missing",
        family_key: familyKey,
        file: contract.implementation_file,
        marker: contract.implementation_export_marker,
      });
    }

    for (const marker of contract.required_safety_markers || []) {
      if (implementationSource && !implementationSource.includes(marker)) {
        findings.push({
          type: "callability_safety_marker_missing",
          family_key: familyKey,
          file: contract.implementation_file,
          marker,
        });
      }
    }

    if (contract.admin_preview_required_while_disabled === true && !contract.admin_preview_tool) {
      findings.push({ type: "callability_admin_preview_not_declared", family_key: familyKey });
    }
    if (contract.runtime_execution_allowed !== false) {
      findings.push({ type: "callability_preview_runtime_execution_not_explicitly_blocked", family_key: familyKey });
    }
  }
  return coveredToolKeys;
}

const args = new Set(process.argv.slice(2));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const routeSource = fs.readFileSync(ROUTE_PATH, "utf8");
const routes = routeSignatures(routeSource);
const openapi = fs.readFileSync(OPENAPI_PATH, "utf8");
const tenantOpenapi = fs.readFileSync(TENANT_OPENAPI_PATH, "utf8");
const findings = [];

if (manifest.new_feature_gate?.require_surface_policy_decision !== true) findings.push({ type: "surface_policy_gate_not_enabled" });
if (manifest.new_feature_gate?.require_callable_handler_or_explicit_admin_preview !== true) {
  findings.push({ type: "callable_handler_or_admin_preview_gate_not_enabled" });
}
const callabilityCoveredTools = validateCallabilityContracts(manifest, findings);
const directRouteCallability = validateDirectRouteCallabilityContracts({ root: ROOT, manifest });
findings.push(...directRouteCallability.findings);
for (const toolKey of directRouteCallability.covered_tool_keys) callabilityCoveredTools.add(toolKey);

for (const resource of manifest.resources || []) {
  if (!resource.resource_key || !Array.isArray(resource.source_tables) || !resource.operations) {
    findings.push({ type: "invalid_resource_descriptor", resource_key: resource.resource_key || null });
    continue;
  }
  for (const operation of manifest.required_operation_classes || []) {
    const state = resource.operations[operation];
    if (!state) findings.push({ type: "missing_required_operation_class", resource_key: resource.resource_key, operation });
    else if (!REQUIRED_STATES.has(state)) findings.push({ type: "invalid_operation_state", resource_key: resource.resource_key, operation, state });
  }
  if (resource.tenant && !String(resource.scope_class || "").includes("tenant")) {
    findings.push({ type: "tenant_resource_missing_tenant_scope", resource_key: resource.resource_key, scope_class: resource.scope_class });
  }
}

for (const signature of manifest.route_operations || []) {
  const normalized = normalizeRouteSignature(signature);
  if (!routes.has(normalized)) findings.push({ type: "manifest_route_not_implemented", signature: normalized });
  const targetSpec = normalized.includes("/me/") ? tenantOpenapi : openapi;
  if (!openApiHas(targetSpec, normalized)) findings.push({ type: "route_missing_openapi_contract", signature: normalized });
}

const changedFiles = args.has("--changed") || args.has("--ci") ? gitChangedFiles() : [];
const combined = changedContent(changedFiles);
const surfacePolicyDecisions = declaredSurfacePolicies(combined);
if (combined) {
  const coveredTables = new Set((manifest.resources || []).flatMap((resource) => [...(resource.source_tables || []), ...(resource.read_models || [])]));
  const exemptionPatterns = (manifest.coverage_exemptions?.tables || []).map((row) => ({ ...row, re: new RegExp(row.pattern) }));
  for (const match of combined.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi)) {
    const kind = match[1].toLowerCase();
    const relation = match[2];
    const exempt = exemptionPatterns.some((row) => row.re.test(relation) && (!row.expires_on || new Date(`${row.expires_on}T23:59:59Z`) >= new Date()));
    if (!coveredTables.has(relation) && !exempt && !surfacePolicyDecisions.has(`${kind}:${relation}`)) {
      findings.push({ type: "new_relation_missing_surface_policy_decision", surface_kind: kind, relation });
    }
  }

  const manifestTools = new Set(manifest.tool_exports || []);
  for (const match of combined.matchAll(/(?:admin_platform_endpoint_tools|tenant_platform_endpoint_tools)[\s\S]{0,400}?['"]([a-z][a-z0-9_]{3,})['"]/gi)) {
    const toolKey = match[1];
    if (
      !manifestTools.has(toolKey)
      && !callabilityCoveredTools.has(toolKey)
      && !surfacePolicyDecisions.has(`tool:${toolKey}`)
      && !["tool_key", "display_name", "description"].includes(toolKey)
    ) {
      findings.push({
        type: "new_tool_missing_callability_contract_or_surface_policy_decision",
        tool_key: toolKey,
      });
    }
  }

  const changedRouteFiles = changedFiles.filter((file) => file.startsWith("routes/") && file.endsWith(".js"));
  for (const file of changedRouteFiles) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const signature of routeSignatures(source)) {
      if (file === "routes/resourceApiRoutes.js") continue;
      const documented = openApiHas(openapi, signature) || openApiHas(tenantOpenapi, signature);
      if (!documented) findings.push({ type: "new_route_missing_openapi_contract", file, signature });
    }
  }
}

const unique = [...new Map(findings.map((row) => [JSON.stringify(row), row])).values()];
if (unique.length) {
  fail("resource_api_coverage_gate_failed", "New or declared feature surfaces are missing governed Resource API coverage or an explicit surface-policy decision.", {
    finding_count: unique.length, findings: unique.slice(0, 200), changed_files: changedFiles,
  });
}

console.log(JSON.stringify({
  ok: true,
  policy_key: manifest.policy_key,
  resources: manifest.resources.length,
  route_operations: manifest.route_operations.length,
  tool_exports: manifest.tool_exports.length,
  surface_policy_decisions: surfacePolicyDecisions.size,
  changed_files_checked: changedFiles.length,
  gate: "fail_closed",
  secrets_included: false,
}));
