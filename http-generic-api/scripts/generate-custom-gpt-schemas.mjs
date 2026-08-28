#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { validateOpenApiFiles } from "./openapi-builder-schema-guard.mjs";
import {
  formatOpenApiResponseObjectIssue,
  validateOpenApiResponseFiles,
} from "./openapi-response-object-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(API_ROOT, "..");
const SURFACE_REGISTRY_PATH = path.join(REPO_ROOT, "canonicals", "openapi", "custom-gpt-surfaces.yaml");
const SOURCE_OPENAPI_PATH = path.join(API_ROOT, "openapi.yaml");
const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);

function fail(message, details = []) {
  console.error(message);
  for (const detail of details) console.error(`- ${detail}`);
  process.exitCode = 1;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function loadRegistry() {
  if (!fs.existsSync(SURFACE_REGISTRY_PATH)) throw new Error(`Missing surface registry: ${SURFACE_REGISTRY_PATH}`);
  const registry = YAML.parse(fs.readFileSync(SURFACE_REGISTRY_PATH, "utf8"));
  if (!registry || typeof registry !== "object" || !registry.surfaces) throw new Error("Surface registry must define surfaces");
  return registry;
}

function runSplitGenerator(outputDir) {
  const result = spawnSync(process.execPath, ["scripts/split-openapi.mjs", "--output-dir", outputDir], {
    cwd: API_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const error = new Error(`split-openapi failed with exit code ${result.status}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function generatedSchemaArtifacts(registry) {
  return Object.entries(registry.surfaces)
    .filter(([, surface]) => ["generated_from_openapi", "canonical_copy"].includes(surface.mode))
    .filter(([, surface]) => surface.registration_status !== "embedded")
    .map(([surfaceKey, surface]) => ({
      kind: "openapi",
      surfaceKey,
      tempRelative: surface.output_file,
      target: path.join(API_ROOT, surface.output_file),
      surface,
    }));
}

function materializeCanonicalCopies(registry, outputDir) {
  for (const [surfaceKey, surface] of Object.entries(registry.surfaces)) {
    if (surface.mode !== "canonical_copy") continue;
    const canonical = path.join(REPO_ROOT, surface.canonical_file);
    if (!fs.existsSync(canonical)) throw new Error(`${surfaceKey}: canonical file missing: ${canonical}`);
    const content = fs.readFileSync(canonical, "utf8");
    const doc = YAML.parse(content);
    if (doc?.servers?.[0]?.url !== surface.server_url) {
      throw new Error(`${surfaceKey}: canonical server ${doc?.servers?.[0]?.url || "missing"} does not match registry ${surface.server_url}`);
    }
    const target = path.join(outputDir, surface.output_file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
}

function collectDocOperations(doc) {
  const operations = [];
  for (const [pathKey, item] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(item || {})) {
      if (!METHOD_NAMES.has(method)) continue;
      operations.push({ pathKey, method: method.toUpperCase(), operation });
    }
  }
  return operations;
}

const COMPONENT_TYPES = ["schemas", "responses", "parameters", "requestBodies", "headers", "examples", "links", "callbacks"];

function cloneWithRenamedComponentRefs(value, prefix) {
  if (Array.isArray(value)) return value.map((item) => cloneWithRenamedComponentRefs(item, prefix));
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      return value.replace(
        /^#\/components\/(schemas|responses|parameters|requestBodies|headers|examples|links|callbacks)\/([^/]+)$/u,
        (_match, type, key) => `#/components/${type}/${prefix}${key}`,
      );
    }
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneWithRenamedComponentRefs(child, prefix)]));
}

function mergeEmbeddedCanonicalSurfaces(registry, schemaOutputDir) {
  const embedded = Object.entries(registry.surfaces)
    .filter(([, surface]) => surface.registration_status === "embedded" && surface.embed_into);
  const embeddedByTarget = new Map();
  for (const [surfaceKey, surface] of embedded) {
    const targetSurface = registry.surfaces[surface.embed_into];
    if (!targetSurface) throw new Error(`${surfaceKey}: embed_into surface is missing: ${surface.embed_into}`);
    if (surface.registration_set !== targetSurface.registration_set) {
      throw new Error(`${surfaceKey}: embedded registration_set must match ${surface.embed_into}`);
    }
    const targetPath = path.join(schemaOutputDir, targetSurface.output_file);
    const sourcePath = path.join(schemaOutputDir, surface.output_file);
    if (!fs.existsSync(targetPath)) throw new Error(`${surfaceKey}: target schema missing: ${targetSurface.output_file}`);
    if (!fs.existsSync(sourcePath)) throw new Error(`${surfaceKey}: embedded schema missing: ${surface.output_file}`);
    const targetDoc = YAML.parse(fs.readFileSync(targetPath, "utf8"));
    const sourceDoc = YAML.parse(fs.readFileSync(sourcePath, "utf8"));
    const serverMatches = targetDoc?.servers?.[0]?.url === sourceDoc?.servers?.[0]?.url;
    if (!serverMatches && surface.embedded_server_policy !== "gateway_alias_rewrite") {
      throw new Error(`${surfaceKey}: embedded server URI does not match target ${surface.embed_into}`);
    }
    const prefix = `${surfaceKey.replace(/[^A-Za-z0-9]/gu, "")}_`;
    const renamedSource = cloneWithRenamedComponentRefs(sourceDoc, prefix);
    for (const [pathKey, pathItem] of Object.entries(renamedSource.paths || {})) {
      if (targetDoc.paths?.[pathKey]) throw new Error(`${surfaceKey}: embedded path collides with target: ${pathKey}`);
      const operations = Object.fromEntries(Object.entries(pathItem || {}).map(([method, operation]) => {
        if (!METHOD_NAMES.has(method)) return [method, operation];
        return [method, {
          ...operation,
          "x-mad4b-embedded-surface": surfaceKey,
          "x-mad4b-registration-set": surface.registration_set,
        }];
      }));
      targetDoc.paths = targetDoc.paths || {};
      targetDoc.paths[pathKey] = operations;
    }
    for (const tag of renamedSource.tags || []) {
      targetDoc.tags = targetDoc.tags || [];
      if (!targetDoc.tags.some((current) => current.name === tag.name)) targetDoc.tags.push(tag);
    }
    const sourceBearer = sourceDoc.components?.securitySchemes?.backendBearerAuth;
    const targetBearer = targetDoc.components?.securitySchemes?.backendBearerAuth;
    if (sourceBearer && targetBearer
      && (sourceBearer.type !== targetBearer.type || sourceBearer.scheme !== targetBearer.scheme)) {
      throw new Error(`${surfaceKey}: embedded security scheme is incompatible with target bearer scheme`);
    }
    for (const type of COMPONENT_TYPES) {
      const sourceComponents = renamedSource.components?.[type] || {};
      if (!Object.keys(sourceComponents).length) continue;
      targetDoc.components = targetDoc.components || {};
      targetDoc.components[type] = targetDoc.components[type] || {};
      for (const [key, value] of Object.entries(sourceComponents)) {
        if (type === "securitySchemes" && key === "backendBearerAuth" && targetDoc.components[type][key]) continue;
        const renamedKey = `${prefix}${key}`;
        if (targetDoc.components[type][renamedKey]) throw new Error(`${surfaceKey}: renamed component unexpectedly collides: ${type}/${renamedKey}`);
        targetDoc.components[type][renamedKey] = value;
      }
    }
    const set = registry.registration_sets?.[surface.registration_set];
    const generation = targetDoc["x-custom-gpt-generation"] || {};
    generation.registration_set = surface.registration_set;
    generation.embedded_surfaces = [...new Set([...(generation.embedded_surfaces || []), surfaceKey])].sort();
    generation.registration_members = [...(set?.members || [])];
    generation.operation_count = collectDocOperations(targetDoc).length;
    generation.warning_budget_exceeded = generation.operation_count > Number(set?.warning_operation_limit || targetSurface.warning_operation_limit || targetSurface.hard_operation_limit || 30);
    targetDoc["x-custom-gpt-generation"] = generation;
    targetDoc["x-mad4b-registration"] = {
      registration_set: surface.registration_set,
      action_slot: surface.action_slot,
      audience: set?.audience || "admin",
      environment: set?.environment || targetSurface.environment,
      server_uri: set?.server_uri || targetSurface.server_url,
      embedded_source_server_uris: [
        ...new Set([
          ...((targetDoc["x-mad4b-registration"]?.embedded_source_server_uris || [])),
          sourceDoc?.servers?.[0]?.url,
        ].filter(Boolean)),
      ],
      members: [...(set?.members || [])],
      tenant_surfaces_forbidden: [...(set?.tenant_surfaces_forbidden || [])],
      secrets_included: false,
    };
    fs.writeFileSync(targetPath, YAML.stringify(targetDoc, { lineWidth: -1, aliasDuplicateObjects: false }), "utf8");
    embeddedByTarget.set(surface.embed_into, [...(embeddedByTarget.get(surface.embed_into) || []), surfaceKey]);
  }
  return embeddedByTarget;
}

function materializeRegistrationMetadata(registry, schemaOutputDir) {
  for (const [setKey, set] of Object.entries(registry.registration_sets || {})) {
    const outputSurface = registry.surfaces?.[set.output_surface];
    if (!outputSurface?.output_file) continue;
    const outputPath = path.join(schemaOutputDir, outputSurface.output_file);
    if (!fs.existsSync(outputPath)) throw new Error(`${setKey}: registration output is missing: ${outputSurface.output_file}`);
    const document = YAML.parse(fs.readFileSync(outputPath, "utf8"));
    const operationCount = collectDocOperations(document).length;
    document["x-mad4b-registration"] = {
      ...(document["x-mad4b-registration"] || {}),
      registration_set: setKey,
      action_slot: set.action_slot,
      audience: set.audience,
      auth_profile: set.auth_profile || null,
      environment: set.environment,
      server_uri: set.server_uri,
      gateway_host: set.gateway_host,
      members: [...set.members],
      operation_count: operationCount,
      hard_operation_limit: Number(set.hard_operation_limit),
      warning_operation_limit: Number(set.warning_operation_limit),
      tenant_surfaces_forbidden: [...(set.tenant_surfaces_forbidden || [])],
      secrets_included: false,
    };
    const generation = document["x-custom-gpt-generation"] || {};
    document["x-custom-gpt-generation"] = {
      ...generation,
      registration_set: setKey,
      registration_members: [...set.members],
      operation_count: operationCount,
      hard_operation_limit: Number(set.hard_operation_limit),
      warning_operation_limit: Number(set.warning_operation_limit),
      warning_budget_exceeded: operationCount > Number(set.warning_operation_limit),
      secrets_included: false,
    };
    fs.writeFileSync(outputPath, YAML.stringify(document, { lineWidth: -1, aliasDuplicateObjects: false }), "utf8");
  }
}

function validateRegistrationSets(registry, schemaOutputDir) {
  const seenEmbedded = new Set();
  for (const [setKey, set] of Object.entries(registry.registration_sets || {})) {
    if (!Array.isArray(set.members) || !set.members.length) throw new Error(`${setKey}: registration set must have members`);
    const memberSet = new Set(set.members);
    if (memberSet.size !== set.members.length) throw new Error(`${setKey}: duplicate registration member`);
    const outputSurface = registry.surfaces[set.output_surface];
    if (!outputSurface) throw new Error(`${setKey}: output_surface is missing`);
    const outputPath = path.join(schemaOutputDir, outputSurface.output_file);
    const outputDoc = YAML.parse(fs.readFileSync(outputPath, "utf8"));
    const outputOperations = collectDocOperations(outputDoc);
    let embeddedOperationCount = 0;
    for (const surfaceKey of set.members) {
      const rawSurface = registry.surfaces[surfaceKey];
      if (!rawSurface) throw new Error(`${setKey}: member surface is missing: ${surfaceKey}`);
      const baseSurface = rawSurface.base_surface ? registry.surfaces[rawSurface.base_surface] || {} : {};
      const surface = { ...baseSurface, ...rawSurface };
      if (surface.registration_set !== setKey) throw new Error(`${surfaceKey}: registration_set mismatch`);
      if (surface.registration_status !== "embedded" && surface.server_url !== set.server_uri) {
        throw new Error(`${surfaceKey}: server URI differs from registration set`);
      }
      if (surface.registration_status === "embedded" && surface.embedded_server_policy !== "gateway_alias_rewrite"
        && surface.server_url !== set.server_uri) {
        throw new Error(`${surfaceKey}: embedded server URI mismatch lacks an explicit alias policy`);
      }
      if (surface.registration_status === "embedded") {
        seenEmbedded.add(surfaceKey);
        if (surface.embed_into !== set.output_surface) throw new Error(`${surfaceKey}: embed_into must equal output_surface`);
        const schemaPath = path.join(schemaOutputDir, surface.output_file);
        if (!fs.existsSync(schemaPath)) throw new Error(`${setKey}: member schema missing: ${surface.output_file}`);
        const embeddedDoc = YAML.parse(fs.readFileSync(schemaPath, "utf8"));
        const embeddedOperations = collectDocOperations(embeddedDoc);
        embeddedOperationCount += embeddedOperations.length;
        for (const entry of embeddedOperations) {
          const operationPresent = outputOperations.some((candidate) => candidate.operation?.operationId === entry.operation?.operationId);
          if (!operationPresent) throw new Error(`${setKey}: embedded operation is missing from output: ${entry.operation?.operationId || entry.pathKey}`);
        }
      }
    }
    const totalOperations = outputOperations.length;
    if (totalOperations < embeddedOperationCount) throw new Error(`${setKey}: output operation count is below embedded member count`);
    const hardLimit = Number(set.hard_operation_limit || 30);
    if (totalOperations > hardLimit) throw new Error(`${setKey}: ${totalOperations} operations exceeds hard limit ${hardLimit}`);
    for (const forbidden of set.tenant_surfaces_forbidden || []) {
      if (memberSet.has(forbidden)) throw new Error(`${setKey}: Tenant surface cannot be an Admin registration member: ${forbidden}`);
    }
  }
  for (const [surfaceKey, surface] of Object.entries(registry.surfaces)) {
    if (surface.registration_status === "embedded" && !seenEmbedded.has(surfaceKey)) throw new Error(`${surfaceKey}: embedded surface is not owned by a registration set`);
  }
}

function generateGatewayPolicies(registry, schemaOutputDir, artifactOutputDir) {
  const artifacts = [];
  for (const [policyKey, policy] of Object.entries(registry.gateway_policies || {})) {
    const configuredSurfaceKeys = Array.isArray(policy.surface_keys) ? policy.surface_keys : null;
    const members = (configuredSurfaceKeys
      ? configuredSurfaceKeys.map((surfaceKey) => [surfaceKey, registry.surfaces[surfaceKey]])
      : Object.entries(registry.surfaces).filter(([, surface]) => surface.gateway_policy === policyKey))
      .map(([surfaceKey, surface]) => {
        if (!surface) throw new Error(`${policyKey}: configured surface is missing: ${surfaceKey}`);
        const baseSurface = surface.base_surface ? registry.surfaces[surface.base_surface] || {} : {};
        return { surfaceKey, surface: { ...baseSurface, ...surface } };
      });
    if (members.length === 0) throw new Error(`${policyKey}: no surfaces reference this gateway policy`);

    const byRoute = new Map();
    for (const { surfaceKey, surface } of members) {
      const schemaPath = path.join(schemaOutputDir, surface.output_file);
      if (!fs.existsSync(schemaPath)) throw new Error(`${policyKey}: generated surface missing: ${surface.output_file}`);
      const doc = YAML.parse(fs.readFileSync(schemaPath, "utf8"));
      if (doc?.servers?.[0]?.url !== surface.server_url) throw new Error(`${surfaceKey}: generated server mismatch`);
      for (const { pathKey, method, operation } of collectDocOperations(doc)) {
        const key = `${method} ${pathKey}`;
        const queryParameters = (operation.parameters || [])
          .filter((parameter) => parameter?.in === "query" && typeof parameter.name === "string")
          .map((parameter) => parameter.name);
        const current = byRoute.get(key) || {
          method,
          path: pathKey,
          mutation: !["GET", "HEAD"].includes(method),
          operation_ids: [],
          auth_profiles: [],
          surfaces: [],
          allowed_query_parameters: [],
          request_body_limit_bytes: Number(policy.request_body_limit_bytes),
          response_body_limit_bytes: Number(policy.response_body_limit_bytes),
          timeout_ms: Number(policy.timeout_ms),
        };
        current.operation_ids.push(operation.operationId);
        current.auth_profiles.push(surface.auth_profile);
        current.surfaces.push(surfaceKey);
        if (operation?.["x-mad4b-embedded-surface"]) current.surfaces.push(operation["x-mad4b-embedded-surface"]);
        current.allowed_query_parameters.push(...queryParameters);
        byRoute.set(key, current);
      }
    }

    const routes = [...byRoute.values()]
      .map((route) => ({
        ...route,
        operation_ids: [...new Set(route.operation_ids)].sort(),
        auth_profiles: [...new Set(route.auth_profiles)].sort(),
        surfaces: [...new Set(route.surfaces)].sort(),
        allowed_query_parameters: [...new Set(route.allowed_query_parameters)].sort(),
        freshness_class: route.mutation
          ? "mutation_strict"
          : route.surfaces.some((surface) => surface.startsWith("admin_recovery"))
            ? "recovery_strict"
            : "read_strict",
      }))
      .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));

    const oauthHandoffRoutes = (policy.oauth_handoff_routes || [])
      .map((route) => {
        const method = String(route?.method || "").toUpperCase();
        const routePath = String(route?.path || "");
        const operationId = String(route?.operation_id || "");
        if (!["GET", "POST"].includes(method)) throw new Error(`${policyKey}: OAuth handoff method is not allowed: ${method || "missing"}`);
        if (!routePath.startsWith("/auth/oauth/") || routePath.includes("{") || routePath.includes("*")) {
          throw new Error(`${policyKey}: OAuth handoff path must be an exact /auth/oauth/* path: ${routePath || "missing"}`);
        }
        if (!operationId) throw new Error(`${policyKey}: OAuth handoff operation_id is required for ${method} ${routePath}`);
        return {
          method,
          path: routePath,
          operation_ids: [operationId],
          allow_session_cookie: route.allow_session_cookie === true,
          allowed_query_parameters: [...new Set(route.allowed_query_parameters || [])].sort(),
          request_body_limit_bytes: Number(policy.request_body_limit_bytes),
          response_body_limit_bytes: Number(policy.response_body_limit_bytes),
          timeout_ms: Number(policy.timeout_ms),
        };
      })
      .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));

    const oauthHandoffKeys = oauthHandoffRoutes.map((route) => `${route.method} ${route.path}`);
    if (new Set(oauthHandoffKeys).size !== oauthHandoffKeys.length) {
      throw new Error(`${policyKey}: duplicate OAuth handoff route`);
    }

    const warningBudget = members.map(({ surfaceKey, surface }) => {
      const schemaPath = path.join(schemaOutputDir, surface.output_file);
      const doc = YAML.parse(fs.readFileSync(schemaPath, "utf8"));
      const operationCount = collectDocOperations(doc).length;
      const warningLimit = Number(surface.warning_operation_limit || surface.hard_operation_limit || 30);
      return { surface: surfaceKey, operation_count: operationCount, warning_limit: warningLimit, exceeded: operationCount > warningLimit };
    }).sort((a, b) => a.surface.localeCompare(b.surface));
    const payload = {
      manifest_version: 1,
      surface_registry_version: Number(registry.version),
      source_openapi_sha256: sha256(fs.readFileSync(SOURCE_OPENAPI_PATH, "utf8")),
      surface_registry_sha256: sha256(fs.readFileSync(SURFACE_REGISTRY_PATH, "utf8")),
      warning_budget: warningBudget,
      policy_key: policyKey,
      public_host: policy.public_host,
      upstream_origin: policy.upstream_origin,
      mutation_stale_policy: policy.mutation_stale_policy,
      read_stale_grace_seconds: 0,
      ready_provenance: {
        required: true,
        health_path: "/health",
        require_policy_hash: true,
        require_source_commit: true,
      },
      source_registry: "canonicals/openapi/custom-gpt-surfaces.yaml",
      source_surfaces: [...new Set(members.flatMap(({ surfaceKey }) => {
        const set = registry.registration_sets && Object.values(registry.registration_sets).find((candidate) => candidate.output_surface === surfaceKey);
        return set ? set.members : [surfaceKey];
      }))].sort(),
      oauth_handoff_routes: oauthHandoffRoutes,
      routes,
    };
    const canonicalPayload = stableJson(payload);
    const bundle = {
      ...payload,
      content_hash_sha256: sha256(canonicalPayload),
      signature_algorithm: "Ed25519",
      deployment_signature_required: true,
      secrets_included: false,
    };
    const tempRelative = policy.output_file;
    const tempPath = path.join(artifactOutputDir, tempRelative);
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    fs.writeFileSync(tempPath, stableJson(bundle), "utf8");
    artifacts.push({
      kind: "gateway_policy",
      policyKey,
      tempRelative,
      target: path.join(REPO_ROOT, policy.output_file),
    });
  }
  return artifacts;
}

function compareFile(expectedPath, actualPath) {
  if (!fs.existsSync(actualPath)) return { equal: false, reason: "missing_generated_artifact" };
  const expected = fs.readFileSync(expectedPath);
  const actual = fs.readFileSync(actualPath);
  const equal = expected.equals(actual);
  return { equal, reason: equal ? null : "generated_artifact_drift" };
}

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  if (write === check) {
    fail("Usage: node scripts/generate-custom-gpt-schemas.mjs --write|--check");
    return;
  }

  const registry = loadRegistry();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-custom-gpt-surfaces-"));
  const schemaOutputDir = path.join(tempRoot, "schemas");
  const artifactOutputDir = path.join(tempRoot, "artifacts");
  fs.mkdirSync(schemaOutputDir, { recursive: true });
  fs.mkdirSync(artifactOutputDir, { recursive: true });

  try {
    runSplitGenerator(schemaOutputDir);
    materializeCanonicalCopies(registry, schemaOutputDir);
    mergeEmbeddedCanonicalSurfaces(registry, schemaOutputDir);
    materializeRegistrationMetadata(registry, schemaOutputDir);
    validateRegistrationSets(registry, schemaOutputDir);
    const schemaArtifacts = generatedSchemaArtifacts(registry);
    const policyArtifacts = generateGatewayPolicies(registry, schemaOutputDir, artifactOutputDir);
    const artifacts = [...schemaArtifacts, ...policyArtifacts];

    const schemaPaths = schemaArtifacts.map((artifact) => path.join(schemaOutputDir, artifact.tempRelative));
    const responseObjectIssues = validateOpenApiResponseFiles(schemaPaths);
    if (responseObjectIssues.length > 0) {
      fail(
        "Generated Custom GPT schemas failed OpenAPI Response Object validation.",
        responseObjectIssues.map(formatOpenApiResponseObjectIssue),
      );
      return;
    }

    const issues = validateOpenApiFiles(schemaPaths);
    if (issues.length > 0) {
      fail("Generated Custom GPT schemas failed Builder validation.", issues.map((issue) => `${issue.file} ${issue.path} [${issue.code}] ${issue.message}`));
      return;
    }

    if (check) {
      const drift = [];
      for (const artifact of artifacts) {
        const tempBase = artifact.kind === "openapi" ? schemaOutputDir : artifactOutputDir;
        const comparison = compareFile(path.join(tempBase, artifact.tempRelative), artifact.target);
        if (!comparison.equal) drift.push(`${path.relative(REPO_ROOT, artifact.target)}: ${comparison.reason}`);
      }
      if (drift.length > 0) {
        fail("Generated surface parity check failed. Run npm run schemas:generate and commit the results.", drift);
        return;
      }
      console.log(`Surface parity passed for ${artifacts.length} generated artifact(s).`);
      return;
    }

    for (const artifact of artifacts) {
      const tempBase = artifact.kind === "openapi" ? schemaOutputDir : artifactOutputDir;
      fs.mkdirSync(path.dirname(artifact.target), { recursive: true });
      fs.copyFileSync(path.join(tempBase, artifact.tempRelative), artifact.target);
    }
    console.log(`Generated and validated ${artifacts.length} surface artifact(s).`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  fail(error.message || String(error));
}
