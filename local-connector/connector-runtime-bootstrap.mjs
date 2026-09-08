import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConnectorPolicyBinding } from "./connector-environment-policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

export function applyConnectorServerEnvironmentGuard({ env = process.env, envFile = path.join(HERE, ".env") } = {}) {
  const fileEnv = parseDotEnvFile(envFile);
  const resolvedEnv = { ...fileEnv, ...env };
  const policyEnabled = String(resolvedEnv.CONNECTOR_POLICY_ENABLED || "").trim().toLowerCase() !== "false";
  if (!policyEnabled) {
    const environment = String(resolvedEnv.CONNECTOR_ENVIRONMENT || "").trim().toLowerCase();
    if (!environment || !["production", "staging"].includes(environment)) {
      throw new Error(`connector_policy_environment_required:${environment || "missing"}`);
    }
    env.CONNECTOR_ENVIRONMENT = environment;
    return {
      environment,
      policy_enabled: false,
      policy_url: "",
      compatibility_fallback_used: false,
    };
  }

  const binding = resolveConnectorPolicyBinding(resolvedEnv);
  env.CONNECTOR_ENVIRONMENT = binding.environment;
  env.CONNECTOR_POLICY_URL = binding.policy_url;
  return { ...binding, policy_enabled: true };
}

export function shouldGuardConnectorServer(argv = process.argv) {
  const entry = String(argv?.[1] || "").replace(/\\/gu, "/").toLowerCase();
  return entry.endsWith("/server.mjs") || entry === "server.mjs";
}

if (shouldGuardConnectorServer()) {
  applyConnectorServerEnvironmentGuard();
}
