import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

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
    if (!match || !HTTP_METHODS.has(match[1])) {
      throw new Error(`Invalid OpenAPI route contract signature: ${signature}`);
    }

    const method = match[1];
    const routePath = normalizePath(match[2]);
    const pathItemRef = String(rawContract?.path_item_ref || "").trim();
    if (!pathItemRef.startsWith("./openapi/") || !pathItemRef.includes("#/")) {
      throw new Error(`OpenAPI route contract ${method} ${routePath} requires a local ./openapi/...#/ path_item_ref.`);
    }

    const existingRef = pathRefs.get(routePath);
    if (existingRef && existingRef !== pathItemRef) {
      throw new Error(`OpenAPI route contracts for ${routePath} must share one path-item ref.`);
    }
    pathRefs.set(routePath, pathItemRef);
    contracts.push({
      signature: `${method} ${routePath}`,
      method,
      path: routePath,
      path_item_ref: pathItemRef,
    });
  }

  return { contracts, pathRefs };
}

function inspectRegistry(doc, pathRefs) {
  const missing = [];
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
    conflicts.push({
      path: routePath,
      expected_path_item_ref: pathItemRef,
      current,
    });
  }

  return { missing, synced, conflicts };
}

function renderPathRefs(entries) {
  return [...entries]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => `  ${entry.path}:\n    $ref: ${entry.path_item_ref}\n`)
    .join("");
}

function applyPathRefsWithoutReformatting(source, entries) {
  if (entries.length === 0) return source;
  const pathsMatch = /^paths:\s*(\{\s*\})?\s*$/m.exec(source);
  if (!pathsMatch) {
    throw new Error("Root OpenAPI document must contain a top-level paths section before precise contracts can be composed.");
  }

  const block = renderPathRefs(entries);
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
  const before = inspectRegistry(doc, pathRefs);

  if (before.conflicts.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      code: "openapi_precise_contract_path_conflict",
      precise_contract_count: contracts.length,
      missing_count: before.missing.length,
      conflict_count: before.conflicts.length,
      conflicts: before.conflicts,
    }, null, 2));
    process.exit(1);
  }

  const applied = write ? before.missing : [];
  let after = before;
  if (write && applied.length > 0) {
    const updatedSource = applyPathRefsWithoutReformatting(openApiSource, applied);
    const updatedDoc = YAML.parse(updatedSource) || {};
    after = inspectRegistry(updatedDoc, pathRefs);
    if (after.missing.length > 0 || after.conflicts.length > 0) {
      throw new Error("Precise route-contract composition failed post-write verification.");
    }
    fs.writeFileSync(OPENAPI_PATH, updatedSource.endsWith("\n") ? updatedSource : `${updatedSource}\n`);
  }

  const result = {
    ok: after.missing.length === 0 && after.conflicts.length === 0,
    changed: applied.length > 0,
    precise_contract_count: contracts.length,
    applied_precise_contracts: applied,
    missing_count: after.missing.length,
    conflict_count: after.conflicts.length,
    missing: after.missing,
    conflicts: after.conflicts,
  };
  console.log(JSON.stringify(result, null, 2));

  if (check && !result.ok) process.exit(1);
}

main();
