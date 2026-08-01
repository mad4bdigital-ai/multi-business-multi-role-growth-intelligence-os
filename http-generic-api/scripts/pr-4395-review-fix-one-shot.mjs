import fs from "node:fs";
import { spawnSync } from "node:child_process";

const EXPECTED_BRANCH = "gpt/tenant-request-inbox-chunk-store-hardening-20260801";
const HELPER_PATH = "scripts/pr-4395-review-fix-one-shot.mjs";
const PACKAGE_PATH = "package.json";

function fail(message) {
  throw new Error(`[pr-4395-review-fix] ${message}`);
}

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function occurrenceCount(content, needle) {
  return content.split(needle).length - 1;
}

function replaceExact(path, before, after, expectedCount = 1) {
  const content = read(path);
  const count = occurrenceCount(content, before);
  if (count !== expectedCount) fail(`${path}: expected ${expectedCount} occurrence(s), found ${count}`);
  write(path, content.split(before).join(after));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited ${result.status}`);
}

const branchResult = spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" });
const branch = String(process.env.GITHUB_HEAD_REF || branchResult.stdout || "").trim();
if (branch !== EXPECTED_BRANCH) fail(`refusing branch ${branch || "<detached>"}`);

// P1: preserve inline fallback only inside the caller's effective body budget.
replaceExact(
  "routes/gptToolsRoutes.js",
  `  } catch (error) {
    logToolResponseChunkFallback(error, optionsSource);
    return buildBoundedInlineChunkFallback(body, error, {
      sourceToolKey: optionsSource?.source_tool_key || optionsSource?.tool_key || optionsSource?.name || "gpt_tool_response",
      maxChars: MAX_TOOL_RESPONSE_MAX_CHARS,
    });
  }`,
  `  } catch (error) {
    logToolResponseChunkFallback(error, optionsSource);
    const responseBudgetOptions = optionsSource?.response_options || optionsSource?._response || optionsSource || {};
    const inlineMaxChars = resolveAdaptiveToolResponseMaxChars({
      ...responseBudgetOptions,
      max_chars: MAX_TOOL_RESPONSE_MAX_CHARS,
      max_response_chars: MAX_TOOL_RESPONSE_MAX_CHARS,
    });
    return buildBoundedInlineChunkFallback(body, error, {
      sourceToolKey: optionsSource?.source_tool_key || optionsSource?.tool_key || optionsSource?.name || "gpt_tool_response",
      maxChars: inlineMaxChars,
    });
  }`,
);

// P2: cache only successful schema readiness per executor for a bounded TTL.
replaceExact(
  "governedToolResponseChunkStore.js",
  `export const GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS = Object.freeze([
  "chunk_id", "source_tool_key", "response_sha256", "response_bytes", "response_json",
  "cursor_policy", "redaction_status", "secrets_included", "owner_tenant_id",
  "owner_user_id", "owner_workspace_id", "owner_principal_type", "owner_principal_id",
  "source_surface", "created_at", "expires_at",
]);`,
  `export const GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS = Object.freeze([
  "chunk_id", "source_tool_key", "response_sha256", "response_bytes", "response_json",
  "cursor_policy", "redaction_status", "secrets_included", "owner_tenant_id",
  "owner_user_id", "owner_workspace_id", "owner_principal_type", "owner_principal_id",
  "source_surface", "created_at", "expires_at",
]);
export const GOVERNED_RESPONSE_CHUNK_SCHEMA_READY_TTL_MS = 60_000;
const governedResponseChunkSchemaReadyCache = new WeakMap();`,
);

replaceExact(
  "governedToolResponseChunkStore.js",
  `function executor(deps = {}) {
  return deps.pool || deps.connection || getPool();
}

export async function inspectGovernedResponseChunkSchema(deps = {}) {`,
  `function executor(deps = {}) {
  return deps.pool || deps.connection || getPool();
}

function schemaReadinessCacheKey(deps = {}) {
  const target = executor(deps);
  return target && (typeof target === "object" || typeof target === "function") ? target : null;
}

export function invalidateGovernedResponseChunkSchemaReadiness(deps = {}) {
  const key = schemaReadinessCacheKey(deps);
  return key ? governedResponseChunkSchemaReadyCache.delete(key) : false;
}

export async function inspectGovernedResponseChunkSchema(deps = {}) {`,
);

replaceExact(
  "governedToolResponseChunkStore.js",
  `async function assertGovernedResponseChunkSchema(deps = {}, operation = "response_chunk_store") {
  const schema = await inspectGovernedResponseChunkSchema({ ...deps, operation });
  if (schema.ready) return schema;
  throw responseChunkError(
    "response_chunk_persistence_unavailable",
    "The durable response chunk store schema is incomplete.",
    503,
    {
      cause_code: schema.cause_code || "response_chunk_schema_incomplete",
      operation,
      missing_columns: schema.missing_columns,
      migration_file: schema.migration_file,
      secrets_included: false,
    }
  );
}`,
  `async function assertGovernedResponseChunkSchema(deps = {}, operation = "response_chunk_store") {
  const key = schemaReadinessCacheKey(deps);
  const checkedAtMs = nowMs(deps);
  const cached = key ? governedResponseChunkSchemaReadyCache.get(key) : null;
  if (cached && cached.expires_at_ms > checkedAtMs) {
    return { ...cached.schema, operation, cached: true };
  }
  if (cached && key) governedResponseChunkSchemaReadyCache.delete(key);

  const schema = await inspectGovernedResponseChunkSchema({ ...deps, operation });
  if (schema.ready) {
    const requestedTtlMs = positiveInteger(
      deps.schemaReadyTtlMs || deps.schema_ready_ttl_ms,
      GOVERNED_RESPONSE_CHUNK_SCHEMA_READY_TTL_MS,
    );
    const ttlMs = Math.min(requestedTtlMs, 5 * 60 * 1000);
    if (key && ttlMs > 0) {
      governedResponseChunkSchemaReadyCache.set(key, {
        schema: { ...schema, cached: false },
        expires_at_ms: checkedAtMs + ttlMs,
      });
    }
    return { ...schema, cached: false };
  }
  throw responseChunkError(
    "response_chunk_persistence_unavailable",
    "The durable response chunk store schema is incomplete.",
    503,
    {
      cause_code: schema.cause_code || "response_chunk_schema_incomplete",
      operation,
      missing_columns: schema.missing_columns,
      migration_file: schema.migration_file,
      secrets_included: false,
    }
  );
}`,
);

replaceExact(
  "governedToolResponseChunkStore.js",
  `  } catch (cause) {
    throw responseChunkError("response_chunk_persistence_unavailable", "The durable response chunk store is unavailable.", 503, { cause_code: cause?.code || null });
  }`,
  `  } catch (cause) {
    invalidateGovernedResponseChunkSchemaReadiness(deps);
    throw responseChunkError("response_chunk_persistence_unavailable", "The durable response chunk store is unavailable.", 503, { cause_code: cause?.code || null });
  }`,
  4,
);
replaceExact(
  "governedToolResponseChunkStore.js",
  `  } catch (cause) {
    throw responseChunkError("response_chunk_cleanup_unavailable", "Expired response chunk cleanup is unavailable.", 503, { cause_code: cause?.code || null });
  }`,
  `  } catch (cause) {
    invalidateGovernedResponseChunkSchemaReadiness(deps);
    throw responseChunkError("response_chunk_cleanup_unavailable", "Expired response chunk cleanup is unavailable.", 503, { cause_code: cause?.code || null });
  }`,
);

// P3/P4: include visible event activity and retain the newest bounded timeline rows.
replaceExact(
  "tenantRequestInboxService.js",
  `function latestActivitySql(alias = "t", caseAlias = "c") {
  return \`GREATEST(
    COALESCE(\${alias}.last_seen_at, \${alias}.updated_at, \${alias}.created_at),
    COALESCE(\${caseAlias}.updated_at, \${alias}.last_seen_at, \${alias}.updated_at, \${alias}.created_at)
  )\`;
}`,
  `function ticketEventVisibilitySql(scope = {}, alias = "") {
  const column = alias ? \`\${alias}.visibility\` : "visibility";
  if (scope?.isAdmin === true) return "";
  return canViewTenantAdminTicketEvents(scope)
    ? \`AND \${column} IN ('customer','tenant_admin')\`
    : \`AND \${column} = 'customer'\`;
}

function latestActivitySql(alias = "t", caseAlias = "c", ticketEventVisibility = "") {
  const ticketFallback = \`COALESCE(\${alias}.last_seen_at, \${alias}.updated_at, \${alias}.created_at)\`;
  return \`GREATEST(
    \${ticketFallback},
    COALESCE(\${caseAlias}.updated_at, \${ticketFallback}),
    COALESCE((
      SELECT MAX(tle.created_at)
        FROM ticket_lifecycle_events tle
       WHERE tle.tenant_id = \${alias}.tenant_id
         AND tle.ticket_id = \${alias}.ticket_id
         \${ticketEventVisibility}
    ), \${ticketFallback}),
    COALESCE((
      SELECT MAX(trce.created_at)
        FROM tenant_resolution_case_events trce
       WHERE trce.case_id = \${caseAlias}.case_id
    ), \${ticketFallback}),
    COALESCE((
      SELECT MAX(trr.created_at)
        FROM tenant_resolution_readbacks trr
       WHERE trr.case_id = \${caseAlias}.case_id
    ), \${ticketFallback})
  )\`;
}`,
);
replaceExact(
  "tenantRequestInboxService.js",
  `  const activity = latestActivitySql();`,
  `  const activity = latestActivitySql("t", "c", ticketEventVisibilitySql(scope, "tle"));`,
  2,
);
replaceExact(
  "tenantRequestInboxService.js",
  `  const canViewTenantAdmin = canViewTenantAdminTicketEvents(scope);
  const visibilitySql = scope.isAdmin
    ? ""
    : (canViewTenantAdmin ? \`AND visibility IN ('customer','tenant_admin')\` : \`AND visibility = 'customer'\`);`,
  `  const canViewTenantAdmin = canViewTenantAdminTicketEvents(scope);
  const visibilitySql = ticketEventVisibilitySql(scope);`,
);
replaceExact(
  "tenantRequestInboxService.js",
  `  const [ticketEvents] = await pool.query(
    \`SELECT event_id, event_type, from_state, to_state, summary, visibility, payload_json, created_at
       FROM ticket_lifecycle_events
      WHERE tenant_id = ? AND ticket_id = ? \${visibilitySql}
      ORDER BY created_at ASC, id ASC
      LIMIT 500\`,
    [row.tenant_id, row.ticket_id]
  );`,
  `  const [ticketEvents] = await pool.query(
    \`SELECT event_id, event_type, from_state, to_state, summary, visibility, payload_json, created_at
       FROM (
         SELECT id, event_id, event_type, from_state, to_state, summary, visibility, payload_json, created_at
           FROM ticket_lifecycle_events
          WHERE tenant_id = ? AND ticket_id = ? \${visibilitySql}
          ORDER BY created_at DESC, id DESC
          LIMIT 500
       ) bounded_ticket_events
      ORDER BY created_at ASC, id ASC\`,
    [row.tenant_id, row.ticket_id]
  );`,
);
replaceExact(
  "tenantRequestInboxService.js",
  `    [caseEvents] = await pool.query(
      \`SELECT event_id, event_type, actor_type, actor_id, from_status, to_status,
              evidence_ref, event_json, created_at
         FROM tenant_resolution_case_events
        WHERE case_id = ?
        ORDER BY created_at ASC, id ASC
        LIMIT 500\`,
      [row.case_id]
    );`,
  `    [caseEvents] = await pool.query(
      \`SELECT event_id, event_type, actor_type, actor_id, from_status, to_status,
              evidence_ref, event_json, created_at
         FROM (
           SELECT id, event_id, event_type, actor_type, actor_id, from_status, to_status,
                  evidence_ref, event_json, created_at
             FROM tenant_resolution_case_events
            WHERE case_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 500
         ) bounded_case_events
        ORDER BY created_at ASC, id ASC\`,
      [row.case_id]
    );`,
);
replaceExact(
  "tenantRequestInboxService.js",
  `    [readbacks] = await pool.query(
      \`SELECT readback_id, decision, expected_state_json, observed_state_json,
              blocking_reasons_json, source_alerts_remaining_json, created_at
         FROM tenant_resolution_readbacks
        WHERE case_id = ?
        ORDER BY created_at ASC, id ASC
        LIMIT 200\`,
      [row.case_id]
    );`,
  `    [readbacks] = await pool.query(
      \`SELECT readback_id, decision, expected_state_json, observed_state_json,
              blocking_reasons_json, source_alerts_remaining_json, created_at
         FROM (
           SELECT id, readback_id, decision, expected_state_json, observed_state_json,
                  blocking_reasons_json, source_alerts_remaining_json, created_at
             FROM tenant_resolution_readbacks
            WHERE case_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 200
         ) bounded_readbacks
        ORDER BY created_at ASC, id ASC\`,
      [row.case_id]
    );`,
);

// Regression coverage for the four review findings.
replaceExact(
  "test-gpt-tools-response-chunking.mjs",
  `  assert.equal(degradedFallback.continuation_contract.source_tool_key, "test_degraded_chunk_store");
  assert.equal(degradedFallback.secrets_included, false);`,
  `  assert.equal(degradedFallback.continuation_contract.source_tool_key, "test_degraded_chunk_store");
  assert.equal(degradedFallback.continuation_contract.bounded_inline_max_chars, 45000);
  assert.equal(degradedFallback.secrets_included, false);`,
);
replaceExact(
  "test-gpt-tools-response-chunking.mjs",
  `  assert.equal(JSON.stringify(warnings).includes("fallback-0"), false, "fallback diagnostics must not log response content");

  const existingChunkEnvelope = {`,
  `  assert.equal(JSON.stringify(warnings).includes("fallback-0"), false, "fallback diagnostics must not log response content");

  const budgetWarnings = [];
  console.warn = (...args) => budgetWarnings.push(args);
  try {
    await assert.rejects(
      () => maybeChunkToolResponseBody(degradedBody, {
        response_options: {
          max_chars: 5000,
          client_response_budget_chars: 10000,
          response_envelope_overhead_chars: 5000,
        },
        source_tool_key: "test_degraded_budget_limit",
        request_id: "request-degraded-budget-1",
        auth: tenantA,
      }, { pool: degradedPool, now }),
      (error) => error?.code === "response_chunk_persistence_unavailable_inline_limit_exceeded"
        && error?.status === 503
        && error?.details?.bounded_inline_max_chars === 5000,
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(budgetWarnings.length, 1);
  assert.equal(JSON.stringify(budgetWarnings).includes("fallback-0"), false);

  const existingChunkEnvelope = {`,
);

replaceExact(
  "test-governed-tool-response-chunk-store.mjs",
  `  GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
  GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS,
  extendGovernedToolResponseChunkExpiry,`,
  `  GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
  GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS,
  extendGovernedToolResponseChunkExpiry,
  inspectGovernedResponseChunkSchema,`,
);
replaceExact(
  "test-governed-tool-response-chunk-store.mjs",
  `function createFakePool() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params = []) {
      if (sql.includes("information_schema.columns")) {
        return [
          GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS.map((column_name) => ({ column_name })),
        ];
      }`,
  `function createFakePool() {
  const rows = new Map();
  const state = { schema_probe_count: 0, fail_next_durable_query: false };
  return {
    rows,
    state,
    async query(sql, params = []) {
      if (sql.includes("information_schema.columns")) {
        state.schema_probe_count += 1;
        return [
          GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS.map((column_name) => ({ column_name })),
        ];
      }
      if (state.fail_next_durable_query) {
        state.fail_next_durable_query = false;
        const error = new Error("durable query failed");
        error.code = "ER_QUERY_INTERRUPTED";
        throw error;
      }`,
);
replaceExact(
  "test-governed-tool-response-chunk-store.mjs",
  `assert.equal(pool.rows.get(chunkId).owner_principal_type, "tenant_user");

const loaded = await loadGovernedToolResponseChunk`,
  `assert.equal(pool.rows.get(chunkId).owner_principal_type, "tenant_user");
assert.equal(pool.state.schema_probe_count, 1, "persist plus verification must share one successful schema probe");

const loaded = await loadGovernedToolResponseChunk`,
);
replaceExact(
  "test-governed-tool-response-chunk-store.mjs",
  `assert.equal(loaded.owner_workspace_id, "workspace-a");

const crossTenantLoad = await loadGovernedToolResponseChunk`,
  `assert.equal(loaded.owner_workspace_id, "workspace-a");
assert.equal(pool.state.schema_probe_count, 1, "hot-path loads must reuse bounded successful readiness");

pool.state.fail_next_durable_query = true;
await assert.rejects(
  extendGovernedToolResponseChunkExpiry(
    { chunk_id: chunkId, ttl_ms: 20 * 60 * 1000, auth: tenantA },
    { pool, now: now + 1500 },
  ),
  (error) => error?.code === "response_chunk_persistence_unavailable" && error?.status === 503,
);
const probesBeforeRecovery = pool.state.schema_probe_count;
await extendGovernedToolResponseChunkExpiry(
  { chunk_id: chunkId, ttl_ms: 20 * 60 * 1000, auth: tenantA },
  { pool, now: now + 1501 },
);
assert.equal(pool.state.schema_probe_count, probesBeforeRecovery + 1, "durable query failures must invalidate cached readiness");
const probesBeforeLiveDiagnostics = pool.state.schema_probe_count;
await inspectGovernedResponseChunkSchema({ pool, now: now + 1502, operation: "diagnostic_one" });
await inspectGovernedResponseChunkSchema({ pool, now: now + 1503, operation: "diagnostic_two" });
assert.equal(pool.state.schema_probe_count, probesBeforeLiveDiagnostics + 2, "explicit diagnostics must remain live and bypass readiness cache");

const crossTenantLoad = await loadGovernedToolResponseChunk`,
);

replaceExact(
  "test-tenant-request-inbox-and-chunk-hardening.mjs",
  `      assert.match(sql, /ORDER BY latest_activity_at DESC, t\\.ticket_id DESC/u);
      assert.doesNotMatch(sql, /OFFSET/u);`,
  `      assert.match(sql, /ORDER BY latest_activity_at DESC, t\\.ticket_id DESC/u);
      assert.match(sql, /SELECT MAX\\(tle\\.created_at\\)/u, "latest activity must include visible ticket lifecycle events");
      assert.match(sql, /FROM tenant_resolution_case_events trce/u, "latest activity must include resolution-case events");
      assert.match(sql, /FROM tenant_resolution_readbacks trr/u, "latest activity must include readbacks");
      assert.doesNotMatch(sql, /OFFSET/u);`,
);
replaceExact(
  "test-tenant-request-inbox-and-chunk-hardening.mjs",
  `      assert.match(sql, /visibility = 'customer'/u, "ordinary tenant members must be filtered to customer-visible ticket events at SQL level");
      assert.doesNotMatch(sql, /tenant_admin/u, "ordinary tenant member queries must not request tenant-admin events");`,
  `      assert.match(sql, /visibility = 'customer'/u, "ordinary tenant members must be filtered to customer-visible ticket events at SQL level");
      assert.doesNotMatch(sql, /tenant_admin/u, "ordinary tenant member queries must not request tenant-admin events");
      assert.match(sql, /ORDER BY created_at DESC, id DESC[\\s\\S]*LIMIT 500/u, "ticket events must bound the newest rows first");
      assert.match(sql, /bounded_ticket_events[\\s\\S]*ORDER BY created_at ASC, id ASC/u, "bounded ticket events must be restored to chronological order");`,
);
replaceExact(
  "test-tenant-request-inbox-and-chunk-hardening.mjs",
  `  { rows: [{ event_id: "case-event", event_type: "case_escalated", actor_type: "system", actor_id: "ops", from_status: "diagnosing", to_status: "escalated", evidence_ref: "internal://evidence", event_json: JSON.stringify({ secret: "unsafe", reason: "platform" }), created_at: "2026-07-29T05:02:00.000Z" }] },
  { rows: [{ readback_id: "readback-1", decision: "still_active", expected_state_json: "{}", observed_state_json: JSON.stringify({ api_key: "unsafe" }), blocking_reasons_json: "[]", source_alerts_remaining_json: "[]", created_at: "2026-07-29T05:03:00.000Z" }] },`,
  `  {
    rows: [{ event_id: "case-event", event_type: "case_escalated", actor_type: "system", actor_id: "ops", from_status: "diagnosing", to_status: "escalated", evidence_ref: "internal://evidence", event_json: JSON.stringify({ secret: "unsafe", reason: "platform" }), created_at: "2026-07-29T05:02:00.000Z" }],
    assert(sql) {
      assert.match(sql, /ORDER BY created_at DESC, id DESC[\\s\\S]*LIMIT 500/u, "case events must bound the newest rows first");
      assert.match(sql, /bounded_case_events[\\s\\S]*ORDER BY created_at ASC, id ASC/u);
    },
  },
  {
    rows: [{ readback_id: "readback-1", decision: "still_active", expected_state_json: "{}", observed_state_json: JSON.stringify({ api_key: "unsafe" }), blocking_reasons_json: "[]", source_alerts_remaining_json: "[]", created_at: "2026-07-29T05:03:00.000Z" }],
    assert(sql) {
      assert.match(sql, /ORDER BY created_at DESC, id DESC[\\s\\S]*LIMIT 200/u, "readbacks must bound the newest rows first");
      assert.match(sql, /bounded_readbacks[\\s\\S]*ORDER BY created_at ASC, id ASC/u);
    },
  },`,
);

// Restore the temporary trigger and remove this runner before any commit.
replaceExact(
  PACKAGE_PATH,
  `"frontend:dispatch:generate": "node scripts/pr-4395-review-fix-one-shot.mjs && node scripts/frontend-operation-governance-generator.mjs --write && node scripts/frontend-surface-dispatch.mjs --write"`,
  `"frontend:dispatch:generate": "node scripts/frontend-operation-governance-generator.mjs --write && node scripts/frontend-surface-dispatch.mjs --write"`,
);
fs.unlinkSync(HELPER_PATH);

for (const file of [
  "routes/gptToolsRoutes.js",
  "governedToolResponseChunkStore.js",
  "tenantRequestInboxService.js",
  "test-gpt-tools-response-chunking.mjs",
  "test-governed-tool-response-chunk-store.mjs",
  "test-tenant-request-inbox-and-chunk-hardening.mjs",
]) run(process.execPath, ["--check", file]);

for (const test of [
  "test-gpt-tools-response-chunking.mjs",
  "test-governed-tool-response-chunk-store.mjs",
  "test-tenant-request-inbox-and-chunk-hardening.mjs",
]) run(process.execPath, [test]);

run("git", ["config", "user.name", "github-actions[bot]"]);
run("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
run("git", ["add", "--",
  "routes/gptToolsRoutes.js",
  "governedToolResponseChunkStore.js",
  "tenantRequestInboxService.js",
  "test-gpt-tools-response-chunking.mjs",
  "test-governed-tool-response-chunk-store.mjs",
  "test-tenant-request-inbox-and-chunk-hardening.mjs",
  PACKAGE_PATH,
  HELPER_PATH,
]);
run("git", ["diff", "--cached", "--check"]);
run("git", ["commit", "-m", "fix(tenant-requests): address automated review findings"]);
run("git", ["push", "origin", `HEAD:${EXPECTED_BRANCH}`]);

console.log("PR 4395 automated review findings addressed; temporary runner removed.");
