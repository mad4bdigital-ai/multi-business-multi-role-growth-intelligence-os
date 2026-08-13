import assert from "node:assert/strict";

function deniedError(table) {
  const error = new Error(`INSERT command denied to user for table '${table}'`);
  error.code = "ER_TABLEACCESS_DENIED_ERROR";
  error.errno = 1142;
  error.sqlState = "42000";
  return error;
}

function runtimeConfigRows() {
  return [[
    {
      config_key: "dynamic_audit_scheduler",
      config_json: JSON.stringify({ enabled: true, run_on_startup: false, cadence_minutes: 5 }),
      status: "active",
    },
    {
      config_key: "dynamic_audit_checkpoint_scope",
      config_json: JSON.stringify({}),
      status: "active",
    },
    {
      config_key: "audit_log_event_bus_bridge_schedule",
      config_json: JSON.stringify({ enabled: true }),
      status: "active",
    },
    {
      config_key: "audit_event_rollup_builder_schedule",
      config_json: JSON.stringify({ enabled: true }),
      status: "active",
    },
  ], []];
}

function createDynamicAuditCyclePool() {
  let connectionCount = 0;
  const connection = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM platform_runtime_config")) return runtimeConfigRows();
      if (text.includes("FROM information_schema.tables")) return [[{ count: 1 }], []];
      if (text.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
      if (text.includes("INSERT INTO dynamic_audit_scheduler_runs")) throw deniedError("dynamic_audit_scheduler_runs");
      if (text.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
      throw new Error(`Unexpected SQL in cycle fixture: ${text.slice(0, 120)}`);
    },
    release() {},
  };
  return {
    get connectionCount() { return connectionCount; },
    async getConnection() {
      connectionCount += 1;
      return connection;
    },
  };
}

function createDynamicAuditStartupPool() {
  let connectionCount = 0;
  let probeRollbackCount = 0;
  const connection = {
    async beginTransaction() {},
    async rollback() { probeRollbackCount += 1; },
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM platform_runtime_config")) return runtimeConfigRows();
      if (text.includes("FROM information_schema.tables")) return [[{ count: 1 }], []];
      if (text.includes("INSERT INTO dynamic_audit_scheduler_runs")) throw deniedError("dynamic_audit_scheduler_runs");
      throw new Error(`Unexpected SQL in startup fixture: ${text.slice(0, 120)}`);
    },
    release() {},
  };
  return {
    get connectionCount() { return connectionCount; },
    get probeRollbackCount() { return probeRollbackCount; },
    async getConnection() {
      connectionCount += 1;
      return connection;
    },
  };
}

function createOpenApiDeniedPool() {
  let actionInsertCount = 0;
  const connection = {
    async beginTransaction() {},
    async rollback() {},
    async commit() {},
    async query(sql) {
      const text = String(sql);
      if (text.includes("GET_LOCK")) return [[{ lock_acquired: 1 }], []];
      if (text.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
      if (text.includes("INSERT INTO actions")) {
        actionInsertCount += 1;
        throw deniedError("actions");
      }
      if (text.includes("INSERT INTO openapi_endpoint_inventory_sync_runs")) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected SQL in OpenAPI fixture: ${text.slice(0, 120)}`);
    },
    release() {},
  };
  return {
    get actionInsertCount() { return actionInsertCount; },
    async getConnection() { return connection; },
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM platform_runtime_config")) {
        return [[{
          config_key: "openapi_endpoint_inventory_sync",
          config_json: JSON.stringify({ enabled: true, startup_apply: true }),
          status: "active",
        }], []];
      }
      if (text.includes("SELECT * FROM endpoints")) return [[], []];
      if (text.includes("INSERT INTO openapi_endpoint_inventory_sync_runs")) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected pool SQL in OpenAPI fixture: ${text.slice(0, 120)}`);
    },
  };
}

const originalNodeEnv = process.env.NODE_ENV;
const originalConsoleError = console.error;
const loggedErrors = [];
console.error = (...args) => loggedErrors.push(args.join(" "));
try {
  process.env.NODE_ENV = "production";

  const startupPool = createDynamicAuditStartupPool();
  const dynamicAuditStartup = await import(`./dynamicAuditRuntime.js?startup-write-authority=${Date.now()}`);
  const firstStart = await dynamicAuditStartup.startDynamicAuditScheduler({ pool: startupPool });
  assert.equal(firstStart.started, false);
  assert.equal(firstStart.reason, "write_authority_unavailable");
  assert.equal(firstStart.write_authority_unavailable, true);
  assert.equal(startupPool.probeRollbackCount, 1, "the failed probe must rollback its transaction");
  const secondStart = await dynamicAuditStartup.startDynamicAuditScheduler({ pool: startupPool });
  assert.equal(secondStart.started, false);
  assert.equal(secondStart.reason, "write_authority_unavailable");
  assert.equal(startupPool.connectionCount, 1, "a denied startup must not retry on the next scheduler interval");

  const cyclePool = createDynamicAuditCyclePool();
  const dynamicAuditCycle = await import(`./dynamicAuditRuntime.js?cycle-write-authority=${Date.now()}`);
  const cycle = await dynamicAuditCycle.runDynamicAuditCycle({ mode: "scheduled" }, { pool: cyclePool });
  assert.equal(cycle.ok, false);
  assert.equal(cycle.skipped, true);
  assert.equal(cycle.reason, "write_authority_unavailable");
  assert.equal(cycle.write_authority_unavailable, true);
  const cycleRetry = await dynamicAuditCycle.runDynamicAuditCycle({ mode: "scheduled" }, { pool: cyclePool });
  assert.equal(cycleRetry.ok, false);
  assert.equal(cycleRetry.skipped, true);
  assert.equal(cycleRetry.reason, "write_authority_unavailable");
  assert.equal(cyclePool.connectionCount, 1, "a denied cycle must short-circuit later cycles");

  const openApiPool = createOpenApiDeniedPool();
  const openApi = await import(`./openApiEndpointInventorySync.js?write-authority=${Date.now()}`);
  const degraded = await openApi.startOpenApiEndpointInventorySync({ pool: openApiPool });
  assert.equal(degraded.ok, true);
  assert.equal(degraded.started, false);
  assert.equal(degraded.status, "write_authority_unavailable");
  assert.equal(degraded.reason, "write_authority_unavailable");
  assert.equal(degraded.write_authority_unavailable, true);
  assert.equal(degraded.secrets_included, false);
  const degradedAgain = await openApi.startOpenApiEndpointInventorySync({ pool: openApiPool });
  assert.equal(degradedAgain.status, "write_authority_unavailable");
  assert.equal(openApiPool.actionInsertCount, 2, "startup caller owns retry policy; this module logs the degradation once");

  const authorityLogs = loggedErrors.filter((line) => line.includes("write_authority_unavailable"));
  assert.equal(authorityLogs.length, 3, "one dynamic startup, one dynamic cycle, and one OpenAPI warning are expected");
  assert.equal(loggedErrors.some((line) => line.includes("stack")), false);
  assert.equal(loggedErrors.every((line) => line.includes("secrets_included") && line.includes("false")), true);
  console.log("Production write-authority degradation tests passed");
} finally {
  console.error = originalConsoleError;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}
