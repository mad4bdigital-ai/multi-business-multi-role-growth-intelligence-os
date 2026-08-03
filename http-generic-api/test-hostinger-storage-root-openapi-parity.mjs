#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import YAML from 'yaml';

const rootOpenApiSource = fs.readFileSync(new URL('./openapi.yaml', import.meta.url), 'utf8');
const rootOpenApi = YAML.parse(rootOpenApiSource) || {};
const registrySource = fs.readFileSync(
  new URL('./openapi-route-contracts.d/spec014-hostinger-storage.yaml', import.meta.url),
  'utf8',
);
const registry = YAML.parse(registrySource) || {};
const fragmentSource = fs.readFileSync(
  new URL('./openapi/hostinger-storage-tenant-runtime.yaml', import.meta.url),
  'utf8',
);
const fragment = YAML.parse(fragmentSource) || {};
const routeSource = fs.readFileSync(
  new URL('./routes/hostingerStorageTenantRoutes.js', import.meta.url),
  'utf8',
);
const routeIndexSource = fs.readFileSync(new URL('./routes/index.js', import.meta.url), 'utf8');
const specOnlyOpenApiSource = fs.readFileSync(
  new URL('../specs/014-governed-hostinger-storage-orchestration/contracts/openapi.yaml', import.meta.url),
  'utf8',
);
const specOnlyOpenApi = YAML.parse(specOnlyOpenApiSource) || {};

const signature = 'POST /tenant/storage-operations/apply-plan';
const routePath = '/tenant/storage-operations/apply-plan';
const expectedRef = './openapi/hostinger-storage-tenant-runtime.yaml#/hostingerStorageTenantApplyPlanPath';
const routeFile = 'routes/hostingerStorageTenantRoutes.js';
const httpMethodKeys = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

assert.equal(registry.version, 1);
assert.deepEqual(Object.keys(registry.contracts || {}), [signature]);
assert.equal(registry.contracts[signature].path_item_ref, expectedRef);
assert.equal(registry.contracts[signature].route_file, routeFile);

assert.deepEqual(rootOpenApi.paths?.[routePath], { $ref: expectedRef });

const specOnlyPaths = Object.keys(specOnlyOpenApi.paths || {});
const specOnlyOperationCount = specOnlyPaths.reduce(
  (count, pathName) => count + Object.keys(specOnlyOpenApi.paths?.[pathName] || {})
    .filter((key) => httpMethodKeys.has(key))
    .length,
  0,
);
assert.equal(specOnlyPaths.length, 17);
assert.equal(specOnlyOperationCount, 18);
assert(specOnlyPaths.every((pathName) => (
  pathName.startsWith('/admin/hosting/storage/')
  || pathName.startsWith('/tenant/workspaces/')
)));
for (const designPath of specOnlyPaths) {
  assert.equal(
    rootOpenApi.paths?.[designPath],
    undefined,
    `Specification-only Hostinger design path entered the root runtime OpenAPI: ${designPath}`,
  );
}

const operation = fragment.hostingerStorageTenantApplyPlanPath?.post;
assert(operation && typeof operation === 'object');
assert.equal(operation.operationId, 'hostingerStorageTenantApplyPlan');
assert.equal(operation['x-runtime-contract-source'], routeFile);
assert.equal(operation['x-runtime-auth-profile'], 'user_jwt');
assert.equal(operation['x-contract-completeness'], 'runtime-mounted-operation');
assert.equal(operation['x-openai-isConsequential'], true);
assert.deepEqual(operation.security, [{ userJwtAuth: [] }]);
assert.equal(operation.requestBody?.required, true);
assert.deepEqual(Object.keys(operation.responses || {}).sort(), ['200', '400', '401', '409', '500', '503']);

const requestSchema = fragment.components?.schemas?.HostingerStorageTenantApplyPlanRequest;
assert.equal(requestSchema?.additionalProperties, false);
assert.deepEqual(requestSchema?.required, ['operation_id', 'expected_sha']);
assert.equal(requestSchema?.properties?.operation_id?.pattern, '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$');
assert.equal(requestSchema?.properties?.expected_sha?.pattern, '^(?:[0-9a-f]{7,64}|sha256-[0-9a-f]{32,128})$');
assert.equal(fragment.components?.schemas?.HostingerStorageTenantApplyPlanResult?.properties?.secrets_included?.const, false);
assert.equal(fragment.components?.schemas?.HostingerStorageTenantRouteError?.properties?.secrets_included?.const, false);

assert.match(routeSource, /router\.post\('\/tenant\/storage-operations\/apply-plan', requireTenantPrincipal/u);
assert.match(routeSource, /req\.auth\?\.mode !== 'user_jwt'/u);
assert.match(routeSource, /req\.auth\?\.is_admin === true/u);
assert.match(routeSource, /ALLOWED_BODY_FIELDS = Object\.freeze\(\['expected_sha', 'operation_id'\]\)/u);
assert.match(routeSource, /runtime\.synthetic_only === true/u);
assert.match(routeSource, /runtime\.provider_dispatch_allowed === false/u);
assert.match(routeSource, /runtime\.production_ready === false/u);
assert.match(routeSource, /secrets_included: false/u);
assert.match(routeIndexSource, /import \{ buildHostingerStorageTenantRoutes \} from "\.\/hostingerStorageTenantRoutes\.js";/u);
assert.match(routeIndexSource, /app\.use\(buildHostingerStorageTenantRoutes\(deps\)\);/u);

assert.match(specOnlyOpenApiSource, /Specification-only Admin and Tenant surfaces/u);
assert.match(specOnlyOpenApiSource, /not runtime-mounted by this specification package/u);

const sync = spawnSync(
  process.execPath,
  ['scripts/openapi-precise-contract-registry-sync.mjs', '--check'],
  {
    cwd: new URL('.', import.meta.url),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  },
);
assert.equal(sync.status, 0, sync.stderr || sync.stdout);
const syncResult = JSON.parse(sync.stdout);
assert.equal(syncResult.ok, true);
assert.equal(syncResult.changed, false);
assert.equal(syncResult.missing_count, 0);
assert.equal(syncResult.conflict_count, 0);
assert(syncResult.registry_sources.includes('openapi-route-contracts.yaml'));
assert(syncResult.registry_sources.includes('openapi-route-contracts.d/spec014-hostinger-storage.yaml'));

console.log(JSON.stringify({
  ok: true,
  contract: 'spec014.hostinger-storage-root-openapi-parity.v1',
  signature,
  path_item_ref: expectedRef,
  mounted_runtime_route_count: 1,
  specification_only_design_path_count: specOnlyPaths.length,
  specification_only_design_operation_count: specOnlyOperationCount,
  spec_only_design_routes_mounted: false,
  user_jwt_required: true,
  consequential: true,
  synthetic_only: true,
  provider_dispatch_allowed: false,
  production_ready: false,
  repository_mutation: false,
  live_database_access_performed: false,
  secrets_included: false,
}, null, 2));
