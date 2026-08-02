#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { buildDispatchPlan, canonicalOpenApiAuthority, isDirectExecution, parseOpenApiContracts } from "./frontend-surface-dispatch.mjs";

const API_ROOT = process.cwd();
const OPENAPI_PATH = path.join(API_ROOT, "openapi.yaml");
const MODE = process.argv.includes("--write") ? "write" : "check";
const PROFILE_SECURITY = {
  public: [],
  user_jwt: [["userJwtAuth"]],
  admin_backend: [["adminBearerAuth"], ["backendApiKeyAuth"]],
  backend_or_user: [["backendBearerAuth"], ["backendApiKeyAuth"]],
  connector_bearer: [["connectorBearerAuth"]],
  local_manager: [["localManagerBearerAuth"]],
  mcp_query_token: [["mcpQueryTokenAuth"]],
  signed_query_token: [["signedQueryTokenAuth"]],
};
const SCHEME_ALIASES = new Map([
  ["userBearerAuth", "userJwtAuth"],
  ["userJwt", "userJwtAuth"],
  ["backendApiKey", "backendApiKeyAuth"],
]);

function operations(plan) {
  return plan.families.flatMap((family) => family.operations);
}

function normalizedAlternatives(alternatives = []) {
  return alternatives
    .map((entry) => [...new Set(entry.map((scheme) => SCHEME_ALIASES.get(scheme) || scheme))].sort())
    .sort((a, b) => a.join("+").localeCompare(b.join("+")));
}

function canonicalAuthDrift(plan) {
  const runtimeBySignature = new Map();
  for (const operation of operations(plan)) {
    if (operation.runtime_auth?.state !== "resolved") continue;
    const expected = PROFILE_SECURITY[operation.runtime_auth.profile];
    if (!expected) continue;
    if (!runtimeBySignature.has(operation.signature)) runtimeBySignature.set(operation.signature, []);
    runtimeBySignature.get(operation.signature).push(operation);
  }

  const runtimeAuthority = new Map();
  for (const [signature, records] of runtimeBySignature) {
    const profiles = new Map(records.map((operation) => [operation.runtime_auth.profile, operation]));
    if (profiles.size > 1) throw new Error(`Conflicting runtime auth profiles for ${signature}: ${[...profiles.keys()].join(", ")}`);
    runtimeAuthority.set(signature, records[0]);
  }

  const byOperation = new Map();
  const authority = canonicalOpenApiAuthority({ apiRoot: API_ROOT, openapiPath: OPENAPI_PATH });
  for (const canonicalFile of authority.files) {
    const contracts = parseOpenApiContracts(fs.readFileSync(canonicalFile, "utf8"), { sourcePath: canonicalFile, apiRoot: API_ROOT });
    for (const [signature, contract] of contracts) {
      const operation = runtimeAuthority.get(signature);
      if (!operation) continue;
      const expected = PROFILE_SECURITY[operation.runtime_auth.profile];
      const current = normalizedAlternatives(contract.security_alternatives || []);
      const normalizedExpected = normalizedAlternatives(expected);
      const equivalent = contract.security_alternatives !== null && JSON.stringify(current) === JSON.stringify(normalizedExpected);
      if (equivalent && !contract.unknown_security_schemes.length) continue;
      const key = `${contract.source_file}|${signature}`;
      byOperation.set(key, { ...operation, openapi_auth: contract, expected });
    }
  }
  return [...byOperation.values()].sort((a, b) => (
    a.openapi_auth.source_file.localeCompare(b.openapi_auth.source_file) || a.signature.localeCompare(b.signature)
  ));
}

function securityValue(alternatives) {
  return alternatives.map(([scheme]) => ({ [scheme]: [] }));
}

export function serializedSecurity(source, node, alternatives) {
  const current = source.slice(node.range[0], node.range[2]);
  const newline = current.endsWith("\n") ? "\n" : "";
  if (alternatives.length === 0) return `[]${newline}`;
  if (current.trimStart().startsWith("[")) {
    return `[${alternatives.map(([scheme]) => `{ ${scheme}: [] }`).join(", ")}]${newline}`;
  }
  const lineStart = source.lastIndexOf("\n", node.range[0] - 1) + 1;
  const indent = source.slice(lineStart, node.range[0]);
  const items = alternatives.map(([scheme], index) => {
    const item = `- ${scheme}: []`;
    return index === 0 ? item : `${indent}${item}`;
  });
  return `${items.join("\n")}${newline}`;
}

function operationSecurityPath(operation) {
  if (Array.isArray(operation.openapi_auth.security_path)) return operation.openapi_auth.security_path;
  const [method, ...pathParts] = operation.signature.split(" ");
  return ["paths", pathParts.join(" "), method.toLowerCase(), "security"];
}

export function operationSecurityInsertion(source, document, securityPath, alternatives) {
  const operationPath = securityPath.slice(0, -1);
  const operationNode = document.getIn(operationPath, true);
  if (!operationNode?.range) throw new Error(`Operation node is required before auth sync: ${operationPath.join("/")}`);
  const lineStart = source.lastIndexOf("\n", operationNode.range[0] - 1) + 1;
  const prefix = source.slice(lineStart, operationNode.range[0]);
  if (prefix.trim()) {
    throw new Error(`Block operation mapping is required before auth sync: ${operationPath.join("/")}`);
  }
  const indent = prefix;
  const replacement = alternatives.length === 0
    ? `${indent}security: []\n`
    : `${indent}security:\n${alternatives.map(([scheme]) => `${indent}  - ${scheme}: []`).join("\n")}\n`;
  return { start: lineStart, end: lineStart, replacement };
}

function securitySchemeInsertion(source, document, requiredSchemes, primarySchemes) {
  if (!document.get("openapi")) return null;
  const existing = document.toJS()?.components?.securitySchemes || {};
  const missing = [...requiredSchemes].filter((scheme) => !Object.hasOwn(existing, scheme));
  if (!missing.length) return null;
  const header = source.match(/^  securitySchemes:\s*(?:#.*)?$/m);
  if (!header || header.index === undefined) throw new Error("components.securitySchemes block is required for canonical auth sync");
  const lineEnd = source.indexOf("\n", header.index + header[0].length);
  const insertionPoint = lineEnd < 0 ? source.length : lineEnd + 1;
  const replacement = `${missing.map((scheme) => {
    const definition = primarySchemes[scheme];
    if (!definition) throw new Error(`Primary OpenAPI does not define required security scheme ${scheme}`);
    return YAML.stringify({ [scheme]: definition }, { lineWidth: -1 })
      .trimEnd()
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
  }).join("\n")}\n`;
  return { start: insertionPoint, end: insertionPoint, replacement };
}

export function patchSecurity(source, drift, { primarySchemes }) {
  const document = YAML.parseDocument(source, { keepSourceTokens: true, prettyErrors: true });
  if (document.errors.length) throw document.errors[0];
  const edits = [];

  // Never widen or replace a document-level default merely because one routed
  // operation inherited it. Canonical documents commonly mix public, user,
  // and admin operations. Inserting exact operation-level security preserves
  // every unrelated path and makes the generated repair safe for mixed files.
  for (const operation of drift) {
    const securityPath = operationSecurityPath(operation);
    const securityNode = document.getIn(securityPath, true);
    if (securityNode?.range) {
      edits.push({
        start: securityNode.range[0],
        end: securityNode.range[2],
        replacement: serializedSecurity(source, securityNode, operation.expected),
      });
      continue;
    }
    if (operation.openapi_auth.security_declared === false) {
      edits.push(operationSecurityInsertion(source, document, securityPath, operation.expected));
      continue;
    }
    throw new Error(`Explicit security declaration is required before auth sync: ${operation.signature}`);
  }

  const requiredSchemes = new Set(drift.flatMap((operation) => operation.expected.flat()));
  const schemeEdit = securitySchemeInsertion(source, document, requiredSchemes, primarySchemes);
  if (schemeEdit) edits.push(schemeEdit);
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
  }
  return output;
}

function report({ ok, drift, updated = 0 }) {
  process.stdout.write(`${JSON.stringify({
    ok,
    mode: MODE,
    canonical_scope: "all_repository_canonical_contracts",
    drift_count: drift.length,
    updated_count: updated,
    drift: drift.slice(0, 100).map((operation) => ({
      signature: operation.signature,
      source_file: operation.source_file,
      contract_source: operation.openapi_auth.source_file,
      runtime_profile: operation.runtime_auth.profile,
      current_security: operation.openapi_auth.security_alternatives,
      expected_security: securityValue(operation.expected),
    })),
  }, null, 2)}\n`);
}

function main() {
  const primarySource = fs.readFileSync(OPENAPI_PATH, "utf8");
  const primaryDocument = YAML.parseDocument(primarySource, { keepSourceTokens: true, prettyErrors: true });
  if (primaryDocument.errors.length) throw primaryDocument.errors[0];
  const primarySchemes = primaryDocument.toJS()?.components?.securitySchemes || {};
  const initialPlan = buildDispatchPlan({ apiRoot: API_ROOT });
  const drift = canonicalAuthDrift(initialPlan);
  if (MODE === "check") {
    report({ ok: drift.length === 0, drift });
    if (drift.length) process.exit(1);
    return;
  }
  const byContract = new Map();
  for (const operation of drift) {
    const contract = operation.openapi_auth.source_file;
    if (!byContract.has(contract)) byContract.set(contract, []);
    byContract.get(contract).push(operation);
  }
  for (const [contract, contractDrift] of byContract) {
    const target = path.resolve(API_ROOT, contract);
    const root = path.resolve(API_ROOT);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`Canonical contract escapes API root: ${contract}`);
    const source = fs.readFileSync(target, "utf8");
    const output = patchSecurity(source, contractDrift, { primarySchemes });
    if (output !== source) fs.writeFileSync(target, output, "utf8");
  }
  const remaining = canonicalAuthDrift(buildDispatchPlan({ apiRoot: API_ROOT }));
  report({ ok: remaining.length === 0, drift: remaining, updated: drift.length });
  if (remaining.length) process.exit(1);
}

if (isDirectExecution(import.meta.url, process.argv[1])) main();