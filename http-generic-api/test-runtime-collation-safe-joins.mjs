import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function compact(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

const tenantLifecycleRoutes = compact(read("routes/tenantLifecycleRoutes.js"));
const appConnectionResolver = compact(read("appConnectionResolver.js"));
const smokeRecertification = compact(read("platformPluginSmokeRecertification.js"));

assert(
  tenantLifecycleRoutes.includes("s.connection_id COLLATE utf8mb4_unicode_ci = c.connection_id COLLATE utf8mb4_unicode_ci"),
  "tenant credential intake status must normalize connection_id collation"
);

assert(
  appConnectionResolver.includes("uac.connection_id COLLATE utf8mb4_unicode_ci = wal.connection_id COLLATE utf8mb4_unicode_ci"),
  "workspace app context must normalize workspace_app_links/user_app_connections connection_id joins"
);
assert(
  appConnectionResolver.includes("ai.app_key COLLATE utf8mb4_unicode_ci = uac.app_key COLLATE utf8mb4_unicode_ci"),
  "workspace app context must normalize app_integrations/user_app_connections app_key joins"
);
assert(
  !appConnectionResolver.includes("uac.connection_id = wal.connection_id"),
  "workspace app context must not use raw connection_id equality across mixed-collation tables"
);
assert(
  !appConnectionResolver.includes("ai.app_key = uac.app_key"),
  "workspace app context must not use raw app_key equality across mixed-collation tables"
);

assert(
  smokeRecertification.includes("u.connection_id COLLATE utf8mb4_unicode_ci = c.connection_id COLLATE utf8mb4_unicode_ci"),
  "smoke recertification must normalize certification/user connection_id joins"
);
assert(
  smokeRecertification.includes("e.parent_action_key COLLATE utf8mb4_unicode_ci = c.action_key COLLATE utf8mb4_unicode_ci"),
  "smoke recertification must normalize parent_action_key/action_key comparisons"
);
assert(
  !smokeRecertification.includes("u.connection_id = c.connection_id"),
  "smoke recertification must not use raw connection_id equality across mixed-collation tables"
);

console.log("Runtime collation-safe join guards passed.");
