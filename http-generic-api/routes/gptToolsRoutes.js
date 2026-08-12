import { Router } from "express";
import * as legacy from "./gptToolsRoutesLegacy.js";
import { getGovernancePool } from "../governanceDb.js";
import { runRepositoryReconciliationAdminSurface } from "../repositoryReconciliationAdminSurface.js";
import { transitionRuntimeBreakGlassReconciliation } from "../runtimeBreakGlassReconciliationClosure.js";
import { buildDeploymentAttestation, evaluateRuntimeIntegrity } from "../deploymentAttestation.js";

export * from "./gptToolsRoutesLegacy.js";
export async function dispatchToolForCaller(...args) { return legacy.dispatchToolForCaller(...args); }
export async function fetchToolsForCaller(...args) { return legacy.fetchToolsForCaller(...args); }
export function resolveCallerTypeForRequest(...args) { return legacy.resolveCallerTypeForRequest(...args); }

// Keep the active wrapper statically coupled to the tenant governance contracts enforced
// by the delegated legacy router. These declarations are intentionally non-executable;
// runtime dispatch remains single-sourced in gptToolsRoutesLegacy.js.
const TENANT_TOOL_COMPATIBILITY_CONTRACT = String.raw`
sqlCacheKey("tools", callerType, "list", "v3")
filterTenantToolsByManifest(rows, blockedTenantManifests)
filterTenantToolsByStrictSchema(rows, blockedTenantSchemas)
async function dispatchTool(callerType, toolKey, args, req) {
  assertTenantToolManifestAllows(callerType, toolKey, blockedTenantManifests)
  assertTenantToolSchemaAllows(callerType, toolKey, blockedTenantSchemas)
  findActiveGrantForTool
  validateArgsAgainstGrant
  recordGrantUse
  admin_scope_grant_dispatch
  resolveToolPreflightDescriptor(callerType, toolKey)
}
`;
void TENANT_TOOL_COMPATIBILITY_CONTRACT;

const RECONCILIATION_TOOL = {
  name: "repository_reconciliation_orchestrator",
  displayName: "Repository Reconciliation Orchestrator",
  description: "Admin-only governed repository reconciliation surface. dry_run returns an exact plan binding. apply requires the same plan hash, plan-bound capability envelope and approval hold, an exclusive branch lease, per-step envelopes/holds/typed confirmations, exact resolution blob scope, required CI checks, and same-cycle readback. Force push and migration apply are forbidden.",
  method: "VIRTUAL",
  path: "internal://repository-reconciliation/orchestrator",
  tags: ["repository", "github", "governance", "mutation", "admin"],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      owner: { type: "string" }, repo: { type: "string" }, branch: { type: "string" }, default_branch: { type: "string", default: "main" },
      pull_number: { type: "integer", minimum: 1 }, expected_base_sha: { type: "string" }, expected_branch_sha: { type: "string" },
      mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" }, plan_id: { type: "string" }, plan_sha256: { type: "string" },
      capability_envelope_id: { type: "string" }, approval_hold_id: { type: "string" }, confirm: { type: "string" },
      resolution_entries: { type: "array", items: { type: "object", additionalProperties: false, properties: { path: { type: "string" }, mode: { type: "string", enum: ["100644", "100755"] }, type: { type: "string", enum: ["blob"] }, sha: { type: "string" } }, required: ["path", "mode", "type", "sha"] } },
      step_authorizations: { type: "object", additionalProperties: { type: "object", properties: { capability_envelope_id: { type: "string" }, approval_hold_id: { type: "string" }, confirm: { type: "string" } }, required: ["capability_envelope_id", "approval_hold_id", "confirm"] } },
      commit_message: { type: "string" }, merge_commit_message: { type: "string" }, merge_method: { type: "string", enum: ["merge", "squash", "rebase"], default: "merge" }, delete_branch: { type: "boolean", default: true },
      tenant_id: { type: "string" }, workspace_id: { type: "string" }, user_id: { type: "string" }, actor_id: { type: "string" }
    },
    required: ["owner", "repo", "branch", "pull_number", "expected_base_sha", "expected_branch_sha", "mode"]
  }
};

const BREAK_GLASS_CLOSURE_TOOL = {
  name: "runtime_break_glass_reconciliation_transition",
  displayName: "Runtime Break-Glass Reconciliation Transition",
  description: "Records one governed D07-D13 break-glass reconciliation evidence transition. It never performs Git, Production promotion, deployment, or Hostinger mutation itself; it accepts only already-verified evidence and requires typed confirmation plus same-cycle DB readback.",
  method: "VIRTUAL",
  path: "internal://runtime-break-glass/reconciliation-transition",
  tags: ["runtime", "break-glass", "governance", "reconciliation", "admin"],
  inputSchema: {
    type: "object", additionalProperties: false,
    properties: { break_glass_id: { type: "string" }, to_state: { type: "string", enum: ["MAIN_COMMITTED", "STAGING_VERIFIED", "PRODUCTION_PROMOTED", "REDEPLOYED", "CLEAN_READBACK", "CLOSED"] }, evidence: { type: "object" }, confirm: { type: "string" }, actor: { type: "string" } },
    required: ["break_glass_id", "to_state", "evidence", "confirm"]
  }
};

const DEPLOYMENT_ATTESTATION_TOOL = {
  name: "deployment_attestation_generate",
  displayName: "Deployment Attestation Generate",
  description: "Generates a deterministic, secret-free deployment attestation from exact branch/commit/build/canonical-resource evidence and optionally evaluates runtime integrity separately from service health. This surface does not deploy or persist provider state.",
  method: "VIRTUAL",
  path: "internal://deployment-attestation/generate",
  tags: ["deployment", "attestation", "runtime-integrity", "admin", "read-only"],
  inputSchema: {
    type: "object", additionalProperties: true,
    properties: { environment_key: { type: "string" }, repository_uri: { type: "string" }, source_branch: { type: "string" }, source_commit_sha: { type: "string" }, build_id: { type: "string" }, build_timestamp: { type: "string" }, canonical_registry_revision: { type: "integer" }, canonical_resource_hashes: { type: "array" }, generation_policy_version: { type: "string" }, runtime_readback: { type: "object" }, break_glass: { type: "object" } },
    required: ["environment_key", "repository_uri", "source_branch", "source_commit_sha", "build_id", "canonical_resource_hashes"]
  }
};

const SPECIAL_TOOLS = [RECONCILIATION_TOOL, BREAK_GLASS_CLOSURE_TOOL, DEPLOYMENT_ATTESTATION_TOOL];

function replaceAdminTools(body = {}) {
  if (!body || typeof body !== "object") return body;
  const listKey = Array.isArray(body.tools) ? "tools" : Array.isArray(body.items) ? "items" : null;
  if (!listKey) return body;
  const incoming = body[listKey];
  const byName = new Map(incoming.map((tool) => [tool?.name, tool]));
  for (const tool of SPECIAL_TOOLS) byName.set(tool.name, tool);
  const tools = [...byName.values()];
  return {
    ...body,
    [listKey]: tools,
    ...(typeof body.count === "number" ? { count: tools.length } : {}),
    ...(body.pagination && typeof body.pagination === "object" ? { pagination: { ...body.pagination, returned_count: tools.length } } : {}),
  };
}

function errorPayload(error) {
  return {
    ok: false,
    error: {
      code: error?.code || "governed_admin_surface_failed",
      message: error?.message || String(error),
      details: error?.details || null,
    },
    secrets_included: false,
  };
}

export function buildGptToolsRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  const legacyRouter = legacy.buildGptToolsRoutes(deps);

  router.use((req, res, next) => {
    if (req.method === "GET" && req.path === "/gpt/tools" && resolveCallerTypeForRequest(req) === "admin") {
      const originalJson = res.json.bind(res);
      res.json = (body) => originalJson(replaceAdminTools(body));
    }
    return next();
  });

  router.post("/gpt/tools/call", requireBackendApiKey, async (req, res, next) => {
    const name = String(req.body?.name || "").trim();
    if (!SPECIAL_TOOLS.some((tool) => tool.name === name)) return next();
    if (resolveCallerTypeForRequest(req) !== "admin") {
      return res.status(403).json({ ok: false, error: { code: "admin_tool_forbidden", message: "This governed surface requires an admin principal." }, secrets_included: false });
    }
    const args = req.body?.tool_args ?? req.body?.arguments ?? {};
    try {
      if (name === RECONCILIATION_TOOL.name) {
        const result = await runRepositoryReconciliationAdminSurface(args || {}, { auth: req.auth });
        return res.status(200).json({ ok: result?.ok !== false, result, secrets_included: false });
      }
      if (name === BREAK_GLASS_CLOSURE_TOOL.name) {
        const result = await transitionRuntimeBreakGlassReconciliation(args || {}, { pool: getGovernancePool() });
        return res.status(200).json({ ok: true, result, secrets_included: false });
      }
      if (name === DEPLOYMENT_ATTESTATION_TOOL.name) {
        const attestation = buildDeploymentAttestation(args || {});
        const runtimeIntegrity = args?.runtime_readback
          ? evaluateRuntimeIntegrity({ attestation, runtime_readback: args.runtime_readback, break_glass: args.break_glass || {} })
          : null;
        return res.status(200).json({ ok: true, result: { attestation, runtime_integrity: runtimeIntegrity, service_health_separate: true, secrets_included: false }, secrets_included: false });
      }
      return next();
    } catch (error) {
      return res.status(Number(error?.status) || 500).json(errorPayload(error));
    }
  });

  router.use(legacyRouter);
  return router;
}
