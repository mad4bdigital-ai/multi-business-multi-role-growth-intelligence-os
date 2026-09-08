import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../autopilot-portable-staging/Start-AutoPilot.ps1", import.meta.url), "utf8");
const finder = source.slice(source.indexOf("function Find-ExactStagingImageId"), source.indexOf("function Seed-SchemaBundle"));

assert.match(finder, /config", "--format", "json"/);
assert.match(finder, /composeModel\.services\.app\.image/);
assert.match(finder, /composeModel\.name/);
assert.match(finder, /-app:latest/);
assert.match(finder, /docker image inspect --format '\{\{\.Id\}\}' \$effectiveImageRef/);
assert.match(finder, /Test-ExactStagingImage/);
assert.doesNotMatch(finder, /"images", "-q", "app"/);

for (const label of [
  "org.mad4b.staging.provenance.contract",
  "org.mad4b.staging.build.commit",
  "org.mad4b.staging.build.tree",
  "org.mad4b.staging.build.context_file_set_sha256",
  "org.mad4b.staging.build.secrets_included",
]) assert.ok(source.includes(label), `exact provenance validation lost ${label}`);

assert.match(source, /\$imageId -notmatch '\^sha256:/);
assert.match(source, /Fail "Staging app image ID is not a content-addressed sha256 digest with exact provenance"/);

console.log("staging post-build image discovery contract tests passed");
