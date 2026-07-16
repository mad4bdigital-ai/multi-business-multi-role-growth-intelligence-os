import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOutboxBatch,
  findSensitivePayloadPaths,
  getPlatformOutboxStatus,
  sanitizeOutboxPayload,
  stableStringify,
  validateConsumerReadiness,
} from "./platformOutbox.js";

const root = path.dirname(fileURLToPath(import.meta.url));

assert.equal(
  stableStringify({ z: 1, a: { y: 2, x: 3 } }),
  '{"a":{"x":3,"y":2},"z":1}',
  "stableStringify must produce deterministic key ordering"
);

const sensitivePaths = findSensitivePayloadPaths({
  safe: true,
  nested: {
    refresh_token: "blocked",
    profile: { email: "user@example.com" },
  },
});
assert.deepEqual(sensitivePaths, ["$.nested.refresh_token"]);

const policy = {
  deny_keys: ["password", "refresh_token", "credential"],
  mask_keys: ["email", "phone", "name"],
  maximum_event_bytes: 131072,
  secrets_allowed: false,
};
const sanitized = sanitizeOutboxPayload({
  email: "user@example.com",
  phone: "+201000000000",
  password: "must-not-leave",
  profile: {
    name: "Example User",
    city: "Cairo",
    api_key: "must-not-leave",
  },
}, policy);
assert.deepEqual(sanitized, {
  email: "[masked]",
  phone: "[masked]",
  profile: {
    name: "[masked]",
    city: "Cairo",
  },
});

const disabledReadiness = validateConsumerReadiness({
  consumer_key: "prod_shadow_v1",
  status: "disabled",
  transport_key: "noop",
  endpoint_url: null,
  auth_scheme: "none",
  mask_policy_key: "default_shadow_mask_v1",
}, policy, {
  deliveryEnabled: false,
  allowedHosts: new Set(),
});
assert.equal(disabledReadiness.ready, false);
assert.ok(disabledReadiness.reasons.includes("delivery_feature_flag_disabled"));
assert.ok(disabledReadiness.reasons.includes("consumer_not_enabled"));
assert.ok(disabledReadiness.reasons.includes("transport_not_https_batch_v1"));

const readyReadiness = validateConsumerReadiness({
  consumer_key: "prod_shadow_v1",
  status: "shadow",
  transport_key: "https_batch_v1",
  endpoint_url: "https://shadow.example.internal/outbox/batch",
  auth_scheme: "x_api_key",
  credential_ref: "env:OUTBOX_SHADOW_API_KEY",
  mask_policy_key: "default_shadow_mask_v1",
}, policy, {
  deliveryEnabled: true,
  allowedHosts: new Set(["shadow.example.internal"]),
});
assert.deepEqual(readyReadiness, { ready: true, reasons: [] });

const batch = buildOutboxBatch({
  consumer: { consumer_key: "prod_shadow_v1" },
  policy,
  rows: [{
    event_id: "11111111-1111-4111-8111-111111111111",
    event_type: "customer.profile.updated",
    schema_version: 1,
    aggregate_type: "customer",
    aggregate_id: "customer-1",
    tenant_id: null,
    workspace_id: null,
    occurred_at: "2026-07-12T00:00:00.000Z",
    payload_json: JSON.stringify({ email: "user@example.com", display_name: "Visible" }),
    metadata_json: JSON.stringify({ request_id: "req-1", authorization: "blocked" }),
    payload_sha256: "a".repeat(64),
    payload_classification: "restricted",
    contains_pii: 1,
    source_environment: "production",
  }],
});
assert.equal(batch.contract, "mad4b.platform.outbox.batch.v1");
assert.equal(batch.secrets_included, false);
assert.equal(batch.events[0].payload.email, "[masked]");
assert.equal(batch.events[0].payload.display_name, "Visible");
assert.equal(Object.hasOwn(batch.events[0].metadata, "authorization"), false);

const migration = await fs.readFile(
  path.join(root, "migrations", "20260711_transactional_outbox_shadow_sync_foundation.sql"),
  "utf8"
);
for (const table of [
  "platform_outbox_event_types",
  "platform_outbox_mask_policies",
  "platform_outbox_consumers",
  "platform_outbox_events",
  "platform_outbox_deliveries",
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}
assert.match(migration, /'prod_shadow_v1'/);
assert.match(migration, /'noop'/);
assert.match(migration, /'disabled'/);
assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|DATABASE|COLUMN)\b/i);
assert.doesNotMatch(migration, /\bTRUNCATE\s+TABLE\b/i);

const cli = await fs.readFile(path.join(root, "scripts", "platform-outbox-worker.mjs"), "utf8");
assert.match(cli, /--apply/);
assert.match(cli, /action === "status"/);
assert.match(cli, /action === "dry-run"/);
assert.match(cli, /action === "run-once"/);
assert.match(cli, /action === "loop"/);

const adminCliRoutes = await fs.readFile(path.join(root, "routes", "adminCliRoutes.js"), "utf8");
assert.match(adminCliRoutes, /platform_outbox_worker/);
assert.match(adminCliRoutes, /platform-outbox-worker\.mjs/);

const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
assert.equal(packageJson.scripts["outbox:status"], "node scripts/platform-outbox-worker.mjs --action=status");
assert.equal(packageJson.scripts["outbox:dry-run"], "node scripts/platform-outbox-worker.mjs --action=dry-run");
assert.match(packageJson.scripts["outbox:run-once"], /--apply$/);
assert.match(packageJson.scripts["outbox:loop"], /--apply$/);

const blockedEndpointReadiness = validateConsumerReadiness({
  consumer_key: "prod_shadow_v1",
  status: "shadow",
  transport_key: "https_batch_v1",
  endpoint_url: "https://user:pass@shadow.example.internal/outbox/batch?access_token=blocked",
  auth_scheme: "none",
  mask_policy_key: "default_shadow_mask_v1",
}, policy, {
  deliveryEnabled: true,
  allowedHosts: new Set(["shadow.example.internal"]),
});
assert.equal(blockedEndpointReadiness.ready, false);
assert.ok(blockedEndpointReadiness.reasons.includes("endpoint_embedded_credentials_forbidden"));
assert.ok(blockedEndpointReadiness.reasons.includes("endpoint_secret_query_parameter_forbidden"));

const outboxSource = await fs.readFile(path.join(root, "platformOutbox.js"), "utf8");
assert.match(outboxSource, /async function releaseExpiredClaims/);
assert.match(outboxSource, /outbox_claim_expired/);
assert.match(outboxSource, /redirect: "error"/);
assert.match(outboxSource, /mask_policy_not_active/);

console.log("platform outbox foundation contract tests passed");
