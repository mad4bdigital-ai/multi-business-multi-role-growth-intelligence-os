<!-- GENERATED FILE. Run npm run inventory:write. Do not edit manually. -->
# Dynamic Repository Inventory

This report is generated deterministically from the Git index. It is intentionally derived from the repository itself so that new files, packages, workflows, migrations, contracts, tests, and documentation appear automatically as the project grows. Generated inventory and evaluation artifacts are excluded from the counted inputs to avoid a self-referential write cycle.

## Snapshot

| Metric | Value |
|---|---:|
| Tracked files | 6,998 |
| Total bytes | 65,311,252 |
| Counted text lines | 1,536,509 |
| Directories | 260 |
| Categories | 13 |

## Files by category

| Category | Files |
|---|---:|
| `tests-and-specs` | 2,096 |
| `documentation` | 1,896 |
| `api-runtime` | 1,408 |
| `database-migrations` | 781 |
| `root-and-other` | 268 |
| `api-contracts` | 162 |
| `ci-workflows` | 161 |
| `ci-config` | 103 |
| `schemas-and-data` | 67 |
| `connectors-and-edge` | 23 |
| `applications` | 19 |
| `source` | 12 |
| `build-and-dependencies` | 2 |

## Files by extension

| Extension | Files |
|---|---:|
| `.md` | 2,489 |
| `.mjs` | 1,636 |
| `.js` | 975 |
| `.sql` | 796 |
| `.json` | 743 |
| `.yml` | 164 |
| `.yaml` | 110 |
| `.ts` | 15 |
| `.cs` | 14 |
| `.ps1` | 11 |
| `.jsx` | 9 |
| `.txt` | 7 |
| `.py` | 5 |
| `.example` | 3 |
| `.css` | 3 |
| `.csproj` | 2 |
| `.toml` | 2 |
| `.gitattributes` | 1 |
| `.gitignore` | 1 |
| `.nvmrc` | 1 |
| `.manifest` | 1 |
| `.cmd` | 1 |
| `.jsonl` | 1 |
| `.htaccess` | 1 |
| `.dockerignore` | 1 |
| `.gcloudignore` | 1 |
| `[no extension]` | 1 |
| `.png` | 1 |
| `.html` | 1 |
| `.sh` | 1 |
| `.keep` | 1 |

## Important surfaces

| Surface | Count |
|---|---:|
| GitHub Actions workflows | 161 |
| Database migrations | 781 |
| API/OpenAPI contracts | 162 |
| Test/spec files (paths) | 2,164 |
| package.json manifests | 2 |

## Package manifests

| Path | Name | Version | Scripts | Dependencies | Dev dependencies |
|---|---|---|---:|---:|---:|
| `http-generic-api/package.json` | `http-generic-api-connector` | `2.7.0-wordpress-dry-run-preflight` | 61 | 9 | 0 |
| `package.json` | `multi-business-growth-intelligence-os` | `1.0.0` | 19 | 0 | 4 |

## Largest tracked files

| Path | Category | Bytes | Lines |
|---|---|---:|---:|
| `http-generic-api/schemas/wordpress/wordpress_api.yaml` | schemas-and-data | 4,831,654 | 142814 |
| `http-generic-api/frontend-surface-dispatch.generated.json` | api-runtime | 3,123,850 | 95802 |
| `http-generic-api/remote-mcp-write-scope-inventory.generated.json` | api-runtime | 1,931,059 | 58392 |
| `docs/staging-write-route-partition-2026-08-14.json` | documentation | 1,535,977 | 47056 |
| `http-generic-api/openapi.yaml` | api-contracts | 990,965 | 23004 |
| `http-generic-api/openapi/frontend-runtime-routes.generated.yaml` | api-contracts | 325,509 | 8484 |
| `http-generic-api/wordpress/phaseA.js` | api-runtime | 286,142 | 7691 |
| `docs/surface-contract-safety-attestations.json` | documentation | 265,603 | 7914 |
| `http-generic-api/schemas/hostinger/hostinger_api.yaml` | schemas-and-data | 242,696 | 7657 |
| `docs/governance/configuration-drift-policy.json` | documentation | 241,968 | 2072 |
| `http-generic-api/routes/gptToolsRoutes.js` | api-runtime | 212,668 | 4536 |
| `docs/spec-portfolio/spec015-gap-matrix.generated.json` | documentation | 210,893 | 3134 |
| `http-generic-api/routes/gptToolsRoutesLegacy.js` | api-runtime | 203,999 | 4368 |
| `http-generic-api/supportTicketService.js` | api-runtime | 157,662 | 2301 |
| `Updating Registry Patch Index.md` | documentation | 155,274 | 1826 |
| `http-generic-api/routes/adminCliRoutes.js` | api-runtime | 149,366 | 3363 |
| `AI_Agent_Knowledge_Guide.md` | documentation | 146,641 | 1341 |
| `http-generic-api/openapi/openapi.tenant-gpt.auth.yaml` | api-contracts | 141,224 | 3794 |
| `package-lock.json` | build-and-dependencies | 138,721 | 3861 |
| `http-generic-api/releaseReadiness.js` | api-runtime | 135,154 | 2593 |
| `schemas/operations.schema.json` | schemas-and-data | 134,568 | 3397 |
| `http-generic-api/openapi/openapi.tenant-gpt.staging.yaml` | api-contracts | 128,063 | 3454 |
| `http-generic-api/routes/devAgentRoutes.js` | api-runtime | 127,236 | 2754 |
| `docs/work-maps/data-model-domain-map.md` | documentation | 120,034 | 866 |
| `apps/local-manager-windows/Program.cs` | applications | 112,920 | 2024 |
| `http-generic-api/platformResourceRecipeCapability.js` | api-runtime | 112,466 | 2727 |
| `http-generic-api/openapi/openapi.tenant-gpt.activation.yaml` | api-contracts | 112,100 | 3408 |
| `deployment_parity_checklist.md` | documentation | 109,207 | 571 |
| `http-generic-api/server.js` | api-runtime | 107,240 | 3308 |
| `http-generic-api/routes/systemLayerRoutes.js` | api-runtime | 103,931 | 2644 |

## Complete machine-readable inventory

The complete inventory of every non-generated tracked file, including category, extension, byte size, line count, SHA-256 content fingerprint, Unix mode, executable marker, and generated-file marker, is available in the repository-inventory.json artifact. The compact repository-inventory-summary.json artifact contains totals, grouped counts, package manifests, surface counts, and the largest files for low-noise review and downstream dashboards. The JSON file is the authoritative artifact for automation and downstream analysis; generated inventory and evaluation artifacts are intentionally omitted to keep regeneration deterministic.

## Regeneration

Run npm run inventory:check to verify that committed artifacts match the current Git index. Run npm run inventory:write to regenerate both artifacts locally. CI regenerates the artifacts on relevant changes and fails if the working tree becomes dirty.
