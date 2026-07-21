import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routesIndex = readFileSync(new URL("./routes/index.js", import.meta.url), "utf8");
const authorityRoutes = readFileSync(
  new URL("./routes/effectiveAuthorityRoutes.js", import.meta.url),
  "utf8"
);

assert.match(
  routesIndex,
  /import \{ buildEffectiveAuthorityRoutes \} from "\.\/effectiveAuthorityRoutes\.js";/
);
assert.match(
  routesIndex,
  /app\.use\(buildEffectiveAuthorityRoutes\(\{ \.\.\.deps, requireAdminPrincipal \}\)\);/
);
assert.match(authorityRoutes, /"\/authority\/projections\/connectors"/);
assert.match(authorityRoutes, /"\/authority\/decisions\/resolve"/);
assert.match(authorityRoutes, /"\/me\/authority\/projections\/connectors"/);
assert.match(authorityRoutes, /"\/me\/authority\/decisions\/resolve"/);
assert.match(authorityRoutes, /BACKEND_AUTH_MIDDLEWARE_UNAVAILABLE/);
assert.match(authorityRoutes, /USER_AUTH_CONFIGURATION_UNAVAILABLE/);
assert.doesNotMatch(authorityRoutes, /dev-secret/);
assert.doesNotMatch(authorityRoutes, /function pass\(/);

console.log("effective authority composition tests passed");
