from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "routes" / "tenantInfrastructureRoutes.js"
source = PATH.read_text(encoding="utf-8")

old_pool = '  const pool = deps.pool || { query: (...args) => getPool().query(...args) };'
new_pool = '  const pool = deps.pool || getPool();'
if old_pool in source:
    source = source.replace(old_pool, new_pool, 1)
elif new_pool not in source:
    raise SystemExit("tenant_infrastructure_pool_marker_missing")


def replace_between(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}:start_marker_missing")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}:end_marker_missing")
    return text[:start] + replacement.rstrip() + "\n\n" + text[end:]


def dedupe_approval_routes(text: str) -> str:
    status_marker = '  router.get("/me/infrastructure/ssh/cli/approval-requests/:request_id", requireUserJwt'
    decision_marker = '  router.post("/me/infrastructure/ssh/cli/approval-requests/:request_id/decision", requireUserJwt'
    status_positions = [i for i in range(len(text)) if text.startswith(status_marker, i)]
    decision_positions = [i for i in range(len(text)) if text.startswith(decision_marker, i)]
    if len(status_positions) == 2 and len(decision_positions) == 2:
        second_start = status_positions[1]
        next_route = text.find('  router.post("/me/infrastructure/ssh/connections/:connection_id/cli/execute", requireUserJwt', second_start)
        if next_route < 0:
            raise SystemExit("ssh_approval_duplicate_end_marker_missing")
        text = text[:second_start] + text[next_route:]
    elif len(status_positions) != 1 or len(decision_positions) != 1:
        raise SystemExit(f"ssh_approval_route_counts_invalid:status={len(status_positions)}:decision={len(decision_positions)}")
    return text


source = dedupe_approval_routes(source)

transaction_helper_marker = 'function normalizeDecisionNote(value) {\n  return String(value || "").trim().slice(0, 512);\n}'
transaction_helper = '''function normalizeDecisionNote(value) {
  return String(value || "").trim().slice(0, 512);
}

async function withInfrastructureTransaction(pool, work) {
  const connection = pool && typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const transactional = connection && typeof connection.beginTransaction === "function";
  try {
    if (transactional) await connection.beginTransaction();
    const result = await work(connection);
    if (transactional) await connection.commit();
    return result;
  } catch (cause) {
    if (transactional && typeof connection.rollback === "function") await connection.rollback();
    throw cause;
  } finally {
    if (connection !== pool && typeof connection?.release === "function") connection.release();
  }
}'''
if "async function withInfrastructureTransaction(" not in source:
    if transaction_helper_marker not in source:
        raise SystemExit("infrastructure_transaction_helper_marker_missing")
    source = source.replace(transaction_helper_marker, transaction_helper, 1)

decide = '''async function decideSshCliApprovalRequest(pool, req, requestId, body = {}) {
  return withInfrastructureTransaction(pool, async (connection) => { // MUTATION_TRANSACTION: tenant_ssh_cli_approval_request_decide
    const row = await loadSshCliApprovalRequest(connection, req, requestId);
    await assertWorkspaceApprovalRole(connection, req);
    if (row.status !== "open" || row.hold_status !== "open") {
      const err = new Error("Approval request is not open.");
      err.status = 409;
      err.code = "approval_request_not_open";
      throw err;
    }
    const decision = normalizeApprovalDecision(body.decision);
    const note = normalizeDecisionNote(body.decision_note);
    const [requestResult] = await connection.query(
      `UPDATE tenant_ssh_cli_approval_requests
          SET status = ?, decision_by = ?, decision_note = ?, decided_at = CURRENT_TIMESTAMP
        WHERE request_id = ? AND tenant_id = ? AND status = 'open'`,
      [decision, req.auth.user_id, note || null, requestId, req.auth.tenant_id]
    );
    if (requestResult.affectedRows !== 1) throw Object.assign(new Error("Approval request decision changed concurrently."), { status: 409, code: "approval_request_state_changed" });
    const [holdResult] = await connection.query(
      `UPDATE approval_holds
          SET status = ?, decision_by = ?, decision_note = ?, decided_at = CURRENT_TIMESTAMP
        WHERE hold_id COLLATE utf8mb4_unicode_ci = ? AND tenant_id COLLATE utf8mb4_unicode_ci = ? AND status = 'open'`,
      [decision, req.auth.user_id, note || null, row.hold_id, req.auth.tenant_id]
    );
    if (holdResult.affectedRows !== 1) throw Object.assign(new Error("Approval hold decision changed concurrently."), { status: 409, code: "approval_hold_state_changed" });
    const readback = sanitizeApprovalRequest(await loadSshCliApprovalRequest(connection, req, requestId)); // MUTATION_READBACK: tenant_ssh_cli_approval_request_decide
    if (readback.status !== decision || readback.hold_status !== decision || readback.decision_by !== req.auth.user_id) throw Object.assign(new Error("Approval decision readback did not match the requested state."), { status: 409, code: "approval_request_decision_readback_mismatch" });
    return readback;
  });
}'''
source = replace_between(source, 'async function decideSshCliApprovalRequest(', 'async function createSshCliApprovalRequest(', decide, "ssh_approval_decision")

create = '''async function createSshCliApprovalRequest(pool, req, row, plan) {
  return withInfrastructureTransaction(pool, async (connection) => { // MUTATION_TRANSACTION: tenant_ssh_cli_approval_request_create
    const requestId = randomUUID();
    const holdId = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const executionContextJson = JSON.stringify({
      source: "tenant_infrastructure_routes",
      parent_table: "tenant_ssh_cli_approval_requests",
      request_id: requestId,
      hold_id: holdId,
      connection_id: row.connection_id,
      command_key: plan.command_key,
      relationship_status: "resolved_parent_reference",
      secrets_included: false,
    });
    await connection.query(
      `INSERT INTO tenant_ssh_cli_approval_requests
         (request_id, hold_id, tenant_id, user_id, connection_id, command_key, command_argv_json, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [requestId, holdId, req.auth.tenant_id, req.auth.user_id, row.connection_id, plan.command_key, JSON.stringify(plan.argv), expiresAt]
    );
    await connection.query(
      `INSERT INTO approval_holds
         (hold_id, run_id, tenant_id, user_id, actor_id, actor_type,
          request_id, correlation_id, execution_context_json,
          hold_type, requested_by, required_role, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'supervisor_approval', ?, 'workspace_owner', 'open', ?)`,
      [holdId, requestId, req.auth.tenant_id, req.auth.user_id, req.auth.user_id, req.auth.user_id ? "user" : "system", requestId, requestId, executionContextJson, req.auth.user_id, expiresAt]
    );
    const readback = sanitizeApprovalRequest(await loadSshCliApprovalRequest(connection, req, requestId)); // MUTATION_READBACK: tenant_ssh_cli_approval_request_create
    if (readback.request_id !== requestId || readback.hold_id !== holdId || readback.status !== "open" || readback.hold_status !== "open") throw Object.assign(new Error("Approval request creation readback did not resolve the persisted request and hold."), { status: 409, code: "approval_request_create_readback_mismatch" });
    return {
      ...readback,
      command_argv: plan.argv,
      execution_enabled: false,
      next_step: "approval_decision_required_before_execute",
      secrets_included: false,
    };
  });
}'''
source = replace_between(source, 'async function createSshCliApprovalRequest(', 'async function probeSshTcpBanner(', create, "ssh_approval_create")

status_marker = '  router.get("/me/infrastructure/ssh/cli/approval-requests/:request_id", requireUserJwt'
decision_marker = '  router.post("/me/infrastructure/ssh/cli/approval-requests/:request_id/decision", requireUserJwt'
if source.count(status_marker) != 1 or source.count(decision_marker) != 1:
    raise SystemExit(f"ssh_approval_route_dedup_failed:status={source.count(status_marker)}:decision={source.count(decision_marker)}")

PATH.write_text(source, encoding="utf-8")
print("tenant infrastructure approval atomicity and route dedup patches applied")
