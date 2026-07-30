#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "https://auth.mad4b.com";
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const PLATFORM_ADMIN_USER_ID = "00000000-0000-4000-a000-000000000002";
const MIGRATION = "20260728_operation_managed_git_ephemeral_checkout.sql";
const CHECKSUM = "8fa1da6161e914b73eb3fba7ce60a0245cee8cf0b5c953bd7ee596b3183cad9c";
const STATEMENT_COUNT = 1;
const AUTHORIZATION_CONFIRM = "AUTHORIZE_GOVERNED_MIGRATION_20260728_OPERATION_MANAGED_GIT_EPHEMERAL_CHECKOUT";
const IMPLEMENTATION_PR = 3394;
const IMPLEMENTATION_MERGE_SHA = "cbbc5c4ee1a49449f81e56f4c85960fd9fbee7e6";
const SHA40 = /^[0-9a-f]{40}$/;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/secret|token|password|api[_-]?key|private[_-]?key|authorization/i.test(key)
      && !(key === "secrets_included" && raw === false)) {
      output[key] = "[redacted]";
    } else {
      output[key] = redact(raw);
    }
  }
  return output;
}

function parseStructuredJson(text) {
  const source = String(text || "").trim();
  if (!source) throw new Error("Command returned empty stdout.");
  try {
    return JSON.parse(source);
  } catch {
    const end = source.lastIndexOf("}");
    if (end < 0) throw new Error("Command stdout did not contain JSON.");
    for (let start = 0; start <= end; start += 1) {
      if (source[start] !== "{") continue;
      try {
        return JSON.parse(source.slice(start, end + 1));
      } catch {
        // Continue until one complete structured envelope is found.
      }
    }
    throw new Error("Command stdout did not contain one complete JSON envelope.");
  }
}

async function readTrigger(triggerPath) {
  const trigger = JSON.parse(await fs.readFile(triggerPath, "utf8"));
  const expectedProductionSha = String(trigger.expected_production_sha || "").trim().toLowerCase();
  const expectedCandidateSha = String(trigger.expected_candidate_sha || "").trim().toLowerCase();
  if (!SHA40.test(expectedProductionSha)) throw new Error("trigger.expected_production_sha must be a 40-character SHA.");
  if (!SHA40.test(expectedCandidateSha)) throw new Error("trigger.expected_candidate_sha must be a 40-character SHA.");
  if (trigger.migration !== MIGRATION) throw new Error("Trigger migration does not match the pinned Spec 011 migration.");
  if (String(trigger.expected_checksum_sha256 || "").toLowerCase() !== CHECKSUM) throw new Error("Trigger checksum mismatch.");
  if (Number(trigger.expected_statement_count) !== STATEMENT_COUNT) throw new Error("Trigger statement-count mismatch.");
  if (trigger.authorize_only_and_dry_run !== true || trigger.apply_allowed === true) {
    throw new Error("Trigger must explicitly authorize only authorization plus dry-run and forbid apply.");
  }
  return { ...trigger, expectedProductionSha, expectedCandidateSha };
}

async function requestJson(baseUrl, apiKey, route, { method = "GET", body = undefined, accepted = [200] } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 4000) }; }
  if (!accepted.includes(response.status)) {
    const error = new Error(`HTTP ${response.status} from ${route}`);
    error.details = redact(payload);
    throw error;
  }
  return payload;
}

async function waitForDeployment(baseUrl, apiKey, expectedProductionSha) {
  let lastVersion = null;
  let lastHealth = null;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const [version, health] = await Promise.all([
        requestJson(baseUrl, apiKey, "/version"),
        requestJson(baseUrl, apiKey, "/health"),
      ]);
      lastVersion = version;
      lastHealth = health;
      const deployedSha = String(version?.deployment?.deployed_commit_sha || "").trim().toLowerCase();
      const deploymentCurrent = deployedSha === expectedProductionSha;
      const databaseHealthy = health?.dependencies?.db?.connected === true;
      const healthHealthy = health?.ok === true && health?.status === "healthy";
      if (deploymentCurrent && databaseHealthy && healthHealthy) {
        return { attempt, version, health };
      }
    } catch (error) {
      lastVersion = { error: error.message, details: error.details || null };
    }
    await sleep(10_000);
  }
  const error = new Error("Production deployment did not reach the pinned SHA with healthy DB readback.");
  error.details = redact({ expected_production_sha: expectedProductionSha, last_version: lastVersion, last_health: lastHealth });
  throw error;
}

async function callAdminShell(baseUrl, apiKey, alias, extraArgs) {
  const response = await requestJson(baseUrl, apiKey, "/admin/control", {
    method: "POST",
    body: {
      tool: "shell",
      action: "run",
      alias,
      extra_args: extraArgs,
      timeout_ms: 300_000,
    },
  });
  if (response?.ok !== true || response?.tool !== "shell") {
    const error = new Error(`Admin shell alias ${alias} did not succeed.`);
    error.details = redact(response);
    throw error;
  }
  const stdout = response?.result?.stdout;
  const parsed = parseStructuredJson(stdout);
  if (parsed?.ok !== true) {
    const error = new Error(`Admin shell alias ${alias} returned ok=false.`);
    error.details = redact(parsed);
    throw error;
  }
  return parsed;
}

async function callAdminTool(baseUrl, apiKey, name, toolArgs, accepted = [200, 201]) {
  const response = await requestJson(baseUrl, apiKey, "/gpt/tools/call", {
    method: "POST",
    body: { name, tool_args: toolArgs },
    accepted,
  });
  if (response?.ok !== true) {
    const error = new Error(`Admin tool ${name} returned ok=false.`);
    error.details = redact(response);
    throw error;
  }
  return response;
}

async function writeEvidence(evidencePath, evidence) {
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, `${JSON.stringify(redact(evidence), null, 2)}\n`, "utf8");
}

async function main() {
  const apiKey = String(process.env.BACKEND_API_KEY || "");
  if (!apiKey) throw new Error("BACKEND_API_KEY is unavailable to the workflow.");
  const baseUrl = String(process.env.BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const triggerPath = process.env.TRIGGER_PATH || ".github/spec011-production-migration-dryrun-trigger.json";
  const evidencePath = process.env.EVIDENCE_PATH || "artifacts/spec011-production-migration-dryrun-evidence.json";
  const trigger = await readTrigger(triggerPath);
  const evidence = {
    schema_version: "spec011.production_migration_dryrun.v1",
    started_at: new Date().toISOString(),
    candidate_sha: trigger.expectedCandidateSha,
    expected_production_sha: trigger.expectedProductionSha,
    migration: MIGRATION,
    expected_checksum_sha256: CHECKSUM,
    expected_statement_count: STATEMENT_COUNT,
    authorization_created: false,
    dry_run_passed: false,
    apply_executed: false,
    migration_sql_executed: false,
    provider_call_executed: false,
    external_write_executed: false,
    secrets_included: false,
  };

  try {
    evidence.deployment = await waitForDeployment(baseUrl, apiKey, trigger.expectedProductionSha);

    const envelope = await callAdminShell(baseUrl, apiKey, "capability_resolution_envelope_create", [
      "--tenant-id", PLATFORM_TENANT_ID,
      "--user-id", PLATFORM_ADMIN_USER_ID,
      "--app-key", "platform_orchestration",
      "--capability-key", "governed_migration_authorization_bootstrap",
      "--operation-intent", "governed_migration_authorization_bootstrap",
      "--runtime-surface", "governed_migration_authorization_bootstrap",
      "--requested-source-tier", "platform_managed_fallback",
      "--requested-by", "platform_admin_spec011",
      "--ttl-minutes", "60",
      "--explain",
    ]);
    evidence.authorization_envelope = envelope;
    if (envelope.dispatch_allowed !== true || Number(envelope.blocking_gap_count || 0) !== 0) {
      throw Object.assign(new Error("Authorization envelope is not dispatchable."), { details: redact(envelope) });
    }

    if (envelope.envelope_status === "ready_requires_approval") {
      evidence.authorization_envelope_approval = await callAdminShell(baseUrl, apiKey, "capability_resolution_envelope_approve", [
        "--envelope-id", envelope.envelope_id,
        "--approved-by", PLATFORM_ADMIN_USER_ID,
        "--decision-note", "Approve checksum-bound Spec 011 migration authorization bootstrap after exact Production deployment readback.",
        "--ttl-minutes", "60",
      ]);
    } else if (envelope.envelope_status !== "ready_for_dispatch") {
      throw Object.assign(new Error(`Unexpected authorization envelope status: ${envelope.envelope_status}`), { details: redact(envelope) });
    }

    const authorization = await callAdminTool(baseUrl, apiKey, "governed_migration_authorization_bootstrap", {
      migration: MIGRATION,
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
      pull_request: IMPLEMENTATION_PR,
      merge_sha: IMPLEMENTATION_MERGE_SHA,
      confirm: AUTHORIZATION_CONFIRM,
      capability_envelope_id: envelope.envelope_id,
      decision_note: "Authorize additive Spec 011 checkout_strategy enum migration after exact Production SHA, healthy DB, checksum, and statement-count readback.",
    });
    evidence.authorization = authorization;
    evidence.authorization_created = true;

    const dryRun = await callAdminTool(baseUrl, apiKey, "governed_migration_execute", {
      migration: MIGRATION,
      mode: "dry_run",
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
      capability_envelope_id: envelope.envelope_id,
    });
    evidence.dry_run = dryRun;
    const result = dryRun?.result || dryRun?.body?.result || null;
    if (!result || result.ok === false || result.mode !== "dry_run" || result.applies_sql !== false) {
      throw Object.assign(new Error("Governed migration dry-run evidence is incomplete or unsafe."), { details: redact(dryRun) });
    }
    evidence.dry_run_passed = true;
    evidence.completed_at = new Date().toISOString();
    await writeEvidence(evidencePath, evidence);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      expected_production_sha: trigger.expectedProductionSha,
      migration: MIGRATION,
      authorization_envelope_id: envelope.envelope_id,
      authorization_created: true,
      dry_run_passed: true,
      apply_executed: false,
      migration_sql_executed: false,
      secrets_included: false,
    }, null, 2)}\n`);
  } catch (error) {
    evidence.ok = false;
    evidence.failed_at = new Date().toISOString();
    evidence.error = { message: error.message, details: redact(error.details || null) };
    await writeEvidence(evidencePath, evidence);
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: { message: error.message, details: redact(error.details || null) },
    apply_executed: false,
    migration_sql_executed: false,
    secrets_included: false,
  }, null, 2)}\n`);
  process.exit(1);
});
