from pathlib import Path

service_path = Path("tenantRequestInboxService.js")
source = service_path.read_text()
start = source.index("export async function listTenantRequestInbox")
end = source.index("\nfunction tenantVisibleTicketEvent", start)
replacement = r'''function inboxFilterSql(filters = {}, scope = {}, ticketAlias = "t", caseAlias = "c") {
  const conditions = ["1=1"];
  const params = [];
  if (scope.tenantId) { conditions.push(`${ticketAlias}.tenant_id = ?`); params.push(scope.tenantId); }
  if (filters.status) { conditions.push(`${ticketAlias}.status = ?`); params.push(text(filters.status)); }
  if (filters.case_status) { conditions.push(`${caseAlias}.status = ?`); params.push(text(filters.case_status)); }
  if (filters.priority) { conditions.push(`${ticketAlias}.priority = ?`); params.push(text(filters.priority)); }
  const search = text(filters.search);
  if (search) {
    const like = `%${search.slice(0, 191)}%`;
    conditions.push(`(${ticketAlias}.ticket_id = ? OR ${caseAlias}.case_id = ? OR ${ticketAlias}.tenant_id = ? OR ${caseAlias}.resource_ref LIKE ? OR ${ticketAlias}.title LIKE ?)`);
    params.push(search, search, search, like, like);
  }
  return { conditions, params, search };
}

function candidateCaseJoinSql(hasTicketId) {
  const relation = hasTicketId
    ? `(candidate_case.ticket_id = t.ticket_id OR (candidate_case.ticket_id IS NULL AND candidate_case.resource_ref = CONCAT('ticket://', t.ticket_id)))`
    : `candidate_case.resource_ref = CONCAT('ticket://', t.ticket_id)`;
  const newerRelation = hasTicketId
    ? `(candidate_case_newer.ticket_id = t.ticket_id OR (candidate_case_newer.ticket_id IS NULL AND candidate_case_newer.resource_ref = CONCAT('ticket://', t.ticket_id)))`
    : `candidate_case_newer.resource_ref = CONCAT('ticket://', t.ticket_id)`;
  return `LEFT JOIN tenant_resolution_cases candidate_case
    ON candidate_case.tenant_id = t.tenant_id
   AND ${relation}
  LEFT JOIN tenant_resolution_cases candidate_case_newer
    ON candidate_case_newer.tenant_id = t.tenant_id
   AND ${newerRelation}
   AND (
     COALESCE(candidate_case_newer.updated_at, candidate_case_newer.created_at) > COALESCE(candidate_case.updated_at, candidate_case.created_at)
     OR (
       COALESCE(candidate_case_newer.updated_at, candidate_case_newer.created_at) = COALESCE(candidate_case.updated_at, candidate_case.created_at)
       AND candidate_case_newer.id > candidate_case.id
     )
   )`;
}

function boundedCandidateWindow(limit) {
  return Math.min(Math.max((Number(limit) + 1) * 8, 200), 1000);
}

export async function listTenantRequestInbox(filters = {}, options = {}) {
  const pool = options.pool || getPool();
  const scope = await authorizeTenantRequestScope({ auth: options.auth || {}, tenantId: filters.tenant_id, pool });
  const hasTicketId = await hasResolutionTicketIdColumn(pool);
  const limit = boundedLimit(filters.limit);
  const cursor = decodeTenantRequestCursor(filters.cursor);
  const candidateLimit = boundedCandidateWindow(limit);
  const candidateJoin = candidateCaseJoinSql(hasTicketId);
  const candidateParams = [];

  const candidateBranch = ({ activitySql, extraJoin = "", extraCondition = "" }) => {
    const branch = inboxFilterSql(filters, scope, "t", "candidate_case");
    branch.conditions.push("candidate_case_newer.id IS NULL");
    if (extraCondition) branch.conditions.push(extraCondition);
    let having = "";
    if (cursor) {
      having = `HAVING (MAX(${activitySql}) < ? OR (MAX(${activitySql}) = ? AND t.ticket_id < ?))`;
      branch.params.push(cursor.latestActivityAt, cursor.latestActivityAt, cursor.ticketId);
    }
    candidateParams.push(...branch.params);
    return `(SELECT t.ticket_id, MAX(${activitySql}) AS activity_at
       FROM tickets t
       ${candidateJoin}
       ${extraJoin}
      WHERE ${branch.conditions.join(" AND ")}
      GROUP BY t.ticket_id
      ${having}
      ORDER BY activity_at DESC, t.ticket_id DESC
      LIMIT ${candidateLimit})`;
  };

  const ticketEventVisibility = ticketEventVisibilitySql(scope, "tle").replace(/^AND\s+/u, "");
  const candidateSources = [
    candidateBranch({ activitySql: "COALESCE(t.last_seen_at, t.updated_at, t.created_at)" }),
    candidateBranch({
      activitySql: "tle.created_at",
      extraJoin: "JOIN ticket_lifecycle_events tle ON tle.tenant_id = t.tenant_id AND tle.ticket_id = t.ticket_id",
      extraCondition: ticketEventVisibility,
    }),
    candidateBranch({ activitySql: "COALESCE(candidate_case.updated_at, candidate_case.created_at)", extraCondition: "candidate_case.case_id IS NOT NULL" }),
    candidateBranch({
      activitySql: "trce.created_at",
      extraJoin: "JOIN tenant_resolution_case_events trce ON trce.case_id = candidate_case.case_id",
      extraCondition: "candidate_case.case_id IS NOT NULL",
    }),
    candidateBranch({
      activitySql: "trr.created_at",
      extraJoin: "JOIN tenant_resolution_readbacks trr ON trr.case_id = candidate_case.case_id",
      extraCondition: "candidate_case.case_id IS NOT NULL",
    }),
  ];

  const [candidateRows] = await pool.query(
    `SELECT candidate.ticket_id, MAX(candidate.activity_at) AS candidate_activity_at
       FROM (${candidateSources.join("\nUNION ALL\n")}) candidate
      GROUP BY candidate.ticket_id
      ORDER BY candidate_activity_at DESC, candidate.ticket_id DESC
      LIMIT ${candidateLimit}`,
    candidateParams,
  );
  const candidateTicketIds = [...new Set((candidateRows || []).map((row) => text(row.ticket_id)).filter(Boolean))];
  const normalized = inboxFilterSql(filters, scope);
  if (candidateTicketIds.length === 0) {
    return {
      items: [],
      page: { limit, hasMore: false, nextCursor: null },
      filters: {
        tenantId: scope.tenantId,
        status: filters.status || null,
        caseStatus: filters.case_status || null,
        priority: filters.priority || null,
        search: normalized.search || null,
      },
      schema: { explicitTicketCaseLinkAvailable: hasTicketId, candidateWindowLimit: candidateLimit },
      secretsIncluded: false,
    };
  }

  const conditions = [...normalized.conditions];
  const params = [...normalized.params];
  conditions.push(`t.ticket_id IN (${candidateTicketIds.map(() => "?").join(", ")})`);
  params.push(...candidateTicketIds);
  const activity = latestActivitySql("t", "c", ticketEventVisibilitySql(scope, "tle"));
  if (cursor) {
    conditions.push(`(${activity} < ? OR (${activity} = ? AND t.ticket_id < ?))`);
    params.push(cursor.latestActivityAt, cursor.latestActivityAt, cursor.ticketId);
  }
  params.push(limit + 1);
  const [rows] = await pool.query(
    `SELECT t.ticket_id, t.tenant_id, t.title, t.ticket_type, t.category,
            t.status AS ticket_status, t.priority, t.severity, t.occurrence_count,
            t.queue_key, t.assigned_to, t.customer_status, t.sla_status,
            t.first_response_due_at, t.triage_due_at, t.resolution_due_at,
            t.customer_message, t.metadata_json, t.last_seen_at,
            t.created_at AS ticket_created_at, t.updated_at AS ticket_updated_at,
            c.case_id, c.status AS case_status, c.severity AS case_severity,
            c.root_family, c.playbook_key, c.current_step_key, c.readback_status,
            c.owner_user_id, c.resource_ref, c.created_at AS case_created_at,
            c.updated_at AS case_updated_at,
            ${activity} AS latest_activity_at
       FROM tickets t
       ${caseJoinSql(hasTicketId)}
      WHERE ${conditions.join(" AND ")}
      ORDER BY latest_activity_at DESC, t.ticket_id DESC
      LIMIT ?`,
    params,
  );
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit);
  const last = selected[selected.length - 1] || null;
  return {
    items: selected.map(projectInboxRow),
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeTenantRequestCursor({ latestActivityAt: last.latest_activity_at, ticketId: last.ticket_id }) : null,
    },
    filters: {
      tenantId: scope.tenantId,
      status: filters.status || null,
      caseStatus: filters.case_status || null,
      priority: filters.priority || null,
      search: normalized.search || null,
    },
    schema: { explicitTicketCaseLinkAvailable: hasTicketId, candidateWindowLimit: candidateLimit },
    secretsIncluded: false,
  };
}
'''
service_path.write_text(source[:start] + replacement + source[end:])

test_path = Path("test-tenant-request-inbox-and-chunk-hardening.mjs")
test_source = test_path.read_text()
segment_start = test_source.index("const listPool = fakePool([")
segment_end = test_source.index("const list = await listTenantRequestInbox", segment_start)
segment = test_source[segment_start:segment_end]
needle = '''  {
    rows: [{ present: 1 }],
    assert(sql) { assert.match(sql, /information_schema\\.columns/u); },
  },
  {
    rows: [{'''
inserted = '''  {
    rows: [{ present: 1 }],
    assert(sql) { assert.match(sql, /information_schema\\.columns/u); },
  },
  {
    rows: [{ ticket_id: ticketId }],
    assert(sql, params) {
      assert.match(sql, /UNION ALL/u, "candidate discovery must combine bounded activity sources set-wise");
      assert.match(sql, /candidate_case_newer\\.id IS NULL/u, "candidate discovery must bind the latest case without a scalar lookup");
      assert.match(sql, /GROUP BY t\\.ticket_id/u, "each activity source must collapse to one candidate per ticket before final ranking");
      assert.match(sql, /LIMIT 408/u, "candidate discovery must use a bounded window derived from the page limit");
      assert.doesNotMatch(sql, /SELECT MAX\\(tle\\.created_at\\)[\\s\\S]*WHERE tle\\.ticket_id = t\\.ticket_id/u, "candidate discovery must not use per-ticket correlated event lookups");
      assert(params.length > 0);
    },
  },
  {
    rows: [{'''
if segment.count(needle) != 1:
    raise SystemExit(f"listPool schema-to-result boundary count={segment.count(needle)}")
segment = segment.replace(needle, inserted)
old_assert = '''      assert.match(sql, /c2\\.ticket_id = t\\.ticket_id/u);
      assert.match(sql, /ORDER BY latest_activity_at DESC, t\\.ticket_id DESC/u);'''
new_assert = '''      assert.match(sql, /c2\\.ticket_id = t\\.ticket_id/u);
      assert.match(sql, /t\\.ticket_id IN \\(\\?\\)/u, "exact latest-activity calculation must be restricted to bounded candidates");
      assert.match(sql, /ORDER BY latest_activity_at DESC, t\\.ticket_id DESC/u);'''
if segment.count(old_assert) != 1:
    raise SystemExit(f"listPool final assertion boundary count={segment.count(old_assert)}")
segment = segment.replace(old_assert, new_assert)
test_source = test_source[:segment_start] + segment + test_source[segment_end:]
index_assertion = '''assert.match(migration, /idx_resolution_cases_ticket_status_updated/u);'''
index_replacement = '''assert.match(migration, /idx_resolution_cases_ticket_status_updated/u);
assert.match(migration, /idx_ticket_lifecycle_inbox_activity/u);
assert.match(migration, /idx_resolution_case_events_inbox_activity/u);
assert.match(migration, /idx_resolution_readbacks_inbox_activity/u);'''
if test_source.count(index_assertion) != 1:
    raise SystemExit("migration index assertion boundary missing")
test_path.write_text(test_source.replace(index_assertion, index_replacement))

migration_path = Path("migrations/1041_sprint69_tenant_request_inbox_and_chunk_store_hardening.sql")
migration = migration_path.read_text()
marker = "-- Reconcile every runtime-referenced chunk ownership column."
indexes = r'''SET @ticket_lifecycle_inbox_activity_index_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE ticket_lifecycle_events ADD KEY idx_ticket_lifecycle_inbox_activity (tenant_id, visibility, ticket_id, created_at)'
    ELSE 'SELECT 1 AS ticket_lifecycle_inbox_activity_index_present' END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'ticket_lifecycle_events'
    AND index_name = 'idx_ticket_lifecycle_inbox_activity'
);
PREPARE ticket_lifecycle_inbox_activity_index_stmt FROM @ticket_lifecycle_inbox_activity_index_sql;
EXECUTE ticket_lifecycle_inbox_activity_index_stmt;
DEALLOCATE PREPARE ticket_lifecycle_inbox_activity_index_stmt;

SET @resolution_case_events_inbox_activity_index_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE tenant_resolution_case_events ADD KEY idx_resolution_case_events_inbox_activity (case_id, created_at)'
    ELSE 'SELECT 1 AS resolution_case_events_inbox_activity_index_present' END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'tenant_resolution_case_events'
    AND index_name = 'idx_resolution_case_events_inbox_activity'
);
PREPARE resolution_case_events_inbox_activity_index_stmt FROM @resolution_case_events_inbox_activity_index_sql;
EXECUTE resolution_case_events_inbox_activity_index_stmt;
DEALLOCATE PREPARE resolution_case_events_inbox_activity_index_stmt;

SET @resolution_readbacks_inbox_activity_index_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE tenant_resolution_readbacks ADD KEY idx_resolution_readbacks_inbox_activity (case_id, created_at)'
    ELSE 'SELECT 1 AS resolution_readbacks_inbox_activity_index_present' END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'tenant_resolution_readbacks'
    AND index_name = 'idx_resolution_readbacks_inbox_activity'
);
PREPARE resolution_readbacks_inbox_activity_index_stmt FROM @resolution_readbacks_inbox_activity_index_sql;
EXECUTE resolution_readbacks_inbox_activity_index_stmt;
DEALLOCATE PREPARE resolution_readbacks_inbox_activity_index_stmt;

'''
if migration.count(marker) != 1:
    raise SystemExit("migration insertion marker missing")
migration_path.write_text(migration.replace(marker, indexes + marker))
