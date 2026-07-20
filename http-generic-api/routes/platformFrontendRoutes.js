import { Router } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROUTE_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(ROUTE_DIR, "..");
const PLATFORM_ASSET_ROOT = path.join(API_ROOT, "public", "platform");
const DEFAULT_DISPATCH_PATH = path.join(API_ROOT, "frontend-surface-dispatch.generated.json");
const ASSETS = new Map([
  ["tokens.css", "text/css; charset=utf-8"],
  ["shell.css", "text/css; charset=utf-8"],
  ["shell.js", "text/javascript; charset=utf-8"],
]);

function shellHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

function isDispatchPlan(value) {
  return value
    && value.schema_version === "frontend-surface-dispatch-v1"
    && /^[a-f0-9]{64}$/.test(String(value.baseline?.source_digest || ""))
    && Array.isArray(value.families)
    && Array.isArray(value.tasks);
}

function renderMode(group) {
  if (["operations", "activation", "growth"].includes(group)) return "overview";
  if (["developer-evidence", "governance"].includes(group)) return "timeline";
  if (group === "resources") return "table";
  return "cards";
}

function mutationMode(family) {
  if (!family.operations?.some((operation) => operation.mutation)) return "none";
  return family.scope === "tenant" ? "tenant_admin_approval" : "explicit_approval";
}

function safeHref(family) {
  if (family.family_key === "platform-frontend") return "/platform";
  if (family.source_file === "routes/connectRoutes.js" && family.embedded_ui) return "/connect";
  return null;
}

export function buildUiSurfaceCatalog(plan) {
  if (!isDispatchPlan(plan)) throw new Error("invalid_frontend_dispatch_plan");
  const tasks = new Map(plan.tasks.map((task) => [task.task_key, task]));
  const approvedDecisions = new Set(["unified_ui", "embedded_ui", "legacy_compatibility", "deferred"]);
  const surfaces = plan.families
    .filter((family) => ["public", "tenant"].includes(family.scope))
    .filter((family) => family.wave === "F1-tenant-shell")
    .filter((family) => approvedDecisions.has(family.surface_decision?.decision))
    .map((family) => {
      const task = tasks.get(`frontend.${family.family_key}`);
      const ready = task?.state === "ready";
      const legacy = family.surface_decision.decision === "legacy_compatibility";
      const deferred = family.surface_decision.decision === "deferred";
      const readOperation = ready ? family.operations?.find((operation) => operation.method === "GET") : null;
      return {
        surface_key: family.family_key,
        label: family.label,
        description: family.surface_decision.rationale,
        scope: family.scope,
        group: family.group,
        status: deferred ? "deferred" : legacy ? "legacy_compatibility" : ready ? (family.family_key === "platform-frontend" ? "live" : "cataloged") : "locked",
        read_endpoint: readOperation?.path || null,
        href: ready || legacy ? safeHref(family) : null,
        render_mode: ready ? renderMode(family.group) : "locked",
        mutation_mode: mutationMode(family),
        auth_mode: family.scope === "public" ? "none" : "user_jwt",
        evidence_endpoint: ready ? family.evidence_routes?.[0]?.split(" ").slice(1).join(" ") || null : null,
        owner: family.surface_decision.owner || "unassigned",
        source_refs: family.source_refs?.length ? family.source_refs : [family.source_file],
        fallback: legacy ? safeHref(family) : null,
      };
    })
    .sort((left, right) => left.group.localeCompare(right.group) || left.label.localeCompare(right.label));

  return {
    ok: true,
    version: "ui-surfaces-v1",
    baseline_digest: plan.baseline.source_digest,
    surfaces,
    secrets_included: false,
  };
}

export function buildPlatformFrontendRoutes({ dispatchPath = DEFAULT_DISPATCH_PATH } = {}) {
  const router = Router();

  router.get("/platform", async (_req, res) => {
    shellHeaders(res);
    res.type("html");
    return res.send(await readFile(path.join(PLATFORM_ASSET_ROOT, "index.html"), "utf8"));
  });

  router.get("/platform/assets/:file", async (req, res) => {
    const file = String(req.params.file || "");
    const contentType = ASSETS.get(file);
    if (!contentType) return res.status(404).json({ error: { code: "platform_asset_not_found", message: "Platform asset not found." }, secrets_included: false });
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(await readFile(path.join(PLATFORM_ASSET_ROOT, file)));
  });

  router.get("/platform/ui-surfaces", async (_req, res) => {
    try {
      const plan = JSON.parse(await readFile(dispatchPath, "utf8"));
      const catalog = buildUiSurfaceCatalog(plan);
      res.setHeader("Cache-Control", "no-store");
      return res.json(catalog);
    } catch {
      return res.status(503).json({
        ok: false,
        error: { code: "ui_surface_catalog_unavailable", message: "The governed UI surface catalog is unavailable." },
        secrets_included: false,
      });
    }
  });

  return router;
}

export const _testingPlatformFrontend = { ASSETS, isDispatchPlan };
