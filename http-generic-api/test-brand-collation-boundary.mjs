import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const authoritySource = await readFile(new URL("./workspaceGrantResourceAuthority.js", import.meta.url), "utf8");
const lifecycleSource = await readFile(new URL("./workspaceBrandLifecycle.js", import.meta.url), "utf8");

for (const [label, source] of [
  ["workspaceGrantResourceAuthority", authoritySource],
  ["workspaceBrandLifecycle", lifecycleSource],
]) {
  assert.doesNotMatch(
    source,
    /JOIN\s+brands\s+\w+\s+ON[\s\S]{0,300}brand_target_key/iu,
    `${label} must not compare brands.target_key to tenant_brand_links.brand_target_key in one SQL join`,
  );
  assert.doesNotMatch(
    source,
    /JOIN\s+tenant_brand_links\s+\w+\s+ON[\s\S]{0,300}target_key/iu,
    `${label} must keep Brand and tenant-link identity comparisons collation-local`,
  );
}

assert.match(authoritySource, /resolveCanonicalBrandForWorkspace/);
assert.match(authoritySource, /FROM brands b/);
assert.match(authoritySource, /FROM tenant_brand_links tbl/);
assert.match(lifecycleSource, /FROM tenant_brand_links/);
assert.match(lifecycleSource, /FROM brands/);
assert.match(lifecycleSource, /targetRefs/);

console.log("Brand collation boundary tests passed");
