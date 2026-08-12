<!-- GENERATED FILE. Run npm run inventory:write. Do not edit manually. -->
# Dynamic Repository Inventory

This report is generated deterministically from the Git index. It is intentionally derived from the repository itself so that new files, packages, workflows, migrations, contracts, tests, and documentation appear automatically as the project grows. Generated inventory and evaluation artifacts are excluded from the counted inputs to avoid a self-referential write cycle.

## Snapshot

| Metric | Value |
|---|---:|
| Tracked files | 6,661 |
| Total bytes | 58,684,782 |
| Counted text lines | 1,369,868 |
| Directories | 251 |
| Categories | 13 |

## Files by category

| Category | Files |
|---|---:|
| `tests-and-specs` | 1,985 |
| `documentation` | 1,853 |
| `api-runtime` | 1,323 |
| `database-migrations` | 767 |
| `root-and-other` | 220 |
| `ci-workflows` | 151 |
| `api-contracts` | 147 |
| `ci-config` | 93 |
| `schemas-and-data` | 66 |
| `connectors-and-edge` | 23 |
| `applications` | 19 |
| `source` | 12 |
| `build-and-dependencies` | 2 |

## Files by extension

| Extension | Files |
|---|---:|
| `.md` | 2,438 |
| `.mjs` | 1,525 |
| `.js` | 928 |
| `.sql` | 782 |
| `.json` | 653 |
| `.yml` | 153 |
| `.yaml` | 107 |
| `.ts` | 15 |
| `.cs` | 14 |
| `.jsx` | 9 |
| `.txt` | 6 |
| `.py` | 5 |
| `.ps1` | 5 |
| `.css` | 3 |
| `.csproj` | 2 |
| `.toml` | 2 |
| `.example` | 2 |
| `.gitattributes` | 1 |
| `.gitignore` | 1 |
| `.nvmrc` | 1 |
| `.manifest` | 1 |
| `.jsonl` | 1 |
| `.htaccess` | 1 |
| `.gcloudignore` | 1 |
| `[no extension]` | 1 |
| `.png` | 1 |
| `.html` | 1 |
| `.sh` | 1 |
| `.keep` | 1 |

## Important surfaces

| Surface | Count |
|---|---:|
| GitHub Actions workflows | 151 |
| Database migrations | 767 |
| API/OpenAPI contracts | 147 |
| Test/spec files (paths) | 2,048 |
| package.json manifests | 2 |

## Package manifests

| Path | Name | Version | Scripts | Dependencies | Dev dependencies |
|---|---|---|---:|---:|---:|
| `http-generic-api/package.json` | `http-generic-api-connector` | `2.7.0-wordpress-dry-run-preflight` | 58 | 9 | 0 |
| `package.json` | `multi-business-growth-intelligence-os` | `1.0.0` | 15 | 0 | 4 |

## Largest tracked files

| Path | Category | Bytes | Lines |
|---|---|---:|---:|
| `http-generic-api/schemas/wordpress/wordpress_api.yaml` | schemas-and-data | 4,831,654 | 142814 |
| `http-generic-api/frontend-surface-dispatch.generated.json` | api-runtime | 3,158,811 | 97001 |
| `http-generic-api/openapi.yaml` | api-contracts | 979,336 | 22721 |
| `http-generic-api/openapi/frontend-runtime-routes.generated.yaml` | api-contracts | 328,113 | 8552 |
| `http-generic-api/wordpress/phaseA.js` | api-runtime | 286,142 | 7691 |
| `docs/surface-contract-safety-attestations.json` | documentation | 265,603 | 7914 |
| `http-generic-api/schemas/hostinger/hostinger_api.yaml` | schemas-and-data | 242,696 | 7657 |
| `docs/spec-portfolio/spec015-gap-matrix.generated.json` | documentation | 210,893 | 3134 |
| `http-generic-api/routes/gptToolsRoutes.js` | api-runtime | 203,883 | 4369 |
| `http-generic-api/supportTicketService.js` | api-runtime | 157,662 | 2301 |
| `Updating Registry Patch Index.md` | documentation | 155,274 | 1826 |
| `http-generic-api/routes/adminCliRoutes.js` | api-runtime | 149,339 | 3362 |
| `AI_Agent_Knowledge_Guide.md` | documentation | 145,911 | 1339 |
| `package-lock.json` | build-and-dependencies | 138,721 | 3861 |
| `http-generic-api/releaseReadiness.js` | api-runtime | 134,992 | 2591 |
| `schemas/operations.schema.json` | schemas-and-data | 134,568 | 3397 |
| `http-generic-api/routes/devAgentRoutes.js` | api-runtime | 127,236 | 2754 |
| `docs/work-maps/data-model-domain-map.md` | documentation | 117,364 | 848 |
| `apps/local-manager-windows/Program.cs` | applications | 112,920 | 2024 |
| `http-generic-api/platformResourceRecipeCapability.js` | api-runtime | 112,202 | 2722 |
| `http-generic-api/openapi/openapi.tenant-gpt.auth.yaml` | api-contracts | 110,362 | 3289 |
| `deployment_parity_checklist.md` | documentation | 109,207 | 571 |
| `http-generic-api/server.js` | api-runtime | 107,153 | 3307 |
| `http-generic-api/openapi/openapi.tenant-gpt.activation.yaml` | api-contracts | 105,919 | 3292 |
| `http-generic-api/routes/systemLayerRoutes.js` | api-runtime | 103,931 | 2644 |
| `docs/change-documentation-governance.md` | documentation | 102,373 | 533 |
| `http-generic-api/openapi/session-insight-promotion-read-models.yaml` | api-contracts | 101,333 | 1743 |
| `http-generic-api/registry.js` | api-runtime | 96,496 | 2451 |
| `http-generic-api/execution.js` | api-runtime | 93,620 | 2881 |
| `http-generic-api/repositoryGovernanceV6.js` | api-runtime | 91,304 | 1039 |

## Complete machine-readable inventory

The complete inventory of every non-generated tracked file, including category, extension, byte size, line count, SHA-256 content fingerprint, Unix mode, executable marker, and generated-file marker, is available in the repository-inventory.json artifact. The compact repository-inventory-summary.json artifact contains totals, grouped counts, package manifests, surface counts, and the largest files for low-noise review and downstream dashboards. The JSON file is the authoritative artifact for automation and downstream analysis; generated inventory and evaluation artifacts are intentionally omitted to keep regeneration deterministic.

## Regeneration

Run npm run inventory:check to verify that committed artifacts match the current Git index. Run npm run inventory:write to regenerate both artifacts locally. CI regenerates the artifacts on relevant changes and fails if the working tree becomes dirty.
