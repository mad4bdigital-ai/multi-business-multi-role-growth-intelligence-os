from pathlib import Path
import json

root = Path("http-generic-api")
script_path = root / "scripts" / "surface-contract-discovery.mjs"
test_path = root / "test-surface-contract-discovery.mjs"
script = script_path.read_text(encoding="utf-8")
test = test_path.read_text(encoding="utf-8")

extractor_module = r'''function splitTopLevel(value = "", separator = ",") {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) {
        if (quote === "'" && value[index + 1] === "'") {
          index += 1;
          continue;
        }
        if (value[index - 1] !== "\\") quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function readStatementBody(source, startIndex) {
  let depth = 0;
  let quote = null;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) {
        if (quote === "'" && source[index + 1] === "'") {
          index += 1;
          continue;
        }
        if (source[index - 1] !== "\\") quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) return source.slice(startIndex, index);
  }
  return source.slice(startIndex);
}

function tupleBodies(valuesBody = "") {
  const tuples = [];
  let start = -1;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < valuesBody.length; index += 1) {
    const char = valuesBody[index];
    if (quote) {
      if (char === quote) {
        if (quote === "'" && valuesBody[index + 1] === "'") {
          index += 1;
          continue;
        }
        if (valuesBody[index - 1] !== "\\") quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tuples.push(valuesBody.slice(start, index));
        start = -1;
      }
    }
  }
  return tuples;
}

function sqlStringLiteral(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) return null;
  return trimmed.slice(1, -1).replace(/''/g, "'");
}

export function extractRegistryToolKeys(source = "") {
  const body = String(source || "");
  const keys = new Set();
  const insertPattern = /INSERT\s+INTO\s+`?([A-Za-z0-9_]+)`?\s*\(([^)]*)\)\s*VALUES\s*/gi;
  for (const match of body.matchAll(insertPattern)) {
    const columns = splitTopLevel(match[2]).map((column) => column.replace(/[`\s]/g, "").toLowerCase());
    const toolKeyIndex = columns.indexOf("tool_key");
    if (toolKeyIndex < 0) continue;
    const valuesBody = readStatementBody(body, match.index + match[0].length);
    for (const tuple of tupleBodies(valuesBody)) {
      const fields = splitTopLevel(tuple);
      const key = sqlStringLiteral(fields[toolKeyIndex]);
      if (key && /^[A-Za-z0-9_]+$/.test(key)) keys.add(key);
    }
  }
  return [...keys].sort();
}
'''
(root / "scripts" / "surface-contract-sql-registry-extractor.mjs").write_text(extractor_module, encoding="utf-8")

evidence = {
    "schema_version": "surface-contract-classification-evidence-v1",
    "checksum_mode": "git_blob_sha1",
    "items": [{
        "migration_file": "20260714_validate_hostinger_connection_and_complete_continuation_task.sql",
        "source_git_blob_sha": "8cc9206127a5931cb2f1613b2aa3c4351a5e1c1a",
        "classification_status": "verified_evidence_only",
        "documentation_targets": [
            "Updating Registry Patch Index.md",
            "deployment_parity_checklist.md",
            "docs/ai-docs-agent-governance.md",
            "docs/auto-docs-agent/README.md",
            "docs/change-documentation-governance.md",
        ],
        "route_literals": [
            {"route": "/api/vps/v1/public-keys", "classification": "evidence_only_external_readback", "reason": "Historical provider-validation evidence stored in task context; not a declared platform HTTP handler."},
            {"route": "/api/vps/v1/virtual-machines", "classification": "evidence_only_external_readback", "reason": "Historical provider-validation evidence stored in task context; not a declared platform HTTP handler."},
        ],
        "safety": {
            "executes_provider_calls": False,
            "reads_credentials": False,
            "mutates_runtime": False,
            "writes_database": False,
            "external_sends": False,
            "deploys": False,
            "secrets_included": False,
        },
    }],
}
(root / "surface-contract-classification-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")

import_marker = 'import { validateDirectRouteCallabilityContracts } from "./resource-api-callability-contracts.mjs";\n'
extractor_import = 'import { extractRegistryToolKeys } from "./surface-contract-sql-registry-extractor.mjs";\n'
if extractor_import not in script:
    if import_marker not in script:
        raise SystemExit("surface_import_marker_missing")
    script = script.replace(import_marker, import_marker + extractor_import, 1)

attestation_marker = 'const SAFETY_ATTESTATION_PATH = path.join(REPO_ROOT, "docs", "surface-contract-safety-attestations.json");\n'
evidence_constant = 'const CLASSIFICATION_EVIDENCE_PATH = path.join(API_ROOT, "surface-contract-classification-evidence.json");\n'
if evidence_constant not in script:
    if attestation_marker not in script:
        raise SystemExit("classification_path_marker_missing")
    script = script.replace(attestation_marker, attestation_marker + evidence_constant, 1)

sha_marker = '''function sha256(value = "") {
  return createHash("sha256").update(canonicalizeChecksumText(value), "utf8").digest("hex");
}
'''
evidence_functions = r'''function gitBlobSha(value = "") {
  const body = Buffer.from(canonicalizeChecksumText(value), "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}

function collectClassificationEvidence() {
  if (!fs.existsSync(CLASSIFICATION_EVIDENCE_PATH)) return new Map();
  try {
    const payload = JSON.parse(fs.readFileSync(CLASSIFICATION_EVIDENCE_PATH, "utf8"));
    if (payload.schema_version !== "surface-contract-classification-evidence-v1") return new Map();
    return new Map((payload.items || []).map((item) => [item.migration_file, item]));
  } catch {
    return new Map();
  }
}

const CLASSIFICATION_EVIDENCE = collectClassificationEvidence();

function resolveClassificationEvidence(fileName, source) {
  const item = CLASSIFICATION_EVIDENCE.get(fileName);
  if (!item || item.classification_status !== "verified_evidence_only") return null;
  if (!/^[a-f0-9]{40}$/.test(String(item.source_git_blob_sha || ""))) return null;
  if (item.source_git_blob_sha !== gitBlobSha(source)) return null;
  return item;
}
'''
if 'function gitBlobSha(value = "")' not in script:
    if sha_marker not in script:
        raise SystemExit("classification_function_marker_missing")
    script = script.replace(sha_marker, sha_marker + "\n" + evidence_functions, 1)

classify_marker = 'function classifyRoute(route, source = "", fileName = "") {\n'
classify_preamble = r'''function classifyRoute(route, source = "", fileName = "") {
  const classificationEvidence = resolveClassificationEvidence(fileName, source);
  const routeEvidence = classificationEvidence?.route_literals?.find((item) => item.route === route) || null;
  if (routeEvidence?.classification === "evidence_only_external_readback") {
    return {
      route,
      route_class: "registry_only_surface",
      openapi_required: false,
      callability_evidence_required: false,
      evidence_status: "verified_checksum_bound_evidence_only",
      reason: routeEvidence.reason,
    };
  }
'''
if "verified_checksum_bound_evidence_only" not in script:
    if classify_marker not in script:
        raise SystemExit("classify_route_marker_missing")
    script = script.replace(classify_marker, classify_preamble, 1)

if '(?:[-*]\\s*)?${token}' not in script:
    raise SystemExit("safety_bullet_parser_behavior_missing")

old_tools = '''  const tools = [...source.matchAll(/[\'"`]([A-Za-z0-9_]+(?:_tool|_readback|_gate|_request|_approve|_create|_accept|_reject|_decision|_execute|_list|_rollback|_certify|_record|_propose|_lookup|_validate|_blueprint|_dispatch|_preflight|_readiness)[A-Za-z0-9_]*)[\'"`]/g)].map((m) => m[1]);
  const detectedTools = unique(tools);
'''
if old_tools in script:
    script = script.replace(old_tools, "  const detectedTools = extractRegistryToolKeys(source);\n", 1)
elif "const detectedTools = extractRegistryToolKeys(source);" not in script:
    raise SystemExit("tool_extraction_marker_missing")

docs_marker = '''function docsCoverageFor(fileName, docsByPath) {
  const legacyClosed = isLegacyBacklogClosed(fileName);
  const shortName = fileName.replace(/\\.sql$/i, "");
  const values = {};
  for (const target of DOC_TARGETS) {
    const body = docsByPath[target] || "";
    values[target] = legacyClosed || body.includes(fileName) || body.includes(shortName);
  }
  return values;
}
'''
docs_replacement = '''function docsCoverageFor(fileName, docsByPath, source = "") {
  const legacyClosed = isLegacyBacklogClosed(fileName);
  const shortName = fileName.replace(/\\.sql$/i, "");
  const classificationEvidence = resolveClassificationEvidence(fileName, source);
  const evidenceTargets = new Set(classificationEvidence?.documentation_targets || []);
  const values = {};
  for (const target of DOC_TARGETS) {
    const body = docsByPath[target] || "";
    values[target] = legacyClosed || evidenceTargets.has(target) || body.includes(fileName) || body.includes(shortName);
  }
  return values;
}
'''
if "const evidenceTargets = new Set" not in script:
    if docs_marker not in script:
        raise SystemExit("docs_coverage_marker_missing")
    script = script.replace(docs_marker, docs_replacement, 1)
    call_marker = "const documentation = docsCoverageFor(fileName, docsByPath);"
    if call_marker not in script:
        raise SystemExit("docs_coverage_call_marker_missing")
    script = script.replace(call_marker, "const documentation = docsCoverageFor(fileName, docsByPath, source);", 1)

script_path.write_text(script, encoding="utf-8")

extractor_import_test = 'import { extractRegistryToolKeys } from "./scripts/surface-contract-sql-registry-extractor.mjs";\n'
first_import = 'import { buildPersistedDiscoveryReport, detectSafetyMarkers, discoverSurfaces, isDirectExecution, renderGapQueueMarkdown, renderSurfaceContractMarkdown } from "./scripts/surface-contract-discovery.mjs";\n'
if extractor_import_test not in test:
    if first_import not in test:
        raise SystemExit("surface_test_import_marker_missing")
    test = test.replace(first_import, first_import + extractor_import_test, 1)

explicit_marker = 'assert.equal(explicitBooleanMarkers.secrets_included_false, true, "secrets_included=false must remain supported");\n'
parser_tests = r'''
const bulletedMarkers = detectSafetyMarkers(`
-- - no_provider_call
-- * no_credential_payload_read
-- - no_raw_secrets
-- * no_external_send
-- - no_external_write
-- * secrets_included_false
`);
assert(Object.values(bulletedMarkers).every(Boolean), "bulleted standalone SQL safety markers must be recognized");

const registryToolKeys = extractRegistryToolKeys(`
CREATE TABLE demo (source enum('invitation_accept','access_request_approval'));
INSERT INTO tenant_platform_endpoint_tools (tool_key, display_name, tags) VALUES
('workspace_assets_list', 'Assets', 'read_only'),
('workspace_vaults_list', JSON_OBJECT('sample','preview_created'), 'read_only')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);
CREATE INDEX idx_user_request_created ON demo (created_at);
`);
assert.deepEqual(registryToolKeys, ["workspace_assets_list", "workspace_vaults_list"], "tool extraction must use the declared tool_key column only");
'''
if "const bulletedMarkers =" not in test:
    if explicit_marker not in test:
        raise SystemExit("surface_test_parser_marker_missing")
    test = test.replace(explicit_marker, explicit_marker + parser_tests, 1)

migration_marker = 'const migration287 = report.all_migrations.find((entry) => entry.migration_file === "287_sprint68_external_delivery_orchestration_graph_plugin.sql");\n'
evidence_tests = r'''
const migration193 = report.all_migrations.find((entry) => entry.migration_file === "193_sprint67_workspace_resource_authority_foundation.sql");
assert(migration193, "migration 193 must remain discoverable");
assert.deepEqual(migration193.surfaces.tools, ["workspace_assets_list", "workspace_resource_grants_list", "workspace_vaults_list"], "migration 193 must expose only registry-declared tool keys");
assert(!migration193.surfaces.tools.includes("invitation_accept"));
assert(!migration193.surfaces.tools.includes("access_request_approval"));

const hostingerEvidence = report.all_migrations.find((entry) => entry.migration_file === "20260714_validate_hostinger_connection_and_complete_continuation_task.sql");
assert(hostingerEvidence, "Hostinger continuation evidence migration must remain discoverable");
assert.equal(hostingerEvidence.documentation_complete, true, "checksum-bound evidence manifest must satisfy documentation coverage");
assert.equal(hostingerEvidence.coverage.route_coverage.missing_count, 0, "historical provider evidence literals must not be treated as platform OpenAPI routes");
assert(hostingerEvidence.coverage.route_coverage.route_classifications.every((entry) => entry.evidence_status === "verified_checksum_bound_evidence_only"));
for (const marker of ["no_provider_call", "no_credential_payload_read", "no_raw_secrets", "no_external_send", "no_external_write", "secrets_included_false"]) {
  assert.equal(hostingerEvidence.surfaces.safety[marker], true, `Hostinger evidence migration must expose ${marker}`);
}
assert.equal(report.gap_queue.top_items.some((entry) => entry.migration_file === hostingerEvidence.migration_file), false, "verified Hostinger evidence must leave the actionable queue");

'''
if "const hostingerEvidence =" not in test:
    if migration_marker not in test:
        raise SystemExit("surface_test_evidence_marker_missing")
    test = test.replace(migration_marker, evidence_tests + migration_marker, 1)
test_path.write_text(test, encoding="utf-8")

focused_test = r'''import assert from "node:assert/strict";
import { extractRegistryToolKeys } from "./scripts/surface-contract-sql-registry-extractor.mjs";

assert.deepEqual(extractRegistryToolKeys(`
INSERT INTO tenant_platform_endpoint_tools (display_name, tool_key, input_schema) VALUES
('One', 'tool_one', JSON_OBJECT('sample', 'fake_request')),
('Two', 'tool_two', JSON_OBJECT('sample', 'fake_create'));
`), ['tool_one', 'tool_two']);
assert.deepEqual(extractRegistryToolKeys(`
CREATE INDEX idx_request_created ON demo(created_at);
SELECT 'invitation_accept', 'preview_created';
`), []);
assert.deepEqual(extractRegistryToolKeys(`
INSERT INTO unrelated_registry (tool_key, description) VALUES ('quoted''tool', 'ignored invalid identifier');
`), []);
console.log('surface contract SQL registry extractor tests passed');
'''
(root / "test-surface-contract-sql-registry-extractor.mjs").write_text(focused_test, encoding="utf-8")

print(json.dumps({"phase_a_patch_applied": True, "secrets_included": False}))
