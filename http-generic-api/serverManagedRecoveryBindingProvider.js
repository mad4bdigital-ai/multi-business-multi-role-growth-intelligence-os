import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import {
  SERVER_MANAGED_RECOVERY_COMPOSITION_CONTRACT,
  validateRecoveryCompositionAdapters,
} from "./recoveryComposition.js";
import { resolveRuntimeEnvironment } from "./runtimeEnvironmentResolver.js";
import { recoveryReadinessRouteDependencies } from "./recoveryReadinessEvidence.js";

export const SERVER_MANAGED_BINDING_PROVIDER_CONTRACT = "mad4b.recovery-server-managed-binding-provider.v1";
export const SERVER_MANAGED_BINDING_MODULE_ENV = "RECOVERY_SERVER_MANAGED_BINDING_MODULE";
export const SERVER_MANAGED_BINDING_MODE_ENV = "RECOVERY_SERVER_MANAGED_BINDING_MODE";

const require = createRequire(import.meta.url);
const SECRET_FIELD_PATTERN = /(pass(word)?|token|secret|credential|private[_-]?key|api[_-]?key)/iu;
const FORBIDDEN_INPUT_PATTERN = /(caller|gpt|local[_-]?connector|raw[_-]?sql)/iu;
const MAX_SCAN_DEPTH = 8;

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function providerError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = { ...details, secrets_included: false };
  return error;
}

function secretFieldFound(value, pathName = "envelope", depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > MAX_SCAN_DEPTH || seen.has(value)) return null;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (key !== "secrets_included" && SECRET_FIELD_PATTERN.test(key)) return `${pathName}.${key}`;
    const child = value[key];
    if (child && typeof child === "object") {
      const found = secretFieldFound(child, `${pathName}.${key}`, depth + 1, seen);
      if (found) return found;
    }
  }
  return null;
}

function forbiddenInputFieldFound(value, pathName = "envelope", depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > MAX_SCAN_DEPTH || seen.has(value)) return null;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_INPUT_PATTERN.test(key)) return `${pathName}.${key}`;
    const child = value[key];
    if (child && typeof child === "object") {
      const found = forbiddenInputFieldFound(child, `${pathName}.${key}`, depth + 1, seen);
      if (found) return found;
    }
  }
  return null;
}

function resolveModulePath(modulePath, env = process.env) {
  const configured = text(modulePath || env[SERVER_MANAGED_BINDING_MODULE_ENV]);
  if (!configured) return null;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function resolveExport(candidate) {
  if (typeof candidate === "function") return candidate;
  if (!candidate || typeof candidate !== "object") return null;
  return [
    candidate.default,
    candidate.createServerManagedRecoveryBinding,
    candidate.getRecoveryBindingEnvelope,
    candidate.resolveRecoveryBinding,
  ].find((value) => typeof value === "function") || null;
}

function loadResolver(modulePath) {
  let loaded;
  try {
    loaded = require(modulePath);
  } catch (error) {
    throw providerError(
      "RECOVERY_SERVER_MANAGED_BINDING_MODULE_LOAD_FAILED",
      "The server-managed Recovery binding module could not be loaded.",
      { module_id_hash: hash(modulePath), cause_code: error?.code || "module_load_error" },
    );
  }
  const resolver = resolveExport(loaded);
  if (!resolver) {
    throw providerError(
      "RECOVERY_SERVER_MANAGED_BINDING_EXPORT_INVALID",
      "The server-managed Recovery binding module must export a binding resolver function.",
      { module_id_hash: hash(modulePath) },
    );
  }
  return resolver;
}

function normalizeEnvelope(envelope, moduleIdHash) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw providerError(
      "RECOVERY_SERVER_MANAGED_BINDING_ENVELOPE_INVALID",
      "The server-managed Recovery binding resolver must return an object envelope.",
    );
  }
  const secretPath = secretFieldFound(envelope);
  if (secretPath) {
    throw providerError(
      "RECOVERY_SERVER_MANAGED_BINDING_SECRET_FIELD_FORBIDDEN",
      "Server-managed Recovery binding envelopes must not expose credential-shaped fields.",
      { field_path: secretPath },
    );
  }
  const forbiddenInputPath = forbiddenInputFieldFound(envelope);
  if (forbiddenInputPath) {
    throw providerError(
      "RECOVERY_SERVER_MANAGED_BINDING_CALLER_INPUT_FORBIDDEN",
      "Server-managed Recovery binding envelopes must not contain caller, GPT, Local Connector, or raw SQL inputs.",
      { field_path: forbiddenInputPath },
    );
  }
  if (envelope.binding_source !== "server_managed") {
    throw providerError(
      "RECOVERY_SERVER_MANAGED_BINDING_SOURCE_INVALID",
      "Recovery bindings may only be supplied by the server-managed deployment module.",
      { binding_source: envelope.binding_source ?? null },
    );
  }
  if (envelope.secrets_included !== false) {
    throw providerError(
      "RECOVERY_SERVER_MANAGED_BINDING_SECRETS_FORBIDDEN",
      "Recovery binding envelopes must explicitly declare secrets_included=false.",
    );
  }
  if (!envelope.adapters || typeof envelope.adapters !== "object" || Array.isArray(envelope.adapters)) {
    throw providerError(
      "RECOVERY_SERVER_MANAGED_BINDING_ADAPTERS_MISSING",
      "The server-managed binding resolver did not supply an adapter bundle.",
    );
  }
  try {
    validateRecoveryCompositionAdapters(envelope.adapters);
  } catch (error) {
    throw providerError(
      "RECOVERY_SERVER_MANAGED_BINDING_ADAPTERS_INVALID",
      "The server-managed adapter bundle does not satisfy the Recovery composition contract.",
      {
        cause_code: error?.code || "composition_validation_failed",
        missing_components: error?.details?.missing_components || null,
      },
    );
  }
  return Object.freeze({
    ...envelope,
    binding_contract: SERVER_MANAGED_BINDING_PROVIDER_CONTRACT,
    recovery_composition_contract: SERVER_MANAGED_RECOVERY_COMPOSITION_CONTRACT,
    module_id_hash: moduleIdHash,
    binding_source: "server_managed",
    secrets_included: false,
  });
}

export function getServerManagedRecoveryBindingMode(env = process.env) {
  const runtime = resolveRuntimeEnvironment(env);
  const requested = text(env[SERVER_MANAGED_BINDING_MODE_ENV], 64).toLowerCase();
  // This repository-only wiring must never enable a Recovery binding in Production or
  // an unknown/conflicting environment. A later operational release must change this
  // gate explicitly and independently.
  if (!runtime.ok || !["staging", "test", "ci"].includes(runtime.environment_key)) return "disabled";
  return requested === "injected_non_live" ? "injected_non_live" : "disabled";
}

// Separate read-only export: resolving evidence must not instantiate a mutation
// binding, including when the production composition is deliberately disabled.
export function resolveServerManagedRecoveryReadiness({ env = process.env, modulePath = null } = {}) {
  const runtime = resolveRuntimeEnvironment(env);
  const configured = resolveModulePath(modulePath, env);
  if (!configured || !runtime.ok || !["staging", "production"].includes(runtime.environment_key)) return null;
  const module = require(configured);
  if (typeof module.createRecoveryReadinessAuthorities !== "function") return null;
  const authority = module.createRecoveryReadinessAuthorities(Object.freeze({
    environment: runtime.environment_key,
    runtime_class: runtime.runtime_class,
    read_only: true,
    production_live: false,
  }));
  recoveryReadinessRouteDependencies(authority);
  return authority;
}

export function createServerManagedRecoveryBindingProvider({ env = process.env, modulePath = null, resolver = null } = {}) {
  const resolvedModulePath = resolveModulePath(modulePath, env);
  const moduleIdHash = resolvedModulePath ? hash(resolvedModulePath) : null;
  const resolvedResolver = resolver || (resolvedModulePath ? loadResolver(resolvedModulePath) : null);
  if (!resolvedResolver) return null;
  if (typeof resolvedResolver !== "function") {
    throw providerError(
      "RECOVERY_SERVER_MANAGED_BINDING_RESOLVER_INVALID",
      "The server-managed Recovery binding resolver must be a function.",
    );
  }
  return Object.freeze((context = {}) => {
    const requestContext = Object.freeze({
      ...context,
      contract: SERVER_MANAGED_BINDING_PROVIDER_CONTRACT,
      binding_source: "server_managed",
      requested_mode: "injected_non_live",
      caller_credentials_accepted: false,
      gpt_credentials_accepted: false,
      local_connector_accepted: false,
      provider_discovery: false,
      database_discovery: false,
      secrets_included: false,
    });
    let envelope;
    try {
      envelope = resolvedResolver(requestContext);
    } catch (error) {
      throw providerError(
        "RECOVERY_SERVER_MANAGED_BINDING_RESOLUTION_FAILED",
        "The server-managed Recovery binding resolver failed closed.",
        { cause_code: error?.code || "binding_resolution_failed", module_id_hash: moduleIdHash },
      );
    }
    return normalizeEnvelope(envelope, moduleIdHash);
  });
}

export function getServerManagedRecoveryBindingStatus({ env = process.env, modulePath = null, resolver = null } = {}) {
  const resolvedModulePath = resolveModulePath(modulePath, env);
  return {
    contract: SERVER_MANAGED_BINDING_PROVIDER_CONTRACT,
    mode: getServerManagedRecoveryBindingMode(env),
    module_configured: Boolean(resolver || resolvedModulePath),
    module_id_hash: resolvedModulePath ? hash(resolvedModulePath) : null,
    binding_source: "server_managed",
    caller_credentials_accepted: false,
    gpt_credentials_accepted: false,
    local_connector_accepted: false,
    provider_discovery: false,
    database_discovery: false,
    secrets_included: false,
  };
}

export const _testingServerManagedRecoveryBindingProvider = Object.freeze({
  SECRET_FIELD_PATTERN,
  FORBIDDEN_INPUT_PATTERN,
  normalizeEnvelope,
  resolveExport,
  resolveModulePath,
  secretFieldFound,
  hash,
});
