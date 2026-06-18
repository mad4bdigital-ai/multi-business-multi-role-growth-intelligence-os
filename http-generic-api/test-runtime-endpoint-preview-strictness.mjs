import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/systemLayerRoutes.js", "utf8");

assert(
  routes.includes("assertRuntimeEndpointPreviewPayload(args || {})"),
  "runtime_endpoint_preview must validate the request envelope before facade dispatch"
);
assert(
  routes.includes("runtime_endpoint_preview_query_not_allowed") &&
    routes.includes('"url", "uri", "endpoint", "host", "hostname", "base_url", "base_uri"') &&
    routes.includes("169.254.169.254") &&
    routes.includes("metadata.google.internal"),
  "runtime_endpoint_preview must reject provider-target query overrides and metadata targets"
);
assert(
  routes.includes("GitHub content write preview requires body.content") &&
    routes.includes("body.content") &&
    routes.includes(/create_or_update|put_contents|file_contents/i.source),
  "GitHub create/update content preview must require body.content"
);
assert(
  routes.includes("GitHub delete file preview requires body.sha") &&
    routes.includes("body.sha"),
  "GitHub delete file preview must require body.sha"
);
assert(
  routes.indexOf("assertRuntimeEndpointPreviewPayload(args || {})") <
    routes.indexOf("derivePrincipalExecutionContext({ ...(args || {}), dry_run: true }"),
  "runtime_endpoint_preview validation must happen before principal context derivation and facade dispatch"
);

console.log("runtime endpoint preview strictness guard passed");
