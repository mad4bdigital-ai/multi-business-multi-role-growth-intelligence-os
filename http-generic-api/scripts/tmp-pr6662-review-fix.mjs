import fs from 'node:fs';

const svcPath = 'http-generic-api/tenantRequestInboxService.js';
const testPath = 'http-generic-api/test-tenant-request-inbox-and-chunk-hardening.mjs';
const migPath = 'http-generic-api/migrations/20260808_tenant_request_identity_collation_alignment.sql';
const e2ePath = '.changes/e2e/tenant-request-identity-collation-repair.json';

function between(text, start, end, replacement, label) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || text.indexOf(start, a + 1) >= 0) throw new Error(`boundary_${label}`);
  return text.slice(0, a) + replacement + text.slice(b);
}
function replaceN(text, oldText, newText, expected, label) {
  const count = text.split(oldText).length - 1;
  if (count !== expected) throw new Error(`${label}_count_${count}`);
  return text.split(oldText).join(newText);
}

let svc = fs.readFileSync(svcPath, 'utf8');
svc = between(svc, 'const TENANT_REQUEST_IDENTITY_COLLATION', 'function text(', `const TENANT_REQUEST_ALLOWED_IDENTITY_COLLATIONS = new Set(["utf8mb4_unicode_ci", "utf8mb4_uca1400_ai_ci"]);

function requireTenantRequestIdentityCollation(value, field, { optional = false } = {}) {
  const collation = String(value ?? "").trim();
  if (!collation && optional) return null;
  if (!TENANT_REQUEST_ALLOWED_IDENTITY_COLLATIONS.has(collation)) {
    const error = new Error(collation
      ? \`Unsupported tenant request identity collation for \${field}: \${collation}.\`
      : \`Missing tenant request identity collation for \${field}.\`);
    error.status = 503;
    error.code = collation ? "tenant_request_identity_collation_unsupported" : "tenant_request_identity_schema_incomplete";
    throw error;
  }
  return collation;
}

function normalizeOuterTenantRequestIdentitySql(expression, collation) {
  const trustedCollation = requireTenantRequestIdentityCollation(collation, expression);
  return \`CONVERT(\${expression} USING utf8mb4) COLLATE \${trustedCollation}\`;
}

function indexedTenantRequestIdentityEqualsSql(indexedExpression, outerExpression, collation) {
  return \`\${indexedExpression} = \${normalizeOuterTenantRequestIdentitySql(outerExpression, collation)}\`;
}

`,'identity_helpers');

svc = between(svc, 'async function hasResolutionTicketIdColumn', 'async function authorizeTenantRequestScope', `async function inspectTenantRequestIdentitySchema(pool) {
  const [rows] = await pool.query(
    \`SELECT table_name, column_name, collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND ((table_name = 'tenant_resolution_cases' AND column_name IN ('tenant_id','ticket_id','resource_ref'))
          OR (table_name = 'ticket_lifecycle_events' AND column_name IN ('tenant_id','ticket_id')))\`
  );
  const byColumn = new Map((rows || []).map((row) => [\`\${row.table_name}.\${row.column_name}\`, row.collation_name]));
  const read = (table, column, optional = false) => {
    const key = \`\${table}.\${column}\`;
    return requireTenantRequestIdentityCollation(byColumn.get(key), key, { optional });
  };
  const resolutionTicketId = read("tenant_resolution_cases", "ticket_id", true);
  return {
    hasResolutionTicketId: Boolean(resolutionTicketId),
    lifecycle: {
      tenantId: read("ticket_lifecycle_events", "tenant_id"),
      ticketId: read("ticket_lifecycle_events", "ticket_id"),
    },
    resolution: {
      tenantId: read("tenant_resolution_cases", "tenant_id"),
      ticketId: resolutionTicketId,
      resourceRef: read("tenant_resolution_cases", "resource_ref"),
    },
  };
}

`,'schema_inspector');

svc = between(svc, 'function latestActivitySql', 'function caseJoinSql', `function latestActivitySql(alias = "t", caseAlias = "c", ticketEventVisibility = "", identitySchema = {}) {
  const ticketFallback = \`COALESCE(\${alias}.last_seen_at, \${alias}.updated_at, \${alias}.created_at)\`;
  const lifecycleTenantIdentity = indexedTenantRequestIdentityEqualsSql("tle.tenant_id", \`\${alias}.tenant_id\`, identitySchema.lifecycle.tenantId);
  const lifecycleTicketIdentity = indexedTenantRequestIdentityEqualsSql("tle.ticket_id", \`\${alias}.ticket_id\`, identitySchema.lifecycle.ticketId);
  return \`GREATEST(
    \${ticketFallback},
    COALESCE(\${caseAlias}.updated_at, \${ticketFallback}),
    COALESCE((
      SELECT MAX(tle.created_at)
        FROM ticket_lifecycle_events tle
       WHERE \${lifecycleTenantIdentity}
         AND \${lifecycleTicketIdentity}
         \${ticketEventVisibility}
    ), \${ticketFallback}),
    COALESCE((SELECT MAX(trce.created_at) FROM tenant_resolution_case_events trce WHERE trce.case_id = \${caseAlias}.case_id), \${ticketFallback}),
    COALESCE((SELECT MAX(trr.created_at) FROM tenant_resolution_readbacks trr WHERE trr.case_id = \${caseAlias}.case_id), \${ticketFallback})
  )\`;
}

`,'latest_activity');

svc = between(svc, 'function caseJoinSql', 'function projectTicket', `function caseJoinSql(hasTicketId, identitySchema) {
  const tenantIdentity = indexedTenantRequestIdentityEqualsSql("c2.tenant_id", "t.tenant_id", identitySchema.resolution.tenantId);
  const ticketIdentity = hasTicketId ? indexedTenantRequestIdentityEqualsSql("c2.ticket_id", "t.ticket_id", identitySchema.resolution.ticketId) : null;
  const resourceIdentity = indexedTenantRequestIdentityEqualsSql("c2.resource_ref", "CONCAT('ticket://', t.ticket_id)", identitySchema.resolution.resourceRef);
  const relation = hasTicketId ? \`(\${ticketIdentity} OR (c2.ticket_id IS NULL AND \${resourceIdentity}))\` : resourceIdentity;
  return \`LEFT JOIN tenant_resolution_cases c
    ON c.id = (
      SELECT c2.id
        FROM tenant_resolution_cases c2
       WHERE \${tenantIdentity}
         AND \${relation}
       ORDER BY c2.updated_at DESC, c2.id DESC
       LIMIT 1
    )\`;
}

`,'case_join');

svc = between(svc, 'function candidateCaseJoinSql', 'function boundedCandidateWindow', `function candidateCaseJoinSql(hasTicketId, identitySchema) {
  const tenantIdentity = indexedTenantRequestIdentityEqualsSql("candidate_case.tenant_id", "t.tenant_id", identitySchema.resolution.tenantId);
  const ticketIdentity = hasTicketId ? indexedTenantRequestIdentityEqualsSql("candidate_case.ticket_id", "t.ticket_id", identitySchema.resolution.ticketId) : null;
  const resourceIdentity = indexedTenantRequestIdentityEqualsSql("candidate_case.resource_ref", "CONCAT('ticket://', t.ticket_id)", identitySchema.resolution.resourceRef);
  const newerTenantIdentity = indexedTenantRequestIdentityEqualsSql("candidate_case_newer.tenant_id", "t.tenant_id", identitySchema.resolution.tenantId);
  const newerTicketIdentity = hasTicketId ? indexedTenantRequestIdentityEqualsSql("candidate_case_newer.ticket_id", "t.ticket_id", identitySchema.resolution.ticketId) : null;
  const newerResourceIdentity = indexedTenantRequestIdentityEqualsSql("candidate_case_newer.resource_ref", "CONCAT('ticket://', t.ticket_id)", identitySchema.resolution.resourceRef);
  const relation = hasTicketId ? \`(\${ticketIdentity} OR (candidate_case.ticket_id IS NULL AND \${resourceIdentity}))\` : resourceIdentity;
  const newerRelation = hasTicketId ? \`(\${newerTicketIdentity} OR (candidate_case_newer.ticket_id IS NULL AND \${newerResourceIdentity}))\` : newerResourceIdentity;
  return \`LEFT JOIN tenant_resolution_cases candidate_case
    ON \${tenantIdentity}
   AND \${relation}
  LEFT JOIN tenant_resolution_cases candidate_case_newer
    ON \${newerTenantIdentity}
   AND \${newerRelation}
   AND (
     COALESCE(candidate_case_newer.updated_at, candidate_case_newer.created_at) > COALESCE(candidate_case.updated_at, candidate_case.created_at)
     OR (COALESCE(candidate_case_newer.updated_at, candidate_case_newer.created_at) = COALESCE(candidate_case.updated_at, candidate_case.created_at) AND candidate_case_newer.id > candidate_case.id)
   )\`;
}

`,'candidate_join');

svc = replaceN(svc, 'const hasTicketId = await hasResolutionTicketIdColumn(pool);', 'const identitySchema = await inspectTenantRequestIdentitySchema(pool);\n  const hasTicketId = identitySchema.hasResolutionTicketId;', 2, 'schema_calls');
svc = replaceN(svc, 'const candidateJoin = candidateCaseJoinSql(hasTicketId);', 'const candidateJoin = candidateCaseJoinSql(hasTicketId, identitySchema);', 1, 'candidate_call');
svc = replaceN(svc, 'const activity = latestActivitySql("t", "c", ticketEventVisibilitySql(scope, "tle"));', 'const activity = latestActivitySql("t", "c", ticketEventVisibilitySql(scope, "tle"), identitySchema);', 2, 'activity_calls');
svc = replaceN(svc, '${caseJoinSql(hasTicketId)}', '${caseJoinSql(hasTicketId, identitySchema)}', 2, 'case_calls');
svc = replaceN(svc, 'extraJoin: `JOIN ticket_lifecycle_events tle ON ${tenantRequestIdentityEqualsSql("tle.tenant_id", "t.tenant_id")} AND ${tenantRequestIdentityEqualsSql("tle.ticket_id", "t.ticket_id")}`,', 'extraJoin: `JOIN ticket_lifecycle_events tle ON ${indexedTenantRequestIdentityEqualsSql("tle.tenant_id", "t.tenant_id", identitySchema.lifecycle.tenantId)} AND ${indexedTenantRequestIdentityEqualsSql("tle.ticket_id", "t.ticket_id", identitySchema.lifecycle.ticketId)}`,', 1, 'candidate_lifecycle');
fs.writeFileSync(svcPath, svc);

fs.writeFileSync(migPath, `-- Tenant request relational identity collation alignment.
-- Source incident: Spec 017 fixture readback run 31250853393 returned ER_CANT_AGGREGATE_2COLLATIONS.
-- ticket_lifecycle_events was canonically created by migration 233 with utf8mb4_uca1400_ai_ci.
-- tenant_resolution_cases was created with utf8mb4_unicode_ci, but tenant_id/ticket_id are relational ticket identity keys.
-- Runtime reads actual dependent-column collations and normalizes only outer expressions, so it remains compatible before and after this source-only migration.
-- No data deletion, provider call, credential access, Production mutation, or Migration Apply is performed by this source file.

ALTER TABLE \`ticket_lifecycle_events\`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

ALTER TABLE \`ticket_lifecycle_events\`
  MODIFY COLUMN \`ticket_id\` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN \`tenant_id\` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL;

ALTER TABLE \`tenant_resolution_cases\`
  MODIFY COLUMN \`tenant_id\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN \`ticket_id\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL;
`);

let test = fs.readFileSync(testPath, 'utf8');
test = replaceN(test, 'const lastSeenAt = "2026-07-29T05:34:19.000Z";', `const lastSeenAt = "2026-07-29T05:34:19.000Z";
const identitySchemaRows = [
  { table_name: "tenant_resolution_cases", column_name: "tenant_id", collation_name: "utf8mb4_unicode_ci" },
  { table_name: "tenant_resolution_cases", column_name: "ticket_id", collation_name: "utf8mb4_unicode_ci" },
  { table_name: "tenant_resolution_cases", column_name: "resource_ref", collation_name: "utf8mb4_unicode_ci" },
  { table_name: "ticket_lifecycle_events", column_name: "tenant_id", collation_name: "utf8mb4_uca1400_ai_ci" },
  { table_name: "ticket_lifecycle_events", column_name: "ticket_id", collation_name: "utf8mb4_uca1400_ai_ci" },
];`, 1, 'schema_fixture');
test = replaceN(test, 'rows: [{ present: 1 }],\n    assert(sql) { assert.match(sql, /information_schema\\.columns/u); },', 'rows: identitySchemaRows,\n    assert(sql) { assert.match(sql, /information_schema\\.columns/u); },', 1, 'list_schema_mock');
test = replaceN(test, '{ rows: [{ present: 1 }] },', '{ rows: identitySchemaRows },', 1, 'detail_schema_mock');
for (const [a,b] of [
  ['CONVERT(candidate_case.ticket_id USING utf8mb4) COLLATE utf8mb4_unicode_ci', 'candidate_case.ticket_id = CONVERT(t.ticket_id USING utf8mb4) COLLATE utf8mb4_unicode_ci'],
  ['CONVERT(candidate_case_newer.tenant_id USING utf8mb4) COLLATE utf8mb4_unicode_ci', 'candidate_case_newer.tenant_id = CONVERT(t.tenant_id USING utf8mb4) COLLATE utf8mb4_unicode_ci'],
  ['CONVERT(tle.ticket_id USING utf8mb4) COLLATE utf8mb4_unicode_ci', 'tle.ticket_id = CONVERT(t.ticket_id USING utf8mb4) COLLATE utf8mb4_uca1400_ai_ci'],
  ['CONVERT(c2.ticket_id USING utf8mb4) COLLATE utf8mb4_unicode_ci', 'c2.ticket_id = CONVERT(t.ticket_id USING utf8mb4) COLLATE utf8mb4_unicode_ci'],
  ['CONVERT(tle.tenant_id USING utf8mb4) COLLATE utf8mb4_unicode_ci', 'tle.tenant_id = CONVERT(t.tenant_id USING utf8mb4) COLLATE utf8mb4_uca1400_ai_ci'],
]) test = replaceN(test, a, b, 1, `assert_${a.slice(0,12)}`);
test = replaceN(test, 'assert.match(inboxService, /const TENANT_REQUEST_IDENTITY_COLLATION = "utf8mb4_unicode_ci";/u, "tenant request identity joins must pin the canonical compatibility collation");', `assert.match(inboxService, /TENANT_REQUEST_ALLOWED_IDENTITY_COLLATIONS/u, "tenant request identity joins must fail closed to repository-approved collations");
for (const indexedAlias of ["c2", "candidate_case", "candidate_case_newer", "tle"]) {
  assert.doesNotMatch(inboxService, new RegExp(\`CONVERT\\\\(\${indexedAlias}\\\\.\`), \`indexed identity alias \${indexedAlias} must remain bare for sargable lookup\`);
}`, 1, 'static_contract');
test = replaceN(test, 'assert.match(identityCollationMigration, /MODIFY COLUMN `ticket_id` VARCHAR\\(36\\) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL/u);', 'assert.match(identityCollationMigration, /MODIFY COLUMN `ticket_id` VARCHAR\\(36\\) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL/u);', 1, 'lifecycle_ticket_migration');
test = replaceN(test, 'assert.match(identityCollationMigration, /MODIFY COLUMN `tenant_id` VARCHAR\\(36\\) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL/u);', 'assert.match(identityCollationMigration, /MODIFY COLUMN `tenant_id` VARCHAR\\(36\\) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL/u);', 1, 'lifecycle_tenant_migration');
test = replaceN(test, 'assert.match(identityCollationMigration, /MODIFY COLUMN `resource_ref` VARCHAR\\(512\\) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL/u);\nassert.match(identityCollationMigration, /MODIFY COLUMN `ticket_id` CHAR\\(36\\) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL/u);', 'assert.match(identityCollationMigration, /MODIFY COLUMN `tenant_id` VARCHAR\\(64\\) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL/u);\nassert.match(identityCollationMigration, /MODIFY COLUMN `ticket_id` CHAR\\(36\\) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL/u);\nassert.doesNotMatch(identityCollationMigration, /MODIFY COLUMN `resource_ref`/u, "non-relational resource_ref must retain the resolution registry collation");', 1, 'resolution_migration');
fs.writeFileSync(testPath, test);

const e2e = JSON.parse(fs.readFileSync(e2ePath, 'utf8'));
const journey = e2e.phases[0].e2e_journeys[0];
journey.steps = [
  'Read actual utf8mb4 collations of indexed tenant-resolution and lifecycle identity columns from information_schema and reject unknown collations.',
  'Keep indexed dependent-table columns bare while converting only outer ticket expressions to the indexed column collation.',
  'Preserve bounded candidate discovery and latest-activity ordering.',
  'Restore ticket_lifecycle_events ticket/tenant identity to canonical utf8mb4_uca1400_ai_ci and align tenant_resolution_cases relational tenant_id/ticket_id keys to the same ticket-domain collation through a separately governed source migration.',
  'Leave tickets and non-relational tenant_resolution_cases resource_ref/default collation unchanged.'
];
journey.assertions = [
  'Indexed resolution-case and lifecycle identity columns are never wrapped in CONVERT/COLLATE in inbox joins.',
  'Outer ticket expressions are normalized to the actual indexed-column collation with an explicit two-collation fail-closed allowlist.',
  'The migration keeps ticket_lifecycle_events on utf8mb4_uca1400_ai_ci and aligns only tenant_resolution_cases tenant_id/ticket_id relational keys to that ticket-domain collation.',
  'The migration is source-only in this PR and does not alter tickets, tenant_resolution_cases resource_ref, or Production.'
];
fs.writeFileSync(e2ePath, JSON.stringify(e2e, null, 2) + '\n');
