# Tenant GPT Pipeline Continuity — Spec Kit

**Feature branch:** `gpt/002-tenant-gpt-pipeline-continuity-20260623`  
**Prepared:** 2026-06-23  
**Status:** Implementation in progress

This kit closes false-readiness gaps in the Tenant GPT dashboard and activation-awareness pipeline without changing provider adapters or performing external writes.

## Problem

Tenant-facing actions and integrations can appear ready from global registry metadata even when the tenant lacks a validated connection, action grant, resource authority, canonical endpoint, runtime certification, or active installation. Missing query data can also be rendered as numeric zero.

## Scope

- Bind dashboard action readiness to `tenantEffectiveCapabilityResolver`.
- Fail closed when an action lacks a semantic capability mapping.
- Treat a connector as active only when an active, non-expired installation exists.
- Preserve `null`/unknown for unavailable counts instead of silently returning zero.
- Reflect blocked operational surfaces in completeness and awareness scoring.
- Add deterministic regression tests and complete the release checklist.

## Non-overlap constraints

PRs 1879–1881 were reviewed before branch creation. This branch must not edit their execution-preflight, GPT tool route, OpenAPI, route-registration, server-wiring, test-manifest, or generated surface-contract/work-map files.

## Approved implementation files

- `http-generic-api/tenantGrowthDashboardService.js`
- `http-generic-api/activationAwarenessService.js`
- `http-generic-api/test-tenant-growth-dashboard.mjs`
- `http-generic-api/test-activation-awareness-completeness.mjs`

No database migration, route, OpenAPI, provider, credential, or deployment mutation is included.
