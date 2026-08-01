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

function normalizeOperationIds(value, signature) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`OpenAPI route contract ${signature} replace_inline_operation_ids must be a non-empty array when provided.`);
  }
  const operationIds = [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))].sort();
  if (operationIds.length !== value.length) {
    throw new Error(`OpenAPI route contract ${signature} replace_inline_operation_ids must contain unique non-empty values.`);
  }
  return operationIds;
}

function normalizeRegistry(input) {
  const entries = input?.contracts && typeof input.contracts === "object" ? input.contracts : {};
  const contracts = [];
  const pathContracts = new Map();

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
    const replaceInlineOperationIds = normalizeOperationIds(
      rawContract?.replace_inline_operation_ids,
      `${method} ${routePath}`,
    );

    const existing = pathContracts.get(routePath);
    if (existing && existing.path_item_ref !== pathItemRef) {
      throw new Error(`OpenAPI route contracts for ${routePath} must share one path-item ref.`);
    }

    const contract = existing || {
      path_item_ref: pathItemRef,
      replace_inline_operation_ids: new Set(),
    };
    for (const operationId of replaceInlineOperationIds) {
      contract.replace_inline_operation_ids.add(operationId);
    }
    pathContracts.set(routePath, contract);
    contracts.push({
      signature: `${method} ${routePath}`,
      method,
      path: routePath,
      path_item_ref: pathItemRef,
      replace_inline_operation_ids: replaceInlineOperationIds,
    });
  }

  return {
    contracts,
    pathContracts: new Map([...pathContracts.entries()].map(([routePath, contract]) => [
      routePath,
      {
        path_item_ref: contract.path_item_ref,
        replace_inline_operation_ids: [...contract.replace_inline_operation_ids].sort(),
      },
    ])),
  };
}

function operationIdsForPathItem(pathItem) {
  return Object.entries(pathItem || {})
    .filter(([key]) => HTTP_METHODS.has(String(key).toUpperCase()))
    .map(([, operation]) => String(operation?.operationId || "").trim())
    .filter(Boolean)
    .sort();
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function inspectRegistry(doc, pathContracts) {
  const missing = [];
  const synced = [];
  const migrations = [];
  const conflicts = [];

  for (const [routePath, contract] of [...pathContracts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const current = doc.paths?.[routePath];
    if (!current || Object.keys(current).length === 0) {
      missing.push({ path: routePath, path_item_ref: contract.path_item_ref });
      continue;
    }
    if (current.$ref === contract.path_item_ref && Object.keys(current).length === 1) {
      synced.push({ path: routePath, path_item_ref: contract.path_item_ref });
      continue;
    }

    const currentOperationIds = operationIdsForPathItem(current);
    if (
      contract.replace_inline_operation_ids.length > 0
      && arraysEqual(currentOperationIds, contract.replace_inline_operation_ids)
    ) {
      migrations.push({
        path: routePath,
        path_item_ref: contract.path_item_ref,
        operation_ids: currentOperationIds,
      });
      continue;
    }

    conflicts.push({
      path: routePath,
      expected_path_item_ref: contract.path_item_ref,
      allowed_inline_operation_ids: contract.replace_inline_operation_ids,
      current_operation_ids: currentOperationIds,
      current,
    });
  }

  return { missing, synced, migrations, conflicts };
}

function renderPathRefs(entries) {
  return [...entries]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => `  ${entry.path}:\n    $ref: ${entry.path_item_ref}\n`)
    .join("");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceInlinePathItemsWithoutReformatting(source, entries) {
  let updated = source;
  const ranges = entries.map((entry) => {
    const marker = new RegExp(`^  ${escapeRegex(entry.path)}:\\s*$`, "m").exec(updated);
    if (!marker) {
      throw new Error(`Unable to locate inline OpenAPI path item for guarded migration: ${entry.path}`);
    }
    const contentStart = marker.index + marker[0].length;
    const tail = updated.slice(contentStart);
    const nextPath = /^  \S[^:\n]*:\s*$/m.exec(tail);
    const nextTopLevel = /^(?!\s|#)\S[^:\n]*:\s*$/m.exec(tail);
    const relativeEnd = [nextPath?.index, nextTopLevel?.index]
      .filter((value) => Number.isInteger(value))
      .sort((left, right) => left - right)[0];
    const end = Number.isInteger(relativeEnd) ? contentStart + relativeEnd : updated.length;
    return { ...entry, start: marker.index, end };
  }).sort((left, right) => right.start - left.start);

  for (const entry of ranges) {
    const replacement = `  ${entry.path}:\n    $ref: ${entry.path_item_ref}\n`;
    updated = `${updated.slice(0, entry.start)}${replacement}${updated.slice(entry.end)}`;
  }
  return updated;
}

function insertMissingPathRefsWithoutReformatting(source, entries) {
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

function applyPathRefsWithoutReformatting(source, missing, migrations) {
  const migratedSource = replaceInlinePathItemsWithoutReformatting(source, migrations);
  return insertMissingPathRefsWithoutReformatting(migratedSource, missing);
}

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const openApiSource = fs.readFileSync(OPENAPI_PATH, "utf8");
  const doc = YAML.parse(openApiSource) || {};
  doc.paths ||= {};
  const { contracts, pathContracts } = normalizeRegistry(loadYaml(CONTRACT_REGISTRY_PATH, { contracts: {} }));
  const before = inspectRegistry(doc, pathContracts);

  if (before.conflicts.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      code: "openapi_precise_contract_path_conflict",
      precise_contract_count: contracts.length,
      missing_count: before.missing.length,
      migration_candidate_count: before.migrations.length,
      conflict_count: before.conflicts.length,
      conflicts: before.conflicts,
    }, null, 2));
    process.exit(1);
  }

  const appliedMissing = write ? before.missing : [];
  const migratedInlineContracts = write ? before.migrations : [];
  let after = before;
  if (write && (appliedMissing.length > 0 || migratedInlineContracts.length > 0)) {
    const updatedSource = applyPathRefsWithoutReformatting(
      openApiSource,
      appliedMissing,
      migratedInlineContracts,
    );
    const updatedDoc = YAML.parse(updatedSource) || {};
    after = inspectRegistry(updatedDoc, pathContracts);
    if (after.missing.length > 0 || after.migrations.length > 0 || after.conflicts.length > 0) {
      throw new Error("Precise route-contract composition failed post-write verification.");
    }
    fs.writeFileSync(OPENAPI_PATH, updatedSource.endsWith("\n") ? updatedSource : `${updatedSource}\n`);
  }

  const appliedPreciseContracts = [
    ...appliedMissing,
    ...migratedInlineContracts,
  ];
  const result = {
    ok: after.missing.length === 0 && after.migrations.length === 0 && after.conflicts.length === 0,
    changed: appliedPreciseContracts.length > 0,
    precise_contract_count: contracts.length,
    applied_precise_contracts: appliedPreciseContracts,
    migrated_inline_contracts: migratedInlineContracts,
    migration_count: migratedInlineContracts.length,
    pending_migration_count: after.migrations.length,
    missing_count: after.missing.length,
    conflict_count: after.conflicts.length,
    missing: after.missing,
    migrations: after.migrations,
    conflicts: after.conflicts,
  };
  console.log(JSON.stringify(result, null, 2));

  if (check && !result.ok) process.exit(1);
}

main();
