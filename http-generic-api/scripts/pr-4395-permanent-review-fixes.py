from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    file_path = Path(path)
    source = file_path.read_text()
    count = source.count(before)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}")
    file_path.write_text(source.replace(before, after))


replace_once(
    "routes/systemLayerRoutes.js",
    '''      response_options: {
        max_chars: Number(responseOptions.max_chars || source?.max_chars || 45000),
        cursor: Number(responseOptions.cursor || source?.cursor || 0),
        chunk_ttl_ms: Number(responseOptions.chunk_ttl_ms || source?.chunk_ttl_ms || 0) || undefined,
        chunk_ttl_minutes: Number(responseOptions.chunk_ttl_minutes || source?.chunk_ttl_minutes || 0) || undefined,
      },''',
    '''      response_options: {
        max_chars: Number(responseOptions.max_chars || source?.max_chars || 45000),
        client_response_budget_chars: Number(
          responseOptions.client_response_budget_chars
          || source?.client_response_budget_chars
          || 0,
        ) || undefined,
        response_envelope_overhead_chars: Number(
          responseOptions.response_envelope_overhead_chars
          || source?.response_envelope_overhead_chars
          || 0,
        ) || undefined,
        cursor: Number(responseOptions.cursor || source?.cursor || 0),
        chunk_ttl_ms: Number(responseOptions.chunk_ttl_ms || source?.chunk_ttl_ms || 0) || undefined,
        chunk_ttl_minutes: Number(responseOptions.chunk_ttl_minutes || source?.chunk_ttl_minutes || 0) || undefined,
      },''',
)

replace_once(
    "routes/systemLayerRoutes.js",
    '''  router.get("/admin/system/tools", ...adminOnly, async (req, res) => {
    const body = await buildSystemToolsListResponse(req.auth, req.query || {});
    return res.status(200).json(await chunkSystemLayerResponse(
      body,
      req.query || {},
      req.auth,
      "admin_system_tools_list",
      "admin_system_tools_list",
    ));
  });''',
    '''  router.get("/admin/system/tools", ...adminOnly, async (req, res) => {
    try {
      const body = await buildSystemToolsListResponse(req.auth, req.query || {});
      return res.status(200).json(await chunkSystemLayerResponse(
        body,
        req.query || {},
        req.auth,
        "admin_system_tools_list",
        "admin_system_tools_list",
      ));
    } catch (error) {
      return sendSystemToolCatalogError(res, error, "system_tool_catalog_list_failed");
    }
  });''',
)

replace_once(
    "test-platform-routes.mjs",
    '''section("Admin system layer connector facade");

{
  const r = await get("/admin/system/tools");
  ok("system tools returns 200", r.status === 200, `got ${r.status}`);
  ok("system tools exposes passive endpoint preview", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "runtime_endpoint_preview"));''',
    '''section("Admin system layer connector facade");

{
  const degraded = await get("/admin/system/tools");
  ok("system tools returns controlled 503 when the default inline budget cannot contain the degraded response", degraded.status === 503, `got ${degraded.status}`);
  ok("system tools bounded failure is typed", degraded.body.error?.code === "response_chunk_persistence_unavailable_inline_limit_exceeded", JSON.stringify(degraded.body));
  ok("system tools bounded failure excludes secrets", degraded.body.secrets_included === false, JSON.stringify(degraded.body));

  const r = await get("/admin/system/tools?max_chars=150000&client_response_budget_chars=150000&response_envelope_overhead_chars=2000");
  ok("system tools returns 200 when the caller explicitly supplies a sufficient bounded response budget", r.status === 200, `got ${r.status}`);
  ok("system tools exposes passive endpoint preview", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "runtime_endpoint_preview"));''',
)

replace_once(
    "governedToolResponseChunkStore.js",
    '''    const present = new Set((rows || []).map((row) => text(row.column_name)).filter(Boolean));
    const missing = GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS.filter((column) => !present.has(column));''',
    '''    const present = new Set((rows || []).map((row) => text(row.column_name)).filter(Boolean));
    const requiredPresent = GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS.filter((column) => present.has(column));
    const missing = GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS.filter((column) => !present.has(column));''',
)
replace_once(
    "governedToolResponseChunkStore.js",
    "      present_column_count: present.size,",
    "      present_column_count: requiredPresent.length,",
)

replace_once(
    "routes/supportTicketRoutes.js",
    '''import {
  getTenantRequestInboxItem,
  listTenantRequestInbox,
} from "../tenantRequestInboxService.js";

const JWT_SECRET''',
    '''import {
  getTenantRequestInboxItem,
  listTenantRequestInbox,
} from "../tenantRequestInboxService.js";
import { createUserJwtMiddleware } from "../userJwtAuth.js";

const JWT_SECRET''',
)
replace_once(
    "routes/supportTicketRoutes.js",
    '''  const router = Router();
  const adminGuards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);''',
    '''  const router = Router();
  const adminGuards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);
  const tenantRequestUserJwt = deps.requireTenantRequestUserJwt
    || createUserJwtMiddleware({ env: deps.env || process.env });''',
)
replace_once(
    "routes/supportTicketRoutes.js",
    '  router.get("/tenants/:tenantId/requests", requireUserJwt, async (req, res) => {',
    '  router.get("/tenants/:tenantId/requests", tenantRequestUserJwt, async (req, res) => {',
)
replace_once(
    "routes/supportTicketRoutes.js",
    '  router.get("/tenants/:tenantId/requests/:ticketId", requireUserJwt, async (req, res) => {',
    '  router.get("/tenants/:tenantId/requests/:ticketId", tenantRequestUserJwt, async (req, res) => {',
)

replace_once(
    "tenantRequestInboxService.js",
    "function readbackRow(row = {}, isAdmin = false) {",
    '''export function compareTenantRequestTimelineEvents(left = {}, right = {}) {
  const timestamp = (value) => {
    if (value === null || value === undefined || value === "") return Number.NEGATIVE_INFINITY;
    const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  const delta = timestamp(left.createdAt) - timestamp(right.createdAt);
  if (delta != 0) return delta;
  const sourceDelta = String(left.source || "").localeCompare(String(right.source || ""));
  if (sourceDelta != 0) return sourceDelta;
  return String(left.eventId || left.readbackId || "").localeCompare(String(right.eventId || right.readbackId || ""));
}

function readbackRow(row = {}, isAdmin = false) {''',
)
replace_once(
    "tenantRequestInboxService.js",
    '].sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));',
    '].sort(compareTenantRequestTimelineEvents);',
)

replace_once(
    "test-tenant-request-inbox-and-chunk-hardening.mjs",
    '''  canViewTenantAdminTicketEvents,
  decodeTenantRequestCursor,''',
    '''  canViewTenantAdminTicketEvents,
  compareTenantRequestTimelineEvents,
  decodeTenantRequestCursor,''',
)
replace_once(
    "test-tenant-request-inbox-and-chunk-hardening.mjs",
    '''assert.equal(canViewTenantAdminTicketEvents({ isAdmin: true, role: "member" }), true);

function fakePool''',
    '''assert.equal(canViewTenantAdminTicketEvents({ isAdmin: true, role: "member" }), true);
const timelineDates = [
  { source: "ticket", eventId: "august", createdAt: new Date("2026-08-01T01:00:00.000Z") },
  { source: "ticket", eventId: "july", createdAt: new Date("2026-07-31T23:00:00.000Z") },
].sort(compareTenantRequestTimelineEvents);
assert.deepEqual(timelineDates.map((item) => item.eventId), ["july", "august"], "timeline Date objects must sort by epoch time rather than weekday text");

function fakePool''',
)
replace_once(
    "test-tenant-request-inbox-and-chunk-hardening.mjs",
    '''assert.equal(schema.ready, false);
assert.deepEqual(schema.missing_columns, ["owner_workspace_id"]);''',
    '''assert.equal(schema.ready, false);
assert.equal(schema.present_column_count, GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS.length - 1, "schema diagnostics must count required columns only");
assert.deepEqual(schema.missing_columns, ["owner_workspace_id"]);''',
)
replace_once(
    "test-tenant-request-inbox-and-chunk-hardening.mjs",
    '''for (const route of [
  "/admin/tenant-requests",
  "/admin/tenant-requests/:ticketId",
  "/tenants/:tenantId/requests",
  "/tenants/:tenantId/requests/:ticketId",
]) assert(routes.includes(route), `missing tenant request route ${route}`);''',
    '''for (const route of [
  "/admin/tenant-requests",
  "/admin/tenant-requests/:ticketId",
  "/tenants/:tenantId/requests",
  "/tenants/:tenantId/requests/:ticketId",
]) assert(routes.includes(route), `missing tenant request route ${route}`);
assert.match(routes, /createUserJwtMiddleware/u, "tenant inbox routes must use the central fail-closed User JWT middleware");
assert.match(routes, /router\.get\("\\/tenants\\/:tenantId\\/requests", tenantRequestUserJwt/u);
assert.match(routes, /router\.get\("\\/tenants\\/:tenantId\\/requests\\/:ticketId", tenantRequestUserJwt/u);''',
)
