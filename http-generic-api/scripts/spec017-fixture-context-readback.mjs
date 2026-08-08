import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const MUTATION_PERMISSION_RANK = Object.freeze({
  view: 1,
  comment: 2,
  edit: 3,
  operate: 4,
  manage: 5,
  admin: 6,
  owner: 7,
});

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`missing_required_env:${name}`);
  return value;
}

function safeIdentifier(value, label, max = 255) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max || !/^[A-Za-z0-9._:@/+\-]+$/u.test(normalized)) {
    throw new Error(`invalid_fixture_identifier:${label}`);
  }
  return normalized;
}

function assertSafeBaseUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "auth.mad4b.com" || url.username || url.password || url.search || url.hash) {
    throw new Error("unsafe_runtime_base_url");
  }
  return url.origin;
}

function collectNamedValues(value, acceptedKeys, output = new Set(), depth = 0) {
  if (depth > 7 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const child of value.slice(0, 200)) collectNamedValues(child, acceptedKeys, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value).slice(0, 200)) {
    if (acceptedKeys.has(key) && typeof child === "string" && child.trim()) output.add(child.trim());
    collectNamedValues(child, acceptedKeys, output, depth + 1);
  }
  return output;
}

function firstFailureCode(error) {
  const message = String(error?.message || error || "fixture_context_readback_failed");
  return message.split(":", 1)[0].slice(0, 128) || "fixture_context_readback_failed";
}

const runtimeBaseUrl = assertSafeBaseUrl(required("RUNTIME_BASE_URL"));
const backendApiKey = required("BACKEND_API_KEY");
const sourceSha = safeIdentifier(required("SOURCE_SHA"), "source_sha", 40);
const expectedProductionSha = safeIdentifier(required("EXPECTED_PRODUCTION_SHA"), "expected_production_sha", 40);
const parentTicketId = safeIdentifier(required("SPEC017_FIXTURE_PARENT_TICKET_ID"), "parent_ticket_id", 128);
const evidencePath = String(process.env.SPEC017_FIXTURE_EVIDENCE_PATH || "artifacts/spec017-fixture-context-readback.json").trim();

let tenantToken = "";

async function api(path, { method = "GET", auth = "admin", body = undefined, expected = [200] } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth === "admin") headers["x-api-key"] = backendApiKey;
  if (auth === "tenant") headers.authorization = `Bearer ${tenantToken}`;
  const response = await fetch(`${runtimeBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { parse_error: true }; }
  if (!expected.includes(response.status)) {
    const code = payload?.error?.code || "unknown";
    throw new Error(`unexpected_http:${method}:${path}:${response.status}:${code}`);
  }
  return payload;
}

const evidence = {
  schema_version: 1,
  contract: "mad4b.spec017-fixture-context-readback.v1",
  report_type: "spec017_managed_execution_fixture_context_readback",
  source_sha: sourceSha,
  expected_production_sha: expectedProductionSha,
  runtime_origin: runtimeBaseUrl,
  parent_ticket_id: parentTicketId,
  status: "blocked",
  fixture: null,
  observations: {
    tenant_id: null,
    user_candidate_count: 0,
    resource_candidate_count: 0,
    capability_candidate_count: 0,
    eligible_grant_count: 0,
  },
  assertions: {
    known_parent_ticket_read: false,
    tenant_context_unique: false,
    active_user_membership_verified: false,
    resource_context_unique: false,
    existing_mutation_grant_verified: false,
    capability_key_pinned_from_ticket_context: false,
  },
  first_failure: null,
  short_lived_platform_jwt_used: false,
  long_lived_user_jwt_secret_used: false,
  resource_grant_created: false,
  capability_created: false,
  resource_created: false,
  provider_dispatch_executed: false,
  external_business_effect_executed: false,
  migration_apply_executed: false,
  sql_executed_by_readback: false,
  deployment_mutated: false,
  repository_mutated: false,
  secrets_included: false,
};

try {
  const ticketContext = await api(`/admin/tenant-requests/${encodeURIComponent(parentTicketId)}`, { auth: "admin" });
  evidence.assertions.known_parent_ticket_read = true;

  const ticket = ticketContext?.ticket || {};
  const resolutionCase = ticketContext?.resolutionCase || {};
  const tenantId = safeIdentifier(ticket.tenantId, "tenant_id", 128);
  evidence.observations.tenant_id = tenantId;
  evidence.assertions.tenant_context_unique = true;

  const userKeys = new Set(["user_id", "userId", "requester_user_id", "requesterUserId", "owner_user_id", "ownerUserId"]);
  const userCandidates = collectNamedValues({
    metadata: ticket.metadata || null,
    resolutionCase,
    timeline: ticketContext?.timeline || [],
  }, userKeys);
  if (resolutionCase.ownerUserId) userCandidates.add(String(resolutionCase.ownerUserId).trim());
  evidence.observations.user_candidate_count = userCandidates.size;
  if (userCandidates.size !== 1) throw new Error(`fixture_user_candidate_cardinality:${userCandidates.size}`);
  const userId = safeIdentifier([...userCandidates][0], "user_id", 128);

  const issued = await api("/auth/platform-jwt/issue", {
    method: "POST",
    auth: "admin",
    body: {
      user_id: userId,
      tenant_id: tenantId,
      ttl_seconds: 600,
      reason: `spec017_fixture_readback:${sourceSha.slice(0, 12)}`,
    },
  });
  tenantToken = String(issued?.access_token || "");
  if (!tenantToken || issued?.tenant?.tenant_id !== tenantId || issued?.user?.user_id !== userId) {
    throw new Error("fixture_platform_jwt_identity_mismatch");
  }
  evidence.short_lived_platform_jwt_used = true;
  evidence.assertions.active_user_membership_verified = true;

  const resourceRefKeys = new Set(["resource_ref", "resourceRef"]);
  const resourceTypeKeys = new Set(["resource_type", "resourceType"]);
  const resourceRefs = collectNamedValues({ metadata: ticket.metadata || null, resolutionCase, timeline: ticketContext?.timeline || [] }, resourceRefKeys);
  if (resolutionCase.resourceRef) resourceRefs.add(String(resolutionCase.resourceRef).trim());
  const resourceTypes = collectNamedValues({ metadata: ticket.metadata || null, timeline: ticketContext?.timeline || [] }, resourceTypeKeys);

  const ticketUri = `ticket://${parentTicketId}`;
  const linkedResourceRefs = [...resourceRefs].filter((value) => value === ticketUri || value.includes(parentTicketId));
  if (linkedResourceRefs.length === 0 && resourceRefs.size === 1) linkedResourceRefs.push([...resourceRefs][0]);
  const uniqueResourceRefs = [...new Set(linkedResourceRefs.filter(Boolean))];
  evidence.observations.resource_candidate_count = uniqueResourceRefs.length;
  if (uniqueResourceRefs.length !== 1) throw new Error(`fixture_resource_candidate_cardinality:${uniqueResourceRefs.length}`);
  const resourceRef = safeIdentifier(uniqueResourceRefs[0], "resource_ref", 255);

  let resourceType = "";
  if (resourceTypes.size === 1) resourceType = [...resourceTypes][0];
  else if (resourceRef === ticketUri || resourceRef.startsWith("ticket://")) resourceType = "ticket";
  if (!resourceType) throw new Error(`fixture_resource_type_candidate_cardinality:${resourceTypes.size}`);
  resourceType = safeIdentifier(resourceType, "resource_type", 128);
  evidence.assertions.resource_context_unique = true;

  const capabilityKeys = new Set(["capability_key", "capabilityKey"]);
  const capabilityCandidates = collectNamedValues({ metadata: ticket.metadata || null, resolutionCase, timeline: ticketContext?.timeline || [] }, capabilityKeys);
  evidence.observations.capability_candidate_count = capabilityCandidates.size;
  if (capabilityCandidates.size !== 1) throw new Error(`fixture_capability_candidate_cardinality:${capabilityCandidates.size}`);
  const capabilityKey = safeIdentifier([...capabilityCandidates][0], "capability_key", 191);
  evidence.assertions.capability_key_pinned_from_ticket_context = true;

  const grantsPayload = await api(`/me/workspaces/${encodeURIComponent(tenantId)}/resource-grants`, { auth: "tenant" });
  const grants = Array.isArray(grantsPayload?.grants) ? grantsPayload.grants : [];
  const eligible = grants
    .filter((grant) => String(grant.grantee_user_id || "") === userId)
    .filter((grant) => (MUTATION_PERMISSION_RANK[String(grant.permission || "").toLowerCase()] || 0) >= MUTATION_PERMISSION_RANK.edit)
    .filter((grant) => (
      (String(grant.resource_type || "") === resourceType && String(grant.resource_ref || "") === resourceRef)
      || (String(grant.resource_type || "") === "workspace" && String(grant.resource_ref || "") === tenantId)
    ))
    .map((grant) => ({
      ...grant,
      exact_resource: String(grant.resource_type || "") === resourceType && String(grant.resource_ref || "") === resourceRef,
      permission_rank: MUTATION_PERMISSION_RANK[String(grant.permission || "").toLowerCase()] || 0,
    }))
    .sort((left, right) => Number(right.exact_resource) - Number(left.exact_resource) || right.permission_rank - left.permission_rank || String(left.grant_id).localeCompare(String(right.grant_id)));

  evidence.observations.eligible_grant_count = eligible.length;
  if (eligible.length === 0) throw new Error("fixture_existing_mutation_grant_missing");
  const top = eligible[0];
  const tiedTop = eligible.filter((grant) => grant.exact_resource === top.exact_resource && grant.permission_rank === top.permission_rank);
  if (tiedTop.length !== 1) throw new Error(`fixture_effective_grant_ambiguous:${tiedTop.length}`);
  evidence.assertions.existing_mutation_grant_verified = true;

  evidence.fixture = {
    user_id: userId,
    tenant_id: tenantId,
    parent_ticket_id: parentTicketId,
    capability_key: capabilityKey,
    resource_type: resourceType,
    resource_ref: resourceRef,
    existing_resource_grant: {
      grant_id: top.grant_id,
      permission: top.permission,
      resource_type: top.resource_type,
      resource_ref: top.resource_ref,
      exact_resource: top.exact_resource,
      source: top.source || null,
    },
  };
  evidence.status = "context_pinned";
} catch (error) {
  evidence.first_failure = {
    code: firstFailureCode(error),
    detail: String(error?.message || error || "fixture context readback failed").slice(0, 1000),
  };
} finally {
  tenantToken = "";
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  contract: evidence.contract,
  status: evidence.status,
  first_failure: evidence.first_failure,
  evidence_path: evidencePath,
  secrets_included: false,
}, null, 2));
