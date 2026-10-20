#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CONTRACT = "mad4b.production-runtime-env-key-inventory.v1";
export const HOSTINGER_API_BASE_URL = "https://developers.hostinger.com";
export const RUNTIME_BASE_URL = "https://auth.mad4b.com";
export const HOSTINGER_ACCOUNT_USERNAME = "u338416126";
export const HOSTINGER_DOMAIN = "auth.mad4b.com";
const SHA_RE = /^[0-9a-f]{40}$/u;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const IDENTITY_KEYS = Object.freeze([
  "DEPLOYMENT_ENVIRONMENT",
  "REMOTE_MCP_ENVIRONMENT",
  "NODE_ENV",
  "DEPLOYMENT_BRANCH",
  "DEPLOYMENT_MANIFEST_AUTHORITATIVE_BRANCH"
]);
const IDENTITY_LIKE_RE = /(DEPLOY|ENVIRONMENT|REMOTE_MCP|NODE_ENV)/iu;

class InventoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function duplicateNames(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function safeKeyList(values, source) {
  if (!Array.isArray(values)) throw new InventoryError(`${source}_keys_invalid`, `${source} keys must be an array.`);
  const keys = values.map((value) => String(value || "").trim());
  if (keys.some((key) => !KEY_RE.test(key))) throw new InventoryError(`${source}_key_invalid`, `${source} returned an invalid environment key.`);
  return keys;
}

async function boundedJson(response, source) {
  const text = await response.text();
  if (text.length > 512 * 1024) throw new InventoryError(`${source}_response_too_large`, `${source} response exceeded the bounded size.`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new InventoryError(`${source}_response_invalid_json`, `${source} returned invalid JSON.`);
  }
}

export async function collectInventory({
  expectedProductionSha,
  backendApiKey,
  hostingerApiToken,
  fetchImpl = fetch
} = {}) {
  const expected = String(expectedProductionSha || "").trim().toLowerCase();
  if (!SHA_RE.test(expected)) throw new InventoryError("expected_production_sha_invalid", "A full lowercase Production SHA is required.");
  if (!String(backendApiKey || "").trim()) throw new InventoryError("backend_api_key_missing", "BACKEND_API_KEY is required for read-only runtime key inventory.");
  if (!String(hostingerApiToken || "").trim()) throw new InventoryError("hostinger_api_token_missing", "HOSTINGER_API_TOKEN is required for read-only Hostinger key inventory.");

  const runtimeResponse = await fetchImpl(`${RUNTIME_BASE_URL}/admin/cli/control`, {
    method: "POST",
    redirect: "error",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${backendApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      tool: "env",
      action: "list",
      include_values: false,
      reveal_values: false
    }),
    signal: AbortSignal.timeout(30_000)
  });
  const runtimePayload = await boundedJson(runtimeResponse, "runtime");
  if (!runtimeResponse.ok || runtimePayload?.ok !== true || runtimePayload?.tool !== "env" || runtimePayload?.result?.action !== "list") {
    throw new InventoryError("runtime_env_inventory_failed", `Runtime env inventory failed with HTTP ${runtimeResponse.status}.`);
  }
  if (Object.prototype.hasOwnProperty.call(runtimePayload?.result || {}, "values") && runtimePayload.result.values !== undefined) {
    throw new InventoryError("runtime_env_values_forbidden", "Runtime env inventory unexpectedly returned values.");
  }
  const runtimeKeysRaw = safeKeyList(runtimePayload?.result?.keys, "runtime");

  const username = encodeURIComponent(HOSTINGER_ACCOUNT_USERNAME);
  const domain = encodeURIComponent(HOSTINGER_DOMAIN);
  const providerUrl = `${HOSTINGER_API_BASE_URL}/api/hosting/v1/accounts/${username}/websites/${domain}/nodejs/builds/settings/env`;
  const providerResponse = await fetchImpl(providerUrl, {
    method: "GET",
    redirect: "error",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${hostingerApiToken}`,
      "content-type": "application/json"
    },
    signal: AbortSignal.timeout(30_000)
  });
  const providerPayload = await boundedJson(providerResponse, "provider");
  if (!providerResponse.ok || !Array.isArray(providerPayload)) {
    throw new InventoryError("provider_env_inventory_failed", `Hostinger env inventory failed with HTTP ${providerResponse.status}.`);
  }

  const providerKeysRaw = [];
  for (const item of providerPayload) {
    const key = String(item?.key || "").trim();
    if (!KEY_RE.test(key)) throw new InventoryError("provider_key_invalid", "Hostinger returned an invalid environment key.");
    const value = item?.value;
    if (value !== undefined && value !== null && String(value) !== "********") {
      throw new InventoryError("provider_value_unmasked", "Hostinger returned an unmasked environment value; evidence emission was blocked.");
    }
    providerKeysRaw.push(key);
  }

  const runtimeKeys = uniqueSorted(runtimeKeysRaw);
  const providerKeys = uniqueSorted(providerKeysRaw);
  const identityLikeKeys = uniqueSorted([...runtimeKeys, ...providerKeys].filter((key) => IDENTITY_LIKE_RE.test(key)));
  const presence = Object.fromEntries(IDENTITY_KEYS.map((key) => [key, {
    runtime: runtimeKeys.includes(key),
    provider: providerKeys.includes(key),
    provider_occurrences: providerKeysRaw.filter((entry) => entry === key).length
  }]));

  const requiredKey = "DEPLOYMENT_ENVIRONMENT";
  const required = presence[requiredKey];
  const selection = {
    required_key: requiredKey,
    canonical_target_value: "production_hostinger_autodeploy",
    runtime_key_present: required.runtime,
    provider_key_present: required.provider,
    provider_occurrences: required.provider_occurrences,
    alternatives_present: ["REMOTE_MCP_ENVIRONMENT", "NODE_ENV"].filter((key) => presence[key].runtime || presence[key].provider),
    action_class: required.provider
      ? "update_existing_key"
      : "create_missing_key_once"
  };

  return {
    contract: CONTRACT,
    generated_at: new Date().toISOString(),
    target: {
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      production_sha: expected,
      domain: HOSTINGER_DOMAIN,
      account_username_masked: `${HOSTINGER_ACCOUNT_USERNAME.slice(0, 2)}***${HOSTINGER_ACCOUNT_USERNAME.slice(-3)}`
    },
    runtime: {
      key_count: runtimeKeys.length,
      identity_like_keys: identityLikeKeys.filter((key) => runtimeKeys.includes(key)),
      duplicate_keys: duplicateNames(runtimeKeysRaw)
    },
    provider: {
      key_count: providerKeys.length,
      identity_like_keys: identityLikeKeys.filter((key) => providerKeys.includes(key)),
      duplicate_keys: duplicateNames(providerKeysRaw),
      values_returned_masked_only: true
    },
    candidate_presence: presence,
    selection,
    effects: {
      provider_get_performed: true,
      provider_mutation_performed: false,
      runtime_read_performed: true,
      production_runtime_mutation_performed: false,
      database_mutation_performed: false,
      repository_mutation_performed: false,
      restart_performed: false,
      deployment_performed: false
    },
    raw_values_exposed: false,
    secrets_included: false
  };
}

export function validateEvidence(report) {
  if (report?.contract !== CONTRACT) throw new InventoryError("contract_invalid", "Inventory contract mismatch.");
  if (report?.raw_values_exposed !== false || report?.secrets_included !== false) throw new InventoryError("safety_flags_invalid", "Inventory safety flags are invalid.");
  const serialized = JSON.stringify(report);
  if (/Bearer\s|password|private_key|access_token|refresh_token|credential_value/iu.test(serialized)) {
    throw new InventoryError("secret_like_evidence_forbidden", "Evidence contains a forbidden secret-like field or payload.");
  }
  return report;
}

async function main() {
  const outputDir = String(process.env.OUTPUT_DIR || ".artifacts/production-runtime-env-key-inventory").trim();
  const report = validateEvidence(await collectInventory({
    expectedProductionSha: process.env.EXPECTED_PRODUCTION_SHA,
    backendApiKey: process.env.BACKEND_API_KEY,
    hostingerApiToken: process.env.HOSTINGER_API_TOKEN
  }));
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "inventory.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    ok: true,
    contract: report.contract,
    required_key: report.selection.required_key,
    runtime_key_present: report.selection.runtime_key_present,
    provider_key_present: report.selection.provider_key_present,
    provider_occurrences: report.selection.provider_occurrences,
    action_class: report.selection.action_class,
    raw_values_exposed: false,
    secrets_included: false
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || "production_runtime_env_key_inventory_failed",
      message: error?.message || "Production runtime env key inventory failed.",
      secrets_included: false
    }));
    process.exitCode = 1;
  });
}
