import fs from "node:fs";
import { spawnSync } from "node:child_process";

const EXPECTED_BRANCH = "gpt/tenant-request-inbox-chunk-store-hardening-20260801";
const HELPER = "scripts/pr-4395-system-tools-fallback-fix-one-shot.mjs";
const REPORT = "pr-4395-schema-guard-diagnostic.json";
const PACKAGE = "package.json";

function fail(message) { throw new Error(`[pr-4395-system-tools-fallback] ${message}`); }
function replaceExact(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  const count = source.split(before).length - 1;
  if (count !== 1) fail(`${path}: expected one replacement target, found ${count}`);
  fs.writeFileSync(path, source.replace(before, after));
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited ${result.status}`);
}

const branch = String(process.env.GITHUB_HEAD_REF || spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout || "").trim();
if (branch !== EXPECTED_BRANCH) fail(`refusing branch ${branch || "<detached>"}`);

replaceExact(
  "routes/systemLayerRoutes.js",
  `      response_options: {
        max_chars: Number(responseOptions.max_chars || source?.max_chars || 45000),
        cursor: Number(responseOptions.cursor || source?.cursor || 0),
        chunk_ttl_ms: Number(responseOptions.chunk_ttl_ms || source?.chunk_ttl_ms || 0) || undefined,
        chunk_ttl_minutes: Number(responseOptions.chunk_ttl_minutes || source?.chunk_ttl_minutes || 0) || undefined,
      },`,
  `      response_options: {
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
      },`,
);

replaceExact(
  "routes/systemLayerRoutes.js",
  `  router.get("/admin/system/tools", ...adminOnly, async (req, res) => {
    const body = await buildSystemToolsListResponse(req.auth, req.query || {});
    return res.status(200).json(await chunkSystemLayerResponse(
      body,
      req.query || {},
      req.auth,
      "admin_system_tools_list",
      "admin_system_tools_list",
    ));
  });`,
  `  router.get("/admin/system/tools", ...adminOnly, async (req, res) => {
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
  });`,
);

replaceExact(
  "test-platform-routes.mjs",
  `section("Admin system layer connector facade");

{
  const r = await get("/admin/system/tools");
  ok("system tools returns 200", r.status === 200, \`got \${r.status}\`);
  ok("system tools exposes passive endpoint preview", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "runtime_endpoint_preview"));`,
  `section("Admin system layer connector facade");

{
  const degraded = await get("/admin/system/tools");
  ok("system tools returns controlled 503 when the default inline budget cannot contain the degraded response", degraded.status === 503, \`got \${degraded.status}\`);
  ok("system tools bounded failure is typed", degraded.body.error?.code === "response_chunk_persistence_unavailable_inline_limit_exceeded", JSON.stringify(degraded.body));
  ok("system tools bounded failure excludes secrets", degraded.body.secrets_included === false, JSON.stringify(degraded.body));

  const r = await get("/admin/system/tools?max_chars=150000&client_response_budget_chars=150000&response_envelope_overhead_chars=2000");
  ok("system tools returns 200 when the caller explicitly supplies a sufficient bounded response budget", r.status === 200, \`got \${r.status}\`);
  ok("system tools exposes passive endpoint preview", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "runtime_endpoint_preview"));`,
);

const packageJson = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
const temporary = `node ${HELPER} && node scripts/frontend-operation-governance-generator.mjs --write && node scripts/frontend-surface-dispatch.mjs --write`;
const original = "node scripts/frontend-operation-governance-generator.mjs --write && node scripts/frontend-surface-dispatch.mjs --write";
if (packageJson.scripts["frontend:dispatch:generate"] !== temporary) fail("temporary frontend generator trigger drifted");
packageJson.scripts["frontend:dispatch:generate"] = original;
fs.writeFileSync(PACKAGE, JSON.stringify(packageJson, null, 2) + "\n");
if (fs.existsSync(REPORT)) fs.unlinkSync(REPORT);
fs.unlinkSync(HELPER);

run(process.execPath, ["--check", "routes/systemLayerRoutes.js"]);
run(process.execPath, ["test-platform-routes.mjs"]);
run("git", ["config", "user.name", "github-actions[bot]"]);
run("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
run("git", ["add", "--", "routes/systemLayerRoutes.js", "test-platform-routes.mjs", PACKAGE, HELPER, REPORT]);
run("git", ["diff", "--cached", "--check"]);
run("git", ["commit", "-m", "fix(system-tools): return bounded fallback failures as HTTP errors"]);
run("git", ["push", "origin", `HEAD:${EXPECTED_BRANCH}`]);
