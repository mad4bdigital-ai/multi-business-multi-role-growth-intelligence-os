import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConnectorPolicyBinding } from "./connector-environment-policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_SECRET_FILE_BYTES = 64 * 1024;
const SECRET_FILE_BINDINGS = Object.freeze([
  Object.freeze({ value_key: "CONNECTOR_SECRET", file_key: "CONNECTOR_SECRET_FILE" }),
  Object.freeze({ value_key: "CONNECTOR_LOCAL_API_KEY", file_key: "CONNECTOR_LOCAL_API_KEY_FILE" }),
]);

function parseDotEnvFile(filePath) {
  const values = {};
  let raw = "";
  try { raw = fs.readFileSync(filePath, "utf8"); } catch { return values; }
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && !(key in values)) values[key] = value;
  }
  return values;
}

function readSecretFile(filePath, fileKey) {
  const normalized = String(filePath || "").trim();
  if (!normalized) return "";
  if (!path.isAbsolute(normalized)) {
    throw new Error(`connector_secret_file_absolute_path_required:${fileKey}`);
  }
  let stat;
  try { stat = fs.statSync(normalized); } catch {
    throw new Error(`connector_secret_file_unavailable:${fileKey}`);
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SECRET_FILE_BYTES) {
    throw new Error(`connector_secret_file_invalid:${fileKey}`);
  }
  let value = "";
  try { value = fs.readFileSync(normalized, "utf8").trim(); } catch {
    throw new Error(`connector_secret_file_unreadable:${fileKey}`);
  }
  if (!value || /[\r\n\0]/u.test(value)) {
    throw new Error(`connector_secret_file_value_invalid:${fileKey}`);
  }
  return value;
}

export function hydrateConnectorSecretsFromFiles({ env = process.env, resolvedEnv = env } = {}) {
  const hydrated = [];
  for (const binding of SECRET_FILE_BINDINGS) {
    const secretFile = String(resolvedEnv?.[binding.file_key] || "").trim();
    if (!secretFile) continue;
    env[binding.file_key] = secretFile;
    env[binding.value_key] = readSecretFile(secretFile, binding.file_key);
    hydrated.push(binding.value_key);
  }
  return Object.freeze({
    hydrated_keys: Object.freeze(hydrated),
    secrets_included: false,
  });
}

export function applyConnectorServerEnvironmentGuard({ env = process.env, envFile = path.join(HERE, ".env") } = {}) {
  const fileEnv = parseDotEnvFile(envFile);
  const resolvedEnv = { ...fileEnv, ...env };
  const secretHydration = hydrateConnectorSecretsFromFiles({ env, resolvedEnv });
  const effectiveEnv = { ...resolvedEnv, ...env };
  const policyEnabled = String(effectiveEnv.CONNECTOR_POLICY_ENABLED || "").trim().toLowerCase() !== "false";
  if (!policyEnabled) {
    const environment = String(effectiveEnv.CONNECTOR_ENVIRONMENT || "").trim().toLowerCase();
    if (!environment || !["production", "staging"].includes(environment)) {
      throw new Error(`connector_policy_environment_required:${environment || "missing"}`);
    }
    env.CONNECTOR_ENVIRONMENT = environment;
    return {
      environment,
      policy_enabled: false,
      policy_url: "",
      compatibility_fallback_used: false,
      secret_file_bindings: secretHydration.hydrated_keys,
      secrets_included: false,
    };
  }

  const binding = resolveConnectorPolicyBinding(effectiveEnv);
  env.CONNECTOR_ENVIRONMENT = binding.environment;
  env.CONNECTOR_POLICY_URL = binding.policy_url;
  return {
    ...binding,
    policy_enabled: true,
    secret_file_bindings: secretHydration.hydrated_keys,
    secrets_included: false,
  };
}

export function shouldGuardConnectorServer(argv = process.argv) {
  const entry = String(argv?.[1] || "").replace(/\\/gu, "/").toLowerCase();
  return entry.endsWith("/server.mjs") || entry === "server.mjs";
}

if (shouldGuardConnectorServer()) {
  applyConnectorServerEnvironmentGuard();
}
