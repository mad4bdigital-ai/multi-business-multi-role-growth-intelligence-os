import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const systemLayerRoutes = readFileSync("routes/systemLayerRoutes.js", "utf8");
const gptToolsRoutes = readFileSync("routes/gptToolsRoutes.js", "utf8");
const connectRoutes = readFileSync("routes/connectRoutes.js", "utf8");
const tenantMigration = readFileSync("migrations/100_sprint63_onboarding_recovery_control_plane.sql", "utf8");
const tenantInstructions = readFileSync("../GPT_Tenant_Connector_Instructions.md", "utf8");
const tenantKnowledge = readFileSync("../GPT_Tenant_Connector_Knowledge.md", "utf8");
const tenantSchema = readFileSync("openapi/openapi.tenant-gpt.auth.yaml", "utf8");

assert(
  tenantMigration.includes("connect_escalate") && tenantMigration.includes("/connect/escalate"),
  "connect_escalate must be registered as a tenant endpoint tool"
);

assert(
  systemLayerRoutes.includes("callTenantEndpointRegistryToolIfAvailable(name, args, auth, deps)"),
  "system layer must dispatch non-local tenant tools through tenant registry facade"
);
assert(
  systemLayerRoutes.includes('dispatchToolForCaller("tenant", name, args, req)'),
  "tenant registry facade must call dispatchToolForCaller('tenant', ...)"
);
assert(
  systemLayerRoutes.includes('const req = deps.req || { auth, headers: deps.headers || {}, ip: deps.ip || null };'),
  "tenant registry facade must preserve request headers for user JWT forwarding"
);

assert(
  gptToolsRoutes.includes('headers.Authorization = req?.headers?.authorization || "";'),
  "internal tool dispatch must forward the tenant user JWT instead of requiring a backend key"
);
assert(
  gptToolsRoutes.includes('force_backend: effectiveCallerType === "admin"'),
  "internal tool dispatch must force backend auth only for admin/grant dispatches, not tenant tools"
);
assert(
  gptToolsRoutes.includes('fetch(url, fetchOpts)'),
  "tenant tool calls must execute through server-side internal fetch, not local connector/browser transport"
);

assert(
  connectRoutes.includes('router.post("/connect/escalate", requireUserJwt'),
  "connect_escalate route must require user JWT, not backend/admin credentials"
);
assert(
  connectRoutes.includes("createOnboardingEscalation")
    && connectRoutes.includes('import { createOrAppendSupportTicket } from "../supportTicketService.js";')
    && connectRoutes.includes("createOrAppendSupportTicket")
    && connectRoutes.includes("onboarding_escalations")
    && connectRoutes.includes("ticket_id"),
  "connect_escalate must create governed support ticket via the centralized service and preserve onboarding escalation records"
);
assert(
  connectRoutes.includes("metadata_json") && connectRoutes.includes("ticket_id"),
  "connect_escalate must preserve internal metadata in records, not in customer-facing text"
);

assert(
  tenantInstructions.includes("connect_escalate") && tenantInstructions.includes("do not show internal route/key/admin wording"),
  "Tenant GPT instructions must require customer-safe escalation without internal wording"
);
assert(
  tenantKnowledge.includes("connect_escalate") && tenantKnowledge.includes("support has been notified"),
  "Tenant GPT knowledge must include customer-safe escalation wording"
);
assert(
  tenantSchema.includes("/system/tools/call") && tenantSchema.includes("operationId: callTool"),
  "Tenant GPT schema must bind callTool to /system/tools/call"
);
assert(
  tenantSchema.includes("userBearerAuth") && !tenantSchema.includes("backendApiKeyAuth"),
  "Tenant GPT schema must expose user bearer auth, not backend API key auth"
);

console.log("tenant system call connect escalation tests passed");
