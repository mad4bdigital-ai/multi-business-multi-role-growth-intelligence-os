#!/usr/bin/env node
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { domainKey: "ads_provider_governance", includeCompleted: false, checkpointKey: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--domain-key")) { args.domainKey = value || args.domainKey; if (consume) i += 1; }
    else if (item.startsWith("--checkpoint-key")) { args.checkpointKey = value || ""; if (consume) i += 1; }
    else if (item === "--include-completed") args.includeCompleted = true;
  }
  return args;
}

function clean(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function safeJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

async function readCheckpoints(pool, args) {
  const where = ["secrets_included = 0"];
  const params = [];
  if (args.domainKey) { where.push("domain_key = ?"); params.push(clean(args.domainKey, 128)); }
  if (args.checkpointKey) { where.push("checkpoint_key = ?"); params.push(clean(args.checkpointKey, 191)); }
  const [rows] = await pool.query(
    `SELECT checkpoint_key, checkpoint_version, domain_key, status, title,
            checkpoint_json, no_provider_call, no_spend_change, secrets_included,
            created_at, updated_at
       FROM platform_checkpoint_registry
      WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC, checkpoint_key ASC
      LIMIT 20`,
    params
  );
  return rows.map((row) => ({
    checkpoint_key: row.checkpoint_key,
    checkpoint_version: row.checkpoint_version,
    domain_key: row.domain_key,
    status: row.status,
    title: row.title,
    checkpoint: safeJson(row.checkpoint_json, {}),
    no_provider_call: Boolean(row.no_provider_call),
    no_spend_change: Boolean(row.no_spend_change),
    secrets_included: Boolean(row.secrets_included),
    updated_at: row.updated_at,
  }));
}

async function readTasks(pool, args) {
  const where = ["secrets_included = 0"];
  const params = [];
  if (args.domainKey) { where.push("domain_key = ?"); params.push(clean(args.domainKey, 128)); }
  if (!args.includeCompleted) where.push("task_status <> 'completed'");
  const [rows] = await pool.query(
    `SELECT task_key, domain_key, task_group, parent_task_key, task_status,
            priority, sequence_no, title, description, depends_on_json,
            acceptance_criteria_json, safety_contract_json, blocked_reason,
            no_provider_call, no_spend_change, secrets_included, created_at, updated_at
       FROM platform_tasks_registry
      WHERE ${where.join(" AND ")}
      ORDER BY priority DESC, sequence_no ASC, task_key ASC
      LIMIT 100`,
    params
  );
  return rows.map((row) => ({
    task_key: row.task_key,
    domain_key: row.domain_key,
    task_group: row.task_group,
    parent_task_key: row.parent_task_key,
    task_status: row.task_status,
    priority: Number(row.priority || 0),
    sequence_no: Number(row.sequence_no || 0),
    title: row.title,
    description: row.description,
    depends_on: safeJson(row.depends_on_json, []),
    acceptance_criteria: safeJson(row.acceptance_criteria_json, []),
    safety_contract: safeJson(row.safety_contract_json, {}),
    blocked_reason: row.blocked_reason,
    no_provider_call: Boolean(row.no_provider_call),
    no_spend_change: Boolean(row.no_spend_change),
    secrets_included: Boolean(row.secrets_included),
  }));
}

export async function readPlatformTasksRegistry(args = parseArgs()) {
  const pool = getPool();
  const checkpoints = await readCheckpoints(pool, args);
  const tasks = await readTasks(pool, args);
  return {
    ok: true,
    domain_key: clean(args.domainKey, 128) || null,
    checkpoint_count: checkpoints.length,
    task_count: tasks.length,
    checkpoints,
    tasks,
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  readPlatformTasksRegistry(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "platform_tasks_registry_readback_failed", message: err.message }, no_provider_call: true, no_spend_change: true, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
