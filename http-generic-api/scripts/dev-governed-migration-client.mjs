#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const READ_ONLY_TOOLS = new Set([
  "admin_tool_catalog_search",
  "governed_migration_schema_readback",
]);

const MUTATING_TOOLS = new Set([
  "governed_migration_authorization_bootstrap",
  "governed_migration_apply_policy_bootstrap",
  "capability_resolution_envelope_apply_authorize",
  "capability_resolution_envelope_lifecycle",
]);

const ALLOWED_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  ...MUTATING_TOOLS,
  "governed_migration_execute",
]);

const ALLOWED_SHELL_ALIASES = new Set([
  "capability_resolution_envelope_create",
  "capability_resolution_envelope_approve",
  "platform_outbox_worker",
]);

const READ_ONLY_OUTBOX_ACTIONS = new Set(["status", "dry-run"]);

export function validateShellAliasInvocation(alias, extraArgs) {
  if (!Array.isArray(extraArgs) || extraArgs.some((item) => typeof item !== "string")) {
    throw new Error("extra_args must decode to an array of strings.");
  }
  if (alias !== "platform_outbox_worker") {
    return { mutation_requested: true, extra_args: extraArgs };
  }

  let action = "";
  let consumerSeen = false;
  let limitSeen = false;
  for (const arg of extraArgs) {
    if (arg === "--apply") throw new Error("platform_outbox_worker read-only calls forbid --apply.");
    if (arg.startsWith("--action=")) {
      if (action) throw new Error("platform_outbox_worker accepts one --action value.");
      action = arg.slice("--action=".length).trim().toLowerCase();
      continue;
    }
    if (arg.startsWith("--consumer=")) {
      if (consumerSeen) throw new Error("platform_outbox_worker accepts one --consumer value.");
      const consumer = arg.slice("--consumer=".length).trim();
      if (!/^[A-Za-z0-9._-]{1,120}$/.test(consumer)) throw new Error("Invalid outbox consumer key.");
      consumerSeen = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      if (limitSeen) throw new Error("platform_outbox_worker accepts one --limit value.");
      const limit = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Outbox limit must be between 1 and 500.");
      limitSeen = true;
      continue;
    }
    throw new Error(`Unsupported platform_outbox_worker argument: ${arg}`);
  }

  if (!READ_ONLY_OUTBOX_ACTIONS.has(action)) {
    throw new Error("platform_outbox_worker only permits --action=status or --action=dry-run.");
  }
  return { mutation_requested: false, extra_args: extraArgs };
}

const SENSITIVE_KEY_PATTERN = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { action: "probe", base_url: "https://dev.mad4b.com" };
  for (const arg of argv) {
    if (arg === "--apply") {
      out.apply = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    if (match) out[match[1].replace(/-/g, "_")] = match[2];
  }
  return out;
}

export function validateDevBaseUrl(value = "https://dev.mad4b.com") {
  const url = new URL(String(value));
  if (url.protocol !== "https:") throw new Error("Dev migration client requires HTTPS.");
  if (url.hostname.toLowerCase() !== "dev.mad4b.com") throw new Error("Dev migration client only permits dev.mad4b.com.");
  if (url.username || url.password) throw new Error("Embedded URL credentials are forbidden.");
  if (url.search || url.hash) throw new Error("Base URL query strings and fragments are forbidden.");
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("Base URL must not contain a path.");
  return "https://dev.mad4b.com";
}

export function assertDevDbStatus(result) {
  if (result?.status !== 200 || result?.body?.ok !== true) {
    const error = new Error("Dev database status preflight failed.");
    error.code = result?.body?.error?.code || "dev_db_status_preflight_failed";
    throw error;
  }
  const dbName = String(result.body.db_name || "").trim();
  if (!dbName.endsWith("_dev")) {
    const error = new Error(`Refusing operation because target database is not dev-scoped: ${dbName || "<unknown>"}`);
    error.code = "dev_database_suffix_required";
    throw error;
  }
  return {
    db_name: dbName,
    table_count: Number(result.body.table_count || 0),
    row_count: Number(result.body.row_count || 0),
  };
}

export function sanitizeResult(value) {
  if (Array.isArray(value)) return value.map(sanitizeResult);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeResult(child);
  }
  return output;
}

function decodeJson(value, base64Value, fallback) {
  if (base64Value) {
    return JSON.parse(Buffer.from(String(base64Value), "base64").toString("utf8"));
  }
  if (value) return JSON.parse(String(value));
  return fallback;
}

function requireApplyAuthorization(args, reason) {
  if (args.apply !== true) throw new Error(`${reason} requires --apply.`);
  if (process.env.DEV_MIGRATION_APPLY_ENABLED !== "true") {
    const error = new Error("DEV_MIGRATION_APPLY_ENABLED=true is required for state-changing dev operations.");
    error.code = "dev_migration_apply_feature_flag_disabled";
    throw error;
  }
}

function isToolMutation(tool, toolArgs) {
  if (MUTATING_TOOLS.has(tool)) return true;
  return tool === "governed_migration_execute" && String(toolArgs?.mode || "dry_run") === "apply";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(Number(options.timeout_ms || 120000)),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw_preview: text.slice(0, 500) };
  }
  return { status: response.status, ok: response.ok, body };
}

async function readDevStatus(base, apiKey) {
  return requestJson(`${base}/dev/db/status`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout_ms: 60000,
  });
}

async function callTool(base, apiKey, name, toolArgs) {
  return requestJson(`${base}/gpt/tools/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, tool_args: toolArgs }),
    timeout_ms: 180000,
  });
}

async function runShellAlias(base, apiKey, alias, extraArgs) {
  return requestJson(`${base}/admin/control`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tool: "shell",
      action: "run",
      alias,
      authority_context: {
        resource_type: "shell_alias",
        resource_uri: `shell://${alias}`,
        operation_mode: alias,
        required: true,
      },
      extra_args: extraArgs,
    }),
    timeout_ms: 180000,
  });
}

export async function runClient(args = parseArgs()) {
  const apiKey = process.env.DEV_GROWTH_OS_API_KEY || process.env.BACKEND_API_KEY;
  if (!apiKey) throw new Error("DEV_GROWTH_OS_API_KEY or BACKEND_API_KEY is required in caller environment.");

  const base = validateDevBaseUrl(args.base_url);
  const action = String(args.action || "probe").trim().toLowerCase();
  const statusBeforeRaw = await readDevStatus(base, apiKey);
  const statusBefore = assertDevDbStatus(statusBeforeRaw);

  let response;
  let target = null;
  let mutationRequested = false;

  if (action === "status") {
    return {
      ok: true,
      action,
      base_url: base,
      status_before: statusBefore,
      mutation_requested: false,
      secrets_included: false,
    };
  }

  if (action === "probe") {
    target = "admin_tool_catalog_search";
    response = await callTool(base, apiKey, target, {
      q: "governed migration capability resolution envelope",
      limit: 30,
      response_options: { max_chars: 30000 },
    });
  } else if (action === "tool-call") {
    target = String(args.tool || "").trim();
    if (!ALLOWED_TOOLS.has(target)) throw new Error(`Tool is not allowlisted for dev migration client: ${target || "<empty>"}`);
    const toolArgs = decodeJson(args.tool_args_json, args.tool_args_base64, {});
    if (!toolArgs || typeof toolArgs !== "object" || Array.isArray(toolArgs)) throw new Error("tool_args must decode to a JSON object.");
    mutationRequested = isToolMutation(target, toolArgs);
    if (mutationRequested) requireApplyAuthorization(args, `Tool ${target}`);
    response = await callTool(base, apiKey, target, toolArgs);
  } else if (action === "shell-alias") {
    target = String(args.alias || "").trim();
    if (!ALLOWED_SHELL_ALIASES.has(target)) throw new Error(`Shell alias is not allowlisted: ${target || "<empty>"}`);
    const extraArgs = decodeJson(args.extra_args_json, args.extra_args_base64, []);
    const invocation = validateShellAliasInvocation(target, extraArgs);
    mutationRequested = invocation.mutation_requested;
    if (mutationRequested) requireApplyAuthorization(args, `Shell alias ${target}`);
    response = await runShellAlias(base, apiKey, target, invocation.extra_args);
  } else {
    throw new Error("Unsupported action. Use status, probe, tool-call, or shell-alias.");
  }

  const statusAfter = mutationRequested ? assertDevDbStatus(await readDevStatus(base, apiKey)) : null;
  const ok = response.status >= 200 && response.status < 300 && response.body?.ok !== false;
  return {
    ok,
    action,
    target,
    base_url: base,
    status_before: statusBefore,
    response: {
      status: response.status,
      ok: response.body?.ok !== false,
      body: sanitizeResult(response.body),
    },
    status_after: statusAfter,
    mutation_requested: mutationRequested,
    apply_flag_present: args.apply === true,
    apply_feature_flag_enabled: process.env.DEV_MIGRATION_APPLY_ENABLED === "true",
    secrets_included: false,
  };
}

async function main() {
  try {
    const result = await runClient(parseArgs());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: {
        code: error.code || "dev_governed_migration_client_failed",
        message: error.message,
      },
      secrets_included: false,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
