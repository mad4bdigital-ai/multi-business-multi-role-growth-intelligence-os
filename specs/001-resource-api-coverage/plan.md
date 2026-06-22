# Implementation Plan: Self-Discovering Resource API Coverage

## Architecture

- **API**: `resourceApiRoutes.js` provides Admin, Tenant, Session, and operation readback routes.
- **Application**: descriptor-driven query helpers enforce pagination, search, lifecycle, and readback.
- **Domain**: `resource-api-coverage.manifest.json` defines logical resources and operation states.
- **Infrastructure**: MySQL registry tables persist descriptors, operation exports, audit runs, and findings.
- **CI**: `resource-api-coverage-audit.mjs` detects new uncovered relations, routes, and tool exports.
- **Contracts**: OpenAPI 3.1 documents all new paths.
- **Governance**: canonical families and the Knowledge Guide declare fail-closed behavior.

## Rollout

1. Add additive migration and descriptor manifest.
2. Add resource routes and safe projections.
3. Register Admin/Tenant tools.
4. Add tests and CI gate.
5. Merge through governed PR checks.
6. Verify production deployment and run live audit.
7. Treat legacy findings as prioritized debt; block new regressions.
