import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS,
  transitionCapabilityEnvelopeLifecycle,
} from "./capabilityResolutionEnvelopeGuard.js";

function makeRow(overrides = {}) {
  return {
    envelope_id: "env-1",
    envelope_status: "ready_for_dispatch",
    execution_status: "not_executed",
    dispatch_allowed: 1,
    apply_allowed: 1,
    secrets_included: 0,
    ...overrides,
  };
}

function makePool(initialRow) {
  let row = initialRow ? { ...initialRow } : null;
  const updates = [];
  return {
    updates,
    get row() { return row; },
    async query(sql, params = []) {
      const source = String(sql).replace(/\s+/g, " ").trim();
      if (source.startsWith("SELECT envelope_id")) return [[row].filter(Boolean)];
      if (!source.startsWith("UPDATE capability_resolution_envelope_ledger")) throw new Error(`Unexpected SQL: ${source}`);
      updates.push({ sql: source, params });
      if (!row || row.execution_status === "executed" || row.execution_status === "cancelled" || row.envelope_status === "expired") return [{ affectedRows: 0 }];
      if (source.includes("execution_status = 'executed'")) {
        if (row.envelope_status !== "ready_for_dispatch") return [{ affectedRows: 0 }];
        row = { ...row, execution_status: "executed", dispatch_allowed: 0, apply_allowed: 0 };
      } else if (source.includes("execution_status = 'cancelled'")) {
        row = { ...row, envelope_status: "superseded", execution_status: "cancelled", dispatch_allowed: 0, apply_allowed: 0 };
      } else if (source.includes("envelope_status = 'expired'")) {
        row = { ...row, envelope_status: "expired", dispatch_allowed: 0, apply_allowed: 0 };
      }
      return [{ affectedRows: 1 }];
    },
  };
}

assert.deepEqual(CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS, ["consume", "cancel", "expire"]);

{
  const pool = makePool(makeRow());
  const result = await transitionCapabilityEnvelopeLifecycle({ pool, envelopeId: "env-1", action: "consume", executionRef: "run-1" });
  assert.equal(result.ok, true);
  assert.equal(result.after.execution_status, "executed");
  assert.equal(result.after.dispatch_allowed, false);
  assert.equal(result.secrets_included, false);
}

{
  const pool = makePool(makeRow({ envelope_status: "ready_requires_approval", dispatch_allowed: 0, apply_allowed: 0 }));
  const result = await transitionCapabilityEnvelopeLifecycle({ pool, envelopeId: "env-1", action: "cancel", reason: "operator requested" });
  assert.equal(result.ok, true);
  assert.equal(result.after.envelope_status, "superseded");
  assert.equal(result.after.execution_status, "cancelled");
}

{
  const pool = makePool(makeRow({ envelope_status: "ready_for_dispatch" }));
  const result = await transitionCapabilityEnvelopeLifecycle({ pool, envelopeId: "env-1", action: "expire", reason: "ttl cleanup" });
  assert.equal(result.ok, true);
  assert.equal(result.after.envelope_status, "expired");
  assert.equal(result.after.apply_allowed, false);
}

{
  const pool = makePool(makeRow({ execution_status: "executed", dispatch_allowed: 0, apply_allowed: 0 }));
  const result = await transitionCapabilityEnvelopeLifecycle({ pool, envelopeId: "env-1", action: "consume" });
  assert.equal(result.ok, false);
  assert.equal(result.status, "capability_resolution_envelope_lifecycle_transition_blocked");
  assert.equal(result.secrets_included, false);
}

const script = readFileSync(new URL("./scripts/capability-resolution-envelope-lifecycle.mjs", import.meta.url), "utf8");
assert.match(script, /transitionCapabilityEnvelopeLifecycle/);
assert.doesNotMatch(script, /fetch\(|axios|spawn\(|exec\(/);
assert.match(script, /secrets_included/);

const adminCliRoutes = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
assert.match(adminCliRoutes, /capability_resolution_envelope_lifecycle/);
assert.match(adminCliRoutes, /scripts\/capability-resolution-envelope-lifecycle\.mjs/);
assert.match(adminCliRoutes, /Transition capability resolution envelope lifecycle/);

const gptToolsRoutes = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
assert.match(gptToolsRoutes, /CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS/);
assert.match(gptToolsRoutes, /transitionCapabilityEnvelopeLifecycle/);
assert.match(gptToolsRoutes, /name: "capability_resolution_envelope_lifecycle"/);
assert.match(gptToolsRoutes, /internal:\/\/capability-resolution-envelope-lifecycle/);
assert.match(gptToolsRoutes, /enum: CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS/);
assert.match(gptToolsRoutes, /toolKey === "capability_resolution_envelope_lifecycle"/);
assert.match(gptToolsRoutes, /envelopeId: String\(args\?\.envelope_id/);
assert.match(gptToolsRoutes, /action: String\(args\?\.action/);
assert.match(gptToolsRoutes, /executionRef: String\(args\?\.execution_ref/);
assert.match(gptToolsRoutes, /"no_provider_call", "no_external_write", "no_secrets"/);

console.log("Capability envelope lifecycle tool tests passed");
