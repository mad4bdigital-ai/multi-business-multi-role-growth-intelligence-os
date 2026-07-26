#!/usr/bin/env node
import crypto from "node:crypto";
import { getPool } from "../db.js";

const LEDGER_TABLE_ALLOWLIST = new Set(["google_ads_budget_preflight_ledger"]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    familyKey: "google_ads_budget",
    preflightId: "",
    expectedEnvelopeId: "",
    expectedDecision: "ready_for_dispatch",
    requireReady: true,
    allowBlockedReadback: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--family-key")) { args.familyKey = value || args.familyKey; if (consume) i += 1; }
    else if (item.startsWith("--preflight-id")) { args.preflightId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--expected-envelope-id")) { args.expectedEnvelopeId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--expected-decision")) { args.expectedDecision = value || args.expectedDecision; if (consume) i += 1; }
    else if (item === "--allow-blocked-readback") { args.allowBlockedReadback = true; args.requireReady = false; }
    else if (item === "--no-require-ready") args.requireReady = false;
  }
  return args;
}

function clean(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function loadValidatorRegistry(pool, familyKey) {
  const [[row]] = await pool.query(
    `SELECT family_key, ledger_table, id_column, envelope_column, decision_column,
            ready_column, hash_column, payload_column, no_provider_call_column,
            no_spend_change_column, secrets_column, status, policy_json, secrets_included
       FROM preflight_ledger_validator_registry
      WHERE family_key = ?
        AND status = 'active'
        AND secrets_included = 0
      LIMIT 1`,
    [familyKey]
  );
  return row || null;
}

async function loadLedgerRow(pool, registry, preflightId) {
  if (!LEDGER_TABLE_ALLOWLIST.has(registry.ledger_table)) {
    const err = new Error("Preflight ledger table is not validator allowlisted.");
    err.code = "preflight_ledger_table_not_allowlisted";
    err.details = { ledger_table: registry.ledger_table };
    throw err;
  }
  if (registry.ledger_table === "google_ads_budget_preflight_ledger") {
    const [[row]] = await pool.query(
      `SELECT preflight_id, capability_envelope_id, budget_authority_id, decision,
              ready_for_dispatch, requested_amount_minor, currency, meter_key,
              blocking_gap_count, preflight_json, preflight_sha256,
              no_provider_call, no_spend_change, secrets_included, created_at
         FROM google_ads_budget_preflight_ledger
        WHERE preflight_id = ?
        LIMIT 1`,
      [preflightId]
    );
    return row || null;
  }
  const err = new Error("Unsupported preflight ledger family.");
  err.code = "preflight_ledger_family_not_supported";
  throw err;
}

function fail(code, message, details = {}) {
  return {
    ok: true,
    valid: false,
    decision: code,
    error: { code, message, details },
    secrets_included: false,
  };
}

export async function validatePreflightLedger(args = parseArgs()) {
  const pool = getPool();
  const familyKey = clean(args.familyKey, 128);
  const preflightId = clean(args.preflightId, 64);
  if (!preflightId) return fail("preflight_id_required", "--preflight-id is required.");
  const registry = await loadValidatorRegistry(pool, familyKey);
  if (!registry) return fail("preflight_validator_registry_missing", "No active preflight ledger validator registry row exists.", { family_key: familyKey });
  const row = await loadLedgerRow(pool, registry, preflightId);
  if (!row) return fail("preflight_ledger_row_not_found", "Preflight ledger row was not found.", { family_key: familyKey, preflight_id: preflightId });
  if (Number(row.secrets_included || 0) !== 0) return fail("preflight_ledger_secret_boundary_failed", "Preflight row is marked as secret-bearing.", { preflight_id: preflightId });
  if (Number(row.no_provider_call || 0) !== 1) return fail("preflight_ledger_provider_call_marker_failed", "Preflight row does not guarantee no_provider_call=true.", { preflight_id: preflightId });
  if (Number(row.no_spend_change || 0) !== 1) return fail("preflight_ledger_spend_marker_failed", "Preflight row does not guarantee no_spend_change=true.", { preflight_id: preflightId });
  const expectedEnvelopeId = clean(args.expectedEnvelopeId, 64);
  if (expectedEnvelopeId && row.capability_envelope_id !== expectedEnvelopeId) {
    return fail("preflight_ledger_envelope_mismatch", "Preflight row envelope does not match expected envelope.", { preflight_id: preflightId, expected_envelope_id: expectedEnvelopeId, actual_envelope_id: row.capability_envelope_id });
  }
  if (args.requireReady && Number(row.ready_for_dispatch || 0) !== 1) {
    return fail("preflight_ledger_not_ready_for_dispatch", "Preflight row is not ready_for_dispatch.", { preflight_id: preflightId, decision: row.decision });
  }
  const expectedDecision = clean(args.expectedDecision, 128);
  if (expectedDecision && row.decision !== expectedDecision && !args.allowBlockedReadback) {
    return fail("preflight_ledger_decision_mismatch", "Preflight row decision does not match expected decision.", { preflight_id: preflightId, expected_decision: expectedDecision, actual_decision: row.decision });
  }
  const payload = safeJson(row.preflight_json, {});
  const computedHash = sha256Json(payload);
  if (computedHash !== row.preflight_sha256) {
    return fail("preflight_ledger_hash_mismatch", "Preflight ledger hash mismatch.", { preflight_id: preflightId, expected_sha256: row.preflight_sha256, computed_sha256: computedHash });
  }
  return {
    ok: true,
    valid: true,
    decision: "preflight_ledger_valid",
    family_key: familyKey,
    preflight_id: row.preflight_id,
    capability_envelope_id: row.capability_envelope_id,
    budget_authority_id: row.budget_authority_id,
    preflight_decision: row.decision,
    ready_for_dispatch: Number(row.ready_for_dispatch || 0) === 1,
    requested_amount_minor: row.requested_amount_minor === null ? null : Number(row.requested_amount_minor),
    currency: row.currency,
    meter_key: row.meter_key,
    blocking_gap_count: Number(row.blocking_gap_count || 0),
    preflight_sha256: row.preflight_sha256,
    hash_verified: true,
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validatePreflightLedger(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
      if (!result.valid) process.exitCode = 1;
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "preflight_ledger_validate_failed", message: err.message, details: err.details || undefined }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
