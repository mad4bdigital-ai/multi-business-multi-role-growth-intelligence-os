#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_OUTPUT = "frontend-surface-dispatch.generated.json";
const DEFAULT_POLICY = "frontend-surface-policy.json";

function canonicalText(value = "") {
  return String(value).replace(/\r\n?/g, "\n");
}

function digest(value = "") {
  return createHash("sha256").update(canonicalText(value), "utf8").digest("hex");
}

function readText(file) {
  return fs.existsSync(file) ? canonicalText(fs.readFileSync(file, "utf8")) : "";
}

function readJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(readText(file));
}

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function normalizeRoutePath(value = "") {
  let route = String(value || "").trim();
  if (!route || route === "/") return "/";
  if (!route.startsWith("/")) route = `/${route}`;
  return route
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    .replace(/\$\{[^}]+\}/g, "{dynamic}")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "") || "/";
}

function joinRoutePath(prefix, route) {
  const left = normalizeRoutePath(prefix || "/");
  const right = normalizeRoutePath(route || "/");
  if (left === "/") return right;
  if (right === "/") return left;
  return normalizeRoutePath(`${left}/${right}`);
}

function toKebab(value = "") {
  return String(value)
    .replace(/Routes?\.js$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function decodeJsonPointerSegment(value = "") {
  return String(value).replace(/~1/g, "/").replace(/~0/g, "~");
}

function referencedPathItemMethods({ reference, sourcePath, apiRoot }) {
  const [relativeFile, fragment = ""] = String(reference || "").split("#", 2);
  if (!relativeFile || !fragment.startsWith("/") || !sourcePath || !apiRoot) return [];
  const target = path.resolve(path.dirname(sourcePath), relativeFile);
  const root = path.resolve(apiRoot);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return [];
  const source = readText(target);
  if (!source) return [];

  const segments = fragment.slice(1).split("/").map(decodeJsonPointerSegment);
  if (segments.length !== 1) return [];
  const key = segments[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = source.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*(?:#.*)?$`).test(line));
  if (start < 0) return [];
  const methods = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) break;
    const method = lines[index].match(/^\s{2}(get|post|put|patch|delete):\s*(?:#.*)?$/i)?.[1];
    if (method) methods.push(method.toUpperCase());
  }
  return methods;
}

function openApiReferenceFiles(source = "", sourcePath, apiRoot) {
  if (!sourcePath || !apiRoot) return [];
  const root = path.resolve(apiRoot);
  return unique([...canonicalText(source).matchAll(/^\s+\$ref:\s*["']?([^"'\s#]+\.ya?ml)#/gim)].map((match) => {
    const target = path.resolve(path.dirname(sourcePath), match[1]);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
    return target;
  }));
}

export function parseOpenApiOperations(source = "", { sourcePath, apiRoot } = {}) {
  const operations = new Set();
  let currentPath = "";
  for (const line of canonicalText(source).split("\n")) {
    const pathMatch = line.match(/^\s{2}(\/[^:]+):\s*$/);
    if (pathMatch) {
      currentPath = normalizeRoutePath(pathMatch[1]);
      continue;
    }
    const methodMatch = line.match(/^\s{4}(get|post|put|patch|delete):\s*(?:#.*)?$/i);
    if (currentPath && methodMatch) operations.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    const refMatch = line.match(/^\s{4}\$ref:\s*["']?([^"'\s]+)["']?\s*(?:#.*)?$/i);
    if (currentPath && refMatch) {
      for (const method of referencedPathItemMethods({ reference: refMatch[1], sourcePath, apiRoot })) {
        operations.add(`${method} ${currentPath}`);
      }
    }
    else if (/^\s{0,2}\S/.test(line) && !/^\s{2}\//.test(line)) currentPath = "";
  }
  return operations;
}

export function parseMountedRouteFiles(indexSource = "") {
  const imports = new Map();
  const importRe = /import\s*{([\s\S]*?)}\s*from\s*["']\.\/([^"']+)["'];/g;
  let match;
  while ((match = importRe.exec(indexSource)) !== null) {
    const file = `routes/${match[2]}`.replace(/\\/g, "/");
    for (const raw of match[1].split(",")) {
      const symbol = raw.trim().split(/\s+as\s+/i).pop();
      if (symbol) imports.set(symbol, file);
    }
  }

  const mounted = [];
  const useRe = /app\.use\(\s*(?:(["'`])([^"'`]+)\1\s*,\s*)?(build[A-Za-z0-9_]+)\s*\(/g;
  while ((match = useRe.exec(indexSource)) !== null) {
    const builder = match[3];
    const file = imports.get(builder);
    if (!file) continue;
    mounted.push({ builder, file, mount_prefix: normalizeRoutePath(match[2] || "/"), mount_order: match.index });
  }
  const seen = new Set();
  return mounted
    .sort((a, b) => a.mount_order - b.mount_order)
    .filter((entry) => {
      const key = `${entry.builder}|${entry.file}|${entry.mount_prefix}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function findMatchingBrace(source, openingIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function enclosingHelper(source, sourceIndex) {
  const functionRe = /function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g;
  let match;
  let enclosing = null;
  while ((match = functionRe.exec(source)) !== null && match.index < sourceIndex) {
    const opening = functionRe.lastIndex - 1;
    const closing = findMatchingBrace(source, opening);
    if (closing >= sourceIndex) enclosing = { name: match[1], closing };
  }
  return enclosing;
}

function staticTemplateExpansions(source, sourceIndex, routeTemplate) {
  const tokens = unique([...String(routeTemplate).matchAll(/\$\{([A-Za-z0-9_]+)}/g)].map((match) => match[1]));
  if (!tokens.length) return [routeTemplate];
  const helper = enclosingHelper(source, sourceIndex);
  if (!helper) return [];
  const callRe = new RegExp(`\\b${helper.name}\\s*\\(([\\s\\S]*?)\\);`, "g");
  callRe.lastIndex = helper.closing + 1;
  const expanded = [];
  let call;
  while ((call = callRe.exec(source)) !== null) {
    const bindings = {};
    for (const token of tokens) {
      const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const value = call[1].match(new RegExp(`\\b${escapedToken}\\s*:\\s*([\"'\\x60])([^\"'\\x60]+)\\1`))?.[2];
      if (value) bindings[token] = value;
    }
    if (tokens.every((token) => bindings[token])) {
      expanded.push(tokens.reduce((value, token) => value.replaceAll(`\${${token}}`, bindings[token]), routeTemplate));
    }
  }
  return unique(expanded);
}

function parseRoutesFromFile(source, file, mountPrefix = "/", { receiver = "router_or_app" } = {}) {
  const operations = [];
  const receiverPattern = receiver === "app" ? "app" : "(?:router|app)";
  const routeRe = new RegExp(`${receiverPattern}\\.(get|post|put|patch|delete)\\s*\\(\\s*([\"'\\x60])([^\"'\\x60]+)\\2`, "gs");
  let match;
  while ((match = routeRe.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    if (!HTTP_METHODS.has(method)) continue;
    const nextRouteRe = new RegExp(`${receiverPattern}\\.(?:get|post|put|patch|delete)\\s*\\(`, "gs");
    nextRouteRe.lastIndex = routeRe.lastIndex;
    const nextRoute = nextRouteRe.exec(source);
    const declaration = source.slice(match.index, nextRoute?.index ?? source.length);
    const expansions = staticTemplateExpansions(source, match.index, match[3]);
    const routes = expansions.length ? expansions : [match[3]];
    for (const route of routes) {
      const routePath = joinRoutePath(mountPrefix, route);
      operations.push({ method, path: routePath, signature: `${method} ${routePath}`, source_file: file, source_index: match.index, declaration });
    }
  }
  return operations;
}

function scopeFor({ path: routePath, source, declaration = "", sourceIndex = 0 }) {
  if (/^\/(?:connect$|connect\/assets(?:\/|$)|platform$|platform\/assets(?:\/|$)|platform\/ui-surfaces$|favicon\.ico$|robots\.txt$|legal(?:\/|$))/.test(routePath)) return "public";
  if (/local-manager|local-gateway|connector\/(?:devices?|routes?)/i.test(routePath)) return "local_device";
  if (/^\/me(?:\/|$)|\/workspaces?\/{[^}]+}/.test(routePath)) return "tenant";
  if (/requireTenant|requireUser|requireMembership|requireWorkspace/i.test(declaration)) return "tenant";
  if (/^\/admin(?:\/|$)/.test(routePath) || /requireAdminPrincipal|requireBackendApiKey/.test(declaration)) return "admin";
  const globalAdminGuards = [...source.matchAll(/(?:router|app)\.use\s*\(\s*(?:requireBackendApiKey|requireAdminPrincipal)/g)]
    .map((match) => match.index)
    .filter((index) => index < sourceIndex);
  if (globalAdminGuards.length) return "admin";
  if (/developer|openapi|audit|evidence/i.test(routePath)) return "developer";
  return "unresolved";
}

function groupFor(routePath, file) {
  const value = `${routePath} ${file}`.toLowerCase();
  const groups = [
    ["authentication", /auth|onboarding|connect/],
    ["growth", /growth|dashboard|activation-guidance/],
    ["resources", /resource|workspace/],
    ["connections", /connector|credential|integration/],
    ["local-manager", /local-manager|local-gateway|device/],
    ["support", /support|ticket/],
    ["agents", /agent|gpt|session/],
    ["plugins", /plugin|connected-execution/],
    ["operations", /operational|runtime-verification|status|health|incident/],
    ["activation", /activation/],
    ["infrastructure", /infrastructure|deployment|ssh|database|backup/],
    ["governance", /governance|authority|grant|policy|access/],
    ["release", /release|readiness/],
    ["developer-evidence", /developer|openapi|schema|audit|evidence|revision|change|graph|job|workflow/],
  ];
  return groups.find(([, matcher]) => matcher.test(value))?.[0] || "platform-core";
}

function evidenceRoute(operation) {
  return /evidence|readback|verification|audit|changes|revisions|history|preview|status|health/i.test(operation.path);
}

function testFilesFromManifest(source = "") {
  return unique([...canonicalText(source).matchAll(/\bnode\s+((?:[A-Za-z0-9_.-]+\/)*test-[A-Za-z0-9_.-]+\.mjs)\b/g)].map((match) => match[1]));
}

function loadRegisteredTestEvidence(apiRoot, testFiles) {
  const root = path.resolve(apiRoot);
  const bySignature = new Map();
  const claimedFiles = [];
  for (const testFile of testFiles) {
    const target = path.resolve(apiRoot, testFile);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    const source = readText(target);
    let claimed = false;
    for (const match of canonicalText(source).matchAll(/^\s*\/\/\s*frontend-surface-operation:\s*(get|post|put|patch|delete)\s+(\/\S+)\s*$/gim)) {
      const signature = `${match[1].toUpperCase()} ${normalizeRoutePath(match[2])}`;
      if (!bySignature.has(signature)) bySignature.set(signature, []);
      bySignature.get(signature).push(testFile);
      claimed = true;
    }
    if (claimed) claimedFiles.push(target);
  }
  for (const [signature, files] of bySignature) bySignature.set(signature, unique(files));
  return { bySignature, claimedFiles: unique(claimedFiles) };
}

function resourceEvidenceForFamily(file, resourceManifest) {
  const body = JSON.stringify(resourceManifest || {});
  const basename = path.basename(file);
  const key = toKebab(basename).replace(/-/g, "_");
  const resources = Array.isArray(resourceManifest?.resources) ? resourceManifest.resources : [];
  return resources
    .filter((entry) => entry.route_file === file.replace(/^http-generic-api\//, "").replace(/^routes\//, "routes/")
      || entry.route_file === file
      || body.includes(basename)
      || String(entry.resource_key || "").includes(key))
    .map((entry) => entry.resource_key)
    .filter(Boolean);
}

function operationDeliveryEvidence(operation) {
  const declaration = String(operation.declaration || "");
  const evidence = [];
  if (/text\/html|\.type\s*\(\s*["']html["']|<!doctype html/i.test(declaration)) evidence.push("response_content_type:text/html");
  if (/sendFile\s*\(/.test(declaration) && /\/assets(?:\/|\{|$)/.test(operation.path)) evidence.push("response_static_asset");
  return {
    embedded_ui: evidence.length > 0,
    embedded_ui_evidence: evidence,
    delivery_kind: evidence.includes("response_content_type:text/html") ? "embedded_html" : evidence.length ? "embedded_asset" : "api",
  };
}

function policyDecision(family, policy) {
  const rules = Array.isArray(policy?.rules) ? policy.rules : [];
  const matchingRules = rules.filter((candidate) => {
    if (candidate.family_key && candidate.family_key !== family.family_key) return false;
    if (candidate.source_file && candidate.source_file !== family.source_file) return false;
    if (candidate.scope && candidate.scope !== family.scope) return false;
    if (candidate.path_prefix && (!family.operations.length || !family.operations.every((operation) => operation.path.startsWith(candidate.path_prefix)))) return false;
    if (candidate.group && candidate.group !== family.group) return false;
    return true;
  });
  if (matchingRules.length > 1) {
    return {
      decision: "requires_review",
      rationale: `Multiple surface policy rules match this family: ${matchingRules.map((rule) => rule.rule_id || "unnamed").join(", ")}.`,
      owner: null,
    };
  }
  const rule = matchingRules[0];
  if (rule && rule.owner && rule.rationale) {
    return {
      decision: rule.decision,
      rationale: rule.rationale,
      owner: rule.owner,
      rule_id: rule.rule_id || null,
      evidence_refs: unique(rule.evidence_refs || []),
    };
  }
  return { decision: policy?.default_decision || "requires_review", rationale: "No repository policy decision covers this route family.", owner: null };
}

function waveFor(family) {
  if (family.scope === "admin") return "F3-admin-workspaces";
  if (family.scope === "local_device") return "F4-local-manager";
  if (family.scope === "developer" || family.group === "developer-evidence") return "F5-developer-evidence";
  if (["tenant", "public"].includes(family.scope)) return "F1-tenant-shell";
  return "F0-authority-resolution";
}

function dependenciesFor(family) {
  const deps = ["F0-source-baseline"];
  if (family.scope === "admin") deps.push("F2-admin-bff-session");
  if (family.scope === "local_device") deps.push("F1-tenant-workspace-context", "F4-device-trust");
  if (["tenant", "developer"].includes(family.scope)) deps.push("F1-tenant-workspace-context");
  if (family.operations.some((operation) => operation.mutation)) deps.push("mutation-preflight", "same-cycle-readback");
  return unique(deps);
}

function riskFor(family) {
  let score = 0;
  if (family.scope === "admin") score += 5;
  if (family.scope === "local_device") score += 4;
  if (family.scope === "unresolved") score += 5;
  if (family.operations.some((operation) => operation.mutation)) score += 3;
  if (family.openapi_gaps.length) score += 2;
  if (family.untested_operations.length) score += 2;
  if (family.surface_decision.decision === "requires_review") score += 2;
  return { score, class: score >= 9 ? "critical" : score >= 6 ? "high" : score >= 3 ? "medium" : "low" };
}

function taskFor(family) {
  const blockers = [];
  if (family.scope === "unresolved") blockers.push("scope_unresolved");
  if (family.openapi_gaps.length) blockers.push("openapi_contract_gap");
  if (family.untested_operations.length) blockers.push("test_ownership_gap");
  if (["requires_review", "deferred"].includes(family.surface_decision.decision)) blockers.push("surface_policy_decision_required");
  if (family.operations.some((operation) => operation.mutation) && !family.evidence_routes.length) blockers.push("mutation_readback_gap");
  return {
    task_key: `frontend.${family.family_key}`,
    title: `Resolve and deliver ${family.label}`,
    wave: waveFor(family),
    state: blockers.length ? "blocked" : "ready",
    blockers,
    dependencies: dependenciesFor(family),
    source_refs: family.source_refs,
    acceptance_gates: [
      "source_baseline_unchanged",
      "scope_and_auth_explicit",
      "openapi_or_explicit_exemption",
      "surface_policy_resolved",
      "tests_registered",
      ...(family.operations.some((operation) => operation.mutation) ? ["preflight_approval_readback_rollback"] : []),
    ],
    verification: unique([
      ...family.tests.map((file) => `node ${file}`),
      "node scripts/frontend-surface-dispatch.mjs --check",
      "node scripts/resource-api-coverage-audit.mjs --changed",
    ]),
  };
}

export function buildDispatchPlan({ apiRoot = process.cwd(), baselineRef = process.env.GITHUB_SHA || "working-tree" } = {}) {
  const generatorPath = fileURLToPath(import.meta.url);
  const indexPath = path.join(apiRoot, "routes", "index.js");
  const openapiPath = path.join(apiRoot, "openapi.yaml");
  const resourcePath = path.join(apiRoot, "resource-api-coverage.manifest.json");
  const testManifestPath = path.join(apiRoot, "scripts", "test-manifest.mjs");
  const policyPath = path.join(apiRoot, DEFAULT_POLICY);
  const indexSource = readText(indexPath);
  const openapiSource = readText(openapiPath);
  const resourceManifest = readJson(resourcePath, {});
  const testManifestSource = readText(testManifestPath);
  const frontendAssetPaths = unique([
    ...filesUnder(path.join(apiRoot, "public", "connect")),
    ...filesUnder(path.join(apiRoot, "public", "platform")),
  ]);
  const policy = readJson(policyPath, { schema_version: "frontend-surface-policy-v1", default_decision: "requires_review", rules: [] });
  const openapiReferencePaths = openApiReferenceFiles(openapiSource, openapiPath, apiRoot);
  const openapiOperations = parseOpenApiOperations(openapiSource, { sourcePath: openapiPath, apiRoot });
  const testFiles = testFilesFromManifest(testManifestSource);
  const testEvidence = loadRegisteredTestEvidence(apiRoot, testFiles);
  const mounted = parseMountedRouteFiles(indexSource);
  const directIndexOperations = parseRoutesFromFile(indexSource, "routes/index.js", "/", { receiver: "app" });
  if (directIndexOperations.length) {
    mounted.push({
      builder: "directAppRoutes",
      file: "routes/index.js",
      mount_prefix: "/",
      mount_order: Math.min(...directIndexOperations.map((operation) => operation.source_index)),
      direct: true,
    });
  }
  const families = [];

  for (const mount of mounted) {
    const filePath = path.join(apiRoot, mount.file.replace(/^routes\//, "routes/"));
    const source = readText(filePath);
    const discoveredOperations = mount.direct
      ? directIndexOperations
      : parseRoutesFromFile(source, mount.file, mount.mount_prefix);
    const operations = discoveredOperations.map((operation) => ({
      ...operation,
      scope: scopeFor({ path: operation.path, source, declaration: operation.declaration, sourceIndex: operation.source_index }),
      mutation: operation.method !== "GET",
      openapi_documented: openapiOperations.has(operation.signature),
      evidence_candidate: evidenceRoute(operation),
      ...operationDeliveryEvidence(operation),
      tests: testEvidence.bySignature.get(operation.signature) || [],
    })).map(({ declaration, source_index, ...operation }) => operation);
    const scopes = unique(operations.map((operation) => operation.scope));
    for (const scope of scopes.length ? scopes : ["unresolved"]) {
      const scopedOperations = operations.filter((operation) => operation.scope === scope);
      const baseKey = toKebab(path.basename(mount.file));
      const split = scopes.length > 1;
      const familyEmbeddedUi = scopedOperations.some((operation) => operation.embedded_ui);
      const familyTests = unique(scopedOperations.flatMap((operation) => operation.tests));
      const untestedOperations = scopedOperations.length
        ? scopedOperations.filter((operation) => !operation.tests.length).map((operation) => operation.signature)
        : ["NO_DISCOVERED_OPERATIONS"];
      const family = {
        family_key: split ? `${baseKey}.${scope}` : baseKey,
        label: `${baseKey.replace(/-/g, " ")}${split ? ` (${scope})` : ""}`,
        source_file: mount.file,
        source_digest: digest(source),
        mount_prefix: mount.mount_prefix,
        mount_order: mount.mount_order,
        split_from_mixed_scope_file: split,
        group: groupFor(scopedOperations[0]?.path || mount.mount_prefix, mount.file),
        scope,
        operations: scopedOperations,
        openapi_gaps: scopedOperations.filter((operation) => !operation.openapi_documented).map((operation) => operation.signature),
        evidence_routes: scopedOperations.filter((operation) => operation.evidence_candidate).map((operation) => operation.signature),
        tests: familyTests,
        untested_operations: untestedOperations,
        resources: resourceEvidenceForFamily(mount.file, resourceManifest),
        embedded_ui: familyEmbeddedUi,
        embedded_ui_operations: scopedOperations.filter((operation) => operation.embedded_ui).map((operation) => operation.signature),
        source_refs: unique([
          mount.file,
          "routes/index.js",
          "openapi.yaml",
          ...openapiReferencePaths.map((file) => path.relative(apiRoot, file).replace(/\\/g, "/")),
          ...(familyEmbeddedUi ? frontendAssetPaths.map((file) => path.relative(apiRoot, file).replace(/\\/g, "/")) : []),
          "resource-api-coverage.manifest.json",
          "scripts/test-manifest.mjs",
          ...familyTests,
          DEFAULT_POLICY,
        ]),
      };
      family.surface_decision = policyDecision(family, policy);
      family.risk = riskFor(family);
      family.wave = waveFor(family);
      families.push(family);
    }
  }

  families.sort((a, b) => a.mount_order - b.mount_order || a.family_key.localeCompare(b.family_key));
  const tasks = families.map(taskFor).sort((a, b) => a.wave.localeCompare(b.wave) || b.state.localeCompare(a.state) || a.task_key.localeCompare(b.task_key));
  const sourceAuthority = unique([
    indexPath,
    generatorPath,
    openapiPath,
    ...openapiReferencePaths,
    ...frontendAssetPaths,
    resourcePath,
    testManifestPath,
    ...testEvidence.claimedFiles,
    policyPath,
    path.resolve(apiRoot, "..", "specs", "010-unified-platform-frontend", "contracts", "frontend-dispatch-plan.schema.json"),
    path.resolve(apiRoot, "..", "specs", "010-unified-platform-frontend", "contracts", "ui-surface-catalog.schema.json"),
  ]).map((file) => ({
    file: path.relative(apiRoot, file).replace(/\\/g, "/"),
    sha256: digest(readText(file)),
    present: fs.existsSync(file),
  }));
  const operationCount = families.reduce((sum, family) => sum + family.operations.length, 0);
  const openapiGapCount = families.reduce((sum, family) => sum + family.openapi_gaps.length, 0);
  const untestedOperationCount = families.reduce((sum, family) => sum + family.operations.filter((operation) => !operation.tests.length).length, 0);
  const unresolvedDecisions = families.filter((family) => family.surface_decision.decision === "requires_review").length;

  return {
    schema_version: "frontend-surface-dispatch-v1",
    baseline: {
      ref: baselineRef,
      source_digest: digest(sourceAuthority.map((entry) => `${entry.file}:${entry.sha256}`).join("\n")),
      authority: sourceAuthority,
    },
    policy: {
      key: policy.policy_key || "frontend_surface_policy_v1",
      default_decision: policy.default_decision || "requires_review",
      allowed_decisions: ["embedded_ui", "unified_ui", "api_only", "internal_only", "legacy_compatibility", "deferred", "requires_review"],
    },
    coverage: {
      mounted_family_count: families.length,
      mounted_route_file_count: mounted.length,
      mixed_scope_route_file_count: new Set(families.filter((family) => family.split_from_mixed_scope_file).map((family) => family.source_file)).size,
      operation_count: operationCount,
      openapi_documented_count: operationCount - openapiGapCount,
      openapi_gap_count: openapiGapCount,
      embedded_ui_family_count: families.filter((family) => family.embedded_ui).length,
      unresolved_surface_decision_count: unresolvedDecisions,
      test_owned_family_count: families.filter((family) => !family.untested_operations.length).length,
      untested_family_count: families.filter((family) => family.untested_operations.length).length,
      test_owned_operation_count: operationCount - untestedOperationCount,
      untested_operation_count: untestedOperationCount,
      ready_task_count: tasks.filter((task) => task.state === "ready").length,
      blocked_task_count: tasks.filter((task) => task.state === "blocked").length,
      coverage_complete: openapiGapCount === 0 && unresolvedDecisions === 0 && tasks.every((task) => task.state === "ready"),
    },
    waves: [
      { key: "F0-authority-resolution", requires: ["source baseline", "scope decision", "policy decision"] },
      { key: "F1-tenant-shell", requires: ["tenant JWT", "workspace context", "read models"] },
      { key: "F2-admin-bff-session", requires: ["HttpOnly session", "CSRF", "origin binding", "audit"] },
      { key: "F3-admin-workspaces", requires: ["F2", "explicit adapters", "approval and readback"] },
      { key: "F4-local-manager", requires: ["device trust", "local consent", "reachability freshness"] },
      { key: "F5-developer-evidence", requires: ["explicit grant", "redaction", "evidence links"] },
      { key: "F6-cutover", requires: ["legacy parity", "accessibility", "production evidence"] },
    ],
    families,
    tasks,
    safety: {
      executes_provider_calls: false,
      writes_database: false,
      deploys: false,
      secrets_included: false,
      browser_backend_api_key_allowed: false,
    },
  };
}

export function syncDispatchPlan({ apiRoot = process.cwd(), mode = "write", output = DEFAULT_OUTPUT, baselineRef } = {}) {
  const target = path.resolve(apiRoot, output);
  const persistedBaselineRef = mode === "check" ? readJson(target, {})?.baseline?.ref : null;
  const plan = buildDispatchPlan({ apiRoot, baselineRef: baselineRef || persistedBaselineRef });
  const content = `${JSON.stringify(plan, null, 2)}\n`;
  const current = readText(target);
  const drift = current !== content;
  if (mode === "write") fs.writeFileSync(target, content);
  return { ok: mode === "write" || !drift, mode, output: path.relative(apiRoot, target).replace(/\\/g, "/"), drift, plan };
}

function parseArgs(argv = process.argv.slice(2)) {
  const mode = argv.includes("--check") ? "check" : argv.includes("--write") ? "write" : "json";
  return {
    mode,
    output: argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || DEFAULT_OUTPUT,
    baselineRef: argv.find((arg) => arg.startsWith("--baseline-ref="))?.slice("--baseline-ref=".length),
  };
}

export function isDirectExecution(importMetaUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && importMetaUrl === pathToFileURL(path.resolve(argvPath)).href;
}

if (isDirectExecution(import.meta.url)) {
  const args = parseArgs();
  const result = args.mode === "json"
    ? { ok: true, mode: "json", plan: buildDispatchPlan({ baselineRef: args.baselineRef }) }
    : syncDispatchPlan({ mode: args.mode, output: args.output, baselineRef: args.baselineRef });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exit(1);
}
