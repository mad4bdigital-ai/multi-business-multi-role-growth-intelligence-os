import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(API_ROOT, "..");
const REGISTRY_PATH = path.join(REPO_ROOT, "canonicals", "openapi", "custom-gpt-surfaces.yaml");
const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const POLICY_FILES = {
  activation_gateway: path.join(REPO_ROOT, "edge", "activation-gateway", "generated", "route-policy.json"),
  activation_gateway_staging: path.join(REPO_ROOT, "edge", "activation-gateway", "generated", "route-policy.staging.json"),
};

function loadYaml(filePath) {
  return YAML.parse(fs.readFileSync(filePath, "utf8"));
}

function operations(document) {
  return Object.entries(document?.paths || {}).flatMap(([pathKey, item]) => Object.entries(item || {})
    .filter(([method]) => METHOD_NAMES.has(method))
    .map(([method, operation]) => ({ pathKey, method: method.toUpperCase(), operation })));
}

function effectiveSurface(registry, surfaceKey) {
  const raw = registry.surfaces?.[surfaceKey];
  if (!raw) return null;
  const base = raw.base_surface ? registry.surfaces?.[raw.base_surface] || {} : {};
  return { ...base, ...raw };
}

function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return ""; }
}

function fail(errors, message) {
  errors.push(message);
}

function validateRegistrationSets(registry, errors, evidence) {
  const sets = registry.registration_sets || {};
  const allSetKeys = new Set(Object.keys(sets));
  const seenEmbedded = new Set();
  for (const [setKey, set] of Object.entries(sets)) {
    const members = Array.isArray(set.members) ? set.members : [];
    if (members.length === 0) {
      fail(errors, `${setKey}: members must be non-empty`);
      continue;
    }
    if (new Set(members).size !== members.length) fail(errors, `${setKey}: duplicate member surface`);
    if (!set.server_uri || !hostOf(set.server_uri)) fail(errors, `${setKey}: server_uri is invalid`);
    if (!new Set(["admin_service", "tenant"]).has(set.audience)) fail(errors, `${setKey}: audience must be semantic admin_service or tenant`);
    if (!new Set(["admin_gpt", "tenant_gpt"]).has(set.consumer_principal_class)) fail(errors, `${setKey}: consumer_principal_class is invalid`);
    if (!set.public_host || !hostOf(`https://${set.public_host}`)) fail(errors, `${setKey}: public_host is invalid`);
    if (!set.upstream_origin || !hostOf(set.upstream_origin)) fail(errors, `${setKey}: upstream_origin is invalid`);
    if (!set.gateway_host || set.gateway_host !== hostOf(`https://${set.public_host}`)) fail(errors, `${setKey}: gateway_host must match public_host`);
    if (!new Set(["admin_service", "tenant"]).has(set.scope_authority)) fail(errors, `${setKey}: scope_authority is invalid`);
    if (set.scope_authority !== set.audience) fail(errors, `${setKey}: scope_authority must match audience`);
    if (set.audience === "tenant" && (!set.oauth_issuer || !hostOf(set.oauth_issuer))) fail(errors, `${setKey}: tenant registration requires oauth_issuer`);
    if (set.audience === "admin_service" && set.oauth_issuer) fail(errors, `${setKey}: admin registration must not declare oauth_issuer`);
    const outputSurface = registry.surfaces?.[set.output_surface];
    if (!outputSurface) {
      fail(errors, `${setKey}: output_surface is missing: ${set.output_surface}`);
      continue;
    }
    const outputPath = path.join(API_ROOT, outputSurface.output_file);
    if (!fs.existsSync(outputPath)) {
      fail(errors, `${setKey}: output schema is missing: ${outputSurface.output_file}`);
      continue;
    }
    const outputDoc = loadYaml(outputPath);
    const outputOps = operations(outputDoc);
    const outputIds = outputOps.map(({ operation }) => operation?.operationId).filter(Boolean);
    const outputIdSet = new Set(outputIds);
    if (outputIdSet.size !== outputIds.length) fail(errors, `${setKey}: duplicate operationId in generated registration output`);

    const memberProfiles = [];
    const memberOperationIds = [];
    let memberOperationCount = 0;
    for (const memberKey of members) {
      const raw = registry.surfaces?.[memberKey];
      const surface = effectiveSurface(registry, memberKey);
      if (!raw || !surface) {
        fail(errors, `${setKey}: member surface is missing: ${memberKey}`);
        continue;
      }
      memberProfiles.push({ memberKey, surface });
      if (surface.registration_set !== setKey) fail(errors, `${memberKey}: registration_set mismatch (${surface.registration_set || "missing"} != ${setKey})`);
      if (surface.environment !== set.environment) fail(errors, `${memberKey}: environment mismatch with ${setKey}`);
      if (surface.auth_profile !== (set.auth_profile || surface.auth_profile)) fail(errors, `${memberKey}: auth_profile mismatch with ${setKey}`);
      if (surface.server_url !== set.server_uri && raw.registration_status !== "embedded" && memberKey !== set.output_surface) {
        fail(errors, `${memberKey}: server URI differs from registration set`);
      }
      if (raw.registration_status === "embedded") {
        seenEmbedded.add(memberKey);
        if (raw.embed_into !== set.output_surface) fail(errors, `${memberKey}: embed_into must equal ${set.output_surface}`);
      }

      const memberPath = path.join(API_ROOT, surface.output_file);
      if (!fs.existsSync(memberPath)) {
        fail(errors, `${memberKey}: member schema is missing: ${surface.output_file}`);
        continue;
      }
      const memberDoc = loadYaml(memberPath);
      let memberOps = operations(memberDoc);
      if (memberKey === set.output_surface && raw.registration_status !== "embedded") {
        memberOps = memberOps.filter(({ operation }) => !operation?.["x-mad4b-embedded-surface"]);
      }
      memberOperationCount += memberOps.length;
      memberOperationIds.push(...memberOps.map(({ operation }) => operation?.operationId).filter(Boolean));
      for (const operationId of memberOps.map(({ operation }) => operation?.operationId).filter(Boolean)) {
        if (!outputIdSet.has(operationId)) fail(errors, `${setKey}: member operation is missing from output: ${operationId}`);
      }
    }

    const authProfiles = new Set(memberProfiles.map(({ surface }) => surface.auth_profile).filter(Boolean));
    if (authProfiles.size > 1) fail(errors, `${setKey}: members mix auth profiles: ${[...authProfiles].join(", ")}`);
    if (set.auth_profile && [...authProfiles].some((profile) => profile !== set.auth_profile)) fail(errors, `${setKey}: members do not match declared auth_profile`);
    if (set.audience === "admin_service" && (set.consumer_principal_class !== "admin_gpt" || [...authProfiles].some((profile) => profile !== "admin_service"))) fail(errors, `${setKey}: admin registration must use admin_gpt/admin_service`);
    if (set.audience === "tenant" && (set.consumer_principal_class !== "tenant_gpt" || [...authProfiles].some((profile) => profile !== "tenant_oauth"))) fail(errors, `${setKey}: tenant registration must use tenant_gpt/tenant_oauth`);

    const memberHosts = new Set(memberProfiles.map(({ surface }) => hostOf(surface.server_url)).filter(Boolean));
    if (memberHosts.size > 1) fail(errors, `${setKey}: members resolve to different server hosts`);
    if (memberHosts.size === 1 && !memberHosts.has(hostOf(set.server_uri))) fail(errors, `${setKey}: member host differs from registration host`);
    const memberIdSet = new Set(memberOperationIds);
    if (memberIdSet.size !== memberOperationIds.length) fail(errors, `${setKey}: duplicate operationId across registration members`);
    if (memberOperationCount !== outputOps.length) fail(errors, `${setKey}: member operation count ${memberOperationCount} != generated output count ${outputOps.length}`);
    const hardLimit = Number(set.hard_operation_limit);
    const warningLimit = Number(set.warning_operation_limit);
    if (!Number.isInteger(hardLimit) || hardLimit <= 0) fail(errors, `${setKey}: hard_operation_limit must be positive`);
    if (!Number.isInteger(warningLimit) || warningLimit <= 0 || warningLimit > hardLimit) fail(errors, `${setKey}: warning_operation_limit must be positive and <= hard limit`);
    if (outputOps.length > hardLimit) fail(errors, `${setKey}: ${outputOps.length} operations exceeds hard limit ${hardLimit}`);
    if (outputOps.length > warningLimit) fail(errors, `${setKey}: warning budget exceeded (${outputOps.length} > ${warningLimit})`);
    evidence.registration_sets[setKey] = {
      environment: set.environment,
      server_uri: set.server_uri,
      gateway_host: set.gateway_host,
      action_slot: set.action_slot,
      audience: set.audience,
      consumer_principal_class: set.consumer_principal_class,
      auth_profiles: [...authProfiles].sort(),
      public_host: set.public_host,
      upstream_origin: set.upstream_origin,
      scope_authority: set.scope_authority,
      oauth_issuer: set.oauth_issuer || null,
      members,
      member_operation_count: memberOperationCount,
      generated_operation_count: outputOps.length,
      hard_operation_limit: hardLimit,
      warning_operation_limit: warningLimit,
    };
  }

  for (const [surfaceKey, surface] of Object.entries(registry.surfaces || {})) {
    if (surface.registration_status === "embedded" && !seenEmbedded.has(surfaceKey)) fail(errors, `${surfaceKey}: embedded surface is orphaned from registration_sets`);
    if (surface.registration_set && !allSetKeys.has(surface.registration_set)) fail(errors, `${surfaceKey}: references unknown registration_set ${surface.registration_set}`);
  }

  const byHost = new Map();
  for (const [setKey, set] of Object.entries(sets)) {
    const host = hostOf(set.server_uri);
    if (!host) continue;
    const key = `${set.environment}:${host}`;
    byHost.set(key, [...(byHost.get(key) || []), setKey]);
  }
  const allowedPairs = new Set((registry.registration_host_collision_policy?.allowed_pairs || [])
    .map((pair) => Array.isArray(pair) ? [...pair].sort().join("::") : ""));
  for (const [key, setKeys] of byHost) {
    if (setKeys.length < 2) continue;
    for (let index = 0; index < setKeys.length; index += 1) {
      for (let other = index + 1; other < setKeys.length; other += 1) {
        const pairKey = [setKeys[index], setKeys[other]].sort().join("::");
        if (!allowedPairs.has(pairKey)) fail(errors, `${key}: duplicate gateway host requires explicit collision policy for ${pairKey}`);
      }
    }
  }
}

function validateGatewayPolicies(registry, errors, evidence) {
  for (const [policyKey, policyPath] of Object.entries(POLICY_FILES)) {
    if (!fs.existsSync(policyPath)) {
      fail(errors, `${policyKey}: generated policy is missing`);
      continue;
    }
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    const sourceSurfaces = new Set(policy.source_surfaces || []);
    const routeSurfaces = new Set((policy.routes || []).flatMap((route) => route.surfaces || []));
    for (const surfaceKey of routeSurfaces) {
      if (!sourceSurfaces.has(surfaceKey)) fail(errors, `${policyKey}: route surface is absent from source_surfaces: ${surfaceKey}`);
    }
    const routeOperationIds = (policy.routes || []).flatMap((route) => route.operation_ids || []);
    const routeOperationIdSet = new Set(routeOperationIds);
    if (routeOperationIdSet.size !== routeOperationIds.length) fail(errors, `${policyKey}: duplicate operationId across generated routes`);
    const budgets = new Map((policy.warning_budget || []).map((entry) => [entry.surface, entry]));
    for (const surfaceKey of policy.source_surfaces || []) {
      const surface = effectiveSurface(registry, surfaceKey);
      if (!surface) {
        fail(errors, `${policyKey}: source surface is missing from registry: ${surfaceKey}`);
        continue;
      }
      const schemaPath = path.join(API_ROOT, surface.output_file);
      if (!fs.existsSync(schemaPath)) {
        fail(errors, `${policyKey}: source surface schema is missing: ${surface.output_file}`);
        continue;
      }
      const schemaOps = operations(loadYaml(schemaPath));
      const budget = budgets.get(surfaceKey);
      if (budget && Number(budget.operation_count) !== schemaOps.length) {
        fail(errors, `${policyKey}: warning budget count for ${surfaceKey} does not match generated schema`);
      }
    }
    if (!policy.ready_provenance?.required || policy.ready_provenance.require_policy_hash !== true || policy.ready_provenance.require_source_commit !== true) {
      fail(errors, `${policyKey}: ready provenance must require policy hash and source commit`);
    }
    if ((policy.routes || []).some((route) => !["mutation_strict", "recovery_strict", "read_strict"].includes(route.freshness_class))) {
      fail(errors, `${policyKey}: every route must declare a strict freshness_class`);
    }
    if (policyKey === "activation_gateway_staging") {
      const recoveryRoutes = (policy.routes || []).filter((route) => String(route.path).startsWith("/admin/recovery/staging/"));
      if (recoveryRoutes.length !== 3 || recoveryRoutes.some((route) => route.mutation !== false)) fail(errors, `${policyKey}: Recovery route set is not exactly three GET-only routes`);
      if (policy.public_host !== "activation-dev.mad4b.com" || policy.upstream_origin !== "https://dev.mad4b.com") fail(errors, `${policyKey}: public/upstream identity is not canonical`);
      if (Number(policy.read_stale_grace_seconds) !== 0) fail(errors, `${policyKey}: stale read grace must be zero`);
    }
    evidence.gateway_policies[policyKey] = {
      public_host: policy.public_host,
      upstream_origin: policy.upstream_origin,
      source_surfaces: [...sourceSurfaces].sort(),
      route_count: (policy.routes || []).length,
      operation_count: routeOperationIdSet.size,
      warning_budget: policy.warning_budget || [],
    };
  }
}

const registry = loadYaml(REGISTRY_PATH);
const errors = [];
const evidence = { registration_sets: {}, gateway_policies: {}, secrets_included: false };
validateRegistrationSets(registry, errors, evidence);
validateGatewayPolicies(registry, errors, evidence);
if (errors.length > 0) {
  console.error("Registration topology validation failed.");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  evidence.registry_sha256 = crypto.createHash("sha256").update(fs.readFileSync(REGISTRY_PATH)).digest("hex");
  console.log(JSON.stringify({ ok: true, contract: "mad4b.registration-runtime-identity-graph.v1", ...evidence }, null, 2));
}
